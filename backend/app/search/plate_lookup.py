"""Attach number-plate information to vehicle search results.

Every vehicle result carries a ``plate`` object:

    {"status": "read", "text": "GJ05AB1234", "ocr_confidence": 0.97, "cutout_url": "/data/...", ...}
    {"status": "blurry",       ... "text": ""}   plate found but unreadable
    {"status": "not_detected", ... "text": ""}   no plate found on this vehicle
    {"status": "not_scanned",  ... "text": ""}   plate pass has not run for this vehicle yet

Non-vehicle results (people) get ``plate = None``.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from app.attributes.color_extractor import canonical_object_type
from app.db.models import LicensePlateDetection

PLATE_STATUS_LABELS = {
    "read": "Number plate",
    "blurry": "Blurry number plate",
    "not_detected": "No number plate detected",
    "not_scanned": "Number plate not scanned yet",
}


def plate_payload(row: Optional[LicensePlateDetection]) -> dict[str, Any]:
    if row is None:
        return {"status": "not_scanned", "text": "", "ocr_confidence": None, "cutout_url": None,
                "engine": None, "is_watchlisted": False}
    data = row.to_dict()
    return {
        "status": data["plate_status"],
        "text": data["plate_text"] if data["plate_status"] == "read" else "",
        "ocr_confidence": data["ocr_confidence"],
        "detector_confidence": data["confidence"],
        "cutout_url": data["cutout_url"],
        "engine": data["ocr_engine"],
        "is_watchlisted": bool(data["is_watchlisted"]),
    }


def is_vehicle(class_name: Optional[str], object_type: Optional[str]) -> bool:
    return canonical_object_type(class_name, object_type) == "vehicle"


def plates_for_tracklets(db: Session, tracklets: Iterable[Any]) -> dict[str, Optional[dict[str, Any]]]:
    """Map tracklet id -> plate payload (None for non-vehicles). One query for the whole result set."""
    tracklets = list(tracklets)
    vehicle_ids = [t.id for t in tracklets if is_vehicle(t.class_name, t.object_type)]
    rows: dict[str, LicensePlateDetection] = {}
    if vehicle_ids:
        for row in db.query(LicensePlateDetection).filter(LicensePlateDetection.tracklet_id.in_(vehicle_ids)):
            current = rows.get(row.tracklet_id)
            # prefer a recognised reading over blurry / not-detected rows if several exist
            if current is None or (current.plate_status != "read" and row.plate_status == "read"):
                rows[row.tracklet_id] = row
    vehicle_set = set(vehicle_ids)
    return {t.id: plate_payload(rows.get(t.id)) if t.id in vehicle_set else None for t in tracklets}
