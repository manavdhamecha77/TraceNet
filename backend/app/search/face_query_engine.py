import os
import tempfile
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import UploadFile

from app.db.models import FaceTracklet
from app.embeddings.face_encoder import get_face_embedder, get_active_backend
from app.search.face_vector_index import get_face_vector_index


class FaceQueryEngine:
    def __init__(self):
        self.embedder = get_face_embedder()
        self.index = get_face_vector_index()

    def _enrich_results(self, points: list[dict], db: Session) -> list[dict]:
        enriched = []
        for p in points:
            payload = p.get("payload", {})
            face_tracklet_id = payload.get("face_tracklet_id")
            if not face_tracklet_id:
                continue
            
            db_tracklet = db.query(FaceTracklet).filter(FaceTracklet.id == face_tracklet_id).first()
            if db_tracklet:
                res = db_tracklet.to_dict()
                res["score"] = p.get("score", 0.0)
                enriched.append(res)
        return enriched

    def _filter_by_camera_and_video(self, results: list[dict], camera_ids: Optional[list[str]], video_id: Optional[str]) -> list[dict]:
        filtered = []
        for r in results:
            if camera_ids and r.get("camera_id") not in camera_ids:
                continue
            if video_id and r.get("video_id") != video_id:
                continue
            filtered.append(r)
        return filtered

    def search_by_text(
        self, query: str, db: Session, top_k: int = 50, camera_ids: Optional[list[str]] = None, video_id: Optional[str] = None
    ) -> list[dict]:
        if get_active_backend() == "facenet":
            # Facenet doesn't do text-to-image
            return []
            
        vector = self.embedder.embed_text_query(query)
        points = self.index.search_similar(vector, top_k=top_k * 2) # get more to filter
        enriched = self._enrich_results(points, db)
        filtered = self._filter_by_camera_and_video(enriched, camera_ids, video_id)
        
        # Sort by score descending and take top_k
        filtered.sort(key=lambda x: x.get("score", 0.0), reverse=True)
        return filtered[:top_k]

    def search_by_image(
        self, file: UploadFile, db: Session, top_k: int = 50, camera_ids: Optional[list[str]] = None
    ) -> list[dict]:
        fd, temp_path = tempfile.mkstemp(suffix=".jpg")
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(file.file.read())
            
            vector = self.embedder.embed_face_crop(temp_path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

        points = self.index.search_similar(vector, top_k=top_k * 2)
        enriched = self._enrich_results(points, db)
        filtered = self._filter_by_camera_and_video(enriched, camera_ids, None)
        filtered.sort(key=lambda x: x.get("score", 0.0), reverse=True)
        return filtered[:top_k]

    def search_by_label(
        self, label: str, db: Session, top_k: int = 50, camera_ids: Optional[list[str]] = None
    ) -> list[dict]:
        query = db.query(FaceTracklet).filter(FaceTracklet.label.like(f"%{label}%"))
        if camera_ids:
            query = query.filter(FaceTracklet.camera_id.in_(camera_ids))
            
        tracklets = query.limit(top_k).all()
        return [t.to_dict() for t in tracklets]
