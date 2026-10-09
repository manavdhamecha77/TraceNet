"""Who may call what. One central table instead of per-endpoint decorators, so the policy is reviewable.

  public  - no login (health, login, docs, and endpoints that machines call with their own credentials)
  user    - any logged-in Operator or Admin (default for everything else)
  admin   - Admin only: configuration, ML models, cameras / areas, webhooks, maintenance, permanent deletes
  denied  - never served to anyone, even with login disabled: everything under /data except the media folders
            the UI loads (the database, configs holding API keys, the session secret, model weights, ...)
"""

from __future__ import annotations

import re

PUBLIC = "public"
USER = "user"
ADMIN = "admin"
DENIED = "denied"

# Static files under /data that the UI loads (thumbnails, crops, videos, area images, live chunks)
_DATA_ALLOWED = re.compile(r"^/data/(cameras|processed|areas|streams)/.+$")

_PUBLIC_RULES = [
    ("GET", r"/"),
    ("GET", r"/health"),
    ("GET", r"/api/v1/health"),
    ("GET", r"/api/(docs|redoc|openapi\.json)(/.*)?"),
    ("GET", r"/api/v1/auth/status"),
    ("POST", r"/api/v1/auth/login"),
    ("POST", r"/api/v1/auth/logout"),
    # Machine-to-machine: MediaMTX asks whether a publish/read is allowed
    ("POST", r"/api/v1/stream/mediamtx-auth"),
    # Paired camera devices authenticate with their own X-Device-Token / stream key
    ("POST", r"/api/v1/stream/pair/verify"),
    ("POST", r"/api/v1/stream/pair/stop"),
    ("GET", r"/api/v1/stream/pair/status"),
    ("POST", r"/api/v1/stream/whip/[^/]+"),
    ("PATCH|DELETE", r"/api/v1/stream/whip/[^/]+/[^/]+"),
    # Standalone edge camera web app (static files)
    ("GET", r"/(camera-app|camera_client)(/.*)?"),
]

_ADMIN_RULES = [
    # User management
    ("GET|POST|PATCH|PUT|DELETE", r"/api/v1/auth/users(/.*)?"),
    # ML models and model configuration
    ("POST|PUT|DELETE", r"/api/v1/models(/.*)?"),
    ("POST", r"/api/v1/embedding-models/.*"),
    ("POST", r"/api/v1/face-models/.*"),
    ("POST", r"/api/v1/accident-models/switch"),
    ("POST", r"/api/v1/anpr/ocr/switch"),
    ("POST", r"/api/v1/anpr/model/status"),
    ("POST", r"/api/v1/assault-detection/model/status"),
    ("POST", r"/api/v1/finetuning/.*"),
    # Cameras, areas and system configuration
    ("POST", r"/api/v1/create-new-camera"),
    ("PUT|DELETE", r"/api/v1/cameras/[^/]+"),
    ("POST", r"/api/v1/cameras/[^/]+/sync-detection"),
    ("POST|PUT|DELETE", r"/api/v1/areas(/.*)?"),
    ("POST|PUT|DELETE", r"/api/v1/webhooks(/.*)?"),
    ("POST", r"/api/v1/assistant/config"),
    ("POST", r"/api/v1/search/multilingual/config"),
    ("POST", r"/api/v1/cctv-wall/config"),
    ("PUT", r"/api/v1/alerts/(config|chain-snatching-config)"),
    ("POST", r"/api/v1/stream/mediamtx-start"),
    # Maintenance, bulk re-processing and destructive operations
    ("POST", r"/api/v1/reindex-all"),
    ("POST", r"/api/v1/attributes/backfill"),
    ("POST", r"/api/v1/anpr/backfill"),
    ("POST", r"/api/v1/jobs/clear"),
    ("POST", r"/api/v1/processing/clear-completed"),
    ("POST", r"/api/v1/analytics/cache/clear"),
    ("DELETE", r"/api/v1/alerts/clear"),
    ("POST", r"/api/v1/alerts/(clear-artifacts|clear-logs)"),
    ("DELETE", r"/api/v1/alerts/[^/]+"),
    ("DELETE", r"/api/v1/videos/[^/]+/delete"),
    ("DELETE", r"/api/v1/reports/[^/]+"),
    ("DELETE", r"/api/v1/anpr/watchlist/[^/]+"),
    ("DELETE", r"/api/v1/multicam/targets/[^/]+"),
    # Benchmark / evaluation tooling
    ("POST", r"/api/v1/multicam/evaluation/.*"),
    ("POST|DELETE", r"/api/v1/multicam/replay/.*"),
    # Audit trail is reviewed by supervisors
    ("GET", r"/api/v1/audit/.*"),
]

# Copilot tools whose confirmation needs an Admin (the others can be confirmed by any Operator)
ADMIN_COPILOT_TOOLS = {"assign_camera_model", "trigger_video_reindex"}


def _compile(rules):
    return [(set(methods.split("|")), re.compile(f"^{pattern}$")) for methods, pattern in rules]


_PUBLIC = _compile(_PUBLIC_RULES)
_ADMIN = _compile(_ADMIN_RULES)


def required_access(method: str, path: str) -> str:
    method = method.upper()
    path = path.rstrip("/") or "/"
    if (path == "/data" or path.startswith("/data/")) and (".." in path or not _DATA_ALLOWED.match(path)):
        return DENIED
    if any(method in methods and rx.match(path) for methods, rx in _PUBLIC):
        return PUBLIC
    if any(method in methods and rx.match(path) for methods, rx in _ADMIN):
        return ADMIN
    return USER
