# Shared Data via S3 — Media Store + Golden Snapshot

Models, videos, the database and the vector index used to drift between our machines. S3 is now the
**primary home for videos and model weights**, with each machine's `backend/data/` as a local cache and
fallback, and one **"golden" machine** publishes the processed data (DB + search index) that everyone pulls.

```
                    S3 bucket tracenet-gama (Sydney)
   media/<path under backend/data>          golden/manifest.json + blobs/
   ▲ new uploads, model uploads             ▲ push (golden machine only)      │ pull (everyone else)
   ▼ fetched on demand when missing         │                                 ▼
 every machine's backend/data  ◀──────────────────────────────────────────────┘
```

| What | Where it lives | How it moves |
|---|---|---|
| Original uploads, 720p videos, model weights | `s3://tracenet-gama/media/...` (primary) + local copy (cache/fallback) | Written to both on upload; downloaded on first use; streamed straight from S3 if not cached |
| Database, vector index, crops, thumbnails | `s3://tracenet-gama/golden/...` | `sync push` on the golden machine, `sync pull` everywhere else |

---

## 1. One-time setup (every machine)

1. `pip install -r backend/requirements.txt` (adds `boto3`).
2. Create `backend/.env` from `backend/.env.example` with the shared key (get it privately from Arshad):
   ```
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   AWS_REGION=ap-southeast-2
   S3_BUCKET=tracenet-gama
   MEDIA_STORE=auto
   ```
   `backend/.env` is git-ignored — **never commit it or paste it in chat**.
3. Check it works (from `backend/`):
   ```
   python -m app.storage.sync check
   python -m app.storage.media status
   ```

> **Avast / corporate proxy users:** HTTPS scanning is handled automatically (the tools trust the Windows
> certificate store, with full verification). No need to disable it for S3.

---

## 2. Media store (videos + models) — automatic

With S3 configured, the backend does this by itself:

- **Upload a video** → the original evidence file (with its SHA-256 as metadata) and the 720p video are
  copied to S3 in the background; ingestion never waits for it.
- **Upload a model** (Models page, face models) → copied to S3.
- **A file is missing locally** (fresh machine, deleted cache) → downloaded from S3 the first time any
  feature needs it (detection, export, plates, faces, re-runs). Model paths stored by another machine
  (e.g. `D:\...\backend\data\models\x.pt`) are mapped to this machine automatically.
- **Playback of a video that is not cached** → streamed straight from S3 through a short-lived signed URL.
- **Delete a video / model** → the S3 copy is deleted too (bucket versioning keeps it recoverable).

**Local fallback:** if S3 is unreachable or not configured, everything works from `backend/data` exactly as
before; failed S3 uploads are logged and retried by `migrate`. Force local-only with `MEDIA_STORE=local`.

| Command (`python -m app.storage.media ...`) | Does |
|---|---|
| `status` | Media files local vs in S3 |
| `migrate [--dry-run]` | Upload local videos/models that S3 does not have yet (existing data, or uploads made offline) |
| `prefetch [--dry-run]` | Download every S3 video/model missing locally — **run before an offline demo** |

---

## 3. Golden machine — publish the processed data

1. Get everything right **locally first**: all videos ingested and `complete`, all models registered in `/models`,
   face / plate / accident weights placed in `backend/data/models/...` (see table below), searches return results.
2. **Stop the backend** (it locks the DB and the vector index).
3. From `backend/`:
   ```
   python -m app.storage.sync push --dry-run     # preview: media to upload + snapshot changes
   python -m app.storage.sync push               # type 'push' to confirm
   ```
`push` first uploads any videos/models S3 does not have (`media migrate`), then the snapshot.
Re-run it after any change — only new/changed files are uploaded.

| Model | Must be at |
|---|---|
| Face detector | `backend/data/models/face_detection/yolov8n-face-lindevs.pt` |
| Plate detector | `backend/data/models/license_plate_detector.pt` |
| Accident detector | `backend/data/models/accident_detection/yolo11x_epoch61.pt` |
| Vehicle / theft / abandoned / assault | upload through the `/models` page (stored in `backend/data/models/`) |

---

## 4. Everyone else — get the data

1. **Stop the backend.**
2. From `backend/`:
   ```
   python -m app.storage.sync status                  # what differs from the golden snapshot
   python -m app.storage.sync pull                    # type 'pull' to confirm
   python -m app.storage.sync pull --with-media       # same, plus download all videos/models now
   ```
3. Start the backend as usual.

`pull` keeps a copy of your previous `drishti.db` and `vector_db/` in `backend/data/_backups/<timestamp>/`,
and rewrites file paths stored in the DB (e.g. `D:\...\backend\data\...`) to your machine's `backend/data`.
Without `--with-media`, videos and models are fetched from S3 the first time they are needed.

---

## What goes where

| Golden snapshot | Media store | Never synced (machine-local or secret) |
|---|---|---|
| `drishti.db` (consistent snapshot) | `models/`, `finetuned_models/` | `assistant_config.json` — LLM API keys |
| `vector_db/` (Qdrant index) | `minio_mock/` (original uploads) | `anpr_config.json` — depends on installed OCR |
| `processed/` (crops, detections, embeddings) | `cameras/*/original_assets/` (720p videos) | `audit_logs/` — each machine's own trail |
| `cameras/*/thumbnails`, `inference/` | | `mediamtx/`, `certs/` (**private key**) |
| `exports/`, `reports/`, `streams/`, other configs | | `_backups/`, lock / temp files |

---

## Rules

- **Only the golden machine pushes.** Everyone shares one key, so anyone *can* push — don't.
  `push` shows who pushed last and asks for confirmation.
- **Never sync with the backend running** — the tool refuses unless `--force`.
- A failed or interrupted push never breaks the snapshot: files are stored under their content hash and the
  `manifest.json` is only replaced after every upload succeeded. Old manifests are kept in `golden/history/`.

## Sync commands (`python -m app.storage.sync ...`)

| Command | Does |
|---|---|
| `check` | Credentials + bucket reachable; shows the current snapshot |
| `status` | Compares local files with the snapshot (missing / different / local-only) |
| `push [--dry-run] [--yes]` | Uploads missing media, then new/changed snapshot files, then publishes a new manifest |
| `pull [--dry-run] [--yes] [--with-media]` | Downloads changed snapshot files, verifies SHA-256, rebases DB paths |
| `--workers N` | Parallel transfers (default 32) |
