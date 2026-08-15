"""Tests for Fine-Tuning API endpoints."""

import pytest


def test_finetuning_model_info(client):
    """Test getting fine-tuning model info."""
    response = client.get("/api/v1/finetuning/info")
    assert response.status_code == 200
    data = response.json()
    assert "base_model" in data or "model_name" in data


def test_start_finetuning_job(client):
    """Test starting a fine-tuning job."""
    request_data = {
        "camera_id": "CAM_001",
        "learning_rate": 0.00002,
        "num_epochs": 3,
        "batch_size": 2,
        "days": 30
    }
    response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    assert response.status_code in [200, 202, 400]  # 400 if no training data
    if response.status_code == 200:
        data = response.json()
        assert "training_id" in data
        assert "status" in data


def test_start_finetuning_all_cameras(client):
    """Test starting fine-tuning on all cameras."""
    request_data = {
        "camera_id": None,  # All cameras
        "learning_rate": 0.00002,
        "num_epochs": 3,
        "batch_size": 2,
        "days": 30
    }
    response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    assert response.status_code in [200, 202, 400]


def test_get_finetuning_status(client):
    """Test getting fine-tuning job status."""
    # First start a job
    request_data = {
        "learning_rate": 0.00002,
        "num_epochs": 1,
        "batch_size": 2,
        "days": 1
    }
    start_response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    if start_response.status_code == 200:
        job_id = start_response.json()["training_id"]
        # Get status
        status_response = client.get(f"/api/v1/finetuning/status/{job_id}")
        assert status_response.status_code == 200
        data = status_response.json()
        assert "status" in data
        assert data["status"] in ["pending", "running", "completed", "failed"]


def test_get_finetuning_history(client):
    """Test getting fine-tuning job history."""
    response = client.get("/api/v1/finetuning/history")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_finetuning_parameter_validation(client):
    """Test fine-tuning parameter validation."""
    # Invalid: learning_rate too high
    request_data = {
        "learning_rate": 1.0,  # Should be much lower
        "num_epochs": 3,
        "batch_size": 2,
        "days": 30
    }
    response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    # Should reject or normalize
    if response.status_code == 200:
        data = response.json()
        assert data["learning_rate"] < 0.1


def test_finetuning_epochs_range(client):
    """Test fine-tuning epochs within valid range."""
    request_data = {
        "learning_rate": 0.00002,
        "num_epochs": 10,
        "batch_size": 2,
        "days": 30
    }
    response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    if response.status_code == 200:
        data = response.json()
        assert 1 <= data.get("num_epochs", 10) <= 100


def test_finetuning_batch_size_range(client):
    """Test fine-tuning batch size within valid range."""
    request_data = {
        "learning_rate": 0.00002,
        "num_epochs": 3,
        "batch_size": 16,
        "days": 30
    }
    response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    if response.status_code == 200:
        data = response.json()
        assert 1 <= data.get("batch_size", 16) <= 128


def test_finetuning_historical_data_range(client):
    """Test fine-tuning historical data range."""
    request_data = {
        "learning_rate": 0.00002,
        "num_epochs": 3,
        "batch_size": 2,
        "days": 60  # 60 days of history
    }
    response = client.post(
        "/api/v1/finetuning/start",
        json=request_data
    )
    if response.status_code == 200:
        data = response.json()
        assert 1 <= data.get("days", 60) <= 365


def test_finetuning_job_not_found(client):
    """Test getting status of non-existent job."""
    response = client.get("/api/v1/finetuning/status/nonexistent_job")
    assert response.status_code == 404


def test_finetuning_concurrent_jobs(client):
    """Test starting multiple fine-tuning jobs."""
    request_data = {
        "learning_rate": 0.00002,
        "num_epochs": 1,
        "batch_size": 2,
        "days": 1
    }
    # Start first job
    response1 = client.post("/api/v1/finetuning/start", json=request_data)
    # Start second job
    response2 = client.post("/api/v1/finetuning/start", json=request_data)

    if response1.status_code == 200 and response2.status_code == 200:
        id1 = response1.json()["training_id"]
        id2 = response2.json()["training_id"]
        assert id1 != id2  # Different job IDs
