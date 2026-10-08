"""Push / pull the team's golden TraceNet data snapshot to the shared S3 bucket.

One machine (the "golden" one) processes everything and pushes; every other machine pulls,
so all machines end up with identical models, videos, database and vector index.

Run from backend/ with the API server stopped (it locks SQLite and the Qdrant index):

    python -m app.storage.sync check      # verify credentials + bucket access
    python -m app.storage.sync status     # compare this machine with the golden snapshot
    python -m app.storage.sync push       # golden machine only: upload its backend/data
    python -m app.storage.sync pull       # everyone else: download the golden snapshot

Layout in the bucket (content-addressed, so an interrupted push never corrupts the last good one):

    <prefix>/manifest.json                      current snapshot: relpath -> {size, sha256, key}
    <prefix>/history/<timestamp>.json           every previous manifest
    <prefix>/blobs/<sha256>/<filename>          immutable file contents
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import shutil
import socket
import sqlite3
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from app.config import DATA_DIR

DB_NAME = "drishti.db"
VECTOR_DB_DIR = "vector_db"
STATE_FILE = ".golden_state.json"
MANIFEST_VERSION = 1
SMALL_FILE_BYTES = 8 * 1024 * 1024

# Top-level entries under backend/data that are machine-local or secret and never synced.
EXCLUDED_TOP_LEVEL = {
    "assistant_config.json",  # holds LLM API keys
    "anpr_config.json",       # OCR engine choice depends on what is installed locally
    "mediamtx",               # streaming server binary, downloaded per OS
    "certs",                  # per-machine dev TLS cert + private key (app/tls.py), SANs are this host's IPs
    "audit_logs",             # per-machine audit trail
    "_backups",               # local safety copies made by `pull`
    "myagent.info",
    STATE_FILE,
}
EXCLUDED_SUFFIXES = (".lock", "-journal", "-wal", "-shm", ".tmp", ".part")

# Absolute path containing ...<sep>backend<sep>data<sep><rest>, from any machine / OS.
_ABS_DATA_PATH = re.compile(r"^(?:[A-Za-z]:)?[\\/].*?[\\/]backend[\\/]data[\\/](.+)$")


# --------------------------------------------------------------------------- helpers


def _human(num_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024 or unit == "GB":
            return f"{num_bytes:.1f} {unit}" if unit != "B" else f"{int(num_bytes)} B"
        num_bytes /= 1024
    return f"{num_bytes:.1f} GB"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_excluded(rel: str) -> bool:
    return rel.split("/", 1)[0] in EXCLUDED_TOP_LEVEL or rel.endswith(EXCLUDED_SUFFIXES)


def list_data_files(data_dir: Path) -> list[str]:
    """Relative POSIX paths of every syncable file under data_dir (the SQLite DB is handled separately)."""
    rels = []
    for path in data_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(data_dir).as_posix()
        if rel == DB_NAME or _is_excluded(rel):
            continue
        rels.append(rel)
    return sorted(rels)


def hash_files(sources: dict[str, Path], workers: int) -> dict[str, dict]:
    def one(rel: str) -> tuple[str, dict]:
        path = sources[rel]
        return rel, {"size": path.stat().st_size, "sha256": _sha256(path)}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(one, sources))


def snapshot_db(db_path: Path, out_dir: Path) -> Path:
    """Consistent copy of the SQLite DB via the backup API (safe even mid-transaction)."""
    target = out_dir / DB_NAME
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return target


def rebase_db_paths(db_path: Path, data_dir: Path) -> int:
    """Rewrite absolute paths from other machines (e.g. D:\\...\\backend\\data\\x) to this machine's data dir."""
    local_root = os.path.normpath(str(data_dir))
    conn = sqlite3.connect(db_path)
    rewritten = 0
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            if table == "chat_sessions":  # free-text conversation history, not file references
                continue
            columns = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
            for column in columns:
                rows = conn.execute(
                    f'SELECT rowid, "{column}" FROM "{table}" '
                    f"WHERE typeof(\"{column}\") = 'text' AND \"{column}\" LIKE '%backend_data_%'"
                ).fetchall()
                for rowid, value in rows:
                    match = _ABS_DATA_PATH.match(value)
                    if not match:
                        continue
                    local = os.path.join(local_root, *re.split(r"[\\/]", match.group(1)))
                    if local != value:
                        conn.execute(f'UPDATE "{table}" SET "{column}" = ? WHERE rowid = ?', (local, rowid))
                        rewritten += 1
        conn.commit()
    finally:
        conn.close()
    return rewritten


