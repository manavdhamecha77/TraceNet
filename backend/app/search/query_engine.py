from __future__ import annotations

import os
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence
from loguru import logger
from sqlalchemy.orm import Session
from qdrant_client import QdrantClient
from qdrant_client import models

from app.config import get_data_path
from app.embeddings.clip_encoder import get_clip_encoder
from app.db.models import Tracklet, VideoAsset, SearchLog

COLLECTION_NAME = "tracenet_tracklets"

_QUERY_STOP_WORDS = {
    "a", "an", "and", "at", "by", "for", "from", "in", "near", "of", "on",
    "the", "to", "with", "person", "people", "vehicle", "car", "someone", "man", "woman",
}


class QueryEngine:
    def __init__(self) -> None:
        db_dir = get_data_path("vector_db")
        self.client = QdrantClient(path=db_dir)

    def search_by_vector(
        self,
        db: Session,
        query_vector: list[float],
        query_label: str,
        camera_ids: Optional[Sequence[str]] = None,
        time_start: Optional[datetime] = None,
        time_end: Optional[datetime] = None,
        object_type: Optional[str] = None,
        video_id: Optional[str] = None,
        top_k: int = 15,
        user_id: str = "demo",
    ) -> list[dict]:
        """
        Hybrid semantic + metadata search:
        1. Encodes text query to vector using active CLIP model.
        2. Queries local Qdrant collection with camera_id, video_id, and object_type pre-filters.
        3. Enriches results with SQLite joins and filters by absolute timeline window.
        4. Logs search query, timestamp, and results count for the evidentiary audit trail.
        """
        logger.info(f"QueryEngine: search query='{query_label}', camera_ids={camera_ids}, video_id={video_id}, type={object_type}")
        query_dim = len(query_vector)

        # Ensure collection exists and matches active query dimension
        try:
            from app.search.vector_index import VectorIndexService
            if not self.client.collection_exists(COLLECTION_NAME):
                VectorIndexService(target_dim=query_dim)
            else:
                col_info = self.client.get_collection(COLLECTION_NAME)
                col_dim = col_info.config.params.vectors.size
                if col_dim != query_dim:
                    logger.warning(
                        f"Qdrant collection dimension ({col_dim}) does not match active query dimension ({query_dim}). "
                        f"Auto-aligning collection to {query_dim}-dim."
                    )
                    indexer = VectorIndexService(target_dim=query_dim)
                    indexer.recreate_collection(new_dim=query_dim)
        except Exception as col_err:
            logger.error(f"Failed vector collection dimension validation: {col_err}")

        # 1. Build Qdrant payload filters
        must_filters = []
        if camera_ids:
            must_filters.append(
                models.FieldCondition(
                    key="camera_id",
                    match=models.MatchAny(any=list(camera_ids))
                )
            )
        if video_id:
            must_filters.append(
                models.FieldCondition(
                    key="video_id",
                    match=models.MatchValue(value=video_id)
                )
            )
        if object_type and object_type != "all":
            must_filters.append(
                models.FieldCondition(
                    key="object_type",
                    match=models.MatchValue(value=object_type)
                )
            )

        qdrant_filter = models.Filter(must=must_filters) if must_filters else None

        # Fetch more candidates to allow filtering by absolute datetime in SQLite
        qdrant_limit = top_k * 4 if (time_start or time_end) else top_k

        try:
            qdrant_response = self.client.query_points(
                collection_name=COLLECTION_NAME,
                query=query_vector,
                query_filter=qdrant_filter,
                limit=qdrant_limit,
                with_payload=True
            )
            qdrant_results = qdrant_response.points
        except Exception as e:
            logger.error(f"Qdrant search failed: {e}")
            qdrant_results = []

        if not qdrant_results:
            self._log_search(db, query_label, user_id, 0, camera_ids, time_start, time_end)
            return []

        # Map tracklet IDs to scores
        scores_by_tracklet = {
            res.payload.get("tracklet_id"): float(res.score)
            for res in qdrant_results if res.payload
        }

        # 2. Enrich with SQLite
        tracklet_ids = list(scores_by_tracklet.keys())
        tracklets = (
            db.query(Tracklet)
            .join(VideoAsset)
            .filter(Tracklet.id.in_(tracklet_ids))
            .filter(VideoAsset.is_bin == False)
            .all()
        )

        # Filter by absolute timeline window
        filtered_results = []
        for tracklet in tracklets:
            video = tracklet.video
            if not video:
                continue

            # Calculate absolute timestamp of tracklet occurrence
            video_ref_time = video.start_time or video.upload_timestamp
            if not video_ref_time:
                continue

            # Make timezone aware if it is naïve to match filter inputs
            if video_ref_time.tzinfo is None:
                video_ref_time = video_ref_time.replace(tzinfo=timezone.utc)

            tracklet_abs_time = video_ref_time + timedelta(seconds=tracklet.timestamp_start_seconds)

            if time_start:
                t_start = time_start if time_start.tzinfo else time_start.replace(tzinfo=timezone.utc)
                if tracklet_abs_time < t_start:
                    continue

            if time_end:
                t_end = time_end if time_end.tzinfo else time_end.replace(tzinfo=timezone.utc)
                if tracklet_abs_time > t_end:
                    continue

            # Load bounding box coordinates
            try:
                best_bbox = json.loads(tracklet.best_bbox) if tracklet.best_bbox else []
            except Exception:
                best_bbox = []

            score = scores_by_tracklet.get(tracklet.id, 0.0)

            # Resolve crop URL path
            crop_path = tracklet.best_crop_path or ""
            normalized = crop_path.replace("\\", "/")
            crop_url = ""
            data_index = normalized.find("/data/")
            if data_index != -1:
                crop_url = normalized[data_index:]

            attr_dict = {}
            try:
                if tracklet.attributes:
                    attr_dict = json.loads(tracklet.attributes)
            except Exception:
                pass

            explanation = self._build_explanation(
                query_label=query_label,
                score=score,
                mean_confidence=tracklet.mean_confidence,
                class_name=tracklet.class_name,
                caption=attr_dict.get("caption", ""),
                camera_ids=camera_ids,
                time_start=time_start,
                time_end=time_end,
                object_type=object_type,
                video_id=video_id,
            )

            filtered_results.append({
                "score": score,
                "tracklet_id": tracklet.id,
                "tracker_id": tracklet.tracker_id,
                "video_id": tracklet.video_id,
                "camera_id": tracklet.camera_id,
                "camera_name": video.camera.name if video.camera else tracklet.camera_id,
                "object_type": tracklet.object_type,
                "class_name": tracklet.class_name,
                "frame_start": tracklet.frame_start,
                "frame_end": tracklet.frame_end,
                "timestamp_start_seconds": tracklet.timestamp_start_seconds,
                "timestamp_end_seconds": tracklet.timestamp_end_seconds,
                "best_crop_path": crop_url,
                "mean_confidence": tracklet.mean_confidence,
                "best_bbox": best_bbox,
                "caption": attr_dict.get("caption", ""),
                "attributes": attr_dict,
                "explanation": explanation,
                "video_original_filename": video.original_filename,
                "video_start_time": video_ref_time.isoformat(),
                "video_standardized_filename": video.standardized_filename,
                "video_thumbnail_path": video.thumbnail_path or ""
            })

        # Sort combined results by cosine similarity score desc
        filtered_results.sort(key=lambda x: x["score"], reverse=True)
        final_results = filtered_results[:top_k]

        # 3. Log search audit trail
        self._log_search(
            db=db,
            query=query_label,
            user=user_id,
            count=len(final_results),
            camera_ids=camera_ids,
            time_start=time_start,
            time_end=time_end
        )

        return final_results

    def search_tracklets(
        self,
        db: Session,
        query_text: str,
        camera_ids: Optional[Sequence[str]] = None,
        time_start: Optional[datetime] = None,
        time_end: Optional[datetime] = None,
        object_type: Optional[str] = None,
        video_id: Optional[str] = None,
        top_k: int = 15,
        user_id: str = "demo",
    ) -> list[dict]:
        """
        Text search wrapper:
        Encodes query text to vector using CLIP, then delegates to search_by_vector().
        """
        logger.info(f"QueryEngine: text search query='{query_text}'")
        query_vector = get_clip_encoder().embed_text(query_text)
        return self.search_by_vector(
            db=db,
            query_vector=query_vector,
            query_label=query_text,
            camera_ids=camera_ids,
            time_start=time_start,
            time_end=time_end,
            object_type=object_type,
            video_id=video_id,
            top_k=top_k,
            user_id=user_id,
        )

    @staticmethod
    def _build_explanation(
        query_label: str,
        score: float,
        mean_confidence: float,
        class_name: str,
        caption: str,
        camera_ids: Optional[Sequence[str]],
        time_start: Optional[datetime],
        time_end: Optional[datetime],
        object_type: Optional[str],
        video_id: Optional[str],
    ) -> dict:
        """Return transparent retrieval evidence; it is not an identity determination."""
        is_image_search = query_label.startswith("[IMAGE SEARCH]")
        query_terms = [] if is_image_search else [
            token for token in re.findall(r"[a-z0-9-]+", query_label.lower())
            if len(token) > 2 and token not in _QUERY_STOP_WORDS
        ]
        searchable_evidence = f"{class_name} {caption}".lower()
        matched_terms = [term for term in query_terms if term in searchable_evidence]
        unknown_terms = [term for term in query_terms if term not in matched_terms]

        evidence = [{
            "label": "Visual similarity",
            "detail": ("Reference-image similarity" if is_image_search else "CLIP text-to-image similarity"),
            "value_percent": round(max(0.0, min(score, 1.0)) * 100, 1),
        }, {
            "label": "Detector confidence",
            "detail": f"Detected as {class_name}",
            "value_percent": round(max(0.0, min(mean_confidence or 0.0, 1.0)) * 100, 1),
        }]
        if caption:
            evidence.append({
                "label": "Generated visual description",
                "detail": caption,
                "value_percent": None,
            })

        applied_filters = []
        if camera_ids:
            applied_filters.append(f"Camera: {', '.join(camera_ids)}")
        if object_type and object_type != "all":
            applied_filters.append(f"Category: {object_type}")
        if time_start or time_end:
            applied_filters.append("Time window applied")
        if video_id:
            applied_filters.append("Single video applied")

        return {
            "retrieval_method": "reference-image similarity" if is_image_search else "text-to-image semantic similarity",
            "evidence": evidence,
            "matched_query_terms": matched_terms,
            "unknown_or_unverified_terms": unknown_terms,
            "applied_filters": applied_filters,
            "limitation": "Similarity ranks candidates for human review; it does not verify identity or prove an attribute is present or absent.",
        }

    def _log_search(
        self,
        db: Session,
        query: str,
        user: str,
        count: int,
        camera_ids: Optional[Sequence[str]],
        time_start: Optional[datetime],
        time_end: Optional[datetime]
    ) -> None:
        """Saves search transactions to SQLite search_logs for security audits."""
        try:
            cam_str = json.dumps(list(camera_ids)) if camera_ids else None
            log = SearchLog(
                query_text=query,
                user_id=user,
                timestamp=datetime.now(timezone.utc),
                results_count=count,
                camera_filter=cam_str,
                time_filter_start=time_start,
                time_filter_end=time_end
            )
            db.add(log)
            db.commit()
            logger.info(f"Audit log saved: query='{query}' returned {count} results.")
        except Exception as e:
            logger.error(f"Failed to write search audit log: {e}")
            db.rollback()
