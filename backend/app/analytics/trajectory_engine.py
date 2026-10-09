import json
import os
import statistics
import uuid
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session

from app.config import get_data_path
from app.db.models import Tracklet, VideoAsset, CameraProfile
from app.analytics.camera_graph import CameraSpatialGraph, SPEED_BOUNDS
from app.search.vector_index import COLLECTION_NAME, get_vector_index

# CLIP rates almost any two pedestrian (or vehicle) crops 0.85-0.96 similar, so an absolute similarity
# threshold cannot tell "same person" from "look-alike". A camera only joins the route when its best
# sighting clearly stands out from this target's usual look-alike scores AND from that camera's runner-up.
MIN_DISTINCTIVENESS_Z = 2.5     # robust z-score of the best sighting vs. the target's look-alike distribution
MIN_RUNNER_UP_MARGIN = 0.01     # best sighting in a camera must beat the camera's second-best by this much
SAME_VISIT_SECONDS = 15.0       # sightings this close in time in one video are the same pass (split track)
MIN_CANDIDATE_POOL = 100
MAX_HOPS = 12
LIMITATION = (
    "Candidate route for human review. Each hop is the sighting that stood out most from the target's "
    "look-alikes and is physically reachable in time; appearance similarity cannot confirm identity."
)


class TrajectoryEngine:
    """Anchored, spatio-temporally consistent multi-camera journey reconstruction."""

    def __init__(self, db_session: Session):
        self.db = db_session
        self.graph = CameraSpatialGraph(db_session)
        self.vector_index = get_vector_index()

    # ------------------------------------------------------------------ target vector

    def _target_vector(self, target: Tracklet) -> Optional[List[float]]:
        point_id = target.qdrant_point_id or str(uuid.uuid5(uuid.NAMESPACE_DNS, target.id))
        vec = self.vector_index.get_vector_by_point_id(point_id)
        if vec is not None:
            return vec
        try:
            emb_path = get_data_path(os.path.join("processed/detections", target.video_id, "embeddings.json"))
            if os.path.exists(emb_path):
                with open(emb_path, "r", encoding="utf-8") as f:
                    for item in json.load(f).get("tracklets", []):
                        if item.get("tracklet_id") == target.id and item.get("embedding"):
                            return item["embedding"]
        except Exception:
            pass
        try:
            from app.storage.media import to_local_data_path

            crop = to_local_data_path(target.best_crop_path)
            if crop and os.path.exists(crop):
                from app.embeddings.clip_encoder import get_clip_encoder

                return get_clip_encoder().embed_image(crop)
        except Exception:
            pass
        return None

    def _abs_time(self, trk: Tracklet) -> float:
        """Recording time of the sighting (video start + offset); upload time only when start is unknown."""
        video = trk.video or self.db.query(VideoAsset).filter(VideoAsset.id == trk.video_id).first()
        ref = (video.start_time or video.upload_timestamp) if video else None
        return (ref.timestamp() if ref else 0.0) + (trk.timestamp_start_seconds or 0.0)

    # ------------------------------------------------------------------ reconstruction

    def reconstruct_trajectory(
        self,
        target_tracklet_id: Optional[str] = None,
        query_embedding: Optional[List[float]] = None,
        speed_mode: str = "pedestrian",
        top_k_candidates: int = 50,
        min_visual_similarity: float = 0.45
    ) -> Dict[str, Any]:
        """
        Reconstruct the target's journey across the camera network.

        1. Candidates: sightings of the same object type in other videos, ranked by visual similarity.
        2. Per camera, keep the best sighting only if it is distinctive (robust z-score vs. the target's
           look-alike distribution) and unambiguous (beats the camera's runner-up); others are reported in
           ``rejected_cameras`` with the reason.
        3. Starting from the target, extend forwards and backwards in recording time, one camera change per
           hop, only through transitions that are physically feasible for the speed mode.
        """
        target: Optional[Tracklet] = None
        target_vec = query_embedding
        if target_tracklet_id:
            target = self.db.query(Tracklet).filter(Tracklet.id == target_tracklet_id).first()
            if not target:
                return {"status": "error", "message": f"Tracklet '{target_tracklet_id}' not found."}
            if target_vec is None:
                target_vec = self._target_vector(target)
            if speed_mode == "auto":
                speed_mode = "vehicle" if target.object_type == "vehicle" else "pedestrian"
        if target_vec is None:
            return {"status": "error", "message": "Could not resolve target feature vector for trajectory search."}
        if speed_mode not in SPEED_BOUNDS:
            speed_mode = "pedestrian"

        # 1. Candidate sightings (the target's own video is the same scene, not a journey hop)
        from qdrant_client import models as qm

        must, must_not = [], []
        if target:
            must.append(qm.FieldCondition(key="object_type", match=qm.MatchValue(value=target.object_type)))
            must_not.append(qm.FieldCondition(key="video_id", match=qm.MatchValue(value=target.video_id)))
        try:
            points = self.vector_index.client.query_points(
                collection_name=COLLECTION_NAME,
                query=target_vec,
                query_filter=qm.Filter(must=must or None, must_not=must_not or None),
                limit=max(top_k_candidates, MIN_CANDIDATE_POOL),
                with_payload=False,
            ).points
        except Exception:
            points = []

        scores = [float(p.score) for p in points]
        baseline = statistics.median(scores) if scores else 0.0
        spread = max(statistics.median([abs(s - baseline) for s in scores]) * 1.4826, 0.005) if len(scores) > 2 else 0.005
        score_by_point = {str(p.id): float(p.score) for p in points}
        candidates = (
            self.db.query(Tracklet).filter(Tracklet.qdrant_point_id.in_(list(score_by_point))).all()
            if score_by_point else []
        )

        # 2. One distinctive, unambiguous sighting per camera
        per_camera: Dict[str, List[tuple]] = {}
        for trk in candidates:
            per_camera.setdefault(trk.camera_id, []).append((score_by_point[trk.qdrant_point_id], trk))
        accepted, rejected = [], []
        for cam_id, items in per_camera.items():
            items.sort(key=lambda x: x[0], reverse=True)
            best_score, best = items[0]
            if not self.graph.has_location(cam_id):
                rejected.append({"camera_id": cam_id, "best_similarity": round(best_score, 3),
                                 "reason": "camera has no map coordinates, so travel time cannot be checked"})
                continue
            # The runner-up must be a different pass: a split track of the same visit is not a competitor
            competitors = [
                s for s, t in items[1:]
                if t.video_id != best.video_id
                or abs((t.timestamp_start_seconds or 0.0) - (best.timestamp_start_seconds or 0.0)) > SAME_VISIT_SECONDS
            ]
            runner_up = competitors[0] if competitors else baseline
            z = (best_score - baseline) / spread
            margin = best_score - runner_up
            if best_score < min_visual_similarity:
                reason = f"best similarity {best_score:.3f} is below the {min_visual_similarity:.2f} floor"
            elif z < MIN_DISTINCTIVENESS_Z:
                reason = f"no sighting stands out (best {best_score:.3f} vs typical look-alike {baseline:.3f})"
            elif margin < MIN_RUNNER_UP_MARGIN:
                reason = f"ambiguous: best {best_score:.3f} vs runner-up {runner_up:.3f} in the same camera"
            else:
                accepted.append({"trk": best, "score": best_score, "z": z, "margin": margin,
                                 "cam": cam_id, "t": self._abs_time(best)})
                continue
            rejected.append({"camera_id": cam_id, "best_similarity": round(best_score, 3), "reason": reason})

        if target:
            anchor = {"trk": target, "score": 1.0, "z": None, "margin": None, "cam": target.camera_id,
                      "t": self._abs_time(target), "origin": True}
        elif accepted:
            anchor = max(accepted, key=lambda n: n["z"])
            accepted.remove(anchor)
            anchor["origin"] = True
        else:
            return {"status": "success", "speed_mode": speed_mode, "target": None, "total_hops": 0,
                    "total_distance_meters": 0.0, "total_duration_seconds": 0.0, "journey_steps": [],
                    "rejected_cameras": rejected, "baseline_similarity": round(baseline, 3),
                    "limitation": LIMITATION, "message": "No camera had a distinctive match for this target."}

        # 3. Grow the route from the anchor in both directions through feasible camera changes
        def link(a: dict, b: dict) -> Optional[float]:
            ok, _, dist = self.graph.check_transition_feasibility(a["cam"], a["t"], b["cam"], b["t"], speed_mode=speed_mode)
            if not ok or a["cam"] == b["cam"]:
                return None
            return self.graph.calculate_delay_probability(b["t"] - a["t"], dist, speed_mode=speed_mode)

        forward, backward, pool = [], [], list(accepted)
        current = anchor
        while len(forward) < MAX_HOPS:
            options = [(n["z"] * p, n) for n in pool if n["t"] > current["t"] and (p := link(current, n))]
            if not options:
                break
            current = max(options, key=lambda o: o[0])[1]
            forward.append(current)
            pool = [n for n in pool if n["t"] > current["t"]]
        pool, current = [n for n in accepted if n["t"] < anchor["t"]], anchor
        while len(backward) < MAX_HOPS:
            options = [(n["z"] * p, n) for n in pool if n["t"] < current["t"] and (p := link(n, current))]
            if not options:
                break
            current = max(options, key=lambda o: o[0])[1]
            backward.append(current)
            pool = [n for n in pool if n["t"] < current["t"]]
        route = list(reversed(backward)) + [anchor] + forward

        steps, total_dist = [], 0.0
        for i, node in enumerate(route, start=1):
            dist = speed_kmh = 0.0
            temporal = spatial = 1.0
            if i > 1:
                prev = route[i - 2]
                dist = self.graph.get_distance(prev["cam"], node["cam"])
                dt = node["t"] - prev["t"]
                speed_kmh = round(dist / dt * 3.6, 1) if dt > 0 else 0.0
                temporal = round(self.graph.calculate_delay_probability(dt, dist, speed_mode=speed_mode), 2)
                spatial = round(self.graph.get_spatial_topology_score(prev["cam"], node["cam"]), 2)
                total_dist += dist
            step = self._format_node(node["trk"], node["score"], i, abs_timestamp=node["t"],
                                     speed_to_here_kmh=speed_kmh, dist_from_prev_m=round(dist, 1),
                                     temporal_score=temporal, spatial_score=spatial)
            step["is_origin"] = bool(node.get("origin"))
            step["visual_similarity"] = round(node["score"], 3)
            step["distinctiveness_z"] = round(node["z"], 2) if node["z"] is not None else None
            step["runner_up_margin"] = round(node["margin"], 3) if node["margin"] is not None else None
            steps.append(step)

        return {
            "status": "success",
            "speed_mode": speed_mode,
            "target": target.to_dict() if target else None,
            "total_hops": len(steps),
            "total_distance_meters": round(total_dist, 1),
            "total_duration_seconds": round(route[-1]["t"] - route[0]["t"], 1) if len(route) > 1 else 0.0,
            "journey_steps": steps,
            "rejected_cameras": rejected,
            "baseline_similarity": round(baseline, 3),
            "method": (f"anchored route; camera accepted when best sighting z >= {MIN_DISTINCTIVENESS_Z} "
                       f"and beats runner-up by >= {MIN_RUNNER_UP_MARGIN}; feasible {speed_mode} transitions only"),
            "limitation": LIMITATION,
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
