import os
import json
import uuid
import hashlib
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, BackgroundTasks, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db, SessionLocal
from app.db.models import CameraProfile, VideoAsset, LoiteringZone, MLModel, ModelExecutionLog
from app.detection.detector import DetectionService
from app.embeddings.tracklet_embeddings import TrackletEmbeddingService
from app.preprocess.storage import MockStorageProvider
from app.preprocess.preprocessor import VideoPreprocessor

from app.config import get_data_path
from app.alerts.loitering import LoiteringAnalyzer

router = APIRouter(prefix="/api/v1", tags=["upload"])

class IngestResponse(BaseModel):
    asset_id: str
    camera_id: str
    original_filename: str
    intake_sha256: str
    status: str
    message: str
    loitering_zone_id: Optional[str] = None


class PolygonPoint(BaseModel):
    x: float
    y: float


class LoiteringZoneUpdate(BaseModel):
    name: str = "Loitering zone"
    polygon_points: List[PolygonPoint]
    threshold_seconds: float = 60.0
    grace_seconds: float = 3.0

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
        from app.db.crud import create_system_job, update_system_job_progress, complete_system_job
        job = create_system_job(
            db=db,
            name=f"Ingesting Video: {original_filename}",
            job_type="upload",
            status="running",
            payload={"video_id": asset_id, "camera_id": camera_id}
        )
        job_id = job.id

        # 1. Update status to 'transcoding'
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "transcoding"
            video.progress_percentage = 15
            db.commit()
            update_system_job_progress(db, job_id, progress=15.0, status="running")
        else:
            logger.error(f"Asset {asset_id} not found in database.")
            complete_system_job(db, job_id, status="failed")
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
            update_system_job_progress(db, job_id, progress=40.0, status="running")
            logger.info(f"Asset {asset_id} transcoding completed. Standardized video viewable.")

        # 4. Run detection + tracking on the standardized video output
        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "indexing"
            video.progress_percentage = 60
            db.commit()
            update_system_job_progress(db, job_id, progress=60.0, status="running")

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
            update_system_job_progress(db, job_id, progress=85.0, status="running")

        embedding_service = TrackletEmbeddingService()
        embedding_result = embedding_service.embed_detection_artifact(
            os.path.join(detection_output_dir, "detections.json")
        )

        video = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
        if video:
            video.processing_status = "indexing"
            video.progress_percentage = 90
            db.commit()
            update_system_job_progress(db, job_id, progress=90.0, status="running")
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
            zone = db.query(LoiteringZone).filter(LoiteringZone.video_id == asset_id, LoiteringZone.enabled == True).first()
            if zone:
                LoiteringAnalyzer().analyze(asset_id, zone, db)
            complete_system_job(db, job_id, status="completed")
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
        if 'job_id' in locals():
            complete_system_job(db, job_id, status="failed")
    finally:
        db.close()

@router.post("/ingest", response_model=IngestResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    camera_id: str = Form(...),
    start_time: Optional[str] = Form(None),
    enable_loitering: bool = Form(False),
    loitering_threshold_seconds: float = Form(60.0),
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
    if enable_loitering and not 5 <= loitering_threshold_seconds <= 86400:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loitering threshold must be between 5 seconds and 24 hours.",
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
        loitering_zone_id = None
        if enable_loitering:
            loitering_zone = LoiteringZone(
                id=str(uuid.uuid4()),
                video_id=asset_id,
                threshold_seconds=loitering_threshold_seconds,
                grace_seconds=3.0,
                enabled=False,
            )
            db.add(loitering_zone)
            loitering_zone_id = loitering_zone.id
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
        message="Upload accepted. Video transcoding and analysis started in the background.",
        loitering_zone_id=loitering_zone_id,
    )


