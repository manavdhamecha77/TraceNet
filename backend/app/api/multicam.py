from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.analytics.trajectory_engine import TrajectoryEngine
from app.analytics.pursuit_wave import PursuitWaveManager
from app.analytics.camera_graph import CameraSpatialGraph

router = APIRouter(prefix="/api/v1/multicam", tags=["Multi-Camera Analytics"])


class TrajectoryRequest(BaseModel):
    tracklet_id: Optional[str] = None
    query_embedding: Optional[List[float]] = None
    speed_mode: str = "pedestrian"  # 'pedestrian' | 'vehicle' | 'auto'
    top_k_candidates: int = 50
    min_visual_similarity: float = 0.45


class PursuitActivateRequest(BaseModel):
    origin_camera_id: str
    target_tracklet_id: Optional[str] = None
    query_embedding: Optional[List[float]] = None
    speed_mode: str = "pedestrian"  # 'pedestrian' | 'vehicle' | 'auto'


class TagTargetRequest(BaseModel):
    label: str
    origin_camera_id: str
    object_type: str = "person"
    origin_tracklet_id: Optional[str] = None
    embedding_vector: Optional[List[float]] = None
    priority: str = "HIGH"


@router.post("/trajectory/reconstruct")
def reconstruct_trajectory(
    req: TrajectoryRequest,
    db: Session = Depends(get_db)
):
    """
    Reconstruct multi-camera spatial-temporal journey trajectory for a target tracklet or visual embedding.
    """
    engine = TrajectoryEngine(db)
    result = engine.reconstruct_trajectory(
        target_tracklet_id=req.tracklet_id,
        query_embedding=req.query_embedding,
        speed_mode=req.speed_mode,
        top_k_candidates=req.top_k_candidates,
        min_visual_similarity=req.min_visual_similarity
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))

    return result


@router.post("/targets/tag")
def tag_hot_target(
    req: TagTargetRequest,
    db: Session = Depends(get_db)
):
    """
    Tag a suspect or vehicle for cross-camera persistent pursuit.
    """
    from app.analytics.hot_target import HotTargetManager
    manager = HotTargetManager(db)
    res = manager.tag_hot_target(
        label=req.label,
        origin_camera_id=req.origin_camera_id,
        object_type=req.object_type,
        origin_tracklet_id=req.origin_tracklet_id,
        embedding_vector=req.embedding_vector,
        priority=req.priority
    )
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res


@router.get("/targets")
def list_hot_targets(
    status: str = Query("active"),
    db: Session = Depends(get_db)
):
    """
    List active or all tagged hot targets.
    """
    from app.analytics.hot_target import HotTargetManager
    manager = HotTargetManager(db)
    return {"targets": manager.list_hot_targets(status=status)}


@router.get("/targets/alerts")
def list_target_alerts(db: Session = Depends(get_db)):
    """List suspect reappearance alerts."""
    from app.db.models import Alert
    alerts = db.query(Alert).filter(Alert.alert_type == "suspect_reappearance").order_by(Alert.timestamp.desc()).limit(20).all()
    res = []
    for a in alerts:
        d = a.to_dict()
        try:
            log_data = json.loads(a.analysis_log) if a.analysis_log else {}
            d["target_label"] = log_data.get("label", "Tagged Suspect")
            d["priority"] = log_data.get("priority", "HIGH")
        except Exception:
            pass
        res.append(d)
    return {"alerts": res}


@router.post("/targets/alerts/{alert_id}/acknowledge")
def acknowledge_target_alert(alert_id: int, db: Session = Depends(get_db)):
    """Acknowledge a suspect reappearance alert."""
    from app.db.models import Alert
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    db.commit()
    return {"status": "success", "message": f"Alert {alert_id} acknowledged"}


@router.get("/targets/{target_id}/journey")
def get_hot_target_journey(
    target_id: str,
    db: Session = Depends(get_db)
):
    """
    Get full multi-camera journey map for a tagged hot target.
    """
    from app.analytics.hot_target import HotTargetManager
    manager = HotTargetManager(db)
    res = manager.get_hot_target_journey(target_id)
    if res.get("status") == "error":
        raise HTTPException(status_code=404, detail=res.get("message"))
    return res


