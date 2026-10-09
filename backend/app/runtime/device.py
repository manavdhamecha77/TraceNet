"""Pick the compute device for every model: the best available GPU, otherwise the CPU.

Order: NVIDIA CUDA (also AMD ROCm builds of PyTorch, which report as CUDA) -> Apple Silicon (MPS) -> CPU.
Override with TRACENET_DEVICE=cpu | cuda | cuda:1 | mps in backend/.env or the environment; an override
that is not available falls back to auto-detection with a warning.
"""

from __future__ import annotations

import os
import shutil
from functools import lru_cache

from loguru import logger

def _cuda_install_hint(torch) -> str:
    """Install command for the CUDA build matching the installed torch / torchvision versions.
    cu126 works with NVIDIA drivers >= 560 (checked for torch 2.13 + Python 3.14 on Windows)."""
    torch_version = torch.__version__.split("+")[0]
    try:
        import torchvision

        vision = f" torchvision=={torchvision.__version__.split('+')[0]}"
    except Exception:
        vision = " torchvision"
    return (f"pip install --force-reinstall --no-deps torch=={torch_version}{vision} "
            "--index-url https://download.pytorch.org/whl/cu126")


def _cuda_ok(torch) -> bool:
    try:
        return torch.cuda.is_available() and torch.cuda.device_count() > 0
    except Exception:
        return False


def _mps_ok(torch) -> bool:
    try:
        return bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception:
        return False


def _requested() -> str:
    value = os.environ.get("TRACENET_DEVICE")
    if not value:
        try:
            from app.config import get_settings

            value = get_settings().tracenet_device
        except Exception:
            value = None
    return (value or "auto").strip().lower()


@lru_cache(maxsize=1)
def get_device() -> str:
    """Device string accepted by PyTorch, Ultralytics YOLO, open_clip and transformers."""
    import torch

    requested = _requested()
    if requested not in ("", "auto"):
        if requested == "cpu":
            return "cpu"
        if requested.startswith("cuda") and _cuda_ok(torch):
            index = int(requested.split(":")[1]) if ":" in requested else 0
            if index < torch.cuda.device_count():
                return f"cuda:{index}"
        if requested == "mps" and _mps_ok(torch):
            return "mps"
        logger.warning(f"TRACENET_DEVICE={requested} is not available here; auto-detecting instead.")

    if _cuda_ok(torch):
        return "cuda:0"
    if _mps_ok(torch):
        return "mps"
    return "cpu"


def use_half_precision() -> bool:
    """FP16 inference is safe and faster on CUDA GPUs; keep FP32 on CPU / MPS."""
    return get_device().startswith("cuda")


@lru_cache(maxsize=1)
def device_summary() -> dict:
    """What the backend runs on, plus a hint when a GPU is present but PyTorch cannot use it."""
    import torch

    device = get_device()
    summary = {
        "device": device,
        "torch_version": torch.__version__,
        "torch_cuda_build": torch.version.cuda,  # None = CPU-only PyTorch build
        "gpu_name": torch.cuda.get_device_name(int(device.split(":")[1])) if device.startswith("cuda") else None,
        "hint": None,
    }
    if device == "cpu" and shutil.which("nvidia-smi") and torch.version.cuda is None:
        summary["hint"] = (
            "An NVIDIA GPU is installed but this PyTorch build is CPU-only, so models run on the CPU. "
            f"To use the GPU: {_cuda_install_hint(torch)}"
        )
    return summary


def log_device() -> None:
    s = device_summary()
    where = f"{s['device']} ({s['gpu_name']})" if s["gpu_name"] else s["device"]
    logger.info(f"Compute device: {where} | torch {s['torch_version']} (CUDA build: {s['torch_cuda_build']})")
    if s["hint"]:
        logger.warning(s["hint"])
