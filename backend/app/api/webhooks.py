import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl, Field
from typing import List, Optional
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import Webhook

router = APIRouter(prefix="/api/v1", tags=["webhooks"])


class WebhookRegisterRequest(BaseModel):
    url: HttpUrl
    webhook_type: str = "assault"  # 'assault' or 'all_alerts'
    confidence_threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    camera_ids: Optional[List[str]] = None


class WebhookUpdateRequest(BaseModel):
    url: Optional[HttpUrl] = None
    webhook_type: Optional[str] = None
    confidence_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
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
    last_triggered_at: Optional[str] = None
    delivery_count: int = 0


@router.post("/webhooks", response_model=WebhookResponse)
@router.post("/webhooks/register", response_model=WebhookResponse)
def register_webhook(request: WebhookRegisterRequest, db: Session = Depends(get_db)) -> WebhookResponse:
    """
    Register a new webhook endpoint.

    Webhook will be triggered on assault detection alerts with confidence >= threshold.
    Camera IDs filter: empty list means all cameras.
    """
    try:
        webhook_id = str(uuid.uuid4())
        webhook = Webhook(
            id=webhook_id,
            url=str(request.url),
            webhook_type=request.webhook_type,
            confidence_threshold=request.confidence_threshold,
            camera_ids=request.camera_ids or [],
            is_active=True
        )
        db.add(webhook)
        db.commit()
        db.refresh(webhook)
        return WebhookResponse(**webhook.to_dict())

    except Exception as e:
        logger.error(f"Failed to register webhook: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/webhooks", response_model=List[WebhookResponse])
def list_webhooks(db: Session = Depends(get_db)) -> List[WebhookResponse]:
    """Get all active webhooks."""
    webhooks = db.query(Webhook).all()
    return [WebhookResponse(**w.to_dict()) for w in webhooks]


@router.get("/webhooks/{webhook_id}", response_model=WebhookResponse)
def get_webhook(webhook_id: str, db: Session = Depends(get_db)) -> WebhookResponse:
    """Get a specific webhook."""
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook {webhook_id} not found"
        )
    return WebhookResponse(**webhook.to_dict())


@router.put("/webhooks/{webhook_id}", response_model=WebhookResponse)
def update_webhook(
    webhook_id: str,
    request: WebhookUpdateRequest,
    db: Session = Depends(get_db)
) -> WebhookResponse:
    """Update webhook configuration."""
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook {webhook_id} not found"
        )

    if request.url is not None:
        webhook.url = str(request.url)
    if request.webhook_type is not None:
        webhook.webhook_type = request.webhook_type
    if request.confidence_threshold is not None:
        webhook.confidence_threshold = request.confidence_threshold
    if request.camera_ids is not None:
        webhook.camera_ids = json.dumps(request.camera_ids)
    if request.is_active is not None:
        webhook.is_active = request.is_active

    db.commit()
    db.refresh(webhook)
    return WebhookResponse(**webhook.to_dict())


@router.delete("/webhooks/{webhook_id}")
def delete_webhook(webhook_id: str, db: Session = Depends(get_db)) -> dict:
    """Delete a webhook."""
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook {webhook_id} not found"
        )

    db.delete(webhook)
    db.commit()
    return {"status": "deleted", "webhook_id": webhook_id}
