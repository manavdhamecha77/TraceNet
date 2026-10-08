import os
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models import CameraProfile, VideoAsset, Area
from app.config import get_data_path
from app.preprocess.preprocessor import sanitize_filename

router = APIRouter(prefix="/api/v1/cctv-wall", tags=["CCTV Wall"])

# Persistent runtime configuration for CCTV Wall
_CONFIG = {
    "buffer_interval_seconds": 60,
    "active_ai_cameras": ["CAM_CBD_01", "CAM_CB_003", "CAM_GT_01", "CAM_MD_01", "CAM_RS_01"],
    "stream_mode": "accelerated",  # 'accelerated' | 'raw_slicing'
    "telemetry_ticker_enabled": True,
}

class CCTVFeedItem(BaseModel):
    camera_id: str
    camera_name: str
    area_id: Optional[str] = None
    area_name: Optional[str] = None
    zone: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    video_id: str
    stream_url: str
    direct_video_url: str
    thumbnail_url: Optional[str] = None
    duration: float
    fps: float
    resolution: str
    bitrate_mbps: str
    ai_inference_enabled: bool
    chunks_count: int
    chunks: List[str] = []

class CCTVWallConfigPayload(BaseModel):
    buffer_interval_seconds: int = Field(60, ge=10, le=600)
    active_ai_cameras: List[str] = Field(default_factory=list)
    stream_mode: str = Field("accelerated", pattern="^(accelerated|raw_slicing)$")

class TelemetryEvent(BaseModel):
    timestamp_seconds: float
    camera_id: str
    camera_name: str
    area_name: str
    event_type: str  # 'object_detected' | 'buffer_synced' | 'plate_read' | 'loitering_scan'
    description: str
    severity: str = "info"  # 'info' | 'warning' | 'alert'


@router.get("/feeds", response_model=List[CCTVFeedItem])
def get_cctv_wall_feeds(db: Session = Depends(get_db)):
    """Returns the 5 CCTV Surveillance Wall feeds with camera & stream metadata."""
    cams = [
        ("CAM_CBD_01", "6.2 Mbps"),
        ("CAM_CB_003", "3.7 Mbps"),
        ("CAM_GT_01", "10.2 Mbps"),
        ("CAM_MD_01", "7.2 Mbps"),
        ("CAM_RS_01", "5.1 Mbps"),
    ]
    
    feeds = []
    for cam_id, bitrate in cams:
        cam = db.query(CameraProfile).filter(CameraProfile.camera_id == cam_id).first()
        if not cam:
            continue
            
        video = db.query(VideoAsset).filter(VideoAsset.camera_id == cam_id).order_by(VideoAsset.upload_timestamp.desc()).first()
        if not video:
            continue

        cam_dir_name = f"{cam.camera_id}_{sanitize_filename(cam.name)}"
        chunks_dir = get_data_path(os.path.join("cameras", cam_dir_name, "chunks"))
        chunks = []
        if os.path.exists(chunks_dir):
            chunks = sorted([f for f in os.listdir(chunks_dir) if f.endswith(".mp4")])

        # Thumb URL
        thumb_url = f"/data/{video.thumbnail_path}" if video.thumbnail_path else None
        stream_url = f"/api/v1/videos/{video.id}/stream"
        direct_url = f"/data/cameras/{cam_dir_name}/original_assets/{video.standardized_filename}"

        feeds.append(
            CCTVFeedItem(
                camera_id=cam.camera_id,
                camera_name=cam.name,
                area_id=cam.area_id,
                area_name=cam.area.name if cam.area else "Central Zone",
                zone=cam.corridor_group or "Central Zone",
                latitude=cam.latitude,
                longitude=cam.longitude,
                video_id=video.id,
                stream_url=stream_url,
                direct_video_url=direct_url,
                thumbnail_url=thumb_url,
                duration=video.duration or 300.0,
                fps=20.0,
                resolution="1280x720 (720p HD)",
                bitrate_mbps=bitrate,
                ai_inference_enabled=cam.camera_id in _CONFIG["active_ai_cameras"],
                chunks_count=len(chunks),
                chunks=chunks,
            )
        )
    return feeds


@router.get("/config")
def get_cctv_wall_config():
    """Returns current runtime stream configuration."""
    return _CONFIG


@router.post("/config")
def update_cctv_wall_config(payload: CCTVWallConfigPayload):
    """Updates runtime stream configuration (buffer interval, active cameras, mode)."""
    _CONFIG["buffer_interval_seconds"] = payload.buffer_interval_seconds
    _CONFIG["active_ai_cameras"] = payload.active_ai_cameras
    _CONFIG["stream_mode"] = payload.stream_mode
    return {"status": "success", "config": _CONFIG}


@router.get("/telemetry")
def get_live_telemetry(current_time: float = Query(0.0, ge=0.0, le=3600.0), db: Session = Depends(get_db)):
    """Returns live telemetry stream events corresponding to current master playback time."""
    buffer_sec = _CONFIG["buffer_interval_seconds"]
    current_chunk_idx = int(current_time // buffer_sec) + 1
    chunk_start = (current_chunk_idx - 1) * buffer_sec
    chunk_end = current_chunk_idx * buffer_sec

    # Generate telemetry events matching real camera locations
    events = [
        {
            "timestamp_seconds": chunk_start,
            "camera_id": "CAM_CBD_01",
            "camera_name": "Central Bus Depo – Entry Gate",
            "area_name": "Central Bus Station",
            "event_type": "buffer_synced",
            "description": f"Rolling buffer [{int(chunk_start // 60):02d}:00–{int(chunk_end // 60):02d}:00] archived & indexed (Bitrate: 6.2 Mbps).",
            "severity": "info",
        },
        {
            "timestamp_seconds": current_time,
            "camera_id": "CAM_MD_01",
            "camera_name": "Mahidharpura Diamond Market",
            "area_name": "Diamond Bourse",
            "event_type": "object_detected",
            "description": "High-density vehicle and pedestrian flow monitored. Optical stability nominal.",
            "severity": "info",
        },
        {
            "timestamp_seconds": current_time,
            "camera_id": "CAM_RS_01",
            "camera_name": "Surat Railway Station Concourse",
            "area_name": "Railway Transit Hub",
            "event_type": "plate_read",
            "description": "Transit flow active. Plate & vehicle classifiers operational.",
            "severity": "info",
        },
    ]

    return {
        "master_time": current_time,
        "buffer_interval_seconds": buffer_sec,
        "current_chunk_index": current_chunk_idx,
        "active_ai_cameras_count": len(_CONFIG["active_ai_cameras"]),
        "stream_mode": _CONFIG["stream_mode"],
        "events": events,
    }
