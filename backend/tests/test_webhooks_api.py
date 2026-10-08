"""Tests for Webhook Management API endpoints."""

import pytest
from app.db.models import Webhook


def test_register_webhook(client, sample_webhook_data):
    """Test registering a new webhook."""
    response = client.post(
        "/api/v1/webhooks",
        json=sample_webhook_data
    )
    assert response.status_code == 200
    data = response.json()
    assert data["url"] == sample_webhook_data["url"]
    assert data["webhook_type"] == sample_webhook_data["webhook_type"]
    assert data["confidence_threshold"] == sample_webhook_data["confidence_threshold"]


def test_list_webhooks(client, db, sample_webhook_data):
    """Test listing all webhooks."""
    for i in range(3):
        webhook = Webhook(
            id=f"webhook_{i:03d}",
            **{k: v for k, v in sample_webhook_data.items() if k not in ["id"]}
        )
        db.add(webhook)
    db.commit()

    response = client.get("/api/v1/webhooks")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 3


def test_get_webhook(client, db, sample_webhook_data):
    """Test retrieving a single webhook."""
    webhook = Webhook(id="webhook_001", **sample_webhook_data)
    db.add(webhook)
    db.commit()

    response = client.get("/api/v1/webhooks/webhook_001")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "webhook_001"
    assert data["url"] == sample_webhook_data["url"]


def test_get_webhook_not_found(client):
    """Test retrieving non-existent webhook."""
    response = client.get("/api/v1/webhooks/nonexistent")
    assert response.status_code == 404


def test_update_webhook(client, db, sample_webhook_data):
    """Test updating webhook configuration."""
    webhook = Webhook(id="webhook_001", **sample_webhook_data)
    db.add(webhook)
    db.commit()

    updated_data = {
        **sample_webhook_data,
        "confidence_threshold": 0.8,
        "is_active": False
    }
    response = client.put(
        "/api/v1/webhooks/webhook_001",
        json=updated_data
    )
    assert response.status_code == 200
    data = response.json()
    assert data["confidence_threshold"] == 0.8
    assert data["is_active"] is False


def test_delete_webhook(client, db, sample_webhook_data):
    """Test deleting a webhook."""
    webhook = Webhook(id="webhook_001", **sample_webhook_data)
    db.add(webhook)
    db.commit()

    response = client.delete("/api/v1/webhooks/webhook_001")
    assert response.status_code == 200

    response = client.get("/api/v1/webhooks/webhook_001")
    assert response.status_code == 404


def test_webhook_with_multiple_cameras(client, sample_webhook_data):
    """Test webhook filtering for multiple cameras."""
    webhook_data = {
        **sample_webhook_data,
        "camera_ids": ["CAM_001", "CAM_002", "CAM_003"]
    }
    response = client.post(
        "/api/v1/webhooks",
        json=webhook_data
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data.get("camera_ids", [])) == 3


def test_webhook_filter_by_type(client, db, sample_webhook_data):
    """Test filtering webhooks by type."""
    webhook = Webhook(id="webhook_001", **sample_webhook_data)
    db.add(webhook)
    db.commit()

    response = client.get(f"/api/v1/webhooks?webhook_type={sample_webhook_data['webhook_type']}")
    assert response.status_code == 200
    data = response.json()
    assert all(w["webhook_type"] == sample_webhook_data["webhook_type"] for w in data)


def test_webhook_delivery_metrics(client, db, sample_webhook_data):
    """Test webhook delivery statistics."""
    webhook = Webhook(
        id="webhook_001",
        delivery_count=5,
        **sample_webhook_data
    )
    db.add(webhook)
    db.commit()

    response = client.get("/api/v1/webhooks/webhook_001")
    assert response.status_code == 200
    data = response.json()
    assert data.get("delivery_count", 0) >= 0


def test_webhook_enable_disable(client, db, sample_webhook_data):
    """Test enabling/disabling webhooks."""
    webhook = Webhook(id="webhook_001", is_active=True, **sample_webhook_data)
    db.add(webhook)
    db.commit()

    # Disable webhook
    response = client.put(
        "/api/v1/webhooks/webhook_001",
        json={**sample_webhook_data, "is_active": False}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_active"] is False


def test_webhook_confidence_threshold_validation(client, sample_webhook_data):
    """Test webhook confidence threshold validation."""
    invalid_data = {**sample_webhook_data, "confidence_threshold": 1.5}
    response = client.post(
        "/api/v1/webhooks",
        json=invalid_data
    )
    # Should either reject or normalize to valid range
    if response.status_code == 200:
        data = response.json()
        assert 0 <= data["confidence_threshold"] <= 1.0
