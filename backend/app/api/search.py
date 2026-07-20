from __future__ import annotations

import os
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import SearchLog, Tracklet
from app.search.query_engine import QueryEngine

router = APIRouter(prefix="/api/v1", tags=["search"])


class SearchQueryRequest(BaseModel):
    query: str = Field(..., description="Natural language description of person/vehicle")
    camera_ids: Optional[List[str]] = Field(default=None, description="Scope search to these cameras")
    time_start: Optional[str] = Field(default=None, description="Start date-time in ISO format")
    time_end: Optional[str] = Field(default=None, description="End date-time in ISO format")
    object_type: Optional[str] = Field(default="all", description="'all' | 'person' | 'vehicle'")
    video_id: Optional[str] = Field(default=None, description="Scope search to a single video asset")
    top_k: int = Field(default=15, ge=1, le=50)


class SearchQueryResultItem(BaseModel):
    score: float
    tracklet_id: str
    video_id: str
    camera_id: str
    camera_name: str
    object_type: str
    class_name: str
    frame_start: int
    frame_end: int
    timestamp_start_seconds: float
    timestamp_end_seconds: float
    best_crop_path: str
    mean_confidence: float
    best_bbox: List[float]
    video_original_filename: str
    video_start_time: str
    video_standardized_filename: str
    video_thumbnail_path: Optional[str] = None


class SearchLogItem(BaseModel):
    id: int
    query_text: str
    user_id: str
    timestamp: str
    results_count: Optional[int] = None
    camera_filter: Optional[List[str]] = None
    time_filter_start: Optional[str] = None
    time_filter_end: Optional[str] = None
    clip_export_hash: Optional[str] = None


@router.post("/search", response_model=List[SearchQueryResultItem])
def search_footage(
    payload: SearchQueryRequest,
    db: Session = Depends(get_db),
) -> List[SearchQueryResultItem]:
    """
    Perform natural language vector search over indexed video tracklets.
    Supports filtering by camera ID, timestamp alignment, and category classification.
    Logs every query to the search_logs table.
    """
    # Parse date-time filters
    parsed_start = None
    if payload.time_start:
        try:
            parsed_start = datetime.fromisoformat(payload.time_start.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Malformed start time: '{payload.time_start}'. Must be ISO 8601 format."
            )

    parsed_end = None
    if payload.time_end:
        try:
            parsed_end = datetime.fromisoformat(payload.time_end.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Malformed end time: '{payload.time_end}'. Must be ISO 8601 format."
            )

    try:
        engine = QueryEngine()
        results = engine.search_tracklets(
            db=db,
            query_text=payload.query,
            camera_ids=payload.camera_ids,
            time_start=parsed_start,
            time_end=parsed_end,
            object_type=payload.object_type,
            video_id=payload.video_id,
            top_k=payload.top_k
        )
        return results
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Vector search execution failure: {exc}"
        ) from exc


@router.get("/search/logs", response_model=List[SearchLogItem])
def get_search_logs(
    db: Session = Depends(get_db),
    limit: int = 50
) -> List[SearchLogItem]:
    """
    Retrieve evidentiary search log history for validation audits.
    """
    logs = db.query(SearchLog).order_by(SearchLog.timestamp.desc()).limit(limit).all()
    return [SearchLogItem(**l.to_dict()) for l in logs]


class TrackletClipResponse(BaseModel):
    tracklet_id: str
    video_id: str
    camera_id: str
    timestamp_start_seconds: float
    timestamp_end_seconds: float
    standardized_filename: str


@router.get("/clip/{tracklet_id}", response_model=TrackletClipResponse)
def get_tracklet_clip_info(
    tracklet_id: str,
    db: Session = Depends(get_db)
) -> TrackletClipResponse:
    """
    Retrieve video segment timestamp coordinates for targeted tracklet clip streaming.
    """
    tracklet = db.query(Tracklet).filter(Tracklet.id == tracklet_id).first()
    if not tracklet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tracklet with ID '{tracklet_id}' not found."
        )
    return TrackletClipResponse(
        tracklet_id=tracklet.id,
        video_id=tracklet.video_id,
        camera_id=tracklet.camera_id,
        timestamp_start_seconds=tracklet.timestamp_start_seconds,
        timestamp_end_seconds=tracklet.timestamp_end_seconds,
        standardized_filename=tracklet.video.standardized_filename if tracklet.video else ""
    )


@router.post("/reindex-all")
def reindex_all_videos(db: Session = Depends(get_db)):
    """
    Re-index all completed videos into Qdrant and SQLite tracklets table.
    Useful when upgrading vector storage or restoring index points.
    """
    from app.db.models import VideoAsset
    from app.search.vector_index import VectorIndexService
    from app.embeddings.tracklet_embeddings import TrackletEmbeddingService
    from app.config import get_data_path

    videos = db.query(VideoAsset).filter(VideoAsset.processing_status == "complete").all()
    if not videos:
        return {
            "status": "success",
            "message": "No completed videos to re-index.",
            "indexed_videos": 0,
            "total_tracklets": 0
        }

    indexer = VectorIndexService()
    embedder = TrackletEmbeddingService()
    total_indexed = 0

    for v in videos:
        detection_dir = get_data_path(os.path.join("processed/detections", v.id))
        detections_json = os.path.join(detection_dir, "detections.json")
        embeddings_json = os.path.join(detection_dir, "embeddings.json")

        if not os.path.exists(detections_json):
            continue

        if not os.path.exists(embeddings_json):
            try:
                embedder.embed_detection_artifact(detections_json)
            except Exception as e:
                logger.error(f"Failed to generate embeddings for {v.id}: {e}")
                continue

        try:
            res = indexer.index_video_tracklets(v.id, db)
            total_indexed += res.get("indexed", 0)
        except Exception as e:
            logger.error(f"Failed to index tracklets for {v.id}: {e}")
            continue

    return {
        "status": "success",
        "message": f"Successfully re-indexed {len(videos)} videos into Qdrant and SQLite.",
        "indexed_videos": len(videos),
        "total_tracklets": total_indexed
    }


