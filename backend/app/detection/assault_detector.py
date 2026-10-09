"""
Assault / fight detection with VideoMAE (OPear/videomae-large-finetuned-UCF-Crime).

The model classifies a 16-frame clip into the 14 UCF-Crime classes (Abuse, Arrest, Arson, Assault,
Burglary, Explosion, Fighting, Normal_Videos_event, RoadAccidents, Robbery, Shooting, Shoplifting,
Stealing, Vandalism). A video is scanned with sliding windows so every alert carries the time it
happened; the labels are read from the model's own config, never hard-coded.

Weights live in backend/data/models/assault_videomae (downloaded once from Hugging Face); when that
folder is missing the Hugging Face cache is used, so the model still loads offline after one download.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import torch
from loguru import logger

from app.config import get_data_path
from app.runtime.device import get_device, use_half_precision

HF_MODEL_ID = "OPear/videomae-large-finetuned-UCF-Crime"
LOCAL_MODEL_DIR = "models/assault_videomae"

# UCF-Crime classes that count as a physical assault / violent incident
VIOLENT_CLASSES = ("Assault", "Fighting", "Abuse", "Robbery", "Shooting")

# Model registry entry (Models page, camera "Assault Detection ML Model" slot, execution logs)
REGISTRY_ID = "videomae-ucf-crime"
REGISTRY_NAME = "Assault / Violence Classifier (VideoMAE-L, UCF-Crime)"
MODEL_TYPE = "VideoMAE"


def register_in_registry(db) -> bool:
    """Add (or refresh) the registry row when the weights are on this machine. Idempotent; returns True
    when something changed. The row is a clip classifier, never a YOLO detector (see is_detector_model)."""
    import json

    from app.db.models import MLModel

    config_path = get_data_path(os.path.join(LOCAL_MODEL_DIR, "config.json"))
    if not os.path.exists(get_data_path(os.path.join(LOCAL_MODEL_DIR, "model.safetensors"))):
        return False
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            id2label = json.load(f).get("id2label", {})
        classes = [id2label[k] for k in sorted(id2label, key=int)]
    except Exception:
        classes = []
    record = db.query(MLModel).filter(MLModel.id == REGISTRY_ID).first()
    wanted = {"name": REGISTRY_NAME, "file_path": LOCAL_MODEL_DIR, "model_type": MODEL_TYPE,
              "category": "assault", "classes": json.dumps(classes)}
    if record is None:
        has_default = db.query(MLModel).filter(MLModel.category == "assault", MLModel.is_default == True).first()  # noqa: E712
        db.add(MLModel(id=REGISTRY_ID, is_default=not has_default, **wanted))
        db.commit()
        return True
    changed = False
    for key, value in wanted.items():
        if getattr(record, key) != value:
            setattr(record, key, value)
            changed = True
    if changed:
        db.commit()
    return changed


class AssaultDetector:
    """VideoMAE clip classifier run over a video in sliding windows."""

    def __init__(self, model_name: str = HF_MODEL_ID):
        self.model_name = model_name
        self.device = get_device()
        self.model = None
        self.processor = None
        self.labels: List[str] = []
        self.num_frames = 16
        self.assault_classes = list(VIOLENT_CLASSES)
        self.confidence_threshold = 0.6
        self.window_seconds = 2.0  # each clip spans 2 s of video (16 frames ~ 8 fps)
        self.stride_seconds = 2.0
        self.batch_size = 4

    # ------------------------------------------------------------------ model

    @staticmethod
    def local_model_path() -> str:
        return get_data_path(LOCAL_MODEL_DIR)

    def weights_available(self) -> bool:
        local = self.local_model_path()
        if os.path.exists(os.path.join(local, "model.safetensors")):
            return True
        try:
            from huggingface_hub import try_to_load_from_cache

            return isinstance(try_to_load_from_cache(self.model_name, "model.safetensors"), str)
        except Exception:
            return False

    def load_model(self) -> None:
        from transformers import AutoImageProcessor, VideoMAEForVideoClassification

        local = self.local_model_path()
        source = local if os.path.exists(os.path.join(local, "model.safetensors")) else self.model_name
        logger.info(f"Loading assault detection model from {source}")
        kwargs = {} if source == local else {"local_files_only": True}
        try:
            self.processor = AutoImageProcessor.from_pretrained(source, **kwargs)
            model = VideoMAEForVideoClassification.from_pretrained(source, **kwargs)
        except OSError as exc:
            raise RuntimeError(
                f"Assault model weights not found. Download them once into backend/data/{LOCAL_MODEL_DIR} "
                f"(huggingface_hub.snapshot_download('{HF_MODEL_ID}', local_dir=...))."
            ) from exc
        if source == local:
            self._restore_qv_biases(model, os.path.join(local, "model.safetensors"))
        if use_half_precision():
            model = model.half()
        self.model = model.to(self.device).eval()
        id2label = model.config.id2label
        self.labels = [id2label[i] for i in sorted(id2label)]
        self.num_frames = int(getattr(model.config, "num_frames", 16))
        logger.info(f"Assault detection model ready on {self.device} ({len(self.labels)} classes)")

    @staticmethod
    def _restore_qv_biases(model, weights_path: str) -> None:
        """The checkpoint uses the original VideoMAE layout (`q_bias`, `v_bias`, no key bias). transformers 5
        expects `query.bias` / `key.bias` / `value.bias` and would otherwise leave them randomly
        initialised, which silently corrupts every prediction."""
        from safetensors import safe_open

        restored = 0
        with safe_open(weights_path, framework="pt") as f:
            keys = set(f.keys())
            for i, layer in enumerate(model.videomae.encoder.layer):
                prefix = f"videomae.encoder.layer.{i}.attention.attention."
                attn = layer.attention.attention
                if prefix + "q_bias" not in keys or getattr(attn.query, "bias", None) is None:
                    continue
                with torch.no_grad():
                    attn.query.bias.copy_(f.get_tensor(prefix + "q_bias"))
                    attn.value.bias.copy_(f.get_tensor(prefix + "v_bias"))
                    if getattr(attn.key, "bias", None) is not None:
                        attn.key.bias.zero_()
                restored += 1
        if restored:
            logger.info(f"Assault model: mapped q/v attention biases for {restored} layers")

    # ------------------------------------------------------------------ video

    def _read_windows(self, video_path: str, max_windows: Optional[int] = None) -> List[Dict[str, Any]]:
        """Decode the video once and cut it into clips of `num_frames` frames spanning `window_seconds`."""
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            cap.release()
            raise ValueError(f"Video has no frames: {video_path}")
        span = max(int(round(self.window_seconds * fps)), self.num_frames)
        stride = max(int(round(self.stride_seconds * fps)), 1)
        starts = list(range(0, max(total - span, 0) + 1, stride)) or [0]
        if max_windows and len(starts) > max_windows:
            starts = [starts[int(i)] for i in np.linspace(0, len(starts) - 1, max_windows)]
        wanted: Dict[int, List[tuple]] = {}
        for w, start in enumerate(starts):
            idx = np.linspace(start, min(start + span, total) - 1, self.num_frames).astype(int)
            for slot, frame_idx in enumerate(idx):
                wanted.setdefault(int(frame_idx), []).append((w, slot))
        clips: List[List[Optional[np.ndarray]]] = [[None] * self.num_frames for _ in starts]
        frame_idx = 0
        last_needed = max(wanted)
        while frame_idx <= last_needed:
            ok = cap.grab()
            if not ok:
                break
            if frame_idx in wanted:
                ok, frame = cap.retrieve()
                if ok:
                    h, w_ = frame.shape[:2]
                    scale = 256.0 / min(h, w_)  # the processor resizes to 224 anyway; keep memory low
                    small = cv2.resize(frame, (int(w_ * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
                    for w, slot in wanted[frame_idx]:
                        clips[w][slot] = rgb
            frame_idx += 1
        cap.release()
        windows = []
        for w, start in enumerate(starts):
            frames = clips[w]
            filled = [f for f in frames if f is not None]
            if not filled:
                continue
            frames = [f if f is not None else filled[-1] for f in frames]  # pad a short tail
            end = min(start + span, total) - 1
            windows.append({"frames": frames, "start_frame": start, "end_frame": end,
                            "center_frame": (start + end) // 2, "fps": fps})
        return windows

    def _classify(self, windows: List[Dict[str, Any]]) -> List[Dict[str, float]]:
        if self.model is None:
            self.load_model()
        dtype = next(self.model.parameters()).dtype
        out: List[Dict[str, float]] = []
        for i in range(0, len(windows), self.batch_size):
            batch = [w["frames"] for w in windows[i:i + self.batch_size]]
            inputs = self.processor(batch, return_tensors="pt")
            pixel_values = inputs["pixel_values"].to(self.device, dtype=dtype)
            with torch.no_grad():
                probs = torch.softmax(self.model(pixel_values=pixel_values).logits.float(), dim=-1).cpu().numpy()
            out.extend({self.labels[j]: float(p[j]) for j in range(len(self.labels))} for p in probs)
        return out

    def _window_result(self, window: Dict[str, Any], predictions: Dict[str, float]) -> Dict[str, Any]:
        violent = {k: predictions.get(k, 0.0) for k in self.assault_classes}
        top = max(violent, key=violent.get)
        fps = window["fps"]
        return {
            "frame_number": window["center_frame"],
            "start_frame": window["start_frame"],
            "end_frame": window["end_frame"],
            "timestamp_seconds": round(window["center_frame"] / fps, 2),
            "start_seconds": round(window["start_frame"] / fps, 2),
            "end_seconds": round(window["end_frame"] / fps, 2),
            "class": top,
            "confidence": violent[top],
            "top_label": max(predictions, key=predictions.get),
            "predictions": predictions,
        }

    # ------------------------------------------------------------------ public API

    def predict_with_frames(self, video_path: str, num_frames: Optional[int] = None,
                            max_windows: Optional[int] = None) -> Dict[str, Any]:
        """Sliding-window scan. `frame_results` has one entry per 2-second window (centre frame)."""
        try:
            windows = self._read_windows(video_path, max_windows=max_windows)
            results = [self._window_result(w, p) for w, p in zip(windows, self._classify(windows))]
        except Exception as e:
            logger.error(f"Assault scan failed for {video_path}: {e}")
            return {"has_assault": False, "assault_type": "error", "confidence": 0.0,
                    "frame_results": [], "frames_analyzed": 0, "error": str(e)}
        if not results:
            return {"has_assault": False, "assault_type": "unknown", "confidence": 0.0,
                    "frame_results": [], "frames_analyzed": 0}
        peak = max(results, key=lambda r: r["confidence"])
        has_assault = peak["confidence"] >= self.confidence_threshold
        return {
            "has_assault": has_assault,
            "assault_type": peak["class"] if has_assault else "normal",
            "confidence": float(peak["confidence"]),
            "peak_timestamp_seconds": peak["timestamp_seconds"],
            "peak_window": [peak["start_seconds"], peak["end_seconds"]],
            "all_predictions": peak["predictions"],
            "assault_scores": {k: peak["predictions"].get(k, 0.0) for k in self.assault_classes},
            "frame_results": results,
            "frames_analyzed": len(results),
            "windows_flagged": sum(r["confidence"] >= self.confidence_threshold for r in results),
            "model": self.model_name,
        }

    def predict(self, video_path: str) -> Dict[str, Any]:
        """Whole-video verdict (the peak window); same keys as before plus the peak time."""
        result = self.predict_with_frames(video_path)
        result.pop("frame_results", None)
        return result

    def predict_batch(self, video_paths: List[str]) -> List[Dict[str, Any]]:
        results = []
        for video_path in video_paths:
            result = self.predict(video_path)
            result["video_path"] = video_path
            results.append(result)
        return results


_assault_detector: Optional[AssaultDetector] = None


def get_assault_detector() -> AssaultDetector:
    """Process-wide detector (the model is loaded on first use)."""
    global _assault_detector
    if _assault_detector is None:
        _assault_detector = AssaultDetector()
    return _assault_detector


def download_weights() -> str:
    """Fetch the checkpoint (~1.2 GB) into backend/data/models/assault_videomae.
    Run once per machine:  python -m app.detection.assault_detector"""
    from huggingface_hub import snapshot_download

    try:  # antivirus TLS scanning: trust the Windows roots as well (verification stays on)
        from app.storage.s3_client import _ca_bundle

        bundle = _ca_bundle()
        if bundle:
            os.environ.setdefault("REQUESTS_CA_BUNDLE", bundle)
            os.environ.setdefault("SSL_CERT_FILE", bundle)
    except Exception:
        pass
    return snapshot_download(HF_MODEL_ID, local_dir=AssaultDetector.local_model_path(),
                             allow_patterns=["config.json", "preprocessor_config.json", "model.safetensors",
                                             "README.md", "LICENCE.md"])


if __name__ == "__main__":
    print(f"Assault model ready in {download_weights()}")
