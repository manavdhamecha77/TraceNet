import json
import uuid
import numpy as np
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.db.models import SentinelSession, Tracklet, CameraProfile, VideoAsset
from app.analytics.camera_graph import CameraSpatialGraph, SPEED_BOUNDS
from app.search.vector_index import get_vector_index


class SentinelWaveManager:
    """Predictive Downstream Sentinel Search Wave Pursuit Manager."""

    def __init__(self, db_session: Session):
        self.db = db_session
        self.graph = CameraSpatialGraph(db_session)
        self.vector_index = get_vector_index()

    def activate_sentinel_wave(
        self,
        origin_camera_id: str,
        target_tracklet_id: Optional[str] = None,
        query_embedding: Optional[List[float]] = None,
        speed_mode: str = "pedestrian"
    ) -> Dict[str, Any]:
        """
        Calculates predicted downstream ETAs and initializes an active Sentinel pursuit session.
        """
        origin_cam = self.db.query(CameraProfile).filter(CameraProfile.camera_id == origin_camera_id).first()
        if not origin_cam:
            return {"status": "error", "message": f"Origin camera '{origin_camera_id}' not found."}

        target_vec = query_embedding
        target_trk = None

        if target_tracklet_id:
            target_trk = self.db.query(Tracklet).filter(Tracklet.id == target_tracklet_id).first()
            if target_trk and target_vec is None:
                point_id = target_trk.qdrant_point_id or str(uuid.uuid5(uuid.NAMESPACE_DNS, target_trk.id))
                retrieved_vec = self.vector_index.get_vector_by_point_id(point_id)
                if retrieved_vec is not None:
                    target_vec = retrieved_vec

            if target_trk and target_vec is None and target_trk.video_id:
                try:
                    from app.config import get_data_path
                    import os
                    emb_path = get_data_path(os.path.join("processed/detections", target_trk.video_id, "embeddings.json"))
                    if os.path.exists(emb_path):
                        with open(emb_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            for item in data.get("tracklets", []):
                                if item.get("tracklet_id") == target_tracklet_id and item.get("embedding"):
                                    target_vec = item["embedding"]
                                    break
                except Exception:
                    pass

            if target_trk and target_vec is None:
                try:
                    from app.config import get_data_path
                    import os
                    crop_rel = getattr(target_trk, 'best_crop_path', None)
                    if crop_rel:
                        crop_abs = get_data_path(crop_rel)
                        if os.path.exists(crop_abs):
                            from app.embeddings.clip_encoder import CLIPEncoder
                            encoder = CLIPEncoder()
                            target_vec = encoder.encode_image(crop_abs)
                except Exception:
                    pass
            
            if target_trk and speed_mode == "auto":
                speed_mode = "vehicle" if target_trk.object_type == "vehicle" else "pedestrian"

        if speed_mode not in SPEED_BOUNDS:
            speed_mode = "pedestrian"

        # Obtain downstream neighbor nodes
        neighbors = self.graph.get_downstream_neighbors(origin_camera_id, max_distance_meters=4000.0)

        now = datetime.now(timezone.utc)
        bounds = SPEED_BOUNDS[speed_mode]

        downstream_nodes = []
        for n in neighbors:
            dist_m = n["distance_meters"]
            if dist_m <= 0:
                dist_m = 50.0

            # Calculate arrival ETA windows in seconds from now
            min_seconds = dist_m / bounds["v_max"]
            max_seconds = dist_m / bounds["v_min"]

            eta_min_dt = now + timedelta(seconds=min_seconds)
            eta_max_dt = now + timedelta(seconds=max_seconds)

            downstream_nodes.append({
                "camera_id": n["camera_id"],
                "name": n["name"],
                "latitude": n["latitude"],
                "longitude": n["longitude"],
                "distance_meters": dist_m,
                "is_direct_neighbor": n["is_direct_neighbor"],
                "eta_min_seconds": round(min_seconds, 1),
                "eta_max_seconds": round(max_seconds, 1),
                "eta_min_time": eta_min_dt.strftime("%H:%M:%S"),
                "eta_max_time": eta_max_dt.strftime("%H:%M:%S"),
                "status": "watching"  # 'watching' | 'matched' | 'passed'
            })

        # Save session to DB
        session_id = str(uuid.uuid4())
        new_session = SentinelSession(
            id=session_id,
            target_tracklet_id=target_tracklet_id,
            target_embedding=json.dumps(target_vec) if target_vec else None,
            status="active",
            origin_camera_id=origin_camera_id,
            speed_mode=speed_mode,
            downstream_nodes=json.dumps(downstream_nodes)
        )
        self.db.add(new_session)
        self.db.commit()

        return {
            "status": "success",
            "session_id": session_id,
            "origin_camera": origin_cam.to_dict(),
            "target_tracklet": target_trk.to_dict() if target_trk else None,
            "speed_mode": speed_mode,
            "sentinel_cameras_count": len(downstream_nodes),
            "downstream_nodes": downstream_nodes
        }

    def get_active_sessions(self) -> List[Dict[str, Any]]:
        sessions = self.db.query(SentinelSession).filter(SentinelSession.status == "active").all()
        return [s.to_dict() for s in sessions]

    def evaluate_incoming_tracklet(self, incoming_trk: Tracklet) -> List[Dict[str, Any]]:
        """
        Checks if a newly ingested tracklet matches any active Sentinel Wave sessions.
        """
        active_sessions = self.db.query(SentinelSession).filter(SentinelSession.status == "active").all()
        matches = []

        if not active_sessions or not incoming_trk.qdrant_point_id:
            return matches

        inc_vec = self.vector_index.get_vector_by_point_id(incoming_trk.qdrant_point_id)
        if inc_vec is None:
            return matches

        for session in active_sessions:
            if not session.target_embedding:
                continue

            try:
                target_vec = json.loads(session.target_embedding)
            except Exception:
                continue

            # Compute Cosine Similarity
            dot_product = np.dot(target_vec, inc_vec)
            norm_a = np.linalg.norm(target_vec)
            norm_b = np.linalg.norm(inc_vec)
            sim = float(dot_product / (norm_a * norm_b)) if (norm_a > 0 and norm_b > 0) else 0.0

            if sim >= 0.70:
                # Flag match
                session.status = "matched"
                session.matched_camera_id = incoming_trk.camera_id
                session.matched_tracklet_id = incoming_trk.id
                self.db.commit()

                cam = self.db.query(CameraProfile).filter(CameraProfile.camera_id == incoming_trk.camera_id).first()

                matches.append({
                    "session_id": session.id,
                    "target_tracklet_id": session.target_tracklet_id,
                    "matched_camera_id": incoming_trk.camera_id,
                    "matched_camera_name": cam.name if cam else incoming_trk.camera_id,
                    "matched_tracklet_id": incoming_trk.id,
                    "similarity_score": round(sim, 3),
                    "crop_url": incoming_trk.to_dict().get("best_crop_path", "")
                })

        return matches
