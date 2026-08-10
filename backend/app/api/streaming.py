import subprocess
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
import urllib.parse
import urllib.request
import os

from app.db.session import get_db
from app.db.models import LiveStreamSession, StreamChunk
from app.streaming.manager import StreamManager
from app.streaming.config import StreamConfig
from app.streaming.mediamtx_downloader import ensure_mediamtx
from app.config import get_data_path

from loguru import logger

router = APIRouter(prefix="/api/v1/stream", tags=["streaming"])
manager = StreamManager()

class StreamStartRequest(BaseModel):
    camera_id: str
    model_id: str | None = None
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
    config_path = get_data_path("../mediamtx/mediamtx.yml")
    config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../mediamtx/mediamtx.yml"))
    subprocess.Popen([binary_path, config_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"message": "MediaMTX started"}

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
