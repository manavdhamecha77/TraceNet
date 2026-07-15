import os
import uuid
import hashlib
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, BackgroundTasks, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db, SessionLocal
from app.db.models import CameraProfile, VideoAsset
from app.preprocess.storage import MockStorageProvider
from app.preprocess.preprocessor import VideoPreprocessor

router = APIRouter(prefix="/api/v1", tags=["upload"])

class IngestResponse(BaseModel):
    asset_id: str
    camera_id: str
    original_filename: str
    intake_sha256: str
    status: str
    message: str

def process_video_background(
    asset_id: str, 
    camera_id: str, 
    camera_name: str, 
    raw_filepath: str, 
    original_filename: str, 
    intake_sha256: str,
    start_time_iso: Optional[str]
):
    """Background task runner for transcoding and frame sampling."""
    logger.info(f"Background processing started for video asset {asset_id}")
    db = SessionLocal()
    try:
        # 1. Update status to 'processing'
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "processing"
            db.commit()
        else:
            logger.error(f"Asset {asset_id} not found in database.")
            return

        # 2. Parse start_time
        start_time = None
        if start_time_iso:
            try:
                start_time = datetime.fromisoformat(start_time_iso)
            except ValueError:
                logger.warning(f"Could not parse start_time '{start_time_iso}', defaulting to now.")

        # 3. Run transcoding and indexing
        # Note: In future message-queue systems (Celery/Redis), this block will be offloaded
        # to a worker task definition instead of a FastAPI background task thread.
        pipeline_results = VideoPreprocessor.run_pipeline(
            raw_video_path=raw_filepath,
            camera_id=camera_id,
            camera_name=camera_name,
            original_filename=original_filename,
            asset_id=asset_id,
            intake_sha256=intake_sha256,
            start_time=start_time
        )
        
        # 4. Commit results to DB
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.standardized_filename = pipeline_results["standardized_filename"]
            video.transcoded_sha256 = pipeline_results["transcoded_sha256"]
            video.duration = pipeline_results["duration"]
            video.start_time = pipeline_results["start_time"]
            video.end_time = pipeline_results["end_time"]
            video.thumbnail_path = pipeline_results["thumbnail_path"]
            video.processing_status = "complete"
            db.commit()
            logger.info(f"Asset {asset_id} ingestion pipeline completed successfully.")
            
    except Exception as e:
        logger.error(f"Ingestion pipeline failed for asset {asset_id}: {str(e)}")
        db.rollback()
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "failed"
            db.commit()
    finally:
        db.close()

@router.post("/ingest", response_model=IngestResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    camera_id: str = Form(...),
    start_time: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """Accepts a video upload, stores it in the mock WORM repository,

    and initiates the transcoding and sampling pipeline asynchronously.
    
    Status codes:
    - 202 Accepted: Ingestion process initiated.
    - 400 Bad Request: Missing file or empty input.
    - 404 Not Found: Camera ID not registered.
    - 409 Conflict: Video asset already exists for this camera (matching intake hash).
    """
    # 1. Validate Camera Profile
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' is not registered. Register the camera profile first."
        )

    # 2. Read File content
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty."
        )

    # 3. Calculate SHA-256 for integrity validation
    sha256_hash = hashlib.sha256(file_bytes).hexdigest()

    # 4. Check for duplicates (WORM / integrity guard)
    duplicate = db.query(VideoAsset).filter(
        VideoAsset.camera_id == camera_id,
        VideoAsset.intake_sha256 == sha256_hash
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Conflict: Video file with hash '{sha256_hash}' already uploaded for camera '{camera_id}'."
        )

    # 5. Generate Asset ID and standard output details
    asset_id = str(uuid.uuid4())
    original_filename = file.filename or "uploaded_video.mp4"
    
    # 6. Save in mock WORM storage
    storage = MockStorageProvider()
    object_name = f"{asset_id}_{original_filename}"
    try:
        raw_filepath = storage.upload_file(file_bytes, object_name)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to store file in object repository: {str(e)}"
        )

    # 7. Create preliminary VideoAsset in Database
    try:
        video_asset = VideoAsset(
            id=asset_id,
            camera_id=camera_id,
            original_filename=original_filename,
            standardized_filename="pending_transcode.mp4",
            intake_sha256=sha256_hash,
            processing_status="pending"
        )
        db.add(video_asset)
        db.commit()
        db.refresh(video_asset)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save video metadata: {str(e)}"
        )

    # 8. Dispatch Background processing pipeline
    background_tasks.add_task(
        process_video_background,
        asset_id=asset_id,
        camera_id=camera_id,
        camera_name=camera.name,
        raw_filepath=raw_filepath,
        original_filename=original_filename,
        intake_sha256=sha256_hash,
        start_time_iso=start_time
    )

    return IngestResponse(
        asset_id=asset_id,
        camera_id=camera_id,
        original_filename=original_filename,
        intake_sha256=sha256_hash,
        status="pending",
        message="Upload accepted. Video transcoding and analysis started in the background."
    )
