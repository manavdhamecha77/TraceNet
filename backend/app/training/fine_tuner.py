"""
Model fine-tuning infrastructure for assault detection model.
Supports training on local datasets to improve detection accuracy.
"""

import os
import json
import uuid
import shutil
import threading
from datetime import datetime
from typing import List, Optional, Dict, Any
from enum import Enum
from loguru import logger

import torch
from transformers import AutoImageProcessor, TimesformerForVideoClassification, Trainer, TrainingArguments
from torch.utils.data import Dataset, DataLoader
import numpy as np
import cv2
from PIL import Image

from app.db.session import SessionLocal
from app.db.models import Alert, VideoAsset
from app.config import get_data_path


class TrainingStatus(str, Enum):
    IDLE = "idle"
    PREPARING = "preparing"
    TRAINING = "training"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"


class AssaultVideoDataset(Dataset):
    """Dataset for fine-tuning on assault detection videos."""

    def __init__(
        self,
        video_ids: List[str],
        labels: List[int],
        processor,
        num_frames: int = 8
    ):
        self.video_ids = video_ids
        self.labels = labels
        self.processor = processor
        self.num_frames = num_frames

    def __len__(self):
        return len(self.video_ids)

    def __getitem__(self, idx):
        video_id = self.video_ids[idx]
        label = self.labels[idx]

        db = SessionLocal()
        video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
        db.close()

        if not video or not os.path.exists(video.standardized_filename):
            # Return dummy data if video not found
            frames = [np.zeros((224, 224, 3), dtype=np.uint8)] * self.num_frames
        else:
            frames = self._extract_frames(video.standardized_filename)

        inputs = self.processor(
            images=frames,
            return_tensors="pt"
        )

        return {
            "pixel_values": inputs["pixel_values"].squeeze(0),
            "labels": torch.tensor(label, dtype=torch.long)
        }

    def _extract_frames(self, video_path: str) -> List[np.ndarray]:
        """Extract frames from video."""
        try:
            cap = cv2.VideoCapture(video_path)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_indices = np.linspace(0, total_frames - 1, self.num_frames, dtype=int)

            frames = []
            for idx in frame_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if ret:
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    frame = cv2.resize(frame, (224, 224))
                    frames.append(frame)
                else:
                    frames.append(np.zeros((224, 224, 3), dtype=np.uint8))

            cap.release()
            return frames
        except Exception as e:
            logger.error(f"Failed to extract frames from {video_path}: {e}")
            return [np.zeros((224, 224, 3), dtype=np.uint8)] * self.num_frames


