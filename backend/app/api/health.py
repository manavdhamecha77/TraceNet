from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="Health check")
@router.get("/api/v1/health", summary="Health check")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "TraceNet API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }



@router.get("/api/v1/system/device", summary="Compute device used for models")
def compute_device() -> dict:
    """GPU / CPU the models run on, with a hint when a GPU is present but PyTorch cannot use it."""
    from app.runtime.device import device_summary

    return device_summary()
