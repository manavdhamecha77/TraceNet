"""Turn a free-text description into verifiable attribute constraints.

"man in yellow t-shirt and black cap" ->
    colour yellow @ upper body   (verifiable from the crop)
    colour black  @ head         (NOT verifiable: headwear colour is not extracted)

Verifiable constraints are checked against the structured attributes stored on each
tracklet (see ``app.attributes.color_extractor``); the rest are surfaced to the
operator as "unverified" instead of being silently ignored.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Optional

from app.attributes.color_extractor import (
    canonical_object_type,
    canonical_vehicle_type,
    COLOR_NAMES,
)

COLOR_SYNONYMS = {
    "red": "red", "maroon": "red", "crimson": "red", "scarlet": "red",
    "blue": "blue", "navy": "blue", "cyan": "blue", "sky": "blue", "teal": "blue",
    "green": "green", "olive": "green",
    "yellow": "yellow", "golden": "yellow",
    "orange": "orange", "saffron": "orange",
    "black": "black",
    "white": "white", "cream": "white",
    "gray": "gray", "grey": "gray", "silver": "gray",
    "brown": "brown", "tan": "brown", "beige": "brown", "khaki": "brown",
    "pink": "pink", "magenta": "pink",
    "purple": "purple", "violet": "purple",
}

UPPER_GARMENTS = {
    "shirt", "t-shirt", "tshirt", "tee", "jacket", "hoodie", "sweater", "sweatshirt",
    "top", "kurta", "coat", "blazer", "vest", "jersey", "uniform",
}
LOWER_GARMENTS = {"pants", "pant", "trousers", "jeans", "shorts", "skirt", "leggings", "lower"}
HEAD_ITEMS = {"cap", "hat", "helmet", "turban", "scarf", "hijab", "dupatta", "beanie"}
ACCESSORIES = {"backpack", "bag", "handbag", "umbrella", "luggage", "suitcase"}
PERSON_WORDS = {"man", "men", "woman", "women", "boy", "girl", "person", "people", "pedestrian", "male", "female"}
VEHICLE_WORDS = {
    "car", "hatchback", "sedan", "suv", "jeep", "truck", "lorry", "bus", "van", "bike",
    "motorcycle", "motorbike", "scooter", "scooty", "auto", "rickshaw", "cycle", "bicycle",
    "tempo", "taxi", "two-wheeler", "vehicle", "hcv", "lcv", "three-wheeler",
}
BODY_STYLE_WORDS = {"hatchback", "sedan", "suv", "jeep"}
_FILLER = {"and", "&", "or", "with", "a", "an", "the"}

_TOKEN = re.compile(r"[a-z]+(?:-[a-z]+)*")


@dataclass
class AttributeConstraint:
    kind: str                     # 'color' | 'vehicle_type' | 'body_style' | 'object_kind'
    value: str
    region: Optional[str] = None  # 'upper' | 'lower' | 'body' | 'any' | 'head' | 'accessory'
    text: str = ""                # phrase from the query, for display
    verifiable: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_KNOWN_NOUNS = UPPER_GARMENTS | LOWER_GARMENTS | HEAD_ITEMS | ACCESSORIES | PERSON_WORDS | VEHICLE_WORDS


def _singular(word: str) -> str:
    """'hatchbacks' -> 'hatchback', 'buses' -> 'bus'; words that are already known are left untouched."""
    if word in _KNOWN_NOUNS:
        return word
    for suffix, cut in (("es", 2), ("s", 1)):
        if word.endswith(suffix) and word[:-cut] in _KNOWN_NOUNS:
            return word[:-cut]
    return word


def _region_for_word(word: str) -> Optional[str]:
    if word in UPPER_GARMENTS:
        return "upper"
    if word in LOWER_GARMENTS:
        return "lower"
    if word in HEAD_ITEMS:
        return "head"
    if word in ACCESSORIES:
        return "accessory"
    if word in VEHICLE_WORDS:
        return "body"
    return None


def parse_query(text: str) -> list[AttributeConstraint]:
    tokens = [_singular(t) for t in _TOKEN.findall((text or "").lower())]
    constraints: list[AttributeConstraint] = []
    seen: set[tuple] = set()

    def add(c: AttributeConstraint) -> None:
        key = (c.kind, c.value, c.region)
        if key not in seen:
            seen.add(key)
            constraints.append(c)

    for i, tok in enumerate(tokens):
        if tok in COLOR_SYNONYMS:
            color = COLOR_SYNONYMS[tok]
            # "red and black jacket": look ahead past fillers / further colours for the garment word.
            j, region, noun = i + 1, None, ""
            while j < len(tokens) and j <= i + 4:
                nxt = tokens[j]
                if nxt in _FILLER or nxt in COLOR_SYNONYMS:
                    j += 1
                    continue
                region = _region_for_word(nxt)
                noun = nxt
                break
            phrase = f"{tok} {noun}".strip() if region else tok
            if region in ("head", "accessory"):
                add(AttributeConstraint("color", color, region, phrase, verifiable=False))
            else:
                add(AttributeConstraint("color", color, region or "any", phrase))

        elif tok in VEHICLE_WORDS:
            vtype = canonical_vehicle_type(tok)
            if vtype and vtype != "vehicle":
                add(AttributeConstraint("vehicle_type", vtype, "body", tok))
            if tok in BODY_STYLE_WORDS:
                # The detector only knows 'car'; the style comes from the BLIP caption and may be missing.
                add(AttributeConstraint("body_style", tok, "body", tok, verifiable=True))
            if vtype == "vehicle":
                add(AttributeConstraint("object_kind", "vehicle", None, tok))

        elif tok in PERSON_WORDS:
            add(AttributeConstraint("object_kind", "person", None, tok))

    return constraints


def constraints_from_filters(colors: Optional[Iterable[str]] = None, vehicle_type: Optional[str] = None) -> list[AttributeConstraint]:
    out: list[AttributeConstraint] = []
    for raw in colors or []:
        name = COLOR_SYNONYMS.get(str(raw).lower().strip())
        if name:
            out.append(AttributeConstraint("color", name, "any", f"{name} (filter)"))
    if vehicle_type:
        vt = canonical_vehicle_type(vehicle_type)
        if vt and vt != "vehicle":
            out.append(AttributeConstraint("vehicle_type", vt, "body", f"{vehicle_type} (filter)"))
    return out


def merge_constraints(*groups: Iterable[AttributeConstraint]) -> list[AttributeConstraint]:
    merged: list[AttributeConstraint] = []
    seen: set[tuple] = set()
    for group in groups:
        for c in group:
            key = (c.kind, c.value, c.region)
            if key not in seen:
                seen.add(key)
                merged.append(c)
    return merged


def _colors_for_region(attrs: dict[str, Any], region: str, kind: str) -> Optional[list[str]]:
    if region == "upper":
        return attrs.get("upper_colors")
    if region == "lower":
        return attrs.get("lower_colors")
    if region == "body":
        return attrs.get("body_colors")
    # 'any': every colour recorded for the tracklet
    pool = attrs.get("colors")
    if pool is None:
        pool = (attrs.get("upper_colors") or []) + (attrs.get("lower_colors") or []) + (attrs.get("body_colors") or [])
    return pool or None


def evaluate_constraints(
    constraints: list[AttributeConstraint],
    attrs: dict[str, Any],
    class_name: str,
    object_type: str,
) -> list[dict[str, Any]]:
    """Return one verdict per constraint: matched | mismatched | unverified."""
    kind_of_tracklet = attrs.get("kind") or canonical_object_type(class_name, object_type)
    results: list[dict[str, Any]] = []

    for c in constraints:
        verdict, detail = "unverified", ""

        if not c.verifiable:
            detail = f"{c.region} colour is not extracted by the system"
        elif c.kind == "object_kind":
            if kind_of_tracklet == "object":
                detail = "detector class is generic"
            else:
                verdict = "matched" if kind_of_tracklet == c.value else "mismatched"
                detail = f"detected as {kind_of_tracklet}"

        elif c.kind == "vehicle_type":
            vtype = attrs.get("vehicle_type") or canonical_vehicle_type(class_name)
            if kind_of_tracklet == "person":
                verdict, detail = "mismatched", "detected as a person"
            elif not vtype:
                detail = "vehicle type unknown"
            else:
                verdict = "matched" if vtype == c.value else "mismatched"
                detail = f"detected vehicle type: {vtype}"

        elif c.kind == "body_style":
            style = attrs.get("body_style")
            vtype = attrs.get("vehicle_type") or canonical_vehicle_type(class_name)
            if kind_of_tracklet == "person":
                verdict, detail = "mismatched", "detected as a person"
            elif style:
                verdict = "matched" if style == c.value else "mismatched"
                detail = f"caption body style: {style}"
            elif vtype and vtype not in ("car", "vehicle"):
                verdict, detail = "mismatched", f"detected vehicle type: {vtype}"
            else:
                detail = "body style not recognised (detector reports only 'car')"

        elif c.kind == "color":
            if attrs.get("color_status") not in (None, "ok") and not attrs.get("colors"):
                detail = "colour data unavailable for this tracklet"
            else:
                region = c.region or "any"
                palette = _colors_for_region(attrs, region, kind_of_tracklet)
                if palette is None:
                    # e.g. 'upper' asked of a vehicle, or attributes never computed
                    if not attrs.get("colors") and not any(attrs.get(k) for k in ("upper_colors", "lower_colors", "body_colors")):
                        detail = "no colour attributes extracted yet (run attribute backfill)"
                    else:
                        palette = _colors_for_region(attrs, "any", kind_of_tracklet)
                if palette is not None:
                    verdict = "matched" if c.value in palette else "mismatched"
                    detail = f"{region} colours: {', '.join(palette)}"

        results.append({**c.to_dict(), "verdict": verdict, "detail": detail})
    return results


def verdict_counts(verdicts: list[dict[str, Any]]) -> tuple[int, int, int]:
    m = sum(1 for v in verdicts if v["verdict"] == "matched")
    x = sum(1 for v in verdicts if v["verdict"] == "mismatched")
    u = sum(1 for v in verdicts if v["verdict"] == "unverified")
    return m, x, u


__all__ = [
    "AttributeConstraint", "parse_query", "constraints_from_filters", "merge_constraints",
    "evaluate_constraints", "verdict_counts", "COLOR_NAMES",
]
