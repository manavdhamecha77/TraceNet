import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models import CameraProfile, VideoAsset

router = APIRouter(prefix="/api/v1", tags=["cameras"])

# Schema definitions
class CameraCreate(BaseModel):
    camera_id: str = Field(..., example="CAM_042", min_length=2)
    name: str = Field(..., example="Intersection East", min_length=2)
    latitude: Optional[float] = Field(None, example=23.0225)
    longitude: Optional[float] = Field(None, example=72.5714)
    corridor_group: Optional[str] = Field(None, example="Zone-A")
    adjacency: List[str] = Field(default_factory=list, example=["CAM_041", "CAM_043"])
    status: Optional[str] = Field("active", example="active")
    altitude: Optional[float] = Field(None, example=45.2)
    model_id: Optional[str] = Field(None, example="yolov8-person")

class CameraUpdate(BaseModel):
    name: Optional[str] = Field(None, example="Intersection East", min_length=2)
    latitude: Optional[float] = Field(None, example=23.0225)
    longitude: Optional[float] = Field(None, example=72.5714)
    corridor_group: Optional[str] = Field(None, example="Zone-A")
    adjacency: Optional[List[str]] = Field(None, example=["CAM_041", "CAM_043"])
    status: Optional[str] = Field(None, example="active")
    altitude: Optional[float] = Field(None, example=45.2)
    model_id: Optional[str] = Field(None, example="yolov8-person")
    theft_model_id: Optional[str] = Field(None, example="yolov8-theft")
    abandoned_model_id: Optional[str] = Field(None, example="yolov8-luggage")
    assault_model_id: Optional[str] = Field(None, example="yolov8-fight")
    participate_in_alerts: Optional[bool] = None

class CameraResponse(BaseModel):
    camera_id: str
    name: str
    latitude: Optional[float]
    longitude: Optional[float]
    corridor_group: Optional[str]
    adjacency: List[str]
    is_active: bool
    status: str
    altitude: Optional[float]
    model_id: Optional[str]
    theft_model_id: Optional[str]
    abandoned_model_id: Optional[str]
    assault_model_id: Optional[str]
    participate_in_alerts: Optional[bool]
    video_count: int

    class Config:
        from_attributes = True

class VideoResponse(BaseModel):
    id: str
    camera_id: str
    original_filename: str
    standardized_filename: str
    intake_sha256: str
    transcoded_sha256: Optional[str]
    upload_timestamp: Optional[str]
    processing_status: str
    progress_percentage: Optional[float] = 0.0
    duration: Optional[float]
    start_time: Optional[str]
    end_time: Optional[str]
    thumbnail_path: Optional[str]
    is_bin: Optional[bool] = False

    class Config:
        from_attributes = True

@router.post("/create-new-camera", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
@router.post("/cameras", response_model=CameraResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    """Registers a new camera profile in Project DRISHTI.
    
    Status codes:
    - 201 Created: Camera profile successfully added.
    - 400 Bad Request: Invalid input parameters.
    - 409 Conflict: Camera ID already registered.
    """
    # Check if exists
    existing = db.query(CameraProfile).filter(CameraProfile.camera_id == payload.camera_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Camera with ID '{payload.camera_id}' is already registered."
        )
        
    try:
        camera = CameraProfile(
            camera_id=payload.camera_id,
            name=payload.name,
            latitude=payload.latitude,
            longitude=payload.longitude,
            corridor_group=payload.corridor_group,
            adjacency=json.dumps(payload.adjacency),
            is_active=True,
            status=payload.status or "active",
            altitude=payload.altitude,
            model_id=payload.model_id
        )
        db.add(camera)
        db.commit()
        db.refresh(camera)
        return camera.to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create camera: {str(e)}"
        )

@router.get("/cameras", response_model=List[CameraResponse])
def list_cameras(status: Optional[str] = None, db: Session = Depends(get_db)):
    """Retrieves all registered camera profiles.

    Status codes:
    - 200 OK: Success.
    """
    query = db.query(CameraProfile)
    if status:
        query = query.filter(CameraProfile.status == status)
    cameras = query.all()
    return [c.to_dict() for c in cameras]

@router.get("/videos", response_model=List[VideoResponse])
def list_all_videos(db: Session = Depends(get_db)):
    """Retrieves all video assets across all cameras.

    Status codes:
    - 200 OK: Success.
    """
    videos = db.query(VideoAsset).order_by(VideoAsset.upload_timestamp.desc()).all()
    return [v.to_dict() for v in videos]

@router.get("/cameras/{camera_id}", response_model=CameraResponse)
def get_camera(camera_id: str, db: Session = Depends(get_db)):
    """Retrieves a specific camera profile by ID.
    
    Status codes:
    - 200 OK: Success.
    - 404 Not Found: Camera not found.
    """
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera profile with ID '{camera_id}' does not exist."
        )
    return camera.to_dict()

