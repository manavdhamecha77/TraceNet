"""Tests for Alert Management API endpoints."""

import pytest
from datetime import datetime
from sqlalchemy.orm import Session
from app.db.models import Alert, Camera


@pytest.fixture
def setup_camera(db, sample_camera_data):
    """Setup a camera for alert tests."""
    camera = Camera(**sample_camera_data)
    db.add(camera)
    db.commit()
    return camera


def test_create_alert(client, db, setup_camera, sample_alert_data):
    """Test creating an alert."""
    response = client.post(
        "/api/v1/alerts",
        json=sample_alert_data
    )
    assert response.status_code == 200
    data = response.json()
    assert data["alert_type"] == sample_alert_data["alert_type"]
    assert data["camera_id"] == sample_alert_data["camera_id"]


def test_get_alert(client, db, setup_camera, sample_alert_data):
    """Test retrieving a single alert."""
    alert = Alert(**sample_alert_data)
    db.add(alert)
    db.commit()

    response = client.get(f"/api/v1/alerts/{alert.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == alert.id


def test_list_alerts(client, db, setup_camera, sample_alert_data):
    """Test listing all alerts."""
    for i in range(3):
        alert = Alert(**{**sample_alert_data, "tracklet_id": f"tracklet_{i:03d}"})
        db.add(alert)
    db.commit()

    response = client.get("/api/v1/alerts")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 3


def test_acknowledge_alert(client, db, setup_camera, sample_alert_data):
    """Test acknowledging an alert."""
    alert = Alert(**sample_alert_data)
    db.add(alert)
    db.commit()

    response = client.put(
        f"/api/v1/alerts/{alert.id}/acknowledge",
        json={"acknowledged_by": "test_user"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["acknowledged"] is True


def test_filter_alerts_by_camera(client, db, setup_camera, sample_alert_data):
    """Test filtering alerts by camera."""
    alert = Alert(**sample_alert_data)
    db.add(alert)
    db.commit()

    response = client.get(f"/api/v1/alerts?camera_id={sample_alert_data['camera_id']}")
    assert response.status_code == 200
    data = response.json()
    assert all(alert["camera_id"] == sample_alert_data["camera_id"] for alert in data)


def test_filter_alerts_by_type(client, db, setup_camera, sample_alert_data):
    """Test filtering alerts by type."""
    alert = Alert(**sample_alert_data)
    db.add(alert)
    db.commit()

    response = client.get(f"/api/v1/alerts?alert_type={sample_alert_data['alert_type']}")
    assert response.status_code == 200
    data = response.json()
    assert all(alert["alert_type"] == sample_alert_data["alert_type"] for alert in data)


def test_filter_acknowledged_alerts(client, db, setup_camera, sample_alert_data):
    """Test filtering acknowledged vs unacknowledged alerts."""
    # Create unacknowledged alert
    unack_alert = Alert(**sample_alert_data)
    db.add(unack_alert)

    # Create acknowledged alert
    ack_alert = Alert(**{**sample_alert_data, "tracklet_id": "tracklet_ack", "acknowledged": True})
    db.add(ack_alert)
    db.commit()

    response = client.get("/api/v1/alerts?acknowledged=true")
    assert response.status_code == 200
    data = response.json()
    assert all(alert["acknowledged"] for alert in data)


def test_delete_alert(client, db, setup_camera, sample_alert_data):
    """Test deleting an alert."""
    alert = Alert(**sample_alert_data)
    db.add(alert)
    db.commit()
    alert_id = alert.id

    response = client.delete(f"/api/v1/alerts/{alert_id}")
    assert response.status_code == 200

    response = client.get(f"/api/v1/alerts/{alert_id}")
    assert response.status_code == 404


def test_alert_with_video_id(client, db, setup_camera, sample_alert_data):
    """Test alert with video_id field."""
    alert_data = {**sample_alert_data, "video_id": "video_001"}
    alert = Alert(**alert_data)
    db.add(alert)
    db.commit()

    response = client.get(f"/api/v1/alerts/{alert.id}")
    assert response.status_code == 200
    data = response.json()
    assert data.get("video_id") == "video_001"


def test_alert_pagination(client, db, setup_camera, sample_alert_data):
    """Test alert pagination."""
    for i in range(25):
        alert = Alert(**{**sample_alert_data, "tracklet_id": f"tracklet_{i:03d}"})
        db.add(alert)
    db.commit()

    response = client.get("/api/v1/alerts?limit=10&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 10
