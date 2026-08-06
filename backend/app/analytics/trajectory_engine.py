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

            if target_tracklet.qdrant_point_id:
                retrieved_vec = self.vector_index.get_vector_by_point_id(target_tracklet.qdrant_point_id)
                if retrieved_vec is not None:
                    target_vec = retrieved_vec

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
                
                # Check spatial-temporal feasibility
                is_feasible, speed_m_s, dist_m = self.graph.check_transition_feasibility(
                    curr["cam_id"], curr["abs_time"],
                    nxt["cam_id"], nxt["abs_time"],
                    speed_mode=speed_mode
                )

                if is_feasible:
                    # Transition reward calculation
                    ideal_speed = SPEED_BOUNDS[speed_mode]["v_ideal"]
                    speed_penalty = abs(speed_m_s - ideal_speed) / ideal_speed if speed_m_s > 0 else 0.0
                    edge_weight = nxt["score"] - (0.15 * speed_penalty)
                    
                    new_score = dp[i][0] + edge_weight

                    if new_score > dp[j][0]:
                        dp[j] = (new_score, i, dp[i][2] + dist_m, speed_m_s)

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
            if step_no > 1:
                prev_idx = path_indices[step_no - 2]
                dist_prev_m = self.graph.get_distance(nodes[prev_idx]["cam_id"], n["cam_id"])

            formatted_node = self._format_node(
                trk=trk,
                confidence=n["score"],
                step_number=step_no,
                abs_timestamp=n["abs_time"],
                speed_to_here_kmh=speed_kmh,
                dist_from_prev_m=round(dist_prev_m, 1)
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
        dist_from_prev_m: float = 0.0
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
            "best_crop_path": trk_dict.get("best_crop_path", ""),
            "caption": trk_dict.get("caption", ""),
            "speed_to_here_kmh": speed_to_here_kmh,
            "dist_from_prev_m": dist_from_prev_m
        }
