from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional
from PIL import Image
from loguru import logger

_blip_captioner_instance: Optional[BLIPCaptioner] = None


class BLIPCaptioner:
    """
    BLIP Image Captioning service using Salesforce/blip-image-captioning-base.
    Generates descriptive natural language captions for tracklet crops.
    """

    def __init__(self, model_name: str = "Salesforce/blip-image-captioning-base", device: Optional[str] = None) -> None:
        self.model_name = model_name
        self.processor = None
        self.model = None
        self.device = device
        self._is_loaded = False
        self._load_failed = False

    def load() -> None:
        if self._is_loaded or self._load_failed:
            return

        try:
            import torch
            from transformers import BlipProcessor, BlipForConditionalGeneration

            if self.device is None:
                self.device = "cuda" if torch.cuda.is_available() else "cpu"

            logger.info(f"Loading BLIP Captioner model '{self.model_name}' on device={self.device}...")
            self.processor = BlipProcessor.from_pretrained(self.model_name)
            self.model = BlipForConditionalGeneration.from_pretrained(self.model_name).to(self.device)
            self.model.eval()
            self._is_loaded = True
            logger.info(f"BLIP Captioner successfully loaded ({self.model_name}).")
        except Exception as e:
            self._load_failed = True
            logger.warning(f"Failed to load BLIP Captioner model '{self.model_name}': {e}. Using heuristic caption fallback.")

    def caption_image(self, image_path_or_pil: str | Path | Image.Image, object_type: str = "object") -> str:
        """
        Generates a descriptive auto-caption for a tracklet crop image.
        Returns natural text string (e.g. 'a man wearing a red jacket standing outdoors').
        """
        self.load()

        # Fallback helper if BLIP model fails to load or execute
        def fallback_caption(obj_type: str) -> str:
            if obj_type.lower() == "person":
                return "a person captured on CCTV feed"
            elif obj_type.lower() == "vehicle":
                return "a vehicle captured on CCTV feed"
            return f"a surveillance tracklet object ({obj_type})"

        try:
            if isinstance(image_path_or_pil, (str, Path)):
                img_path = str(image_path_or_pil)
                if not os.path.exists(img_path):
                    return fallback_caption(object_type)
                raw_image = Image.open(img_path).convert("RGB")
            elif isinstance(image_path_or_pil, Image.Image):
                raw_image = image_path_or_pil.convert("RGB")
            else:
                return fallback_caption(object_type)

            if not self._is_loaded or self.processor is None or self.model is None:
                return fallback_caption(object_type)

            import torch

            # Generate unconditional image caption
            inputs = self.processor(images=raw_image, return_tensors="pt").to(self.device)
            with torch.no_grad():
                out = self.model.generate(**inputs, max_new_tokens=30)
            
            caption = self.processor.decode(out[0], skip_special_tokens=True).strip()
            if caption:
                return caption
            return fallback_caption(object_type)

        except Exception as e:
            logger.error(f"Error generating BLIP caption: {e}")
            return fallback_caption(object_type)

    def caption_tracklet_crop(self, crop_path: str, object_type: str = "object") -> dict[str, Any]:
        """
        Returns structured attributes payload with BLIP caption.
        """
        caption_text = self.caption_image(crop_path, object_type=object_type)
        return {
            "caption": caption_text,
            "caption_model": self.model_name if self._is_loaded else "heuristic_fallback"
        }


def get_blip_captioner() -> BLIPCaptioner:
    global _blip_captioner_instance
    if _blip_captioner_instance is None:
        _blip_captioner_instance = BLIPCaptioner()
    return _blip_captioner_instance
