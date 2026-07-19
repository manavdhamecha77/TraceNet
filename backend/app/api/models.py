import os
import uuid
import json
import shutil
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import MLModel, ModelExecutionLog, CameraProfile
from app.detection.detector import load_detection_model
from app.config import get_data_path

router = APIRouter(prefix="/api/v1", tags=["models"])

# Ensure models dir exists
MODELS_DIR = get_data_path("models")
os.makedirs(MODELS_DIR, exist_ok=True)

class ModelResponse(BaseModel):
    id: str
    name: str
    file_path: str
    model_type: str
    classes: List[str]
    last_used_timestamp: Optional[str]
    created_at: str

    class Config:
        from_attributes = True

class ModelLogResponse(BaseModel):
    id: int
    model_id: str
    video_id: str
    camera_id: str
    timestamp: str
    frames_processed: int
    inference_duration_seconds: float
    objects_detected_count: int

    class Config:
        from_attributes = True

@router.get("/models", response_model=List[ModelResponse])
def list_models(db: Session = Depends(get_db)):
    """Retrieves all registered ML models."""
    models = db.query(MLModel).all()
    return [m.to_dict() for m in models]

@router.post("/models", response_model=ModelResponse, status_code=status.HTTP_201_CREATED)
async def upload_and_register_model(
    name: str = Form(...),
    model_type: str = Form(...),  # YOLOv8, YOLOv11, YOLOv12, RT-DETR, GroundingDino, etc.
    manual_classes: Optional[str] = Form(None),  # Comma-separated fallback
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Uploads a model weights file and registers it in Project DRISHTI.
    If it is a YOLO model type, the backend automatically extracts class labels.
    """
    model_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1] or ".pt"
    filename = f"{model_id}{file_extension}"
    target_path = os.path.join(MODELS_DIR, filename)

    # 1. Save uploaded file to data/models/
    try:
        with open(target_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write weights file to disk: {str(e)}"
        )

    # 2. Extract classes
    class_list = []
    
    # Check if we should auto-extract for YOLO models
    is_yolo = model_type.lower().startswith("yolo")
    if is_yolo:
        try:
            # Load model temporarily on CPU to inspect class names
            temp_model = load_detection_model(target_path)
            if hasattr(temp_model, "names") and temp_model.names:
                class_list = list(temp_model.names.values())
                logger.info(f"Auto-extracted {len(class_list)} classes from YOLO model: {class_list[:5]}...")
        except Exception as e:
            logger.warning(f"Failed to auto-extract classes from YOLO: {str(e)}. Falling back to manual.")
    
    # Fallback to manual classes if provided or extraction failed/non-YOLO
    if not class_list and manual_classes:
        class_list = [c.strip() for c in manual_classes.split(",") if c.strip()]

    try:
        ml_model = MLModel(
            id=model_id,
            name=name.strip(),
            file_path=target_path,
            model_type=model_type,
            classes=json.dumps(class_list),
            last_used_timestamp=None
        )
        db.add(ml_model)
        db.commit()
        db.refresh(ml_model)
        return ml_model.to_dict()
    except Exception as e:
        db.rollback()
        # Clean up file on failure
        if os.path.exists(target_path):
            os.remove(target_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to register model in database: {str(e)}"
        )

@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: str, db: Session = Depends(get_db)):
    """Deletes an ML model registry and removes its weights file from disk."""
    model = db.query(MLModel).filter(MLModel.id == model_id).first()
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model with ID '{model_id}' does not exist."
        )

    # Verify if model is actively assigned to any cameras
    assigned_cameras = db.query(CameraProfile).filter(CameraProfile.model_id == model_id).all()
    if assigned_cameras:
        camera_names = [c.name for c in assigned_cameras]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete model. It is actively assigned to cameras: {', '.join(camera_names)}."
        )

    file_path = model.file_path
    try:
        db.delete(model)
        db.commit()
        
        # Remove file from disk
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Removed weights file {file_path} from disk.")
            
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete model: {str(e)}"
        )

@router.get("/models/{model_id}/logs", response_model=List[ModelLogResponse])
def get_model_logs(model_id: str, db: Session = Depends(get_db)):
    """Retrieves execution/audit logs for a specific ML model."""
    model = db.query(MLModel).filter(MLModel.id == model_id).first()
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model with ID '{model_id}' does not exist."
        )
    
    logs = db.query(ModelExecutionLog).filter(ModelExecutionLog.model_id == model_id).order_by(ModelExecutionLog.timestamp.desc()).all()
    return [log.to_dict() for log in logs]
