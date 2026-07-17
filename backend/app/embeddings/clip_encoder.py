from __future__ import annotations

from functools import lru_cache
from typing import Optional

import torch
import open_clip
from loguru import logger


class ClipEncoder:
    """Singleton CLIP loader for TraceNet startup."""

    def __init__(
        self,
        model_name: str = "ViT-B-32",
        pretrained: str = "openai",
        device: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self.pretrained = pretrained
        self.device = device or self._resolve_device()
        self._model = None
        self._preprocess = None
        self._tokenizer = None

    @staticmethod
    def _resolve_device() -> str:
        return "cuda" if torch.cuda.is_available() else "cpu"

    def load(self) -> "ClipEncoder":
        """Load the CLIP model once and keep it resident in memory."""
        if self._model is not None:
            return self

        logger.info(
            "Loading CLIP encoder: model={}, pretrained={}, device={}",
            self.model_name,
            self.pretrained,
            self.device,
        )
        model, preprocess_train, preprocess_val = open_clip.create_model_and_transforms(
            self.model_name,
            pretrained=self.pretrained,
            device=self.device,
        )
        model.eval()

        # Use the validation transform for inference and keep tokenizer for future steps.
        self._model = model
        self._preprocess = preprocess_val or preprocess_train
        self._tokenizer = open_clip.get_tokenizer(self.model_name)
        return self

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def model(self):
        if self._model is None:
            raise RuntimeError("CLIP encoder has not been loaded yet.")
        return self._model

    @property
    def preprocess(self):
        if self._preprocess is None:
            raise RuntimeError("CLIP encoder has not been loaded yet.")
        return self._preprocess

    @property
    def tokenizer(self):
        if self._tokenizer is None:
            raise RuntimeError("CLIP encoder has not been loaded yet.")
        return self._tokenizer


@lru_cache(maxsize=1)
def get_clip_encoder() -> ClipEncoder:
    return ClipEncoder().load()
