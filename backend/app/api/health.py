from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="Health check")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "TraceNet API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