@router.get("/cameras/{camera_id}/videos", response_model=List[VideoResponse])
def get_camera_videos(camera_id: str, db: Session = Depends(get_db)):
    """Lists all video assets (processed and pending) belonging to a specific camera.
    
    Status codes:
    - 200 OK: Success.
    - 404 Not Found: Camera profile not found.
    """
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera profile with ID '{camera_id}' does not exist."
        )
        
    videos = db.query(VideoAsset).filter(VideoAsset.camera_id == camera_id).order_by(VideoAsset.upload_timestamp.desc()).all()
    return [v.to_dict() for v in videos]

@router.put("/cameras/{camera_id}", response_model=CameraResponse)
def update_camera(camera_id: str, payload: CameraUpdate, db: Session = Depends(get_db)):
    """Edits details for a camera profile. The camera ID remains read-only.
    
    Status codes:
    - 200 OK: Camera profile details successfully updated.
    - 404 Not Found: Camera profile not found.
    """
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera profile with ID '{camera_id}' does not exist."
        )
        
    try:
        if payload.name is not None:
            camera.name = payload.name
        if payload.latitude is not None:
            camera.latitude = payload.latitude
        if payload.longitude is not None:
            camera.longitude = payload.longitude
        if payload.corridor_group is not None:
            camera.corridor_group = payload.corridor_group
        if payload.adjacency is not None:
            camera.adjacency = json.dumps(payload.adjacency)
        if payload.status is not None:
            camera.status = payload.status
        if payload.altitude is not None:
            camera.altitude = payload.altitude
        if payload.model_id is not None:
            camera.model_id = payload.model_id
        if payload.theft_model_id is not None:
            camera.theft_model_id = payload.theft_model_id
        if payload.abandoned_model_id is not None:
            camera.abandoned_model_id = payload.abandoned_model_id
        if payload.assault_model_id is not None:
            camera.assault_model_id = payload.assault_model_id
        if payload.participate_in_alerts is not None:
            camera.participate_in_alerts = payload.participate_in_alerts
        
        db.commit()
        db.refresh(camera)
        return camera.to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to update camera: {str(e)}"
        )

@router.delete("/cameras/{camera_id}", status_code=status.HTTP_200_OK)
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    """Permanently deletes a camera profile and all its associated videos.
    
    Status codes:
    - 200 OK: Camera and video records successfully removed.
    - 404 Not Found: Camera profile not found.
    """
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera profile with ID '{camera_id}' does not exist."
        )
        
    try:
        db.delete(camera)
        db.commit()
        return {"message": f"Camera '{camera_id}' and all associated video feeds have been permanently deleted."}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete camera: {str(e)}"
        )


