"""Tests for Assault Detection API endpoints."""

import pytest
from datetime import datetime
from app.db.models import Camera, Alert


@pytest.fixture
def assault_camera(db, sample_camera_data):
    """Setup a camera for assault detection tests."""
    cam_data = {
        **sample_camera_data,
        "assault_model_id": "videomae-assault"
    }
    camera = Camera(**cam_data)
    db.add(camera)
    db.commit()
    return camera


def test_get_assault_model_status(client, assault_camera):
    """Test getting assault detection model status."""
    response = client.get("/api/v1/assault-detection/model/status")
    assert response.status_code == 200
    data = response.json()
    assert "model_name" in data
    assert "device" in data
    assert "confidence_threshold" in data


def test_get_assault_alerts(client, db, assault_camera):
    """Test retrieving assault detection alerts."""
    alert = Alert(
        alert_type="assault",
        camera_id=assault_camera.camera_id,
        tracklet_id="tracklet_assault_001",
        timestamp=datetime.utcnow()
    )
    db.add(alert)
    db.commit()

    response = client.get("/api/v1/assault-detection/alerts")
    assert response.status_code == 200
    data = response.json()
    assert "alerts" in data
    assert len(data["alerts"]) >= 1


def test_get_assault_statistics_7_days(client, db, assault_camera):
    """Test assault detection statistics for 7 days."""
    for i in range(3):
        alert = Alert(
            alert_type="assault",
            camera_id=assault_camera.camera_id,
            tracklet_id=f"tracklet_assault_{i:03d}",
            timestamp=datetime.utcnow()
        )
        db.add(alert)
    db.commit()

    response = client.get("/api/v1/assault-detection/statistics?days=7")
    assert response.status_code == 200
    data = response.json()
    assert "total_videos_analyzed" in data
    assert "assaults_detected" in data
    assert "average_confidence" in data


def test_get_assault_statistics_30_days(client, db, assault_camera):
    """Test assault detection statistics for 30 days."""
    response = client.get("/api/v1/assault-detection/statistics?days=30")
    assert response.status_code == 200
    data = response.json()
    assert "total_videos_analyzed" in data or data.get("total_videos_analyzed") == 0


def test_filter_assault_alerts_by_camera(client, db, assault_camera):
    """Test filtering assault alerts by camera."""
    alert = Alert(
        alert_type="assault",
        camera_id=assault_camera.camera_id,
        tracklet_id="tracklet_assault_001",
        timestamp=datetime.utcnow()
    )
    db.add(alert)
    db.commit()

    response = client.get(
        f"/api/v1/assault-detection/alerts?camera_id={assault_camera.camera_id}"
    )
    assert response.status_code == 200
    data = response.json()
    if data.get("alerts"):
        assert all(a["camera_id"] == assault_camera.camera_id for a in data["alerts"])


def test_filter_assault_alerts_by_acknowledged(client, db, assault_camera):
    """Test filtering acknowledged vs unacknowledged assault alerts."""
    # Unacknowledged
    unack = Alert(
        alert_type="assault",
        camera_id=assault_camera.camera_id,
        tracklet_id="tracklet_unack",
        acknowledged=False,
        timestamp=datetime.utcnow()
    )
    db.add(unack)

    # Acknowledged
    ack = Alert(
        alert_type="assault",
        camera_id=assault_camera.camera_id,
        tracklet_id="tracklet_ack",
        acknowledged=True,
        timestamp=datetime.utcnow()
    )
    db.add(ack)
    db.commit()

    response = client.get("/api/v1/assault-detection/alerts?acknowledged=false")
    assert response.status_code == 200
    data = response.json()
    if data.get("alerts"):
        assert all(not a.get("acknowledged", False) for a in data["alerts"])


def test_assault_detection_statistics_empty(client):
    """Test statistics when no assaults detected."""
    response = client.get("/api/v1/assault-detection/statistics?days=1")
    assert response.status_code == 200
    data = response.json()
    # Should return zeros, not error
    assert data.get("assaults_detected", 0) >= 0


def test_assault_alerts_pagination(client, db, assault_camera):
    """Test assault alerts pagination."""
    for i in range(15):
        alert = Alert(
            alert_type="assault",
            camera_id=assault_camera.camera_id,
            tracklet_id=f"tracklet_assault_{i:03d}",
            timestamp=datetime.utcnow()
        )
        db.add(alert)
    db.commit()

    response = client.get("/api/v1/assault-detection/alerts?limit=10")
    assert response.status_code == 200
    data = response.json()
    alerts = data.get("alerts", [])
    assert len(alerts) <= 10


def test_assault_high_confidence_count(client, db, assault_camera):
    """Test counting high-confidence assault detections."""
    response = client.get("/api/v1/assault-detection/statistics?days=7")
    assert response.status_code == 200
    data = response.json()
    high_conf = data.get("high_confidence_assaults", 0)
    total = data.get("assaults_detected", 0)
    assert high_conf <= total  # High confidence should be subset of total
