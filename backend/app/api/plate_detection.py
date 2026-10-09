"""
Automatic License Plate Recognition (ANPR) API endpoints.

* Pipeline-read plates: one row per vehicle tracklet (see app/detection/vehicle_plates.py), searchable
  by recognised text (exact / estimate with edit distance 1-3).
* Manual video scan: still available; its sightings are linked to the vehicle tracklet they belong to
  and stored in the same table.
* Watchlist management and alerting.
* Switchable OCR engine (PaddleOCR PP-OCRv5 <-> lightweight fast-plate-ocr).
"""

import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import (
    CameraProfile,
    LicensePlateDetection,
    PlateWatchlistEntry,
    Tracklet,
    VideoAsset,
)
from app.attributes.color_extractor import canonical_object_type
from app.config import get_data_path
from app.detection import vehicle_plates
from app.detection.plate_alerts import active_watchlist, raise_watchlist_alert
from app.detection.plate_detector import PlateDetector, get_plate_detector
from app.detection.plate_ocr import get_active_engine_name, list_engines, set_active_engine
from app.preprocess.preprocessor import sanitize_filename
from app.search.plate_lookup import plates_for_tracklets
from app.search.plate_matching import MAX_ESTIMATE_DISTANCE, match_distance, normalize

router = APIRouter(prefix="/api/v1", tags=["anpr"])

# Rows that carry a recognised plate text (legacy rows have no status and are always readings)
READABLE = or_(LicensePlateDetection.plate_status == "read", LicensePlateDetection.plate_status.is_(None))


class PlateAnalysisRequest(BaseModel):
    video_id: str
    camera_id: str


class PlateSighting(BaseModel):
    plate_text: str
    confidence: float
    ocr_confidence: Optional[float] = None
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


class OcrSwitchRequest(BaseModel):
    engine: str


def _resolve_video_path(db: Session, video: VideoAsset, camera_id: str) -> str:
    from app.detection.detector import resolve_standardized_video_path
    return resolve_standardized_video_path(video)  # local, renamed-camera folder, or S3


