from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional

from app.db.session import get_db
from app.db.models import SearchLog, Alert
from app.config import get_data_path
import json
import os

router = APIRouter(prefix="/api/v1", tags=["audit"])

# Audit log storage
AUDIT_LOG_DIR = get_data_path("audit_logs")
os.makedirs(AUDIT_LOG_DIR, exist_ok=True)


class AuditLogEntry(BaseModel):
    event_type: str
    user_id: str
    action: str
    resource_type: str
    resource_id: str
    details: dict
    timestamp: Optional[str] = None


def write_audit_log(entry: AuditLogEntry):
    """Write audit log entry to file for compliance."""
    if not entry.timestamp:
        entry.timestamp = datetime.now().isoformat()

    # Create daily audit log file
    date_str = datetime.now().strftime("%Y-%m-%d")
    audit_file = os.path.join(AUDIT_LOG_DIR, f"audit_{date_str}.jsonl")

    with open(audit_file, "a") as f:
        f.write(json.dumps(entry.dict()) + "\n")


@router.get("/audit/search-history")
def get_search_audit_trail(
    limit: int = 100,
    offset: int = 0,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get complete search audit trail with filters."""
    query = db.query(SearchLog).order_by(SearchLog.timestamp.desc())

    if user_id:
        query = query.filter(SearchLog.user_id == user_id)

    total = query.count()
    logs = query.limit(limit).offset(offset).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "audit_trail": [
            {
                "id": log.id,
                "user_id": log.user_id,
                "query": log.query_text,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "results_count": log.results_count,
                "cameras_filtered": log.camera_filter or [],
                "time_range_start": log.time_filter_start.isoformat() if log.time_filter_start else None,
                "time_range_end": log.time_filter_end.isoformat() if log.time_filter_end else None,
            }
            for log in logs
        ]
    }


@router.get("/audit/alert-history")
def get_alert_audit_trail(
    limit: int = 100,
    offset: int = 0,
    camera_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get complete alert audit trail for compliance."""
    query = db.query(Alert).order_by(Alert.timestamp.desc())

    if camera_id:
        query = query.filter(Alert.camera_id == camera_id)

    total = query.count()
    alerts = query.limit(limit).offset(offset).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "audit_trail": [
            {
                "id": alert.id,
                "alert_type": alert.alert_type,
                "camera_id": alert.camera_id,
                "tracklet_id": alert.tracklet_id,
                "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
                "acknowledged": alert.acknowledged,
            }
            for alert in alerts
        ]
    }


@router.post("/audit/log")
def log_audit_event(entry: AuditLogEntry):
    """Log an audit event for compliance tracking."""
    write_audit_log(entry)

    return {
        "status": "logged",
        "timestamp": entry.timestamp or datetime.now().isoformat()
    }


@router.get("/audit/compliance-report")
def get_compliance_report(
    days: int = 30,
    db: Session = Depends(get_db)
):
    """Generate compliance report for the specified period."""
    from datetime import timedelta

    start_date = datetime.now() - timedelta(days=days)

    # Search activity summary
    total_searches = db.query(SearchLog).filter(
        SearchLog.timestamp >= start_date
    ).count()

    unique_users = db.query(func.distinct(SearchLog.user_id)).filter(
        SearchLog.timestamp >= start_date
    ).count()

    # Alert tracking
    total_alerts = db.query(Alert).filter(
        Alert.timestamp >= start_date
    ).count()

    acknowledged_alerts = db.query(Alert).filter(
        Alert.timestamp >= start_date,
        Alert.acknowledged == True
    ).count()

    # Read audit logs from disk
    audit_files = []
    for filename in os.listdir(AUDIT_LOG_DIR):
        if filename.startswith("audit_") and filename.endswith(".jsonl"):
            audit_files.append(filename)

    report = {
        "report_period_days": days,
        "generated_at": datetime.now().isoformat(),
        "search_activity": {
            "total_searches": total_searches,
            "unique_users": unique_users,
            "average_searches_per_user": (
                total_searches / unique_users if unique_users > 0 else 0
            )
        },
        "alert_management": {
            "total_alerts": total_alerts,
            "acknowledged_alerts": acknowledged_alerts,
            "acknowledgment_rate_percent": (
                acknowledged_alerts / total_alerts * 100
                if total_alerts > 0 else 0
            )
        },
        "audit_logs": {
            "log_files_count": len(audit_files),
            "available_logs": sorted(audit_files)
        },
        "compliance_status": "COMPLIANT" if (
            total_alerts == 0 or (
                acknowledged_alerts / total_alerts >= 0.95
            )
        ) else "REVIEW_NEEDED"
    }

    return report


@router.get("/audit/evidence-export")
def get_evidence_export(
    search_id: Optional[int] = None,
    alert_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Export evidence for chain of custody documentation."""
    export_data = {
        "export_timestamp": datetime.now().isoformat(),
        "chain_of_custody": []
    }

    if search_id:
        log = db.query(SearchLog).filter(SearchLog.id == search_id).first()
        if not log:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Search log not found"
            )
        export_data["chain_of_custody"].append({
            "type": "search",
            "id": log.id,
            "user": log.user_id,
            "query": log.query_text,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "results_count": log.results_count
        })

    if alert_id:
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Alert not found"
            )
        export_data["chain_of_custody"].append({
            "type": "alert",
            "id": alert.id,
            "alert_type": alert.alert_type,
            "camera_id": alert.camera_id,
            "timestamp": alert.timestamp.isoformat() if alert.timestamp else None,
            "acknowledged": alert.acknowledged
        })

    # Calculate SHA-256 hash of export for integrity verification
    import hashlib
    export_json = json.dumps(export_data, sort_keys=True)
    export_hash = hashlib.sha256(export_json.encode()).hexdigest()
    export_data["integrity_hash"] = export_hash

    return export_data
