from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import VideoAsset
from app.db.session import get_db
from app.detection.detector import DetectionService, resolve_standardized_video_path

router = APIRouter(prefix="/api/v1", tags=["detection"])


class DetectionServiceInfo(BaseModel):
    model_path: str
    confidence_threshold: float
    iou_threshold: float
    max_frames: int
    model_ready: bool


class DetectionRunResponse(BaseModel):
    video_id: str
    camera_id: str
    model_path: str
    video_path: str
    frame_count: int
    fps: float
    frame_detections: list[dict]
    tracklets: list[dict]
    artifact_path: str


class DetectionRunRequest(BaseModel):
    force: bool = Field(default=False, description="Re-run detection even if an artifact already exists.")


@router.get("/detection/model", response_model=DetectionServiceInfo)
def get_detection_model_info() -> DetectionServiceInfo:
    settings = get_settings()
    model_path = settings.detection_model_path
    resolved_path = Path(model_path)
    if not resolved_path.is_absolute():
        resolved_path = Path(__file__).resolve().parents[2] / resolved_path
    return DetectionServiceInfo(
        model_path=model_path,
        confidence_threshold=settings.detection_confidence_threshold,
        iou_threshold=settings.detection_iou_threshold,
        max_frames=settings.detection_max_frames,
        model_ready=resolved_path.exists(),
    )


@router.post("/videos/{video_id}/detections", response_model=DetectionRunResponse)
def run_video_detections(
    video_id: str,
    payload: DetectionRunRequest,
    db: Session = Depends(get_db),
) -> DetectionRunResponse:
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_dir = os.path.join("./data/processed", "detections", video_id)
    artifact_path = os.path.join(artifact_dir, "detections.json")
    if os.path.exists(artifact_path) and not payload.force:
        with open(artifact_path, "r", encoding="utf-8") as handle:
            return DetectionRunResponse.model_validate_json(handle.read())

    try:
        video_path = resolve_standardized_video_path(video)
        service = DetectionService()
        result = service.analyze_video(
            video_path=video_path,
            output_dir=artifact_dir,
            camera_id=video.camera_id,
            video_id=video.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return DetectionRunResponse.model_validate(result.to_dict())


@router.get("/videos/{video_id}/detections", response_model=DetectionRunResponse)
def get_video_detections(video_id: str, db: Session = Depends(get_db)) -> DetectionRunResponse:
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_path = os.path.join("./data/processed", "detections", video_id, "detections.json")
    if not os.path.exists(artifact_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No detection artifact found for video '{video_id}'. Run detection first.",
        )

    with open(artifact_path, "r", encoding="utf-8") as handle:
        return DetectionRunResponse.model_validate_json(handle.read())
