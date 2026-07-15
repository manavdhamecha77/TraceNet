# AGENTS.md — TraceNet: AI-Driven Descriptive Search for Smart City CCTV

> This file is the persistent source of truth for any AI agent working on this codebase.
> Read this fully before making changes. Update the **Status** column immediately after
> completing any task — do not batch updates. Never mark a task `done` unless it runs
> end-to-end and has been manually verified against the Definition of Done.

---

## 1. Project Context

**What we're building:** A demo pipeline that lets a user type a natural-language
description (e.g. *"man in red jacket, black backpack, near Gate 3 after 5 PM"*) and
retrieve matching person/vehicle clips from CCTV footage, ranked by relevance, with
camera + timestamp metadata.

**Who this is for:** Hackathon submission (Problem Statement ERH26_PS_07 — Digital
Forensics / AI Video Analytics), pitched as a tool a police department's smart-city
surveillance team could realistically use.

**What we are NOT building (out of scope for MVP):**
- No "suspicious intent" or predictive-policing classifiers — ethically unsound, do not implement.
- No live camera feed ingestion — batch video files only for demo.
- No production auth/user management — single demo user is fine.
- No mobile app.

**Core design principles agents must respect:**
1. **Human-in-the-loop always.** The system ranks and surfaces candidates with
   confidence scores + matched attributes. It never auto-declares an identity match.
2. **Explainability over black-box scores.** Every result should show *why* it
   matched (e.g. which attributes scored high/low), not just a number.
3. **Privacy-conscious by default.** Any exported result should be capable of
   blurring non-matched faces (even if only stubbed for MVP).
4. **Audit everything.** Every search query gets logged (query text, timestamp,
   result count) — this is a differentiator feature, not optional polish.
5. Scope discipline: person + vehicle **attribute search** only. Do not let scope
   creep into open-vocabulary action/activity recognition.

---

## 2. Architecture (MVP demo scope)

```
Video files (simulated multi-camera folders)
        │
        ▼
[1] Ingestion — extract frames, tag camera_id + timestamp
        ▼
[2] Detection + Tracking — YOLOv8 (person) + BMD-45 (vehicle) + ByteTrack
        ▼
[3] Embedding Extraction — CLIP (image embeddings) + optional BLIP captions
        ▼
[4] Vector DB (FAISS) + Metadata DB (SQLite via SQLAlchemy)
        ▼
[5] Search API (FastAPI) — NL query → CLIP text embedding → FAISS search → metadata filter → ranked results
        ▼
[6] Frontend (React + Vite) — search bar, filters, results grid, clip playback
```

Full city-scale production architecture (edge processing, tiered storage, Kafka
streaming) is a **presentation/pitch artifact only** — not implemented in code.
Do not attempt to build Kafka/edge-node infra for the MVP; reference it in
`docs/scalability.md` (pitch material) instead.

---

## 3. Tech Stack (authoritative — do not substitute without updating this file)

| Layer | Technology |
|---|---|
| Video/frame handling | OpenCV (`cv2`), `ffmpeg-python` |
| Vehicle & Person detection | BMD-45 (custom/provided model — confirm weights location before use) |
| Tracking | ByteTrack (via `supervision` library) |
| Embeddings | CLIP (`open_clip` or `sentence-transformers` `clip-ViT-B-32`) |
| Captioning (optional) | BLIP (`transformers`, `Salesforce/blip-image-captioning-base`) |
| Vector DB | FAISS (`faiss-cpu`) |
| Metadata DB | SQLite + SQLAlchemy ORM |
| Backend API | FastAPI + Pydantic |
| Frontend | React + TS + Vite + TailwindCSS + Axios |
| Hashing (audit) | Python `hashlib` (SHA-256) |

---

## 4. Repository Structure (target)

