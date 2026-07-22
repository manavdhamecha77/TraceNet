from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import json

from app.db.session import get_db, SessionLocal
from app.db.models import Alert, VideoAsset, CameraProfile, MLModel
from app.alerts.abandoned_object import AbandonedObjectAnalyzer
from loguru import logger

router = APIRouter(prefix="/api/v1", tags=["alerts"])


# -------------------------------------------------------
# Pydantic schemas
# -------------------------------------------------------

class AlertResponse(BaseModel):
    id: int
    alert_type: str
    camera_id: str
    tracklet_id: str
    video_id: Optional[str] = None
    object_tracklet_id: Optional[str] = None
    owner_tracklet_ids: List[str] = []
    visitor_tracklet_ids: List[str] = []
    reid_match_tracklet_id: Optional[str] = None
    abandon_duration_seconds: Optional[float] = None
    analysis_log: Optional[str] = None
    timestamp: Optional[str] = None
    acknowledged: bool

    class Config:
        from_attributes = True


class AbandonedAnalysisConfig(BaseModel):
    abandon_time_sec: float = 15.0
    visitor_dist_px: int = 150
    owner_bind_dist_px: int = 80
    abandon_dist_px: int = 200
    stationary_tolerance_px: int = 15
    stationary_time_sec: float = 2.0
    occlusion_grace_frames: int = 30


class TriggerAnalysisResponse(BaseModel):
    status: str
    video_id: str
    message: str


class AnalysisLogEntry(BaseModel):
    video_id: str
    video_name: str
    camera_name: str
    eligible: bool
    skip_reason: Optional[str] = None
    alerts_created: int
    log_entries: List[str]
    status: str  # 'running' | 'complete' | 'skipped' | 'error'


# In-memory log store for current run (reset on each trigger-all call)
_analysis_run_log: List[dict] = []


# -------------------------------------------------------
# CRUD
# -------------------------------------------------------

@router.get("/alerts", response_model=List[AlertResponse])
def list_alerts(
    camera_id: Optional[str] = None,
    alert_type: Optional[str] = None,
    acknowledged: Optional[bool] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(Alert)
    if camera_id:
        query = query.filter(Alert.camera_id == camera_id)
    if alert_type:
        query = query.filter(Alert.alert_type == alert_type)
    if acknowledged is not None:
        query = query.filter(Alert.acknowledged == acknowledged)
    alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
    return [a.to_dict() for a in alerts]


@router.put("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    alert.acknowledged = True
    db.commit()
    return alert.to_dict()


@router.get("/alerts/summary")
def get_alerts_summary(db: Session = Depends(get_db)):
    total = db.query(Alert).count()
    unack = db.query(Alert).filter(Alert.acknowledged == False).count()
    alert_types = {}
    for row in db.query(Alert.alert_type).distinct():
        alert_types[row[0]] = db.query(Alert).filter(Alert.alert_type == row[0]).count()
    return {"total_alerts": total, "unacknowledged_alerts": unack, "by_type": alert_types}


# -------------------------------------------------------
# Analysis run endpoints
# -------------------------------------------------------

@router.post("/alerts/trigger-all")
def trigger_abandoned_analysis_all(
    background_tasks: BackgroundTasks,
    config: AbandonedAnalysisConfig = None,
    db: Session = Depends(get_db),
):
    """Triggers abandoned object analysis on all eligible complete videos
    whose cameras have participate_in_alerts=True."""
    if config is None:
        config = AbandonedAnalysisConfig()

    # Collect eligible video IDs
    cameras = db.query(CameraProfile).filter(
        CameraProfile.participate_in_alerts == True
    ).all()
    camera_ids = [c.camera_id for c in cameras]

    videos = db.query(VideoAsset).filter(
        VideoAsset.camera_id.in_(camera_ids),
        VideoAsset.processing_status == "complete",
        VideoAsset.is_bin == False,
    ).all()

    video_ids = [v.id for v in videos]
    logger.info(f"[AlertTrigger] Scheduling analysis for {len(video_ids)} videos.")

    global _analysis_run_log
    _analysis_run_log = []

    background_tasks.add_task(_run_analysis_background, video_ids, config.dict())

    return {
        "status": "started",
        "video_count": len(video_ids),
        "message": f"Analysis started for {len(video_ids)} eligible videos.",
    }


@router.post("/alerts/trigger/{video_id}")
def trigger_abandoned_analysis_single(
    video_id: str,
    background_tasks: BackgroundTasks,
    config: AbandonedAnalysisConfig = None,
    db: Session = Depends(get_db),
):
    """Triggers abandoned object analysis on a single video."""
    if config is None:
        config = AbandonedAnalysisConfig()

    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")
    if video.processing_status != "complete":
        raise HTTPException(status_code=400, detail="Video is not fully processed yet.")
    if video.is_bin:
        raise HTTPException(status_code=400, detail="Cannot analyze a binned video.")

    global _analysis_run_log
    _analysis_run_log = []

    background_tasks.add_task(_run_analysis_background, [video_id], config.dict())
    return {"status": "started", "video_id": video_id, "message": "Analysis started."}


@router.get("/alerts/analysis-log")
def get_analysis_log():
    """Returns the current/latest analysis run log."""
    return {"entries": _analysis_run_log}


def _run_analysis_background(video_ids: list, config_dict: dict):
    global _analysis_run_log
    db = SessionLocal()
    try:
        analyzer = AbandonedObjectAnalyzer(**config_dict)
        for video_id in video_ids:
            try:
                video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
                if not video:
                    continue
                camera = db.query(CameraProfile).filter(
                    CameraProfile.camera_id == video.camera_id
                ).first()
                model_classes = []
                if camera and camera.model_id:
                    model = db.query(MLModel).filter(MLModel.id == camera.model_id).first()
                    if model:
                        try:
                            model_classes = json.loads(model.classes) if model.classes else []
                        except Exception:
                            model_classes = []

                log_entry = {
                    "video_id": video_id,
                    "video_name": video.original_filename,
                    "camera_name": camera.name if camera else video.camera_id,
                    "status": "running",
                    "eligible": False,
                    "skip_reason": None,
                    "alerts_created": 0,
                    "log_entries": [],
                }
                _analysis_run_log.append(log_entry)

                result = analyzer.analyze_video(
                    video_id=video_id,
                    model_classes=model_classes,
                    db=db,
                )

                # Patch camera_id on created alerts (analyzer can't know it)
                if result["alerts_created"] > 0 and camera:
                    db.query(Alert).filter(
                        Alert.video_id == video_id,
                        Alert.camera_id == ""
                    ).update({"camera_id": camera.camera_id})
                    db.commit()

                log_entry.update({
                    "status": "skipped" if not result["eligible"] else "complete",
                    "eligible": result["eligible"],
                    "skip_reason": result["skip_reason"],
                    "alerts_created": result["alerts_created"],
                    "log_entries": result["log_entries"],
                })

            except Exception as e:
                logger.error(f"Analysis failed for video {video_id}: {e}")
                for entry in _analysis_run_log:
                    if entry["video_id"] == video_id:
                        entry["status"] = "error"
                        entry["log_entries"] = [f"[ERROR] {str(e)}"]
    finally:
        db.close()