@router.put("/targets/{target_id}/status")
def update_hot_target_status(
    target_id: str,
    status: str = Query("resolved"),
    db: Session = Depends(get_db)
):
    """
    Update status of a hot target pursuit ('active' | 'resolved' | 'archived').
    """
    from app.analytics.hot_target import HotTargetManager
    manager = HotTargetManager(db)
    res = manager.resolve_hot_target(target_id, status=status)
    if res.get("status") == "error":
        raise HTTPException(status_code=404, detail=res.get("message"))
    return res


@router.delete("/targets/{target_id}")
def delete_hot_target(
    target_id: str,
    db: Session = Depends(get_db)
):
    """
    Permanently delete a hot target profile.
    """
    from app.analytics.hot_target import HotTargetManager
    manager = HotTargetManager(db)
    res = manager.delete_hot_target(target_id)
    if res.get("status") == "error":
        raise HTTPException(status_code=404, detail=res.get("message"))
    return res





@router.post("/pursuit/activate")
def activate_pursuit_wave(
    req: PursuitActivateRequest,
    db: Session = Depends(get_db)
):
    """
    Initialize a Predictive Downstream Pursuit Wave session across neighbor cameras.
    """
    manager = PursuitWaveManager(db)
    result = manager.activate_pursuit_wave(
        origin_camera_id=req.origin_camera_id,
        target_tracklet_id=req.target_tracklet_id,
        query_embedding=req.query_embedding,
        speed_mode=req.speed_mode
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))

    return result


@router.get("/pursuit/sessions")
def get_pursuit_sessions(db: Session = Depends(get_db)):
    """
    List active and past Pursuit Wave sessions.
    """
    from app.db.models import PursuitSession
    sessions = db.query(PursuitSession).order_by(PursuitSession.created_at.desc()).all()
    return [s.to_dict() for s in sessions]


