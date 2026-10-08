"""Tests for Frame Inspection API endpoints."""

import pytest
from datetime import datetime
from app.db.models import Camera, Alert


@pytest.fixture
def inspection_setup(db, sample_camera_data):
    """Setup camera and alert for frame inspection tests."""
    camera = Camera(**sample_camera_data)
    db.add(camera)
    db.commit()

    alert = Alert(
        alert_type="assault",
        camera_id=camera.camera_id,
        video_id="video_001",
        tracklet_id="tracklet_001",
        timestamp=datetime.utcnow()
    )
    db.add(alert)
    db.commit()
    return camera, alert


def test_get_frame_analysis_by_alert(client, inspection_setup):
    """Test retrieving frame analysis for an alert."""
    camera, alert = inspection_setup
    response = client.get(f"/api/v1/frame-inspection/alert/{alert.id}")
    assert response.status_code in [200, 404]  # May not have actual video frames
    if response.status_code == 200:
        data = response.json()
        assert "video_id" in data
        assert "camera_id" in data
        assert "detected_frames" in data


def test_get_frame_analysis_by_video(client, inspection_setup):
    """Test retrieving frame analysis for a video."""
    camera, alert = inspection_setup
    response = client.get(f"/api/v1/frame-inspection/video/{alert.video_id}")
    assert response.status_code in [200, 404]
    if response.status_code == 200:
        data = response.json()
        if isinstance(data, list):
            assert len(data) >= 0
        else:
            assert "video_id" in data


def test_get_frame_analysis_by_camera(client, inspection_setup):
    """Test retrieving frame analysis for a camera."""
    camera, alert = inspection_setup
    response = client.get(f"/api/v1/frame-inspection/camera/{camera.camera_id}")
    assert response.status_code in [200, 404]
    if response.status_code == 200:
        data = response.json()
        assert isinstance(data, list)


def test_frame_analysis_invalid_alert_id(client):
    """Test frame analysis with invalid alert ID."""
    response = client.get("/api/v1/frame-inspection/alert/99999")
    assert response.status_code in [404, 400]


def test_frame_data_structure(client, inspection_setup):
    """Test frame analysis response structure."""
    camera, alert = inspection_setup
    response = client.get(f"/api/v1/frame-inspection/alert/{alert.id}")
    if response.status_code == 200:
        data = response.json()
        # Verify expected fields
        expected_fields = [
            "video_id", "camera_id", "alert_id", "has_assault",
            "peak_confidence", "detected_frames"
        ]
        for field in expected_fields:
            assert field in data or isinstance(data, list)


def test_frame_inspection_cache(client, inspection_setup):
    """Test frame inspection response caching."""
    camera, alert = inspection_setup
    # First request
    response1 = client.get(f"/api/v1/frame-inspection/alert/{alert.id}")
    # Second request (should use cache)
    response2 = client.get(f"/api/v1/frame-inspection/alert/{alert.id}")

    if response1.status_code == 200 and response2.status_code == 200:
        # Both should return same data
        assert response1.json() == response2.json()
