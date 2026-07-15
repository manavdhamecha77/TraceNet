import json
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class CameraProfile(Base):
    __tablename__ = "cameras"

    camera_id = Column(String, primary_key=True, index=True)  # PK, e.g. "CAM_042"
    name = Column(String, nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    corridor_group = Column(String, nullable=True)
    adjacency = Column(Text, default="[]")  # JSON string of neighboring camera IDs
    is_active = Column(Boolean, default=True)

    videos = relationship("VideoAsset", back_populates="camera", cascade="all, delete-orphan")

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
    processing_status = Column(String, default="pending")  # 'pending' | 'processing' | 'complete' | 'failed'
    
    # Metadata and properties
    duration = Column(Float, nullable=True)  # In seconds
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    thumbnail_path = Column(String, nullable=True)

    camera = relationship("CameraProfile", back_populates="videos")

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
            "duration": self.duration,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "thumbnail_path": self.thumbnail_path
        }
