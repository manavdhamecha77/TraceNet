"""Best-effort privacy redaction: pixelate every detected face except those of the matched subject.

Face detection backends, in order of preference:
  1. the project's YOLO face model (``models/face_detection/*.pt``, same one the face pipeline uses)
  2. OpenCV Haar cascades (frontal + profile) when this OpenCV build ships them

If neither is available the export FAILS CLOSED (``FaceRedactionUnavailable``) rather than silently
producing unredacted footage. Redaction is a privacy aid, not a guarantee: small, occluded or turned
faces can be missed, and the export manifest states this.
"""
from __future__ import annotations

import os
from typing import Iterable, Optional, Sequence

import cv2
import numpy as np
from loguru import logger
from app.runtime.device import get_device, use_half_precision

BACKEND_YOLO = "yolo-face-pixelate"
BACKEND_HAAR = "opencv-haar-pixelate"

# Kept for manifest compatibility: the *active* method is reported by ``available_backend()``.
BLUR_METHOD = "pixelate"


class FaceRedactionUnavailable(RuntimeError):
    """Raised when face redaction was requested but no face detector can be loaded."""


_haar: Optional[list] = None
_yolo_path_checked = False
_yolo_model = None


def _haar_cascades() -> list:
    global _haar
    if _haar is None:
        loaded = []
        if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data"):
            for name in ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"):
                cascade = cv2.CascadeClassifier(cv2.data.haarcascades + name)
                if not cascade.empty():
                    loaded.append(cascade)
        _haar = loaded
    return _haar


def _yolo_face_model():
    """Return the project's YOLO face model if its weights exist, else None."""
    global _yolo_model, _yolo_path_checked
    if _yolo_model is not None:
        return _yolo_model
    try:
        from app.detection.face_detector import get_face_detector
        from app.detection.detector import load_detection_model

        path = get_face_detector().model_path
        if os.path.exists(path):
            _yolo_model = load_detection_model(path)
    except Exception as exc:  # weights missing or ultralytics unavailable
        if not _yolo_path_checked:
            logger.info(f"YOLO face model unavailable for redaction: {exc}")
    _yolo_path_checked = True
    return _yolo_model


def available_backend() -> Optional[str]:
    if _yolo_face_model() is not None:
        return BACKEND_YOLO
    if _haar_cascades():
        return BACKEND_HAAR
    return None


def detect_faces(frame: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Return face boxes as (x1, y1, x2, y2). Raises FaceRedactionUnavailable if no backend exists."""
    backend = available_backend()
    if backend is None:
        raise FaceRedactionUnavailable(
            "Face redaction requested but no face detector is available: add YOLO face weights under "
            "backend/data/models/face_detection/ or use an OpenCV build with Haar cascades. "
            "The export was cancelled so that no unredacted footage is released."
        )
    if backend == BACKEND_YOLO:
        results = _yolo_face_model().predict(frame, conf=0.35, verbose=False, device=get_device())
        boxes: list[tuple[int, int, int, int]] = []
        for r in results:
            if r.boxes is None:
                continue
            for xyxy in r.boxes.xyxy.cpu().numpy():
                boxes.append(tuple(int(v) for v in xyxy))  # type: ignore[arg-type]
        return boxes

    gray = cv2.equalizeHist(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
    min_side = max(16, min(frame.shape[:2]) // 40)
    boxes = []
    for cascade in _haar_cascades():
        for (x, y, w, h) in cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(min_side, min_side)):
            boxes.append((int(x), int(y), int(x + w), int(y + h)))
    return boxes


def _center_inside(face: Sequence[int], box: Sequence[float]) -> bool:
    cx, cy = (face[0] + face[2]) / 2, (face[1] + face[3]) / 2
    return box[0] <= cx <= box[2] and box[1] <= cy <= box[3]


def pixelate_regions(frame: np.ndarray, regions: Iterable[Sequence[int]]) -> int:
    """Pixelate regions in place (with 20 % padding). Returns how many were redacted."""
    height, width = frame.shape[:2]
    count = 0
    for (x1, y1, x2, y2) in regions:
        pad_x, pad_y = int((x2 - x1) * 0.2), int((y2 - y1) * 0.2)
        x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
        x2, y2 = min(width, x2 + pad_x), min(height, y2 + pad_y)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        roi = frame[y1:y2, x1:x2]
        blocks = 8
        small = cv2.resize(roi, (max(1, (x2 - x1) // blocks), max(1, (y2 - y1) // blocks)), interpolation=cv2.INTER_LINEAR)
        frame[y1:y2, x1:x2] = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
        count += 1
    return count


def blur_non_matched_faces(
    frame: np.ndarray,
    protected_boxes: Sequence[Sequence[float]],
    cached_faces: Optional[list[tuple[int, int, int, int]]] = None,
) -> tuple[int, list[tuple[int, int, int, int]]]:
    """
    Redact all faces whose centre is outside every protected (matched-subject) box.
    Pass ``cached_faces`` to reuse detections from a previous frame. Returns (count, faces_detected).
    """
    faces = cached_faces if cached_faces is not None else detect_faces(frame)
    to_blur = [f for f in faces if not any(_center_inside(f, b) for b in protected_boxes)]
    return pixelate_regions(frame, to_blur), faces
