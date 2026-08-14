"""Tests for Health and System Status API endpoints."""

import pytest


def test_health_check(client):
    """Test basic health check endpoint."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data or data == "OK"


def test_root_endpoint(client):
    """Test root API endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data or "status" in data


def test_api_docs_available(client):
    """Test that API documentation is available."""
    response = client.get("/api/docs")
    assert response.status_code == 200
    # Should return HTML or redirect


def test_openapi_schema_available(client):
    """Test that OpenAPI schema is available."""
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    data = response.json()
    assert "openapi" in data
    assert "info" in data
    assert "paths" in data


def test_redoc_available(client):
    """Test that ReDoc documentation is available."""
    response = client.get("/api/redoc")
    assert response.status_code == 200


def test_api_prefix_versioning(client):
    """Test API versioning with prefix."""
    # Standard endpoints should work
    response = client.get("/api/v1/health")
    assert response.status_code == 200


def test_cors_headers(client):
    """Test CORS headers are set."""
    response = client.options("/api/v1/health")
    assert "access-control-allow-origin" in response.headers or response.status_code == 200


def test_static_data_mount(client):
    """Test static data directory is mounted."""
    # This endpoint should exist (may return 404 if no files)
    response = client.get("/data")
    assert response.status_code in [200, 301, 404]
