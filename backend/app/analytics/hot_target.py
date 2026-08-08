import json
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.db.models import HotTarget, Tracklet, CameraProfile
from app.analytics.trajectory_engine import TrajectoryEngine
from app.search.vector_index import get_vector_index


class HotTargetManager:
    """Manager for Tagged Hot Targets and Cross-Camera Persistent Tracking."""

    def __init__(self, db_session: Session):
        self.db = db_session
        self.vector_index = get_vector_index()
        self.trajectory_engine = TrajectoryEngine(db_session)

    def tag_hot_target(
        self,
        label: str,
        origin_camera_id: str,
        object_type: str = "person",
        origin_tracklet_id: Optional[str] = None,
        embedding_vector: Optional[List[float]] = None,
        priority: str = "HIGH"
    ) -> Dict[str, Any]:
        """Tags a suspect or vehicle for cross-camera persistent pursuit."""
        target_vec = embedding_vector
        trk = None

        if origin_tracklet_id:
            trk = self.db.query(Tracklet).filter(Tracklet.id == origin_tracklet_id).first()
            if trk and trk.qdrant_point_id:
                retrieved_vec = self.vector_index.get_vector_by_point_id(trk.qdrant_point_id)
                if retrieved_vec:
                    target_vec = retrieved_vec
            if trk:
                object_type = trk.object_type

        if target_vec is None:
            return {"status": "error", "message": "Could not resolve feature vector for target tagging."}

        target_id = f"hot_target_{str(uuid.uuid4())[:8]}"
        hot_target = HotTarget(
            id=target_id,
            label=label,
            object_type=object_type,
            origin_tracklet_id=origin_tracklet_id,
            origin_camera_id=origin_camera_id,
            embedding_vector=json.dumps(target_vec),
            status="active",
            priority=priority,
            created_at=datetime.now(timezone.utc),
            last_seen_camera_id=origin_camera_id,
            last_seen_timestamp=datetime.now(timezone.utc),
            matches_count=1
        )

        self.db.add(hot_target)
        self.db.commit()
        self.db.refresh(hot_target)

        return {
            "status": "success",
            "message": f"Hot Target '{label}' ({target_id}) tagged for active multi-camera pursuit.",
            "hot_target": hot_target.to_dict()
        }

    def list_hot_targets(self, status: str = "active") -> List[Dict[str, Any]]:
        """List active tagged hot targets."""
        query = self.db.query(HotTarget)
        if status != "all":
            query = query.filter(HotTarget.status == status)

        targets = query.order_by(HotTarget.created_at.desc()).all()
        return [t.to_dict() for t in targets]

    def resolve_hot_target(self, target_id: str, status: str = "resolved") -> Dict[str, Any]:
        """Mark a hot target pursuit as resolved or archived."""
        target = self.db.query(HotTarget).filter(HotTarget.id == target_id).first()
        if not target:
            return {"status": "error", "message": f"Hot Target '{target_id}' not found."}

        target.status = status
        self.db.commit()
        return {"status": "success", "message": f"Hot Target '{target_id}' status set to '{status}'."}

    def get_hot_target_journey(self, target_id: str) -> Dict[str, Any]:
        """Retrieve full multi-camera journey map for tagged hot target."""
        target = self.db.query(HotTarget).filter(HotTarget.id == target_id).first()
        if not target:
            return {"status": "error", "message": f"Hot Target '{target_id}' not found."}

        try:
            vector = json.loads(target.embedding_vector)
        except Exception:
            return {"status": "error", "message": "Failed to parse target feature vector."}

        speed_mode = "vehicle" if target.object_type == "vehicle" else "pedestrian"

        trajectory_res = self.trajectory_engine.reconstruct_trajectory(
            target_tracklet_id=target.origin_tracklet_id,
            query_embedding=vector,
            speed_mode=speed_mode,
            top_k_candidates=50,
            min_visual_similarity=0.25
        )

        trajectory_res["hot_target"] = target.to_dict()
        return trajectory_res
