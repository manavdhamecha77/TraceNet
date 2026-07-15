import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
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
    corridor_group: Optional[str] = Field(None, example= "Zone-A")
    adjacency: List[str] = Field(default_factory=list, example=["CAM_041", "CAM_043"])
    status: Optional[str] = Field("active", example="active")
    altitude: Optional[float] = Field(None, example=45.2)

class CameraUpdate(BaseModel):
    name: str = Field(..., example="Intersection East", min_length=2)
    latitude: Optional[float] = Field(None, example=23.0225)
    longitude: Optional[float] = Field(None, example=72.5714)
    corridor_group: Optional[str] = Field(None, example="Zone-A")
    adjacency: List[str] = Field(default_factory=list, example=["CAM_041", "CAM_043"])
    status: str = Field("active", example="active")
    altitude: Optional[float] = Field(None, example=45.2)

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
    duration: Optional[float]
    start_time: Optional[str]
    end_time: Optional[str]
    thumbnail_path: Optional[str]

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
            altitude=payload.altitude
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
def list_cameras(db: Session = Depends(get_db)):
    """Retrieves all registered camera profiles.
    
    Status codes:
    - 200 OK: Success.
    """
    cameras = db.query(CameraProfile).all()
    return [c.to_dict() for c in cameras]

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
        camera.name = payload.name
        camera.latitude = payload.latitude
        camera.longitude = payload.longitude
        camera.corridor_group = payload.corridor_group
        camera.adjacency = json.dumps(payload.adjacency)
        camera.status = payload.status
        camera.altitude = payload.altitude
        
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
