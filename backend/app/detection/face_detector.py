import json
import os
from dataclasses import asdict, dataclass, field
from typing import Any, Optional
from pathlib import Path

import cv2
import supervision as sv
from loguru import logger
from ultralytics import YOLO

from app.config import get_settings
from app.db.models import VideoAsset
from app.detection.tracker import ByteTrackWrapper
from app.detection.detector import _clip_bbox, load_detection_model
from app.runtime.device import get_device, yolo_precision_kwargs


ACTIVE_FACE_MODEL_PATH = "models/face_detection/yolov8n-face-lindevs.pt"


@dataclass
class FaceDetectionBox:
    tracker_id: Optional[int]
    confidence: float
    bbox: list[float]


@dataclass
class FaceFrameDetections:
    frame_index: int
    timestamp_seconds: float
    detections: list[FaceDetectionBox] = field(default_factory=list)


@dataclass
class FaceTrackletSummary:
    tracklet_id: str
    tracker_id: int
    camera_id: str
    video_id: str
    frame_start: int
    frame_end: int
    timestamp_start_seconds: float
    timestamp_end_seconds: float
    detection_count: int
    mean_confidence: float
    best_bbox: list[float]
    best_crop_path: Optional[str]


@dataclass
class FaceRunResult:
    video_id: str
    camera_id: str
    model_path: str
    video_path: str
    frame_count: int
    fps: float
    frame_width: int
    frame_height: int
    frame_detections: list[FaceFrameDetections]
    face_tracklets: list[FaceTrackletSummary]
    artifact_path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "video_id": self.video_id,
            "camera_id": self.camera_id,
            "model_path": self.model_path,
            "video_path": self.video_path,
            "frame_count": self.frame_count,
            "fps": self.fps,
            "frame_width": self.frame_width,
            "frame_height": self.frame_height,
            "frame_detections": [
                {
                    "frame_index": item.frame_index,
                    "timestamp_seconds": item.timestamp_seconds,
                    "detections": [asdict(det) for det in item.detections],
                }
                for item in self.frame_detections
            ],
            "face_tracklets": [asdict(tracklet) for tracklet in self.face_tracklets],
            "artifact_path": self.artifact_path,
        }


