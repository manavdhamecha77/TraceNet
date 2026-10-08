"""Tests for Crime Report Generation API endpoints."""

import pytest
from datetime import datetime
from app.db.models import Camera, CrimeReport


@pytest.fixture
def test_camera(db, sample_camera_data):
    """Setup a camera for report tests."""
    camera = Camera(**sample_camera_data)
    db.add(camera)
    db.commit()
    return camera


def test_generate_report(client, test_camera):
    """Test generating a new crime report."""
    request_data = {
        "report_type": "theft",
        "camera_id": test_camera.camera_id,
        "title": "Retail Store Theft Incident",
        "description": "Suspected shoplifting at retail location",
        "location": "Electronics Department",
        "severity": "high",
        "notes": "Suspect left store without paying"
    }

    response = client.post(
        "/api/v1/reports/generate",
        json=request_data
    )

    assert response.status_code == 200
    data = response.json()
    assert data["report_type"] == "theft"
    assert data["title"] == "Retail Store Theft Incident"
    assert data["severity"] == "high"
    assert data["status"] == "pending"


def test_generate_assault_report(client, test_camera):
    """Test generating an assault report."""
    request_data = {
        "report_type": "assault",
        "camera_id": test_camera.camera_id,
        "title": "Physical Assault Incident",
        "description": "Two individuals engaged in physical altercation",
        "location": "Main Street Intersection",
        "severity": "critical"
    }

    response = client.post(
        "/api/v1/reports/generate",
        json=request_data
    )

    assert response.status_code == 200
    data = response.json()
    assert data["report_type"] == "assault"
    assert data["severity"] == "critical"


def test_generate_abandoned_object_report(client, test_camera):
    """Test generating an abandoned object report."""
    request_data = {
        "report_type": "abandoned_object",
        "camera_id": test_camera.camera_id,
        "title": "Suspicious Unattended Package",
        "description": "Unattended backpack found in parking area",
        "severity": "high",
        "notes": "Area secured, police notified"
    }

    response = client.post(
        "/api/v1/reports/generate",
        json=request_data
    )

    assert response.status_code == 200
    data = response.json()
    assert data["report_type"] == "abandoned_object"


def test_generate_loitering_report(client, test_camera):
    """Test generating a loitering report."""
    request_data = {
        "report_type": "loitering",
        "camera_id": test_camera.camera_id,
        "title": "Prolonged Loitering Activity",
        "description": "Individual loitering in restricted area",
        "severity": "low",
        "notes": "Approximately 45 minutes duration"
    }

    response = client.post(
        "/api/v1/reports/generate",
        json=request_data
    )

    assert response.status_code == 200
    data = response.json()
    assert data["report_type"] == "loitering"


def test_list_reports(client, db, test_camera):
    """Test listing all reports."""
    # Create a few reports
    for i in range(3):
        report = CrimeReport(
            id=f"report_{i:03d}",
            report_type="theft",
            camera_id=test_camera.camera_id,
            title=f"Theft Report {i}",
            description="Test report",
            incident_timestamp=datetime.utcnow()
        )
        db.add(report)
    db.commit()

    response = client.get("/api/v1/reports")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 3


def test_filter_reports_by_type(client, db, test_camera):
    """Test filtering reports by type."""
    # Create theft reports
    for i in range(2):
        report = CrimeReport(
            id=f"theft_{i}",
            report_type="theft",
            camera_id=test_camera.camera_id,
            title=f"Theft {i}",
            incident_timestamp=datetime.utcnow()
        )
        db.add(report)

    # Create assault reports
    for i in range(2):
        report = CrimeReport(
            id=f"assault_{i}",
            report_type="assault",
            camera_id=test_camera.camera_id,
            title=f"Assault {i}",
            incident_timestamp=datetime.utcnow()
        )
        db.add(report)

    db.commit()

    response = client.get("/api/v1/reports?report_type=theft")
    assert response.status_code == 200
    data = response.json()
    assert all(r["report_type"] == "theft" for r in data["reports"])


