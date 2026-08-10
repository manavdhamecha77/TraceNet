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
    category = Column(String, default="general")  # 'general' | 'theft' | 'abandoned' | 'assault'
    is_default = Column(Boolean, default=False)
    last_used_timestamp = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    cameras = relationship("CameraProfile", foreign_keys="[CameraProfile.model_id]", back_populates="assigned_model")
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
            "category": self.category or "general",
            "is_default": bool(self.is_default),
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
    participate_in_alerts = Column(Boolean, default=True)
    model_id = Column(String, ForeignKey("models.id"), nullable=True)
    theft_model_id = Column(String, ForeignKey("models.id"), nullable=True)
    abandoned_model_id = Column(String, ForeignKey("models.id"), nullable=True)
    assault_model_id = Column(String, ForeignKey("models.id"), nullable=True)
    is_streaming = Column(Boolean, default=False)
    stream_key = Column(String, nullable=True)
    stream_auth_token = Column(String, nullable=True)
    stream_token_expires_at = Column(DateTime, nullable=True)
    stream_started_at = Column(DateTime, nullable=True)

    videos = relationship("VideoAsset", back_populates="camera", cascade="all, delete-orphan")
    assigned_model = relationship("MLModel", foreign_keys=[model_id], back_populates="cameras")

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
            "participate_in_alerts": self.participate_in_alerts,
            "model_id": self.model_id,
            "theft_model_id": self.theft_model_id,
            "abandoned_model_id": self.abandoned_model_id,
            "assault_model_id": self.assault_model_id,
            "video_count": len(self.videos) if self.videos else 0,
            "is_streaming": self.is_streaming,
            "stream_key": self.stream_key,
            "stream_auth_token": self.stream_auth_token,
            "stream_token_expires_at": self.stream_token_expires_at.isoformat() if self.stream_token_expires_at else None,
            "stream_started_at": self.stream_started_at.isoformat() if self.stream_started_at else None
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
    
    is_bin = Column(Boolean, default=False)
    
    # Metadata and properties
    duration = Column(Float, nullable=True)  # In seconds
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    thumbnail_path = Column(String, nullable=True)

    camera = relationship("CameraProfile", back_populates="videos")
    execution_logs = relationship("ModelExecutionLog", back_populates="video", cascade="all, delete-orphan")
    loitering_zones = relationship("LoiteringZone", back_populates="video", cascade="all, delete-orphan")

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
            "thumbnail_path": self.thumbnail_path,
            "is_bin": self.is_bin
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
    attributes = Column(Text, nullable=True)  # JSON string of BLIP attributes, e.g. {"caption": "..."}
    qdrant_point_id = Column(String, nullable=True)  # UUID string stored in Qdrant
    embedding_dim = Column(Integer, default=512)
    indexed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    video = relationship("VideoAsset", backref="tracklets")

    def to_dict(self):
        try:
            bbox = json.loads(self.best_bbox) if self.best_bbox else []
        except Exception:
            bbox = []

        try:
            attr_dict = json.loads(self.attributes) if self.attributes else {}
        except Exception:
            attr_dict = {}

        crop_path = self.best_crop_path or ""
        normalized = crop_path.replace("\\", "/")
        crop_url = ""
        data_index = normalized.find("/data/")
        if data_index != -1:
            crop_url = normalized[data_index:]
        elif normalized:
            crop_url = f"/data/{normalized.lstrip('/')}"

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
            "best_crop_path": crop_url,
            "attributes": attr_dict,
            "caption": attr_dict.get("caption", ""),
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
    video_id = Column(String, nullable=True)                   # video where abandonment was detected
    object_tracklet_id = Column(String, nullable=True)          # the abandoned object's tracklet_id
    owner_tracklet_ids = Column(Text, default="[]")             # JSON list of owner tracklet IDs
    visitor_tracklet_ids = Column(Text, default="[]")           # JSON list of visitor tracklet IDs
    reid_match_tracklet_id = Column(String, nullable=True)      # tracklet_id if owner re-ID matched
    abandon_duration_seconds = Column(Float, nullable=True)     # time abandoned before alert
    analysis_log = Column(Text, nullable=True)                  # JSON string with analysis notes
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(String, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)

    tracklet = relationship("Tracklet")

    def to_dict(self):
        try:
            owners = json.loads(self.owner_tracklet_ids) if self.owner_tracklet_ids else []
        except Exception:
            owners = []
        try:
            visitors = json.loads(self.visitor_tracklet_ids) if self.visitor_tracklet_ids else []
        except Exception:
            visitors = []
            
        return {
            "id": self.id,
            "alert_type": self.alert_type,
            "tracklet_id": self.tracklet_id,
            "camera_id": self.camera_id,
            "video_id": self.video_id,
            "object_tracklet_id": self.object_tracklet_id,
            "owner_tracklet_ids": owners,
            "visitor_tracklet_ids": visitors,
            "reid_match_tracklet_id": self.reid_match_tracklet_id,
            "abandon_duration_seconds": self.abandon_duration_seconds,
            "analysis_log": self.analysis_log,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "acknowledged": self.acknowledged,
            "acknowledged_by": self.acknowledged_by,
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
        }


