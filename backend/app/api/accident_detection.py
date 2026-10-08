import os
import json
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import Alert, VideoAsset
from app.config import get_data_path
from app.detection.accident_detector import get_accident_detector, DEFAULT_ACCIDENT_MODEL
from app.detection.detector import resolve_standardized_video_path

router = APIRouter(prefix="/api/v1", tags=["accident-detection"])


class DispatchRequest(BaseModel):
    operator_name: Optional[str] = "Traffic Unit 1"
    emergency_units: Optional[str] = "108 Ambulance & 112 Traffic Response"
    notes: Optional[str] = None


class AccidentModelSwitchRequest(BaseModel):
    model_path: str


@router.post("/videos/{video_id}/accidents/run")
def run_accident_detection(video_id: str, db: Session = Depends(get_db)):
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video asset not found")

    video_path = resolve_standardized_video_path(video)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video media file not found on disk")

    output_dir = get_data_path(os.path.join("processed/accidents", video_id))
    detector = get_accident_detector()

    try:
        artifact = detector.analyze_video(
            video_path=video_path,
            output_dir=output_dir,
            camera_id=video.camera_id,
            video_id=video_id,
            db=db,
        )
        return {
            "video_id": video_id,
            "incidents_count": artifact["incidents_count"],
            "incidents": artifact["incidents"],
            "message": f"Accident detection completed. Found {artifact['incidents_count']} collision incident(s)."
        }
    except Exception as e:
        logger.error(f"Accident detection execution failed for video {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/videos/{video_id}/accidents")
def get_video_accidents(video_id: str):
    artifact_path = get_data_path(os.path.join("processed/accidents", video_id, "accidents.json"))
    if not os.path.exists(artifact_path):
        raise HTTPException(status_code=404, detail="Accident analysis artifact not found for this video")

    with open(artifact_path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("/accidents/{alert_id}/dispatch")
def dispatch_emergency_response(alert_id: int, payload: DispatchRequest, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if alert.alert_type != "accident":
        raise HTTPException(status_code=400, detail="Alert is not a traffic accident alert")

    # Update analysis_log
    try:
        data = json.loads(alert.analysis_log) if alert.analysis_log else {}
    except Exception:
        data = {}

    data["dispatch_status"] = "dispatched"
    data["dispatched_at"] = datetime.now(timezone.utc).isoformat()
    data["dispatched_by"] = payload.operator_name
    data["emergency_units"] = payload.emergency_units
    if payload.notes:
        data["dispatch_notes"] = payload.notes

    alert.analysis_log = json.dumps(data)
    # Acknowledge the alert upon dispatch
    alert.acknowledged = True
    alert.acknowledged_by = payload.operator_name
    alert.acknowledged_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(alert)

    logger.info(f"Emergency units dispatched for accident Alert #{alert.id} by {payload.operator_name}")
    return alert.to_dict()


@router.get("/accident-models/config")
def get_accident_models_config():
    models_dir = get_data_path("models/accident_detection")
    available_models = []
    if os.path.exists(models_dir):
        for f in os.listdir(models_dir):
            if f.endswith(".pt"):
                full_path = os.path.join(models_dir, f)
                size_mb = os.path.getsize(full_path) / (1024 * 1024)
                available_models.append({
                    "name": f,
                    "path": f"models/accident_detection/{f}",
                    "size_mb": round(size_mb, 2)
                })

    detector = get_accident_detector()
    return {
        "active_model": detector.model_path,
        "available_models": available_models,
    }


@router.post("/accident-models/switch")
def switch_accident_model(payload: AccidentModelSwitchRequest):
    detector = get_accident_detector(model_path=payload.model_path)
    return {
        "status": "success",
        "active_model": detector.model_path
    }