class FaceDetectionService:
    def __init__(self, confidence_threshold: float = 0.5, iou_threshold: float = 0.5):
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold

    @property
    def model_path(self) -> str:
        global ACTIVE_FACE_MODEL_PATH
        # Try finding in backend/data/models/face_detection
        from app.config import get_data_path
        
        path = Path(ACTIVE_FACE_MODEL_PATH)
        if not path.is_absolute():
            # first check data
            data_path = Path(get_data_path(str(path)))
            if data_path.exists():
                return str(data_path)
            # fallback
            fallback_path = Path(__file__).resolve().parents[3] / path
            if fallback_path.exists():
                return str(fallback_path)
        return ACTIVE_FACE_MODEL_PATH

    @property
    def model(self) -> YOLO:
        return load_detection_model(self.model_path)

    def _predict_frame(self, frame: Any) -> sv.Detections:
        results = self.model.predict(
            frame,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            verbose=False,
            device=get_device(),
            **yolo_precision_kwargs(),
        )
        detections = sv.Detections.from_ultralytics(results[0])
        if len(detections) == 0:
            return detections
        if detections.confidence is not None:
            detections = detections[detections.confidence >= self.confidence_threshold]
        return detections

    def analyze_video(
        self, video_path: str, output_dir: str, camera_id: str, video_id: str
    ) -> FaceRunResult:
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video path '{video_path}' does not exist.")

        os.makedirs(output_dir, exist_ok=True)
        crop_dir = os.path.join(output_dir, "crops")
        os.makedirs(crop_dir, exist_ok=True)

        tracker = ByteTrackWrapper()
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open video file '{video_path}'.")

        fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        frame_index = 0
        frame_detections: list[FaceFrameDetections] = []
        tracklet_states: dict[int, dict[str, Any]] = {}

        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break

                detections = self._predict_frame(frame)
                detections = tracker.update(detections) if len(detections) else detections
                timestamp_seconds = frame_index / fps if fps else float(frame_index)
                frame_payload = FaceFrameDetections(
                    frame_index=frame_index, timestamp_seconds=timestamp_seconds
                )

                if len(detections):
                    height, width = frame.shape[:2]
                    for det_index in range(len(detections)):
                        confidence = (
                            float(detections.confidence[det_index])
                            if detections.confidence is not None
                            and detections.confidence[det_index] is not None
                            else 0.0
                        )
                        tracker_id = (
                            int(detections.tracker_id[det_index])
                            if detections.tracker_id is not None
                            and detections.tracker_id[det_index] is not None
                            else None
                        )
                        bbox = [float(value) for value in detections.xyxy[det_index].tolist()]
                        frame_payload.detections.append(
                            FaceDetectionBox(
                                tracker_id=tracker_id,
                                confidence=confidence,
                                bbox=bbox,
                            )
                        )

                        if tracker_id is None:
                            continue

                        state = tracklet_states.setdefault(
                            tracker_id,
                            {
                                "tracklet_id": f"{video_id}_face_{tracker_id}",
                                "tracker_id": tracker_id,
                                "camera_id": camera_id,
                                "video_id": video_id,
                                "frame_start": frame_index,
                                "frame_end": frame_index,
                                "timestamp_start_seconds": timestamp_seconds,
                                "timestamp_end_seconds": timestamp_seconds,
                                "detection_count": 0,
                                "confidence_total": 0.0,
                                "best_confidence": -1.0,
                                "best_bbox": bbox,
                                "best_crop_path": None,
                            },
                        )

                        state["frame_start"] = min(state["frame_start"], frame_index)
                        state["frame_end"] = max(state["frame_end"], frame_index)
                        state["timestamp_end_seconds"] = timestamp_seconds
                        state["detection_count"] += 1
                        state["confidence_total"] += confidence

                        if confidence >= state["best_confidence"]:
                            state["best_confidence"] = confidence
                            state["best_bbox"] = bbox
                            x1, y1, x2, y2 = _clip_bbox(bbox, width, height)
                            crop = frame[y1:y2, x1:x2]
                            if crop.size:
                                crop_path = os.path.join(crop_dir, f"{state['tracklet_id']}.jpg")
                                cv2.imwrite(crop_path, crop)
                                state["best_crop_path"] = crop_path

                frame_detections.append(frame_payload)
                frame_index += 1
        finally:
            cap.release()

        tracklets = [
            FaceTrackletSummary(
                tracklet_id=state["tracklet_id"],
                tracker_id=state["tracker_id"],
                camera_id=state["camera_id"],
                video_id=state["video_id"],
                frame_start=state["frame_start"],
                frame_end=state["frame_end"],
                timestamp_start_seconds=state["timestamp_start_seconds"],
                timestamp_end_seconds=state["timestamp_end_seconds"],
                detection_count=state["detection_count"],
                mean_confidence=state["confidence_total"] / max(1, state["detection_count"]),
                best_bbox=state["best_bbox"],
                best_crop_path=state["best_crop_path"],
            )
            for state in tracklet_states.values()
        ]

        artifact = FaceRunResult(
            video_id=video_id,
            camera_id=camera_id,
            model_path=self.model_path,
            video_path=video_path,
            frame_count=frame_count or frame_index,
            fps=fps,
            frame_width=frame_width,
            frame_height=frame_height,
            frame_detections=frame_detections,
            face_tracklets=tracklets,
            artifact_path=os.path.join(output_dir, "faces.json"),
        )

        with open(artifact.artifact_path, "w", encoding="utf-8") as handle:
            json.dump(artifact.to_dict(), handle, indent=2)

        logger.info(
            f"Face detection run complete for video {video_id}: "
            f"{len(tracklets)} face tracklets across {len(frame_detections)} frames."
        )
        return artifact


_FACE_DETECTOR = None


def get_face_detector(model_path: Optional[str] = None) -> FaceDetectionService:
    global _FACE_DETECTOR
    if model_path:
        global ACTIVE_FACE_MODEL_PATH
        ACTIVE_FACE_MODEL_PATH = model_path
    if _FACE_DETECTOR is None:
        _FACE_DETECTOR = FaceDetectionService()
    return _FACE_DETECTOR