class LoiteringZone(Base):
    """A user-drawn, video-scoped region of interest for dwell-time review."""
    __tablename__ = "loitering_zones"

    id = Column(String, primary_key=True, index=True)
    video_id = Column(String, ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False, default="Loitering zone")
    polygon_points = Column(Text, default="[]")  # normalized [{"x": 0..1, "y": 0..1}]
    threshold_seconds = Column(Float, nullable=False, default=60.0)
    grace_seconds = Column(Float, nullable=False, default=3.0)
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    video = relationship("VideoAsset", back_populates="loitering_zones")

    def to_dict(self):
        try:
            polygon = json.loads(self.polygon_points) if self.polygon_points else []
        except Exception:
            polygon = []
        return {
            "id": self.id,
            "video_id": self.video_id,
            "name": self.name,
            "polygon_points": polygon,
            "threshold_seconds": self.threshold_seconds,
            "grace_seconds": self.grace_seconds,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, index=True)  # UUID string
    title = Column(String, nullable=False, default="New Conversation")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    messages = Column(Text, default="[]")  # JSON array string

    def to_dict(self):
        try:
            msgs = json.loads(self.messages) if self.messages else []
        except Exception:
            msgs = []
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "message_count": len(msgs),
            "messages": msgs
        }


class Webhook(Base):
    __tablename__ = "webhooks"

    id = Column(String, primary_key=True, index=True)
    url = Column(String, nullable=False)
    webhook_type = Column(String, nullable=False)  # 'assault' | 'all_alerts'
    is_active = Column(Boolean, default=True)
    confidence_threshold = Column(Float, default=0.6)  # Only trigger for assaults above this confidence
    camera_ids = Column(Text, default="[]")  # JSON list of camera IDs to filter on
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    last_triggered_at = Column(DateTime, nullable=True)
    delivery_count = Column(Integer, default=0)

    def to_dict(self):
        try:
            cameras = json.loads(self.camera_ids) if self.camera_ids else []
        except Exception:
            cameras = []
        return {
            "id": self.id,
            "url": self.url,
            "webhook_type": self.webhook_type,
            "is_active": self.is_active,
            "confidence_threshold": self.confidence_threshold,
            "camera_ids": cameras,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_triggered_at": self.last_triggered_at.isoformat() if self.last_triggered_at else None,
            "delivery_count": self.delivery_count,
        }


class SentinelSession(Base):
    __tablename__ = "sentinel_sessions"

    id = Column(String, primary_key=True, index=True)  # UUID string
    target_tracklet_id = Column(String, ForeignKey("tracklets.id", ondelete="CASCADE"), nullable=True)
    target_embedding = Column(Text, nullable=True)      # JSON array string (512-dim)
    status = Column(String, default="active")          # 'active' | 'matched' | 'expired' | 'terminated'
    origin_camera_id = Column(String, ForeignKey("cameras.camera_id"), nullable=False)
    speed_mode = Column(String, default="pedestrian")  # 'pedestrian' | 'vehicle'
    downstream_nodes = Column(Text, default="[]")       # JSON string of active camera IDs + ETAs
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    matched_camera_id = Column(String, nullable=True)
    matched_tracklet_id = Column(String, nullable=True)

    def to_dict(self):
        try:
            nodes = json.loads(self.downstream_nodes) if self.downstream_nodes else []
        except Exception:
            nodes = []
        return {
            "id": self.id,
            "target_tracklet_id": self.target_tracklet_id,
            "status": self.status,
            "origin_camera_id": self.origin_camera_id,
            "speed_mode": self.speed_mode,
            "downstream_nodes": nodes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "matched_camera_id": self.matched_camera_id,
            "matched_tracklet_id": self.matched_tracklet_id
        }


