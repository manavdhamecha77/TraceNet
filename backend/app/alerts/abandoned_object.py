"""
Abandoned Object Analyzer — post-processing pass over detections.json.

Eligibility: the ML model assigned to the video's camera must have a class
that matches one of OBJECT_CLASS_NAMES (case-insensitive). Otherwise the video
is skipped and a log entry is returned.

Algorithm: replay the frame timeline from detections.json, run the state machine
(CARRIED → STATIONARY → UNATTENDED → ABANDONED), write Alert rows to SQLite.
"""

import json
import math
import os
from dataclasses import dataclass, field
from typing import Optional
from loguru import logger

from app.config import get_data_path

# Classes that qualify an object as potentially abandonment-capable
OBJECT_CLASS_NAMES = {
    "object",       # custom model literal
    "suitcase",
    "backpack",
    "handbag",
    "luggage",
    "bag",
    "briefcase",
    "package",
    "parcel",
    "box",
}

PERSON_CLASS_KEYWORDS = [
    "person", "pedest", "human", "man", "woman", "peopl",
    "walk", "rid", "passeng", "bystand", "child", "adult"
]


def _is_person_detection(det):
    if det.get("object_type") == "person":
        return True
    cname = (det.get("class_name") or "").lower()
    return any(k in cname for k in PERSON_CLASS_KEYWORDS)


