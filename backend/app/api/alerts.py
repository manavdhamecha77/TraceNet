import os
import json
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from loguru import logger

from app.db.session import get_db, SessionLocal
from app.db.models import Alert, VideoAsset, CameraProfile, MLModel
from app.alerts.abandoned_object import AbandonedObjectAnalyzer
from app.alerts.chain_snatching import ChainSnatchingAnalyzer
from app.config import get_data_path

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
    owner_bind_dist_px: int = 200
    abandon_dist_px: int = 200
    stationary_tolerance_px: int = 15
    stationary_time_sec: float = 2.0
    occlusion_grace_frames: int = 30


class ChainSnatchingAnalysisConfig(BaseModel):
    proximity_threshold_px: int = 120
    fall_aspect_ratio_trigger: float = 0.85
    fall_frame_window: int = 2
    chase_velocity_multiplier: float = 3.0
    chase_vector_cosine_sim: float = 0.75
    observation_window_frames: int = 4
    enable_kinematics: bool = False
    detection_threshold_frames: int = 4


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
    status: str  # 'pending' | 'running' | 'complete' | 'skipped' | 'error'
    progress_percentage: int = 0


# In-memory log store for current run (reset on each trigger-all call)
_analysis_run_log: List[dict] = []


# -------------------------------------------------------
# Configuration Persistence
# -------------------------------------------------------

CONFIG_FILE = get_data_path("alert_config.json")
CHAIN_SNATCHING_CONFIG_FILE = get_data_path("chain_snatching_config.json")


def load_persistent_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read alert config file: {e}")
    return AbandonedAnalysisConfig().dict()


def save_persistent_config(config_data: dict):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save alert config file: {e}")


