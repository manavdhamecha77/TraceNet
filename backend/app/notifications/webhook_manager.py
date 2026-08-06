"""
Webhook notification system for assault detection alerts.
Manages webhook subscriptions and delivers notifications on high-confidence detections.
"""

import json
import uuid
import httpx
import threading
from datetime import datetime
from typing import List, Optional, Dict, Any
from loguru import logger

from app.db.session import SessionLocal
from app.db.models import Webhook
from app.config import get_data_path


class WebhookManager:
    """
    Manages webhook endpoints and delivers notifications asynchronously.
    Thread-safe with lock-protected operations.
    """

    def __init__(self, timeout: float = 10.0, max_retries: int = 3):
        self.timeout = timeout
        self.max_retries = max_retries
        self.webhook_lock = threading.Lock()

    def register_webhook(
        self,
        url: str,
        webhook_type: str = "assault",
        confidence_threshold: float = 0.6,
        camera_ids: Optional[List[str]] = None
    ) -> str:
        """
        Register a new webhook endpoint.

        Args:
            url: Webhook URL to POST to
            webhook_type: Type of alert ('assault' or 'all_alerts')
            confidence_threshold: Only trigger for assaults above this confidence
            camera_ids: List of camera IDs to filter on (empty = all cameras)

        Returns:
            Webhook ID
        """
        try:
            with self.webhook_lock:
                webhook_id = str(uuid.uuid4())
                db = SessionLocal()
                webhook = Webhook(
                    id=webhook_id,
                    url=url,
                    webhook_type=webhook_type,
                    confidence_threshold=confidence_threshold,
                    camera_ids=json.dumps(camera_ids or []),
                    is_active=True
                )
                db.add(webhook)
                db.commit()
                db.close()
                logger.info(f"Registered webhook: {webhook_id} -> {url}")
                return webhook_id
        except Exception as e:
            logger.error(f"Failed to register webhook: {e}")
            raise

    def get_webhooks(self) -> List[Dict[str, Any]]:
        """Get all active webhooks."""
        try:
            with self.webhook_lock:
                db = SessionLocal()
                webhooks = db.query(Webhook).filter(Webhook.is_active == True).all()
                result = [w.to_dict() for w in webhooks]
                db.close()
                return result
        except Exception as e:
            logger.error(f"Failed to get webhooks: {e}")
            return []

    def get_webhook(self, webhook_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific webhook."""
        try:
            with self.webhook_lock:
                db = SessionLocal()
                webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
                if webhook:
                    result = webhook.to_dict()
                else:
                    result = None
                db.close()
                return result
        except Exception as e:
            logger.error(f"Failed to get webhook {webhook_id}: {e}")
            return None

    def update_webhook(
        self,
        webhook_id: str,
        url: Optional[str] = None,
        webhook_type: Optional[str] = None,
        confidence_threshold: Optional[float] = None,
        camera_ids: Optional[List[str]] = None,
        is_active: Optional[bool] = None
    ) -> bool:
        """Update webhook configuration."""
        try:
            with self.webhook_lock:
                db = SessionLocal()
                webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
                if not webhook:
                    db.close()
                    return False

                if url is not None:
                    webhook.url = url
                if webhook_type is not None:
                    webhook.webhook_type = webhook_type
                if confidence_threshold is not None:
                    webhook.confidence_threshold = confidence_threshold
                if camera_ids is not None:
                    webhook.camera_ids = json.dumps(camera_ids)
                if is_active is not None:
                    webhook.is_active = is_active
                webhook.updated_at = datetime.utcnow()

                db.commit()
                db.close()
                logger.info(f"Updated webhook: {webhook_id}")
                return True
        except Exception as e:
            logger.error(f"Failed to update webhook {webhook_id}: {e}")
            return False

    def delete_webhook(self, webhook_id: str) -> bool:
        """Delete a webhook."""
        try:
            with self.webhook_lock:
                db = SessionLocal()
                webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
                if not webhook:
                    db.close()
                    return False

                db.delete(webhook)
                db.commit()
                db.close()
                logger.info(f"Deleted webhook: {webhook_id}")
                return True
        except Exception as e:
            logger.error(f"Failed to delete webhook {webhook_id}: {e}")
            return False

    def trigger_webhooks(
        self,
        alert_type: str,
        camera_id: str,
        video_id: str,
        assault_type: str,
        confidence: float,
        timestamp: str,
        alert_id: Optional[int] = None
    ) -> None:
        """
        Trigger webhooks asynchronously for an alert.
        Runs in background thread to avoid blocking.
        """
        thread = threading.Thread(
            target=self._trigger_webhooks_async,
            args=(alert_type, camera_id, video_id, assault_type, confidence, timestamp, alert_id),
            daemon=True
        )
        thread.start()

    def _trigger_webhooks_async(
        self,
        alert_type: str,
        camera_id: str,
        video_id: str,
        assault_type: str,
        confidence: float,
        timestamp: str,
        alert_id: Optional[int] = None
    ) -> None:
        """Internal async webhook trigger."""
        try:
            db = SessionLocal()
            webhooks = db.query(Webhook).filter(Webhook.is_active == True).all()

            for webhook in webhooks:
                try:
                    # Skip if confidence below threshold
                    if alert_type == "assault" and confidence < webhook.confidence_threshold:
                        continue

                    # Skip if camera not in filter list
                    try:
                        camera_filter = json.loads(webhook.camera_ids) if webhook.camera_ids else []
                    except Exception:
                        camera_filter = []

                    if camera_filter and camera_id not in camera_filter:
                        continue

                    # Skip if webhook type doesn't match
                    if webhook.webhook_type == "assault" and alert_type != "assault":
                        continue

                    # Prepare payload
                    payload = {
                        "event": alert_type,
                        "camera_id": camera_id,
                        "video_id": video_id,
                        "assault_type": assault_type if alert_type == "assault" else None,
                        "confidence": confidence if alert_type == "assault" else None,
                        "timestamp": timestamp,
                        "alert_id": alert_id
                    }

                    # Send webhook
                    self._send_webhook(webhook, payload)

                except Exception as e:
                    logger.error(f"Error processing webhook {webhook.id}: {e}")

            db.close()
        except Exception as e:
            logger.error(f"Error in webhook trigger: {e}")

    def _send_webhook(self, webhook: Webhook, payload: Dict[str, Any]) -> bool:
        """Send webhook POST request with retries."""
        for attempt in range(self.max_retries):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(
                        webhook.url,
                        json=payload,
                        headers={"Content-Type": "application/json"}
                    )
                    response.raise_for_status()

                # Update last triggered and increment delivery count
                try:
                    db = SessionLocal()
                    w = db.query(Webhook).filter(Webhook.id == webhook.id).first()
                    if w:
                        w.last_triggered_at = datetime.utcnow()
                        w.delivery_count = (w.delivery_count or 0) + 1
                        db.commit()
                    db.close()
                except Exception as e:
                    logger.error(f"Failed to update webhook stats: {e}")

                logger.info(f"Webhook {webhook.id} delivered successfully")
                return True

            except Exception as e:
                logger.warning(f"Webhook delivery attempt {attempt + 1}/{self.max_retries} failed for {webhook.id}: {e}")
                if attempt == self.max_retries - 1:
                    logger.error(f"Webhook {webhook.id} delivery failed after {self.max_retries} attempts")
                    return False

        return False


# Global instance
_webhook_manager = None


def get_webhook_manager() -> WebhookManager:
    """Get or create global webhook manager instance."""
    global _webhook_manager
    if _webhook_manager is None:
        _webhook_manager = WebhookManager()
    return _webhook_manager
