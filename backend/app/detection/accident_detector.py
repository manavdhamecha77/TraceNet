import os
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from loguru import logger
from ultralytics import YOLO

from app.config import get_data_path
from app.db.models import Alert, VideoAsset
from app.detection.detector import load_detection_model


DEFAULT_ACCIDENT_MODEL = "models/accident_detection/yolo11x_epoch61.pt"
_accident_detector_instance: Optional["AccidentDetectionService"] = None


def get_accident_detector(model_path: Optional[str] = None) -> "AccidentDetectionService":
    global _accident_detector_instance
    if _accident_detector_instance is None or model_path is not None:
        _accident_detector_instance = AccidentDetectionService(model_path=model_path)
    return _accident_detector_instance


def compute_iou(boxA: List[float], boxB: List[float]) -> float:
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = max(0, boxA[2] - boxA[0]) * max(0, boxA[3] - boxA[1])
    boxBArea = max(0, boxB[2] - boxB[0]) * max(0, boxB[3] - boxB[1])

    iou = interArea / float(boxAArea + boxBArea - interArea + 1e-6)
    return float(iou)


class AccidentDetectionService:
    def __init__(self, model_path: Optional[str] = None, conf_threshold: float = 0.35, iou_threshold: float = 0.45):
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self._custom_model_path = model_path

    @property
    def model_path(self) -> str:
        if self._custom_model_path:
            return self._custom_model_path

        # 1. First priority: backend/data/models/accident_detection/yolo11x_epoch61.pt
        data_model = Path(get_data_path("models/accident_detection/yolo11x_epoch61.pt"))
        if data_model.exists():
            return str(data_model)

        # 2. Fallback: project root models/accident_detection/yolo11x_epoch61.pt
        root_model = Path(__file__).resolve().parents[3] / "models" / "accident_detection" / "yolo11x_epoch61.pt"
        if root_model.exists():
            return str(root_model)

        # 3. Fallback: epoch14
        data_epoch14 = Path(get_data_path("models/accident_detection/yolo11x_epoch14.pt"))
        if data_epoch14.exists():
            return str(data_epoch14)

        return DEFAULT_ACCIDENT_MODEL

    @property
    def model(self) -> YOLO:
        return load_detection_model(self.model_path)

    def analyze_video(
        self,
        video_path: str,
        output_dir: str,
        camera_id: str,
        video_id: str,
        db: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Runs collision/accident detection on the video.
        Filters false positives with temporal persistence (>= 3 consecutive frames).
        Extracts pre-impact, impact instant, and post-impact evidence frames.
        Persists Alert records into the database if db session provided.
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found at '{video_path}'")

        os.makedirs(output_dir, exist_ok=True)
        evidence_dir = os.path.join(output_dir, "evidence")
        os.makedirs(evidence_dir, exist_ok=True)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Unable to open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)

        model = self.model
        frame_index = 0
        raw_accident_frames: List[Dict[str, Any]] = []

        logger.info(f"Starting accident detection on video {video_id} ({total_frames} frames @ {fps:.1f} FPS)...")

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            timestamp_seconds = frame_index / fps if fps > 0 else float(frame_index)

            # Inference
            results = model.predict(
                frame,
                conf=self.conf_threshold,
                iou=self.iou_threshold,
                verbose=False
            )

            accident_boxes = []
            vehicle_boxes = []

            for r in results:
                if r.boxes is None or len(r.boxes) == 0:
                    continue
                boxes = r.boxes.xyxy.cpu().numpy()
                confs = r.boxes.conf.cpu().numpy()
                clss = r.boxes.cls.cpu().numpy()

                for box, conf, cls_id in zip(boxes, confs, clss):
                    cls_name = model.names.get(int(cls_id), "unknown")
                    bbox_list = [float(x) for x in box]
                    if cls_name == "accident" or int(cls_id) == 0:
                        accident_boxes.append({"bbox": bbox_list, "confidence": float(conf)})
                    elif cls_name == "vehicle" or int(cls_id) == 1:
                        vehicle_boxes.append({"bbox": bbox_list, "confidence": float(conf)})

            if accident_boxes:
                # Associate overlapping vehicles
                for acc in accident_boxes:
                    overlapping_vehicles = [
                        v for v in vehicle_boxes
                        if compute_iou(acc["bbox"], v["bbox"]) > 0.05
                    ]
                    raw_accident_frames.append({
                        "frame_index": frame_index,
                        "timestamp_seconds": timestamp_seconds,
                        "accident_box": acc["bbox"],
                        "confidence": acc["confidence"],
                        "vehicles_involved": max(1, len(overlapping_vehicles)),
                        "frame": frame,
                    })

            frame_index += 1

        cap.release()

        # Group consecutive detections into distinct collision incidents
        # Persistence threshold: must appear across at least 3 consecutive or near-consecutive frames
        incidents: List[Dict[str, Any]] = []
        if raw_accident_frames:
            current_cluster: List[Dict[str, Any]] = [raw_accident_frames[0]]
            
            def _persistent(cluster: List[Dict[str, Any]]) -> bool:
                # Count distinct frames, not boxes: several boxes in one frame is not persistence.
                return len({c["frame_index"] for c in cluster}) >= 3

            for item in raw_accident_frames[1:]:
                # If frame gap is <= 5 frames (0.5s), consider it the same incident event
                if item["frame_index"] - current_cluster[-1]["frame_index"] <= 5:
                    current_cluster.append(item)
                else:
                    if _persistent(current_cluster):
                        incidents.append(self._process_incident_cluster(
                            current_cluster, evidence_dir, video_id, camera_id
                        ))
                    current_cluster = [item]

            if _persistent(current_cluster):
                incidents.append(self._process_incident_cluster(
                    current_cluster, evidence_dir, video_id, camera_id
                ))

        raw_accident_frames.clear()

        # Write accidents.json artifact
        artifact = {
            "video_id": video_id,
            "camera_id": camera_id,
            "model_path": self.model_path,
            "total_frames": total_frames,
            "fps": fps,
            "dimensions": {"width": width, "height": height},
            "incidents_count": len(incidents),
            "incidents": incidents,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        artifact_path = os.path.join(output_dir, "accidents.json")
        with open(artifact_path, "w", encoding="utf-8") as f:
            json.dump(artifact, f, indent=2)

        logger.info(f"Accident analysis complete for video {video_id}: found {len(incidents)} verified collision incidents.")

        # Persist Alerts in DB if session is available
        if db is not None:
            self._save_alerts_to_db(incidents, video_id, camera_id, db)

        return artifact

    def _process_incident_cluster(
        self,
        cluster: List[Dict[str, Any]],
        evidence_dir: str,
        video_id: str,
        camera_id: str,
    ) -> Dict[str, Any]:
        """Processes a temporal cluster into a verified collision record with keyframes."""
        incident_id = f"{video_id}_acc_{cluster[0]['frame_index']}"
        start_time = cluster[0]["timestamp_seconds"]
        end_time = cluster[-1]["timestamp_seconds"]
        duration = round(end_time - start_time, 2)

        # Peak frame: frame with highest accident confidence
        peak_item = max(cluster, key=lambda x: x["confidence"])
        peak_conf = float(peak_item["confidence"])
        peak_bbox = peak_item["accident_box"]
        vehicles_count = max(item["vehicles_involved"] for item in cluster)

        # Severity determination
        if vehicles_count >= 2 or peak_conf >= 0.75:
            severity = "CRITICAL"
        elif peak_conf >= 0.50:
            severity = "HIGH"
        else:
            severity = "MODERATE"

        # 1. Generate Impact Annotated Frame
        impact_frame = peak_item["frame"].copy()
        x1, y1, x2, y2 = [int(v) for v in peak_bbox]
        # Draw bold red accident box with glowing aura
        cv2.rectangle(impact_frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
        # Header banner
        label = f"COLLISION [{severity}] {int(peak_conf * 100)}%"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(impact_frame, (x1, max(0, y1 - th - 10)), (x1 + tw + 10, y1), (0, 0, 255), -1)
        cv2.putText(impact_frame, label, (x1 + 5, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        impact_filename = f"{incident_id}_impact.jpg"
        impact_path = os.path.join(evidence_dir, impact_filename)
        cv2.imwrite(impact_path, impact_frame)

        # 2. Extract Pre-Impact Frame (first frame in cluster or 1-2 sec prior)
        pre_frame_item = cluster[0]
        pre_filename = f"{incident_id}_pre.jpg"
        pre_path = os.path.join(evidence_dir, pre_filename)
        cv2.imwrite(pre_path, pre_frame_item["frame"])

        # 3. Extract Post-Impact Frame (last frame in cluster)
        post_frame_item = cluster[-1]
        post_filename = f"{incident_id}_post.jpg"
        post_path = os.path.join(evidence_dir, post_filename)
        cv2.imwrite(post_path, post_frame_item["frame"])

        rel_impact_url = f"/data/processed/accidents/{video_id}/evidence/{impact_filename}"
        rel_pre_url = f"/data/processed/accidents/{video_id}/evidence/{pre_filename}"
        rel_post_url = f"/data/processed/accidents/{video_id}/evidence/{post_filename}"

        return {
            "incident_id": incident_id,
            "camera_id": camera_id,
            "video_id": video_id,
            "severity": severity,
            "confidence": round(peak_conf, 3),
            "vehicles_involved": vehicles_count,
            "frame_start": cluster[0]["frame_index"],
            "frame_end": cluster[-1]["frame_index"],
            "timestamp_start_seconds": round(start_time, 2),
            "timestamp_end_seconds": round(end_time, 2),
            "duration_seconds": duration,
            "peak_bbox": peak_bbox,
            "evidence_snapshot_url": rel_impact_url,
            "pre_crash_url": rel_pre_url,
            "post_crash_url": rel_post_url,
            "dispatch_status": "pending",
        }

    def _save_alerts_to_db(self, incidents: List[Dict[str, Any]], video_id: str, camera_id: str, db: Any) -> None:
        """Saves generated accident incidents into the SQLite alerts table."""
        for inc in incidents:
            # Check for existing duplicate alert for this incident
            existing = db.query(Alert).filter(
                Alert.alert_type == "accident",
                Alert.tracklet_id == inc["incident_id"]
            ).first()

            analysis_payload = {
                "severity": inc["severity"],
                "confidence": inc["confidence"],
                "vehicles_involved": inc["vehicles_involved"],
                "collision_timestamp_seconds": inc["timestamp_start_seconds"],
                "duration_seconds": inc["duration_seconds"],
                "evidence_snapshot_url": inc["evidence_snapshot_url"],
                "pre_crash_url": inc["pre_crash_url"],
                "post_crash_url": inc["post_crash_url"],
                "dispatch_status": "pending",
                "dispatched_at": None,
                "dispatched_by": None,
                "notes": f"{inc['severity']} Collision detected involving ~{inc['vehicles_involved']} vehicle(s)."
            }

            if not existing:
                alert = Alert(
                    alert_type="accident",
                    tracklet_id=inc["incident_id"],
                    camera_id=camera_id,
                    video_id=video_id,
                    object_tracklet_id=None,
                    owner_tracklet_ids="[]",
                    visitor_tracklet_ids="[]",
                    analysis_log=json.dumps(analysis_payload),
                    timestamp=datetime.now(timezone.utc),
                    acknowledged=False,
                )
                db.add(alert)
                db.commit()
                logger.info(f"Created emergency accident Alert #{alert.id} for camera {camera_id} at {inc['timestamp_start_seconds']}s")
