"""Attribute tooling: query preview and backfill of colour/type attributes for indexed tracklets."""
import json
import os
import re

from fastapi import APIRouter, Depends
from loguru import logger
from sqlalchemy.orm import Session

from app.attributes.color_extractor import canonical_object_type, extract_tracklet_attributes
from app.db.models import Tracklet
from app.db.session import get_db
from app.search.attribute_parser import parse_query
from app.search.vector_index import COLLECTION_NAME, get_qdrant_client

router = APIRouter(prefix="/api/v1", tags=["attributes"])


@router.get("/search/parse")
def preview_query_attributes(q: str = ""):
    """Show which attributes the system will verify for a query, and which it cannot verify."""
    from app.search.multilingual import normalize_query
    norm_res = normalize_query(q)
    effective_q = norm_res[0] if norm_res else q
    constraints = [c.to_dict() for c in parse_query(effective_q)]
    return {
        "query": q,
        "normalized_query": effective_q,
        "is_multilingual": norm_res.details.get("is_multilingual", False) if norm_res else False,
        "detected_language": norm_res.details.get("detected_language", "English") if norm_res else "English",
        "language_code": norm_res.details.get("language_code", "en") if norm_res else "en",
        "backend_used": norm_res.details.get("backend_used", "offline_ai") if norm_res else "offline_ai",
        "verifiable": [c for c in constraints if c["verifiable"]],
        "unverifiable": [c for c in constraints if not c["verifiable"]],
    }


@router.post("/attributes/backfill")
def backfill_tracklet_attributes(force: bool = False, db: Session = Depends(get_db)):
    """
    Compute colour/type attributes for tracklets indexed before attribute extraction existed,
    and normalise legacy detector classes (e.g. 'pedestrain' -> person) in SQLite and Qdrant.
    """
    client = get_qdrant_client()
    updated = skipped = failed = 0

    for tracklet in db.query(Tracklet).all():
        try:
            attrs = json.loads(tracklet.attributes) if tracklet.attributes else {}
        except Exception:
            attrs = {}

        canonical_type = canonical_object_type(tracklet.class_name, tracklet.object_type)
        needs_type_fix = canonical_type != "object" and tracklet.object_type != canonical_type
        id_match = re.search(r"_trk_(\d+)$", tracklet.id)
        real_tracker_id = int(id_match.group(1)) if id_match else None
        needs_tracker_fix = real_tracker_id is not None and tracklet.tracker_id != real_tracker_id
        if "color_status" in attrs and not force and not needs_type_fix and not needs_tracker_fix:
            skipped += 1
            continue

        crop_ok = bool(tracklet.best_crop_path and os.path.exists(tracklet.best_crop_path))
        if crop_ok and ("color_status" not in attrs or force):
            attrs.update(
                extract_tracklet_attributes(
                    tracklet.best_crop_path, tracklet.class_name, tracklet.object_type, attrs.get("caption", "")
                )
            )
        elif "color_status" not in attrs:
            attrs.update({"kind": canonical_type, "color_status": "unavailable"})

        try:
            if canonical_type != "object":
                tracklet.object_type = canonical_type
            if needs_tracker_fix:
                tracklet.tracker_id = real_tracker_id
            tracklet.attributes = json.dumps(attrs)
            db.commit()
            if tracklet.qdrant_point_id:
                client.set_payload(
                    collection_name=COLLECTION_NAME,
                    payload={
                        "object_type": tracklet.object_type,
                        "colors": attrs.get("colors", []),
                        "vehicle_type": attrs.get("vehicle_type"),
                    },
                    points=[tracklet.qdrant_point_id],
                )
            updated += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            logger.error(f"Attribute backfill failed for {tracklet.id}: {exc}")

    return {"updated": updated, "skipped": skipped, "failed": failed}
