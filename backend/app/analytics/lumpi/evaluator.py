import os
import json
import math
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
import numpy as np
from loguru import logger

from app.config import get_data_path
from app.analytics.lumpi.adapter import LumpiAdapter, LumpiTrackletObservation, sighting_distance_m
from app.analytics.camera_graph import SPEED_BOUNDS

# Two sightings whose time gap is at most this are treated as a simultaneous handover between
# overlapping cameras rather than a journey leg that has to satisfy a speed envelope.
HANDOVER_GAP_S = 0.05


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    a = np.array(v1, dtype=np.float32)
    b = np.array(v2, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


class LumpiEvaluator:
    """
    Evaluation Engine for TraceNet Multi-Camera Journey Reconstruction.
    Runs TraceNet's spatial-temporal DAG trajectory algorithm against ground-truth
    multi-camera observations from the LUMPI benchmark dataset.
    """

    def __init__(self, adapter: Optional[LumpiAdapter] = None):
        self.adapter = adapter or LumpiAdapter()
        self.results_dir = get_data_path("evaluation/lumpi")
        os.makedirs(self.results_dir, exist_ok=True)
        self.latest_report_file = os.path.join(self.results_dir, "latest_evaluation_report.json")

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _object_distance_m(a: LumpiTrackletObservation, b: LumpiTrackletObservation) -> float:
        """Ground-plane distance the object must cover from sighting A to sighting B (co-temporal for handovers)."""
        return sighting_distance_m(a, b)

    @staticmethod
    def _similarity_profile(observations: List[LumpiTrackletObservation], gate: float) -> Dict[str, Any]:
        """How separable the identities are visually: same-object vs. best impostor similarity."""
        embs = [o.embedding for o in observations if o.embedding]
        if len(embs) < 2 or len(embs) != len(observations):
            return {"mean_same_object_similarity": None, "mean_best_impostor_similarity": None, "impostors_above_gate_ratio": None}
        E = np.asarray(embs, dtype=np.float32)
        E = E / np.clip(np.linalg.norm(E, axis=1, keepdims=True), 1e-9, None)
        S = E @ E.T
        ids = np.asarray([o.ground_truth_id for o in observations])
        same = ids[:, None] == ids[None, :]
        np.fill_diagonal(same, False)
        diff = ids[:, None] != ids[None, :]

        same_vals = S[same]
        best_impostor = np.where(diff, S, -1.0).max(axis=1)
        has_impostor = diff.any(axis=1)
        return {
            "mean_same_object_similarity": round(float(same_vals.mean()), 4) if same_vals.size else None,
            "mean_best_impostor_similarity": round(float(best_impostor[has_impostor].mean()), 4) if has_impostor.any() else None,
            "impostors_above_gate_ratio": round(float((best_impostor[has_impostor] >= gate).mean()), 4) if has_impostor.any() else None
        }

    @staticmethod
    def _recommendations(
        precision: float, recall: float, idsw: int, fn: int, mean_time_error: float,
        profile: Dict[str, Any], min_visual_similarity: float, handover_radius_m: float, evaluation_mode: str
    ) -> List[str]:
        recs: List[str] = []
        impostor_ratio = profile.get("impostors_above_gate_ratio")
        if impostor_ratio is not None and impostor_ratio > 0:
            recs.append(
                f"{impostor_ratio:.0%} of sightings have a visual impostor above the {min_visual_similarity:.2f} similarity gate; "
                "the spatiotemporal feasibility check is doing the disambiguation."
            )
        if idsw > 0:
            recs.append(
                f"{idsw} identity switch{'es' if idsw != 1 else ''} were committed: raise min_visual_similarity or visual_weight, "
                f"or tighten handover_radius_m (currently {handover_radius_m:.0f} m)."
            )
        if fn > 0:
            severity = "Low recall" if recall < 0.6 else "Recall"
            recs.append(
                f"{severity} {recall:.0%}: {fn} ground-truth camera transition{'s were' if fn != 1 else ' was'} not linked. "
                f"Inspect the per-target audit; lower min_visual_similarity (currently {min_visual_similarity:.2f}) if the missed "
                f"sightings fell below the gate, or widen handover_radius_m (currently {handover_radius_m:.0f} m) if they were same-time handovers."
            )
        if mean_time_error > 2.0:
            recs.append(
                f"Mean transit-time error {mean_time_error:.1f}s exceeds the 2.0s camera-clock synchronisation target."
            )
        if evaluation_mode == "nearest-camera":
            recs.append("Dataset has no camera calibration; sightings were attributed by nearest camera position instead of projection.")
        if not recs and recall >= 1.0 and idsw == 0:
            recs.append("Current weights reproduce every ground-truth journey with no identity switches; keep this configuration as the deployment baseline.")
        elif not recs:
            recs.append(f"Precision {precision:.0%} / recall {recall:.0%} with no identity switches; see the per-target audit for the remaining gaps.")
        return recs

    # ------------------------------------------------------------------ main

    def run_evaluation(
        self,
        experiment_id: int = 1,
        min_visual_similarity: float = 0.45,
        visual_weight: float = 0.55,
        temporal_weight: float = 0.25,
        spatial_weight: float = 0.20,
        embedding_noise_sigma: float = 0.05,
        handover_radius_m: float = 15.0
    ) -> Dict[str, Any]:
        """
        Executes benchmark evaluation on the loaded LUMPI sequence.
        Returns comprehensive precision, recall, IDSW, and link audit metrics.
        """
        load_summary = self.adapter.load_dataset(experiment_id=experiment_id, embedding_noise_sigma=embedding_noise_sigma)
        journeys = self.adapter.ground_truth_journeys
        observations = self.adapter.observations
        cameras = self.adapter.cameras
        evaluation_mode = load_summary.get("evaluation_mode", self.adapter.evaluation_mode)

        total_gt_transitions = 0
        total_reconstructed_links = 0
        true_positive_links = 0
        false_positive_links = 0
        false_negative_links = 0
        identity_switches = 0
        transit_time_errors: List[float] = []
        fully_recovered_routes = 0

        class_metrics = {
            "person": {"gt_links": 0, "tp": 0, "fp": 0, "fn": 0, "idsw": 0},
            "vehicle": {"gt_links": 0, "tp": 0, "fp": 0, "fn": 0, "idsw": 0}
        }
        audited_examples: List[Dict[str, Any]] = []

        multi_cam_targets = [j for j in journeys.values() if len(j.observations) > 1]
        logger.info(f"Starting LUMPI Multi-Camera evaluation on {len(multi_cam_targets)} multi-camera ground-truth targets...")

        for target in multi_cam_targets:
            gt_id = target.object_id
            obj_type = target.object_type
            gt_obs_list = target.observations
            speed_mode = "vehicle" if obj_type == "vehicle" else "pedestrian"
            bounds = SPEED_BOUNDS.get(speed_mode, SPEED_BOUNDS["pedestrian"])

            num_target_gt_transitions = len(gt_obs_list) - 1
            total_gt_transitions += num_target_gt_transitions
            if obj_type in class_metrics:
                class_metrics[obj_type]["gt_links"] += num_target_gt_transitions

            # The query is the earliest sighting of the target
            query_obs = gt_obs_list[0]
            query_emb = query_obs.embedding

            # 1. Candidate retrieval: visual gate over every sighting in the experiment
            candidates: List[Dict[str, Any]] = []
            for obs in observations:
                if obs.observation_id == query_obs.observation_id:
                    sim = 1.0
                else:
                    sim = cosine_similarity(query_emb, obs.embedding) if (query_emb and obs.embedding) else 0.5
                if sim >= min_visual_similarity or obs.observation_id == query_obs.observation_id:
                    candidates.append({
                        "observation": obs,
                        "start_time": obs.start_time,
                        "end_time": obs.end_time,
                        "cam_id": obs.camera_id,
                        "visual_score": sim,
                        "ground_truth_id": obs.ground_truth_id
                    })
            candidates.sort(key=lambda c: (c["start_time"], c["cam_id"], c["observation"].observation_id))
            query_idx = next(i for i, c in enumerate(candidates) if c["observation"].observation_id == query_obs.observation_id)

            # 2. DAG longest-path DP anchored at the query sighting
            #    dp[k] = (path_score, predecessor, cumulative_distance_m, last_speed_mps)
            neg_inf = float("-inf")
            dp: List[tuple] = [(neg_inf, -1, 0.0, 0.0) for _ in candidates]
            dp[query_idx] = (1.0, -1, 0.0, 0.0)

            for i in range(query_idx, len(candidates)):
                if dp[i][0] == neg_inf:
                    continue
                curr = candidates[i]
                for j in range(i + 1, len(candidates)):
                    nxt = candidates[j]
                    gap = nxt["start_time"] - curr["end_time"]

                    # The same camera cannot see one object twice at the same moment
                    if curr["cam_id"] == nxt["cam_id"] and gap < 0.0:
                        continue

                    dist_m = self._object_distance_m(curr["observation"], nxt["observation"])

                    if gap <= HANDOVER_GAP_S:
                        # Overlapping fields of view: the object is handed over, not travelling
                        is_feasible = dist_m <= handover_radius_m
                        temporal_p = 1.0
                        speed_mps = 0.0
                    else:
                        speed_mps = dist_m / gap
                        is_feasible = speed_mps <= bounds["v_max"] * 1.5
                        v_ideal = bounds.get("v_ideal", 1.4)
                        ideal_time = dist_m / v_ideal if v_ideal > 0 else 1.0
                        time_ratio = gap / max(ideal_time, 0.1)
                        temporal_p = math.exp(-0.5 * ((time_ratio - 1.0) / 0.8) ** 2)

                    if not is_feasible:
                        continue

                    spatial_s = 1.0 if dist_m <= 150.0 else max(0.2, 1.0 - (dist_m - 150.0) / 500.0)
                    joint_score = (visual_weight * nxt["visual_score"]) + (temporal_weight * temporal_p) + (spatial_weight * spatial_s)
                    new_path_score = dp[i][0] + joint_score
                    if new_path_score > dp[j][0]:
                        dp[j] = (new_path_score, i, dp[i][2] + dist_m, speed_mps)

            # 3. Trace back the best path that starts at the query
            best_end_idx = max(range(len(candidates)), key=lambda idx: dp[idx][0])
            path_indices: List[int] = []
            curr_idx = best_end_idx
            while curr_idx != -1:
                path_indices.append(curr_idx)
                curr_idx = dp[curr_idx][1]
            path_indices.reverse()
            reconstructed_route = [candidates[k] for k in path_indices]

            # 4. Compare reconstructed links with the ground-truth transitions
            target_tps = 0
            target_fps = 0
            target_idsw = 0
            has_error = False
            route_time_errors: List[float] = []

            for s_idx in range(len(reconstructed_route) - 1):
                from_step = reconstructed_route[s_idx]
                to_step = reconstructed_route[s_idx + 1]
                total_reconstructed_links += 1

                is_correct = (from_step["ground_truth_id"] == gt_id) and (to_step["ground_truth_id"] == gt_id)
                if is_correct:
                    true_positive_links += 1
                    target_tps += 1
                    if obj_type in class_metrics:
                        class_metrics[obj_type]["tp"] += 1

                    gt_transit = next(
                        (t for t in target.transitions
                         if t["from_camera"] == from_step["cam_id"] and t["to_camera"] == to_step["cam_id"]),
                        None
                    )
                    if gt_transit:
                        pred_transit = max(0.0, to_step["start_time"] - from_step["end_time"])
                        error_s = abs(pred_transit - gt_transit["transit_time_seconds"])
                        transit_time_errors.append(error_s)
                        route_time_errors.append(error_s)
                else:
                    false_positive_links += 1
                    target_fps += 1
                    target_idsw += 1
                    identity_switches += 1
                    has_error = True
                    if obj_type in class_metrics:
                        class_metrics[obj_type]["fp"] += 1
                        class_metrics[obj_type]["idsw"] += 1

            target_fns = max(0, num_target_gt_transitions - target_tps)
            false_negative_links += target_fns
            if obj_type in class_metrics:
                class_metrics[obj_type]["fn"] += target_fns

            perfect = (not has_error) and target_tps == num_target_gt_transitions
            if perfect:
                fully_recovered_routes += 1

            audited_examples.append({
                "target_ground_truth_id": gt_id,
                "object_type": obj_type,
                "lumpi_class": gt_obs_list[0].class_id,
                "ground_truth_cams": [o.camera_id for o in gt_obs_list],
                "ground_truth_transitions_count": num_target_gt_transitions,
                "ground_truth_handovers": sum(1 for t in target.transitions if t.get("is_handover")),
                "reconstructed_cams": [r["cam_id"] for r in reconstructed_route],
                "reconstructed_gt_ids": [r["ground_truth_id"] for r in reconstructed_route],
                "candidate_count": len(candidates),
                "status": "PERFECT_MATCH" if perfect else "PARTIAL_OR_SWITCH",
                "tp_links": target_tps,
                "fp_links": target_fps,
                "fn_links": target_fns,
                "mean_transit_error_seconds": round(float(np.mean(route_time_errors)), 2) if route_time_errors else None
            })

        # Summary metrics
        precision = (true_positive_links / total_reconstructed_links) if total_reconstructed_links > 0 else 0.0
        recall = (true_positive_links / total_gt_transitions) if total_gt_transitions > 0 else 0.0
        f1_score = (2.0 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        mean_time_error = float(np.mean(transit_time_errors)) if transit_time_errors else 0.0

        for c_type in class_metrics:
            m = class_metrics[c_type]
            tot_p = m["tp"] + m["fp"]
            tot_r = m["gt_links"]
            m["precision"] = round((m["tp"] / tot_p) if tot_p > 0 else 0.0, 4)
            m["recall"] = round((m["tp"] / tot_r) if tot_r > 0 else 0.0, 4)
            p_val, r_val = m["precision"], m["recall"]
            m["f1"] = round((2.0 * p_val * r_val / (p_val + r_val)) if (p_val + r_val) > 0 else 0.0, 4)

        profile = self._similarity_profile(observations, min_visual_similarity)
        recommendations = self._recommendations(
            precision, recall, identity_switches, false_negative_links, mean_time_error,
            profile, min_visual_similarity, handover_radius_m, evaluation_mode
        )

        report = {
            "status": "success",
            "benchmark_dataset": "LUMPI-MultiCamera-Evaluation",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dataset_path": self.adapter.dataset_path,
            "dataset_kind": load_summary.get("dataset_kind"),
            "evaluation_mode": evaluation_mode,
            "experiment_id": experiment_id,
            "cameras_evaluated": len(cameras),
            "camera_sessions": [
                {
                    "camera_id": c.camera_id,
                    "device_id": c.device_id,
                    "fps": c.fps,
                    "image_size": [c.image_width, c.image_height],
                    "sightings": load_summary.get("per_camera_observation_counts", {}).get(c.camera_id, 0)
                }
                for c in cameras.values()
            ],
            "observations_count": len(observations),
            "objects_count": len(journeys),
            "multi_camera_targets_count": len(multi_cam_targets),
            "total_ground_truth_transitions": total_gt_transitions,
            "total_reconstructed_links": total_reconstructed_links,
            "metrics": {
                "link_precision": round(precision, 4),
                "link_recall": round(recall, 4),
                "link_f1_score": round(f1_score, 4),
                "total_true_positives": true_positive_links,
                "total_false_positives": false_positive_links,
                "total_false_negatives": false_negative_links,
                "identity_switches": identity_switches,
                "mean_transit_time_error_seconds": round(mean_time_error, 2),
                "route_continuity_rate": round(fully_recovered_routes / max(len(multi_cam_targets), 1), 4)
            },
            "class_breakdown": class_metrics,
            "similarity_profile": profile,
            "weights_configuration": {
                "min_visual_similarity": min_visual_similarity,
                "visual_weight": visual_weight,
                "temporal_weight": temporal_weight,
                "spatial_weight": spatial_weight,
                "embedding_noise_sigma": embedding_noise_sigma,
                "handover_radius_m": handover_radius_m
            },
            "tuning_recommendations": recommendations,
            "summary_text": (
                f"LUMPI Benchmark Evaluation (Exp {experiment_id}, {evaluation_mode}): "
                f"Precision={precision:.1%}, Recall={recall:.1%}, F1={f1_score:.4f}, "
                f"ID Switches={identity_switches}, Time Error={mean_time_error:.2f}s across {len(cameras)} cameras."
            ),
            "audited_examples": audited_examples
        }

        try:
            with open(self.latest_report_file, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
            logger.info(f"LUMPI evaluation report saved to {self.latest_report_file}")
        except Exception as e:
            logger.warning(f"Could not write evaluation report to disk: {e}")

        return report

    def get_latest_report(self) -> Optional[Dict[str, Any]]:
        """Retrieves previously computed evaluation report if it exists."""
        if os.path.exists(self.latest_report_file):
            try:
                with open(self.latest_report_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
        return None
