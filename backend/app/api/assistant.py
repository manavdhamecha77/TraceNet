from __future__ import annotations

import os
import json
import base64
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.config import get_data_path
from app.assistant.agent import AssistantAgent
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
        "ollama_model": "qwen2.5-vl:3b",
        "cloud_api_key": "",
        "cloud_model": "gpt-4o-mini",
        "cloud_base_url": "https://api.openai.com/v1"
    }


class ChatMessage(BaseModel):
    role: str
    content: str
    image_b64: Optional[str] = None


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    provider_override: Optional[str] = None
    model_override: Optional[str] = None


class ConfigPayload(BaseModel):
    provider: str = Field(default="ollama", description="'ollama' | 'cloud'")
    ollama_host: str = Field(default="http://localhost:11434")
    ollama_model: str = Field(default="qwen2.5-vl:3b")
    cloud_api_key: Optional[str] = Field(default="")
    cloud_model: str = Field(default="gpt-4o-mini")
    cloud_base_url: str = Field(default="https://api.openai.com/v1")


@router.get("/config")
def get_assistant_config():
    """Retrieve active AI assistant provider and model settings."""
    return load_assistant_config()


@router.post("/config")
def save_assistant_config(payload: ConfigPayload):
    """Update AI assistant provider and model configuration."""
    cfg = payload.dict()
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return {"status": "success", "message": "Assistant configuration updated.", "config": cfg}


@router.post("/chat")
async def chat_with_assistant(payload: ChatRequest, db: Session = Depends(get_db)):
    """
    Process natural language queries and image attachments using AI Copilot agent.
    Autonomously invokes system tools (vector search, camera lookup, security alerts).
    """
    if not payload.messages:
        raise HTTPException(status_code=400, detail="Messages array cannot be empty.")

    cfg = load_assistant_config()
    provider_type = payload.provider_override or cfg.get("provider", "ollama")

    if provider_type == "ollama":
        host = cfg.get("ollama_host", "http://localhost:11434")
        model = payload.model_override or cfg.get("ollama_model", "qwen2.5-vl:3b")
        provider = OllamaProvider(host=host, model=model)
    else:
        api_key = cfg.get("cloud_api_key", "").strip()
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cloud LLM selected but API Key is empty. Configure an API key in Copilot Settings."
            )
        model = payload.model_override or cfg.get("cloud_model", "gpt-4o-mini")
        base_url = cfg.get("cloud_base_url", "https://api.openai.com/v1")
        provider = CloudOpenAIProvider(api_key=api_key, model=model, base_url=base_url)

    # Check if latest user message has a reference image attachment
    latest_msg = payload.messages[-1]
    extra_attachments = []

    if latest_msg.image_b64:
        try:
            # Decode base64 image and run reverse photo search automatically
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

    # Prepare message dicts
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
            # Merge photo search attachments if not already present
            existing_ids = {a.get("tracklet_id") for a in response.get("attachments", [])}
            for att in extra_attachments:
                if att.get("tracklet_id") not in existing_ids:
                    response.setdefault("attachments", []).append(att)
        return response
    except Exception as e:
        logger.error(f"Assistant chat execution failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Copilot execution failure: {e}"
        ) from e
