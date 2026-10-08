"""License plate text recognition with a switchable OCR engine.

Engines (selected at runtime through the global active engine, see ``set_active_engine``):
  * ``paddleocr``      PaddleOCR PP-OCRv5. Most accurate; detects text lines inside the cutout, which
                       also handles the two-row plates common on Indian two-wheelers (rows are
                       re-assembled top-to-bottom, left-to-right). ~0.4 s per plate on CPU.
  * ``fast-plate-ocr`` Lightweight CCT model (ONNX, ~0.03 s per plate). Faster and tiny, less accurate
                       on unusual layouts.

The active engine is a process-wide global, persisted to ``backend/data/anpr_config.json`` so a switch
made from the frontend survives restarts. Switching affects future reads only; use the plate backfill
with ``force=true`` to re-read existing vehicles with the new engine.

Notes on PaddleOCR
- ``enable_mkldnn=False``: Paddle 3.x's oneDNN CPU path fails on the detection model
  ("ConvertPirAttribute2RuntimeAttribute not support ...").
- Model weights (~20 MB) are downloaded to ``~/.paddlex`` on first use, then cached.
- Predictors are not thread-safe, so calls are serialised with a lock.
"""
from __future__ import annotations

import json
import os
import re
import threading
from typing import Any, Optional

import cv2
import numpy as np
from loguru import logger

from app.config import get_data_path

# Skip PaddleX's connectivity probe of model hosters on every start-up.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

OCR_ENGINE_NAME = "PaddleOCR PP-OCRv5"
DET_MODEL = "PP-OCRv5_mobile_det"
REC_MODEL = "en_PP-OCRv5_mobile_rec"

FAST_MODEL = "cct-xs-v2-global-model"
FAST_ENGINE_NAME = "fast-plate-ocr (lightweight)"

MIN_LINE_SCORE = 0.30          # drop individual text lines the recogniser is unsure about
MIN_HEIGHT_PX = 64             # tiny plate cutouts are upscaled to at least this height
MAX_UPSCALE = 4.0
BORDER_PX = 10


def clean_plate_text(raw_text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw_text or "").upper()).strip()


def prepare_cutout(cutout: np.ndarray) -> np.ndarray:
    """Upscale small cutouts and add a margin; the detector is more reliable with some context."""
    h, w = cutout.shape[:2]
    if h < MIN_HEIGHT_PX:
        scale = min(MAX_UPSCALE, MIN_HEIGHT_PX / max(1, h))
        cutout = cv2.resize(cutout, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_CUBIC)
    return cv2.copyMakeBorder(cutout, BORDER_PX, BORDER_PX, BORDER_PX, BORDER_PX, cv2.BORDER_REPLICATE)