@router.get("/videos/{video_id}/loitering-zone")
def get_loitering_zone(video_id: str, db: Session = Depends(get_db)):
    """Return the zone configuration and standardized preview once preprocessing is ready."""
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video asset not found.")
    zone = db.query(LoiteringZone).filter(LoiteringZone.video_id == video_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Loitering analysis was not enabled for this upload.")
    payload = zone.to_dict()
    payload["preview_ready"] = bool(video.thumbnail_path)
    payload["preview_url"] = f"/data/{video.thumbnail_path.lstrip('/')}" if video.thumbnail_path else None
    payload["video_status"] = video.processing_status
    return payload


@router.put("/videos/{video_id}/loitering-zone")
def save_loitering_zone(
    video_id: str,
    payload: LoiteringZoneUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Save a normalized polygon only after the standardized preview exists."""
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    zone = db.query(LoiteringZone).filter(LoiteringZone.video_id == video_id).first()
    if not video or not zone:
        raise HTTPException(status_code=404, detail="Loitering configuration not found for this video.")
    if not video.thumbnail_path:
        raise HTTPException(status_code=409, detail="The standardized preview is not ready yet. Wait for preprocessing to finish.")
    if len(payload.polygon_points) < 3:
        raise HTTPException(status_code=422, detail="A loitering zone needs at least three polygon points.")
    if not 5 <= payload.threshold_seconds <= 86400:
        raise HTTPException(status_code=422, detail="Loitering threshold must be between 5 seconds and 24 hours.")
    if not 0 <= payload.grace_seconds <= 30:
        raise HTTPException(status_code=422, detail="Tracking grace period must be between 0 and 30 seconds.")
    points = [{"x": point.x, "y": point.y} for point in payload.polygon_points]
    if any(point["x"] < 0 or point["x"] > 1 or point["y"] < 0 or point["y"] > 1 for point in points):
        raise HTTPException(status_code=422, detail="Polygon points must be normalized between 0 and 1.")
    zone.name = payload.name.strip()[:100] or "Loitering zone"
    zone.polygon_points = json.dumps(points)
    zone.threshold_seconds = payload.threshold_seconds
    zone.grace_seconds = payload.grace_seconds
    zone.enabled = True
    db.commit()
    db.refresh(zone)
    response = zone.to_dict()
    if video.processing_status == "complete":
        background_tasks.add_task(_run_loitering_analysis, video_id)
        response["analysis_started"] = True
    else:
        response["analysis_started"] = False
    return response


def _run_loitering_analysis(video_id: str):
    db = SessionLocal()
    try:
        zone = db.query(LoiteringZone).filter(LoiteringZone.video_id == video_id, LoiteringZone.enabled == True).first()
        if zone:
            LoiteringAnalyzer().analyze(video_id, zone, db)
    finally:
        db.close()


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


@router.put("/videos/{video_id}/bin")
def bin_video(video_id: str, db: Session = Depends(get_db)):
    """Moves a video asset to the bin.

    Status codes:
    - 200 OK: Moved to bin successfully.
    - 404 Not Found: Video not found.
    """
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' not found."
        )
    video.is_bin = True
    db.commit()
    return {"status": "success", "message": "Video successfully moved to bin."}


@router.put("/videos/{video_id}/restore")
def restore_video(video_id: str, db: Session = Depends(get_db)):
    """Restores a video asset from the bin.

    Status codes:
    - 200 OK: Restored successfully.
    - 404 Not Found: Video not found.
    """
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' not found."
        )
    video.is_bin = False
    db.commit()
    return {"status": "success", "message": "Video successfully restored."}


@router.delete("/videos/{video_id}/delete")
def delete_video_permanently(video_id: str, db: Session = Depends(get_db)):
    """Permanently deletes a video asset, its tracklets, embeddings in Qdrant, and all associated files.

    Status codes:
    - 200 OK: Deleted successfully.
    - 404 Not Found: Video not found.
    """
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' not found."
        )

    # 1. Delete vector embeddings from Qdrant and tracklets from SQLite
    from app.search.vector_index import VectorIndexService
    try:
        index_service = VectorIndexService()
        index_service.delete_video_tracklets(video_id, db)
    except Exception as qdrant_err:
        logger.warning(f"Error removing points from Qdrant: {qdrant_err}")

    # 2. Delete files from disk
    # (a) Raw upload in minio_mock: data/minio_mock/{video_id}_{original_filename}
    from app.preprocess.storage import MockStorageProvider
    try:
        storage = MockStorageProvider()
        raw_name = f"{video.id}_{video.original_filename}"
        if storage.exists(raw_name):
            raw_path = storage.get_file_path(raw_name)
            if os.path.exists(raw_path):
                os.remove(raw_path)
    except Exception as e:
        logger.warning(f"Failed to delete raw video file: {e}")

    # (b) Transcoded MP4: data/cameras/{camera_id}_{camera_name}/original_assets/{standardized_filename}
    try:
        camera = video.camera
        if camera:
            from app.preprocess.preprocessor import sanitize_filename
            camera_dir_name = f"{camera.camera_id}_{sanitize_filename(camera.name)}"
            camera_dir = get_data_path(os.path.join("cameras", camera_dir_name))
            
            # Standardized video file
            standardized_video_path = os.path.join(camera_dir, "original_assets", video.standardized_filename)
            if os.path.exists(standardized_video_path):
                os.remove(standardized_video_path)
                
            # Inference directory: data/cameras/{camera_id}_{camera_name}/inference/{standardized_video_name_folder}
            std_name, _ = os.path.splitext(video.standardized_filename)
            inference_dir = os.path.join(camera_dir, "inference", std_name)
            if os.path.exists(inference_dir):
                import shutil
                shutil.rmtree(inference_dir)
    except Exception as e:
        logger.warning(f"Failed to delete transcoded MP4 or inference directory: {e}")

    # (c) Processed detections crops: data/processed/detections/{video_id}
    try:
        detections_dir = get_data_path(os.path.join("processed/detections", video_id))
        if os.path.exists(detections_dir):
            import shutil
            shutil.rmtree(detections_dir)
    except Exception as e:
        logger.warning(f"Failed to delete detections folder: {e}")

    # 3. SQLite DB Cascade deletes: VideoAsset deletion
    try:
        db.delete(video)
        db.commit()
    except Exception as db_err:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Database deletion failed: {str(db_err)}"
        )

    return {"status": "success", "message": "Video and all associated tracklets, embeddings, and files permanently deleted."}


@router.get("/videos/{video_id}/stream")
def stream_video(video_id: str, db: Session = Depends(get_db)):
    """Failsafe video stream endpoint for playing video files."""
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video asset not found.")

    target_path = None

    # Strategy 1: Check expected camera directory
    camera = video.camera
    if camera:
        from app.preprocess.preprocessor import sanitize_filename
        camera_dir_name = f"{camera.camera_id}_{sanitize_filename(camera.name)}"
        expected_path = get_data_path(os.path.join("cameras", camera_dir_name, "original_assets", video.standardized_filename))
        if os.path.exists(expected_path):
            target_path = expected_path

    # Strategy 2: Search all subfolders under data/cameras/ for video file
    if not target_path or not os.path.exists(target_path):
        cameras_base = get_data_path("cameras")
        if os.path.exists(cameras_base):
            for root, _, files in os.walk(cameras_base):
                if video.standardized_filename in files:
                    target_path = os.path.join(root, video.standardized_filename)
                    break

    # Strategy 3: Check minio_mock raw upload folder
    if not target_path or not os.path.exists(target_path):
        raw_path = get_data_path(os.path.join("minio_mock", video.original_filename))
        if os.path.exists(raw_path):
            target_path = raw_path

    if not target_path or not os.path.exists(target_path):
        logger.error(f"Video file '{video.standardized_filename}' not found for video {video_id}")
        raise HTTPException(
            status_code=404,
            detail=f"Video file '{video.standardized_filename}' not found on server disk."
        )

    return FileResponse(path=target_path, media_type="video/mp4", filename=video.standardized_filename)


