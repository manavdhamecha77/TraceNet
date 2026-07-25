from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Any, Optional
from pathlib import Path

import cv2
import supervision as sv
from loguru import logger
from ultralytics import YOLO

from app.config import get_settings
from app.db.models import VideoAsset
from app.detection.tracker import ByteTrackWrapper
from app.preprocess.preprocessor import sanitize_filename


@dataclass
class DetectionBox:
    tracker_id: Optional[int]
    class_id: Optional[int]
    class_name: str
    object_type: str
    confidence: float
    bbox: list[float]


@dataclass
class FrameDetections:
    frame_index: int
    timestamp_seconds: float
    detections: list[DetectionBox] = field(default_factory=list)


@dataclass
class TrackletSummary:
    tracklet_id: str
    tracker_id: int
    object_type: str
    class_name: str
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
class DetectionRunResult:
    video_id: str
    camera_id: str
    model_path: str
    video_path: str
    frame_count: int
    fps: float
    frame_width: int
    frame_height: int
    frame_detections: list[FrameDetections]
    tracklets: list[TrackletSummary]
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
            "tracklets": [asdict(tracklet) for tracklet in self.tracklets],
            "artifact_path": self.artifact_path,
        }


def _get_class_name(names: Any, class_id: int | None) -> str:
    if class_id is None:
        return "unknown"
    if isinstance(names, dict):
        return str(names.get(class_id, f"class_{class_id}"))
    if isinstance(names, list) and 0 <= class_id < len(names):
        return str(names[class_id])
    return f"class_{class_id}"


def _normalize_object_type(class_name: str) -> str:
    name = class_name.lower().strip()
    if name in ("person", "pedestrian"):
        return "person"
    vehicle_terms = (
        "car",
        "truck",
        "bus",
        "motorcycle",
        "motorbike",
        "bicycle",
        "bike",
        "van",
        "suv",
        "vehicle",
    )
    if name in vehicle_terms:
        return "vehicle"
    return class_name


