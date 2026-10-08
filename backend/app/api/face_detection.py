import os
import re
import json
from typing import Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ultralytics import YOLO

from app.db.session import get_db
from app.db.models import FaceTracklet, VideoAsset
from app.config import get_data_path, get_settings
from app.detection.face_detector import get_face_detector, ACTIVE_FACE_MODEL_PATH
from app.search.face_vector_index import get_face_vector_index
from app.search.face_query_engine import FaceQueryEngine
from app.embeddings.face_encoder import get_active_backend, set_active_backend

router = APIRouter(prefix="/api/v1", tags=["face-detection"])


class LabelUpdate(BaseModel):
    label: str


class TextSearchQuery(BaseModel):
    query: str
    top_k: int = 50
    camera_ids: Optional[list[str]] = None
    video_id: Optional[str] = None


class LabelSearchQuery(BaseModel):
    label: str
    top_k: int = 50
    camera_ids: Optional[list[str]] = None


class ModelSwitchRequest(BaseModel):
    model_path: Optional[str] = None
    embedding_backend: Optional[str] = None


@router.post("/videos/{video_id}/faces/run")
def run_face_detection(video_id: str, db: Session = Depends(get_db)):
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    from app.detection.detector import resolve_standardized_video_path
    video_path = resolve_standardized_video_path(video)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video file not found")

    output_dir = get_data_path(os.path.join("processed/faces", video_id))
    detector = get_face_detector()
    
    try:
        run_result = detector.analyze_video(
            video_path=video_path,
            output_dir=output_dir,
            camera_id=video.camera_id,
            video_id=video_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    index_service = get_face_vector_index()
    try:
        index_res = index_service.index_video_faces(video_id, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to index faces: {e}")

    return {
        "video_id": video_id,
        "faces_detected": len(run_result.face_tracklets),
        "tracklets_indexed": index_res.get("indexed", 0)
    }


@router.get("/videos/{video_id}/faces")
def get_video_faces(video_id: str):
    faces_path = get_data_path(os.path.join("processed/faces", video_id, "faces.json"))
    if not os.path.exists(faces_path):
        raise HTTPException(status_code=404, detail="Faces artifact not found")
    
    with open(faces_path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("/videos/{video_id}/face-tracklets")
def get_video_face_tracklets(video_id: str, db: Session = Depends(get_db)):
    tracklets = db.query(FaceTracklet).filter(FaceTracklet.video_id == video_id).all()
    return [t.to_dict() for t in tracklets]


@router.post("/face-tracklets/{face_tracklet_id}/label")
def update_face_label(face_tracklet_id: str, payload: LabelUpdate, db: Session = Depends(get_db)):
    tracklet = db.query(FaceTracklet).filter(FaceTracklet.id == face_tracklet_id).first()
    if not tracklet:
        raise HTTPException(status_code=404, detail="Face tracklet not found")
        
    tracklet.label = payload.label
    db.commit()
    db.refresh(tracklet)
    
    index_service = get_face_vector_index()
    index_service.upsert_face_tracklet(tracklet, db)
    
    return tracklet.to_dict()


@router.post("/face-search/text")
def search_faces_by_text(payload: TextSearchQuery, db: Session = Depends(get_db)):
    engine = FaceQueryEngine()
    results = engine.search_by_text(
        query=payload.query,
        db=db,
        top_k=payload.top_k,
        camera_ids=payload.camera_ids,
        video_id=payload.video_id
    )
    return results


@router.post("/face-search/image")
def search_faces_by_image(
    file: UploadFile = File(...),
    top_k: int = Form(50),
    camera_ids: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    camera_ids_list = None
    if camera_ids:
        try:
            camera_ids_list = json.loads(camera_ids)
        except Exception:
            pass
            
    engine = FaceQueryEngine()
    results = engine.search_by_image(
        file=file,
        db=db,
        top_k=top_k,
        camera_ids=camera_ids_list
    )
    return results


@router.post("/face-search/by-label")
def search_faces_by_label(payload: LabelSearchQuery, db: Session = Depends(get_db)):
    engine = FaceQueryEngine()
    results = engine.search_by_label(
        label=payload.label,
        db=db,
        top_k=payload.top_k,
        camera_ids=payload.camera_ids
    )
    return results


@router.get("/face-models/config")
def get_face_models_config():
    from app.detection.face_detector import ACTIVE_FACE_MODEL_PATH
    
    models_dir = get_data_path("models/face_detection")
    available_models = []
    if os.path.exists(models_dir):
        for f in os.listdir(models_dir):
            if f.endswith(".pt"):
                full_path = os.path.join(models_dir, f)
                size_mb = os.path.getsize(full_path) / (1024 * 1024)
                available_models.append({
                    "name": f,
                    "path": f"models/face_detection/{f}",
                    "size_mb": round(size_mb, 2)
                })
                
    return {
        "active_model": ACTIVE_FACE_MODEL_PATH,
        "active_embedding_backend": get_active_backend(),
        "available_models": available_models
    }


@router.post("/face-models/switch")
def switch_face_models(payload: ModelSwitchRequest):
    if payload.model_path:
        get_face_detector(model_path=payload.model_path)
    if payload.embedding_backend:
        try:
            set_active_backend(payload.embedding_backend)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
            
    return get_face_models_config()


@router.post("/face-models/upload")
def upload_face_model(name: str = Form(...), file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pt"):
        raise HTTPException(status_code=400, detail="Model file must be a .pt file")

    name = name.strip()
    if name.lower().endswith(".pt"):
        name = name[:-3]
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", name) or name.startswith("."):
        raise HTTPException(
            status_code=400,
            detail="Model name may only contain letters, digits, '_', '-' and '.'",
        )

    models_dir = get_data_path("models/face_detection")
    os.makedirs(models_dir, exist_ok=True)

    file_path = os.path.join(models_dir, f"{name}.pt")
    with open(file_path, "wb") as f:
        f.write(file.file.read())
        
    try:
        model = YOLO(file_path)
        classes = model.names
        if len(classes) != 1:
            os.remove(file_path)
            raise HTTPException(
                status_code=400,
                detail=f"Face model must have exactly 1 class. Found {len(classes)} classes: {classes}"
            )
        return {
            "success": True,
            "path": f"models/face_detection/{name}.pt",
            "classes": classes
        }
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail=f"Failed to load or validate YOLO model: {str(e)}")
