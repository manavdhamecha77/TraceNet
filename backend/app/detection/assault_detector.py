"""
Assault/Fight Detection module using VideoMAE model from HuggingFace.
Detects fighting, physical aggression, and violent incidents in video frames.
"""

import torch
import numpy as np
from typing import List, Dict, Optional, Tuple
from PIL import Image
import cv2
from loguru import logger

try:
    from transformers import AutoImageProcessor, TimesformerForVideoClassification
except ImportError:
    logger.warning("transformers not installed, assault detection disabled")


class AssaultDetector:
    """
    Detects assault/fight incidents in video frames using VideoMAE model.
    Model: OPear/videomae-large-finetuned-UCF-Crime
    """

    def __init__(self, model_name: str = "OPear/videomae-large-finetuned-UCF-Crime"):
        self.model_name = model_name
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.processor = None
        self.labels = [
            "Normal",
            "Assault",
            "Fighting",
            "Explosion",
            "Robbery",
            "Rape",
            "Arson",
            "Shooting"
        ]
        self.assault_classes = ["Assault", "Fighting", "Shooting", "Robbery", "Rape"]
        self.confidence_threshold = 0.6

    def load_model(self):
        """Download and load the VideoMAE model from HuggingFace."""
        if self.model is not None:
            return

        try:
            logger.info(f"Loading assault detection model: {self.model_name}")
            self.processor = AutoImageProcessor.from_pretrained(self.model_name)
            self.model = TimesformerForVideoClassification.from_pretrained(
                self.model_name
            ).to(self.device)
            self.model.eval()
            logger.info("Assault detection model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load assault detection model: {e}")
            raise

    def extract_frames(
        self, video_path: str, num_frames: int = 8
    ) -> Optional[List[np.ndarray]]:
        """Extract frames from video at regular intervals."""
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                logger.error(f"Cannot open video: {video_path}")
                return None

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_indices = np.linspace(0, total_frames - 1, num_frames, dtype=int)

            frames = []
            for idx in frame_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if ret:
                    # Convert BGR to RGB
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    frame = Image.fromarray(frame)
                    frames.append(np.array(frame))

            cap.release()
            return frames if frames else None
        except Exception as e:
            logger.error(f"Error extracting frames: {e}")
            return None

    def predict(self, video_path: str) -> Dict[str, any]:
        """
        Predict assault/fight in video.

        Returns:
            {
                'has_assault': bool,
                'assault_type': str,
                'confidence': float,
                'all_predictions': Dict[str, float],
                'timestamp': str
            }
        """
        if self.model is None:
            self.load_model()

        frames = self.extract_frames(video_path, num_frames=8)
        if frames is None or len(frames) == 0:
            return {
                "has_assault": False,
                "assault_type": "unknown",
                "confidence": 0.0,
                "all_predictions": {},
                "error": "Failed to extract frames"
            }

        try:
            # Prepare input
            inputs = self.processor(
                images=frames,
                return_tensors="pt"
            )

            # Move to device
            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            # Inference
            with torch.no_grad():
                outputs = self.model(**inputs)
                logits = outputs.logits

            # Get predictions
            probs = torch.softmax(logits, dim=-1).cpu().numpy()[0]
            predictions = {
                self.labels[i]: float(probs[i])
                for i in range(len(self.labels))
            }

            # Check for assault
            assault_scores = {
                label: score
                for label, score in predictions.items()
                if label in self.assault_classes
            }

            max_assault_type = max(assault_scores, key=assault_scores.get)
            max_assault_confidence = assault_scores[max_assault_type]

            has_assault = max_assault_confidence >= self.confidence_threshold

            return {
                "has_assault": has_assault,
                "assault_type": max_assault_type if has_assault else "normal",
                "confidence": float(max_assault_confidence),
                "all_predictions": predictions,
                "assault_scores": assault_scores
            }
        except Exception as e:
            logger.error(f"Prediction error: {e}")
            return {
                "has_assault": False,
                "assault_type": "error",
                "confidence": 0.0,
                "error": str(e)
            }

    def predict_batch(
        self, video_paths: List[str]
    ) -> List[Dict[str, any]]:
        """Predict assault in multiple videos."""
        results = []
        for video_path in video_paths:
            result = self.predict(video_path)
            result["video_path"] = video_path
            results.append(result)
        return results


# Global instance
_assault_detector = None


def get_assault_detector() -> AssaultDetector:
    """Get or create global assault detector instance."""
    global _assault_detector
    if _assault_detector is None:
        _assault_detector = AssaultDetector()
    return _assault_detector
