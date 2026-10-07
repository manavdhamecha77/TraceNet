"""
Automatic License Plate Recognition (ANPR) API endpoints.
Analyzes videos for license plates, stores sightings, and manages a plate
watchlist that raises alerts (and triggers webhooks) on a match.
"""

import json
import os
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import Alert, VideoAsset, CameraProfile, LicensePlateDetection, PlateWatchlistEntry
from app.detection.plate_detector import get_plate_detector, PlateDetector
from app.config import get_data_path
from app.preprocess.preprocessor import sanitize_filename
from app.notifications import get_webhook_manager

router = APIRouter(prefix="/api/v1", tags=["anpr"])


class PlateAnalysisRequest(BaseModel):
    video_id: str
    camera_id: str


class PlateSighting(BaseModel):
    plate_text: str
    confidence: float
    timestamp_seconds: float
    is_watchlisted: bool


class PlateAnalysisResponse(BaseModel):
    video_id: str
    camera_id: str
    plates_detected: int
    watchlist_hits: int
    sightings: List[PlateSighting]


class WatchlistCreateRequest(BaseModel):
    plate_number: str
    reason: Optional[str] = None
    priority: str = "HIGH"
    notes: Optional[str] = None
    created_by: Optional[str] = None


class WatchlistUpdateRequest(BaseModel):
    reason: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


def _resolve_video_path(db: Session, video: VideoAsset, camera_id: str) -> str:
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    camera_name = camera.name if camera else camera_id
    camera_dir_name = f"{camera_id}_{sanitize_filename(camera_name)}"
    camera_dir = get_data_path(os.path.join("cameras", camera_dir_name))
    return os.path.join(camera_dir, "original_assets", video.standardized_filename)


@router.post("/anpr/analyze-video", response_model=PlateAnalysisResponse)
def analyze_video_for_plates(
    request: PlateAnalysisRequest,
    db: Session = Depends(get_db)
) -> PlateAnalysisResponse:
    """Scan a video for license plates and check hits against the watchlist."""
    video = db.query(VideoAsset).filter(VideoAsset.id == request.video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video {request.video_id} not found"
        )

    video_path = _resolve_video_path(db, video, request.camera_id)
    if not os.path.exists(video_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video file not found at {video_path}"
        )

    try:
        detector = get_plate_detector()
        cutout_dir = get_data_path(os.path.join("cameras", request.camera_id, "plate_cutouts"))
        result = detector.detect_video(video_path, cutout_dir=cutout_dir)

        active_watchlist = {
            entry.plate_number: entry
            for entry in db.query(PlateWatchlistEntry).filter(
                PlateWatchlistEntry.status == "active"
            ).all()
        }

        sightings: List[PlateSighting] = []
        watchlist_hits = 0

        for plate in result["plates"]:
            plate_text = plate["plate_text"]
            watchlist_entry = active_watchlist.get(plate_text)
            is_watchlisted = watchlist_entry is not None

            detection_row = LicensePlateDetection(
                id=str(uuid.uuid4()),
                video_id=request.video_id,
                camera_id=request.camera_id,
                frame_number=plate["frame_number"],
                timestamp_seconds=plate["timestamp_seconds"],
                plate_text=plate_text,
                confidence=plate["confidence"],
                bbox=json.dumps(plate["bbox"]),
                cutout_path=plate["cutout_path"],
                is_watchlisted=is_watchlisted,
            )
            db.add(detection_row)

            if is_watchlisted:
                watchlist_hits += 1
                try:
                    alert = Alert(
                        alert_type="anpr_watchlist",
                        camera_id=request.camera_id,
                        tracklet_id=request.video_id,
                        video_id=request.video_id,
                        analysis_log=json.dumps({
                            "plate_text": plate_text,
                            "confidence": plate["confidence"],
                            "watchlist_reason": watchlist_entry.reason,
                        }),
                        timestamp=datetime.utcnow(),
                    )
                    db.add(alert)
                    db.flush()
                    detection_row.alert_id = alert.id

                    watchlist_entry.match_count = (watchlist_entry.match_count or 0) + 1
                    watchlist_entry.last_matched_at = datetime.utcnow()

                    get_webhook_manager().trigger_webhooks(
                        alert_type="anpr_watchlist",
                        camera_id=request.camera_id,
                        video_id=request.video_id,
                        assault_type=plate_text,
                        confidence=plate["confidence"],
                        timestamp=datetime.utcnow().isoformat(),
                        alert_id=alert.id,
                    )
                except Exception as e:
                    logger.error(f"Failed to create watchlist alert for plate {plate_text}: {e}")

            sightings.append(PlateSighting(
                plate_text=plate_text,
                confidence=plate["confidence"],
                timestamp_seconds=plate["timestamp_seconds"],
                is_watchlisted=is_watchlisted,
            ))

        db.commit()

        return PlateAnalysisResponse(
            video_id=request.video_id,
            camera_id=request.camera_id,
            plates_detected=len(sightings),
            watchlist_hits=watchlist_hits,
            sightings=sightings,
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Plate detection error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Plate detection failed: {str(e)}"
        )