def load_persistent_chain_snatching_config() -> dict:
    if os.path.exists(CHAIN_SNATCHING_CONFIG_FILE):
        try:
            with open(CHAIN_SNATCHING_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read chain snatching config file: {e}")
    return ChainSnatchingAnalysisConfig().dict()


def save_persistent_chain_snatching_config(config_data: dict):
    try:
        with open(CHAIN_SNATCHING_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save chain snatching config file: {e}")


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


@router.delete("/alerts/clear")
def clear_all_alerts(db: Session = Depends(get_db)):
    """Clears all stored alerts from DB and resets in-memory analysis logs."""
    global _analysis_run_log
    _analysis_run_log = []
    deleted_count = db.query(Alert).delete()
    db.commit()
    return {
        "status": "success",
        "deleted_count": deleted_count,
        "message": f"Successfully cleared {deleted_count} alert(s) and reset analysis logs.",
    }


# -------------------------------------------------------
# All Detected Objects (Missed detection backup review)
# -------------------------------------------------------

@router.get("/alerts/all-objects", response_model=List[dict])
def get_all_detected_objects(db: Session = Depends(get_db)):
    """Retrieves all detected tracklets of type 'object' or matching general luggage classes."""
    from app.alerts.abandoned_object import OBJECT_CLASS_NAMES
    from app.db.models import Tracklet, VideoAsset

    # Fetch tracklets for non-bin videos
    query = db.query(Tracklet).join(VideoAsset).filter(VideoAsset.is_bin == False)
    
    matching_tracklets = []
    for t in query.all():
        if t.class_name.lower() in OBJECT_CLASS_NAMES:
            matching_tracklets.append(t.to_dict())
            
    return matching_tracklets


# -------------------------------------------------------
# Analysis run endpoints
# -------------------------------------------------------

@router.get("/alerts/config", response_model=dict)
def get_alert_config():
    """Gets the persistent analysis configuration."""
    return load_persistent_config()


@router.put("/alerts/config", response_model=dict)
def update_alert_config(payload: AbandonedAnalysisConfig):
    """Updates and persists the analysis configuration."""
    config_dict = payload.dict()
    save_persistent_config(config_dict)
    return config_dict


@router.post("/alerts/trigger-all")
def trigger_abandoned_analysis_all(
    background_tasks: BackgroundTasks,
    config: AbandonedAnalysisConfig = None,
    db: Session = Depends(get_db),
):
    """Triggers abandoned object analysis on all eligible complete videos
    whose cameras have participate_in_alerts=True."""
    if config is None:
        # Load from disk config or use defaults
        config_dict = load_persistent_config()
        config = AbandonedAnalysisConfig(**config_dict)

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

    # Pre-populate logs with 'pending' status
    for vid_id in video_ids:
        video = db.query(VideoAsset).filter(VideoAsset.id == vid_id).first()
        if video:
            camera = db.query(CameraProfile).filter(CameraProfile.camera_id == video.camera_id).first()
            _analysis_run_log.append({
                "video_id": vid_id,
                "video_name": video.original_filename,
                "camera_name": camera.name if camera else video.camera_id,
                "status": "pending",
                "eligible": False,
                "skip_reason": None,
                "alerts_created": 0,
                "log_entries": [],
                "progress_percentage": 0,
            })

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
        config_dict = load_persistent_config()
        config = AbandonedAnalysisConfig(**config_dict)

    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")
    if video.processing_status != "complete":
        raise HTTPException(status_code=400, detail="Video is not fully processed yet.")
    if video.is_bin:
        raise HTTPException(status_code=400, detail="Cannot analyze a binned video.")

    global _analysis_run_log
    _analysis_run_log = []

    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == video.camera_id).first()
    _analysis_run_log.append({
        "video_id": video_id,
        "video_name": video.original_filename,
        "camera_name": camera.name if camera else video.camera_id,
        "status": "pending",
        "eligible": False,
        "skip_reason": None,
        "alerts_created": 0,
        "log_entries": [],
        "progress_percentage": 0,
    })

    background_tasks.add_task(_run_analysis_background, [video_id], config.dict())
    return {"status": "started", "video_id": video_id, "message": "Analysis started."}


@router.get("/alerts/analysis-log")
def get_analysis_log():
    """Returns the current/latest analysis run log."""
    return {"entries": _analysis_run_log}


def _run_analysis_background(video_ids: list, config_dict: dict):
    db = SessionLocal()
    try:
        analyzer = AbandonedObjectAnalyzer(**config_dict)
        for video_id in video_ids:
            # Set status to running
            for log_entry in _analysis_run_log:
                if log_entry["video_id"] == video_id:
                    log_entry["status"] = "running"

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

                # Define progress callback
                def progress_cb(frame_idx, total_frames):
                    percent = int((frame_idx / total_frames) * 100) if total_frames > 0 else 0
                    for entry in _analysis_run_log:
                        if entry["video_id"] == video_id:
                            entry["progress_percentage"] = percent

                result = analyzer.analyze_video(
                    video_id=video_id,
                    model_classes=model_classes,
                    db=db,
                    progress_callback=progress_cb,
                )

                # Patch camera_id on created alerts (analyzer can't know it)
                if camera:
                    db.query(Alert).filter(
                        Alert.video_id == video_id,
                        Alert.camera_id == ""
                    ).update({"camera_id": camera.camera_id})
                    db.commit()

                # Update entry on completion
                for entry in _analysis_run_log:
                    if entry["video_id"] == video_id:
                        entry.update({
                            "status": "skipped" if not result["eligible"] else "complete",
                            "eligible": result["eligible"],
                            "skip_reason": result["skip_reason"],
                            "alerts_created": result["alerts_created"],
                            "log_entries": result["log_entries"],
                            "progress_percentage": 100 if result["eligible"] else 0,
                        })

            except Exception as e:
                logger.error(f"Analysis failed for video {video_id}: {e}")
                for entry in _analysis_run_log:
                    if entry["video_id"] == video_id:
                        entry["status"] = "error"
                        entry["log_entries"] = [f"[ERROR] {str(e)}"]
    finally:
        db.close()


# -------------------------------------------------------
# Chain Snatching Endpoints & Config Routes
# -------------------------------------------------------

_chain_snatching_run_log: List[dict] = []


@router.get("/alerts/chain-snatching-config", response_model=ChainSnatchingAnalysisConfig)
def get_chain_snatching_config():
    config_dict = load_persistent_chain_snatching_config()
    return ChainSnatchingAnalysisConfig(**config_dict)


@router.put("/alerts/chain-snatching-config", response_model=ChainSnatchingAnalysisConfig)
def update_chain_snatching_config(config: ChainSnatchingAnalysisConfig):
    save_persistent_chain_snatching_config(config.dict())
    return config


@router.get("/alerts/chain-snatching-analysis-log")
def get_chain_snatching_analysis_log():
    return {"entries": _chain_snatching_run_log}


@router.post("/alerts/trigger-chain-snatching-all")
def trigger_chain_snatching_analysis_all(
    background_tasks: BackgroundTasks,
    config: Optional[ChainSnatchingAnalysisConfig] = None,
    db: Session = Depends(get_db),
):
    if config is None:
        saved_dict = load_persistent_chain_snatching_config()
        config = ChainSnatchingAnalysisConfig(**saved_dict)
    else:
        save_persistent_chain_snatching_config(config.dict())

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
    logger.info(f"[ChainSnatchingTrigger] Scheduling analysis for {len(video_ids)} videos.")

    global _chain_snatching_run_log
    _chain_snatching_run_log = []

    for v in videos:
        camera = db.query(CameraProfile).filter(CameraProfile.camera_id == v.camera_id).first()
        _chain_snatching_run_log.append({
            "video_id": v.id,
            "video_name": v.original_filename,
            "camera_name": camera.name if camera else v.camera_id,
            "status": "pending",
            "eligible": False,
            "skip_reason": None,
            "alerts_created": 0,
            "log_entries": [],
            "progress_percentage": 0,
        })

    background_tasks.add_task(_run_chain_snatching_analysis_background, video_ids, config.dict())

    return {
        "status": "started",
        "video_count": len(video_ids),
        "message": f"Chain Snatching analysis started for {len(video_ids)} eligible videos.",
    }


@router.post("/alerts/trigger-chain-snatching/{video_id}")
def trigger_chain_snatching_analysis_single(
    video_id: str,
    background_tasks: BackgroundTasks,
    config: Optional[ChainSnatchingAnalysisConfig] = None,
    db: Session = Depends(get_db),
):
    if config is None:
        saved_dict = load_persistent_chain_snatching_config()
        config = ChainSnatchingAnalysisConfig(**saved_dict)
    else:
        save_persistent_chain_snatching_config(config.dict())

    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")
    if video.processing_status != "complete":
        raise HTTPException(status_code=400, detail="Video is not fully processed yet.")
    if video.is_bin:
        raise HTTPException(status_code=400, detail="Cannot analyze a binned video.")

    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == video.camera_id).first()

    global _chain_snatching_run_log
    _chain_snatching_run_log = [{
        "video_id": video_id,
        "video_name": video.original_filename,
        "camera_name": camera.name if camera else video.camera_id,
        "status": "pending",
        "eligible": False,
        "skip_reason": None,
        "alerts_created": 0,
        "log_entries": [],
        "progress_percentage": 0,
    }]

    background_tasks.add_task(_run_chain_snatching_analysis_background, [video_id], config.dict())
    return {"status": "started", "video_id": video_id, "message": "Chain Snatching analysis started."}


