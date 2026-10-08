# Shared Data via S3 — Golden Snapshot Sync

Models, videos, the database and the vector index used to drift between our machines.
Now **one machine (the "golden" one) owns the data** and pushes it to S3; **everyone else pulls** it.
After a pull, every machine has byte-identical models, footage, DB and search index.

```
 golden machine                     S3 (tracenet-gama, Sydney)                 every other machine
 backend/data/ ──── push ────▶  golden/manifest.json + blobs  ──── pull ────▶  backend/data/
```

---

## 1. One-time setup (every machine)

1. `pip install -r backend/requirements.txt` (adds `boto3`).
2. Create `backend/.env` from `backend/.env.example` with the shared key (get it privately from Arshad):
   ```
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   AWS_REGION=ap-southeast-2
   S3_BUCKET=tracenet-gama
   ```
   `backend/.env` is git-ignored — **never commit it or paste it in chat**.
3. Check it works (from `backend/`):
   ```
   python -m app.storage.sync check
   ```

> **Avast / corporate proxy users:** HTTPS scanning is handled automatically (the tool trusts the Windows certificate store, with full verification). No need to disable it for the sync.

---

## 2. Golden machine — publish the data

1. Get everything right **locally first**: all videos ingested and `complete`, all models registered in `/models`,
   face / plate / accident weights placed in `backend/data/models/...` (see table below), searches return results.
2. **Stop the backend** (it locks the DB and the vector index).
3. From `backend/`:
   ```
   python -m app.storage.sync push --dry-run     # preview what will be uploaded
   python -m app.storage.sync push               # type 'push' to confirm
   ```
Re-run `push` after any change — only new/changed files are uploaded.

| Model | Must be at |
|---|---|
| Face detector | `backend/data/models/face_detection/yolov8n-face-lindevs.pt` |
| Plate detector | `backend/data/models/license_plate_detector.pt` |
| Accident detector | `backend/data/models/accident_detection/yolo11x_epoch61.pt` |
| Vehicle / theft / abandoned / assault | upload through the `/models` page (stored in `backend/data/models/`) |

---

## 3. Everyone else — get the data

1. **Stop the backend.**
2. From `backend/`:
   ```
   python -m app.storage.sync status             # what differs from the golden snapshot
   python -m app.storage.sync pull               # type 'pull' to confirm
   ```
3. Start the backend as usual.

`pull` keeps a copy of your previous `drishti.db` and `vector_db/` in `backend/data/_backups/<timestamp>/`,
and rewrites file paths stored in the DB (e.g. `D:\...\backend\data\...`) to your machine's `backend/data`.

---

## What is (not) synced

| Synced | Not synced (machine-local or secret) |
|---|---|
| `drishti.db` (consistent snapshot) | `assistant_config.json` — contains LLM API keys |
| `vector_db/` (Qdrant index) | `anpr_config.json` — OCR engine depends on what is installed |
| `models/` (all weights) | `audit_logs/` — each machine's own audit trail |
| `minio_mock/` (original uploads) | `mediamtx/` — streaming binary, downloaded per OS |
| | `certs/` — this machine's dev TLS certificate + **private key** |
| `cameras/` (720p videos, thumbnails) | `_backups/`, lock / temp files |
| `processed/` (crops, detections, embeddings) | |
| `exports/`, `reports/`, `streams/`, other configs | |

---

## Rules

- **Only the golden machine pushes.** Everyone shares one key, so anyone *can* push — don't.
  `push` shows who pushed last and asks for confirmation.
- **Never sync with the backend running** — the tool refuses unless `--force`.
- A failed or interrupted push never breaks the snapshot: files are stored under their content hash and the
  `manifest.json` is only replaced after every upload succeeded. Old manifests are kept in `golden/history/`.

## Commands

| Command | Does |
|---|---|
| `check` | Credentials + bucket reachable; shows the current snapshot |
| `status` | Compares local files with the snapshot (missing / different / local-only) |
| `push [--dry-run] [--yes]` | Uploads new/changed files, then publishes a new manifest |
| `pull [--dry-run] [--yes]` | Downloads changed files, verifies SHA-256, rebases DB paths |
| `--workers N` | Parallel transfers (default 32) |