@router.post("/anpr/batch-analyze", response_model=List[PlateAnalysisResponse])
def batch_analyze_videos(
    video_ids: List[str],
    camera_id: str,
    db: Session = Depends(get_db)
) -> List[PlateAnalysisResponse]:
    """Analyze multiple videos for license plates."""
    results = []
    for video_id in video_ids:
        try:
            result = analyze_video_for_plates(
                PlateAnalysisRequest(video_id=video_id, camera_id=camera_id),
                db
            )
            results.append(result)
        except Exception as e:
            logger.error(f"Error analyzing video {video_id} for plates: {e}")

    return results


@router.get("/anpr/detections")
def list_plate_detections(
    limit: int = 50,
    offset: int = 0,
    camera_id: Optional[str] = None,
    plate_text: Optional[str] = None,
    watchlist_only: bool = False,
    db: Session = Depends(get_db)
):
    """List stored license plate sightings."""
    query = db.query(LicensePlateDetection)

    if camera_id:
        query = query.filter(LicensePlateDetection.camera_id == camera_id)
    if plate_text:
        query = query.filter(LicensePlateDetection.plate_text.like(f"%{plate_text.upper()}%"))
    if watchlist_only:
        query = query.filter(LicensePlateDetection.is_watchlisted == True)

    query = query.order_by(LicensePlateDetection.created_at.desc())

    total = query.count()
    detections = query.limit(limit).offset(offset).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "detections": [d.to_dict() for d in detections],
    }


@router.get("/anpr/statistics")
def get_plate_detection_statistics(
    days: int = 7,
    camera_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get ANPR detection statistics."""
    start_date = datetime.utcnow() - timedelta(days=days)

    query = db.query(LicensePlateDetection).filter(
        LicensePlateDetection.created_at >= start_date
    )
    if camera_id:
        query = query.filter(LicensePlateDetection.camera_id == camera_id)

    detections = query.all()

    unique_plates = {d.plate_text for d in detections}
    watchlist_hits = sum(1 for d in detections if d.is_watchlisted)
    avg_confidence = (
        sum(d.confidence or 0.0 for d in detections) / len(detections)
        if detections else 0.0
    )

    return {
        "total_detections": len(detections),
        "unique_plates": len(unique_plates),
        "watchlist_hits": watchlist_hits,
        "average_confidence": round(avg_confidence, 4),
    }


@router.get("/anpr/model/status")
@router.post("/anpr/model/status")
def get_model_status():
    """Check if the license plate detector is loaded and ready."""
    try:
        detector: PlateDetector = get_plate_detector()
        is_loaded = detector.model is not None

        return {
            "model_loaded": is_loaded,
            "model_path": detector.model_path,
            "vehicle_model_loaded": detector.vehicle_model is not None,
            "vehicle_model_path": detector.vehicle_model_path if os.path.exists(detector.vehicle_model_path) else None,
            "ocr_model": detector.ocr_model_name,
            "device": detector.device if is_loaded else "not_loaded",
            "confidence_threshold": detector.confidence_threshold,
        }
    except Exception as e:
        return {
            "model_loaded": False,
            "error": str(e)
        }


@router.post("/anpr/watchlist")
def add_watchlist_entry(request: WatchlistCreateRequest, db: Session = Depends(get_db)):
    """Add a plate number to the watchlist."""
    normalized = PlateDetector._clean_plate_text(request.plate_number)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid plate number")

    entry = PlateWatchlistEntry(
        id=str(uuid.uuid4()),
        plate_number=normalized,
        reason=request.reason,
        priority=request.priority,
        notes=request.notes,
        created_by=request.created_by,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.get("/anpr/watchlist")
def list_watchlist(status_filter: Optional[str] = "active", db: Session = Depends(get_db)):
    """List watchlist entries, optionally filtered by status."""
    query = db.query(PlateWatchlistEntry)
    if status_filter:
        query = query.filter(PlateWatchlistEntry.status == status_filter)
    entries = query.order_by(PlateWatchlistEntry.created_at.desc()).all()
    return [e.to_dict() for e in entries]


@router.put("/anpr/watchlist/{entry_id}")
def update_watchlist_entry(entry_id: str, request: WatchlistUpdateRequest, db: Session = Depends(get_db)):
    """Update a watchlist entry's status, priority, reason, or notes."""
    entry = db.query(PlateWatchlistEntry).filter(PlateWatchlistEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Watchlist entry {entry_id} not found")

    if request.reason is not None:
        entry.reason = request.reason
    if request.priority is not None:
        entry.priority = request.priority
    if request.status is not None:
        entry.status = request.status
    if request.notes is not None:
        entry.notes = request.notes

    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.delete("/anpr/watchlist/{entry_id}")
def delete_watchlist_entry(entry_id: str, db: Session = Depends(get_db)):
    """Remove a watchlist entry."""
    entry = db.query(PlateWatchlistEntry).filter(PlateWatchlistEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Watchlist entry {entry_id} not found")

    db.delete(entry)
    db.commit()
    return {"status": "deleted", "watchlist_id": entry_id}
