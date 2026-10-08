"""Explicit colour / type attribute extraction for tracklet crops.

CLIP similarity alone cannot be used as a hard filter ("red hatchback" must not
return a blue car just because the embeddings are close), so every tracklet gets
structured, explainable attributes derived from its best crop:

* person  -> ``upper_colors`` (torso) and ``lower_colors`` (legs)
* vehicle -> ``body_colors`` (central body region) and a canonical ``vehicle_type``

Colours are classified per pixel in HSV space and the dominant names (>= 15 % share,
max two) are kept. This is a deliberately simple, deterministic heuristic: it is
fast enough for edge deployment and its output is easy to audit.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Optional

import cv2
import numpy as np

ATTRIBUTE_VERSION = "hsv-heuristic-v1"

COLOR_NAMES = (
    "black", "white", "gray", "red", "orange", "yellow",
    "green", "blue", "purple", "pink", "brown",
)

_MIN_SHARE = 0.15
_MAX_COLORS = 2
_MIN_CROP_SIDE = 12

_PERSON_NAMES = {"person", "pedestrian", "pedestrain", "people", "human", "rider", "man", "woman"}
_VEHICLE_TYPE_ALIASES = {
    "car": "car", "sedan": "car", "hatchback": "car", "suv": "car", "jeep": "car", "taxi": "car",
    "truck": "truck", "lorry": "truck", "tempo": "truck",
    "bus": "bus", "minibus": "bus",
    "van": "van", "minivan": "van",
    "motorcycle": "motorcycle", "motorbike": "motorcycle", "bike": "motorcycle",
    "two-wheeler": "motorcycle", "twowheeler": "motorcycle", "two_wheeler": "motorcycle",
    "scooter": "motorcycle", "scooty": "motorcycle", "moped": "motorcycle",
    "bicycle": "bicycle", "cycle": "bicycle",
    "auto": "auto-rickshaw", "rickshaw": "auto-rickshaw", "auto-rickshaw": "auto-rickshaw",
    "three-wheeler": "auto-rickshaw", "threewheeler": "auto-rickshaw", "three_wheeler": "auto-rickshaw",
    "hcv": "hcv", "lcv": "lcv",
    "vehicle": "vehicle",
}
_BODY_STYLES = ("hatchback", "sedan", "suv", "jeep", "pickup", "minivan", "convertible", "coupe", "wagon")


def canonical_object_type(class_name: Optional[str], object_type: Optional[str] = None) -> str:
    """Map raw detector class names (incl. legacy ones such as 'pedestrain') to person | vehicle | object."""
    for raw in (class_name, object_type):
        name = (raw or "").lower().strip()
        if not name:
            continue
        if name in _PERSON_NAMES:
            return "person"
        if name in _VEHICLE_TYPE_ALIASES:
            return "vehicle"
    return "object"


def canonical_vehicle_type(class_name: Optional[str], caption: str = "") -> Optional[str]:
    name = (class_name or "").lower().strip()
    if name in _VEHICLE_TYPE_ALIASES:
        return _VEHICLE_TYPE_ALIASES[name]
    for word in (caption or "").lower().replace("-", " ").split():
        if word in _VEHICLE_TYPE_ALIASES:
            return _VEHICLE_TYPE_ALIASES[word]
    return None


def body_style_from_caption(caption: str) -> Optional[str]:
    text = (caption or "").lower()
    for style in _BODY_STYLES:
        if style in text:
            return style
    return None


def _label_pixels(hsv: np.ndarray) -> np.ndarray:
    """Return an int array of indices into COLOR_NAMES, one per pixel of an HSV image."""
    h = hsv[..., 0].astype(np.int32)
    s = hsv[..., 1].astype(np.int32)
    v = hsv[..., 2].astype(np.int32)
    idx = {name: i for i, name in enumerate(COLOR_NAMES)}

    is_red_hue = (h < 8) | (h >= 170)
    conditions = [
        v < 50,                                              # black
        (s < 40) & (v >= 185),                               # white
        (s < 40),                                            # gray
        is_red_hue & (s < 150) & (v > 140),                  # pink (pale red)
        (h >= 160) & (h < 170),                              # pink / magenta
        is_red_hue,                                          # red
        (h >= 8) & (h < 20) & (v < 150),                     # brown (dark orange)
        (h >= 8) & (h < 20),                                 # orange
        (h >= 20) & (h < 35) & (v < 120),                    # brown (dark yellow)
        (h >= 20) & (h < 35),                                # yellow
        (h >= 35) & (h < 85),                                # green
        (h >= 85) & (h < 130),                               # blue (incl. cyan)
        (h >= 130) & (h < 160),                              # purple
    ]
    choices = [
        idx["black"], idx["white"], idx["gray"], idx["pink"], idx["pink"], idx["red"],
        idx["brown"], idx["orange"], idx["brown"], idx["yellow"], idx["green"], idx["blue"], idx["purple"],
    ]
    return np.select(conditions, choices, default=idx["gray"])


def dominant_colors(region_bgr: np.ndarray) -> list[str]:
    """Dominant colour names (ordered by share) in a BGR image region."""
    if region_bgr is None or region_bgr.size == 0:
        return []
    h, w = region_bgr.shape[:2]
    if h < 2 or w < 2:
        return []
    hsv = cv2.cvtColor(region_bgr, cv2.COLOR_BGR2HSV)
    labels = _label_pixels(hsv).ravel()
    counts = Counter(labels.tolist())
    total = sum(counts.values())
    ranked = [(COLOR_NAMES[i], n / total) for i, n in counts.most_common()]
    selected = [name for name, share in ranked if share >= _MIN_SHARE][:_MAX_COLORS]
    return selected or [ranked[0][0]]


def _slice(img: np.ndarray, y0: float, y1: float, x0: float, x1: float) -> np.ndarray:
    h, w = img.shape[:2]
    return img[int(h * y0):max(int(h * y1), int(h * y0) + 1), int(w * x0):max(int(w * x1), int(w * x0) + 1)]


def extract_tracklet_attributes(
    crop_path: Optional[str],
    class_name: Optional[str],
    object_type: Optional[str] = None,
    caption: str = "",
) -> dict[str, Any]:
    """Compute structured attributes for one tracklet crop. Never raises."""
    kind = canonical_object_type(class_name, object_type)
    attrs: dict[str, Any] = {"kind": kind, "attribute_version": ATTRIBUTE_VERSION}

    if kind == "vehicle":
        attrs["vehicle_type"] = canonical_vehicle_type(class_name, caption)
        style = body_style_from_caption(caption)
        if style:
            attrs["body_style"] = style

    img = cv2.imread(crop_path) if crop_path else None
    if img is None or min(img.shape[:2]) < _MIN_CROP_SIDE:
        attrs["color_status"] = "unavailable"
        return attrs

    try:
        if kind == "person":
            attrs["upper_colors"] = dominant_colors(_slice(img, 0.18, 0.52, 0.2, 0.8))
            attrs["lower_colors"] = dominant_colors(_slice(img, 0.55, 0.92, 0.2, 0.8))
            all_colors = attrs["upper_colors"] + attrs["lower_colors"]
        else:
            attrs["body_colors"] = dominant_colors(_slice(img, 0.25, 0.85, 0.15, 0.85))
            all_colors = attrs["body_colors"]
        attrs["colors"] = list(dict.fromkeys(all_colors))
        attrs["color_status"] = "ok"
    except Exception:  # pragma: no cover - defensive, attribute extraction must not break ingestion
        attrs["color_status"] = "failed"
    return attrs
