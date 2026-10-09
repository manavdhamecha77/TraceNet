"""Request gate: every request is checked against app.auth.policy before it reaches an endpoint."""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional

from fastapi import Request
from fastapi.responses import JSONResponse

from app.auth.policy import ADMIN, DENIED, PUBLIC, required_access
from app.auth.security import SESSION_COOKIE, verify_token
from app.config import get_settings

_USER_CACHE_SECONDS = 5.0  # re-check the account (active? role?) at least this often
_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()
_session_factory = None  # overridable in tests; defaults to app.db.session.SessionLocal


def auth_enabled() -> bool:
    return bool(get_settings().auth_enabled)


def _load_user(user_id: str) -> Optional[Dict[str, Any]]:
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(user_id)
        if hit and now - hit[0] < _USER_CACHE_SECONDS:
            return hit[1]
    from app.db.models import UserAccount
    from app.db.session import SessionLocal

    with (_session_factory or SessionLocal)() as db:
        account = db.query(UserAccount).filter(UserAccount.id == user_id).first()
        user = account.to_public() if account and account.is_active else None
    with _cache_lock:
        _cache[user_id] = (now, user)
    return user


def forget_user(user_id: str) -> None:
    """Drop the cached account so role / active changes apply on the next request."""
    with _cache_lock:
        _cache.pop(user_id, None)


def token_from_request(request: Request) -> Optional[str]:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(SESSION_COOKIE)


async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    access = required_access(request.method, request.url.path)
    if access == DENIED:  # enforced even with login disabled
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    if access == PUBLIC or not auth_enabled():
        return await call_next(request)
    claims = verify_token(token_from_request(request))
    user = _load_user(claims["sub"]) if claims else None
    if not user:
        return JSONResponse({"detail": "Login required."}, status_code=401)
    if access == ADMIN and user["role"] != "admin":
        return JSONResponse({"detail": "This action requires the Admin role."}, status_code=403)
    request.state.user = user
    return await call_next(request)


def current_user(request: Request) -> Optional[Dict[str, Any]]:
    """The logged-in user (None when auth is disabled or the route is public)."""
    return getattr(request.state, "user", None)


def actor_name(request: Request, fallback: Optional[str] = None) -> str:
    """Name to stamp on audit records: the logged-in user, never a name the browser sent."""
    user = current_user(request)
    if user:
        return user["display_name"]
    return fallback or "Operator"
