import subprocess
import secrets
import random
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
import urllib.parse
import urllib.request
import os
import socket
import time

import httpx

from app.db.session import get_db
from app.db.models import LiveStreamSession, StreamChunk, PairCode, CameraProfile
from app.streaming.manager import StreamManager
from app.streaming.config import StreamConfig
from app.streaming.mediamtx_downloader import ensure_mediamtx
from app.config import get_data_path
from app.tls import lan_ipv4_addresses, CERT_FILE

from loguru import logger

router = APIRouter(prefix="/api/v1/stream", tags=["streaming"])
manager = StreamManager()

PAIR_CODE_TTL_MINUTES = 10
HTTPS_PORT = int(os.getenv("TRACENET_HTTPS_PORT", "8443"))
HTTP_PORT = int(os.getenv("TRACENET_HTTP_PORT", "8000"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_https_probe_cache: dict = {"at": 0.0, "up": False}


def _https_listener_active(ttl_sec: float = 3.0) -> bool:
    """True only when something is actually accepting connections on the HTTPS port.
    The certificate file under backend/data/certs persists between runs, so its existence says nothing
    about whether the current process was started through serve.py (plain uvicorn never opens :8443)."""
    now = time.monotonic()
    if now - _https_probe_cache["at"] < ttl_sec:
        return _https_probe_cache["up"]
    up = False
    try:
        with socket.create_connection(("127.0.0.1", HTTPS_PORT), timeout=0.3):
            up = True
    except OSError:
        up = False
    _https_probe_cache.update(at=now, up=up)
    return up


def _public_base(request: Request) -> str:
    """Origin the caller reached us on (scheme + host + port). WHIP/WHEP are proxied through this
    same origin so a phone only ever has to trust one certificate."""
    return str(request.base_url).rstrip("/")


def _with_proxy_urls(result: dict, request: Request) -> dict:
    """Rewrites MediaMTX-internal WHIP/WHEP URLs to the backend's proxied endpoints."""
    cam = result.get("camera_id") or ""
    base = _public_base(request)
    out = dict(result)
    out["whip_url"] = f"{base}/api/v1/stream/whip/{cam}?token={result['token']}&stream_key={result['stream_key']}"
    out["whep_url"] = f"{base}/api/v1/stream/whep/{cam}"
    out["ws_url"] = f"{base.replace('https://', 'wss://').replace('http://', 'ws://')}/api/v1/stream/ws/stream/{cam}"
    out.pop("rtsp_url", None)  # internal only
    return out


def _store_result_camera(result: dict, camera_id: str) -> dict:
    result["camera_id"] = camera_id
    return result


# ---------------------------------------------------------------------------
# Internal stream start/stop (dashboard / tests). Phones use the pair flow below.
# ---------------------------------------------------------------------------

class StreamStartRequest(BaseModel):
    camera_id: str
    model_id: Optional[str] = None
    config: dict = {}

@router.post("/start")
def start_stream(req: StreamStartRequest, request: Request, db: Session = Depends(get_db)):
    config = StreamConfig.from_dict(req.config)
    result = manager.generate_stream_token(req.camera_id, db, config)
    if not result:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager.start_inference(req.camera_id, result["session_id"], config, db)
    out = _with_proxy_urls(_store_result_camera(result, req.camera_id), request)
    out["config"] = config.to_public_dict()
    return out

@router.post("/stop/{camera_id}")
def stop_stream(camera_id: str, db: Session = Depends(get_db)):
    manager.stop_stream(camera_id, db)
    return {"message": "Stream stopped"}

@router.get("/status/{camera_id}")
def get_stream_status(camera_id: str, db: Session = Depends(get_db)):
    status = manager.get_status(camera_id, db)
    active = manager._active_streams.get(camera_id)
    if active and active.get("config"):
        status["config"] = active["config"].to_public_dict()
    return status

@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(LiveStreamSession).order_by(LiveStreamSession.started_at.desc()).all()
    return [s.to_dict() for s in sessions]

@router.get("/sessions/{session_id}/chunks")
def list_chunks(session_id: str, db: Session = Depends(get_db)):
    chunks = db.query(StreamChunk).filter(StreamChunk.session_id == session_id).order_by(StreamChunk.chunk_index.asc()).all()
    return [c.to_dict() for c in chunks]


@router.get("/access-urls")
def access_urls(request: Request):
    """Where a phone / edge device on the LAN should open the edge camera app.
    HTTPS is required for camera access on anything but localhost; the HTTPS listener exists only when the
    backend runs through serve.py (self-signed certificate under backend/data/certs). The flag is based on a
    live probe of the HTTPS port, not on the certificate file, so a stale cert never advertises a dead URL."""
    ips = lan_ipv4_addresses()
    cert_present = os.path.exists(CERT_FILE)
    https_available = cert_present and _https_listener_active()
    urls = []
    for ip in ips:
        if https_available:
            urls.append({"url": f"https://{ip}:{HTTPS_PORT}/camera-app", "secure": True, "host": ip})
        urls.append({"url": f"http://{ip}:{HTTP_PORT}/camera-app", "secure": False, "host": ip})
    return {
        "lan_ips": ips,
        "https_port": HTTPS_PORT,
        "http_port": HTTP_PORT,
        "https_available": https_available,
        "reached_via": _public_base(request),
        "recommended": next((u["url"] for u in urls if u["secure"]), (urls[0]["url"] if urls else f"{_public_base(request)}/camera-app")),
        "urls": urls,
        "https_cert_present": cert_present,
        "note": ("Phones need the HTTPS URL (accept the self-signed certificate once). "
                 f"Nothing is listening on :{HTTPS_PORT} right now: start the backend with `python serve.py` "
                 "(not plain uvicorn) to enable it." if not https_available else
                 "Phones: open the HTTPS URL and accept the self-signed certificate once."),
    }

# ---------------------------------------------------------------------------
# Pair Code API — decoupled edge camera device pairing
# ---------------------------------------------------------------------------

class PairGenerateRequest(BaseModel):
    camera_id: str
    device_label: Optional[str] = None  # e.g. 'Gate-3 Mobile Camera'
    config: dict = {}                   # operator-chosen StreamConfig (chunk length, auto-import, live fps, ...)

class PairVerifyRequest(BaseModel):
    code: str          # 6-digit code, with or without dash (e.g. '482910' or '482-910')
    device_label: Optional[str] = None  # optional device name set by the camera device
    backend_host: Optional[str] = None  # for confirmation echo


@router.post("/pair/generate")
def generate_pair_code(req: PairGenerateRequest, request: Request, db: Session = Depends(get_db)):
    """Generates a 6-digit pairing code for a camera node.
    The DRISHTI operator calls this from the main dashboard. The stream configuration chosen here is
    stored with the code and applied when the device verifies it.
    """
    cam = db.query(CameraProfile).filter(CameraProfile.camera_id == req.camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    config = StreamConfig.from_dict(req.config)

    # Invalidate any existing unused pair codes for this camera
    db.query(PairCode).filter(
        PairCode.camera_id == req.camera_id,
        PairCode.used == False
    ).delete(synchronize_session=False)
    db.commit()

    code_digits = f"{random.randint(0, 999999):06d}"
    code_display = f"{code_digits[:3]}-{code_digits[3:]}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=PAIR_CODE_TTL_MINUTES)

    pair_code = PairCode(
        id=code_digits,
        camera_id=req.camera_id,
        code_display=code_display,
        device_label=req.device_label,
        expires_at=expires_at,
        used=False,
        stream_config=json.dumps(config.to_public_dict()),
    )
    db.add(pair_code)
    db.commit()

    logger.info(f"[Pair] Generated code {code_display} for camera {req.camera_id}, expires {expires_at.isoformat()}, config={config.to_public_dict()}")

    urls = access_urls(request)
    return {
        "code": code_display,
        "camera_id": req.camera_id,
        "camera_name": cam.name,
        "expires_at": expires_at.isoformat(),
        "ttl_minutes": PAIR_CODE_TTL_MINUTES,
        "config": config.to_public_dict(),
        "camera_app_url": urls["recommended"],
        "camera_app_urls": urls["urls"],
        "https_available": urls["https_available"],
    }


@router.post("/pair/verify")
def verify_pair_code(req: PairVerifyRequest, request: Request, db: Session = Depends(get_db)):
    """Called by the edge camera device to exchange the 6-digit pair code
    for a long-lived device_auth_token and WHIP stream credentials.
    """
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

    device_token = secrets.token_hex(32)
    pair_code.used = True
    pair_code.device_auth_token = device_token
    if req.device_label:
        pair_code.device_label = req.device_label

    # Apply the configuration the operator chose when generating the code
    try:
        stored = json.loads(pair_code.stream_config) if pair_code.stream_config else {}
    except Exception:
        stored = {}
    config = StreamConfig.from_dict(stored)

    stream_credentials = manager.generate_stream_token(pair_code.camera_id, db, config)
    if not stream_credentials:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not generate stream credentials.")

    manager.start_inference(pair_code.camera_id, stream_credentials["session_id"], config, db)
    db.commit()

    proxied = _with_proxy_urls(_store_result_camera(stream_credentials, pair_code.camera_id), request)
    logger.info(f"[Pair] Device verified for camera {pair_code.camera_id}, token issued, config={config.to_public_dict()}")

    return {
        "camera_id": pair_code.camera_id,
        "device_auth_token": device_token,
        "session_id": stream_credentials["session_id"],
        "whip_url": proxied["whip_url"],
        "stream_key": stream_credentials["stream_key"],
        "stream_token": stream_credentials["token"],
        "whep_url": proxied["whep_url"],
        "ws_telemetry_url": proxied["ws_url"],
        "config": config.to_public_dict(),
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
# WHIP / WHEP proxy — the only WebRTC signalling path clients use.
# MediaMTX (port 8889) stays internal; phones talk to this origin only (one certificate).
# ---------------------------------------------------------------------------

_SDP_HEADERS = {"Content-Type": "application/sdp"}


def _mediamtx_base() -> str:
    return StreamConfig().mediamtx_whip_base.rstrip("/")


async def _forward_sdp(method: str, upstream_url: str, body: bytes, content_type: str) -> httpx.Response:
    """Must be non-blocking: while MediaMTX handles this request it calls back into THIS server's
    /mediamtx-auth hook, so a synchronous client here would deadlock the event loop until timeout."""
    try:
        async with httpx.AsyncClient(timeout=15.0, trust_env=False) as client:
            return await client.request(method, upstream_url, content=body, headers={"Content-Type": content_type})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MediaMTX unreachable: {e}")


async def _proxy_sdp_offer(kind: str, camera_id: str, request: Request) -> Response:
    """POST an SDP offer to MediaMTX's /{camera}/whip|whep and return the answer.
    The MediaMTX session Location is rewritten to this proxy so DELETE/PATCH keep working."""
    body = await request.body()
    query = request.url.query
    upstream = f"{_mediamtx_base()}/{camera_id}/{kind}" + (f"?{query}" if query else "")
    up = await _forward_sdp("POST", upstream, body, request.headers.get("content-type", "application/sdp"))
    if up.status_code >= 400:
        detail = up.text[:300] or f"MediaMTX returned {up.status_code}"
        if up.status_code == 404 and kind == "whep":
            detail = "No publisher is streaming to this camera yet."
        raise HTTPException(status_code=up.status_code, detail=detail)

    headers = {}
    loc = up.headers.get("location") or up.headers.get("Location")
    if loc:
        session_id = loc.rstrip("/").split("/")[-1]
        headers["Location"] = f"{_public_base(request)}/api/v1/stream/{kind}/{camera_id}/{session_id}"
    for h in ("etag", "accept-patch"):
        if h in up.headers:
            headers[h.title()] = up.headers[h]
    return Response(content=up.content, status_code=up.status_code, media_type="application/sdp", headers=headers)


async def _proxy_sdp_session(kind: str, camera_id: str, session_id: str, request: Request) -> Response:
    body = await request.body()
    upstream = f"{_mediamtx_base()}/{camera_id}/{kind}/{session_id}"
    up = await _forward_sdp(request.method, upstream, body, request.headers.get("content-type", "application/trickle-ice-sdpfrag"))
    return Response(content=up.content, status_code=up.status_code, media_type=up.headers.get("content-type", "text/plain"))


@router.post("/whip/{camera_id}")
async def whip_offer(camera_id: str, request: Request):
    """Publish: the camera device posts its SDP offer here (token + stream_key in the query)."""
    return await _proxy_sdp_offer("whip", camera_id, request)


@router.api_route("/whip/{camera_id}/{session_id}", methods=["PATCH", "DELETE"])
async def whip_session(camera_id: str, session_id: str, request: Request):
    return await _proxy_sdp_session("whip", camera_id, session_id, request)


@router.post("/whep/{camera_id}")
async def whep_offer(camera_id: str, request: Request):
    """Play: the dashboard posts its SDP offer here and receives the answer."""
    return await _proxy_sdp_offer("whep", camera_id, request)


@router.api_route("/whep/{camera_id}/{session_id}", methods=["PATCH", "DELETE"])
async def whep_session(camera_id: str, session_id: str, request: Request):
    return await _proxy_sdp_session("whep", camera_id, session_id, request)

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
    """MediaMTX's own API port is disabled in our config, so probe the WebRTC signalling port instead."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", 8889), timeout=1.5):
            return {"running": True, "webrtc_port": 8889}
    except OSError:
        return {"running": False, "webrtc_port": 8889}


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
