"""Tests for Camera API endpoints."""

import pytest
from sqlalchemy.orm import Session
from app.db.models import Camera


def test_create_camera(client, sample_camera_data):
    """Test camera creation."""
    response = client.post(
        "/api/v1/cameras",
        json=sample_camera_data
    )
    assert response.status_code == 200
    data = response.json()
    assert data["camera_id"] == sample_camera_data["camera_id"]
    assert data["name"] == sample_camera_data["name"]


def test_get_camera(client, db, sample_camera_data):
    """Test retrieving a single camera."""
    # Create camera first
    camera = Camera(**sample_camera_data)
    db.add(camera)
    db.commit()

    response = client.get(f"/api/v1/cameras/{sample_camera_data['camera_id']}")
    assert response.status_code == 200
    data = response.json()
    assert data["camera_id"] == sample_camera_data["camera_id"]


def test_get_camera_not_found(client):
    """Test retrieving non-existent camera."""
    response = client.get("/api/v1/cameras/NONEXISTENT")
    assert response.status_code == 404


def test_list_cameras(client, db, sample_camera_data):
    """Test listing all cameras."""
    # Create multiple cameras
    for i in range(3):
        cam_data = {**sample_camera_data, "camera_id": f"CAM_{i:03d}"}
        camera = Camera(**cam_data)
        db.add(camera)
    db.commit()

    response = client.get("/api/v1/cameras")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 3


def test_update_camera(client, db, sample_camera_data):
    """Test updating camera settings."""
    camera = Camera(**sample_camera_data)
    db.add(camera)
    db.commit()

    update_data = {**sample_camera_data, "name": "Updated Camera Name"}
    response = client.put(
        f"/api/v1/cameras/{sample_camera_data['camera_id']}",
        json=update_data
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Camera Name"


def test_delete_camera(client, db, sample_camera_data):
    """Test camera deletion."""
    camera = Camera(**sample_camera_data)
    db.add(camera)
    db.commit()

    response = client.delete(f"/api/v1/cameras/{sample_camera_data['camera_id']}")
    assert response.status_code == 200

    # Verify it's deleted
    response = client.get(f"/api/v1/cameras/{sample_camera_data['camera_id']}")
    assert response.status_code == 404


def test_camera_status_filter(client, db, sample_camera_data):
    """Test filtering cameras by status."""
    # Create active camera
    active_cam = Camera(**{**sample_camera_data, "camera_id": "CAM_ACTIVE", "status": "active"})
    db.add(active_cam)

    # Create inactive camera
    inactive_cam = Camera(**{**sample_camera_data, "camera_id": "CAM_INACTIVE", "status": "inactive"})
    db.add(inactive_cam)
    db.commit()

    response = client.get("/api/v1/cameras?status=active")
    assert response.status_code == 200
    data = response.json()
    assert all(cam["status"] == "active" for cam in data)


def test_camera_with_model_assignment(client, db, sample_camera_data):
    """Test camera with assigned detection models."""
    cam_data = {
        **sample_camera_data,
        "model_id": "yolo11-general",
        "theft_model_id": "yolo11-theft",
        "assault_model_id": "videomae-assault"
    }
    camera = Camera(**cam_data)
    db.add(camera)
    db.commit()

    response = client.get(f"/api/v1/cameras/{sample_camera_data['camera_id']}")
    assert response.status_code == 200
    data = response.json()
    assert data.get("model_id") == "yolo11-general"
    assert data.get("assault_model_id") == "videomae-assault"
