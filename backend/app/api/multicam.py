from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.analytics.trajectory_engine import TrajectoryEngine
from app.analytics.sentinel_wave import SentinelWaveManager
from app.analytics.camera_graph import CameraSpatialGraph

router = APIRouter(prefix="/multicam", tags=["Multi-Camera Analytics"])


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
