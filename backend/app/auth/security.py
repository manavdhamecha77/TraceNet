"""Password hashing (bcrypt) and signed session tokens (HMAC-SHA256, JWT-like, stdlib only)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from functools import lru_cache
from typing import Any, Dict, Optional

import bcrypt

from app.config import get_data_path, get_settings

ROLES = ("operator", "admin")
SESSION_COOKIE = "tracenet_session"
_SECRET_FILE = ".auth_secret"  # under backend/data, excluded from the S3 snapshot sync


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=1)
def _secret() -> bytes:
    configured = get_settings().auth_secret
    if configured:
        return configured.encode("utf-8")
    path = get_data_path(_SECRET_FILE)
    if os.path.exists(path):
        with open(path, "r", encoding="ascii") as handle:
            return handle.read().strip().encode("ascii")
    value = secrets.token_urlsafe(48)
    with open(path, "w", encoding="ascii") as handle:
        handle.write(value)
    return value.encode("ascii")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(user_id: str, role: str) -> str:
    """Signed token carrying the user id, role and expiry."""
    payload = {"sub": user_id, "role": role, "exp": int(time.time()) + get_settings().auth_session_hours * 3600}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{signature}"


def verify_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Claims of a valid, unexpired token; None otherwise (bad signature, malformed or expired)."""
    if not token or token.count(".") != 1:
        return None
    body, signature = token.split(".")
    expected = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        claims = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(claims, dict) or claims.get("exp", 0) < time.time() or claims.get("role") not in ROLES:
        return None
    return claims
