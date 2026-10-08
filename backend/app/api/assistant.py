from __future__ import annotations

import os
import json
import uuid
import base64
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import ChatSession
from app.config import get_data_path
from app.assistant import confirmations
from app.assistant.agent import AssistantAgent
from app.assistant.tools import ToolExecutor
from app.assistant.llm_provider import OllamaProvider, CloudOpenAIProvider
from app.search.image_search import ImageSearchService

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])

CONFIG_FILE = get_data_path("assistant_config.json")


def load_assistant_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read assistant config: {e}")
    return {
        "provider": "ollama",
        "ollama_host": "http://localhost:11434",
        "ollama_model": "qwen2.5:3b",
        "cloud_api_key": "",
        "cloud_model": "gpt-4o-mini",
        "cloud_base_url": "https://api.openai.com/v1"
    }


class ChatMessage(BaseModel):
    role: str
    content: str
    image_b64: Optional[str] = None
    executed_tools: Optional[List[Dict[str, Any]]] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    pending_action: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    messages: List[ChatMessage]
    provider_override: Optional[str] = None
    model_override: Optional[str] = None


class SessionCreatePayload(BaseModel):
    title: Optional[str] = "New Conversation"


class ConfigPayload(BaseModel):
    provider: str = Field(default="ollama", description="'ollama' | 'cloud'")
    ollama_host: str = Field(default="http://localhost:11434")
    ollama_model: str = Field(default="qwen2.5:3b")
    cloud_api_key: Optional[str] = Field(default="", description="New key; leave empty to keep the saved one")
    clear_cloud_api_key: bool = Field(default=False, description="Remove the saved key")
    cloud_model: str = Field(default="gpt-4o-mini")
    cloud_base_url: str = Field(default="https://api.openai.com/v1")


def public_assistant_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Config safe to send to a browser: the API key itself never leaves the server."""
    key = (cfg.get("cloud_api_key") or "").strip()
    public = {k: v for k, v in cfg.items() if k != "cloud_api_key"}
    public["cloud_api_key"] = ""
    public["cloud_api_key_set"] = bool(key)
    public["cloud_api_key_hint"] = f"…{key[-4:]}" if len(key) >= 8 else ""
    return public


@router.get("/config")
def get_assistant_config():
    """Retrieve active AI assistant provider and model settings (API key masked)."""
    return public_assistant_config(load_assistant_config())


@router.post("/config")
def save_assistant_config(payload: ConfigPayload):
    """Update AI assistant provider and model configuration.

    An empty ``cloud_api_key`` keeps the saved key (the browser never receives it, so it cannot echo it
    back); ``clear_cloud_api_key`` removes it."""
    existing_key = (load_assistant_config().get("cloud_api_key") or "").strip()
    cfg = payload.dict(exclude={"clear_cloud_api_key"})
    new_key = (payload.cloud_api_key or "").strip()
    cfg["cloud_api_key"] = "" if payload.clear_cloud_api_key else (new_key or existing_key)
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return {"status": "success", "message": "Assistant configuration updated.", "config": public_assistant_config(cfg)}


@router.get("/ollama-models")
def get_installed_ollama_models(host: str = "http://localhost:11434"):
    """Fetch list of installed models from local Ollama instance."""
    url = f"{host.rstrip('/')}/api/tags"
    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("name") for m in data.get("models", []) if m.get("name")]
            if models:
                return {"status": "success", "models": models}
    except Exception as e:
        logger.warning(f"Failed to fetch local Ollama models from {host}: {e}")
    return {"status": "fallback", "models": ["qwen2.5:3b", "qwen2.5-vl:3b", "qwen2.5:7b"]}


@router.get("/sessions")
def list_chat_sessions(db: Session = Depends(get_db)):
    """List all saved chat sessions ordered by updated_at descending."""
    sessions = db.query(ChatSession).order_by(ChatSession.updated_at.desc()).all()
    return [s.to_dict() for s in sessions]


@router.post("/sessions")
def create_chat_session(payload: SessionCreatePayload, db: Session = Depends(get_db)):
    """Create a new chat session."""
    session_id = str(uuid.uuid4())
    session = ChatSession(
        id=session_id,
        title=payload.title or "New Conversation",
        messages=json.dumps([]),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session.to_dict()


@router.get("/sessions/{session_id}")
def get_chat_session(session_id: str, db: Session = Depends(get_db)):
    """Retrieve a specific chat session by ID."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    return session.to_dict()


