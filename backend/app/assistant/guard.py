"""Deterministic domain guard for the Copilot.

The system prompt asks the model to refuse off-topic requests, but small local models (e.g. qwen2.5:3b)
do not reliably comply. This guard refuses clearly off-topic requests before any LLM call, lets clearly
in-domain requests through, and leaves ambiguous follow-ups ("show more", "thanks") to the model.
"""

from __future__ import annotations

import re

REFUSAL = (
    "I am specialized exclusively for TraceNet Smart City CCTV Surveillance and Digital Forensics "
    "(Project DRISHTI). I cannot assist with off-topic requests such as creative writing, general "
    "knowledge, math, or programming. Please ask about camera nodes, footage search, security alerts, "
    "multi-camera tracking, or forensic audit logs."
)

# Words that mark a request as being about the platform (checked after Hindi/Gujarati normalisation).
_DOMAIN_TERMS = {
    "camera", "cameras", "cctv", "footage", "video", "videos", "clip", "clips", "frame", "frames",
    "alert", "alerts", "loitering", "loiter", "theft", "snatching", "snatch", "assault", "fight", "fighting",
    "abandoned", "accident", "collision", "suspect", "target", "targets", "pursuit", "journey", "trajectory",
    "track", "tracklet", "tracklets", "search", "find", "locate", "spot", "seen", "sighting", "sightings",
    "person", "people", "man", "men", "woman", "women", "boy", "girl", "pedestrian", "pedestrians",
    "vehicle", "vehicles", "car", "cars", "bus", "truck", "lorry", "bike", "motorcycle", "scooter",
    "rickshaw", "auto", "van", "taxi", "plate", "plates", "anpr", "number", "jacket", "shirt", "backpack",
    "bag", "helmet", "cap", "saree", "red", "blue", "black", "white", "green", "yellow",
    "model", "models", "detector", "yolo", "weights", "reindex", "index", "audit", "log", "logs",
    "report", "reports", "export", "evidence", "custody", "dashboard", "metrics", "node", "nodes", "zone",
    "area", "areas", "gate", "station", "market", "stream", "live", "drishti", "tracenet", "copilot",
}
_ID_PATTERN = re.compile(r"\b(cam_\d+|[0-9a-f]{8}-[0-9a-f]{4}-|trk_\d+)", re.IGNORECASE)

# Requests that are off-topic even when they mention a domain word ("write a poem about a camera").
_STRONG_OFF_TOPIC = re.compile(
    r"\b(poem|poetry|haiku|limerick|song|lyrics|rap|joke|jokes|riddle|story|stories|fairy ?tale|essay|"
    r"recipe|horoscope|astrology)\b",
    re.IGNORECASE,
)
# Requests that are off-topic unless they also mention the platform.
_OFF_TOPIC = re.compile(
    r"\b(homework|solve|equation|integral|derivative|calculus|algebra|python|javascript|typescript|java|"
    r"c\+\+|html|css|leetcode|program|programming|algorithm|translate|capital of|president|prime minister|"
    r"weather|forecast|stock|stocks|crypto|bitcoin|movie|movies|film|cricket|football|celebrity|"
    r"who (is|was)|what is the meaning|tell me about yourself|meaning of life)\b",
    re.IGNORECASE,
)


def _normalise(text: str) -> str:
    try:
        from app.search.multilingual import normalize_query

        return normalize_query(text)[0]
    except Exception:
        return text


def is_off_topic(text: str) -> bool:
    """True when the request is clearly outside the surveillance / forensics domain."""
    if not text or not text.strip():
        return False
    normalised = _normalise(text)
    if _STRONG_OFF_TOPIC.search(normalised):
        return True
    words = set(re.findall(r"[a-z]+", normalised.lower()))
    in_domain = bool(words & _DOMAIN_TERMS) or bool(_ID_PATTERN.search(normalised))
    return bool(_OFF_TOPIC.search(normalised)) and not in_domain
