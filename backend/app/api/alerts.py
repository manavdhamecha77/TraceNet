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
    camera_id: str
    tracklet_id: str


class AlertResponse(BaseModel):
    id: int
    alert_type: str
    camera_id: str
    tracklet_id: str
    timestamp: Optional[str]
    acknowledged: bool

    class Config:
        from_attributes = True


@router.get("/alerts", response_model=List[AlertResponse])
def list_alerts(
    camera_id: Optional[str] = None,
    alert_type: Optional[str] = None,
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

    alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
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
            camera_id=payload.camera_id,
            tracklet_id=payload.tracklet_id,
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


@router.put("/alerts/{alert_id}/acknowledge", response_model=AlertResponse)
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)):
    """Acknowledges an alert by ID.

    Status codes:
    - 200 OK: Alert acknowledged.
    - 404 Not Found: Alert not found.
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID {alert_id} not found.",
        )

    try:
        alert.acknowledged = True
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
    """Gets summary statistics of alerts.

    Status codes:
    - 200 OK: Success.
    """
    total_alerts = db.query(Alert).count()
    unacknowledged = db.query(Alert).filter(Alert.acknowledged == False).count()

    alert_types = {}
    for row in db.query(Alert.alert_type).distinct():
        count = db.query(Alert).filter(Alert.alert_type == row[0]).count()
        alert_types[row[0]] = count

    return {
        "total_alerts": total_alerts,
        "unacknowledged_alerts": unacknowledged,
        "by_type": alert_types,
    }
