import json
import numpy as np
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.db.models import Tracklet, VideoAsset, CameraProfile
from app.analytics.camera_graph import CameraSpatialGraph, SPEED_BOUNDS
from app.search.vector_index import get_vector_index


class TrajectoryEngine:
    """Spatio-Temporal Directed Acyclic Graph (DAG) Trajectory Reconstruction Engine."""

    def __init__(self, db_session: Session):
        self.db = db_session
        self.graph = CameraSpatialGraph(db_session)
        self.vector_index = get_vector_index()

    def reconstruct_trajectory(
        self,
        target_tracklet_id: Optional[str] = None,
        query_embedding: Optional[List[float]] = None,
        speed_mode: str = "pedestrian",
        top_k_candidates: int = 50,
        min_visual_similarity: float = 0.45
    ) -> Dict[str, Any]:
        """
        Reconstruct target journey across multi-camera network.
        """
        # 1. Obtain target vector and target tracklet metadata if tracklet_id supplied
        target_tracklet = None
        target_vec = query_embedding

        if target_tracklet_id:
            target_tracklet = self.db.query(Tracklet).filter(Tracklet.id == target_tracklet_id).first()
            if not target_tracklet:
                return {"status": "error", "message": f"Tracklet '{target_tracklet_id}' not found."}

            if target_vec is None:
                # 1. Try Qdrant point ID or computed deterministic UUID
                point_id = target_tracklet.qdrant_point_id or str(uuid.uuid5(uuid.NAMESPACE_DNS, target_tracklet.id))
                retrieved_vec = self.vector_index.get_vector_by_point_id(point_id)
                if retrieved_vec is not None:
                    target_vec = retrieved_vec

            if target_vec is None and target_tracklet.video_id:
                # 2. Try loading from embeddings.json
                try:
                    emb_path = get_data_path(os.path.join("processed/detections", target_tracklet.video_id, "embeddings.json"))
                    if os.path.exists(emb_path):
                        with open(emb_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            for item in data.get("tracklets", []):
                                if item.get("tracklet_id") == target_tracklet_id and item.get("embedding"):
                                    target_vec = item["embedding"]
                                    break
                except Exception:
                    pass

            if target_vec is None:
                # 3. Fallback: encode image crop via CLIPEncoder
                try:
                    crop_rel = getattr(target_tracklet, 'best_crop_path', None)
                    if crop_rel:
                        crop_abs = get_data_path(crop_rel)
                        if os.path.exists(crop_abs):
                            from app.embeddings.clip_encoder import CLIPEncoder
                            encoder = CLIPEncoder()
                            target_vec = encoder.encode_image(crop_abs)
                except Exception:
                    pass

            # Deduce default speed mode if auto
            if speed_mode == "auto":
                speed_mode = "vehicle" if target_tracklet.object_type == "vehicle" else "pedestrian"

        if target_vec is None:
            return {"status": "error", "message": "Could not resolve target feature vector for trajectory search."}

        if speed_mode not in SPEED_BOUNDS:
            speed_mode = "pedestrian"

        # 2. Search Qdrant vector index for top K candidates globally
        qdrant_results = self.vector_index.search_similar(
            query_vector=target_vec,
            top_k=top_k_candidates,
            score_threshold=min_visual_similarity
        )

        if not qdrant_results:
            # Fallback if Qdrant search returns empty or vector DB is empty
            if target_tracklet:
                return {
                    "status": "success",
                    "target": target_tracklet.to_dict(),
                    "journey_steps": [self._format_node(target_tracklet, 1.0, 1)],
                    "total_distance_meters": 0.0,
                    "total_duration_seconds": 0.0
                }
            return {"status": "error", "message": "No visual candidates found for trajectory linking."}

        # 3. Resolve Tracklets from DB and attach video start timestamps
        point_ids = [res["point_id"] for res in qdrant_results]
        score_map = {res["point_id"]: res["score"] for res in qdrant_results}

        candidate_tracklets = self.db.query(Tracklet).filter(Tracklet.qdrant_point_id.in_(point_ids)).all()

        if not candidate_tracklets and target_tracklet:
            candidate_tracklets = [target_tracklet]

        # Always include target tracklet in candidates if specified
        if target_tracklet and target_tracklet.id not in [t.id for t in candidate_tracklets]:
            candidate_tracklets.append(target_tracklet)
            score_map[target_tracklet.qdrant_point_id or "target"] = 1.0

        # Enhance nodes with absolute timestamps
        nodes = []
        for trk in candidate_tracklets:
            video = self.db.query(VideoAsset).filter(VideoAsset.id == trk.video_id).first()
            base_time = 0.0
            if video and video.upload_timestamp:
                base_time = video.upload_timestamp.timestamp()
            
            abs_time = base_time + trk.timestamp_start_seconds
            score = score_map.get(trk.qdrant_point_id, 0.5)

            nodes.append({
                "tracklet": trk,
                "abs_time": abs_time,
                "score": float(score),
                "cam_id": trk.camera_id
            })

        # Sort nodes chronologically
        nodes.sort(key=lambda n: n["abs_time"])

        if not nodes:
            return {"status": "error", "message": "No valid nodes for graph assembly."}

        # 4. Assemble Directed Acyclic Graph (DAG) and run Longest-Path DP
        # dp[i] stores (best_score, previous_node_index, distance_to_here, speed_from_prev)
        dp = [(nodes[i]["score"], -1, 0.0, 0.0) for i in range(len(nodes))]

        for i in range(len(nodes)):
            curr = nodes[i]
            for j in range(i + 1, len(nodes)):
                nxt = nodes[j]
                delta_t = nxt["abs_time"] - curr["abs_time"]
                
                # Check spatial-temporal feasibility & delay probability
                is_feasible, speed_m_s, dist_m = self.graph.check_transition_feasibility(
                    curr["cam_id"], curr["abs_time"],
                    nxt["cam_id"], nxt["abs_time"],
                    speed_mode=speed_mode
                )

                if is_feasible:
                    temporal_p = self.graph.calculate_delay_probability(delta_t, dist_m, speed_mode=speed_mode)
                    spatial_s = self.graph.get_spatial_topology_score(curr["cam_id"], nxt["cam_id"])
                    visual_s = nxt["score"]

                    # Unified Link Score
                    joint_score = (0.55 * visual_s) + (0.25 * temporal_p) + (0.20 * spatial_s)
                    new_path_score = dp[i][0] + joint_score

                    if new_path_score > dp[j][0]:
                        dp[j] = (new_path_score, i, dp[i][2] + dist_m, speed_m_s)

        # 5. Trace back best path
        best_end_idx = max(range(len(nodes)), key=lambda idx: dp[idx][0])
        
        path_indices = []
        curr_idx = best_end_idx
        while curr_idx != -1:
            path_indices.append(curr_idx)
            curr_idx = dp[curr_idx][1]

        path_indices.reverse()

        # 6. Format final Journey Response
        journey_steps = []
        total_dist_m = 0.0
        total_duration_s = 0.0

        if len(path_indices) > 1:
            total_duration_s = nodes[path_indices[-1]]["abs_time"] - nodes[path_indices[0]]["abs_time"]
            total_dist_m = dp[path_indices[-1]][2]

        for step_no, idx in enumerate(path_indices, start=1):
            n = nodes[idx]
            trk = n["tracklet"]
            step_dp = dp[idx]
            
            speed_kmh = round(step_dp[3] * 3.6, 1)
            dist_prev_m = 0.0
            temporal_score = 1.0
            spatial_score = 1.0

            if step_no > 1:
                prev_idx = path_indices[step_no - 2]
                prev_node = nodes[prev_idx]
                dist_prev_m = self.graph.get_distance(prev_node["cam_id"], n["cam_id"])
                delta_t_prev = n["abs_time"] - prev_node["abs_time"]
                temporal_score = self.graph.calculate_delay_probability(delta_t_prev, dist_prev_m, speed_mode=speed_mode)
                spatial_score = self.graph.get_spatial_topology_score(prev_node["cam_id"], n["cam_id"])

            formatted_node = self._format_node(
                trk=trk,
                confidence=n["score"],
                step_number=step_no,
                abs_timestamp=n["abs_time"],
                speed_to_here_kmh=speed_kmh,
                dist_from_prev_m=round(dist_prev_m, 1),
                temporal_score=round(temporal_score, 2),
                spatial_score=round(spatial_score, 2)
            )
            journey_steps.append(formatted_node)

        return {
            "status": "success",
            "speed_mode": speed_mode,
            "target": target_tracklet.to_dict() if target_tracklet else None,
            "total_hops": len(journey_steps),
            "total_distance_meters": round(total_dist_m, 1),
            "total_duration_seconds": round(total_duration_s, 1),
            "journey_steps": journey_steps
        }

    def _format_node(
        self,
        trk: Tracklet,
        confidence: float,
        step_number: int,
        abs_timestamp: float = 0.0,
        speed_to_here_kmh: float = 0.0,
        dist_from_prev_m: float = 0.0,
        temporal_score: float = 1.0,
        spatial_score: float = 1.0
    ) -> Dict[str, Any]:
        cam = self.db.query(CameraProfile).filter(CameraProfile.camera_id == trk.camera_id).first()
        trk_dict = trk.to_dict()
        
        return {
            "step": step_number,
            "tracklet_id": trk.id,
            "camera_id": trk.camera_id,
            "camera_name": cam.name if cam else trk.camera_id,
            "latitude": cam.latitude if cam else None,
            "longitude": cam.longitude if cam else None,
            "object_type": trk.object_type,
            "class_name": trk.class_name,
            "timestamp_start_seconds": trk.timestamp_start_seconds,
            "timestamp_end_seconds": trk.timestamp_end_seconds,
            "abs_timestamp": abs_timestamp,
            "confidence": round(confidence, 3),
            "temporal_score": temporal_score,
            "spatial_score": spatial_score,
            "best_crop_path": trk_dict.get("best_crop_path", ""),
            "caption": trk_dict.get("caption", ""),
            "speed_to_here_kmh": speed_to_here_kmh,
            "dist_from_prev_m": dist_from_prev_m
        }