def _clip_bbox(bbox: list[float], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    left = max(0, min(width - 1, int(round(x1))))
    top = max(0, min(height - 1, int(round(y1))))
    right = max(left + 1, min(width, int(round(x2))))
    bottom = max(top + 1, min(height, int(round(y2))))
    return left, top, right, bottom


# NOTE FOR FUTURE DEVELOPERS (SCALING GPU VRAM CACHE PLAN):
# -------------------------------------------------------------
# Currently, the detection pipeline runs on CPU/GPU utilizing a simple `lru_cache` of maxsize=1.
# During concurrent multi-camera execution, if Camera A and Camera B use different model files,
# this single-entry cache will trigger constant weight reloads ("thrashing"), causing significant
# latency and I/O bottlenecks.
#
# WHY IT IS KEPT THIS WAY NOW:
# Local dev runs primarily on CPU with a single model. Keeping multiple weights files fully resident
# in GPU memory (CUDA) will lead to Out-Of-Memory (OOM) failures on low-end or consumer-grade hardware.
#
# THE FUTURE SCALING PLAN:
# To support concurrent multi-camera inference across distinct custom models:
# 1. Define a VRAM-aware Model Cache Manager:
#    - Maintain a dict of `{model_path: model_instance}` with a configurable capacity (e.g. max_resident_models=3).
#    - Track VRAM consumption dynamically (using `torch.cuda.memory_allocated()`).
# 2. Implement an eviction policy (e.g., Least Recently Used - LRU):
#    - When loading a new model violates VRAM capacity, unload the oldest active model from memory.
#    - Call `del model_instance`, then run `torch.cuda.empty_cache()` and Python `gc.collect()` to force garbage collection.
#    - Ensure thread safety around model loads using an asyncio Lock per model target.
# -------------------------------------------------------------
@lru_cache(maxsize=1)
def load_detection_model(model_path: str) -> YOLO:
    path = Path(model_path)
    if not path.is_absolute():
        # First try resolving relative to current working directory (e.g. project root)
        local_path = path.resolve()
        fallback_path = Path(__file__).resolve().parents[2] / path
        if local_path.exists():
            path = local_path
        else:
            path = fallback_path

    if not path.exists():
        raise FileNotFoundError(
            f"Detection model not found at '{path}'. Place best.pt there before running."
        )
    logger.info(f"Loading detection model from {path}")
    return YOLO(str(path))


class DetectionService:
    def __init__(
        self,
        model_path: Optional[str] = None,
        confidence_threshold: Optional[float] = None,
        iou_threshold: Optional[float] = None,
        max_frames: int = 0,
    ) -> None:
        settings = get_settings()
        self.model_path = model_path or settings.detection_model_path
        self.confidence_threshold = (
            confidence_threshold if confidence_threshold is not None else settings.detection_confidence_threshold
        )
        self.iou_threshold = iou_threshold if iou_threshold is not None else settings.detection_iou_threshold
        self.max_frames = max_frames or settings.detection_max_frames
        self._model = None
        self._scope_class_ids: Optional[list[int]] = None

    @property
    def model(self) -> YOLO:
        if self._model is None:
            self._model = load_detection_model(self.model_path)
            self._scope_class_ids = self._resolve_scope_class_ids(self._model.names)
        return self._model

    @staticmethod
    def _resolve_scope_class_ids(names: Any) -> list[int]:
        class_ids: list[int] = []
        iterable = names.items() if isinstance(names, dict) else enumerate(names or [])
        for class_id, class_name in iterable:
            class_ids.append(int(class_id))
        return class_ids

    def _predict_frame(self, frame: Any) -> sv.Detections:
        predict_kwargs: dict[str, Any] = {
            "conf": self.confidence_threshold,
            "iou": self.iou_threshold,
            "verbose": False,
        }
        if self._scope_class_ids:
            predict_kwargs["classes"] = self._scope_class_ids
        results = self.model.predict(frame, **predict_kwargs)
        detections = sv.Detections.from_ultralytics(results[0])
        if len(detections) == 0:
            return detections
        if detections.confidence is not None:
            detections = detections[detections.confidence >= self.confidence_threshold]
        return detections

    def analyze_video(
        self,
        video_path: str,
        output_dir: str,
        camera_id: str,
        video_id: str,
    ) -> DetectionRunResult:
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
        frame_detections: list[FrameDetections] = []
        tracklet_states: dict[int, dict[str, Any]] = {}

        try:
            while True:
                if self.max_frames and frame_index >= self.max_frames:
                    break

                ok, frame = cap.read()
                if not ok:
                    break

                detections = self._predict_frame(frame)
                detections = tracker.update(detections) if len(detections) else detections
                timestamp_seconds = frame_index / fps if fps else float(frame_index)
                frame_payload = FrameDetections(frame_index=frame_index, timestamp_seconds=timestamp_seconds)

                if len(detections):
                    height, width = frame.shape[:2]
                    for det_index in range(len(detections)):
                        class_id = (
                            int(detections.class_id[det_index])
                            if detections.class_id is not None and detections.class_id[det_index] is not None
                            else None
                        )
                        class_name = _get_class_name(self.model.names, class_id)
                        object_type = _normalize_object_type(class_name)

                        confidence = (
                            float(detections.confidence[det_index])
                            if detections.confidence is not None and detections.confidence[det_index] is not None
                            else 0.0
                        )
                        tracker_id = (
                            int(detections.tracker_id[det_index])
                            if detections.tracker_id is not None and detections.tracker_id[det_index] is not None
                            else None
                        )
                        bbox = [float(value) for value in detections.xyxy[det_index].tolist()]
                        frame_payload.detections.append(
                            DetectionBox(
                                tracker_id=tracker_id,
                                class_id=class_id,
                                class_name=class_name,
                                object_type=object_type,
                                confidence=confidence,
                                bbox=bbox,
                            )
                        )

                        if tracker_id is None:
                            continue

                        state = tracklet_states.setdefault(
                            tracker_id,
                            {
                                "tracklet_id": f"{video_id}_trk_{tracker_id}",
                                "tracker_id": tracker_id,
                                "object_type": object_type,
                                "class_name": class_name,
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
            TrackletSummary(
                tracklet_id=state["tracklet_id"],
                tracker_id=state["tracker_id"],
                object_type=state["object_type"],
                class_name=state["class_name"],
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

        artifact = DetectionRunResult(
            video_id=video_id,
            camera_id=camera_id,
            model_path=self.model_path,
            video_path=video_path,
            frame_count=frame_count or frame_index,
            fps=fps,
            frame_width=frame_width,
            frame_height=frame_height,
            frame_detections=frame_detections,
            tracklets=tracklets,
            artifact_path=os.path.join(output_dir, "detections.json"),
        )

        with open(artifact.artifact_path, "w", encoding="utf-8") as handle:
            json.dump(artifact.to_dict(), handle, indent=2)

        logger.info(
            f"Detection run complete for video {video_id}: "
            f"{len(tracklets)} tracklets across {len(frame_detections)} frames."
        )
        return artifact


def resolve_standardized_video_path(video_asset: VideoAsset) -> str:
    camera_name = sanitize_filename(video_asset.camera.name if video_asset.camera else video_asset.camera_id)
    camera_dir = f"{video_asset.camera_id}_{camera_name}"
    standardized_filename = video_asset.standardized_filename
    return os.path.join(
        ".",
        "data",
        "cameras",
        camera_dir,
        "original_assets",
        standardized_filename,
    )