def _center(bbox):
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def _dist(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


@dataclass
class ObjectState:
    tracker_id: int
    tracklet_id: str
    class_name: str
    bbox_history: list = field(default_factory=list)      # [(frame_idx, bbox)]
    center_history: list = field(default_factory=list)    # [(frame_idx, (cx, cy))]
    state: str = "CARRIED"                               # CARRIED|STATIONARY|UNATTENDED|ABANDONED
    stationary_since_frame: Optional[int] = None
    owner_tracker_ids: list = field(default_factory=list)
    unattended_since_frame: Optional[int] = None
    frames_missing: int = 0
    alert_triggered: bool = False
    best_crop_path: Optional[str] = None
    visitor_tracker_ids: list = field(default_factory=list)
    abandon_start_frame: Optional[int] = None
    abandon_duration_seconds: float = 0.0


class AbandonedObjectAnalyzer:
    def __init__(
        self,
        abandon_time_sec: float = 15.0,
        stationary_tolerance_px: int = 15,
        stationary_time_sec: float = 2.0,
        owner_bind_dist_px: int = 80,
        abandon_dist_px: int = 200,
        occlusion_grace_frames: int = 30,
        visitor_dist_px: int = 150,
    ):
        self.abandon_time_sec = abandon_time_sec
        self.stationary_tolerance_px = stationary_tolerance_px
        self.stationary_time_sec = stationary_time_sec
        self.owner_bind_dist_px = owner_bind_dist_px
        self.abandon_dist_px = abandon_dist_px
        self.occlusion_grace_frames = occlusion_grace_frames
        self.visitor_dist_px = visitor_dist_px

    def analyze_video(
        self,
        video_id: str,
        model_classes: list,
        db,
        progress_callback = None,
    ) -> dict:
        """
        Returns a dict with keys:
          eligible: bool
          skip_reason: str|None
          alerts_created: int
          log_entries: list[str]
          evaluated_video_id: str
        """
        log_entries = []

        # 1. Eligibility check
        model_class_names_lower = {c.lower() for c in model_classes}
        eligible_classes = model_class_names_lower & OBJECT_CLASS_NAMES
        if not eligible_classes:
            reason = (
                f"Model has no abandonment-eligible classes. "
                f"Model classes: {sorted(model_class_names_lower)}. "
                f"Required one of: {sorted(OBJECT_CLASS_NAMES)}."
            )
            log_entries.append(f"[SKIP] {reason}")
            logger.info(f"[AbandonedObjectAnalyzer] Video {video_id}: {reason}")
            return {
                "eligible": False,
                "skip_reason": reason,
                "alerts_created": 0,
                "log_entries": log_entries,
                "evaluated_video_id": video_id,
            }

        log_entries.append(f"[OK] Eligible classes found: {sorted(eligible_classes)}")

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

        stationary_window = max(1, int(self.stationary_time_sec * fps))
        abandon_frames = max(1, int(self.abandon_time_sec * fps))
        effective_tolerance_px = max(self.stationary_tolerance_px, 20)

        log_entries.append(f"[INFO] Replaying {len(frame_detections)} frames at {fps:.1f} FPS")
        log_entries.append(f"[INFO] Stationary window={stationary_window}f, Abandon threshold={abandon_frames}f")

        object_registry: dict[int, ObjectState] = {}
        alerts_to_create = []
        unattended_registry = {}  # tracker_id -> max_unattended_duration

        # 3. Frame-by-frame replay
        total_frames = len(frame_detections)
        for frame_idx_i, frame_data in enumerate(frame_detections):
            if progress_callback:
                progress_callback(frame_idx_i + 1, total_frames)
            frame_idx = frame_data["frame_index"]
            timestamp_sec = frame_data["timestamp_seconds"]
            detections = frame_data.get("detections", [])

            # Partition detections
            current_objects: dict[int, dict] = {}  # tracker_id -> detection
            current_persons: dict[int, dict] = {}   # tracker_id -> detection

            for det in detections:
                trid = det.get("tracker_id")
                cname = (det.get("class_name") or "").lower()
                if trid is None:
                    continue
                if cname in eligible_classes or det.get("object_type") == "object":
                    current_objects[trid] = det
                elif _is_person_detection(det):
                    current_persons[trid] = det

            # Update registry for seen objects
            for trid, det in current_objects.items():
                bbox = det.get("bbox", [0, 0, 1, 1])
                cx, cy = _center(bbox)
                if trid not in object_registry:
                    summary = tracklet_summaries.get(trid, {})
                    object_registry[trid] = ObjectState(
                        tracker_id=trid,
                        tracklet_id=det.get("tracker_id") and f"{video_id}_trk_{trid}" or "",
                        class_name=det.get("class_name", "object"),
                        best_crop_path=summary.get("best_crop_path"),
                    )
                obj = object_registry[trid]
                obj.frames_missing = 0
                obj.bbox_history.append((frame_idx, bbox))
                obj.center_history.append((frame_idx, (cx, cy)))

            # State machine
            for trid, obj in list(object_registry.items()):
                if trid not in current_objects:
                    obj.frames_missing += 1
                    if obj.frames_missing > self.occlusion_grace_frames:
                        # Object gone — clean up, but if UNATTENDED or ABANDONED, save final duration
                        if obj.state == "UNATTENDED":
                            unattended_frames = frame_idx - (obj.unattended_since_frame or frame_idx)
                            unattended_duration = unattended_frames / fps
                            unattended_registry[trid] = max(unattended_registry.get(trid, 0.0), unattended_duration)
                        del object_registry[trid]
                    continue

                bbox = current_objects[trid].get("bbox", [0, 0, 1, 1])
                center = _center(bbox)

                # A. Stationary check
                if obj.state == "CARRIED":
                    recent = [c for fi, c in obj.center_history if fi >= frame_idx - stationary_window]
                    if len(recent) >= stationary_window:
                        max_drift = max(
                            max(abs(c[0] - recent[0][0]), abs(c[1] - recent[0][1])) for c in recent
                        )
                        if max_drift < effective_tolerance_px:
                            obj.state = "STATIONARY"
                            obj.stationary_since_frame = frame_idx
                            log_entries.append(
                                f"[STATIONARY] tracker_id={trid} class={obj.class_name} at frame {frame_idx}"
                            )

                # B. Owner binding (group-aware)
                if obj.state == "STATIONARY" and not obj.owner_tracker_ids:
                    bound = [
                        pid for pid, pdet in current_persons.items()
                        if _dist(center, _center(pdet.get("bbox", [0, 0, 1, 1]))) < self.owner_bind_dist_px
                    ]
                    if bound:
                        obj.owner_tracker_ids = bound
                        log_entries.append(
                            f"[OWNER_BOUND] tracker_id={trid} → owners={bound} at frame {frame_idx}"
                        )

                # C. Unattended check (Bound Owner OR Isolated Object)
                if obj.state == "STATIONARY":
                    if obj.owner_tracker_ids:
                        any_owner_near = any(
                            pid in current_persons
                            and _dist(center, _center(current_persons[pid].get("bbox", [0, 0, 1, 1]))) < self.abandon_dist_px
                            for pid in obj.owner_tracker_ids
                        )
                        if not any_owner_near:
                            obj.state = "UNATTENDED"
                            obj.unattended_since_frame = frame_idx
                            obj.abandon_start_frame = frame_idx
                            log_entries.append(
                                f"[UNATTENDED] tracker_id={trid} at frame {frame_idx} (ts={timestamp_sec:.1f}s)"
                            )
                    else:
                        # Isolated / unbound object check: no person near at all
                        any_person_near = any(
                            _dist(center, _center(pdet.get("bbox", [0, 0, 1, 1]))) < self.abandon_dist_px
                            for pdet in current_persons.values()
                        )
                        if not any_person_near:
                            obj.state = "UNATTENDED"
                            obj.unattended_since_frame = frame_idx
                            obj.abandon_start_frame = frame_idx
                            log_entries.append(
                                f"[UNATTENDED] tracker_id={trid} (ISOLATED) at frame {frame_idx} (ts={timestamp_sec:.1f}s)"
                            )

                # D. Re-appearance / alarm trigger
                if obj.state == "UNATTENDED":
                    claiming_persons = [
                        pid for pid, pdet in current_persons.items()
                        if _dist(center, _center(pdet.get("bbox", [0, 0, 1, 1]))) < self.owner_bind_dist_px
                    ]
                    if claiming_persons:
                        unattended_frames = frame_idx - (obj.unattended_since_frame or frame_idx)
                        unattended_duration = unattended_frames / fps
                        unattended_registry[trid] = max(unattended_registry.get(trid, 0.0), unattended_duration)

                        obj.state = "STATIONARY"
                        if not obj.owner_tracker_ids:
                            obj.owner_tracker_ids = claiming_persons
                        obj.unattended_since_frame = None
                        obj.abandon_start_frame = None
                        log_entries.append(
                            f"[OWNER_RETURNED] tracker_id={trid} at frame {frame_idx} after {unattended_duration:.1f}s"
                        )
                    else:
                        frames_unattended = frame_idx - (obj.unattended_since_frame or frame_idx)
                        if frames_unattended >= abandon_frames and not obj.alert_triggered:
                            obj.state = "ABANDONED"
                            obj.alert_triggered = True
                            obj.abandon_duration_seconds = frames_unattended / fps
                            log_entries.append(
                                f"[ABANDONED] tracker_id={trid} class={obj.class_name} "
                                f"after {obj.abandon_duration_seconds:.1f}s at frame {frame_idx}"
                            )
                            alerts_to_create.append(obj)
                            unattended_registry[trid] = max(unattended_registry.get(trid, 0.0), obj.abandon_duration_seconds)

                        # Track visitors near the unattended/abandoned object
                        for pid in current_persons:
                            if pid not in obj.owner_tracker_ids:
                                pdist = _dist(center, _center(current_persons[pid].get("bbox", [0, 0, 1, 1])))
                                if pdist < self.visitor_dist_px and pid not in obj.visitor_tracker_ids:
                                    obj.visitor_tracker_ids.append(pid)
                                    log_entries.append(
                                        f"[VISITOR] tracker_id={pid} approached abandoned obj {trid} at frame {frame_idx}"
                                    )

        # Record accumulated duration for objects still unattended at the end
        if frame_detections:
            last_frame_idx = frame_detections[-1]["frame_index"]
            for trid, obj in object_registry.items():
                if obj.state == "UNATTENDED":
                    unattended_frames = last_frame_idx - (obj.unattended_since_frame or last_frame_idx)
                    unattended_duration = unattended_frames / fps
                    unattended_registry[trid] = max(unattended_registry.get(trid, 0.0), unattended_duration)
                elif obj.state == "ABANDONED":
                    unattended_registry[trid] = max(unattended_registry.get(trid, 0.0), obj.abandon_duration_seconds)

        # 4. Write alerts to DB
        from app.db.models import Alert
        alerts_created = 0
        for obj in alerts_to_create:
            try:
                existing = db.query(Alert).filter(
                    Alert.alert_type == "abandoned_object",
                    Alert.object_tracklet_id == obj.tracklet_id
                ).first()
                if existing:
                    continue  # Deduplicate

                alert = Alert(
                    alert_type="abandoned_object",
                    tracklet_id=obj.tracklet_id,
                    camera_id="",  # Will be set by the caller
                    video_id=video_id,
                    object_tracklet_id=obj.tracklet_id,
                    owner_tracklet_ids=json.dumps(
                        [f"{video_id}_trk_{tid}" for tid in obj.owner_tracker_ids]
                    ),
                    visitor_tracklet_ids=json.dumps(
                        [f"{video_id}_trk_{tid}" for tid in obj.visitor_tracker_ids]
                    ),
                    abandon_duration_seconds=obj.abandon_duration_seconds,
                    analysis_log=json.dumps(log_entries[-10:]),
                )
                db.add(alert)
                db.flush()
                alerts_created += 1
            except Exception as e:
                logger.error(f"Failed to create alert for obj {obj.tracklet_id}: {e}")

        # Save unattended alerts to DB
        for trid, duration in unattended_registry.items():
            if duration <= 0.0:
                continue
            obj = object_registry.get(trid)
            if not obj:
                continue
            try:
                existing = db.query(Alert).filter(
                    Alert.alert_type == "unattended_object",
                    Alert.object_tracklet_id == obj.tracklet_id
                ).first()
                if existing:
                    if duration > (existing.abandon_duration_seconds or 0.0):
                        existing.abandon_duration_seconds = duration
                    continue

                unattended_alert = Alert(
                    alert_type="unattended_object",
                    tracklet_id=obj.tracklet_id,
                    camera_id="",  # Will be set by the caller
                    video_id=video_id,
                    object_tracklet_id=obj.tracklet_id,
                    owner_tracklet_ids=json.dumps(
                        [f"{video_id}_trk_{tid}" for tid in obj.owner_tracker_ids]
                    ),
                    visitor_tracklet_ids=json.dumps(
                        [f"{video_id}_trk_{tid}" for tid in obj.visitor_tracker_ids]
                    ),
                    abandon_duration_seconds=duration,
                    analysis_log=json.dumps([
                        f"Unattended segment tracked for {duration:.1f}s.",
                        f"Initial owner(s): {obj.owner_tracker_ids}"
                    ]),
                )
                db.add(unattended_alert)
            except Exception as e:
                logger.error(f"Failed to create unattended alert for obj {obj.tracklet_id}: {e}")

        db.commit()
        log_entries.append(f"[DONE] {alerts_created} abandoned object alert(s) created for video {video_id}")
        return {
            "eligible": True,
            "skip_reason": None,
            "alerts_created": alerts_created,
            "log_entries": log_entries,
            "evaluated_video_id": video_id,
        }
