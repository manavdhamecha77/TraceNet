from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta

from app.db.session import get_db
from app.db.models import Alert

router = APIRouter(prefix="/api/v1", tags=["alerts"])


class AlertCreate(BaseModel):
    alert_type: str
    severity: str
    camera_id: str
    tracklet_id: Optional[str] = None
    description: str
    metadata: Optional[dict] = None


class AlertResponse(BaseModel):
    id: int
    alert_type: str
    severity: str
    camera_id: str
    tracklet_id: Optional[str]
    description: str
    status: str
    created_at: Optional[str]
    resolved_at: Optional[str]

    class Config:
        from_attributes = True


@router.get("/alerts", response_model=List[AlertResponse])
def list_alerts(
    camera_id: Optional[str] = None,
    alert_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Lists alerts with optional filters.

    Status codes:
    - 200 OK: Success.
    """
    query = db.query(Alert)

    if camera_id:
        query = query.filter(Alert.camera_id == camera_id)
    if alert_type:
        query = query.filter(Alert.alert_type == alert_type)
    if status:
        query = query.filter(Alert.status == status)

    alerts = query.order_by(Alert.created_at.desc()).limit(limit).all()
    return [a.to_dict() for a in alerts]


@router.post("/alerts", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(payload: AlertCreate, db: Session = Depends(get_db)):
    """Creates a new alert (loitering, abandoned object, etc.).

    Status codes:
    - 201 Created: Alert successfully created.
    - 400 Bad Request: Invalid input.
    """
    try:
        alert = Alert(
            alert_type=payload.alert_type,
            severity=payload.severity,
            camera_id=payload.camera_id,
            tracklet_id=payload.tracklet_id,
            description=payload.description,
            status="active",
            metadata=payload.metadata,
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create alert: {str(e)}",
        )


@router.put("/alerts/{alert_id}", response_model=AlertResponse)
def resolve_alert(alert_id: int, status_update: str, db: Session = Depends(get_db)):
    """Resolves an alert by ID.

    Status codes:
    - 200 OK: Alert resolved.
    - 404 Not Found: Alert not found.
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID {alert_id} not found.",
        )

    try:
        alert.status = status_update
        if status_update == "resolved":
            alert.resolved_at = datetime.utcnow()
        db.commit()
        db.refresh(alert)
        return alert.to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to update alert: {str(e)}",
        )


@router.get("/alerts/summary", response_model=dict)
def get_alerts_summary(db: Session = Depends(get_db)):
    """Gets summary statistics of active alerts.

    Status codes:
    - 200 OK: Success.
    """
    total_alerts = db.query(Alert).count()
    active_alerts = db.query(Alert).filter(Alert.status == "active").count()
    high_severity = db.query(Alert).filter(
        Alert.severity == "high", Alert.status == "active"
    ).count()

    alert_types = {}
    for row in db.query(Alert.alert_type).distinct():
        count = db.query(Alert).filter(Alert.alert_type == row[0]).count()
        alert_types[row[0]] = count

    return {
        "total_alerts": total_alerts,
        "active_alerts": active_alerts,
        "high_severity_active": high_severity,
        "by_type": alert_types,
    }
