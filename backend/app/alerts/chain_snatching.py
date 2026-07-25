"""
Chain Snatching & Violent Theft Analyzer — 4 FPS Post-Processing Pass over detections.json.

Eligibility:
  The video must contain detections for both 'person' and a vehicle class
  ('motorcycle', 'two-wheeler', 'scooter', 'bicycle', 'vehicle', 'car').

Algorithm:
  Replays frame timeline from detections.json at 4 FPS (Delta T = 250ms).
  Evaluates 3 Spatiotemporal Rules:
    - Rule A: High-Risk Proximity Spike (Vehicle & Person distance < proximity_threshold_px)
    - Rule B: Victim Fall Anomaly (Aspect ratio H/W flips from vertical > 1.1 to horizontal < fall_aspect_ratio_trigger)
    - Rule C: Post-Impact Chase Vector (Person speed accelerates > chase_velocity_multiplier with Cosine Sim > chase_vector_cosine_sim)
  
Writes Alert rows with alert_type='chain_snatching' to SQLite.
"""

import json
import math
import os
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple
from loguru import logger

from app.config import get_data_path

VEHICLE_CLASS_KEYWORDS = [
    "motorcycle", "bike", "scooter", "two-wheeler",
    "vehicle", "car", "bicycle", "auto", "moped"
]

PERSON_CLASS_KEYWORDS = [
    "person", "pedest", "human", "man", "woman", "peopl",
    "walk", "rid", "passeng", "bystand", "child", "adult"
]


def _is_person_detection(det: dict) -> bool:
    if det.get("object_type") == "person":
        return True
    cname = (det.get("class_name") or "").lower()
    return any(k in cname for k in PERSON_CLASS_KEYWORDS)


def _is_vehicle_detection(det: dict) -> bool:
    if det.get("object_type") in ["vehicle", "motorcycle", "two-wheeler"]:
        return True
    cname = (det.get("class_name") or "").lower()
    return any(k in cname for k in VEHICLE_CLASS_KEYWORDS)


def _center(bbox: List[float]) -> Tuple[float, float]:
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _aspect_ratio(bbox: List[float]) -> float:
    x1, y1, x2, y2 = bbox
    w = max(1.0, x2 - x1)
    h = max(1.0, y2 - y1)
    return h / w


def _cosine_similarity(v1: Tuple[float, float], v2: Tuple[float, float]) -> float:
    mag1 = math.sqrt(v1[0] ** 2 + v1[1] ** 2)
    mag2 = math.sqrt(v2[0] ** 2 + v2[1] ** 2)
    if mag1 < 1e-5 or mag2 < 1e-5:
        return 0.0
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    return max(-1.0, min(1.0, dot / (mag1 * mag2)))


@dataclass
class ProximityEvent:
    person_trid: int
    vehicle_trid: int
    frame_idx: int
    timestamp_sec: float
    distance_px: float


@dataclass
class PersonKinematics:
    tracker_id: int
    tracklet_id: str
    class_name: str
    bbox_history: List[Tuple[int, List[float]]] = field(default_factory=list)      # [(frame, bbox)]
    center_history: List[Tuple[int, Tuple[float, float]]] = field(default_factory=list) # [(frame, (cx, cy))]
    aspect_history: List[Tuple[int, float]] = field(default_factory=list)        # [(frame, aspect_ratio)]
    velocity_history: List[Tuple[int, Tuple[float, float]]] = field(default_factory=list) # [(frame, (vx, vy))]
    is_fallen: bool = False
    is_chasing: bool = False
    alert_triggered: bool = False
    best_crop_path: Optional[str] = None


@dataclass
class VehicleKinematics:
    tracker_id: int
    tracklet_id: str
    class_name: str
    center_history: List[Tuple[int, Tuple[float, float]]] = field(default_factory=list)
    velocity_history: List[Tuple[int, Tuple[float, float]]] = field(default_factory=list)
    best_crop_path: Optional[str] = None


