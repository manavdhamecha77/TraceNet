"""Thin boto3 wrapper for the team's shared S3 bucket (credentials from backend/.env)."""

from __future__ import annotations

import os
import ssl
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

_SERVER_AUTH_OID = "1.3.6.1.5.5.7.3.1"


class S3ConfigError(RuntimeError):
    """Raised when the S3 settings in backend/.env are missing."""


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
    target = Path(tempfile.gettempdir()) / "tracenet_ca_bundle.pem"
    fd, tmp = tempfile.mkstemp(dir=target.parent, suffix=".pem")
    with os.fdopen(fd, "w", encoding="ascii") as handle:
        handle.write("\n".join(pems))
    os.replace(tmp, target)
    return str(target)


@lru_cache(maxsize=1)
def get_s3_client():
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
        config=Config(retries={"max_attempts": 5, "mode": "standard"}, max_pool_connections=64),
    )


def get_bucket() -> str:
    bucket = get_settings().s3_bucket
    if not bucket:
        raise S3ConfigError("Missing S3_BUCKET in backend/.env (see backend/.env.example).")
    return bucket
