import subprocess
import secrets
import random
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
import urllib.parse
import urllib.request
import os

from app.db.session import get_db
from app.db.models import LiveStreamSession, StreamChunk, PairCode, CameraProfile
from app.streaming.manager import StreamManager
from app.streaming.config import StreamConfig
from app.streaming.mediamtx_downloader import ensure_mediamtx
from app.config import get_data_path

from loguru import logger

router = APIRouter(prefix="/api/v1/stream", tags=["streaming"])
manager = StreamManager()

PAIR_CODE_TTL_MINUTES = 10

# ---------------------------------------------------------------------------
# Internal stream start/stop (called automatically when device pairs + streams)
# ---------------------------------------------------------------------------

class StreamStartRequest(BaseModel):
    camera_id: str
    model_id: Optional[str] = None
    config: dict = {}

@router.post("/start")
def start_stream(req: StreamStartRequest, db: Session = Depends(get_db)):
    config = StreamConfig(**req.config)
    result = manager.generate_stream_token(req.camera_id, db, config)
    if not result:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager.start_inference(req.camera_id, result["session_id"], config, db)
    return result

@router.post("/stop/{camera_id}")
def stop_stream(camera_id: str, db: Session = Depends(get_db)):
    manager.stop_stream(camera_id, db)
    return {"message": "Stream stopped"}

@router.get("/status/{camera_id}")
def get_stream_status(camera_id: str, db: Session = Depends(get_db)):
    return manager.get_status(camera_id, db)

@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(LiveStreamSession).order_by(LiveStreamSession.started_at.desc()).all()
    return [s.to_dict() for s in sessions]

@router.get("/sessions/{session_id}/chunks")
def list_chunks(session_id: str, db: Session = Depends(get_db)):
    chunks = db.query(StreamChunk).filter(StreamChunk.session_id == session_id).order_by(StreamChunk.chunk_index.asc()).all()
    return [c.to_dict() for c in chunks]

# ---------------------------------------------------------------------------
# Pair Code API — decoupled edge camera device pairing
# ---------------------------------------------------------------------------

class PairGenerateRequest(BaseModel):
    camera_id: str
    device_label: Optional[str] = None  # e.g. 'Gate-3 Mobile Camera'

class PairVerifyRequest(BaseModel):
    code: str          # 6-digit code, with or without dash (e.g. '482910' or '482-910')
    device_label: Optional[str] = None  # optional device name set by the camera device
    backend_host: Optional[str] = None  # for confirmation echo


