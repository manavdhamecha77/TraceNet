"""Human-review loitering analysis for explicitly configured video zones."""
from __future__ import annotations

import json
import os
from typing import Any

from app.config import get_data_path
from app.db.models import Alert, LoiteringZone


def _inside_polygon(point: tuple[float, float], polygon: list[dict[str, float]]) -> bool:
    """Ray-casting containment check for normalized coordinates."""
    x, y = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = current["x"], current["y"]
        x2, y2 = previous["x"], previous["y"]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
        previous = current
    return inside


class LoiteringAnalyzer:
    def analyze(self, video_id: str, zone: LoiteringZone, db) -> dict[str, Any]:
        try:
            polygon = json.loads(zone.polygon_points or "[]")
        except json.JSONDecodeError:
            polygon = []
        if len(polygon) < 3:
            return {"alerts_created": 0, "reason": "Zone polygon is incomplete."}
        artifact_path = get_data_path(os.path.join("processed", "detections", video_id, "detections.json"))
        if not os.path.exists(artifact_path):
            return {"alerts_created": 0, "reason": "Detection artifact is unavailable."}
        with open(artifact_path, encoding="utf-8") as file:
            artifact = json.load(file)
        width = float(artifact.get("frame_width") or 1280)
        height = float(artifact.get("frame_height") or 720)
        states: dict[int, dict[str, float | bool]] = {}
        alerts_created = 0
        for frame in artifact.get("frame_detections", []):
            timestamp = float(frame.get("timestamp_seconds", 0))
            for det in frame.get("detections", []):
                if det.get("object_type") != "person" or det.get("tracker_id") is None:
                    continue
                x1, _, x2, y2 = det.get("bbox", [0, 0, 0, 0])
                point = ((float(x1) + float(x2)) / (2 * width), float(y2) / height)
                tracker_id = int(det["tracker_id"])
                if not _inside_polygon(point, polygon):
                    states.pop(tracker_id, None)
                    continue
                state = states.get(tracker_id)
                if not state or timestamp - float(state["last_seen"]) > zone.grace_seconds:
                    state = {"entered_at": timestamp, "last_seen": timestamp, "alerted": False}
                    states[tracker_id] = state
                else:
                    state["last_seen"] = timestamp
                dwell = timestamp - float(state["entered_at"])
                tracklet_id = f"{video_id}_trk_{tracker_id}"
                if dwell >= zone.threshold_seconds and not state["alerted"]:
                    existing = db.query(Alert).filter(Alert.alert_type == "loitering", Alert.video_id == video_id, Alert.tracklet_id == tracklet_id).first()
                    if not existing:
                        db.add(Alert(alert_type="loitering", tracklet_id=tracklet_id, camera_id=zone.video.camera_id, video_id=video_id, abandon_duration_seconds=dwell, analysis_log=json.dumps({"zone_id": zone.id, "zone_name": zone.name, "dwell_seconds": round(dwell, 2), "point_rule": "bottom_center"})))
                        alerts_created += 1
                    state["alerted"] = True
        db.commit()
        return {"alerts_created": alerts_created, "reason": None}
