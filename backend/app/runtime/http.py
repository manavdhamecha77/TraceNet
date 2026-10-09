"""TLS verification for outbound HTTPS calls (OpenRouter, cloud LLMs, webhooks)."""

from functools import lru_cache


@lru_cache(maxsize=1)
def tls_verify():
    """`verify=` value for requests / httpx: certifi plus the Windows trusted roots, so HTTPS keeps working
    behind antivirus TLS scanning (e.g. Avast) with verification still on. True (library default) elsewhere."""
    try:
        from app.storage.s3_client import _ca_bundle

        return _ca_bundle() or True
    except Exception:
        return True
