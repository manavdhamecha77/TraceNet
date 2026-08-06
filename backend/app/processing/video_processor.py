"""
Real-time video processing pipeline for assault detection.
Processes videos asynchronously with progress tracking and result persistence.
"""

import asyncio
import os
import threading
from typing import Callable, Optional, Dict, Any
from datetime import datetime
from loguru import logger
from enum import Enum

from app.db.session import SessionLocal
from app.db.models import VideoAsset, Alert
from app.detection.assault_detector import get_assault_detector
from app.notifications import get_webhook_manager
from app.config import get_data_path


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoProcessor:
    """
    Real-time video processing pipeline with progress tracking.
    Handles assault detection and alert creation asynchronously.
    """

    def __init__(self, max_workers: int = 2):
        self.max_workers = max_workers
        self.processing_queue = asyncio.Queue()
        self.active_jobs: Dict[str, Dict[str, Any]] = {}
        self.detector = None
        self.processing_lock = threading.Lock()

    def initialize(self):
        """Initialize the processor."""
        try:
            self.detector = get_assault_detector()
            logger.info(f"VideoProcessor initialized with {self.max_workers} workers")
        except Exception as e:
            logger.error(f"Failed to initialize VideoProcessor: {e}")

    def add_video(
        self,
        video_id: str,
        camera_id: str,
        video_path: str,
        priority: int = 0
    ) -> bool:
        """
        Add video to processing queue.

        Args:
            video_id: Unique video identifier
            camera_id: Camera that recorded the video
            video_path: Path to video file
            priority: Higher = process earlier (default 0)

        Returns:
            True if added successfully
        """
        if video_id in self.active_jobs:
            logger.warning(f"Video {video_id} already in processing queue")
            return False

        try:
            with self.processing_lock:
                self.active_jobs[video_id] = {
                    "status": ProcessingStatus.PENDING,
                    "camera_id": camera_id,
                    "video_path": video_path,
                    "progress": 0.0,
                    "created_at": datetime.utcnow(),
                    "result": None,
                    "error": None
                }
            logger.info(f"Added video {video_id} to processing queue")
            return True
        except Exception as e:
            logger.error(f"Error adding video to queue: {e}")
            return False

    def process_video(self, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Process a single video for assault detection.

        Returns:
            Detection result or None if failed
        """
        if video_id not in self.active_jobs:
            logger.error(f"Video {video_id} not found in queue")
            return None

        job = self.active_jobs[video_id]

        try:
            with self.processing_lock:
                job["status"] = ProcessingStatus.PROCESSING
                job["progress"] = 0.1

            logger.info(f"Starting assault detection for {video_id}")

            # Load detector if needed
            if self.detector is None:
                self.initialize()

            # Run detection
            video_path = job["video_path"]
            if not os.path.exists(video_path):
                raise FileNotFoundError(f"Video file not found: {video_path}")

            with self.processing_lock:
                job["progress"] = 0.3

            # Perform assault detection
            detection_result = self.detector.predict(video_path)

            with self.processing_lock:
                job["progress"] = 0.7

            # Create alert if assault detected
            alert_id = None
            if detection_result.get("has_assault", False):
                try:
                    db = SessionLocal()
                    alert = Alert(
                        alert_type="assault",
                        camera_id=job["camera_id"],
                        tracklet_id=video_id,
                        timestamp=datetime.utcnow()
                    )
                    db.add(alert)
                    db.commit()
                    alert_id = alert.id
                    db.close()
                    logger.info(f"Assault alert created for {video_id}: ID={alert_id}")

                    # Trigger webhooks for assault detection
                    webhook_manager = get_webhook_manager()
                    confidence = detection_result.get("confidence", 0.0)
                    assault_type = detection_result.get("assault_type", "unknown")
                    webhook_manager.trigger_webhooks(
                        alert_type="assault",
                        camera_id=job["camera_id"],
                        video_id=video_id,
                        assault_type=assault_type,
                        confidence=confidence,
                        timestamp=datetime.utcnow().isoformat(),
                        alert_id=alert_id
                    )
                except Exception as e:
                    logger.error(f"Failed to create assault alert: {e}")

            with self.processing_lock:
                job["progress"] = 1.0
                job["status"] = ProcessingStatus.COMPLETED
                job["result"] = {
                    "has_assault": detection_result.get("has_assault", False),
                    "assault_type": detection_result.get("assault_type", "unknown"),
                    "confidence": detection_result.get("confidence", 0.0),
                    "alert_id": alert_id,
                    "all_predictions": detection_result.get("all_predictions", {})
                }

            logger.info(f"Completed processing for {video_id}")
            return job["result"]

        except Exception as e:
            logger.error(f"Error processing video {video_id}: {e}")
            with self.processing_lock:
                job["status"] = ProcessingStatus.FAILED
                job["error"] = str(e)
            return None

    def get_job_status(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Get current status of a processing job."""
        if video_id not in self.active_jobs:
            return None

        with self.processing_lock:
            job = self.active_jobs[video_id]
            return {
                "video_id": video_id,
                "status": job["status"].value,
                "progress": job["progress"],
                "result": job["result"],
                "error": job["error"],
                "created_at": job["created_at"].isoformat()
            }

    def get_all_jobs(self) -> Dict[str, Dict[str, Any]]:
        """Get all processing jobs with their status."""
        with self.processing_lock:
            return {
                vid: {
                    "status": job["status"].value,
                    "progress": job["progress"],
                    "created_at": job["created_at"].isoformat()
                }
                for vid, job in self.active_jobs.items()
            }

    def clear_completed(self):
        """Remove completed jobs from memory."""
        with self.processing_lock:
            to_remove = [
                vid for vid, job in self.active_jobs.items()
                if job["status"] in [ProcessingStatus.COMPLETED, ProcessingStatus.FAILED]
            ]
            for vid in to_remove:
                del self.active_jobs[vid]
            logger.info(f"Cleared {len(to_remove)} completed jobs")


# Global instance
_processor = None


def get_video_processor() -> VideoProcessor:
    """Get or create global video processor instance."""
    global _processor
    if _processor is None:
        _processor = VideoProcessor()
        _processor.initialize()
    return _processor