def _run_chain_snatching_analysis_background(video_ids: list, config_dict: dict):
    global _chain_snatching_run_log
    db = SessionLocal()
    try:
        analyzer = ChainSnatchingAnalyzer(**config_dict)
        for video_id in video_ids:
            for log_entry in _chain_snatching_run_log:
                if log_entry["video_id"] == video_id:
                    log_entry["status"] = "running"

            try:
                video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
                if not video:
                    continue
                camera = db.query(CameraProfile).filter(
                    CameraProfile.camera_id == video.camera_id
                ).first()
                model_classes = []
                if camera:
                    active_model_id = camera.theft_model_id or camera.model_id
                    if active_model_id and active_model_id != "OFF":
                        model = db.query(MLModel).filter(MLModel.id == active_model_id).first()
                        if model:
                            try:
                                model_classes = json.loads(model.classes) if model.classes else []
                            except Exception:
                                model_classes = []

                def progress_cb(percent):
                    for entry in _chain_snatching_run_log:
                        if entry["video_id"] == video_id:
                            entry["progress_percentage"] = percent

                result = analyzer.analyze_video(
                    video_id=video_id,
                    model_classes=model_classes,
                    db=db,
                    progress_callback=progress_cb,
                )

                if camera:
                    db.query(Alert).filter(
                        Alert.video_id == video_id,
                        Alert.camera_id == ""
                    ).update({"camera_id": camera.camera_id})
                    db.commit()

                for entry in _chain_snatching_run_log:
                    if entry["video_id"] == video_id:
                        entry.update({
                            "status": "skipped" if not result["eligible"] else "complete",
                            "eligible": result["eligible"],
                            "skip_reason": result["skip_reason"],
                            "alerts_created": result["alerts_created"],
                            "log_entries": result["log_entries"],
                            "progress_percentage": 100 if result["eligible"] else 0,
                        })

            except Exception as e:
                logger.error(f"Chain Snatching analysis failed for video {video_id}: {e}")
                for entry in _chain_snatching_run_log:
                    if entry["video_id"] == video_id:
                        entry["status"] = "error"
                        entry["log_entries"] = [f"[ERROR] {str(e)}"]
    finally:
        db.close()


# -------------------------------------------------------
# Utility Endpoints: Clear Logs & Artifacts
# -------------------------------------------------------

@router.post("/alerts/clear-logs")
def clear_alerts_logs():
    """Clears in-memory evaluation logs for all alert runs."""
    global _analysis_run_log, _chain_snatching_run_log
    _analysis_run_log = []
    _chain_snatching_run_log = []
    return {"status": "success", "message": "Analysis logs cleared successfully."}


@router.post("/alerts/clear-artifacts")
def clear_alerts_artifacts(db: Session = Depends(get_db)):
    """Clears generated alert database records and resets active alerts."""
    try:
        deleted = db.query(Alert).delete()
        db.commit()
        global _analysis_run_log, _chain_snatching_run_log
        _analysis_run_log = []
        _chain_snatching_run_log = []
        return {"status": "success", "message": f"Cleared {deleted} alert records and reset evaluation logs."}
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to clear alert artifacts: {e}")
        raise HTTPException(status_code=500, detail=str(e))
