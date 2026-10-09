"""Human confirmation for Copilot tools that change data or start heavy jobs.

The LLM may *propose* these tools but never runs them: the proposal is stored server-side with an id and an
expiry, the officer confirms or cancels it in the chat, and only the stored arguments are executed, once.
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

PENDING_TTL = timedelta(minutes=15)

# tool name -> what the officer is approving
WRITE_TOOLS: Dict[str, str] = {
    "assign_camera_model": "Changes a camera's configuration",
    "trigger_video_reindex": "Rebuilds a video's search index entries",
    "tag_hot_target": "Creates a hot target under pursuit",
    "activate_pursuit_wave": "Starts a pursuit wave across neighbouring cameras",
    "analyze_chain_snatching": "Runs theft analysis and may create alerts",
    "detect_assault": "Runs a heavy assault-detection scan",
}

_lock = threading.Lock()
_pending: Dict[str, Dict[str, Any]] = {}


def is_write_tool(name: str) -> bool:
    return name in WRITE_TOOLS


def missing_required_args(name: str, args: Dict[str, Any]) -> list[str]:
    from app.assistant.tools import TOOL_SCHEMAS

    schema = next((t["function"] for t in TOOL_SCHEMAS if t["function"]["name"] == name), None)
    required = schema.get("parameters", {}).get("required", []) if schema else []
    return [r for r in required if not str(args.get(r) or "").strip()]


def _camera_label(db: Session, camera_id: str) -> str:
    from app.db.models import CameraProfile

    cam = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    return f"{cam.name} ({camera_id})" if cam else f"{camera_id} (unknown camera)"


def _video_label(db: Session, video_id: str) -> str:
    from app.db.models import VideoAsset

    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    return f"'{video.original_filename}' on {video.camera_id}" if video else f"{video_id} (unknown video)"


def describe(db: Session, name: str, args: Dict[str, Any]) -> str:
    """Plain-language summary of exactly what will run, with ids resolved to names."""
    if name == "assign_camera_model":
        from app.db.models import MLModel

        model = db.query(MLModel).filter(MLModel.id == args.get("model_id")).first()
        model_label = f"'{model.name}'" if model else f"'{args.get('model_id')}' (not in the registry)"
        return f"Assign detection model {model_label} to camera {_camera_label(db, args.get('camera_id', ''))}"
    if name == "trigger_video_reindex":
        return f"Re-index search entries for video {_video_label(db, args.get('video_id', ''))}"
    if name == "tag_hot_target":
        where = _camera_label(db, args.get("origin_camera_id", ""))
        return f"Tag hot target '{args.get('label')}' (priority {args.get('priority', 'HIGH')}) seen at {where}"
    if name == "activate_pursuit_wave":
        return (f"Activate a pursuit wave from camera {_camera_label(db, args.get('origin_camera_id', ''))} "
                f"({args.get('speed_mode', 'pedestrian')} speed)")
    if name == "analyze_chain_snatching":
        return f"Run chain-snatching / theft analysis on video {_video_label(db, args.get('video_id', ''))}"
    if name == "detect_assault":
        return f"Run assault detection on video {_video_label(db, args.get('video_id', ''))}"
    return f"Run {name} with {args}"


def _purge_expired(now: datetime) -> None:
    for action_id in [a for a, v in _pending.items() if v["expires_at"] < now]:
        _pending.pop(action_id, None)


def propose(db: Session, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Store a proposed write action and return its public description (no execution)."""
    now = datetime.now(timezone.utc)
    action = {
        "id": uuid.uuid4().hex,
        "tool": name,
        "args": dict(args),
        "summary": describe(db, name, args),
        "effect": WRITE_TOOLS[name],
        "status": "pending",
        "session_id": None,
        "created_at": now,
        "expires_at": now + PENDING_TTL,
    }
    with _lock:
        _purge_expired(now)
        _pending[action["id"]] = action
    return public(action)


def attach_session(action_id: str, session_id: str) -> None:
    with _lock:
        if action_id in _pending:
            _pending[action_id]["session_id"] = session_id


def peek(action_id: str) -> Optional[Dict[str, Any]]:
    """The pending action without consuming it; None if unknown or expired."""
    now = datetime.now(timezone.utc)
    with _lock:
        _purge_expired(now)
        return _pending.get(action_id)


def take(action_id: str) -> Optional[Dict[str, Any]]:
    """Remove and return a pending action (each proposal can be decided once); None if unknown or expired."""
    now = datetime.now(timezone.utc)
    with _lock:
        _purge_expired(now)
        return _pending.pop(action_id, None)


def public(action: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": action["id"],
        "tool": action["tool"],
        "args": action["args"],
        "summary": action["summary"],
        "effect": action["effect"],
        "status": action["status"],
        "expires_at": action["expires_at"].isoformat(),
    }
