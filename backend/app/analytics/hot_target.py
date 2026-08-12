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
        """Tags a suspect or vehicle for cross-camera persistent pursuit with deduplication checks."""
        # 1. Deduplication Check A: Check if exact tracklet is already tagged & active
        if origin_tracklet_id:
            existing = self.db.query(HotTarget).filter(
                HotTarget.origin_tracklet_id == origin_tracklet_id,
                HotTarget.status == "active"
            ).first()
            if existing:
                return {
                    "status": "already_tagged",
                    "message": f"Object '{existing.label}' ({existing.id}) is already tagged on {origin_camera_id} and actively under pursuit.",
                    "hot_target": existing.to_dict()
                }

        target_vec = embedding_vector
        trk = None

        if origin_tracklet_id:
            trk = self.db.query(Tracklet).filter(Tracklet.id == origin_tracklet_id).first()
            if trk:
                object_type = trk.object_type
                if target_vec is None:
                    import uuid
                    point_id = trk.qdrant_point_id or str(uuid.uuid5(uuid.NAMESPACE_DNS, trk.id))
                    retrieved_vec = self.vector_index.get_vector_by_point_id(point_id)
                    if retrieved_vec is not None:
                        target_vec = retrieved_vec

                if target_vec is None and trk.video_id:
                    try:
                        from app.config import get_data_path
                        import os
                        emb_path = get_data_path(os.path.join("processed/detections", trk.video_id, "embeddings.json"))
                        if os.path.exists(emb_path):
                            with open(emb_path, "r", encoding="utf-8") as f:
                                data = json.load(f)
                                for item in data.get("tracklets", []):
                                    if item.get("tracklet_id") == origin_tracklet_id and item.get("embedding"):
                                        target_vec = item["embedding"]
                                        break
                    except Exception:
                        pass

                if target_vec is None:
                    try:
                        from app.config import get_data_path
                        import os
                        crop_rel = getattr(trk, 'best_crop_path', None)
                        if crop_rel:
                            crop_abs = get_data_path(crop_rel)
                            if os.path.exists(crop_abs):
                                from app.embeddings.clip_encoder import CLIPEncoder
                                encoder = CLIPEncoder()
                                target_vec = encoder.encode_image(crop_abs)
                    except Exception:
                        pass

        if target_vec is None:
            return {"status": "error", "message": "Could not resolve feature vector for target tagging."}

        # 2. Deduplication Check B: Check visual similarity on same camera (cosine similarity >= 0.92)
        active_same_cam_targets = self.db.query(HotTarget).filter(
            HotTarget.origin_camera_id == origin_camera_id,
            HotTarget.status == "active"
        ).all()

        for active_target in active_same_cam_targets:
            try:
                active_vec = json.loads(active_target.embedding_vector)
                dot_prod = sum(a * b for a, b in zip(target_vec, active_vec))
                norm_a = sum(a * a for a in target_vec) ** 0.5
                norm_b = sum(b * b for b in active_vec) ** 0.5
                sim = dot_prod / (norm_a * norm_b + 1e-8)
                if sim >= 0.92:
                    return {
                        "status": "already_tagged",
                        "message": f"This object is visually identical ({sim*100:.1f}% match) to active target '{active_target.label}' on {origin_camera_id}.",
                        "hot_target": active_target.to_dict()
                    }
            except Exception:
                pass

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

    def delete_hot_target(self, target_id: str) -> Dict[str, Any]:
        """Permanently delete a hot target profile."""
        target = self.db.query(HotTarget).filter(HotTarget.id == target_id).first()
        if not target:
            return {"status": "error", "message": f"Hot Target '{target_id}' not found."}

        self.db.delete(target)
        self.db.commit()
        return {"status": "success", "message": f"Hot Target '{target_id}' deleted."}

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
