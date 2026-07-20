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
from app.db.models import CameraProfile, VideoAsset, MLModel, ModelExecutionLog
from app.detection.detector import DetectionService
from app.embeddings.tracklet_embeddings import TrackletEmbeddingService
from app.preprocess.storage import MockStorageProvider
from app.preprocess.preprocessor import VideoPreprocessor

from app.config import get_data_path

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
        # 1. Update status to 'transcoding'
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "transcoding"
            video.progress_percentage = 15
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

        # 3. Run transcoding and indexing (FFmpeg + sampling)
        pipeline_results = VideoPreprocessor.run_pipeline(
            raw_video_path=raw_filepath,
            camera_id=camera_id,
            camera_name=camera_name,
            original_filename=original_filename,
            asset_id=asset_id,
            intake_sha256=intake_sha256,
            start_time=start_time
        )

        # Update status to 'preprocessed' (View button is enabled on frontend now)
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.standardized_filename = pipeline_results["standardized_filename"]
            video.transcoded_sha256 = pipeline_results["transcoded_sha256"]
            video.duration = pipeline_results["duration"]
            video.start_time = pipeline_results["start_time"]
            video.end_time = pipeline_results["end_time"]
            video.thumbnail_path = pipeline_results["thumbnail_path"]
            video.processing_status = "preprocessed"
            video.progress_percentage = 40
            db.commit()
            logger.info(f"Asset {asset_id} transcoding completed. Standardized video viewable.")

        # 4. Run detection + tracking on the standardized video output
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "indexing"
            video.progress_percentage = 60
            db.commit()

        detection_output_dir = get_data_path(os.path.join("processed/detections", asset_id))
        
        # Resolve camera-assigned model path if it exists
        model_path = None
        assigned_model_id = None
        
        camera_record = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
        if camera_record and camera_record.model_id:
            model_record = db.query(MLModel).filter(MLModel.id == camera_record.model_id).first()
            if model_record and os.path.exists(model_record.file_path):
                model_path = model_record.file_path
                assigned_model_id = model_record.id
                logger.info(f"Using assigned model '{model_record.name}' ({model_path}) for camera {camera_id}")
            else:
                logger.warning("Assigned model record or file not found. Falling back to default detector.")

        import time
        start_inference = time.time()
        
        detection_service = DetectionService(model_path=model_path)
        detection_result = detection_service.analyze_video(
            video_path=pipeline_results["standardized_video_path"],
            output_dir=detection_output_dir,
            camera_id=camera_id,
            video_id=asset_id,
        )

        # 5. Embed and Index tracklets
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.progress_percentage = 85
            db.commit()

        embedding_service = TrackletEmbeddingService()
        embedding_result = embedding_service.embed_detection_artifact(
            os.path.join(detection_output_dir, "detections.json")
        )

        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "indexing"
            video.progress_percentage = 90
            db.commit()

        # Run vector indexing (SQLite + Qdrant local persistence)
        from app.search.vector_index import VectorIndexService
        index_service = VectorIndexService()
        index_result = index_service.index_video_tracklets(asset_id, db)

        inference_duration = time.time() - start_inference

        # Log serving execution if custom model was used
        if assigned_model_id:
            try:
                # Count total detections across all frame detections
                total_dets = 0
                for f in detection_result.frame_detections:
                    total_dets += len(f.detections)

                log_entry = ModelExecutionLog(
                    model_id=assigned_model_id,
                    video_id=asset_id,
                    camera_id=camera_id,
                    frames_processed=detection_result.frame_count,
                    inference_duration_seconds=inference_duration,
                    objects_detected_count=total_dets
                )
                db.add(log_entry)

                # Update last used timestamp
                model_rec = db.query(MLModel).filter(MLModel.id == assigned_model_id).first()
                if model_rec:
                    model_rec.last_used_timestamp = datetime.now(timezone.utc)
                db.commit()
            except Exception as log_err:
                logger.warning(f"Failed to log model execution stats: {str(log_err)}")

        # Complete status
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "complete"
            video.progress_percentage = 100
            db.commit()
            logger.info(
                f"Asset {asset_id} ingestion pipeline completed successfully "
                f"with {len(detection_result.tracklets)} tracklets, indexed to Qdrant."
            )
            
    except Exception as e:
        logger.error(f"Ingestion pipeline failed for asset {asset_id}: {str(e)}")
        db.rollback()
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "failed"
            video.progress_percentage = 0
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


@router.get("/videos/{video_id}")
def get_video_detail(video_id: str, db: Session = Depends(get_db)):
    """Retrieve detailed single video asset record with associated camera details and tracklets."""
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' not found."
        )

    camera = video.camera
    tracklets_list = [t.to_dict() for t in video.tracklets] if video.tracklets else []

    # Load detections.json summary if present
    detections_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
    detections_summary = {}
    if os.path.exists(detections_path):
        try:
            with open(detections_path, "r", encoding="utf-8") as f:
                det_data = json.load(f)
                detections_summary = {
                    "frame_count": det_data.get("frame_count", 0),
                    "fps": det_data.get("fps", 0),
                    "total_tracklets": len(det_data.get("tracklets", [])),
                }
        except Exception:
            pass

    return {
        "video": video.to_dict(),
        "camera": camera.to_dict() if camera else None,
        "tracklets": tracklets_list,
        "detections_summary": detections_summary,
    }

