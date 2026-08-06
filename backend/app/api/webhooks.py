"""
Webhook management API endpoints.
Register, list, update, and delete webhook subscriptions for assault detection alerts.
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, HttpUrl
from typing import List, Optional
from loguru import logger

from app.notifications import get_webhook_manager

router = APIRouter(prefix="/api/v1", tags=["webhooks"])


class WebhookRegisterRequest(BaseModel):
    url: HttpUrl
    webhook_type: str = "assault"  # 'assault' or 'all_alerts'
    confidence_threshold: float = 0.6
    camera_ids: Optional[List[str]] = None


class WebhookUpdateRequest(BaseModel):
    url: Optional[HttpUrl] = None
    webhook_type: Optional[str] = None
    confidence_threshold: Optional[float] = None
    camera_ids: Optional[List[str]] = None
    is_active: Optional[bool] = None


class WebhookResponse(BaseModel):
    id: str
    url: str
    webhook_type: str
    is_active: bool
    confidence_threshold: float
    camera_ids: List[str]
    created_at: str
    updated_at: str
    last_triggered_at: Optional[str]
    delivery_count: int


@router.post("/webhooks/register")
def register_webhook(request: WebhookRegisterRequest) -> WebhookResponse:
    """
    Register a new webhook endpoint.

    Webhook will be triggered on assault detection alerts with confidence >= threshold.
    Camera IDs filter: empty list means all cameras.
    """
    manager = get_webhook_manager()

    try:
        webhook_id = manager.register_webhook(
            url=str(request.url),
            webhook_type=request.webhook_type,
            confidence_threshold=request.confidence_threshold,
            camera_ids=request.camera_ids
        )

        webhook = manager.get_webhook(webhook_id)
        if not webhook:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve registered webhook"
            )

        return WebhookResponse(**webhook)

    except Exception as e:
        logger.error(f"Failed to register webhook: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/webhooks")
def list_webhooks() -> List[WebhookResponse]:
    """Get all active webhooks."""
    manager = get_webhook_manager()
    webhooks = manager.get_webhooks()
    return [WebhookResponse(**w) for w in webhooks]


@router.get("/webhooks/{webhook_id}")
def get_webhook(webhook_id: str) -> WebhookResponse:
    """Get a specific webhook."""
    manager = get_webhook_manager()
    webhook = manager.get_webhook(webhook_id)

    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook {webhook_id} not found"
        )

    return WebhookResponse(**webhook)


@router.put("/webhooks/{webhook_id}")
def update_webhook(
    webhook_id: str,
    request: WebhookUpdateRequest
) -> WebhookResponse:
    """Update webhook configuration."""
    manager = get_webhook_manager()

    success = manager.update_webhook(
        webhook_id=webhook_id,
        url=str(request.url) if request.url else None,
        webhook_type=request.webhook_type,
        confidence_threshold=request.confidence_threshold,
        camera_ids=request.camera_ids,
        is_active=request.is_active
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook {webhook_id} not found"
        )

    webhook = manager.get_webhook(webhook_id)
    return WebhookResponse(**webhook)


@router.delete("/webhooks/{webhook_id}")
def delete_webhook(webhook_id: str) -> dict:
    """Delete a webhook."""
    manager = get_webhook_manager()

    success = manager.delete_webhook(webhook_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook {webhook_id} not found"
        )

    return {"status": "deleted", "webhook_id": webhook_id}