class FineTuner:
    """
    Fine-tuning manager for assault detection model.
    Trains on local datasets to improve accuracy for specific scenarios.
    """

    def __init__(self, base_model: str = "OPear/videomae-large-finetuned-UCF-Crime"):
        self.base_model = base_model
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.training_status = TrainingStatus.IDLE
        self.current_training_id = None
        self.training_lock = threading.Lock()
        self.training_history: Dict[str, Dict[str, Any]] = {}

    def prepare_dataset(
        self,
        camera_id: Optional[str] = None,
        days: int = 30,
        min_confidence: float = 0.3
    ) -> tuple:
        """
        Prepare training dataset from assault alerts.

        Returns:
            (video_ids, labels) for training
        """
        try:
            db = SessionLocal()
            query = db.query(Alert).filter(Alert.alert_type == "assault")

            if camera_id:
                query = query.filter(Alert.camera_id == camera_id)

            # Get recent alerts
            cutoff_date = datetime.utcnow()
            from datetime import timedelta
            cutoff_date = cutoff_date - timedelta(days=days)
            query = query.filter(Alert.timestamp >= cutoff_date)

            alerts = query.all()
            db.close()

            video_ids = []
            labels = []

            for alert in alerts:
                if not alert.video_id:
                    continue

                # Label: 1 for assault, 0 for normal
                # We'll use acknowledged as proxy: acknowledged=True means it was confirmed
                label = 1 if alert.acknowledged else 1  # All are assaults since they're in alerts table

                # Check if video exists
                db = SessionLocal()
                video = db.query(VideoAsset).filter(VideoAsset.id == alert.video_id).first()
                db.close()

                if video and os.path.exists(video.standardized_filename):
                    video_ids.append(alert.video_id)
                    labels.append(label)

            logger.info(f"Prepared dataset: {len(video_ids)} assault videos")
            return video_ids, labels

        except Exception as e:
            logger.error(f"Failed to prepare dataset: {e}")
            return [], []

    def start_training(
        self,
        camera_id: Optional[str] = None,
        learning_rate: float = 2e-5,
        num_epochs: int = 3,
        batch_size: int = 2
    ) -> str:
        """
        Start fine-tuning job.

        Returns:
            Training job ID
        """
        with self.training_lock:
            if self.training_status != TrainingStatus.IDLE:
                raise RuntimeError("Training already in progress")

            training_id = str(uuid.uuid4())
            self.current_training_id = training_id
            self.training_status = TrainingStatus.PREPARING

        # Start training in background thread
        thread = threading.Thread(
            target=self._train_async,
            args=(training_id, camera_id, learning_rate, num_epochs, batch_size),
            daemon=True
        )
        thread.start()

        return training_id

    def _train_async(
        self,
        training_id: str,
        camera_id: Optional[str],
        learning_rate: float,
        num_epochs: int,
        batch_size: int
    ):
        """Internal async training loop."""
        start_time = datetime.utcnow()
        try:
            # Prepare dataset
            logger.info(f"[{training_id}] Preparing dataset...")
            with self.training_lock:
                self.training_status = TrainingStatus.PREPARING
            video_ids, labels = self.prepare_dataset(camera_id=camera_id)

            if len(video_ids) < 2:
                raise ValueError("Not enough training data (minimum 2 videos required)")

            # Load model and processor
            logger.info(f"[{training_id}] Loading model...")
            processor = AutoImageProcessor.from_pretrained(self.base_model)
            model = TimesformerForVideoClassification.from_pretrained(
                self.base_model
            ).to(self.device)

            # Create dataset
            dataset = AssaultVideoDataset(video_ids, labels, processor)
            train_loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

            # Training setup
            with self.training_lock:
                self.training_status = TrainingStatus.TRAINING

            optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
            loss_fn = torch.nn.CrossEntropyLoss()

            # Training loop
            logger.info(f"[{training_id}] Starting training for {num_epochs} epochs...")
            total_loss = 0.0
            num_batches = 0

            for epoch in range(num_epochs):
                model.train()
                epoch_loss = 0.0

                for batch_idx, batch in enumerate(train_loader):
                    pixel_values = batch["pixel_values"].to(self.device)
                    labels_batch = batch["labels"].to(self.device)

                    optimizer.zero_grad()
                    outputs = model(pixel_values=pixel_values, labels=labels_batch)
                    loss = outputs.loss

                    loss.backward()
                    optimizer.step()

                    epoch_loss += loss.item()
                    num_batches += 1
                    total_loss += loss.item()

                    if (batch_idx + 1) % 5 == 0:
                        logger.info(
                            f"[{training_id}] Epoch {epoch + 1}/{num_epochs}, "
                            f"Batch {batch_idx + 1}, Loss: {loss.item():.4f}"
                        )

                avg_epoch_loss = epoch_loss / len(train_loader) if train_loader else 0
                logger.info(f"[{training_id}] Epoch {epoch + 1} avg loss: {avg_epoch_loss:.4f}")

            # Save fine-tuned model
            with self.training_lock:
                self.training_status = TrainingStatus.VALIDATING

            model_dir = get_data_path(f"finetuned_models/{training_id}")
            os.makedirs(model_dir, exist_ok=True)
            model.save_pretrained(model_dir)
            processor.save_pretrained(model_dir)

            with self.training_lock:
                self.training_status = TrainingStatus.COMPLETED

            elapsed = (datetime.utcnow() - start_time).total_seconds()
            self.training_history[training_id] = {
                "status": "completed",
                "camera_id": camera_id,
                "num_videos": len(video_ids),
                "avg_loss": total_loss / num_batches if num_batches > 0 else 0,
                "elapsed_seconds": elapsed,
                "model_dir": model_dir,
                "created_at": start_time.isoformat()
            }

            logger.info(f"[{training_id}] Training completed in {elapsed:.1f}s")

        except Exception as e:
            logger.error(f"[{training_id}] Training failed: {e}")
            with self.training_lock:
                self.training_status = TrainingStatus.FAILED
            self.training_history[training_id] = {
                "status": "failed",
                "error": str(e),
                "created_at": start_time.isoformat()
            }

        finally:
            with self.training_lock:
                self.current_training_id = None
                if self.training_status != TrainingStatus.FAILED:
                    self.training_status = TrainingStatus.IDLE

    def get_training_status(self, training_id: str) -> Optional[Dict[str, Any]]:
        """Get training job status."""
        with self.training_lock:
            if training_id == self.current_training_id:
                return {
                    "training_id": training_id,
                    "status": self.training_status.value,
                    "progress": 0.5 if self.training_status in [TrainingStatus.TRAINING] else 1.0
                }
            return self.training_history.get(training_id)

    def get_training_history(self) -> List[Dict[str, Any]]:
        """Get all training jobs."""
        with self.training_lock:
            return list(self.training_history.values())


# Global instance
_fine_tuner = None


def get_fine_tuner() -> FineTuner:
    """Get or create global fine-tuner instance."""
    global _fine_tuner
    if _fine_tuner is None:
        _fine_tuner = FineTuner()
    return _fine_tuner
