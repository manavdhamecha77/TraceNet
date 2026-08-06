"""
Assault Detection API endpoints for analyzing videos for fight/violence incidents.
"""

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import os
import tempfile
from loguru import logger

from app.db.session import get_db
from app.db.models import Alert, VideoAsset
from app.detection.assault_detector import get_assault_detector
from app.config import get_data_path
from app.cache import get_cache

router = APIRouter(prefix="/api/v1", tags=["assault-detection"])


class AssaultDetectionRequest(BaseModel):
    video_id: str
    camera_id: str


class AssaultDetectionResponse(BaseModel):
    video_id: str
    camera_id: str
    has_assault: bool
    assault_type: str
    confidence: float
    timestamp: str
    alert_created: bool


class AssaultAnalysisResponse(BaseModel):
    total_videos_analyzed: int
    assaults_detected: int
    high_confidence_assaults: int
    assault_types: dict
    average_confidence: float


@router.post("/assault-detection/analyze-video")
def analyze_video_for_assault(
    request: AssaultDetectionRequest,
    db: Session = Depends(get_db)
) -> AssaultDetectionResponse:
    """Analyze a video for assault/fight incidents."""
    cache = get_cache()

    # Check cache first
    cache_key = f"assault:{request.video_id}"
    cached_result = cache.get(cache_key)
    if cached_result:
        logger.info(f"Returning cached assault detection for {request.video_id}")
        return cached_result

    # Get video path
    video = db.query(VideoAsset).filter(VideoAsset.id == request.video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video {request.video_id} not found"
        )

    video_path = video.file_path or os.path.join(
        get_data_path(f"cameras/{request.camera_id}"),
        video.standardized_filename
    )

    if not os.path.exists(video_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video file not found at {video_path}"
        )

    try:
        # Run assault detection
        detector = get_assault_detector()
        detection_result = detector.predict(video_path)

        alert_created = False

        # Create alert if assault detected
        if detection_result.get("has_assault", False):
            try:
                alert = Alert(
                    alert_type="assault",
                    camera_id=request.camera_id,
                    tracklet_id=request.video_id,
                    timestamp=datetime.utcnow()
                )
                db.add(alert)
                db.commit()
                alert_created = True
                logger.info(f"Assault alert created for video {request.video_id}")
            except Exception as e:
                logger.error(f"Failed to create assault alert: {e}")
                db.rollback()

        response = AssaultDetectionResponse(
            video_id=request.video_id,
            camera_id=request.camera_id,
            has_assault=detection_result.get("has_assault", False),
            assault_type=detection_result.get("assault_type", "unknown"),
            confidence=detection_result.get("confidence", 0.0),
            timestamp=datetime.utcnow().isoformat(),
            alert_created=alert_created
        )

        # Cache for 1 hour
        cache.set(cache_key, response, 3600)

        return response

    except Exception as e:
        logger.error(f"Assault detection error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Assault detection failed: {str(e)}"
        )


@router.post("/assault-detection/batch-analyze")
def batch_analyze_videos(
    video_ids: List[str],
    camera_id: str,
    db: Session = Depends(get_db)
) -> List[AssaultDetectionResponse]:
    """Analyze multiple videos for assault incidents."""
    results = []
    for video_id in video_ids:
        try:
            result = analyze_video_for_assault(
                AssaultDetectionRequest(
                    video_id=video_id,
                    camera_id=camera_id
                ),
                db
            )
            results.append(result)
        except Exception as e:
            logger.error(f"Error analyzing video {video_id}: {e}")

    return results


@router.get("/assault-detection/statistics")
def get_assault_detection_statistics(
    days: int = 7,
    camera_id: Optional[str] = None,
    db: Session = Depends(get_db)
) -> AssaultAnalysisResponse:
    """Get assault detection statistics."""
    from datetime import timedelta

    cache = get_cache()
    cache_key = f"assault_stats:{camera_id or 'all'}:{days}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    start_date = datetime.utcnow() - timedelta(days=days)

    # Query assault alerts
    query = db.query(Alert).filter(
        Alert.alert_type == "assault",
        Alert.timestamp >= start_date
    )

    if camera_id:
        query = query.filter(Alert.camera_id == camera_id)

    alerts = query.all()

    # Analyze results
    total_analyzed = len(alerts)
    high_confidence_count = sum(
        1 for alert in alerts
        if hasattr(alert, 'confidence') and alert.confidence >= 0.7
    )

    # Count by type
    assault_types = {}
    for alert in alerts:
        atype = getattr(alert, 'assault_type', 'unknown')
        assault_types[atype] = assault_types.get(atype, 0) + 1

    avg_confidence = (
        sum(
            getattr(alert, 'confidence', 0.0)
            for alert in alerts
        ) / len(alerts)
        if alerts else 0.0
    )

    response = AssaultAnalysisResponse(
        total_videos_analyzed=len(db.query(VideoAsset).filter(
            VideoAsset.timestamp >= start_date
        ).all() if camera_id else db.query(VideoAsset).filter(
            VideoAsset.timestamp >= start_date
        ).all()),
        assaults_detected=total_analyzed,
        high_confidence_assaults=high_confidence_count,
        assault_types=assault_types,
        average_confidence=float(avg_confidence)
    )

    # Cache for 1 hour
    cache.set(cache_key, response, 3600)

    return response


@router.get("/assault-detection/alerts")
def get_assault_alerts(
    limit: int = 50,
    offset: int = 0,
    camera_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all assault-related alerts."""
    query = db.query(Alert).filter(Alert.alert_type == "assault").order_by(
        Alert.timestamp.desc()
    )

    if camera_id:
        query = query.filter(Alert.camera_id == camera_id)

    total = query.count()
    alerts = query.limit(limit).offset(offset).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "alerts": [
            {
                "id": alert.id,
                "camera_id": alert.camera_id,
                "video_id": alert.tracklet_id,
                "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
                "acknowledged": alert.acknowledged
            }
            for alert in alerts
        ]
    }


@router.post("/assault-detection/model/status")
def get_model_status():
    """Check if assault detection model is loaded and ready."""
    try:
        detector = get_assault_detector()
        is_loaded = detector.model is not None

        return {
            "model_loaded": is_loaded,
            "model_name": detector.model_name,
            "device": detector.device if is_loaded else "not_loaded",
            "confidence_threshold": detector.confidence_threshold
        }
    except Exception as e:
        return {
            "model_loaded": False,
            "error": str(e)
        }
