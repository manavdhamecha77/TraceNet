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

SUSPECT_VEHICLE_KEYWORDS = [
    "motorcycle", "bike", "scooter", "two-wheeler",
    "moped", "bicycle", "auto", "vehicle"
]

EXCLUDED_VEHICLE_KEYWORDS = [
    "bus", "truck", "train", "van", "lorry", "container"
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
    cname = (det.get("class_name") or "").lower()
    # Explicitly exclude heavy vehicles like buses and trucks
    if any(k in cname for k in EXCLUDED_VEHICLE_KEYWORDS):
        return False
    if det.get("object_type") in ["motorcycle", "two-wheeler"]:
        return True
    return any(k in cname for k in SUSPECT_VEHICLE_KEYWORDS)


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


def _is_rider(person_bbox: List[float], vehicle_bbox: List[float]) -> bool:
    """Returns True if the person's bounding box significantly overlaps with the vehicle bounding box (riding)."""
    px1, py1, px2, py2 = person_bbox
    vx1, vy1, vx2, vy2 = vehicle_bbox

    inter_x1 = max(px1, vx1)
    inter_y1 = max(py1, vy1)
    inter_x2 = min(px2, vx2)
    inter_y2 = min(py2, vy2)

    if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
        return False

    inter_area = (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
    p_area = max(1.0, (px2 - px1) * (py2 - py1))

    # If >25% of the person bounding box overlaps with the vehicle box, they are riding the vehicle
    return (inter_area / p_area) > 0.25


def _upper_body_neck_zone(person_bbox: List[float]) -> Tuple[float, float]:
    """Returns the center (cx, cy) of the upper 30% of a person's bounding box (Head / Neck / Chain zone)."""
    x1, y1, x2, y2 = person_bbox
    h = y2 - y1
    cx = (x1 + x2) / 2.0
    cy = y1 + (0.25 * h)
    return (cx, cy)


@dataclass
class ProximityEvent:
    person_trid: int          # Pedestrian (Victim) ID
    vehicle_trid: int         # Suspect Vehicle ID
    rider_trid: Optional[int] # Suspect Rider ID (if riding vehicle)
    frame_idx: int
    timestamp_sec: float
    distance_px: float
    snatch_interaction: bool = False


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
    is_snatch_contact: bool = False
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
        enable_kinematics: bool = False,
        detection_threshold_frames: int = 4,
    ):
        self.proximity_threshold_px = proximity_threshold_px
        self.fall_aspect_ratio_trigger = fall_aspect_ratio_trigger
        self.fall_frame_window = fall_frame_window
        self.chase_velocity_multiplier = chase_velocity_multiplier
        self.chase_vector_cosine_sim = chase_vector_cosine_sim
        self.observation_window_frames = observation_window_frames
        self.enable_kinematics = enable_kinematics
        self.detection_threshold_frames = detection_threshold_frames

    def _extract_theft_frames(self, video_id: str, frame_indices: set, db) -> dict:
        """Extracts and saves specific frame images, returning a mapping of frame_idx -> relative_image_path."""
        import cv2
        from app.db.models import VideoAsset, CameraProfile
        from app.preprocess.preprocessor import sanitize_filename
        from app.config import get_data_path
        
        mapping = {}
        if not frame_indices:
            return mapping
            
        try:
            video_record = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
            if not video_record:
                return mapping
                
            camera_id = video_record.camera_id
            camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
            camera_name = camera.name if camera else camera_id
            camera_dir_name = f"{camera_id}_{sanitize_filename(camera_name)}"
            camera_dir = get_data_path(os.path.join("cameras", camera_dir_name))
            video_path = os.path.join(camera_dir, "original_assets", video_record.standardized_filename)
            
            if not os.path.exists(video_path):
                return mapping
                
            # Create folder
            theft_frames_dir = get_data_path(os.path.join("processed/detections", video_id, "theft_frames"))
            os.makedirs(theft_frames_dir, exist_ok=True)
            
            cap = cv2.VideoCapture(video_path)
            frame_idx = 0
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_idx in frame_indices:
                    out_name = f"frame_{frame_idx}.jpg"
                    out_p = os.path.join(theft_frames_dir, out_name)
                    cv2.imwrite(out_p, frame)
                    # Convert to relative path for frontend access
                    rel_p = f"data/processed/detections/{video_id}/theft_frames/{out_name}"
                    mapping[frame_idx] = rel_p
                frame_idx += 1
            cap.release()
        except Exception as e:
            logger.error(f"Failed to extract theft frames: {e}")
            
        return mapping

    def analyze_video(
        self,
        video_id: str,
        model_classes: list,
        db,
        progress_callback=None,
    ) -> dict:
        log_entries = []
        from app.db.models import Alert

        # 1. Eligibility Check
        model_class_names_lower = {c.lower() for c in model_classes} if model_classes else set()
        has_person_class = any(any(k in c for k in PERSON_CLASS_KEYWORDS) for c in model_class_names_lower) or not model_classes
        has_vehicle_class = any(any(k in c for k in SUSPECT_VEHICLE_KEYWORDS) for c in model_class_names_lower) or not model_classes

        if self.enable_kinematics and not (has_person_class and has_vehicle_class):
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

        log_entries.append(f"[OK] Model checks passed (enable_kinematics={self.enable_kinematics}).")

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
        total_frames = len(frame_detections)

        log_entries.append(f"[INFO] Replaying {total_frames} frames at {fps:.1f} FPS")

        if not self.enable_kinematics:
            # ───────────────────────────────────────────────────
            # MODEL-ONLY DIRECT CLASS DETECTION & RUN TIMELINE RULE
            # ───────────────────────────────────────────────────
            log_entries.append(f"[INFO] Running Model-Only theft detection (Threshold={self.detection_threshold_frames} frames)")
            consecutive_frames = 0
            theft_triggers = []
            theft_keywords = ["theft", "snatch", "stealing", "robbery", "violent"]
            
            current_streak_tracker_ids = set()
            current_streak_frames = []

            for idx, frame_data in enumerate(frame_detections):
                if progress_callback and total_frames > 0:
                    progress_callback(int((idx / total_frames) * 100))
                    
                frame_idx = frame_data["frame_index"]
                timestamp_sec = frame_data["timestamp_seconds"]
                detections = frame_data.get("detections", [])
                
                theft_detections = []
                for det in detections:
                    cname = (det.get("class_name") or "").lower()
                    if any(k in cname for k in theft_keywords):
                        theft_detections.append(det)
                
                if theft_detections:
                    consecutive_frames += 1
                    current_streak_frames.append(frame_data)
                    for td in theft_detections:
                        if td.get("tracker_id") is not None:
                            current_streak_tracker_ids.add(td["tracker_id"])
                else:
                    if consecutive_frames >= self.detection_threshold_frames:
                        theft_triggers.append({
                            "tracker_ids": list(current_streak_tracker_ids),
                            "frames": current_streak_frames.copy(),
                            "consecutive_count": consecutive_frames
                        })
                    consecutive_frames = 0
                    current_streak_tracker_ids = set()
                    current_streak_frames = []
                    
            if consecutive_frames >= self.detection_threshold_frames:
                theft_triggers.append({
                    "tracker_ids": list(current_streak_tracker_ids),
                    "frames": current_streak_frames.copy(),
                    "consecutive_count": consecutive_frames
                })

            alerts_created = 0
            for trigger in theft_triggers:
                thief_trid = trigger["tracker_ids"][0] if trigger["tracker_ids"] else None
                start_frame = trigger["frames"][0]["frame_index"]
                timestamp_sec = trigger["frames"][0]["timestamp_seconds"]
                
                first_frame_dets = trigger["frames"][0].get("detections", [])
                thief_bbox = None
                if thief_trid is not None:
                    for d in first_frame_dets:
                        if d.get("tracker_id") == thief_trid:
                            thief_bbox = d.get("bbox")
                            break
                
                victim_trid = None
                vehicle_trid = None
                min_victim_dist = float("inf")
                min_vehicle_dist = float("inf")
                
                if thief_bbox:
                    tcx, tcy = _center(thief_bbox)
                    for d in first_frame_dets:
                        trid = d.get("tracker_id")
                        if trid == thief_trid or trid is None:
                            continue
                        dbbox = d.get("bbox", [0, 0, 1, 1])
                        dcx, dcy = _center(dbbox)
                        dist = _dist((tcx, tcy), (dcx, dcy))
                        
                        if _is_person_detection(d):
                            if dist < min_victim_dist:
                                min_victim_dist = dist
                                victim_trid = trid
                        elif _is_vehicle_detection(d):
                            if dist < min_vehicle_dist:
                                min_vehicle_dist = dist
                                vehicle_trid = trid

                if thief_trid is None:
                    for f in trigger["frames"]:
                        for d in f.get("detections", []):
                            if d.get("tracker_id") is not None:
                                thief_trid = d["tracker_id"]
                                break
                        if thief_trid is not None:
                            break

                thief_tracklet_id = f"{video_id}_trk_{thief_trid}" if thief_trid is not None else None
                victim_tracklet_id = f"{video_id}_trk_{victim_trid}" if victim_trid is not None else None
                vehicle_tracklet_id = f"{video_id}_trk_{vehicle_trid}" if vehicle_trid is not None else None
                
                tracklet_to_use = thief_tracklet_id or victim_tracklet_id or f"{video_id}_trk_unknown"
                existing = db.query(Alert).filter(
                    Alert.video_id == video_id,
                    Alert.alert_type == "chain_snatching",
                    Alert.tracklet_id == tracklet_to_use
                ).first()
                if existing:
                    continue
                    
                # Extract theft frames for evidence download
                trigger_frame_idxs = {f["frame_index"] for f in trigger["frames"]}
                frame_paths = self._extract_theft_frames(video_id, trigger_frame_idxs, db)
                
                theft_frames_metadata = []
                for f in trigger["frames"]:
                    fidx = f["frame_index"]
                    if fidx in frame_paths:
                        # Map detected labels to [SUSPECT] and [VICTIM]
                        mapped_detections = []
                        for d in f.get("detections", []):
                            cname = (d.get("class_name") or "").lower()
                            mapped_d = d.copy()
                            if cname in ["theif", "thief", "suspect"]:
                                mapped_d["class_name"] = "[SUSPECT]"
                            elif cname in ["victim"]:
                                mapped_d["class_name"] = "[VICTIM]"
                            mapped_detections.append(mapped_d)
                            
                        theft_frames_metadata.append({
                            "frame_index": fidx,
                            "timestamp_seconds": f["timestamp_seconds"],
                            "image_path": frame_paths[fidx],
                            "detections": mapped_detections
                        })
                
                visitor_tracklets = []
                if thief_tracklet_id:
                    visitor_tracklets.append(thief_tracklet_id)
                if vehicle_tracklet_id:
                    visitor_tracklets.append(vehicle_tracklet_id)
                    
                alert_payload = {
                    "log_entries": [
                        f"[MODEL_THEFT_ALERT] Triggered by ML model class detection matching keywords.",
                        f"Consecutive frames: {trigger['consecutive_count']} (Threshold={self.detection_threshold_frames})",
                        f"Start frame: {start_frame} (ts={timestamp_sec:.1f}s)",
                        f"Thief tracklet: {thief_tracklet_id}",
                        f"Victim tracklet: {victim_tracklet_id}",
                        f"Vehicle tracklet: {vehicle_tracklet_id}"
                    ],
                    "theft_frames": theft_frames_metadata
                }
                
                alert = Alert(
                    alert_type="chain_snatching",
                    tracklet_id=tracklet_to_use,
                    camera_id="",
                    video_id=video_id,
                    object_tracklet_id=vehicle_tracklet_id,
                    owner_tracklet_ids=json.dumps([victim_tracklet_id] if victim_tracklet_id else []),
                    visitor_tracklet_ids=json.dumps(visitor_tracklets),
                    abandon_duration_seconds=0.0,
                    analysis_log=json.dumps(alert_payload),
                )
                db.add(alert)
                db.flush()
                alerts_created += 1
                log_entries.append(
                    f"[MODEL_THEFT_ALERT] Triggered alert at frame {start_frame} "
                    f"with thief={thief_tracklet_id}, victim={victim_tracklet_id}, vehicle={vehicle_tracklet_id}"
                )

            db.commit()
            if progress_callback:
                progress_callback(100)
            log_entries.append(f"[DONE] {alerts_created} model-only theft alert(s) created for video {video_id}")
            return {
                "eligible": True,
                "skip_reason": None,
                "alerts_created": alerts_created,
                "log_entries": log_entries,
                "evaluated_video_id": video_id,
            }

        # ───────────────────────────────────────────────────
        # KINEMATIC-BASED SPATIOTEMPORAL LOGIC (OFF BY DEFAULT)
        # ───────────────────────────────────────────────────
        log_entries.append(
            f"[INFO] Proximity Threshold={self.proximity_threshold_px}px, Fall Aspect Ratio Trigger={self.fall_aspect_ratio_trigger}"
        )

        person_registry: Dict[int, PersonKinematics] = {}
        vehicle_registry: Dict[int, VehicleKinematics] = {}
        proximity_events: List[ProximityEvent] = []
        alerts_to_create = []

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

                if len(p.center_history) >= 3:
                    prev_f, prev_c = p.center_history[-3]
                    vx = cx - prev_c[0]
                    vy = cy - prev_c[1]
                    p.velocity_history.append((frame_idx, (vx, vy)))
                else:
                    p.velocity_history.append((frame_idx, (0.0, 0.0)))

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

            rider_pids = set()
            vehicle_riders: Dict[int, List[int]] = {}

            for vid, vdet in current_vehicles.items():
                vbbox = vdet.get("bbox", [0, 0, 1, 1])
                vehicle_riders[vid] = []
                for pid, pdet in current_persons.items():
                    pbbox = pdet.get("bbox", [0, 0, 1, 1])
                    if _is_rider(pbbox, vbbox):
                        rider_pids.add(pid)
                        vehicle_riders[vid].append(pid)

            pedestrian_pids = [pid for pid in current_persons if pid not in rider_pids]

            for pid in pedestrian_pids:
                pdet = current_persons[pid]
                pbbox = pdet.get("bbox", [0, 0, 1, 1])
                pcx, pcy = _center(pbbox)
                p_neck = _upper_body_neck_zone(pbbox)

                for vid, vdet in current_vehicles.items():
                    vbbox = vdet.get("bbox", [0, 0, 1, 1])
                    vcx, vcy = _center(vbbox)
                    dist = _dist((pcx, pcy), (vcx, vcy))
                    neck_dist = _dist(p_neck, (vcx, vcy))

                    snatch_contact = neck_dist < (self.proximity_threshold_px * 0.5)

                    if dist < self.proximity_threshold_px or snatch_contact:
                        rider_id = vehicle_riders[vid][0] if vehicle_riders[vid] else None
                        proximity_events.append(
                            ProximityEvent(
                                person_trid=pid,
                                vehicle_trid=vid,
                                rider_trid=rider_id,
                                frame_idx=frame_idx,
                                timestamp_sec=timestamp_sec,
                                distance_px=dist,
                                snatch_interaction=snatch_contact,
                            )
                        )
                        log_entries.append(
                            f"[PROXIMITY_SPIKE] Target Pedestrian #{pid} & Suspect Vehicle #{vid} "
                            f"(Rider={rider_id or 'unknown'}) dist={dist:.1f}px (NeckDist={neck_dist:.1f}px) at frame {frame_idx}"
                        )

            recent_events = [
                pe for pe in proximity_events
                if frame_idx - pe.frame_idx <= self.observation_window_frames
            ]

            for pevent in recent_events:
                pid = pevent.person_trid
                vid = pevent.vehicle_trid
                rider_id = pevent.rider_trid
                if pid not in person_registry or person_registry[pid].alert_triggered:
                    continue

                p_kin = person_registry[pid]
                v_kin = vehicle_registry.get(vid)

                if len(p_kin.aspect_history) >= 2 and not p_kin.is_fallen:
                    recent_aspects = [ar for fi, ar in p_kin.aspect_history[-self.fall_frame_window - 1:]]
                    if len(recent_aspects) >= 2:
                        max_prior_ar = max(recent_aspects[:-1])
                        curr_ar = recent_aspects[-1]
                        if max_prior_ar > 1.1 and curr_ar < self.fall_aspect_ratio_trigger:
                            p_kin.is_fallen = True
                            log_entries.append(
                                f"[VICTIM_FALL] Target Pedestrian #{pid} aspect ratio dropped from {max_prior_ar:.2f} to {curr_ar:.2f} "
                                f"following proximity with Vehicle #{vid} at frame {frame_idx}"
                            )

                if v_kin and len(p_kin.velocity_history) >= 2 and len(v_kin.velocity_history) >= 2:
                    p_vx, p_vy = p_kin.velocity_history[-1][1]
                    v_vx, v_vy = v_kin.velocity_history[-1][1]

                    p_speed = math.sqrt(p_vx ** 2 + p_vy ** 2)
                    earlier_speeds = [
                        math.sqrt(vx ** 2 + vy ** 2) for _, (vx, vy) in p_kin.velocity_history[:-1]
                    ]
                    avg_baseline_speed = (sum(earlier_speeds) / len(earlier_speeds)) if earlier_speeds else 1.0
                    avg_baseline_speed = max(2.0, avg_baseline_speed)

                    cos_sim = _cosine_similarity((p_vx, p_vy), (v_vx, v_vy))

                    if p_speed > (avg_baseline_speed * self.chase_velocity_multiplier) and cos_sim > self.chase_vector_cosine_sim:
                        p_kin.is_chasing = True
                        log_entries.append(
                            f"[CHASE_VECTOR] Target Pedestrian #{pid} speed={p_speed:.1f}px/f (base={avg_baseline_speed:.1f}) "
                            f"aligned with Vehicle #{vid} (CosSim={cos_sim:.2f}) at frame {frame_idx}"
                        )

                if pevent.snatch_interaction:
                    p_kin.is_snatch_contact = True
                    log_entries.append(
                        f"[SNATCH_CONTACT] Suspect Rider/Vehicle #{vid} hand/front within neck zone of Target Pedestrian #{pid} at frame {frame_idx}"
                    )

                if (p_kin.is_fallen or p_kin.is_chasing or p_kin.is_snatch_contact) and not p_kin.alert_triggered:
                    p_kin.alert_triggered = True
                    log_entries.append(
                        f"[CHAIN_SNATCHING_ALERT] TRIGGERED for Pedestrian #{pid} (Victim) & Vehicle #{vid} / Rider #{rider_id or 'unknown'} (Suspect) "
                        f"at frame {frame_idx} (ts={timestamp_sec:.1f}s)"
                    )
                    alerts_to_create.append((p_kin, v_kin, rider_id, timestamp_sec))

        alerts_created = 0
        for p_kin, v_kin, rider_id, ts in alerts_to_create:
            try:
                existing = db.query(Alert).filter(
                    Alert.video_id == video_id,
                    Alert.alert_type == "chain_snatching",
                    Alert.tracklet_id == p_kin.tracklet_id
                ).first()

                if existing:
                    continue

                # Extract context frames around the trigger timestamp
                trigger_frame_idx = int(ts * fps)
                adjacent_idxs = set(range(max(0, trigger_frame_idx - 5), min(total_frames, trigger_frame_idx + 6)))
                frame_paths = self._extract_theft_frames(video_id, adjacent_idxs, db)
                
                theft_frames_metadata = []
                for fidx in sorted(adjacent_idxs):
                    if fidx in frame_paths:
                        fdata = next((f for f in frame_detections if f["frame_index"] == fidx), None)
                        mapped_detections = []
                        if fdata:
                            for d in fdata.get("detections", []):
                                cname = (d.get("class_name") or "").lower()
                                mapped_d = d.copy()
                                if cname in ["theif", "thief", "suspect"]:
                                    mapped_d["class_name"] = "[SUSPECT]"
                                elif cname in ["victim"]:
                                    mapped_d["class_name"] = "[VICTIM]"
                                mapped_detections.append(mapped_d)
                                
                        theft_frames_metadata.append({
                            "frame_index": fidx,
                            "timestamp_seconds": fidx / fps,
                            "image_path": frame_paths[fidx],
                            "detections": mapped_detections
                        })

                visitor_tracklets = []
                if rider_id:
                    visitor_tracklets.append(f"{video_id}_trk_{rider_id}")
                if v_kin:
                    visitor_tracklets.append(v_kin.tracklet_id)

                alert_payload = {
                    "log_entries": log_entries[-12:],
                    "theft_frames": theft_frames_metadata
                }

                alert = Alert(
                    alert_type="chain_snatching",
                    tracklet_id=p_kin.tracklet_id,
                    camera_id="",
                    video_id=video_id,
                    object_tracklet_id=v_kin.tracklet_id if v_kin else None,
                    owner_tracklet_ids=json.dumps([p_kin.tracklet_id]),
                    visitor_tracklet_ids=json.dumps(visitor_tracklets),
                    abandon_duration_seconds=0.0,
                    analysis_log=json.dumps(alert_payload),
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
