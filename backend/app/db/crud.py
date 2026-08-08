import json
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.db.models import SystemJob

def create_system_job(db: Session, name: str, job_type: str, status: str = "pending", payload: dict = None) -> SystemJob:
    job_id = str(uuid.uuid4())
    job = SystemJob(
        id=job_id,
        name=name,
        job_type=job_type,
        status=status,
        progress=0.0,
        payload=json.dumps(payload or {})
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job

def update_system_job_progress(db: Session, job_id: str, progress: float, status: str = None) -> SystemJob:
    job = db.query(SystemJob).filter(SystemJob.id == job_id).first()
    if job:
        job.progress = float(progress)
        if status:
            job.status = status
        job.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(job)
    return job

def complete_system_job(db: Session, job_id: str, status: str = "completed") -> SystemJob:
    job = db.query(SystemJob).filter(SystemJob.id == job_id).first()
    if job:
        job.progress = 100.0
        job.status = status
        job.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(job)
    return job

def get_active_system_jobs(db: Session):
    return db.query(SystemJob).filter(SystemJob.status.in_(["pending", "running"])).order_by(SystemJob.created_at.asc()).all()

def get_all_system_jobs(db: Session, limit: int = 50):
    return db.query(SystemJob).order_by(SystemJob.created_at.desc()).limit(limit).all()

def delete_all_completed_jobs(db: Session):
    db.query(SystemJob).filter(SystemJob.status.in_(["completed", "failed"])).delete(synchronize_session=False)
    db.commit()
