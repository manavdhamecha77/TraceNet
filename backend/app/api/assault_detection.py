"""
Assault Detection API endpoints for analyzing videos for fight/violence incidents.
"""

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import json
import os
import tempfile
import threading
import time
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
    alert_id: Optional[int] = None
    peak_timestamp_seconds: Optional[float] = None
    windows_analyzed: int = 0
    windows_flagged: int = 0
    windows: list = []


class AssaultAnalysisResponse(BaseModel):
    total_videos_analyzed: int
    assaults_detected: int
    high_confidence_assaults: int
    assault_types: dict
    average_confidence: float


_scan_lock = threading.Lock()  # one VideoMAE scan at a time (shared GPU model)


def _alert_details(alert: Alert) -> dict:
    try:
        return json.loads(alert.analysis_log) if alert.analysis_log else {}
    except Exception:
        return {}


def run_assault_scan(db: Session, video: VideoAsset) -> dict:
    """Scan one video with VideoMAE and record (or refresh) its assault alert. Shared by the API,
    the Copilot tool and frame inspection."""
    from app.detection.detector import resolve_standardized_video_path

    from app.db.models import CameraProfile, MLModel, ModelExecutionLog
    from app.detection.assault_detector import REGISTRY_ID

    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == video.camera_id).first()
    if camera is not None and camera.assault_model_id == "OFF":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Assault detection is turned off for camera {camera.name or camera.camera_id} "
                                   "(Cameras -> Edit -> Assault Detection ML Model).")
    video_path = resolve_standardized_video_path(video)
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Video file for {video.id} not found")
    detector = get_assault_detector()
    started = time.time()
    with _scan_lock:
        result = detector.predict_with_frames(video_path)
    if not result.get("error") and db.query(MLModel).filter(MLModel.id == REGISTRY_ID).first():
        try:  # Models page: execution log + last used, like the detectors
            db.add(ModelExecutionLog(model_id=REGISTRY_ID, video_id=video.id, camera_id=video.camera_id,
                                     frames_processed=int(result.get("frames_analyzed", 0)) * detector.num_frames,
                                     inference_duration_seconds=round(time.time() - started, 2),
                                     objects_detected_count=int(result.get("windows_flagged", 0))))
            db.query(MLModel).filter(MLModel.id == REGISTRY_ID).update({"last_used_timestamp": datetime.utcnow()})
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning(f"Assault scan: could not write the model execution log: {exc}")
    if result.get("error"):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Assault detection failed: {result['error']}")
    windows = result.pop("frame_results", [])
    details = {
        "assault_type": result["assault_type"],
        "confidence": round(result["confidence"], 4),
        "peak_timestamp_seconds": result.get("peak_timestamp_seconds"),
        "peak_window": result.get("peak_window"),
        "windows_analyzed": result.get("frames_analyzed", 0),
        "windows_flagged": result.get("windows_flagged", 0),
        "threshold": detector.confidence_threshold,
        "model": detector.model_name,
        # window timeline kept for frame inspection (no second scan needed)
        "windows": [{k: w[k] for k in ("frame_number", "timestamp_seconds", "start_seconds", "end_seconds",
                                       "class", "confidence", "top_label")} for w in windows],
    }
    alert_id = None
    if result["has_assault"]:
        alert = db.query(Alert).filter(Alert.alert_type == "assault", Alert.video_id == video.id).first()
        if alert is None:
            # tracklet_id is NOT NULL; a clip-level verdict has no tracklet, so it carries the video id
            alert = Alert(alert_type="assault", camera_id=video.camera_id, video_id=video.id,
                          tracklet_id=video.id, timestamp=datetime.utcnow())
            db.add(alert)
        alert.analysis_log = json.dumps(details)
        db.commit()
        alert_id = alert.id
        logger.info(f"Assault alert {alert_id} for video {video.id}: {details['assault_type']} "
                    f"{details['confidence']:.2f} at {details['peak_timestamp_seconds']}s")
    result.update({"alert_id": alert_id, "windows": details["windows"]})
    return result