@router.delete("/pursuit/sessions/{session_id}")
def terminate_pursuit_session(session_id: str, db: Session = Depends(get_db)):
    """
    Terminate an active Pursuit Wave session.
    """
    from app.db.models import PursuitSession
    session = db.query(PursuitSession).filter(PursuitSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Pursuit session not found")
    
    session.status = "terminated"
    db.commit()
    return {"message": "Pursuit session terminated successfully", "session_id": session_id}


@router.get("/graph/neighbors/{camera_id}")
def get_camera_neighbors(camera_id: str, max_distance_meters: float = Query(3000.0), db: Session = Depends(get_db)):
    """
    Get nearby and adjacent downstream camera nodes for a specific camera.
    """
    graph = CameraSpatialGraph(db)
    neighbors = graph.get_downstream_neighbors(camera_id, max_distance_meters=max_distance_meters)
    return {"origin_camera_id": camera_id, "count": len(neighbors), "neighbors": neighbors}


# ==============================================================================
# LUMPI DATASET EVALUATION SUITE
# ==============================================================================

class LumpiEvaluationRequest(BaseModel):
    dataset_path: Optional[str] = None
    experiment_id: int = 1
    min_visual_similarity: float = 0.45
    visual_weight: float = 0.55
    temporal_weight: float = 0.25
    spatial_weight: float = 0.20
    embedding_noise_sigma: float = 0.05   # visual ambiguity injected into the synthetic identity embeddings
    handover_radius_m: float = 15.0       # max ground-plane jump allowed for a same-time handover between overlapping cameras


@router.get("/evaluation/lumpi/status")
def get_lumpi_status(dataset_path: Optional[str] = None):
    """
    Check LUMPI evaluation benchmark dataset status, kind (real calibrated LUMPI vs synthetic sample),
    the experiments (Measurement folders) it contains, and when the last report was generated.
    """
    from app.analytics.lumpi.adapter import LumpiAdapter
    from app.analytics.lumpi.evaluator import LumpiEvaluator

    adapter = LumpiAdapter(dataset_path=dataset_path)
    available = adapter.is_dataset_available()
    latest = LumpiEvaluator(adapter=adapter).get_latest_report()
    return {
        "status": "ready" if available else "standby",
        "dataset_path": adapter.dataset_path,
        "is_available": available,
        "dataset_kind": adapter.dataset_kind(),
        "experiments": adapter.list_experiments() if available else [],
        "last_report_generated_at": (latest or {}).get("generated_at"),
        "last_report_experiment_id": (latest or {}).get("experiment_id")
    }


@router.post("/evaluation/lumpi/run")
def run_lumpi_evaluation(req: LumpiEvaluationRequest):
    """
    Execute benchmark evaluation against LUMPI multi-camera ground truth.
    Measures cross-camera link precision, recall, F1, identity switches, and transit time errors.
    """
    from app.analytics.lumpi.adapter import LumpiAdapter
    from app.analytics.lumpi.evaluator import LumpiEvaluator

    weight_sum = req.visual_weight + req.temporal_weight + req.spatial_weight
    if weight_sum <= 0:
        raise HTTPException(status_code=400, detail="At least one of visual/temporal/spatial weight must be positive.")
    if not (0.0 <= req.min_visual_similarity <= 1.0):
        raise HTTPException(status_code=400, detail="min_visual_similarity must lie in [0, 1].")

    adapter = LumpiAdapter(dataset_path=req.dataset_path)
    evaluator = LumpiEvaluator(adapter=adapter)
    try:
        return evaluator.run_evaluation(
            experiment_id=req.experiment_id,
            min_visual_similarity=req.min_visual_similarity,
            visual_weight=req.visual_weight,
            temporal_weight=req.temporal_weight,
            spatial_weight=req.spatial_weight,
            embedding_noise_sigma=req.embedding_noise_sigma,
            handover_radius_m=req.handover_radius_m
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/evaluation/lumpi/report")
def get_lumpi_evaluation_report():
    """
    Retrieve the latest computed LUMPI multi-camera evaluation report.
    """
    from app.analytics.lumpi.evaluator import LumpiEvaluator
    evaluator = LumpiEvaluator()
    report = evaluator.get_latest_report()
    if not report:
        # Run default evaluation if no report exists yet
        report = evaluator.run_evaluation()
    return report


# ==============================================================================
# LUMPI MULTI-CAMERA FUSION REPLAY (demo: real detector + ByteTrack + calibrated fusion)
# ==============================================================================
import os as _os
import json as _json
import threading as _threading
from typing import Any as _Any, Dict as _Dict

_replay_jobs: _Dict[int, _Dict[str, _Any]] = {}
_replay_lock = _threading.Lock()


class LumpiReplayBuildRequest(BaseModel):
    experiment_id: int = 1
    model_id: Optional[str] = None       # registered MLModel id; takes precedence over weights_path
    weights_path: Optional[str] = None   # explicit .pt path (must live under backend/data)
    conf: float = 0.3
    imgsz: int = 1280
    force: bool = False                  # rebuild even if a replay already exists


def _resolve_replay_weights(req: LumpiReplayBuildRequest, db: Session) -> Optional[str]:
    from app.config import get_data_path
    from app.db.models import MLModel
    if req.model_id:
        m = db.query(MLModel).filter(MLModel.id == req.model_id).first()
        if not m:
            raise HTTPException(status_code=404, detail=f"Model '{req.model_id}' is not registered.")
        for cand in (m.file_path, get_data_path(m.file_path), get_data_path(f"models/{_os.path.basename(m.file_path)}")):
            if cand and _os.path.exists(cand):
                return cand
        raise HTTPException(status_code=404, detail=f"Weights for model '{m.name}' not found on disk.")
    if req.weights_path:
        p = req.weights_path if _os.path.isabs(req.weights_path) else get_data_path(req.weights_path)
        data_root = _os.path.abspath(get_data_path(""))
        if not _os.path.abspath(p).startswith(data_root):
            raise HTTPException(status_code=400, detail="weights_path must point inside backend/data.")
        if not _os.path.exists(p):
            raise HTTPException(status_code=404, detail=f"Weights not found: {p}")
        return p
    return None


@router.get("/replay/lumpi/status")
def get_lumpi_replay_status(experiment_id: int = 1):
    """Whether a fusion replay exists for the experiment, and build progress if one is running."""
    from app.analytics.lumpi.replay import LumpiReplayBuilder
    from app.analytics.lumpi.adapter import LumpiAdapter
    st = LumpiReplayBuilder(experiment_id=experiment_id).status()
    with _replay_lock:
        job = dict(_replay_jobs.get(experiment_id, {}))
    st.update({
        "building": bool(job.get("building")),
        "progress": job.get("progress", 0.0),
        "message": job.get("message"),
        "error": job.get("error"),
        "job_id": job.get("job_id"),
        "experiments": [e for e in LumpiAdapter().list_experiments() if e.get("has_video")],
    })
    return st


@router.post("/replay/lumpi/build", status_code=202)
def build_lumpi_replay(req: LumpiReplayBuildRequest, db: Session = Depends(get_db)):
    """Starts (in the background) detection + tracking + cross-camera fusion for one LUMPI experiment."""
    from app.analytics.lumpi.replay import LumpiReplayBuilder
    from app.db.session import SessionLocal
    from app.db.crud import create_system_job, update_system_job_progress, complete_system_job

    weights = _resolve_replay_weights(req, db)
    builder = LumpiReplayBuilder(experiment_id=req.experiment_id, weights_path=weights, conf=req.conf, imgsz=req.imgsz)
    if builder.status()["built"] and not req.force:
        return {"status": "exists", "experiment_id": req.experiment_id, "json_url": builder.status()["json_url"]}

    with _replay_lock:
        if _replay_jobs.get(req.experiment_id, {}).get("building"):
            raise HTTPException(status_code=409, detail=f"A replay build for experiment {req.experiment_id} is already running.")
        job = create_system_job(db, name=f"LUMPI fusion replay (exp {req.experiment_id})", job_type="model_run", status="running",
                                payload={"experiment_id": req.experiment_id, "weights": _os.path.basename(builder.weights_path)})
        _replay_jobs[req.experiment_id] = {"building": True, "progress": 0.0, "message": "queued", "error": None, "job_id": job.id}

    def _progress(pct: float, msg: str) -> None:
        with _replay_lock:
            _replay_jobs[req.experiment_id].update({"progress": pct, "message": msg})
        s = SessionLocal()
        try:
            update_system_job_progress(s, job.id, min(99.0, pct), "running")
        finally:
            s.close()

    def _run() -> None:
        s = SessionLocal()
        try:
            builder.progress_cb = _progress
            builder.build()
            complete_system_job(s, job.id, "completed")
            with _replay_lock:
                _replay_jobs[req.experiment_id].update({"building": False, "progress": 100.0, "message": "done"})
        except Exception as e:  # noqa: BLE001
            complete_system_job(s, job.id, "failed")
            with _replay_lock:
                _replay_jobs[req.experiment_id].update({"building": False, "error": str(e), "message": "failed"})
        finally:
            s.close()

    _threading.Thread(target=_run, name=f"lumpi-replay-{req.experiment_id}", daemon=True).start()
    return {"status": "started", "experiment_id": req.experiment_id, "job_id": job.id}


@router.get("/replay/lumpi/{experiment_id}")
def get_lumpi_replay(experiment_id: int):
    """Returns the fusion replay payload (cameras, fused tracks, per-frame boxes) for the UI."""
    from app.analytics.lumpi.replay import LumpiReplayBuilder
    builder = LumpiReplayBuilder(experiment_id=experiment_id)
    if not _os.path.exists(builder.json_path):
        raise HTTPException(status_code=404, detail=f"No replay built for experiment {experiment_id}. POST /replay/lumpi/build first.")
    with open(builder.json_path, "r", encoding="utf-8") as f:
        return _json.load(f)


@router.delete("/replay/lumpi/{experiment_id}")
def delete_lumpi_replay(experiment_id: int):
    from app.analytics.lumpi.replay import LumpiReplayBuilder
    with _replay_lock:
        if _replay_jobs.get(experiment_id, {}).get("building"):
            raise HTTPException(status_code=409, detail="Cannot delete while a build is running.")
    LumpiReplayBuilder(experiment_id=experiment_id).clear()
    return {"status": "deleted", "experiment_id": experiment_id}