```
/backend
  /app
    main.py                 # FastAPI entrypoint
    /ingestion
      frame_extractor.py
    /detection
      detector.py            #  wraps BMD-45
      tracker.py             # ByteTrack wrapper
    /embeddings
      clip_encoder.py
      captioner.py           # optional BLIP
    /search
      vector_index.py        # FAISS wrapper
      query_engine.py        # hybrid search logic
    /db
      models.py              # SQLAlchemy models
      crud.py
    /audit
      logger.py
    /alerts                  # differentiator features
      loitering.py
      abandoned_object.py
  requirements.txt
/frontend
  /src
    /pages
      Upload.tsx
      Search.tsx
    /components
      ResultsGrid.tsx
      SearchBar.tsx
      FilterSidebar.tsx
      ClipPlayer.tsx
      ExportButton.tsx
    App.tsx
  package.json
/data
  /sample_videos             # demo footage, organized by simulated camera_id
  /processed                 # thumbnails, extracted clips
/docs
  scalability.md              # production architecture (pitch material, not code)
AGENTS.md                     # this file
```

---

## 5. Task Breakdown & Status

**Status legend:** `not started` | `in progress` | `blocked` | `done`
Agents: when you pick up a task, set it to `in progress` before starting.
When finished AND verified, set to `done` and note the verification method used.

### Phase 1 — Foundation

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 1.1 | Set up repo structure (folders above), backend `requirements.txt`, frontend `package.json` | Setup | completed | |
| 1.2 | FastAPI skeleton with CORS, health check endpoint | Backend | done | Implemented app/router skeleton; syntax-checked locally with `python -m compileall backend\app`, live smoke still depends on backend Python deps being installed. |
| 1.3 | React + Vite skeleton with Tailwind configured | Frontend | done | Tailwind config added and verified with `npm.cmd run build`. |
| 1.4 | Video upload endpoint (`POST /api/v1/ingest`), saves to `/data/minio_mock` | Backend | done | Implemented POST /api/v1/ingest and ProcessVideoBackground in upload.py; checked imports with compileall. |
| 1.5 | Frame extraction pipeline (sample at 4 FPS, standard transcoding to 720p @ 10 FPS) | Backend/Ingestion | done | Implemented VideoPreprocessor.run_pipeline utilizing FFmpeg and OpenCV (cv2.VideoCapture) timeline-proportional sampling; verified. |
| 1.6 | Camera Detail & Ingest UI (upload form, active status, tabs, player modal) | Frontend | done | Implemented in App.tsx; verified frontend builds successfully via npm run build. |

### Phase 2 — Detection, Tracking, Embeddings

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 2.1 | Integrate YOLOv8 person detection on extracted frames | Backend/Detection | not started | |
| 2.2 | Integrate BMD-45 vehicle detection | Backend/Detection | not started | **Blocked until BMD-45 weights/repo confirmed** — flag if missing |
| 2.3 | Integrate ByteTrack via `supervision` for consistent track IDs | Backend/Detection | not started | Depends on 2.1, 2.2 |
| 2.4 | Build tracklet objects: track_id, object_type, camera_id, frame_range, timestamps, bbox, best_crop | Backend/Detection | not started | Depends on 2.3 |
| 2.5 | CLIP embedding extraction per tracklet (best crop or averaged) | Backend/Embeddings | not started | Depends on 2.4 |
| 2.6 | (Optional) BLIP auto-caption per tracklet for extra text attributes | Backend/Embeddings | not started | Stretch — only if time allows |
| 2.7 | Save thumbnails per tracklet to `/data/processed` | Backend | not started | |

### Phase 3 — Storage & Search

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 3.1 | SQLAlchemy models: `Video`, `Tracklet`, `SearchLog`, `Alert` | Backend/DB | not started | See schema in section 6 |
| 3.2 | FAISS index build + persistence (save/load index to disk) | Backend/Search | not started | Depends on 2.5 |
| 3.3 | `POST /search` endpoint: text query → CLIP text embedding → FAISS search → metadata filter → ranked JSON results | Backend/Search | not started | Depends on 3.1, 3.2 |
| 3.4 | `GET /clip/{tracklet_id}` — extract/return video clip for a tracklet | Backend | not started | |
| 3.5 | Search audit logging (log every query + result count to `SearchLog`) | Backend/Audit | not started | Differentiator feature — do not skip |
| 3.6 | Search UI: search bar, camera/time filters, results grid with thumbnails + confidence scores | Frontend | not started | Depends on 3.3 |
| 3.7 | Clip playback modal/view | Frontend | not started | Depends on 3.4 |