@router.post("/assault-detection/analyze-video")
def analyze_video_for_assault(
    request: AssaultDetectionRequest,
    db: Session = Depends(get_db)
) -> AssaultDetectionResponse:
    """Scan a video with VideoMAE in 2-second windows; an alert is raised when a violent class
    (Assault, Fighting, Abuse, Robbery, Shooting) reaches the confidence threshold."""
    video = db.query(VideoAsset).filter(VideoAsset.id == request.video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video {request.video_id} not found"
        )
    result = run_assault_scan(db, video)
    if result["alert_id"] is not None:
        get_cache().delete(f"frame_inspection:{result['alert_id']}")  # a re-scan refreshes the timeline
    return AssaultDetectionResponse(
        video_id=video.id,
        camera_id=video.camera_id,
        has_assault=result["has_assault"],
        assault_type=result["assault_type"],
        confidence=result["confidence"],
        timestamp=datetime.utcnow().isoformat(),
        alert_created=result["alert_id"] is not None,
        alert_id=result["alert_id"],
        peak_timestamp_seconds=result.get("peak_timestamp_seconds"),
        windows_analyzed=result.get("frames_analyzed", 0),
        windows_flagged=result.get("windows_flagged", 0),
        windows=result.get("windows", []),
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
    details = [_alert_details(alert) for alert in alerts]
    high_confidence_count = sum(1 for d in details if (d.get("confidence") or 0.0) >= 0.7)

    # Count by type
    assault_types = {}
    for d in details:
        atype = d.get("assault_type", "unknown")
        assault_types[atype] = assault_types.get(atype, 0) + 1

    avg_confidence = (
        sum((d.get("confidence") or 0.0) for d in details) / len(details)
        if details else 0.0
    )

    response = AssaultAnalysisResponse(
        total_videos_analyzed=len(db.query(VideoAsset).filter(
            VideoAsset.upload_timestamp >= start_date
        ).all() if camera_id else db.query(VideoAsset).filter(
            VideoAsset.upload_timestamp >= start_date
        ).all()),
        assaults_detected=total_analyzed,
        high_confidence_assaults=high_confidence_count,
        assault_types=assault_types,
        average_confidence=float(avg_confidence)
    )

    # Short cache: new scans must show up quickly
    cache.set(cache_key, response, 30)

    return response


@router.get("/assault-detection/alerts")
def get_assault_alerts(
    limit: int = 50,
    offset: int = 0,
    camera_id: Optional[str] = None,
    acknowledged: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """Get all assault-related alerts."""
    query = db.query(Alert).filter(Alert.alert_type == "assault")

    if camera_id:
        query = query.filter(Alert.camera_id == camera_id)
    if acknowledged is not None:
        query = query.filter(Alert.acknowledged == acknowledged)

    query = query.order_by(Alert.timestamp.desc())

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
                "video_id": alert.video_id or alert.tracklet_id,
                "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
                "acknowledged": alert.acknowledged,
                "assault_type": _alert_details(alert).get("assault_type"),
                "confidence": _alert_details(alert).get("confidence"),
                "peak_timestamp_seconds": _alert_details(alert).get("peak_timestamp_seconds"),
            }
            for alert in alerts
        ]
    }


@router.get("/assault-detection/model/status")
@router.post("/assault-detection/model/status")
def get_model_status():
    """Check if assault detection model is loaded and ready."""
    try:
        detector = get_assault_detector()
        is_loaded = detector.model is not None

        return {
            "model_loaded": is_loaded,
            "weights_available": detector.weights_available(),
            "model_name": detector.model_name,
            "device": detector.device if is_loaded else "not_loaded",
            "confidence_threshold": detector.confidence_threshold,
            "violent_classes": detector.assault_classes,
            "labels": detector.labels,
        }
    except Exception as e:
        return {
            "model_loaded": False,
            "error": str(e)
        }
