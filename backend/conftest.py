"""Pytest configuration and shared fixtures for DRISHTI backend tests."""

import os
import pytest
import tempfile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.main import app
from app.db.models import Base
from app.db.session import get_db


@pytest.fixture(scope="session")
def engine():
    """Create an in-memory SQLite database for testing."""
    from sqlalchemy.pool import StaticPool
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(bind=eng)
    return eng


@pytest.fixture(autouse=True)
def clean_tables(engine):
    """Ensure clean database tables for every test."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def db(engine):
    """Get a new database session for each test."""
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()

    yield session

    session.close()


@pytest.fixture
def override_get_db(db):
    """Override FastAPI dependency."""
    def get_db_override():
        yield db

    app.dependency_overrides[get_db] = get_db_override
    yield
    del app.dependency_overrides[get_db]


@pytest.fixture
def client(override_get_db):
    """Create a test client for the FastAPI application."""
    return TestClient(app)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def sample_camera_data():
    """Sample camera data for testing."""
    return {
        "camera_id": "CAM_001",
        "name": "Test Camera 1",
        "corridor_group": "Zone-A",
        "latitude": 0.0,
        "longitude": 0.0,
        "altitude": 10.0,
        "status": "active"
    }


@pytest.fixture
def sample_alert_data():
    """Sample alert data for testing."""
    return {
        "alert_type": "detection",
        "camera_id": "CAM_001",
        "tracklet_id": "tracklet_001",
        "acknowledged": False
    }


@pytest.fixture
def sample_webhook_data():
    """Sample webhook data for testing."""
    return {
        "url": "https://example.com/webhook",
        "webhook_type": "assault",
        "confidence_threshold": 0.7,
        "camera_ids": ["CAM_001"]
    }
