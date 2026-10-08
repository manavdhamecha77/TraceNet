"""
Automatic License Plate Recognition (ANPR) module.
Two-stage pipeline: a YOLO vehicle detector first localizes vehicles, then a
fine-tuned YOLO plate detector finds the license plate within each vehicle
crop, and PaddleOCR (PP-OCRv5) reads the plate text.

If the vehicle detector weights aren't present, the pipeline falls back to
running the plate detector directly on the full frame.
"""

import os
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import torch
from loguru import logger
from ultralytics import YOLO

from app.config import get_data_path
from app.detection.plate_ocr import clean_plate_text, get_ocr_engine

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"
DATA_MODELS_DIR = Path(get_data_path("models"))
DEFAULT_MODEL_PATH = str(DATA_MODELS_DIR / "license_plate_detector.pt")
DEFAULT_VEHICLE_MODEL_PATH = str(DATA_MODELS_DIR / "vehicle_detector.pt")

# A reading shorter than this is treated as garbage ('blurry plate'); nothing else is filtered or parsed.
MIN_PLATE_CHARS = 3


class PlateDetector:
    """
    Detects license plates in video frames and reads their text.
    Vehicle localization model: fine-tuned YOLO (Car/Bus/HCV/LCV/Two-wheeler/
    Three-wheeler/Pedestrian) — optional, narrows the search region.
    Plate detection model: fine-tuned YOLOv8n (single class: License_Plate).
    OCR model: PaddleOCR PP-OCRv5 (text detection + English recognition), see plate_ocr.py.
    """

    def __init__(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        vehicle_model_path: str = DEFAULT_VEHICLE_MODEL_PATH,
        ocr_min_confidence: float = 0.5,
        confidence_threshold: float = 0.35,
        vehicle_confidence_threshold: float = 0.35,
        vehicle_crop_padding: float = 0.10,
    ):
        self.model_path = model_path
        self.vehicle_model_path = vehicle_model_path
        self.ocr_min_confidence = ocr_min_confidence
        self.confidence_threshold = confidence_threshold
        self.vehicle_confidence_threshold = vehicle_confidence_threshold
        self.vehicle_crop_padding = vehicle_crop_padding
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model: Optional[YOLO] = None
        self.vehicle_model: Optional[YOLO] = None
        # The detector is a process-wide singleton shared by request threads, the ingest pipeline and the
        # plate backfill job; YOLO inference on one model object is not guaranteed thread-safe.
        self._infer_lock = threading.RLock()

    @property
    def ocr_engine(self):
        """The process-wide active OCR engine (switchable at runtime, see plate_ocr.set_active_engine)."""
        return get_ocr_engine()

    @property
    def ocr_model_name(self) -> str:
        return self.ocr_engine.engine_name

    def load_model(self):
        """Load the plate detector, vehicle detector, and OCR engine (idempotent)."""
        if self.model is not None:
            return

        from app.storage.media import resolve_model_file

        actual_model_path = Path(resolve_model_file(self.model_path) or self.model_path)
        if not actual_model_path.exists():
            fallback = WEIGHTS_DIR / actual_model_path.name
            if fallback.exists():
                actual_model_path = fallback

        if not actual_model_path.exists():
            raise FileNotFoundError(f"Plate detector weights not found: {self.model_path}")

        logger.info(f"Loading license plate detector: {actual_model_path}")
        self.model = YOLO(str(actual_model_path)).to(self.device)

        actual_vehicle_path = Path(resolve_model_file(self.vehicle_model_path) or self.vehicle_model_path)
        if not actual_vehicle_path.exists():
            fallback_v = WEIGHTS_DIR / actual_vehicle_path.name
            if fallback_v.exists():
                actual_vehicle_path = fallback_v

        if actual_vehicle_path.exists():
            logger.info(f"Loading vehicle detector: {actual_vehicle_path}")
            self.vehicle_model = YOLO(str(actual_vehicle_path)).to(self.device)
        else:
            logger.warning(
                f"Vehicle detector weights not found at {self.vehicle_model_path}; "
                "falling back to full-frame plate detection."
            )
            self.vehicle_model = None

        self.ocr_engine.load()

        logger.info("License plate detector ready")

    @staticmethod
    def _clean_plate_text(raw_text: str) -> str:
        return clean_plate_text(raw_text)

    def _read_plate_text(self, cutout) -> Tuple[str, float]:
        """Read a plate cutout with PaddleOCR. Returns (text, ocr_confidence); ("", 0.0) if unreadable."""
        if cutout is None or cutout.size == 0:
            return "", 0.0
        try:
            text, score = self.ocr_engine.read(cutout)
        except Exception as e:
            logger.warning(f"Plate OCR failed: {e}")
            return "", 0.0
        if len(text) < MIN_PLATE_CHARS or score < self.ocr_min_confidence:
            return "", 0.0
        return text, score

    def _detect_vehicle_regions(self, frame) -> List[Tuple[int, int, int, int]]:
        """Detect vehicles in the frame and return padded crop regions (x1, y1, x2, y2)."""
        h, w = frame.shape[:2]
        results = self.vehicle_model.predict(
            source=frame, conf=self.vehicle_confidence_threshold, verbose=False, device=self.device
        )
        boxes = results[0].boxes if results and results[0].boxes is not None else []

        regions: List[Tuple[int, int, int, int]] = []
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
            pw = int((x2 - x1) * self.vehicle_crop_padding)
            ph = int((y2 - y1) * self.vehicle_crop_padding)
            rx1, ry1 = max(0, x1 - pw), max(0, y1 - ph)
            rx2, ry2 = min(w, x2 + pw), min(h, y2 + ph)
            if rx2 > rx1 and ry2 > ry1:
                regions.append((rx1, ry1, rx2, ry2))

        return regions

    def analyze_region(self, frame, region: Tuple[int, int, int, int]) -> List[Dict[str, Any]]:
        """
        Find and read plates inside one region of ``frame`` (e.g. a vehicle box).

        Unlike ``_detect_plates_in_region`` this keeps plates whose text could not be read
        (``plate_text == ""``), so callers can tell "plate seen but blurry" from "no plate".
        Boxes are returned in full-frame coordinates together with the plate cutout image.
        """
        if self.model is None:
            self.load_model()

        rx1, ry1, rx2, ry2 = region
        region_crop = frame[ry1:ry2, rx1:rx2]
        if region_crop.size == 0:
            return []

        with self._infer_lock:
            results = self.model.predict(
                source=region_crop, conf=self.confidence_threshold, verbose=False, device=self.device
            )
        boxes = results[0].boxes if results and results[0].boxes is not None else []

        candidates: List[Dict[str, Any]] = []
        for box in boxes:
            lx1, ly1, lx2, ly2 = box.xyxy[0].cpu().numpy().astype(int)
            lx1, ly1 = max(0, lx1), max(0, ly1)
            lx2 = min(region_crop.shape[1], lx2)
            ly2 = min(region_crop.shape[0], ly2)
            if lx2 <= lx1 or ly2 <= ly1:
                continue
            cutout = region_crop[ly1:ly2, lx1:lx2]
            text, ocr_confidence = self._read_plate_text(cutout)
            candidates.append({
                "bbox": [int(rx1 + lx1), int(ry1 + ly1), int(rx1 + lx2), int(ry1 + ly2)],
                "confidence": float(box.conf[0].cpu().numpy()),
                "cutout": cutout.copy(),
                "plate_text": text,
                "ocr_confidence": float(ocr_confidence),
            })
        return candidates

    def _detect_plates_in_region(
        self,
        frame,
        region: Tuple[int, int, int, int],
        frame_number: int,
        timestamp_seconds: float,
        cutout_dir: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Run the plate detector within one region and map results back to full-frame coordinates."""
        rx1, ry1, rx2, ry2 = region
        region_crop = frame[ry1:ry2, rx1:rx2]
        if region_crop.size == 0:
            return []

        with self._infer_lock:
            results = self.model.predict(
                source=region_crop, conf=self.confidence_threshold, verbose=False, device=self.device
            )
        boxes = results[0].boxes if results and results[0].boxes is not None else []

        detections: List[Dict[str, Any]] = []
        for box in boxes:
            lx1, ly1, lx2, ly2 = box.xyxy[0].cpu().numpy().astype(int)
            lx1, ly1 = max(0, lx1), max(0, ly1)
            lx2 = min(region_crop.shape[1], lx2)
            ly2 = min(region_crop.shape[0], ly2)
            if lx2 <= lx1 or ly2 <= ly1:
                continue

            confidence = float(box.conf[0].cpu().numpy())
            cutout = region_crop[ly1:ly2, lx1:lx2]
            plate_text, ocr_confidence = self._read_plate_text(cutout)
            if not plate_text:
                continue

            # Map plate bbox from region-local coordinates back to full-frame coordinates
            gx1, gy1, gx2, gy2 = rx1 + lx1, ry1 + ly1, rx1 + lx2, ry1 + ly2

            cutout_path = None
            if cutout_dir:
                os.makedirs(cutout_dir, exist_ok=True)
                filename = f"plate_{frame_number:06d}_{uuid.uuid4().hex[:8]}.jpg"
                cutout_path = os.path.join(cutout_dir, filename)
                cv2.imwrite(cutout_path, cutout, [cv2.IMWRITE_JPEG_QUALITY, 92])

            detections.append({
                "frame_number": frame_number,
                "timestamp_seconds": round(timestamp_seconds, 2),
                "plate_text": plate_text,
                "confidence": round(confidence, 4),
                "ocr_confidence": round(ocr_confidence, 4),
                "bbox": [int(gx1), int(gy1), int(gx2), int(gy2)],
                "cutout_path": cutout_path,
            })

        return detections

    def detect_frame(
        self,
        frame,
        frame_number: int = 0,
        timestamp_seconds: float = 0.0,
        cutout_dir: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Detect and read all license plates in a single frame."""
        if self.model is None:
            self.load_model()

        if frame is None or frame.size == 0:
            return []

        h, w = frame.shape[:2]

        if self.vehicle_model is not None:
            regions = self._detect_vehicle_regions(frame)
            if not regions:
                return []
        else:
            # No vehicle detector available: fall back to scanning the full frame
            regions = [(0, 0, w, h)]

        detections: List[Dict[str, Any]] = []
        for region in regions:
            detections.extend(
                self._detect_plates_in_region(frame, region, frame_number, timestamp_seconds, cutout_dir)
            )

        return detections

    @staticmethod
    def _sighting_score(det: Dict[str, Any]) -> float:
        """Rank sightings by detector confidence x OCR confidence (a sharp box with a misread is not 'best')."""
        return det["confidence"] * det.get("ocr_confidence", 1.0)

    def detect_video(
        self,
        video_path: str,
        sample_fps: float = 2.0,
        cutout_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Scan a video at a fixed sampling rate and return the best (highest-confidence)
        sighting of each distinct plate text found.
        """
        if self.model is None:
            self.load_model()

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"plates": [], "frames_analyzed": 0, "error": f"Cannot open video: {video_path}"}

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        sample_interval = max(1, round(fps / sample_fps)) if sample_fps > 0 else 1

        best_by_plate: Dict[str, Dict[str, Any]] = {}
        frame_index = 0
        frames_analyzed = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_index % sample_interval == 0:
                timestamp_seconds = frame_index / fps if fps > 0 else 0.0
                frame_detections = self.detect_frame(
                    frame,
                    frame_number=frame_index,
                    timestamp_seconds=timestamp_seconds,
                    cutout_dir=cutout_dir,
                )
                frames_analyzed += 1

                for det in frame_detections:
                    text = det["plate_text"]
                    existing = best_by_plate.get(text)
                    if existing is None or self._sighting_score(det) > self._sighting_score(existing):
                        best_by_plate[text] = det

            frame_index += 1

        cap.release()

        plates = sorted(best_by_plate.values(), key=self._sighting_score, reverse=True)
        return {
            "plates": plates,
            "frames_analyzed": frames_analyzed,
            "total_frames": frame_index,
            "fps": fps,
        }


# Global instance
_plate_detector: Optional[PlateDetector] = None


def get_plate_detector() -> PlateDetector:
    """Get or create the global plate detector instance."""
    global _plate_detector
    if _plate_detector is None:
        _plate_detector = PlateDetector()
    return _plate_detector
