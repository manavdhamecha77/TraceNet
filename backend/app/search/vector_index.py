from __future__ import annotations

import os
import json
import uuid
from pathlib import Path
from datetime import datetime, timezone
from loguru import logger
from sqlalchemy.orm import Session
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from app.config import get_data_path
from app.db.models import Tracklet, VideoAsset

COLLECTION_NAME = "tracenet_tracklets"
_qdrant_client_instance: QdrantClient | None = None


def get_qdrant_client() -> QdrantClient:
    global _qdrant_client_instance
    if _qdrant_client_instance is None:
        db_dir = get_data_path("vector_db")
        os.makedirs(db_dir, exist_ok=True)
        _qdrant_client_instance = QdrantClient(path=db_dir)
    return _qdrant_client_instance


class VectorIndexService:
    def __init__(self, target_dim: int | None = None) -> None:
        self.client = get_qdrant_client()
        if target_dim is None:
            from app.api.embedding_models import load_active_config
            cfg = load_active_config()
            target_dim = cfg.get("dimension", 512)
        self.target_dim = target_dim
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        """Create or validate the collection with Cosine similarity matching the target dimension."""
        try:
            if self.client.collection_exists(COLLECTION_NAME):
                info = self.client.get_collection(COLLECTION_NAME)
                existing_dim = info.config.params.vectors.size
                if existing_dim != self.target_dim:
                    logger.warning(
                        f"Qdrant collection '{COLLECTION_NAME}' dimension ({existing_dim}) "
                        f"does not match active embedding model dimension ({self.target_dim}). Recreating collection."
                    )
                    self.recreate_collection(self.target_dim)
                else:
                    logger.debug(f"Qdrant collection '{COLLECTION_NAME}' exists with dimension ({self.target_dim}).")
            else:
                logger.info(f"Creating Qdrant collection '{COLLECTION_NAME}' (dim={self.target_dim})")
                self.client.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=VectorParams(
                        size=self.target_dim,
                        distance=Distance.COSINE
                    )
                )
        except Exception as e:
            logger.error(f"Failed to initialize Qdrant collection: {e}")

    def recreate_collection(self, new_dim: int | None = None) -> None:
        """Forces deletion and clean creation of the collection matching new_dim."""
        if new_dim is not None:
            self.target_dim = new_dim
        try:
            if self.client.collection_exists(COLLECTION_NAME):
                # Safely close underlying SQLite connection handle if present (Windows file lock fix)
                try:
                    if hasattr(self.client, "_client") and hasattr(self.client._client, "collections"):
                        coll = self.client._client.collections.get(COLLECTION_NAME)
                        if coll and hasattr(coll, "storage") and coll.storage and hasattr(coll.storage, "storage"):
                            coll.storage.storage.close()
                except Exception as close_err:
                    logger.debug(f"Closing collection storage handle: {close_err}")

                self.client.delete_collection(COLLECTION_NAME)

                # Clean up any residual collection directory on disk
                try:
                    cdir = get_data_path(os.path.join("vector_db/collection", COLLECTION_NAME))
                    if os.path.exists(cdir):
                        import shutil
                        shutil.rmtree(cdir, ignore_errors=True)
                except Exception:
                    pass

            self.client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(
                    size=self.target_dim,
                    distance=Distance.COSINE
                )
            )
            logger.info(f"Recreated Qdrant collection '{COLLECTION_NAME}' with dimension {self.target_dim}.")
        except Exception as e:
            logger.error(f"Failed to recreate Qdrant collection: {e}")

    def index_video_tracklets(self, video_id: str, db: Session) -> dict:
        """
        Loads embeddings.json for the video, creates Tracklet database records,
        and upserts vector points to the Qdrant local collection.
        Idempotent: Re-runs overwrite existing records using deterministic UUIDs.
        """
        embeddings_path = get_data_path(os.path.join("processed/detections", video_id, "embeddings.json"))
        if not os.path.exists(embeddings_path):
            raise FileNotFoundError(f"Embeddings artifact not found at '{embeddings_path}'")

        # Load the embeddings artifact
        with open(embeddings_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)

        tracklet_items = payload.get("tracklets", [])
        if not tracklet_items:
            logger.info(f"No tracklets to index for video {video_id}")
            return {"indexed": 0, "status": "no_tracklets"}

        # Auto-re-embed if stored embeddings dimension does not match target_dim
        first_emb = tracklet_items[0].get("embedding") if tracklet_items else None
        if first_emb and len(first_emb) != self.target_dim:
            logger.warning(
                f"Video {video_id} embeddings dimension ({len(first_emb)}) "
                f"does not match active target dimension ({self.target_dim}). Auto-re-embedding crops..."
            )
            det_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
            if os.path.exists(det_path):
                from app.embeddings.tracklet_embeddings import TrackletEmbeddingService
                emb_service = TrackletEmbeddingService()
                emb_service.embed_detection_artifact(det_path)
                with open(embeddings_path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                tracklet_items = payload.get("tracklets", [])

        points = []
        indexed_count = 0

        # Load the base video details
        video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
        if not video:
            raise ValueError(f"Video Asset {video_id} does not exist in SQLite database.")

        # Load original detections.json to get frame-specific details (like start/end frames)
        detections_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
        det_map = {}
        if os.path.exists(detections_path):
            with open(detections_path, "r", encoding="utf-8") as det_handle:
                det_payload = json.load(det_handle)
                for trk in det_payload.get("tracklets", []):
                    det_map[trk["tracklet_id"]] = trk

        for item in tracklet_items:
            tracklet_id = item.get("tracklet_id")
            embedding = item.get("embedding")
            if not tracklet_id or not embedding:
                continue

            # Fetch extra metadata from original detections artifact if present
            det_info = det_map.get(tracklet_id, {})
            frame_start = det_info.get("frame_start", 0)
            frame_end = det_info.get("frame_end", 0)
            timestamp_start = det_info.get("timestamp_start_seconds", 0.0)
            timestamp_end = det_info.get("timestamp_end_seconds", 0.0)
            detection_count = det_info.get("detection_count", 1)
            mean_confidence = det_info.get("mean_confidence", item.get("mean_confidence", 0.0))
            best_bbox = det_info.get("best_bbox", [0.0, 0.0, 0.0, 0.0])

            # Generate a deterministic UUID based on the tracklet_id string
            # This ensures if we run the index pipeline twice, we update the same point in Qdrant
            point_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, tracklet_id))

            # 1. Database Persistence (SQLite)
            # Delete old tracklet record to overwrite cleanly (if exists)
            db.query(Tracklet).filter(Tracklet.id == tracklet_id).delete()

            attr_payload = item.get("attributes") or {"caption": item.get("caption", ""), "class_name": det_info.get("class_name", "unknown")}

            db_tracklet = Tracklet(
                id=tracklet_id,
                video_id=video_id,
                tracker_id=item.get("tracker_id", 0),
                object_type=item.get("object_type", "unknown"),
                class_name=det_info.get("class_name", "unknown"),
                camera_id=video.camera_id,
                frame_start=frame_start,
                frame_end=frame_end,
                timestamp_start_seconds=timestamp_start,
                timestamp_end_seconds=timestamp_end,
                detection_count=detection_count,
                mean_confidence=mean_confidence,
                best_bbox=json.dumps(best_bbox),
                best_crop_path=item.get("best_crop_path"),
                attributes=json.dumps(attr_payload),
                qdrant_point_id=point_uuid,
                embedding_dim=len(embedding),
                indexed_at=datetime.now(timezone.utc),
            )
            db.add(db_tracklet)
            indexed_count += 1

            # 2. Qdrant Vector Point preparation
            points.append(
                PointStruct(
                    id=point_uuid,
                    vector=embedding,
                    payload={
                        "tracklet_id": tracklet_id,
                        "video_id": video_id,
                        "camera_id": video.camera_id,
                        "object_type": item.get("object_type", "unknown"),
                        "class_name": det_info.get("class_name", "unknown"),
                        "mean_confidence": mean_confidence,
                        "frame_start": frame_start,
                        "frame_end": frame_end,
                        "timestamp_start_seconds": timestamp_start,
                        "timestamp_end_seconds": timestamp_end,
                        "best_crop_path": item.get("best_crop_path"),
                        "caption": item.get("caption") or attr_payload.get("caption", ""),
                        "indexed_at": datetime.now(timezone.utc).isoformat()
                    }
                )
            )

        # Commit SQLite transactions
        db.commit()

        # Upsert into local Qdrant collection
        if points:
            self.client.upsert(
                collection_name=COLLECTION_NAME,
                wait=True,
                points=points
            )

        logger.info(f"Indexed video {video_id}: Saved {indexed_count} tracklets to SQLite & Qdrant.")
        return {"indexed": indexed_count, "status": "success"}

    def delete_video_tracklets(self, video_id: str, db: Session) -> None:
        """Deletes tracklet vectors from Qdrant and tracklets from SQLite database."""
        tracklets = db.query(Tracklet).filter(Tracklet.video_id == video_id).all()
        point_ids = [t.qdrant_point_id for t in tracklets if t.qdrant_point_id]
        if point_ids:
            try:
                from qdrant_client.models import PointIdsList
                self.client.delete(
                    collection_name=COLLECTION_NAME,
                    points_selector=PointIdsList(points=point_ids)
                )
                logger.info(f"Deleted {len(point_ids)} points from Qdrant collection '{COLLECTION_NAME}' for video {video_id}")
            except Exception as e:
                logger.error(f"Failed to delete points from Qdrant: {e}")
        
        db.query(Tracklet).filter(Tracklet.video_id == video_id).delete()
        db.commit()