@router.post("/pair/generate")
def generate_pair_code(req: PairGenerateRequest, db: Session = Depends(get_db)):
    """Generates a 6-digit pairing code for a camera node.
    The DRISHTI operator calls this from the main dashboard.
    Returns the code (e.g. '482-910') and expiry timestamp.
    """
    cam = db.query(CameraProfile).filter(CameraProfile.camera_id == req.camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Invalidate any existing unused pair codes for this camera
    db.query(PairCode).filter(
        PairCode.camera_id == req.camera_id,
        PairCode.used == False
    ).delete(synchronize_session=False)
    db.commit()

    # Generate new 6-digit code
    code_digits = f"{random.randint(0, 999999):06d}"
    code_display = f"{code_digits[:3]}-{code_digits[3:]}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=PAIR_CODE_TTL_MINUTES)

    pair_code = PairCode(
        id=code_digits,
        camera_id=req.camera_id,
        code_display=code_display,
        device_label=req.device_label,
        expires_at=expires_at,
        used=False
    )
    db.add(pair_code)
    db.commit()

    logger.info(f"[Pair] Generated code {code_display} for camera {req.camera_id}, expires {expires_at.isoformat()}")

    return {
        "code": code_display,
        "camera_id": req.camera_id,
        "camera_name": cam.name,
        "expires_at": expires_at.isoformat(),
        "ttl_minutes": PAIR_CODE_TTL_MINUTES,
        "whip_url_template": f"http://{{HOST}}:8889/{req.camera_id}/whip",
        "whep_url_template": f"http://{{HOST}}:8889/{req.camera_id}/whep",
    }


@router.post("/pair/verify")
def verify_pair_code(req: PairVerifyRequest, db: Session = Depends(get_db)):
    """Called by the edge camera device to exchange the 6-digit pair code
    for a long-lived device_auth_token and WHIP stream credentials.
    """
    # Normalize: strip dash, spaces
    code_digits = req.code.replace("-", "").replace(" ", "").strip()
    if len(code_digits) != 6 or not code_digits.isdigit():
        raise HTTPException(status_code=400, detail="Invalid code format. Expected 6-digit code.")

    pair_code = db.query(PairCode).filter(
        PairCode.id == code_digits,
        PairCode.used == False
    ).first()

    if not pair_code:
        raise HTTPException(status_code=404, detail="Pair code not found or already used.")

    now = datetime.now(timezone.utc)
    expires = pair_code.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(status_code=410, detail="Pair code has expired. Please generate a new one.")

    # Issue device auth token
    device_token = secrets.token_hex(32)
    pair_code.used = True
    pair_code.device_auth_token = device_token
    if req.device_label:
        pair_code.device_label = req.device_label

    # Issue stream token via manager
    config = StreamConfig()
    stream_credentials = manager.generate_stream_token(pair_code.camera_id, db, config)
    if not stream_credentials:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not generate stream credentials.")

    manager.start_inference(pair_code.camera_id, stream_credentials["session_id"], config, db)
    db.commit()

    logger.info(f"[Pair] Device verified for camera {pair_code.camera_id}, token issued")

    return {
        "camera_id": pair_code.camera_id,
        "device_auth_token": device_token,
        "session_id": stream_credentials["session_id"],
        "whip_url": stream_credentials["whip_url"],
        "stream_key": stream_credentials["stream_key"],
        "stream_token": stream_credentials["token"],
        "whep_url": stream_credentials.get("whep_url", ""),
        "ws_telemetry_url": stream_credentials.get("ws_url", ""),
    }


@router.post("/pair/stop")
def device_stop_stream(request: Request, db: Session = Depends(get_db)):
    """Called by the edge camera device to cleanly stop streaming."""
    auth = request.headers.get("X-Device-Token", "")
    pair = db.query(PairCode).filter(PairCode.device_auth_token == auth, PairCode.used == True).first()
    if not pair:
        raise HTTPException(status_code=401, detail="Invalid device token")
    manager.stop_stream(pair.camera_id, db)
    logger.info(f"[Pair] Device stopped stream for camera {pair.camera_id}")
    return {"message": "Stream stopped", "camera_id": pair.camera_id}


@router.get("/pair/status")
def device_get_status(request: Request, db: Session = Depends(get_db)):
    """Edge camera polls this to get its current stream status & remote commands."""
    auth = request.headers.get("X-Device-Token", "")
    pair = db.query(PairCode).filter(PairCode.device_auth_token == auth, PairCode.used == True).first()
    if not pair:
        raise HTTPException(status_code=401, detail="Invalid device token")
    status = manager.get_status(pair.camera_id, db)
    return {"camera_id": pair.camera_id, **status}

# ---------------------------------------------------------------------------
# MediaMTX Auth hook + control
# ---------------------------------------------------------------------------

@router.post("/mediamtx-auth")
async def mediamtx_auth(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    action = data.get("action", "publish")
    path = data.get("path", "")
    logger.info(f"[MediaMTX Auth] Hook triggered: action='{action}', path='{path}', ip='{data.get('ip')}'")

    if action == "read":
        return {"status": "ok"}

    query = data.get("query", "")
    parsed_query = urllib.parse.parse_qs(query)

    token = parsed_query.get("token", [None])[0] or data.get("user") or data.get("password")
    stream_key = parsed_query.get("stream_key", [None])[0] or path.split('/')[0]

    if not token or not stream_key:
        logger.warning(f"[MediaMTX Auth] Missing auth params for path='{path}'")
        raise HTTPException(status_code=401, detail="Missing auth params")

    if not manager.validate_token(token, stream_key, db):
        logger.warning(f"[MediaMTX Auth] Token validation failed for stream_key='{stream_key}'")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    logger.info(f"[MediaMTX Auth] Authorized publish for camera='{stream_key}'")
    return {"status": "ok"}


@router.get("/mediamtx-status")
def mediamtx_status():
    try:
        urllib.request.urlopen("http://localhost:9997/v3/config/global/get", timeout=2)
        return {"running": True}
    except Exception:
        return {"running": False}


@router.post("/mediamtx-start")
def mediamtx_start():
    binary_path = ensure_mediamtx()
    config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../mediamtx/mediamtx.yml"))
    subprocess.Popen([binary_path, config_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"message": "MediaMTX started"}

# ---------------------------------------------------------------------------
# WebSocket telemetry endpoint (operator viewers)
# ---------------------------------------------------------------------------

@router.websocket("/ws/stream/{camera_id}")
@router.websocket("/ws/{camera_id}")
async def stream_websocket(websocket: WebSocket, camera_id: str):
    await websocket.accept()
    manager.register_ws_client(camera_id, websocket)
    logger.info(f"[WebSocket] Client connected for camera '{camera_id}'")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.unregister_ws_client(camera_id, websocket)
        logger.info(f"[WebSocket] Client disconnected for camera '{camera_id}'")