# --------------------------------------------------------------------------- vehicle linking (manual scans)
class _VehicleIndex:
    """Per-frame vehicle boxes of a video, to find which vehicle tracklet a plate belongs to."""

    def __init__(self, frames: dict[int, list[tuple[str, list[float]]]]):
        self.frames = frames

    @classmethod
    def load(cls, video_id: str) -> "_VehicleIndex":
        path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
        frames: dict[int, list[tuple[str, list[float]]]] = {}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    artifact = json.load(handle)
                for frame in artifact.get("frame_detections", []):
                    boxes = [
                        (f"{video_id}_trk_{det['tracker_id']}", det["bbox"])
                        for det in frame.get("detections", [])
                        if det.get("tracker_id") is not None
                        and canonical_object_type(det.get("class_name"), det.get("object_type")) == "vehicle"
                    ]
                    if boxes:
                        frames[int(frame["frame_index"])] = boxes
            except Exception as exc:
                logger.warning(f"Could not load vehicle index for {video_id}: {exc}")
        return cls(frames)

    def find(self, frame_number: Optional[int], plate_bbox: List[int]) -> Optional[str]:
        if frame_number is None or not self.frames:
            return None
        cx, cy = (plate_bbox[0] + plate_bbox[2]) / 2, (plate_bbox[1] + plate_bbox[3]) / 2
        for offset in (0, -1, 1, -2, 2):
            boxes = self.frames.get(frame_number + offset)
            if not boxes:
                continue
            containing = [
                (tid, (b[2] - b[0]) * (b[3] - b[1])) for tid, b in boxes if b[0] <= cx <= b[2] and b[1] <= cy <= b[3]
            ]
            if containing:
                return min(containing, key=lambda item: item[1])[0]  # innermost vehicle
        return None


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

        watchlist = active_watchlist(db)
        vehicle_index = _VehicleIndex.load(request.video_id)
        engine_key = get_active_engine_name()

        sightings: List[PlateSighting] = []
        watchlist_hits = 0

        for plate in result["plates"]:
            plate_text = plate["plate_text"]
            tracklet_id = vehicle_index.find(plate["frame_number"], plate["bbox"])
            score = plate["confidence"] * plate.get("ocr_confidence", 1.0)

            row = None
            keep_stored = False
            if tracklet_id:
                # One row per vehicle: replace what is stored only if this reading is better.
                row = db.query(LicensePlateDetection).filter(
                    LicensePlateDetection.tracklet_id == tracklet_id
                ).order_by(LicensePlateDetection.created_at.desc()).first()
                keep_stored = (
                    row is not None
                    and row.plate_status == "read"
                    and (row.confidence or 0.0) * (row.ocr_confidence or 1.0) >= score
                )

            if row is None:
                row = LicensePlateDetection(
                    id=vehicle_plates.plate_row_id(tracklet_id) if tracklet_id else str(uuid.uuid4())
                )
                db.add(row)

            if not keep_stored:
                row.video_id = request.video_id
                row.camera_id = request.camera_id
                row.tracklet_id = tracklet_id
                row.frame_number = plate["frame_number"]
                row.timestamp_seconds = plate["timestamp_seconds"]
                row.plate_text = plate_text
                row.plate_status = "read"
                row.confidence = plate["confidence"]
                row.ocr_confidence = plate.get("ocr_confidence")
                row.ocr_engine = engine_key
                row.bbox = json.dumps(plate["bbox"])
                row.cutout_path = plate["cutout_path"]

            entry = watchlist.get(row.plate_text)
            row.is_watchlisted = entry is not None
            if entry is not None:
                watchlist_hits += 1
                if row.alert_id is None:
                    alert = raise_watchlist_alert(
                        db, entry, plate_text=row.plate_text, confidence=plate["confidence"],
                        camera_id=request.camera_id, video_id=request.video_id, tracklet_id=tracklet_id,
                    )
                    if alert is not None:
                        row.alert_id = alert.id

            sightings.append(PlateSighting(
                plate_text=plate_text,
                confidence=plate["confidence"],
                ocr_confidence=plate.get("ocr_confidence"),
                timestamp_seconds=plate["timestamp_seconds"],
                is_watchlisted=entry is not None,
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
    """List stored license plate sightings (recognised plates only)."""
    query = db.query(LicensePlateDetection).filter(READABLE)

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

    rows = query.all()
    detections = [d for d in rows if (d.plate_status or "read") == "read"]

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
        "blurry_plates": sum(1 for d in rows if d.plate_status == "blurry"),
        "vehicles_without_plate": sum(1 for d in rows if d.plate_status == "not_detected"),
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
            "ocr_engine": get_active_engine_name(),
            "ocr_loaded": detector.ocr_engine.loaded,
            "ocr_min_confidence": detector.ocr_min_confidence,
            "device": detector.device if is_loaded else "not_loaded",
            "confidence_threshold": detector.confidence_threshold,
        }
    except Exception as e:
        return {
            "model_loaded": False,
            "error": str(e)
        }


# --------------------------------------------------------------------------- OCR engine selection
@router.get("/anpr/ocr/config")
def get_ocr_config():
    """Active OCR engine and the engines that can be switched to."""
    return {"active": get_active_engine_name(), "engines": list_engines()}


@router.post("/anpr/ocr/switch")
def switch_ocr_engine(request: OcrSwitchRequest):
    """
    Switch the global OCR engine (persisted). Affects plates read from now on; existing vehicles keep
    their readings until a backfill with force=true re-reads them.
    """
    previous = get_active_engine_name()
    try:
        engine = set_active_engine(request.engine)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    try:
        engine.load()  # surface download / load problems now rather than during the next ingest
    except Exception as exc:
        try:
            set_active_engine(previous, force=True)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load OCR engine '{request.engine}': {exc}",
        )
    return {"active": get_active_engine_name(), "engines": list_engines()}


# --------------------------------------------------------------------------- plate search & vehicle listing
def _crop_url(path: Optional[str]) -> str:
    normalized = (path or "").replace("\\", "/")
    index = normalized.find("/data/")
    return normalized[index:] if index != -1 else ""


def _vehicle_info(tracklet: Tracklet) -> dict[str, Any]:
    video = tracklet.video
    camera = video.camera if video else None
    ref_time = (video.start_time or video.upload_timestamp) if video else None
    try:
        best_bbox = json.loads(tracklet.best_bbox) if tracklet.best_bbox else []
    except Exception:
        best_bbox = []
    return {
        "tracklet_id": tracklet.id,
        "tracker_id": tracklet.tracker_id,
        "video_id": tracklet.video_id,
        "camera_id": tracklet.camera_id,
        "camera_name": camera.name if camera else tracklet.camera_id,
        "object_type": tracklet.object_type,
        "class_name": tracklet.class_name,
        "frame_start": tracklet.frame_start,
        "frame_end": tracklet.frame_end,
        "timestamp_start_seconds": tracklet.timestamp_start_seconds,
        "timestamp_end_seconds": tracklet.timestamp_end_seconds,
        "best_crop_path": _crop_url(tracklet.best_crop_path),
        "best_bbox": best_bbox,
        "mean_confidence": tracklet.mean_confidence,
        "video_original_filename": video.original_filename if video else "",
        "video_standardized_filename": video.standardized_filename if video else "",
        "video_start_time": ref_time.isoformat() if ref_time else None,
        "video_thumbnail_path": (video.thumbnail_path or "") if video else "",
    }


def _with_vehicles(db: Session, rows: list[LicensePlateDetection]) -> dict[str, Tracklet]:
    ids = [r.tracklet_id for r in rows if r.tracklet_id]
    if not ids:
        return {}
    return {t.id: t for t in db.query(Tracklet).filter(Tracklet.id.in_(ids)).all()}


