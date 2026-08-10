from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.analytics.trajectory_engine import TrajectoryEngine
from app.analytics.sentinel_wave import SentinelWaveManager
from app.analytics.camera_graph import CameraSpatialGraph

router = APIRouter(prefix="/api/v1/multicam", tags=["Multi-Camera Analytics"])


class TrajectoryRequest(BaseModel):
    tracklet_id: Optional[str] = None
    query_embedding: Optional[List[float]] = None
    speed_mode: str = "pedestrian"  # 'pedestrian' | 'vehicle' | 'auto'
    top_k_candidates: int = 50
    min_visual_similarity: float = 0.45


class SentinelActivateRequest(BaseModel):
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


@router.post("/sentinel/activate")
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


@router.post("/sentinel/activate")
def activate_sentinel_wave(
    req: SentinelActivateRequest,
    db: Session = Depends(get_db)
):
    """
    Initialize a Predictive Downstream Sentinel Search Wave pursuit session across neighbor cameras.
    """
    manager = SentinelWaveManager(db)
    result = manager.activate_sentinel_wave(
        origin_camera_id=req.origin_camera_id,
        target_tracklet_id=req.target_tracklet_id,
        query_embedding=req.query_embedding,
        speed_mode=req.speed_mode
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))

    return result


@router.get("/sentinel/sessions")
def get_sentinel_sessions(db: Session = Depends(get_db)):
    """
    List active and past Sentinel Search Wave pursuit sessions.
    """
    from app.db.models import SentinelSession
    sessions = db.query(SentinelSession).order_by(SentinelSession.created_at.desc()).all()
    return [s.to_dict() for s in sessions]


@router.delete("/sentinel/sessions/{session_id}")
def terminate_sentinel_session(session_id: str, db: Session = Depends(get_db)):
    """
    Terminate an active Sentinel Search Wave pursuit session.
    """
    from app.db.models import SentinelSession
    session = db.query(SentinelSession).filter(SentinelSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sentinel session not found")
    
    session.status = "terminated"
    db.commit()
    return {"message": "Sentinel session terminated successfully", "session_id": session_id}


@router.get("/graph/neighbors/{camera_id}")
def get_camera_neighbors(camera_id: str, max_distance_meters: float = Query(3000.0), db: Session = Depends(get_db)):
    """
    Get nearby and adjacent downstream camera nodes for a specific camera.
    """
    graph = CameraSpatialGraph(db)
    neighbors = graph.get_downstream_neighbors(camera_id, max_distance_meters=max_distance_meters)
    return {"origin_camera_id": camera_id, "count": len(neighbors), "neighbors": neighbors}
