"""Watchlist matching for license plates, shared by the pipeline pass and the manual ANPR scan."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from sqlalchemy.orm import Session

from app.db.models import Alert, PlateWatchlistEntry


def active_watchlist(db: Session) -> dict[str, PlateWatchlistEntry]:
    """Active watchlist entries keyed by normalized plate number."""
    return {
        entry.plate_number: entry
        for entry in db.query(PlateWatchlistEntry).filter(PlateWatchlistEntry.status == "active").all()
    }


def raise_watchlist_alert(
    db: Session,
    entry: PlateWatchlistEntry,
    *,
    plate_text: str,
    confidence: float,
    camera_id: str,
    video_id: Optional[str],
    tracklet_id: Optional[str] = None,
) -> Optional[Alert]:
    """
    Create an ``anpr_watchlist`` alert for a matched plate, bump the entry's counters and fire webhooks.
    Never raises: a failure here must not abort ingestion or a scan.
    """
    try:
        now = datetime.now(timezone.utc)
        alert = Alert(
            alert_type="anpr_watchlist",
            camera_id=camera_id,
            tracklet_id=tracklet_id or video_id or "",
            video_id=video_id,
            analysis_log=json.dumps({
                "plate_text": plate_text,
                "confidence": confidence,
                "watchlist_reason": entry.reason,
            }),
            timestamp=now,
        )
        db.add(alert)
        db.flush()

        entry.match_count = (entry.match_count or 0) + 1
        entry.last_matched_at = now

        try:
            from app.notifications import get_webhook_manager

            get_webhook_manager().trigger_webhooks(
                alert_type="anpr_watchlist",
                camera_id=camera_id,
                video_id=video_id,
                assault_type=plate_text,
                confidence=confidence,
                timestamp=now.isoformat(),
                alert_id=alert.id,
            )
        except Exception as exc:
            logger.warning(f"Webhook dispatch failed for watchlist plate {plate_text}: {exc}")
        return alert
    except Exception as exc:
        logger.error(f"Failed to create watchlist alert for plate {plate_text}: {exc}")
        return None