@router.delete("/sessions/{session_id}")
def delete_chat_session(session_id: str, db: Session = Depends(get_db)):
    """Delete a specific chat session by ID."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    db.delete(session)
    db.commit()
    return {"status": "success", "message": f"Session {session_id} deleted."}


@router.post("/chat")
async def chat_with_assistant(payload: ChatRequest, db: Session = Depends(get_db)):
    """
    Process natural language queries and image attachments using AI Copilot agent.
    Autonomously invokes system tools and persists conversation history into ChatSession.
    """
    if not payload.messages:
        raise HTTPException(status_code=400, detail="Messages array cannot be empty.")

    cfg = load_assistant_config()
    provider_type = payload.provider_override or cfg.get("provider", "ollama")

    if provider_type == "ollama":
        host = cfg.get("ollama_host", "http://localhost:11434")
        model = payload.model_override or cfg.get("ollama_model", "qwen2.5:3b")
        provider = OllamaProvider(host=host, model=model)
    else:
        api_key = cfg.get("cloud_api_key", "").strip()
        base_url = cfg.get("cloud_base_url", "https://api.openai.com/v1").strip()
        model = payload.model_override or cfg.get("cloud_model", "gpt-4o-mini")

        if "openai.com" in base_url.lower() and not api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OpenAI API requires an API Key. Please enter an API key in Copilot Settings."
            )
        provider = CloudOpenAIProvider(api_key=api_key, model=model, base_url=base_url)

    # Resolve or create ChatSession in DB
    session_obj = None
    if payload.session_id:
        session_obj = db.query(ChatSession).filter(ChatSession.id == payload.session_id).first()

    if not session_obj:
        session_id = payload.session_id or str(uuid.uuid4())
        session_obj = ChatSession(
            id=session_id,
            title="New Conversation",
            messages=json.dumps([]),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(session_obj)
        db.commit()

    # Check if latest user message has a reference image attachment
    latest_msg = payload.messages[-1]
    extra_attachments = []

    if latest_msg.image_b64:
        try:
            image_bytes = base64.b64decode(latest_msg.image_b64)
            img_service = ImageSearchService()
            photo_results = await img_service.search_from_upload(
                file_bytes=image_bytes,
                filename="copilot_attachment.jpg",
                db=db,
                top_k=8
            )
            extra_attachments.extend(photo_results)
            logger.info(f"Assistant: executed automatic reverse photo search for image prompt -> {len(photo_results)} matches")
        except Exception as e:
            logger.warning(f"Failed to process image attachment for vector search: {e}")

    # Prepare message dicts for agent execution
    formatted_messages = []
    for m in payload.messages:
        item: Dict[str, Any] = {"role": m.role, "content": m.content}
        if m.image_b64:
            item["images"] = [m.image_b64]
            item["image_b64"] = m.image_b64
        formatted_messages.append(item)

    agent = AssistantAgent(provider)

    try:
        response = agent.run_conversation(messages=formatted_messages, db=db)
        if extra_attachments:
            existing_ids = {a.get("tracklet_id") for a in response.get("attachments", [])}
            for att in extra_attachments:
                if att.get("tracklet_id") not in existing_ids:
                    response.setdefault("attachments", []).append(att)

        # Save conversation history to ChatSession in DB
        session_messages = []
        for m in payload.messages:
            m_dict = {
                "role": m.role,
                "content": m.content,
                "image_b64": m.image_b64
            }
            if m.executed_tools:
                m_dict["executed_tools"] = m.executed_tools
            if m.attachments:
                m_dict["attachments"] = m.attachments
            if m.pending_action:
                m_dict["pending_action"] = m.pending_action
            session_messages.append(m_dict)

        # Append final assistant message
        assistant_msg = {
            "role": "assistant",
            "content": response.get("content", ""),
            "executed_tools": response.get("executed_tools", []),
            "attachments": response.get("attachments", [])
        }
        if response.get("pending_action"):
            assistant_msg["pending_action"] = response["pending_action"]
        session_messages.append(assistant_msg)

        # Auto-update session title if default
        if session_obj.title == "New Conversation" and payload.messages:
            first_text = payload.messages[0].content.strip()
            if first_text:
                session_obj.title = first_text[:35] + ("..." if len(first_text) > 35 else "")

        session_obj.messages = json.dumps(session_messages)
        session_obj.updated_at = datetime.now(timezone.utc)
        db.commit()

        response["session_id"] = session_obj.id
        response["session_title"] = session_obj.title
        if response.get("pending_action"):
            confirmations.attach_session(response["pending_action"]["id"], session_obj.id)
        return response

    except Exception as e:
        logger.error(f"Assistant chat execution failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Copilot execution failure: {e}"
        ) from e


# -------------------------------------------------------
# Confirmation of Copilot write actions
# -------------------------------------------------------

class ActionDecision(BaseModel):
    decided_by: Optional[str] = Field(default="Operator", description="Officer confirming or cancelling")


def _record_decision(db: Session, action: Dict[str, Any], status_: str, message: str, decided_by: str,
                     result: Optional[Dict[str, Any]] = None) -> None:
    """Audit-log the decision and record it in the chat session the proposal came from."""
    from app.api.audit import AuditLogEntry, write_audit_log

    try:
        write_audit_log(AuditLogEntry(
            event_type="copilot_action",
            user_id=decided_by or "Operator",
            action=status_,
            resource_type="copilot_tool",
            resource_id=action["tool"],
            details={"action_id": action["id"], "summary": action["summary"], "args": action["args"],
                     "result_status": (result or {}).get("status")},
        ))
    except Exception as exc:
        logger.warning(f"Failed to write Copilot action audit log: {exc}")

    session_id = action.get("session_id")
    session_obj = db.query(ChatSession).filter(ChatSession.id == session_id).first() if session_id else None
    if not session_obj:
        return
    try:
        history = json.loads(session_obj.messages or "[]")
    except ValueError:
        history = []
    for msg in history:
        pending = msg.get("pending_action")
        if pending and pending.get("id") == action["id"]:
            pending["status"] = status_
    history.append({"role": "assistant", "content": message, "executed_tools": [], "attachments": []})
    session_obj.messages = json.dumps(history)
    session_obj.updated_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/actions/{action_id}/confirm")
def confirm_copilot_action(action_id: str, payload: ActionDecision, db: Session = Depends(get_db)):
    """Run a write action the Copilot proposed. Only the server-stored proposal is executed, at most once."""
    action = confirmations.take(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="This action has expired or was already decided. Ask the Copilot again.")
    result = ToolExecutor(db).execute_tool(action["tool"], action["args"])
    ok = result.get("status") == "success"
    status_ = "confirmed" if ok else "failed"
    detail = result.get("message") or ""
    message = f"Done: {action['summary']}." if ok else f"Could not complete: {action['summary']}. {detail}".strip()
    if ok and detail:
        message += f" {detail}"
    _record_decision(db, action, status_, message, payload.decided_by, result)
    return {
        "status": status_,
        "action": {**confirmations.public(action), "status": status_},
        "result": result,
        "message": {"role": "assistant", "content": message,
                    "executed_tools": [{"name": action["tool"], "args": action["args"], "status": result.get("status")}]},
    }


@router.post("/actions/{action_id}/cancel")
def cancel_copilot_action(action_id: str, payload: ActionDecision, db: Session = Depends(get_db)):
    """Discard a write action the Copilot proposed; nothing is executed."""
    action = confirmations.take(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="This action has expired or was already decided.")
    message = f"Cancelled: {action['summary']}. Nothing was changed."
    _record_decision(db, action, "cancelled", message, payload.decided_by)
    return {
        "status": "cancelled",
        "action": {**confirmations.public(action), "status": "cancelled"},
        "message": {"role": "assistant", "content": message, "executed_tools": []},
    }