def sync_camera_videos_background(camera_id: str, video_ids: List[str]):
    import os
    import time
    from loguru import logger
    from datetime import datetime, timezone
    from app.db.session import SessionLocal
    from app.db.models import CameraProfile, VideoAsset, MLModel, ModelExecutionLog
    from app.detection.detector import DetectionService
    from app.embeddings.tracklet_embeddings import TrackletEmbeddingService
    from app.search.vector_index import VectorIndexService
    from app.config import get_data_path
    from app.preprocess.preprocessor import sanitize_filename

    db = SessionLocal()
    try:
        camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
        if not camera:
            logger.error(f"Sync: Camera {camera_id} not found.")
            return

        from app.db.crud import create_system_job, update_system_job_progress, complete_system_job
        job = create_system_job(
            db=db,
            name=f"Syncing {len(video_ids)} Videos for {camera.name or camera_id}",
            job_type="model_run",
            status="running",
            payload={"camera_id": camera_id, "video_ids": video_ids}
        )
        job_id = job.id

        # Resolve camera-assigned model path if it exists
        model_path = None
        assigned_model_id = None
        active_model_id = None
        for m_id in [camera.theft_model_id, camera.abandoned_model_id, camera.assault_model_id, camera.model_id]:
            if m_id and m_id != "OFF":
                active_model_id = m_id
                break
        
        if active_model_id:
            model_record = db.query(MLModel).filter(MLModel.id == active_model_id).first()
            if model_record and os.path.exists(model_record.file_path):
                model_path = model_record.file_path
                assigned_model_id = model_record.id

        logger.info(f"Sync: Starting detection re-run for {len(video_ids)} videos on camera {camera_id} using model {assigned_model_id}")

        for idx, video_id in enumerate(video_ids):
            video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
            if not video or video.is_bin:
                continue

            update_system_job_progress(db, job_id, progress=(idx / len(video_ids)) * 100, status="running")

            # 1. Update status to 'indexing' / progress to show syncing
            video.processing_status = "indexing"
            video.progress_percentage = 40
            db.commit()

            # 2. Delete old Qdrant/SQLite tracklets
            try:
                index_service = VectorIndexService()
                index_service.delete_video_tracklets(video_id, db)
            except Exception as e:
                logger.warning(f"Sync: Failed to clear old Qdrant points for {video_id}: {e}")

            # 3. Build paths
            camera_dir_name = f"{camera_id}_{sanitize_filename(camera.name)}"
            camera_dir = get_data_path(os.path.join("cameras", camera_dir_name))
            standardized_video_path = os.path.join(camera_dir, "original_assets", video.standardized_filename)
            detection_output_dir = get_data_path(os.path.join("processed/detections", video_id))

            if not os.path.exists(standardized_video_path):
                logger.warning(f"Sync: Standardized video not found at {standardized_video_path}, skipping.")
                video.processing_status = "failed"
                db.commit()
                continue

            # 4. Run detection
            start_inference = time.time()
            detection_service = DetectionService(model_path=model_path)
            detection_result = detection_service.analyze_video(
                video_path=standardized_video_path,
                output_dir=detection_output_dir,
                camera_id=camera_id,
                video_id=video_id,
            )

            # 5. Update progress to embedding
            video.progress_percentage = 75
            db.commit()

            # 6. Extract embeddings
            embedding_service = TrackletEmbeddingService()
            embedding_result = embedding_service.embed_detection_artifact(
                os.path.join(detection_output_dir, "detections.json")
            )

            # 7. Run Vector indexing
            video.progress_percentage = 90
            db.commit()
            index_result = index_service.index_video_tracklets(video_id, db)

            inference_duration = time.time() - start_inference

            # Log serving execution if custom model was used
            if assigned_model_id:
                try:
                    total_dets = 0
                    for f in detection_result.frame_detections:
                        total_dets += len(f.detections)

                    log_entry = ModelExecutionLog(
                        model_id=assigned_model_id,
                        video_id=video_id,
                        camera_id=camera_id,
                        frames_processed=detection_result.frame_count,
                        inference_duration_seconds=inference_duration,
                        objects_detected_count=total_dets
                    )
                    db.add(log_entry)

                    # Update model last used timestamp
                    model_rec = db.query(MLModel).filter(MLModel.id == assigned_model_id).first()
                    if model_rec:
                        model_rec.last_used_timestamp = datetime.now(timezone.utc)
                    db.commit()
                except Exception as log_err:
                    logger.warning(f"Sync: Failed to log model execution stats: {str(log_err)}")

            # Complete status
            video.processing_status = "complete"
            video.progress_percentage = 100
            db.commit()
            logger.info(f"Sync: Video {video_id} re-detection and index complete.")

        complete_system_job(db, job_id, status="completed")
    except Exception as err:
        logger.error(f"Sync: Detection sync background run failed: {err}")
        if 'job_id' in locals():
            complete_system_job(db, job_id, status="failed")
    finally:
        db.close()


@router.post("/cameras/{camera_id}/sync-detection")
def sync_camera_videos_detection(
    camera_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Triggers model execution sync for all videos associated with this camera.
    Re-runs detections, tracklet extraction, and vector index update.
    """
    camera = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera profile with ID '{camera_id}' does not exist."
        )
    
    # Get all non-binned videos for this camera
    videos = db.query(VideoAsset).filter(VideoAsset.camera_id == camera_id).filter(VideoAsset.is_bin == False).all()
    if not videos:
        return {"status": "success", "message": "No active videos found for this camera to sync."}
    
    # Run the background sync task
    background_tasks.add_task(
        sync_camera_videos_background,
        camera_id=camera_id,
        video_ids=[v.id for v in videos]
    )
    
    return {"status": "success", "message": f"Detections sync started in background for {len(videos)} videos."}