class HotTarget(Base):
    __tablename__ = "hot_targets"

    id = Column(String, primary_key=True, index=True)  # target-uuid
    label = Column(String, nullable=False)              # e.g., 'Suspect Vehicle #VEC-09'
    object_type = Column(String, default="person")      # 'person' | 'vehicle'
    origin_tracklet_id = Column(String, ForeignKey("tracklets.id", ondelete="SET NULL"), nullable=True)
    origin_camera_id = Column(String, ForeignKey("cameras.camera_id"), nullable=False)
    embedding_vector = Column(Text, nullable=False)     # JSON array string (512-dim)
    status = Column(String, default="active")          # 'active' | 'resolved' | 'archived'
    priority = Column(String, default="HIGH")           # 'NORMAL' | 'HIGH' | 'CRITICAL'
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen_camera_id = Column(String, nullable=True)
    last_seen_timestamp = Column(DateTime, nullable=True)
    matches_count = Column(Integer, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "object_type": self.object_type,
            "origin_tracklet_id": self.origin_tracklet_id,
            "origin_camera_id": self.origin_camera_id,
            "status": self.status,
            "priority": self.priority,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_seen_camera_id": self.last_seen_camera_id,
            "last_seen_timestamp": self.last_seen_timestamp.isoformat() if self.last_seen_timestamp else None,
            "matches_count": self.matches_count
        }


class SystemJob(Base):
    __tablename__ = "system_jobs"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    job_type = Column(String, nullable=False)  # 'reindex' | 'vectordb' | 'upload' | 'model_run' | 'alerts' | 'other'
    status = Column(String, default="pending")  # 'pending' | 'running' | 'completed' | 'failed'
    progress = Column(Float, default=0.0)
    payload = Column(Text, default="{}")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        try:
            extra = json.loads(self.payload) if self.payload else {}
        except Exception:
            extra = {}
        return {
            "id": self.id,
            "name": self.name,
            "job_type": self.job_type,
            "status": self.status,
            "progress": self.progress,
            "payload": extra,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LiveStreamSession(Base):
    __tablename__ = "live_stream_sessions"
    id = Column(String, primary_key=True, index=True)
    camera_id = Column(String, ForeignKey("cameras.camera_id"), nullable=False)
    status = Column(String, default="active")  # active | ended | error
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime, nullable=True)
    total_duration_sec = Column(Float, nullable=True)
    chunks_recorded = Column(Integer, default=0)
    alerts_generated = Column(Integer, default=0)
    inference_model_id = Column(String, nullable=True)
    stream_config = Column(Text, default="{}")
    
    def to_dict(self):
        try:
            config_dict = json.loads(self.stream_config) if self.stream_config else {}
        except Exception:
            config_dict = {}
        return {
            "id": self.id,
            "camera_id": self.camera_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "total_duration_sec": self.total_duration_sec,
            "chunks_recorded": self.chunks_recorded,
            "alerts_generated": self.alerts_generated,
            "inference_model_id": self.inference_model_id,
            "stream_config": config_dict
        }


class StreamChunk(Base):
    __tablename__ = "stream_chunks"
    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("live_stream_sessions.id"), nullable=False)
    camera_id = Column(String, nullable=False)
    chunk_index = Column(Integer, default=0)
    file_path = Column(String, nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    duration_sec = Column(Float, nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    imported_as_video_id = Column(String, nullable=True)
    
    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "camera_id": self.camera_id,
            "chunk_index": self.chunk_index,
            "file_path": self.file_path,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration_sec": self.duration_sec,
            "file_size_bytes": self.file_size_bytes,
            "imported_as_video_id": self.imported_as_video_id
        }


class LiveAlert(Base):
    __tablename__ = "live_alerts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_type = Column(String, nullable=False)
    camera_id = Column(String, nullable=False)
    session_id = Column(String, ForeignKey("live_stream_sessions.id"), nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged = Column(Boolean, default=False)
    
    def to_dict(self):
        return {
            "id": self.id,
            "alert_type": self.alert_type,
            "camera_id": self.camera_id,
            "session_id": self.session_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "acknowledged": self.acknowledged
        }


class PairCode(Base):
    __tablename__ = "pair_codes"
    id = Column(String, primary_key=True, index=True)       # e.g. '482910'
    camera_id = Column(String, ForeignKey("cameras.camera_id"), nullable=False)
    code_display = Column(String, nullable=False)           # e.g. '482-910'
    device_label = Column(String, nullable=True)            # optional label set on verify
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    device_auth_token = Column(String, nullable=True)       # issued on verify

    def to_dict(self):
        return {
            "id": self.id,
            "camera_id": self.camera_id,
            "code_display": self.code_display,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "used": self.used,
        }
