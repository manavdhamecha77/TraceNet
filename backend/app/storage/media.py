"""S3-primary media store for videos and model weights, with the local backend/data copy as cache + fallback.

Every media file keeps its usual local path under backend/data; its S3 copy lives at
``s3://<bucket>/media/<same relative path>``. Writes go to both places (S3 failures never break the
pipeline), reads use the local file and fetch it from S3 on demand when it is missing. With no S3
credentials in backend/.env, or ``MEDIA_STORE=local``, everything behaves exactly as before.

    python -m app.storage.media status     # how many media files exist locally / in S3
    python -m app.storage.media migrate    # upload local media that S3 does not have yet
    python -m app.storage.media prefetch   # download all S3 media missing locally (offline demo)
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import re
import tempfile
import threading
from functools import lru_cache
from pathlib import Path
from typing import Optional

from loguru import logger

from app.config import DATA_DIR, get_data_path, get_settings

MEDIA_PREFIX = "media"

# Absolute path containing ...<sep>backend<sep>data<sep><rest>, from any machine / OS.
_ABS_DATA_PATH = re.compile(r"^(?:[A-Za-z]:)?[\\/].*?[\\/]backend[\\/]data[\\/](.+)$")
_MODEL_DIRS = ("models/", "finetuned_models/")
_download_lock = threading.Lock()
_inflight: dict[str, threading.Lock] = {}


# --------------------------------------------------------------------------- paths


def is_media(rel: str) -> bool:
    """Media = model weights, original uploads and standardized videos (relative POSIX path under data/)."""
    if rel.startswith(_MODEL_DIRS) or rel.startswith("minio_mock/"):
        return True
    parts = rel.split("/")
    return len(parts) == 4 and parts[0] == "cameras" and parts[2] == "original_assets"


def to_local_data_path(stored: Optional[str]) -> Optional[str]:
    """Map a stored path to this machine: absolute paths from other machines (D:\\...\\backend\\data\\x)
    are rebased onto the local backend/data; relative paths are resolved under backend/data."""
    if not stored:
        return None
    match = _ABS_DATA_PATH.match(stored)
    if match:
        return os.path.join(os.path.normpath(str(DATA_DIR)), *re.split(r"[\\/]", match.group(1)))
    if os.path.isabs(stored):
        return stored
    return get_data_path(stored)


def rel_of(local_path: str | os.PathLike) -> Optional[str]:
    """POSIX path relative to backend/data, or None when the file lives elsewhere."""
    try:
        return Path(os.path.abspath(local_path)).relative_to(Path(os.path.abspath(DATA_DIR))).as_posix()
    except ValueError:
        return None


def _key(rel: str) -> str:
    return f"{MEDIA_PREFIX}/{rel}"


# --------------------------------------------------------------------------- S3 plumbing


@lru_cache(maxsize=1)
def store_enabled() -> bool:
    mode = (os.environ.get("MEDIA_STORE") or "auto").strip().lower()
    if mode == "local":
        return False
    s = get_settings()
    configured = bool(s.aws_access_key_id and s.aws_secret_access_key and s.s3_bucket)
    if mode == "s3" and not configured:
        logger.warning("MEDIA_STORE=s3 but S3 credentials are missing in backend/.env; using local storage only.")
    return configured


def _s3():
    from app.storage.s3_client import get_bucket, get_s3_client

    return get_s3_client(), get_bucket()


def _remote_size(rel: str) -> Optional[int]:
    from botocore.exceptions import ClientError

    s3, bucket = _s3()
    try:
        return s3.head_object(Bucket=bucket, Key=_key(rel))["ContentLength"]
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def _download(rel: str, dest: str) -> None:
    s3, bucket = _s3()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest), suffix=".part")
    os.close(fd)
    try:
        s3.download_file(bucket, _key(rel), tmp)
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# --------------------------------------------------------------------------- public API


def ensure_local(local_path: Optional[str]) -> bool:
    """True when the file is available locally, fetching it from S3 first if it is only stored there."""
    if not local_path:
        return False
    if os.path.exists(local_path):
        return True
    rel = rel_of(local_path)
    if rel is None or not store_enabled():
        return False
    with _download_lock:
        lock = _inflight.setdefault(rel, threading.Lock())
    with lock:  # one download per file even when several requests need it at once
        if os.path.exists(local_path):
            return True
        try:
            if _remote_size(rel) is None:
                return False
            logger.info(f"Media store: fetching {rel} from S3")
            _download(rel, local_path)
            return True
        except Exception as exc:
            logger.warning(f"Media store: could not fetch {rel} from S3 ({exc}); no local copy either.")
            return False


def put(local_path: str, metadata: Optional[dict[str, str]] = None) -> bool:
    """Upload a local media file to S3. Never raises: the local copy stays the fallback."""
    rel = rel_of(local_path)
    if rel is None or not store_enabled() or not os.path.exists(local_path):
        return False
    try:
        s3, bucket = _s3()
        # Correct Content-Type so browsers play videos streamed straight from S3
        extra = {"ContentType": mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"}
        if metadata:
            extra["Metadata"] = metadata
        s3.upload_file(str(local_path), bucket, _key(rel), ExtraArgs=extra)
        logger.info(f"Media store: uploaded {rel} to S3")
        return True
    except Exception as exc:
        logger.warning(f"Media store: S3 upload of {rel} failed ({exc}); kept local copy only.")
        return False


_upload_pool = None


def put_background(local_path: str, metadata: Optional[dict[str, str]] = None) -> None:
    """Queue an S3 upload without blocking the caller (ingestion keeps working on the local copy).
    Anything not uploaded before the process stops is picked up by `python -m app.storage.media migrate`."""
    global _upload_pool
    if not store_enabled():
        return
    if _upload_pool is None:
        from concurrent.futures import ThreadPoolExecutor

        _upload_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="media-upload")
    _upload_pool.submit(put, local_path, metadata)


def delete(local_path: Optional[str]) -> None:
    """Remove the S3 copy (bucket versioning keeps a recoverable version). Never raises."""
    rel = rel_of(local_path) if local_path else None
    if rel is None or not store_enabled():
        return
    try:
        s3, bucket = _s3()
        s3.delete_object(Bucket=bucket, Key=_key(rel))
    except Exception as exc:
        logger.warning(f"Media store: S3 delete of {rel} failed ({exc}).")


def presigned_url(local_path: str, expires: int = 3600) -> Optional[str]:
    """Time-limited direct S3 URL for a media file that exists in S3 (used to stream non-cached videos)."""
    rel = rel_of(local_path)
    if rel is None or not store_enabled():
        return None
    try:
        if _remote_size(rel) is None:
            return None
        s3, bucket = _s3()
        return s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": _key(rel)}, ExpiresIn=expires
        )
    except Exception as exc:
        logger.warning(f"Media store: could not presign {rel} ({exc}).")
        return None


def resolve_model_file(stored_path: Optional[str]) -> Optional[str]:
    """Local path of a model's weights: the stored path, the same file under this machine's backend/data,
    or backend/data/models/<name> — each fetched from S3 when only stored there."""
    if not stored_path:
        return None
    candidates = [stored_path, to_local_data_path(stored_path), get_data_path(f"models/{os.path.basename(stored_path)}")]
    seen = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        if ensure_local(candidate):
            return candidate
    return None


# --------------------------------------------------------------------------- migration CLI


def local_media_files(data_dir: Path = DATA_DIR) -> dict[str, Path]:
    out = {}
    for path in Path(data_dir).rglob("*"):
        if path.is_file() and not path.name.endswith(".part"):
            rel = path.relative_to(data_dir).as_posix()
            if is_media(rel):
                out[rel] = path
    return out


def remote_media_sizes() -> dict[str, int]:
    s3, bucket = _s3()
    sizes = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"{MEDIA_PREFIX}/"):
        for obj in page.get("Contents", []):
            sizes[obj["Key"][len(MEDIA_PREFIX) + 1:]] = obj["Size"]
    return sizes


def migrate(dry_run: bool = False, workers: int = 8) -> list[str]:
    """Upload local media S3 does not have (or has with a different size). Returns the uploaded paths."""
    from concurrent.futures import ThreadPoolExecutor

    local = local_media_files()
    remote = remote_media_sizes()
    todo = sorted(rel for rel, path in local.items() if remote.get(rel) != path.stat().st_size)
    total = sum(local[rel].stat().st_size for rel in todo)
    print(f"Media: {len(local)} local, {len(remote)} in S3 -> {len(todo)} to upload ({total / 1e6:.1f} MB)")
    if dry_run or not todo:
        return todo
    s3, bucket = _s3()

    def upload(rel: str) -> None:
        content_type = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        s3.upload_file(str(local[rel]), bucket, _key(rel), ExtraArgs={"ContentType": content_type})

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, _ in enumerate(pool.map(upload, todo), start=1):
            if done % 10 == 0 or done == len(todo):
                print(f"  uploaded {done}/{len(todo)}", flush=True)
    return todo


def prefetch(dry_run: bool = False, workers: int = 8) -> list[str]:
    """Download every S3 media file missing (or different) locally — run before an offline demo."""
    from concurrent.futures import ThreadPoolExecutor

    remote = remote_media_sizes()
    todo = sorted(
        rel for rel, size in remote.items()
        if not (DATA_DIR / rel).exists() or (DATA_DIR / rel).stat().st_size != size
    )
    print(f"Media: {len(remote)} in S3 -> {len(todo)} to download ({sum(remote[r] for r in todo) / 1e6:.1f} MB)")
    if dry_run or not todo:
        return todo
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, _ in enumerate(pool.map(lambda rel: _download(rel, str(DATA_DIR / rel)), todo), start=1):
            if done % 10 == 0 or done == len(todo):
                print(f"  downloaded {done}/{len(todo)}", flush=True)
    return todo


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.storage.media", description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=["status", "migrate", "prefetch"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not store_enabled():
        raise SystemExit("S3 media store is disabled (no credentials in backend/.env, or MEDIA_STORE=local).")
    if args.command == "status":
        local, remote = local_media_files(), remote_media_sizes()
        print(f"Local media files : {len(local)}")
        print(f"S3 media files    : {len(remote)}")
        print(f"Only local (run migrate) : {sum(1 for r in local if r not in remote)}")
        print(f"Only in S3 (fetched on demand / prefetch): {sum(1 for r in remote if r not in local)}")
    elif args.command == "migrate":
        migrate(args.dry_run)
    else:
        prefetch(args.dry_run)


if __name__ == "__main__":
    main()