class ChainSnatchingAnalyzer:
    def __init__(
        self,
        proximity_threshold_px: int = 120,
        fall_aspect_ratio_trigger: float = 0.85,
        fall_frame_window: int = 2,
        chase_velocity_multiplier: float = 3.0,
        chase_vector_cosine_sim: float = 0.75,
        observation_window_frames: int = 4,
    ):
        self.proximity_threshold_px = proximity_threshold_px
        self.fall_aspect_ratio_trigger = fall_aspect_ratio_trigger
        self.fall_frame_window = fall_frame_window
        self.chase_velocity_multiplier = chase_velocity_multiplier
        self.chase_vector_cosine_sim = chase_vector_cosine_sim
        self.observation_window_frames = observation_window_frames

    def analyze_video(
        self,
        video_id: str,
        model_classes: list,
        db,
        progress_callback=None,
    ) -> dict:
        log_entries = []

        # 1. Eligibility Check
        model_class_names_lower = {c.lower() for c in model_classes} if model_classes else set()
        has_person_class = any(any(k in c for k in PERSON_CLASS_KEYWORDS) for c in model_class_names_lower) or not model_classes
        has_vehicle_class = any(any(k in c for k in VEHICLE_CLASS_KEYWORDS) for c in model_class_names_lower) or not model_classes

        if not (has_person_class and has_vehicle_class):
            reason = (
                f"Model lacks both Person and Vehicle classes for Chain Snatching analysis. "
                f"Model classes: {sorted(model_class_names_lower)}."
            )
            log_entries.append(f"[SKIP] {reason}")
            logger.info(f"[ChainSnatchingAnalyzer] Video {video_id}: {reason}")
            return {
                "eligible": False,
                "skip_reason": reason,
                "alerts_created": 0,
                "log_entries": log_entries,
                "evaluated_video_id": video_id,
            }

        log_entries.append("[OK] Model contains Person and Vehicle tracking capabilities.")

        # 2. Load detections.json
        detections_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
        if not os.path.exists(detections_path):
            reason = f"detections.json not found at {detections_path}. Run detection first."
            log_entries.append(f"[ERROR] {reason}")
            return {
                "eligible": True,
                "skip_reason": reason,
                "alerts_created": 0,
                "log_entries": log_entries,
                "evaluated_video_id": video_id,
            }

        with open(detections_path, "r", encoding="utf-8") as f:
            det_data = json.load(f)

        fps = float(det_data.get("fps", 4.0)) or 4.0
        frame_detections = det_data.get("frame_detections", [])
        tracklet_summaries = {t["tracker_id"]: t for t in det_data.get("tracklets", [])}

        log_entries.append(f"[INFO] Replaying {len(frame_detections)} frames at {fps:.1f} FPS")
        log_entries.append(
            f"[INFO] Proximity Threshold={self.proximity_threshold_px}px, Fall Aspect Ratio Trigger={self.fall_aspect_ratio_trigger}"
        )

        person_registry: Dict[int, PersonKinematics] = {}
        vehicle_registry: Dict[int, VehicleKinematics] = {}
        proximity_events: List[ProximityEvent] = []
        alerts_to_create = []

        total_frames = len(frame_detections)

        # 3. Frame-by-frame Kinematic Replay
        for idx, frame_data in enumerate(frame_detections):
            if progress_callback and total_frames > 0:
                progress_callback(int((idx / total_frames) * 100))

            frame_idx = frame_data["frame_index"]
            timestamp_sec = frame_data["timestamp_seconds"]
            detections = frame_data.get("detections", [])

            current_persons: Dict[int, dict] = {}
            current_vehicles: Dict[int, dict] = {}

            for det in detections:
                trid = det.get("tracker_id")
                if trid is None:
                    continue
                if _is_person_detection(det):
                    current_persons[trid] = det
                elif _is_vehicle_detection(det):
                    current_vehicles[trid] = det

            # Update Person Registry
            for trid, det in current_persons.items():
                bbox = det.get("bbox", [0, 0, 1, 1])
                cx, cy = _center(bbox)
                ar = _aspect_ratio(bbox)
                
                if trid not in person_registry:
                    summary = tracklet_summaries.get(trid, {})
                    person_registry[trid] = PersonKinematics(
                        tracker_id=trid,
                        tracklet_id=f"{video_id}_trk_{trid}",
                        class_name=det.get("class_name", "person"),
                        best_crop_path=summary.get("best_crop_path"),
                    )

                p = person_registry[trid]
                p.bbox_history.append((frame_idx, bbox))
                p.center_history.append((frame_idx, (cx, cy)))
                p.aspect_history.append((frame_idx, ar))

                # Compute 2-frame velocity vector (Delta T = 500ms at 4 FPS)
                if len(p.center_history) >= 3:
                    prev_f, prev_c = p.center_history[-3]
                    vx = cx - prev_c[0]
                    vy = cy - prev_c[1]
                    p.velocity_history.append((frame_idx, (vx, vy)))
                else:
                    p.velocity_history.append((frame_idx, (0.0, 0.0)))

            # Update Vehicle Registry
            for trid, det in current_vehicles.items():
                bbox = det.get("bbox", [0, 0, 1, 1])
                cx, cy = _center(bbox)
                if trid not in vehicle_registry:
                    summary = tracklet_summaries.get(trid, {})
                    vehicle_registry[trid] = VehicleKinematics(
                        tracker_id=trid,
                        tracklet_id=f"{video_id}_trk_{trid}",
                        class_name=det.get("class_name", "vehicle"),
                        best_crop_path=summary.get("best_crop_path"),
                    )

                v = vehicle_registry[trid]
                v.center_history.append((frame_idx, (cx, cy)))
                if len(v.center_history) >= 3:
                    prev_f, prev_c = v.center_history[-3]
                    vx = cx - prev_c[0]
                    vy = cy - prev_c[1]
                    v.velocity_history.append((frame_idx, (vx, vy)))
                else:
                    v.velocity_history.append((frame_idx, (0.0, 0.0)))

            # RULE A: Evaluate Vehicle-Person Proximity Spikes
            for pid, pdet in current_persons.items():
                pcx, pcy = _center(pdet.get("bbox", [0, 0, 1, 1]))
                for vid, vdet in current_vehicles.items():
                    vcx, vcy = _center(vdet.get("bbox", [0, 0, 1, 1]))
                    dist = _dist((pcx, pcy), (vcx, vcy))
                    if dist < self.proximity_threshold_px:
                        proximity_events.append(
                            ProximityEvent(
                                person_trid=pid,
                                vehicle_trid=vid,
                                frame_idx=frame_idx,
                                timestamp_sec=timestamp_sec,
                                distance_px=dist,
                            )
                        )
                        log_entries.append(
                            f"[PROXIMITY_SPIKE] Person #{pid} & Vehicle #{vid} distance={dist:.1f}px at frame {frame_idx} (ts={timestamp_sec:.1f}s)"
                        )

            # RULE B & RULE C Evaluation
            recent_events = [
                pe for pe in proximity_events
                if frame_idx - pe.frame_idx <= self.observation_window_frames
            ]

            for pevent in recent_events:
                pid = pevent.person_trid
                vid = pevent.vehicle_trid
                if pid not in person_registry or person_registry[pid].alert_triggered:
                    continue

                p_kin = person_registry[pid]
                v_kin = vehicle_registry.get(vid)

                # RULE B: Victim Fall Anomaly (Aspect ratio drop from > 1.1 to < trigger in <= fall_frame_window frames)
                if len(p_kin.aspect_history) >= 2 and not p_kin.is_fallen:
                    recent_aspects = [ar for fi, ar in p_kin.aspect_history[-self.fall_frame_window - 1:]]
                    if len(recent_aspects) >= 2:
                        max_prior_ar = max(recent_aspects[:-1])
                        curr_ar = recent_aspects[-1]
                        if max_prior_ar > 1.1 and curr_ar < self.fall_aspect_ratio_trigger:
                            p_kin.is_fallen = True
                            log_entries.append(
                                f"[VICTIM_FALL] Person #{pid} aspect ratio dropped from {max_prior_ar:.2f} to {curr_ar:.2f} "
                                f"following proximity with Vehicle #{vid} at frame {frame_idx}"
                            )

                # RULE C: Post-Impact Chase Vector (Velocity acceleration & vector alignment)
                if v_kin and len(p_kin.velocity_history) >= 2 and len(v_kin.velocity_history) >= 2:
                    p_vx, p_vy = p_kin.velocity_history[-1][1]
                    v_vx, v_vy = v_kin.velocity_history[-1][1]

                    p_speed = math.sqrt(p_vx ** 2 + p_vy ** 2)
                    # Baseline average speed over earlier frames
                    earlier_speeds = [
                        math.sqrt(vx ** 2 + vy ** 2) for _, (vx, vy) in p_kin.velocity_history[:-1]
                    ]
                    avg_baseline_speed = (sum(earlier_speeds) / len(earlier_speeds)) if earlier_speeds else 1.0
                    avg_baseline_speed = max(2.0, avg_baseline_speed)

                    cos_sim = _cosine_similarity((p_vx, p_vy), (v_vx, v_vy))

                    if p_speed > (avg_baseline_speed * self.chase_velocity_multiplier) and cos_sim > self.chase_vector_cosine_sim:
                        p_kin.is_chasing = True
                        log_entries.append(
                            f"[CHASE_VECTOR] Person #{pid} speed={p_speed:.1f}px/f (base={avg_baseline_speed:.1f}) "
                            f"aligned with Vehicle #{vid} (CosSim={cos_sim:.2f}) at frame {frame_idx}"
                        )

                # Trigger Alert Gate: Proximity + (Fall OR Chase)
                if (p_kin.is_fallen or p_kin.is_chasing) and not p_kin.alert_triggered:
                    p_kin.alert_triggered = True
                    log_entries.append(
                        f"[CHAIN_SNATCHING_ALERT] TRIGGERED for Person #{pid} (Victim) & Vehicle #{vid} (Suspect) "
                        f"at frame {frame_idx} (ts={timestamp_sec:.1f}s)"
                    )
                    alerts_to_create.append((p_kin, v_kin, timestamp_sec))

        # 4. Write Alerts to SQLite Database
        from app.db.models import Alert
        alerts_created = 0

        for p_kin, v_kin, ts in alerts_to_create:
            try:
                existing = db.query(Alert).filter(
                    Alert.video_id == video_id,
                    Alert.alert_type == "chain_snatching",
                    Alert.tracklet_id == p_kin.tracklet_id
                ).first()

                if existing:
                    continue

                alert = Alert(
                    alert_type="chain_snatching",
                    tracklet_id=p_kin.tracklet_id,
                    camera_id="",  # Updated by caller API handler
                    video_id=video_id,
                    object_tracklet_id=v_kin.tracklet_id if v_kin else None,
                    owner_tracklet_ids=json.dumps([p_kin.tracklet_id]),
                    visitor_tracklet_ids=json.dumps([v_kin.tracklet_id]) if v_kin else "[]",
                    abandon_duration_seconds=0.0,
                    analysis_log=json.dumps(log_entries[-12:]),
                )
                db.add(alert)
                db.flush()
                alerts_created += 1
            except Exception as e:
                logger.error(f"Failed to create Chain Snatching alert for tracklet {p_kin.tracklet_id}: {e}")

        db.commit()
        if progress_callback:
            progress_callback(100)

        log_entries.append(f"[DONE] {alerts_created} chain snatching alert(s) created for video {video_id}")
        return {
            "eligible": True,
            "skip_reason": None,
            "alerts_created": alerts_created,
            "log_entries": log_entries,
            "evaluated_video_id": video_id,
        }
