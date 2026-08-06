"""
Video Processing Pipeline API endpoints.
Manage real-time video processing jobs and track progress.
"""

from fastapi import APIRouter, HTTPException, status, BackgroundTasks
from pydantic import BaseModel
from typing import Dict, Optional
from loguru import logger

from app.processing import get_video_processor

router = APIRouter(prefix="/api/v1", tags=["processing"])


class VideoProcessingRequest(BaseModel):
    video_id: str
    camera_id: str
    video_path: str
    priority: int = 0


class ProcessingJobResponse(BaseModel):
    video_id: str
    status: str
    progress: float
    result: Optional[Dict] = None
    error: Optional[str] = None
    created_at: str


class ProcessingQueueResponse(BaseModel):
    total_jobs: int
    pending: int
    processing: int
    completed: int
    failed: int
    jobs: Dict[str, Dict]


@router.post("/processing/add-video")
def add_video_to_processing(
    request: VideoProcessingRequest,
    background_tasks: BackgroundTasks
) -> Dict[str, str]:
    """
    Add a video to the processing queue.

    Returns:
        Status message and job ID
    """
    processor = get_video_processor()

    # Add to queue
    success = processor.add_video(
        video_id=request.video_id,
        camera_id=request.camera_id,
        video_path=request.video_path,
        priority=request.priority
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Video {request.video_id} already in processing"
        )

    # Process in background
    background_tasks.add_task(processor.process_video, request.video_id)

    return {
        "status": "queued",
        "video_id": request.video_id,
        "message": f"Video {request.video_id} added to processing queue"
    }


@router.get("/processing/job/{video_id}")
def get_job_status(video_id: str) -> ProcessingJobResponse:
    """Get status of a processing job."""
    processor = get_video_processor()
    job = processor.get_job_status(video_id)

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {video_id} not found"
        )

    return ProcessingJobResponse(**job)


@router.get("/processing/queue")
def get_processing_queue() -> ProcessingQueueResponse:
    """Get current processing queue status."""
    processor = get_video_processor()
    all_jobs = processor.get_all_jobs()

    # Count by status
    status_counts = {
        "pending": 0,
        "processing": 0,
        "completed": 0,
        "failed": 0
    }

    for job in all_jobs.values():
        status = job["status"]
        if status in status_counts:
            status_counts[status] += 1

    return ProcessingQueueResponse(
        total_jobs=len(all_jobs),
        pending=status_counts["pending"],
        processing=status_counts["processing"],
        completed=status_counts["completed"],
        failed=status_counts["failed"],
        jobs=all_jobs
    )


@router.post("/processing/clear-completed")
def clear_completed_jobs():
    """Clear completed jobs from memory."""
    processor = get_video_processor()
    processor.clear_completed()

    return {"status": "cleared", "message": "Completed jobs cleared from queue"}


@router.post("/processing/process-now/{video_id}")
def process_video_now(video_id: str):
    """Process a video immediately."""
    processor = get_video_processor()
    job = processor.get_job_status(video_id)

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video {video_id} not in queue"
        )

    try:
        result = processor.process_video(video_id)
        return {
            "status": "processed",
            "video_id": video_id,
            "result": result
        }
    except Exception as e:
        logger.error(f"Error processing video: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
