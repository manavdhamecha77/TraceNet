"""Forensic evidence export API: create sealed bundles, list them, download and verify integrity."""
import os
import tempfile
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_data_path
from app.db.models import ForensicExport
from app.db.session import get_db
from app.export.face_blur import FaceRedactionUnavailable
from app.export.forensic_export import (
    MAX_ITEMS,
    ForensicExportService,
    verify_against_registry,
    verify_bundle,
    verify_stored_export,
)

router = APIRouter(prefix="/api/v1", tags=["forensic-export"])

MAX_VERIFY_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024


class ExportItemRequest(BaseModel):
    tracklet_id: str
    score: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ExportRequest(BaseModel):
    items: List[ExportItemRequest] = Field(..., min_length=1, max_length=MAX_ITEMS)
    query: str = ""
    filters: Dict[str, Any] = Field(default_factory=dict)
    case_reference: Optional[str] = Field(default=None, max_length=120)
    operator: str = Field(default="demo", max_length=80)
    notes: Optional[str] = Field(default=None, max_length=2000)
    include_clips: bool = True
    include_annotated: bool = True
    blur_faces: bool = False
    clip_padding_seconds: float = Field(default=2.0, ge=0.0, le=10.0)
    max_clip_seconds: int = Field(default=30, ge=5, le=120)
    search_log_id: Optional[int] = None


@router.post("/exports", status_code=status.HTTP_201_CREATED)
def create_export(payload: ExportRequest, db: Session = Depends(get_db)):
    """Build and seal an evidence bundle (clips, annotated frames, manifest, SHA-256 sums, HTML report)."""
    spec = payload.model_dump()
    try:
        record = ForensicExportService(db).create(spec)
    except FaceRedactionUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        db.rollback()
        logger.exception("Forensic export failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Export failed: {exc}")
    return record.to_dict()


@router.get("/exports")
def list_exports(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.query(ForensicExport).order_by(ForensicExport.created_at.desc()).limit(min(max(limit, 1), 200)).all()
    return [r.to_dict() for r in rows]


def _get_or_404(db: Session, export_id: str) -> ForensicExport:
    record = db.query(ForensicExport).filter(ForensicExport.id == export_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Export '{export_id}' not found")
    return record


@router.get("/exports/{export_id}")
def get_export(export_id: str, db: Session = Depends(get_db)):
    return _get_or_404(db, export_id).to_dict()


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_db)):
    record = _get_or_404(db, export_id)
    path = get_data_path(record.zip_path)
    if not os.path.exists(path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundle file is missing from disk")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"{record.id}.zip",
        headers={"X-Content-SHA256": record.zip_sha256},
    )


@router.get("/exports/{export_id}/verify")
def verify_export(export_id: str, db: Session = Depends(get_db)):
    """Re-hash the stored bundle and compare with SHA256SUMS, the manifest and the issuing registry."""
    record = _get_or_404(db, export_id)
    report = verify_stored_export(db, record)
    return {"export_id": export_id, **report}


@router.post("/exports/verify-upload")
async def verify_uploaded_bundle(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Verify a bundle supplied by the operator (e.g. a copy received from another agency)."""
    fd, temp_path = tempfile.mkstemp(suffix=".zip", dir=get_data_path("exports"))
    try:
        written = 0
        with os.fdopen(fd, "wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_VERIFY_UPLOAD_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Bundle too large")
                handle.write(chunk)
        return verify_against_registry(db, verify_bundle(temp_path))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