def assemble_lines(lines: list[tuple[list[float], str, float]]) -> tuple[str, float]:
    """
    Order recognised lines into reading order and join them.

    ``lines`` is a list of (box, text, score) with box = [x1, y1, x2, y2]. Boxes whose vertical
    centres are within half a line height share a row (sorted left to right); rows are read
    top to bottom. Returns (cleaned_text, character-weighted mean score).
    """
    usable = [(b, clean_plate_text(t), s) for b, t, s in lines if s >= MIN_LINE_SCORE and clean_plate_text(t)]
    if not usable:
        return "", 0.0

    heights = sorted(max(1.0, b[3] - b[1]) for b, _, _ in usable)
    row_tolerance = 0.5 * heights[len(heights) // 2]

    rows: list[list[tuple[list[float], str, float]]] = []
    for item in sorted(usable, key=lambda it: (it[0][1] + it[0][3]) / 2):
        center_y = (item[0][1] + item[0][3]) / 2
        if rows:
            row_center = sum((b[1] + b[3]) / 2 for b, _, _ in rows[-1]) / len(rows[-1])
            if abs(center_y - row_center) <= row_tolerance:
                rows[-1].append(item)
                continue
        rows.append([item])

    ordered = [item for row in rows for item in sorted(row, key=lambda it: it[0][0])]
    text = "".join(t for _, t, _ in ordered)
    chars = sum(len(t) for _, t, _ in ordered)
    score = sum(s * len(t) for _, t, s in ordered) / max(1, chars)
    return text, float(score)


class PlateOCREngine:
    """Interface: ``read(cutout_bgr) -> (plate_text, confidence)``; ("", 0.0) when nothing is legible."""

    key = ""
    engine_name = ""
    description = ""
    lightweight = False

    @property
    def loaded(self) -> bool:  # pragma: no cover - interface
        raise NotImplementedError

    def is_available(self) -> tuple[bool, str]:  # pragma: no cover - interface
        raise NotImplementedError

    def load(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def read(self, cutout: np.ndarray) -> tuple[str, float]:  # pragma: no cover - interface
        raise NotImplementedError


class PaddlePlateOCR(PlateOCREngine):
    """Lazy-loading PaddleOCR wrapper that returns (plate_text, confidence) for a plate cutout."""

    key = "paddleocr"
    engine_name = OCR_ENGINE_NAME
    description = "PaddleOCR PP-OCRv5: most accurate, handles two-row plates (~0.4 s per plate on CPU)."

    def __init__(self) -> None:
        self._ocr: Optional[Any] = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._ocr is not None

    def is_available(self) -> tuple[bool, str]:
        try:
            import paddleocr  # noqa: F401
        except ImportError:
            return False, "paddleocr is not installed"
        return True, ""

    def load(self) -> None:
        if self._ocr is not None:
            return
        with self._lock:
            if self._ocr is not None:
                return
            try:
                from paddleocr import PaddleOCR
            except ImportError as exc:
                raise RuntimeError(
                    "PaddleOCR is not installed. Install paddlepaddle and paddleocr (see requirements.txt)."
                ) from exc
            logger.info(f"Loading plate OCR engine: {OCR_ENGINE_NAME} ({DET_MODEL} + {REC_MODEL})")
            self._ocr = PaddleOCR(
                text_detection_model_name=DET_MODEL,
                text_recognition_model_name=REC_MODEL,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                enable_mkldnn=False,
            )

    def read(self, cutout: np.ndarray) -> tuple[str, float]:
        """Recognise the text on a BGR plate cutout. Returns ("", 0.0) when nothing legible is found."""
        if cutout is None or cutout.size == 0:
            return "", 0.0
        self.load()
        image = prepare_cutout(cutout)
        with self._lock:
            results = self._ocr.predict(image)  # type: ignore[union-attr]
        if not results:
            return "", 0.0

        result = results[0]
        texts = list(result["rec_texts"])
        scores = list(result["rec_scores"])
        boxes = result["rec_boxes"] if "rec_boxes" in result else None
        if boxes is None or len(boxes) != len(texts):
            polys = result["rec_polys"]
            boxes = [[p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()] for p in map(np.asarray, polys)]

        lines = [([float(v) for v in box], text, float(score)) for box, text, score in zip(boxes, texts, scores)]
        return assemble_lines(lines)


class FastPlateOCR(PlateOCREngine):
    """Lightweight ONNX plate recogniser (fast-plate-ocr). Single call per plate, no line detection."""

    key = "fast-plate-ocr"
    engine_name = FAST_ENGINE_NAME
    description = f"fast-plate-ocr {FAST_MODEL}: tiny ONNX model, ~10x faster, less accurate on unusual layouts."
    lightweight = True

    def __init__(self) -> None:
        self._model: Optional[Any] = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def is_available(self) -> tuple[bool, str]:
        try:
            import fast_plate_ocr  # noqa: F401
        except ImportError:
            return False, "fast-plate-ocr is not installed"
        return True, ""

    def load(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            try:
                from fast_plate_ocr import LicensePlateRecognizer
            except ImportError as exc:
                raise RuntimeError("fast-plate-ocr is not installed (pip install fast-plate-ocr).") from exc
            logger.info(f"Loading plate OCR engine: {FAST_ENGINE_NAME} ({FAST_MODEL})")
            self._model = LicensePlateRecognizer(FAST_MODEL)

    def read(self, cutout: np.ndarray) -> tuple[str, float]:
        if cutout is None or cutout.size == 0:
            return "", 0.0
        self.load()
        with self._lock:
            predictions = self._model.run(cutout, return_confidence=True)  # type: ignore[union-attr]
        if not predictions:
            return "", 0.0
        prediction = predictions[0]
        text = clean_plate_text(prediction.plate)
        if not text:
            return "", 0.0
        probs = getattr(prediction, "char_probs", None)
        score = float(np.mean(probs[: len(prediction.plate)])) if probs is not None and len(probs) else 0.0
        return text, score


# --------------------------------------------------------------------------- global engine selection
DEFAULT_ENGINE = "paddleocr"
_ENGINES: dict[str, PlateOCREngine] = {PaddlePlateOCR.key: PaddlePlateOCR(), FastPlateOCR.key: FastPlateOCR()}
_state_lock = threading.Lock()
_active_engine: Optional[str] = None


def _config_path() -> str:
    return get_data_path("anpr_config.json")


def _load_persisted_engine() -> str:
    try:
        with open(_config_path(), "r", encoding="utf-8") as handle:
            name = json.load(handle).get("ocr_engine")
        if name in _ENGINES:
            return name
    except (OSError, ValueError):
        pass
    return DEFAULT_ENGINE


def get_active_engine_name() -> str:
    global _active_engine
    with _state_lock:
        if _active_engine is None:
            _active_engine = _load_persisted_engine()
        return _active_engine


def get_ocr_engine(name: Optional[str] = None) -> PlateOCREngine:
    return _ENGINES[name or get_active_engine_name()]


def set_active_engine(name: str) -> PlateOCREngine:
    """Switch the process-wide OCR engine and persist the choice. Raises ValueError if unknown/unavailable."""
    global _active_engine
    if name not in _ENGINES:
        raise ValueError(f"Unknown OCR engine '{name}'. Choose one of: {', '.join(_ENGINES)}")
    available, reason = _ENGINES[name].is_available()
    if not available:
        raise ValueError(f"OCR engine '{name}' is unavailable: {reason}")
    with _state_lock:
        _active_engine = name
        try:
            os.makedirs(os.path.dirname(_config_path()), exist_ok=True)
            with open(_config_path(), "w", encoding="utf-8") as handle:
                json.dump({"ocr_engine": name}, handle)
        except OSError as exc:  # the switch still applies for this process
            logger.warning(f"Could not persist OCR engine choice: {exc}")
    return _ENGINES[name]


def list_engines() -> list[dict[str, Any]]:
    active = get_active_engine_name()
    out = []
    for key, engine in _ENGINES.items():
        available, reason = engine.is_available()
        out.append({
            "key": key,
            "label": engine.engine_name,
            "description": engine.description,
            "lightweight": engine.lightweight,
            "available": available,
            "unavailable_reason": reason or None,
            "loaded": engine.loaded,
            "active": key == active,
        })
    return out
