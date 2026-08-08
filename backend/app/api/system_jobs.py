from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from app.db.session import get_db
from app.db.crud import get_all_system_jobs, delete_all_completed_jobs

router = APIRouter(prefix="/api/v1", tags=["system-jobs"])

@router.get("/jobs")
def list_system_jobs(limit: int = 50, db: Session = Depends(get_db)):
    """Returns list of active and recently processed background jobs."""
    jobs = get_all_system_jobs(db, limit=limit)
    return [j.to_dict() for j in jobs]

@router.post("/jobs/clear")
def clear_completed_jobs(db: Session = Depends(get_db)):
    """Removes all completed and failed jobs from the database logs."""
    delete_all_completed_jobs(db)
    return {"status": "success", "message": "Completed and failed jobs cleared."}