@router.get("/anpr/search")
def search_vehicles_by_plate(
    q: str = Query("", description="Plate text to look for (case/spacing/punctuation are ignored)"),
    mode: str = Query("exact", pattern="^(exact|estimate)$"),
    max_distance: int = Query(MAX_ESTIMATE_DISTANCE, ge=0, le=MAX_ESTIMATE_DISTANCE),
    partial: bool = Query(False, description="Match the text anywhere inside the plate"),
    camera_id: Optional[str] = None,
    video_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=300),
    db: Session = Depends(get_db),
):
    """
    Find vehicles by the TEXT recognised on their number plate.

    exact    -> whole plate equals the query (or contains it when ``partial``)
    estimate -> plates within edit distance 1..``max_distance`` of the query as well, nearest first
    """
    query_text = normalize(q)
    base = {
        "query": q, "normalized": query_text, "mode": mode, "partial": partial,
        "max_distance": max_distance if mode == "estimate" else 0,
    }
    if not query_text:
        return {**base, "total": 0, "counts_by_distance": {}, "results": []}

    rows_query = db.query(LicensePlateDetection).filter(READABLE, LicensePlateDetection.plate_text != "")
    if camera_id:
        rows_query = rows_query.filter(LicensePlateDetection.camera_id == camera_id)
    if video_id:
        rows_query = rows_query.filter(LicensePlateDetection.video_id == video_id)

    matches: list[tuple[int, LicensePlateDetection]] = []
    for row in rows_query.all():
        distance = match_distance(query_text, normalize(row.plate_text), mode, partial, max_distance)
        if distance is not None:
            matches.append((distance, row))
    matches.sort(key=lambda m: (m[0], -(m[1].ocr_confidence or 0.0), m[1].plate_text))

    counts: dict[str, int] = {}
    for distance, _ in matches:
        counts[str(distance)] = counts.get(str(distance), 0) + 1

    page = matches[:limit]
    tracklets = _with_vehicles(db, [row for _, row in page])
    results = [
        {
            "distance": distance,
            "plate": row.to_dict(),
            "vehicle": _vehicle_info(tracklets[row.tracklet_id]) if row.tracklet_id in tracklets else None,
        }
        for distance, row in page
    ]
    return {**base, "total": len(matches), "counts_by_distance": counts, "results": results}


@router.get("/anpr/vehicles")
def list_vehicles_by_plate_status(
    plate_status: str = Query("blurry", pattern="^(read|blurry|not_detected)$"),
    camera_id: Optional[str] = None,
    video_id: Optional[str] = None,
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Browse vehicles by plate status. Mainly for plates the text search cannot cover: 'blurry' lists
    vehicles whose plate was found but is unreadable, with the cutout for a human to inspect.
    """
    query = db.query(LicensePlateDetection).filter(
        LicensePlateDetection.tracklet_id.isnot(None), LicensePlateDetection.plate_status == plate_status
    )
    if camera_id:
        query = query.filter(LicensePlateDetection.camera_id == camera_id)
    if video_id:
        query = query.filter(LicensePlateDetection.video_id == video_id)

    total = query.count()
    rows = query.order_by(LicensePlateDetection.created_at.desc()).offset(offset).limit(limit).all()
    tracklets = _with_vehicles(db, rows)
    return {
        "plate_status": plate_status,
        "total": total,
        "results": [
            {
                "distance": None,
                "plate": row.to_dict(),
                "vehicle": _vehicle_info(tracklets[row.tracklet_id]) if row.tracklet_id in tracklets else None,
            }
            for row in rows
        ],
    }


@router.get("/videos/{video_id}/plates")
def get_video_plates(video_id: str, db: Session = Depends(get_db)):
    """
    Plate info for every tracklet of a video: {tracklet_id: plate payload | null}.
    null = not a vehicle; vehicles without a stored result report status 'not_scanned'.
    """
    tracklets = db.query(Tracklet).filter(Tracklet.video_id == video_id).all()
    return plates_for_tracklets(db, tracklets)


# --------------------------------------------------------------------------- backfill for existing footage
@router.post("/anpr/backfill", status_code=status.HTTP_202_ACCEPTED)
def start_plate_backfill(force: bool = False, video_id: Optional[str] = None):
    """
    Read plates for vehicles in already-processed videos (background job).
    ``force=true`` re-reads every vehicle, e.g. after switching the OCR engine.
    """
    if not vehicle_plates.start_backfill(force=force, video_id=video_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A plate backfill is already running")
    return vehicle_plates.backfill_status()


@router.get("/anpr/backfill/status")
def plate_backfill_status():
    return vehicle_plates.backfill_status()


# --------------------------------------------------------------------------- watchlist
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