def test_filter_reports_by_camera(client, db, test_camera):
    """Test filtering reports by camera."""
    report = CrimeReport(
        id="report_001",
        report_type="theft",
        camera_id=test_camera.camera_id,
        title="Test Report",
        incident_timestamp=datetime.utcnow()
    )
    db.add(report)
    db.commit()

    response = client.get(f"/api/v1/reports?camera_id={test_camera.camera_id}")
    assert response.status_code == 200
    data = response.json()
    assert all(r["camera_id"] == test_camera.camera_id for r in data["reports"])


def test_filter_reports_by_severity(client, db, test_camera):
    """Test filtering reports by severity."""
    # Create high severity report
    high_report = CrimeReport(
        id="high_001",
        report_type="theft",
        camera_id=test_camera.camera_id,
        title="High Severity",
        severity="high",
        incident_timestamp=datetime.utcnow()
    )
    db.add(high_report)

    # Create low severity report
    low_report = CrimeReport(
        id="low_001",
        report_type="loitering",
        camera_id=test_camera.camera_id,
        title="Low Severity",
        severity="low",
        incident_timestamp=datetime.utcnow()
    )
    db.add(low_report)
    db.commit()

    response = client.get("/api/v1/reports?severity=high")
    assert response.status_code == 200
    data = response.json()
    assert all(r["severity"] == "high" for r in data["reports"])


def test_get_report(client, db, test_camera):
    """Test retrieving a specific report."""
    report = CrimeReport(
        id="report_001",
        report_type="theft",
        camera_id=test_camera.camera_id,
        title="Test Report",
        description="Test Description",
        incident_timestamp=datetime.utcnow()
    )
    db.add(report)
    db.commit()

    response = client.get("/api/v1/reports/report_001")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "report_001"
    assert data["title"] == "Test Report"


def test_get_nonexistent_report(client):
    """Test retrieving non-existent report."""
    response = client.get("/api/v1/reports/nonexistent")
    assert response.status_code == 404


def test_update_report(client, db, test_camera):
    """Test updating a report."""
    report = CrimeReport(
        id="report_001",
        report_type="theft",
        camera_id=test_camera.camera_id,
        title="Original Title",
        incident_timestamp=datetime.utcnow()
    )
    db.add(report)
    db.commit()

    update_data = {
        "status": "reviewed",
        "assigned_to": "Officer Smith",
        "notes": "Investigation complete"
    }

    response = client.put(
        "/api/v1/reports/report_001",
        json=update_data
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "reviewed"
    assert data["assigned_to"] == "Officer Smith"


def test_delete_report(client, db, test_camera):
    """Test deleting a report."""
    report = CrimeReport(
        id="report_001",
        report_type="theft",
        camera_id=test_camera.camera_id,
        title="Test Report",
        incident_timestamp=datetime.utcnow()
    )
    db.add(report)
    db.commit()

    response = client.delete("/api/v1/reports/report_001")
    assert response.status_code == 200

    # Verify it's deleted
    response = client.get("/api/v1/reports/report_001")
    assert response.status_code == 404


def test_get_report_statistics(client, db, test_camera):
    """Test getting report statistics."""
    # Create various reports
    for report_type in ["theft", "assault", "abandoned_object"]:
        for severity in ["low", "high"]:
            report = CrimeReport(
                id=f"{report_type}_{severity}",
                report_type=report_type,
                camera_id=test_camera.camera_id,
                title=f"{report_type} - {severity}",
                severity=severity,
                incident_timestamp=datetime.utcnow()
            )
            db.add(report)
    db.commit()

    response = client.get("/api/v1/reports/statistics/summary?days=7")
    assert response.status_code == 200
    data = response.json()
    assert "total_reports" in data
    assert "by_type" in data
    assert "by_severity" in data
    assert data["by_type"]["theft"] >= 2


def test_report_pagination(client, db, test_camera):
    """Test report pagination."""
    # Create 15 reports
    for i in range(15):
        report = CrimeReport(
            id=f"report_{i:03d}",
            report_type="theft",
            camera_id=test_camera.camera_id,
            title=f"Report {i}",
            incident_timestamp=datetime.utcnow()
        )
        db.add(report)
    db.commit()

    # Get first page (limit 10)
    response = client.get("/api/v1/reports?limit=10&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert len(data["reports"]) == 10

    # Get second page
    response = client.get("/api/v1/reports?limit=10&offset=10")
    assert response.status_code == 200
    data = response.json()
    assert len(data["reports"]) >= 5