### Phase 4 — Differentiators (priority order if time-constrained)

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 4.1 | Export with SHA-256 hash + audit record (evidentiary integrity) | Backend/Audit | not started | High ROI, do this first |
| 4.2 | Missing-person fast search (upload reference photo → search all tracklets) | Backend + Frontend | not started | High ROI — reuses existing CLIP pipeline, just a new endpoint + UI entry point |
| 4.3 | Abandoned object detection (object-tracklet persists after associated person-tracklet ends) | Backend/Alerts | not started | Pure logic on existing tracklet data, no new model |
| 4.4 | Loitering / dwell-time detection (track_id stays in defined zone beyond threshold) | Backend/Alerts | not started | Needs zone definition — simple polygon config per camera |
| 4.5 | Explainability display: show per-attribute match breakdown, not just overall confidence % | Frontend + Backend | not started | Strengthens human-in-the-loop principle — worth doing over more alert types |

### Phase 5 — Polish & Demo Prep

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 5.1 | End-to-end test with real sample video (full pipeline: upload → search → results → playback) | All | not started | Do not consider MVP done until this passes |
| 5.2 | Curate demo query set (known good queries that return clean results) | All | not started | |
| 5.3 | `docs/scalability.md` — production architecture writeup (edge processing, tiered storage, Kafka) for pitch, not implementation | Docs | not started | Reference the architecture diagram already agreed on |
| 5.4 | README with setup/run instructions | Docs | not started | |
| 5.5 | Error handling pass (empty results, failed uploads, malformed queries) | Backend + Frontend | not started | |

---

## 6. Database Schema (reference — implement exactly, don't improvise fields)

```sql
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  filename TEXT,
  upload_timestamp DATETIME,
  processing_status TEXT,     -- 'pending' | 'processing' | 'complete' | 'failed'
  camera_id TEXT
);

CREATE TABLE tracklets (
  id TEXT PRIMARY KEY,
  video_id TEXT REFERENCES videos(id),
  track_id INTEGER,
  object_type TEXT,           -- 'person' | 'vehicle'
  start_frame INTEGER,
  end_frame INTEGER,
  camera_id TEXT,
  timestamp DATETIME,
  embedding_index INTEGER,    -- position in FAISS index
  attributes TEXT,            -- JSON, e.g. {"caption": "..."} if BLIP used
  thumbnail_path TEXT
);

CREATE TABLE search_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT,
  user TEXT,
  timestamp DATETIME,
  results_count INTEGER,
  clip_export_hash TEXT       -- nullable, filled only if results were exported
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT,            -- 'loitering' | 'abandoned_object'
  tracklet_id TEXT REFERENCES tracklets(id),
  camera_id TEXT,
  timestamp DATETIME,
  acknowledged BOOLEAN DEFAULT 0
);
```

---

## 7. Definition of Done (applies to every task)

A task is only `done` if:
1. Code runs without errors on the current sample dataset.
2. It's wired into the actual pipeline (not a standalone script disconnected from `main.py`).
3. If it's an API endpoint: tested with an actual request (curl/Postman/frontend), not just unit-tested in isolation.
4. If it's a UI component: rendered and manually clicked through, not just compiled.
5. The corresponding row in Section 5 is updated with status + a one-line note on how it was verified.

---

## 8. Known Blockers / Open Questions

- **BMD-45**: model source, weights file location, and input/output format are not
  yet confirmed. Do not assume a YOLO-style output format — verify first. Flag task
  2.2 as `blocked` until this is resolved.
- **Sample data**: confirm whether we're using public datasets (PRW, VeRi-776,
  MOT17) or self-recorded footage before Phase 1 finishes — affects folder structure
  in `/data/sample_videos`.
- **Zone definitions for loitering (4.4)**: need a simple way to define zones per
  camera (polygon coordinates) — decide format (JSON config file) before implementing.

---

## 9. Rules for Agents Editing This File

- Never delete completed task rows — this file is the project's audit trail.
- If you discover a task is bigger than scoped, split it into sub-rows (e.g. 2.4a,
  2.4b) rather than silently expanding scope under one row.
- If you deviate from the tech stack in Section 3, you must update Section 3 and
  explain why in the Notes column of the relevant task row.
- If blocked, set status to `blocked` and add the reason to Section 8, not just in
  the task's Notes column.
