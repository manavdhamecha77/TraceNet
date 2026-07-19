import json
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, Text, ForeignKey, Boolean, Integer
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class MLModel(Base):
    __tablename__ = "models"

    id = Column(String, primary_key=True, index=True)  # PK, e.g. UUID
    name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    model_type = Column(String, nullable=False)  # 'YOLOv8' | 'YOLOv11' | 'YOLOv12' | 'RT-DETR' | 'GroundingDino'
    classes = Column(Text, default="[]")  # JSON string of class names
    last_used_timestamp = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    cameras = relationship("CameraProfile", back_populates="assigned_model")
    logs = relationship("ModelExecutionLog", back_populates="model", cascade="all, delete-orphan")

    def to_dict(self):
        try:
            cls_list = json.loads(self.classes) if self.classes else []
        except Exception:
            cls_list = []
        return {
            "id": self.id,
            "name": self.name,
            "file_path": self.file_path,
            "model_type": self.model_type,
            "classes": cls_list,
            "last_used_timestamp": self.last_used_timestamp.isoformat() if self.last_used_timestamp else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class CameraProfile(Base):
    __tablename__ = "cameras"

    camera_id = Column(String, primary_key=True, index=True)  # PK, e.g. "CAM_042"
    name = Column(String, nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    corridor_group = Column(String, nullable=True)
    adjacency = Column(Text, default="[]")  # JSON string of neighboring camera IDs
    is_active = Column(Boolean, default=True)
    status = Column(String, default="active")  # 'active' | 'maintenance' | 'not-working'
    altitude = Column(Float, nullable=True)
    model_id = Column(String, ForeignKey("models.id"), nullable=True)

    videos = relationship("VideoAsset", back_populates="camera", cascade="all, delete-orphan")
    assigned_model = relationship("MLModel", back_populates="cameras")

    def to_dict(self):
        try:
            adj = json.loads(self.adjacency) if self.adjacency else []
        except Exception:
            adj = []
        return {
            "camera_id": self.camera_id,
            "name": self.name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "corridor_group": self.corridor_group,
            "adjacency": adj,
            "is_active": self.is_active,
            "status": self.status,
            "altitude": self.altitude,
            "model_id": self.model_id,
            "video_count": len(self.videos) if self.videos else 0
        }


class VideoAsset(Base):
    __tablename__ = "videos"

    id = Column(String, primary_key=True, index=True)  # PK (asset_id)
    camera_id = Column(String, ForeignKey("cameras.camera_id"), nullable=False)
    original_filename = Column(String, nullable=False)
    standardized_filename = Column(String, nullable=False)
    intake_sha256 = Column(String, nullable=False)
    transcoded_sha256 = Column(String, nullable=True)
    upload_timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    processing_status = Column(String, default="pending")  # 'pending' | 'transcoding' | 'preprocessed' | 'indexing' | 'complete' | 'failed'
    progress_percentage = Column(Integer, default=0)
    
    # Metadata and properties
    duration = Column(Float, nullable=True)  # In seconds
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    thumbnail_path = Column(String, nullable=True)

    camera = relationship("CameraProfile", back_populates="videos")
    execution_logs = relationship("ModelExecutionLog", back_populates="video", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "camera_id": self.camera_id,
            "original_filename": self.original_filename,
            "standardized_filename": self.standardized_filename,
            "intake_sha256": self.intake_sha256,
            "transcoded_sha256": self.transcoded_sha256,
            "upload_timestamp": self.upload_timestamp.isoformat() if self.upload_timestamp else None,
            "processing_status": self.processing_status,
            "progress_percentage": self.progress_percentage or 0,
            "duration": self.duration,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "thumbnail_path": self.thumbnail_path
        }


class ModelExecutionLog(Base):
    __tablename__ = "model_execution_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_id = Column(String, ForeignKey("models.id"), nullable=False)
    video_id = Column(String, ForeignKey("videos.id"), nullable=False)
    camera_id = Column(String, ForeignKey("cameras.camera_id"), nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    frames_processed = Column(Integer, nullable=False)
    inference_duration_seconds = Column(Float, nullable=False)
    objects_detected_count = Column(Integer, nullable=False)

    model = relationship("MLModel", back_populates="logs")
    video = relationship("VideoAsset", back_populates="execution_logs")

    def to_dict(self):
        return {
            "id": self.id,
            "model_id": self.model_id,
            "video_id": self.video_id,
            "camera_id": self.camera_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "frames_processed": self.frames_processed,
            "inference_duration_seconds": self.inference_duration_seconds,
            "objects_detected_count": self.objects_detected_count,
        }


class Tracklet(Base):
    __tablename__ = "tracklets"

    id = Column(String, primary_key=True, index=True)  # "{video_id}_trk_{tracker_id}"
    video_id = Column(String, ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    tracker_id = Column(Integer, nullable=False)
    object_type = Column(String, nullable=False)  # 'person' | 'vehicle'
    class_name = Column(String, nullable=False)
    camera_id = Column(String, nullable=False)
    frame_start = Column(Integer, nullable=False)
    frame_end = Column(Integer, nullable=False)
    timestamp_start_seconds = Column(Float, nullable=False)
    timestamp_end_seconds = Column(Float, nullable=False)
    detection_count = Column(Integer, nullable=False)
    mean_confidence = Column(Float, nullable=False)
    best_bbox = Column(Text, nullable=False)  # JSON string of best bounding box coordinates "[xmin, ymin, xmax, ymax]"
    best_crop_path = Column(String, nullable=True)
    qdrant_point_id = Column(String, nullable=True)  # UUID string stored in Qdrant
    embedding_dim = Column(Integer, default=512)
    indexed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    video = relationship("VideoAsset", backref="tracklets")

    def to_dict(self):
        try:
            bbox = json.loads(self.best_bbox) if self.best_bbox else []
        except Exception:
            bbox = []
        return {
            "id": self.id,
            "video_id": self.video_id,
            "tracker_id": self.tracker_id,
            "object_type": self.object_type,
            "class_name": self.class_name,
            "camera_id": self.camera_id,
            "frame_start": self.frame_start,
            "frame_end": self.frame_end,
            "timestamp_start_seconds": self.timestamp_start_seconds,
            "timestamp_end_seconds": self.timestamp_end_seconds,
            "detection_count": self.detection_count,
            "mean_confidence": self.mean_confidence,
            "best_bbox": bbox,
            "best_crop_path": self.best_crop_path,
            "qdrant_point_id": self.qdrant_point_id,
            "embedding_dim": self.embedding_dim,
            "indexed_at": self.indexed_at.isoformat() if self.indexed_at else None,
        }


class SearchLog(Base):
    __tablename__ = "search_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    query_text = Column(Text, nullable=False)
    user_id = Column(String, default="demo")
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    results_count = Column(Integer, nullable=True)
    camera_filter = Column(Text, nullable=True)  # JSON list of camera IDs
    time_filter_start = Column(DateTime, nullable=True)
    time_filter_end = Column(DateTime, nullable=True)
    clip_export_hash = Column(String, nullable=True)  # SHA-256 hash of results

    def to_dict(self):
        try:
            cams = json.loads(self.camera_filter) if self.camera_filter else []
        except Exception:
            cams = []
        return {
            "id": self.id,
            "query_text": self.query_text,
            "user_id": self.user_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "results_count": self.results_count,
            "camera_filter": cams,
            "time_filter_start": self.time_filter_start.isoformat() if self.time_filter_start else None,
            "time_filter_end": self.time_filter_end.isoformat() if self.time_filter_end else None,
            "clip_export_hash": self.clip_export_hash,
        }


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_type = Column(String, nullable=False)  # 'loitering' | 'abandoned_object'
    tracklet_id = Column(String, ForeignKey("tracklets.id", ondelete="CASCADE"), nullable=False)
    camera_id = Column(String, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged = Column(Boolean, default=False)

    tracklet = relationship("Tracklet")

    def to_dict(self):
        return {
            "id": self.id,
            "alert_type": self.alert_type,
            "tracklet_id": self.tracklet_id,
            "camera_id": self.camera_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "acknowledged": self.acknowledged,
        }