def server_running(port: int = 8000) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _ensure_server_stopped(force: bool) -> None:
    if server_running() and not force:
        sys.exit(
            "The TraceNet API is running on port 8000. Stop it first: it locks the SQLite DB and the "
            "Qdrant index, so a sync now could copy or overwrite them half-written. (--force to override)"
        )


def _confirm(word: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    if input(f"Type '{word}' to continue: ").strip().lower() != word:
        sys.exit("Aborted.")


# --------------------------------------------------------------------------- S3


def _clients(args):
    from app.storage.s3_client import get_bucket, get_s3_client

    return get_s3_client(), get_bucket()


def load_remote_manifest(s3, bucket: str, prefix: str) -> dict | None:
    from botocore.exceptions import ClientError

    try:
        body = s3.get_object(Bucket=bucket, Key=f"{prefix}/manifest.json")["Body"].read()
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise
    return json.loads(body)


def existing_blob_keys(s3, bucket: str, prefix: str) -> set[str]:
    keys = set()
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{prefix}/blobs/"):
        keys.update(obj["Key"] for obj in page.get("Contents", []))
    return keys


def _blob_key(prefix: str, rel: str, sha256: str) -> str:
    return f"{prefix}/blobs/{sha256}/{rel.rsplit('/', 1)[-1]}"


def _run_transfers(label: str, jobs: list, fn, workers: int) -> list[str]:
    """Run fn(job) in parallel with progress output; returns error messages."""
    total_bytes = sum(job["size"] for job in jobs) or 1
    done_bytes = 0
    errors = []
    last_pct = -10
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fn, job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                future.result()
            except Exception as exc:  # report and keep going; the manifest is only written on full success
                errors.append(f"{job['rel']}: {exc}")
            done_bytes += job["size"]
            pct = int(done_bytes * 100 / total_bytes)
            if pct >= last_pct + 10 or done_bytes == total_bytes:
                print(f"  {label} {pct:3d}%  ({_human(done_bytes)} / {_human(total_bytes)})", flush=True)
                last_pct = pct
    return errors


# --------------------------------------------------------------------------- commands


def cmd_check(args) -> None:
    s3, bucket = _clients(args)
    s3.head_bucket(Bucket=bucket)
    manifest = load_remote_manifest(s3, bucket, args.prefix)
    print(f"OK: credentials work and bucket '{bucket}' is reachable.")
    if manifest:
        print(
            f"Golden snapshot: {manifest['file_count']} files, {_human(manifest['total_bytes'])}, "
            f"pushed {manifest['created_at']} by {manifest['created_by']}."
        )
    else:
        print("No golden snapshot pushed yet.")


def cmd_status(args) -> None:
    s3, bucket = _clients(args)
    data_dir = Path(args.data_dir)
    manifest = load_remote_manifest(s3, bucket, args.prefix)
    if not manifest:
        print("No golden snapshot pushed yet.")
        return
    print(f"Golden snapshot: pushed {manifest['created_at']} by {manifest['created_by']}")
    state_path = data_dir / STATE_FILE
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        same = state.get("manifest_created_at") == manifest["created_at"]
        print(f"This machine last pulled the snapshot from {state.get('manifest_created_at')} ({'up to date' if same else 'OUTDATED'}).")
    remote = {rel: meta for rel, meta in manifest["files"].items() if rel != DB_NAME}
    local_rels = list_data_files(data_dir)
    local = hash_files({rel: data_dir / rel for rel in local_rels}, args.workers)
    missing = [rel for rel in remote if rel not in local]
    differ = [rel for rel in remote if rel in local and local[rel]["sha256"] != remote[rel]["sha256"]]
    extra = [rel for rel in local if rel not in remote]
    print(f"Files (excluding {DB_NAME}): {len(remote)} in snapshot, {len(local)} local")
    print(f"  missing locally : {len(missing)}")
    print(f"  different       : {len(differ)}")
    print(f"  only on this PC : {len(extra)}")
    for title, rels in (("missing", missing), ("different", differ), ("only local", extra)):
        for rel in rels[:10]:
            print(f"    [{title}] {rel}")


def cmd_push(args) -> None:
    _ensure_server_stopped(args.force)
    s3, bucket = _clients(args)
    data_dir = Path(args.data_dir)

    with tempfile.TemporaryDirectory() as tmp:
        sources = {rel: data_dir / rel for rel in list_data_files(data_dir)}
        if (data_dir / DB_NAME).exists():
            sources[DB_NAME] = snapshot_db(data_dir / DB_NAME, Path(tmp))
        print(f"Hashing {len(sources)} local files...")
        index = hash_files(sources, args.workers)
        for rel, meta in index.items():
            meta["key"] = _blob_key(args.prefix, rel, meta["sha256"])

        remote = load_remote_manifest(s3, bucket, args.prefix)
        uploaded = existing_blob_keys(s3, bucket, args.prefix)
        jobs = [{"rel": rel, **meta} for rel, meta in index.items() if meta["key"] not in uploaded]
        jobs = list({job["key"]: job for job in jobs}.values())  # identical files upload once
        total = sum(meta["size"] for meta in index.values())

        print(f"Bucket: s3://{bucket}/{args.prefix}/")
        if remote:
            print(f"Current golden snapshot: {remote['file_count']} files, pushed {remote['created_at']} by {remote['created_by']}")
        else:
            print("Current golden snapshot: none (first push)")
        print(f"This machine: {len(index)} files, {_human(total)}")
        print(f"To upload   : {len(jobs)} new/changed files, {_human(sum(j['size'] for j in jobs))}")
        if args.dry_run:
            for job in sorted(jobs, key=lambda j: j["rel"])[:25]:
                print(f"  + {job['rel']} ({_human(job['size'])})")
            print("Dry run: nothing uploaded.")
            return
        print("This REPLACES the golden snapshot that every teammate pulls.")
        _confirm("push", args.yes)

        def upload(job):
            s3.upload_file(str(sources[job["rel"]]), bucket, job["key"])

        errors = _run_transfers("upload", jobs, upload, args.workers)
        if errors:
            print(f"{len(errors)} upload(s) failed; the golden snapshot was NOT changed. Re-run push to retry.")
            for err in errors[:10]:
                print(f"  ! {err}")
            sys.exit(1)

    now = datetime.now(timezone.utc)
    manifest = {
        "version": MANIFEST_VERSION,
        "created_at": now.isoformat(timespec="seconds"),
        "created_by": f"{getpass.getuser()}@{socket.gethostname()}",
        "file_count": len(index),
        "total_bytes": total,
        "files": dict(sorted(index.items())),
    }
    body = json.dumps(manifest, indent=1).encode("utf-8")
    s3.put_object(Bucket=bucket, Key=f"{args.prefix}/history/{now.strftime('%Y%m%dT%H%M%SZ')}.json", Body=body)
    s3.put_object(Bucket=bucket, Key=f"{args.prefix}/manifest.json", Body=body, ContentType="application/json")
    print(f"Pushed golden snapshot: {len(index)} files, {_human(total)}.")


def cmd_pull(args) -> None:
    _ensure_server_stopped(args.force)
    s3, bucket = _clients(args)
    data_dir = Path(args.data_dir)
    manifest = load_remote_manifest(s3, bucket, args.prefix)
    if not manifest:
        sys.exit("No golden snapshot in the bucket yet. The golden machine must run `push` first.")

    files = manifest["files"]
    present = {rel: data_dir / rel for rel in files if rel != DB_NAME and (data_dir / rel).is_file()}
    print(f"Golden snapshot: {len(files)} files, {_human(manifest['total_bytes'])}, pushed {manifest['created_at']} by {manifest['created_by']}")
    print(f"Checking {len(present)} local files...")
    local = hash_files(present, args.workers)
    jobs = [
        {"rel": rel, **meta}
        for rel, meta in files.items()
        if rel == DB_NAME or local.get(rel, {}).get("sha256") != meta["sha256"]
    ]
    stale_vectors = [
        path for path in (data_dir / VECTOR_DB_DIR).rglob("*")
        if path.is_file() and path.relative_to(data_dir).as_posix() not in files and not _is_excluded(path.relative_to(data_dir).as_posix())
    ] if (data_dir / VECTOR_DB_DIR).exists() else []

    print(f"To download: {len(jobs)} files, {_human(sum(j['size'] for j in jobs))}")
    if stale_vectors:
        print(f"To remove  : {len(stale_vectors)} vector-index files not in the snapshot")
    if args.dry_run:
        for job in sorted(jobs, key=lambda j: j["rel"])[:25]:
            print(f"  + {job['rel']} ({_human(job['size'])})")
        print("Dry run: nothing changed.")
        return
    print(f"This OVERWRITES this machine's {DB_NAME} and vector index (a backup is kept in data/_backups/).")
    _confirm("pull", args.yes)

    backup_dir = data_dir / "_backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    if (data_dir / DB_NAME).exists() or (data_dir / VECTOR_DB_DIR).exists():
        backup_dir.mkdir(parents=True, exist_ok=True)
        if (data_dir / DB_NAME).exists():
            shutil.copy2(data_dir / DB_NAME, backup_dir / DB_NAME)
        if (data_dir / VECTOR_DB_DIR).exists():
            shutil.copytree(data_dir / VECTOR_DB_DIR, backup_dir / VECTOR_DB_DIR)
        print(f"Backed up current DB + vector index to {backup_dir}")

    def download(job):
        dest = data_dir / job["rel"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        if job["size"] < SMALL_FILE_BYTES:
            # one GET instead of download_file's HEAD + GET: thousands of crops, high-latency region
            part.write_bytes(s3.get_object(Bucket=bucket, Key=job["key"])["Body"].read())
        else:
            s3.download_file(bucket, job["key"], str(part))
        if _sha256(part) != job["sha256"]:
            part.unlink(missing_ok=True)
            raise RuntimeError("checksum mismatch after download")
        if job["rel"] == DB_NAME:
            rebased = rebase_db_paths(part, data_dir)
            print(f"  rewrote {rebased} file paths in {DB_NAME} for this machine")
        os.replace(part, dest)

    errors = _run_transfers("download", jobs, download, args.workers)
    if errors:
        print(f"{len(errors)} download(s) failed; re-run pull to retry.")
        for err in errors[:10]:
            print(f"  ! {err}")
        sys.exit(1)

    for path in stale_vectors:
        path.unlink()
    (data_dir / STATE_FILE).write_text(
        json.dumps({"manifest_created_at": manifest["created_at"], "manifest_created_by": manifest["created_by"],
                    "pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}, indent=1),
        encoding="utf-8",
    )
    print(f"Pulled golden snapshot ({manifest['created_at']}). Start the backend as usual.")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.storage.sync", description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=["check", "status", "push", "pull"])
    parser.add_argument("--prefix", default="golden", help="folder in the bucket (default: golden)")
    parser.add_argument("--data-dir", default=str(DATA_DIR), help="local data directory (default: backend/data)")
    parser.add_argument("--workers", type=int, default=32, help="parallel transfers (default: 32)")
    parser.add_argument("--dry-run", action="store_true", help="show what would change without transferring")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    parser.add_argument("--force", action="store_true", help="run even if the API server is up (not recommended)")
    args = parser.parse_args(argv)
    {"check": cmd_check, "status": cmd_status, "push": cmd_push, "pull": cmd_pull}[args.command](args)


if __name__ == "__main__":
    main()
