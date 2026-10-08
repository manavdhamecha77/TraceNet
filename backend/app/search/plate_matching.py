"""Text matching for license plates (no image matching, no format rules).

Plates are compared as the OCR produced them, after one normalisation: upper-case letters and
digits only. Small OCR slips (O/0, I/1, a dropped character) are absorbed by edit distance.
"""
from __future__ import annotations

import re

MAX_ESTIMATE_DISTANCE = 3


def normalize(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def levenshtein(a: str, b: str, limit: int | None = None) -> int:
    """Edit distance (insert / delete / substitute, each cost 1). Stops early once above ``limit``."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    if limit is not None and abs(len(a) - len(b)) > limit:
        return abs(len(a) - len(b))

    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        if limit is not None and min(current) > limit:
            return min(current)
        previous = current
    return previous[-1]


def substring_distance(query: str, text: str) -> int:
    """
    Smallest edit distance between ``query`` and ANY substring of ``text`` (Sellers' algorithm).
    0 means the query appears verbatim inside the plate; useful when only part of a plate is known.
    """
    if not query:
        return 0
    if not text:
        return len(query)
    previous = list(range(len(query) + 1))  # matching against an empty prefix of text
    best = previous[-1]
    for ch in text:
        current = [0]  # a match may start at any position in text for free
        for j, q in enumerate(query, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (q != ch)))
        best = min(best, current[-1])
        previous = current
    return best


def plate_distance(query: str, text: str, partial: bool = False) -> int:
    """Distance between a normalised query and a normalised plate text."""
    return substring_distance(query, text) if partial else levenshtein(query, text)


def match_distance(query: str, text: str, mode: str, partial: bool, max_distance: int) -> int | None:
    """
    Distance if the plate matches under the chosen mode, else None.

    * exact    -> only distance 0 (whole plate equal, or query contained in the plate when partial)
    * estimate -> any distance up to ``max_distance`` (capped at 3)
    """
    allowed = 0 if mode == "exact" else max(0, min(MAX_ESTIMATE_DISTANCE, max_distance))
    distance = plate_distance(query, text, partial)
    return distance if distance <= allowed else None
