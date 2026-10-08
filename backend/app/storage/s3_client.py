"""Thin boto3 wrapper for the team's shared S3 bucket (credentials from backend/.env)."""

from __future__ import annotations

import os
import ssl
import sys
import tempfile
import threading
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

_SERVER_AUTH_OID = "1.3.6.1.5.5.7.3.1"
_client_lock = threading.Lock()


class S3ConfigError(RuntimeError):
    """Raised when the S3 settings in backend/.env are missing."""


@lru_cache(maxsize=1)
def _ca_bundle() -> str | None:
    """CA bundle = certifi + the Windows trusted roots.

    Python ships its own CA list, so HTTPS fails behind antivirus TLS scanning (e.g. Avast) or
    corporate proxies whose root only Windows trusts. Adding the OS roots keeps certificate
    verification fully on and thread-safe (unlike patching ssl globally). Other OSes use the default.
    """
    if sys.platform != "win32":
        return None
    import certifi

    pems = [Path(certifi.where()).read_text(encoding="ascii")]
    for cert, encoding, trust in ssl.enum_certificates("ROOT"):
        if encoding == "x509_asn" and (trust is True or _SERVER_AUTH_OID in trust):
            pems.append(ssl.DER_cert_to_PEM_cert(cert))
    content = "\n".join(pems)
    target = Path(tempfile.gettempdir()) / "tracenet_ca_bundle.pem"
    try:
        if target.read_text(encoding="ascii") == content:
            return str(target)  # unchanged: never rewrite a file other processes may have open
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix="tracenet_ca_", suffix=".pem")
    with os.fdopen(fd, "w", encoding="ascii") as handle:
        handle.write(content)
    try:
        os.replace(tmp, target)
    except PermissionError:
        return tmp  # shared copy is open elsewhere (Windows): use this process's own file
    return str(target)


def get_s3_client():
    with _client_lock:  # first use can come from several upload threads at once
        return _create_s3_client()


@lru_cache(maxsize=1)
def _create_s3_client():
    settings = get_settings()
    missing = [
        name
        for name, value in (
            ("AWS_ACCESS_KEY_ID", settings.aws_access_key_id),
            ("AWS_SECRET_ACCESS_KEY", settings.aws_secret_access_key),
            ("S3_BUCKET", settings.s3_bucket),
        )
        if not value
    ]
    if missing:
        raise S3ConfigError(
            f"Missing {', '.join(missing)} in backend/.env (see backend/.env.example)."
        )

    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_region,
        verify=_ca_bundle(),
        # Short connect timeout: when offline, media reads must fall back to local copies quickly.
        # SigV4 + regional endpoint: presigned URLs work in every region and need no global-endpoint redirect.
        endpoint_url=f"https://s3.{settings.aws_region}.amazonaws.com",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=60,
            max_pool_connections=64,
        ),
    )


def get_bucket() -> str:
    bucket = get_settings().s3_bucket
    if not bucket:
        raise S3ConfigError("Missing S3_BUCKET in backend/.env (see backend/.env.example).")
    return bucket
