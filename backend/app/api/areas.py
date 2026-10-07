import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_data_path
from app.db.models import Area, CameraProfile
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/areas", tags=["Areas"])


class AreaCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    thumbnail_url: Optional[str] = Field(None, max_length=2048)


class AreaUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    thumbnail_url: Optional[str] = Field(None, max_length=2048)


class AreaResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    thumbnail_path: Optional[str]
    thumbnail_url: Optional[str]
    default_thumbnail_path: Optional[str]
    camera_count: int
    camera_ids: List[str]
    created_at: Optional[str]


def _get_area(area_id: str, db: Session) -> Area:
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail=f"Area '{area_id}' does not exist.")
    return area


@router.get("", response_model=List[AreaResponse])
def list_areas(db: Session = Depends(get_db)):
    return [area.to_dict() for area in db.query(Area).order_by(Area.name.asc()).all()]


@router.post("", response_model=AreaResponse, status_code=status.HTTP_201_CREATED)
def create_area(payload: AreaCreate, db: Session = Depends(get_db)):
    if db.query(Area).filter(Area.name == payload.name.strip()).first():
        raise HTTPException(status_code=409, detail=f"Area '{payload.name.strip()}' already exists.")
    area = Area(
        id=str(uuid.uuid4()),
        name=payload.name.strip(),
        description=payload.description,
        thumbnail_url=payload.thumbnail_url,
    )
    db.add(area)
    db.commit()
    db.refresh(area)
    return area.to_dict()


@router.put("/{area_id}", response_model=AreaResponse)
def update_area(area_id: str, payload: AreaUpdate, db: Session = Depends(get_db)):
    area = _get_area(area_id, db)
    if payload.name is not None:
        normalized_name = payload.name.strip()
        duplicate = (
            db.query(Area)
            .filter(Area.name == normalized_name, Area.id != area_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail=f"Area '{normalized_name}' already exists.")
        area.name = normalized_name
    if payload.description is not None:
        area.description = payload.description
    if payload.thumbnail_url is not None:
        area.thumbnail_url = payload.thumbnail_url
    db.commit()
    db.refresh(area)
    return area.to_dict()


@router.post("/{area_id}/thumbnail", response_model=AreaResponse)
def upload_area_thumbnail(
    area_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    area = _get_area(area_id, db)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Area thumbnail must be an image file.")

    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Supported thumbnail formats: JPG, PNG, or WebP.")

    area_dir = get_data_path(os.path.join("areas", area.id))
    os.makedirs(area_dir, exist_ok=True)
    target_name = f"thumbnail{extension}"
    target_path = os.path.join(area_dir, target_name)
    with open(target_path, "wb") as output:
        output.write(file.file.read())

    area.thumbnail_path = os.path.join("areas", area.id, target_name).replace("\\", "/")
    db.commit()
    db.refresh(area)
    return area.to_dict()


@router.delete("/{area_id}", status_code=status.HTTP_200_OK)
def delete_area(area_id: str, db: Session = Depends(get_db)):
    area = _get_area(area_id, db)
    camera_count = db.query(CameraProfile).filter(CameraProfile.area_id == area_id).count()
    if camera_count:
        raise HTTPException(
            status_code=409,
            detail=f"Reassign all {camera_count} camera(s) before deleting this Area.",
        )
    db.delete(area)
    db.commit()
    return {"message": f"Area '{area.name}' deleted."}
