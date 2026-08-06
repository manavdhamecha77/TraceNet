"""
Frame-level inspection API for assault detection results.
Provides detailed frame-by-frame analysis and visualization for detected assaults.
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from loguru import logger

from app.db.session import SessionLocal
from app.db.models import Alert, VideoAsset
from app.detection.assault_detector import get_assault_detector
from app.cache import get_cache

router = APIRouter(prefix="/api/v1", tags=["frame-inspection"])


class FrameInfo(BaseModel):
    frame_number: int
    timestamp_seconds: float
    confidence: float
    assault_type: str
    is_key_frame: bool


class FrameInspectionResponse(BaseModel):
    video_id: str
    camera_id: str
    alert_id: int
    has_assault: bool
    assault_type: str
    peak_confidence: float
    detected_frames: List[FrameInfo]
    total_frames_analyzed: int
    video_duration_seconds: float
    detection_timestamp: str


@router.get("/frame-inspection/alert/{alert_id}")
def get_frame_inspection(alert_id: int) -> FrameInspectionResponse:
    """
    Get detailed frame-level inspection data for an assault alert.
    Shows which frames triggered detection and confidence scores.
    """
    cache = get_cache()
    cache_key = f"frame_inspection:{alert_id}"

    cached = cache.get(cache_key)
    if cached:
        logger.info(f"Frame inspection cache hit for alert {alert_id}")
        return FrameInspectionResponse(**cached)

    try:
        db = SessionLocal()
        alert = db.query(Alert).filter(Alert.id == alert_id).first()

        if not alert:
            db.close()
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Alert {alert_id} not found"
            )

        if alert.alert_type != "assault":
            db.close()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Alert is not an assault detection"
            )

        # Get video details
        video = db.query(VideoAsset).filter(VideoAsset.id == alert.video_id).first()
        if not video:
            db.close()
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Video {alert.video_id} not found"
            )

        db.close()

        # Run frame-level analysis
        detector = get_assault_detector()
        frame_results = detector.predict_with_frames(video.standardized_filename)

        # Extract key frames with detections
        detected_frames = []
        peak_confidence = 0.0

        if frame_results.get("frame_results"):
            for frame_data in frame_results["frame_results"]:
                confidence = frame_data.get("confidence", 0.0)
                if confidence > 0.3:  # Include frames with >30% confidence
                    detected_frames.append(
                        FrameInfo(
                            frame_number=frame_data.get("frame_number", 0),
                            timestamp_seconds=frame_data.get("timestamp_seconds", 0.0),
                            confidence=confidence,
                            assault_type=frame_data.get("class", "unknown"),
                            is_key_frame=confidence > 0.6
                        )
                    )
                    peak_confidence = max(peak_confidence, confidence)

        response = FrameInspectionResponse(
            video_id=alert.video_id,
            camera_id=alert.camera_id,
            alert_id=alert_id,
            has_assault=frame_results.get("has_assault", False),
            assault_type=frame_results.get("assault_type", "unknown"),
            peak_confidence=peak_confidence,
            detected_frames=detected_frames,
            total_frames_analyzed=len(frame_results.get("frame_results", [])),
            video_duration_seconds=video.duration or 0.0,
            detection_timestamp=alert.timestamp.isoformat() if alert.timestamp else ""
        )

        # Cache for 1 hour
        cache.set(cache_key, response.model_dump(), ttl=3600)

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get frame inspection for alert {alert_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/frame-inspection/video/{video_id}")
def get_video_frame_analysis(video_id: str) -> List[FrameInspectionResponse]:
    """
    Get frame-level analysis for all assault alerts in a video.
    """
    try:
        db = SessionLocal()
        alerts = db.query(Alert).filter(
            Alert.video_id == video_id,
            Alert.alert_type == "assault"
        ).all()

        if not alerts:
            db.close()
            return []

        db.close()

        results = []
        for alert in alerts:
            try:
                response = get_frame_inspection(alert.id)
                results.append(response)
            except Exception as e:
                logger.warning(f"Failed to get frame inspection for alert {alert.id}: {e}")

        return results

    except Exception as e:
        logger.error(f"Failed to get video frame analysis: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/frame-inspection/camera/{camera_id}")
def get_camera_frame_alerts(
    camera_id: str,
    limit: int = 10,
    offset: int = 0
) -> List[FrameInspectionResponse]:
    """
    Get recent frame-level alerts for a specific camera.
    """
    try:
        db = SessionLocal()
        alerts = db.query(Alert).filter(
            Alert.camera_id == camera_id,
            Alert.alert_type == "assault"
        ).order_by(Alert.timestamp.desc()).offset(offset).limit(limit).all()

        db.close()

        results = []
        for alert in alerts:
            try:
                response = get_frame_inspection(alert.id)
                results.append(response)
            except Exception as e:
                logger.warning(f"Failed to get frame inspection for alert {alert.id}: {e}")

        return results

    except Exception as e:
        logger.error(f"Failed to get camera frame alerts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
