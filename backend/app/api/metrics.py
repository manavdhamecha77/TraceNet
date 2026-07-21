from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.db.models import CameraProfile, VideoAsset

router = APIRouter(prefix="/api/v1", tags=["metrics"])


class DashboardMetrics(BaseModel):
    total_cameras: int
    total_videos: int
    processed_videos: int
    pending_videos: int
    processing_videos: int
    failed_videos: int


@router.get("/metrics/dashboard", response_model=DashboardMetrics)
def get_dashboard_metrics(db: Session = Depends(get_db)):
    """
    Retrieves aggregated dashboard metrics across all cameras and videos.

    Returns counts of:
    - Total registered cameras
    - Total video assets
    - Videos completed (processing_status='complete')
    - Videos pending (processing_status='pending')
    - Videos processing (processing_status='preprocessing'|'transcoding'|'indexing')
    - Videos failed (processing_status='failed')

    Status codes:
    - 200 OK: Success.
    """
    total_cameras = db.query(CameraProfile).count()
    total_videos = db.query(VideoAsset).count()

    videos = db.query(VideoAsset).all()

    processed = sum(1 for v in videos if v.processing_status == "complete")
    pending = sum(1 for v in videos if v.processing_status == "pending")
    processing = sum(1 for v in videos if v.processing_status in ["preprocessed", "transcoding", "indexing"])
    failed = sum(1 for v in videos if v.processing_status == "failed")

    return DashboardMetrics(
        total_cameras=total_cameras,
        total_videos=total_videos,
        processed_videos=processed,
        pending_videos=pending,
        processing_videos=processing,
        failed_videos=failed,
    )
