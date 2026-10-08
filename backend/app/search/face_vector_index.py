from __future__ import annotations

import os
import json
import uuid
from datetime import datetime, timezone
from loguru import logger
from sqlalchemy.orm import Session
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from app.config import get_data_path
from app.db.models import FaceTracklet, VideoAsset
from app.search.vector_index import get_qdrant_client
from app.embeddings.face_encoder import get_face_embedder, get_active_backend

COLLECTION_NAME = "tracenet_faces"
_face_vector_index_instance: FaceVectorIndexService | None = None


def get_face_vector_index() -> FaceVectorIndexService:
    global _face_vector_index_instance
    if _face_vector_index_instance is None:
        _face_vector_index_instance = FaceVectorIndexService()
    return _face_vector_index_instance


class FaceVectorIndexService:
    def __init__(self, target_dim: int = 512) -> None:
        self.client = get_qdrant_client()
        self.target_dim = target_dim
        self._ensure_collection()

    def get_vector_by_point_id(self, point_id: str) -> list[float] | None:
        try:
            records = self.client.retrieve(
                collection_name=COLLECTION_NAME,
                ids=[point_id],
                with_vectors=True
            )
            if records and len(records) > 0 and records[0].vector is not None:
                return list(records[0].vector)
        except Exception as e:
            logger.error(f"Failed to retrieve vector for point_id {point_id}: {e}")
        return None

    def search_similar(
        self,
        query_vector: list[float],
        top_k: int = 50,
        score_threshold: float = 0.20
    ) -> list[dict]:
        try:
            res = self.client.query_points(
                collection_name=COLLECTION_NAME,
                query=query_vector,
                limit=top_k,
                score_threshold=score_threshold
            )
            return [
                {
                    "point_id": pt.id,
                    "score": float(pt.score),
                    "payload": pt.payload or {}
                }
                for pt in res.points
            ]
        except Exception as e:
            logger.error(f"Failed to query Qdrant face points: {e}")
            return []

    def _ensure_collection(self) -> None:
        try:
            if self.client.collection_exists(COLLECTION_NAME):
                info = self.client.get_collection(COLLECTION_NAME)
                existing_dim = info.config.params.vectors.size
                if existing_dim != self.target_dim:
                    logger.warning(
                        f"Qdrant face collection '{COLLECTION_NAME}' dimension ({existing_dim}) "
                        f"does not match active dimension ({self.target_dim}). Recreating collection."
                    )
                    self.recreate_collection(self.target_dim)
            else:
                logger.info(f"Creating Qdrant face collection '{COLLECTION_NAME}' (dim={self.target_dim})")
                self.client.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=VectorParams(
                        size=self.target_dim,
                        distance=Distance.COSINE
                    )
                )
        except Exception as e:
            logger.error(f"Failed to initialize Qdrant face collection: {e}")

    def recreate_collection(self, new_dim: int | None = None) -> None:
        if new_dim is not None:
            self.target_dim = new_dim
        try:
            if self.client.collection_exists(COLLECTION_NAME):
                try:
                    if hasattr(self.client, "_client") and hasattr(self.client._client, "collections"):
                        coll = self.client._client.collections.get(COLLECTION_NAME)
                        if coll and hasattr(coll, "storage") and coll.storage and hasattr(coll.storage, "storage"):
                            coll.storage.storage.close()
                except Exception as close_err:
                    logger.debug(f"Closing collection storage handle: {close_err}")

                self.client.delete_collection(COLLECTION_NAME)

            self.client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(
                    size=self.target_dim,
                    distance=Distance.COSINE
                )
            )
            logger.info(f"Recreated Qdrant collection '{COLLECTION_NAME}' with dimension {self.target_dim}.")
        except Exception as e:
            logger.error(f"Failed to recreate Qdrant face collection: {e}")

    def index_video_faces(self, video_id: str, db: Session) -> dict:
        faces_path = get_data_path(os.path.join("processed/faces", video_id, "faces.json"))
        if not os.path.exists(faces_path):
            raise FileNotFoundError(f"Faces artifact not found at '{faces_path}'")

        with open(faces_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)

        tracklet_items = payload.get("face_tracklets", [])
        if not tracklet_items:
            logger.info(f"No face tracklets to index for video {video_id}")
            return {"indexed": 0, "status": "no_tracklets"}

        video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
        if not video:
            raise ValueError(f"Video Asset {video_id} does not exist in SQLite database.")

        embedder = get_face_embedder()
        active_backend = get_active_backend()
        
        points = []
        indexed_count = 0

        for item in tracklet_items:
            tracklet_id = item.get("tracklet_id")
            if not tracklet_id:
                continue

            best_crop_path = item.get("best_crop_path")
            if not best_crop_path or not os.path.exists(best_crop_path):
                continue

            try:
                embedding = embedder.embed_face_crop(best_crop_path)
            except Exception as e:
                logger.error(f"Failed to embed face crop {best_crop_path}: {e}")
                continue

            point_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, tracklet_id))
            previous = db.query(FaceTracklet).filter(FaceTracklet.id == tracklet_id).first()
            existing_label = previous.label if previous else None
            if previous:
                db.delete(previous)
                db.flush()

            db_tracklet = FaceTracklet(
                id=tracklet_id,
                video_id=video_id,
                tracker_id=item.get("tracker_id", 0),
                camera_id=video.camera_id,
                frame_start=item.get("frame_start", 0),
                frame_end=item.get("frame_end", 0),
                timestamp_start_seconds=item.get("timestamp_start_seconds", 0.0),
                timestamp_end_seconds=item.get("timestamp_end_seconds", 0.0),
                detection_count=item.get("detection_count", 1),
                mean_confidence=item.get("mean_confidence", 0.0),
                best_bbox=json.dumps(item.get("best_bbox", [0.0, 0.0, 0.0, 0.0])),
                best_crop_path=best_crop_path,
                label=existing_label,
                qdrant_point_id=point_uuid,
                embedding_dim=len(embedding),
                embedding_backend=active_backend,
                indexed_at=datetime.now(timezone.utc),
            )
            db.add(db_tracklet)
            indexed_count += 1

            points.append(
                PointStruct(
                    id=point_uuid,
                    vector=embedding,
                    payload={
                        "face_tracklet_id": tracklet_id,
                        "video_id": video_id,
                        "camera_id": video.camera_id,
                        "timestamp_start_seconds": item.get("timestamp_start_seconds", 0.0),
                        "frame_start": item.get("frame_start", 0),
                        "label": existing_label,
                    }
                )
            )

        db.commit()

        if points:
            self.client.upsert(
                collection_name=COLLECTION_NAME,
                wait=True,
                points=points
            )

        logger.info(f"Indexed faces for video {video_id}: Saved {indexed_count} faces to SQLite & Qdrant.")
        return {"indexed": indexed_count, "status": "success"}

    def upsert_face_tracklet(self, face_tracklet: FaceTracklet, db: Session) -> None:
        if face_tracklet.qdrant_point_id:
            payload = {
                "face_tracklet_id": face_tracklet.id,
                "video_id": face_tracklet.video_id,
                "camera_id": face_tracklet.camera_id,
                "timestamp_start_seconds": face_tracklet.timestamp_start_seconds,
                "frame_start": face_tracklet.frame_start,
                "label": face_tracklet.label,
            }
            try:
                self.client.set_payload(
                    collection_name=COLLECTION_NAME,
                    payload=payload,
                    points=[face_tracklet.qdrant_point_id]
                )
            except Exception as e:
                logger.error(f"Failed to update Qdrant payload for face tracklet {face_tracklet.id}: {e}")
