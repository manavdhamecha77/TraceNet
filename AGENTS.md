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
6. **Centralized Backend Storage (Strictly Mandatory):**
   * **ALL** database files (`drishti.db`), video uploads, processed frames, tracking assets, and weight files must be stored absolutely inside `backend/data/` (or subdirectories of it).
   * **NEVER** write or read files from the root `/data/` folder, `.gemini/` folders, or direct system directories.
   * Central path resolution must be resolved through `app.config.get_data_path` to guarantee absolute storage paths under `backend/data/` regardless of the uvicorn launch execution context.

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
| Shared team storage | AWS S3 (`boto3`), bucket `tracenet-gama` (ap-southeast-2). **Media store** (`app/storage/media.py`): S3 `media/` is the primary home of videos + model weights, local `backend/data/` is cache + fallback (`MEDIA_STORE=auto|s3|local`). **Golden snapshot** (`app/storage/sync.py`): DB, vector index, crops. See `docs/s3-sync.md`. Runtime still reads files from local `backend/data/` (principle 6); missing media is fetched into it on demand. |

---

## 4. Repository Structure (target)

```
/backend
  /app
    main.py                 # FastAPI entrypoint + startup auto-migration runner
    /api
      cameras.py            # Camera CRUD: GET, POST /create-new-camera, PUT, DELETE
      upload.py             # POST /api/v1/ingest — video ingestion trigger
    /preprocess
      video_preprocessor.py # FFmpeg transcode (720p, H.264) + OpenCV 4-FPS sampling
    /detection
      detector.py           # wraps BMD-45 (BLOCKED — weights unconfirmed)
      tracker.py            # ByteTrack wrapper
    /embeddings
      clip_encoder.py
      captioner.py          # optional BLIP
    /search
      vector_index.py       # FAISS wrapper
      query_engine.py       # hybrid search logic
    /db
      models.py             # SQLAlchemy: CameraProfile, VideoRecord, SearchLog, Alert
      crud.py
    /audit
      logger.py
    /alerts
      loitering.py
      abandoned_object.py
  requirements.txt
/frontend
  /src
    /pages
      Cameras.tsx           # /cameras — Leaflet map + tabular grid, camera CRUD modals
      CameraDetail.tsx      # /cameras/[camera_id] — System/Original tab view + video table
    App.tsx                 # Sidebar, routing, register-camera modal, video player modal
  DESIGN.md                 # UI/UX specification — authoritative style reference
  package.json
/data
  /minio_mock               # uploaded raw video files (original, pre-transcode)
  /processed                # thumbnails, extracted frames, transcoded MP4s
  /sample_videos            # demo footage organized by camera_id
/docs
  preprocess-api.md         # API contract reference for ingestion endpoints
  scalability.md            # production architecture (pitch material only, not code)
AGENTS.md                   # this file
```

---

## 5. Task Breakdown & Status

**Status legend:** `not started` | `in progress` | `blocked` | `done`
Agents: when you pick up a task, set it to `in progress` before starting.
When finished AND verified, set to `done` and note the verification method used.

### Phase 1 — Foundation

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 1.1 | Set up repo structure (folders above), backend `requirements.txt`, frontend `package.json` | Setup | done | |
| 1.2 | FastAPI skeleton with CORS, health check endpoint | Backend | done | Implemented app/router skeleton; syntax-checked locally with `python -m compileall backend\app`, live smoke still depends on backend Python deps being installed. |
| 1.3 | React + Vite skeleton with Tailwind configured | Frontend | done | Tailwind config added and verified with `npm.cmd rcodexun build`. |
| 1.4 | Video upload endpoint (`POST /api/v1/ingest`), saves to `/data/minio_mock` | Backend | done | Implemented POST /api/v1/ingest and ProcessVideoBackground in upload.py; checked imports with compileall. |
| 1.5 | Frame extraction pipeline (sample at 4 FPS, standard transcoding to 720p @ 10 FPS) | Backend/Ingestion | done | Implemented VideoPreprocessor.run_pipeline utilizing FFmpeg and OpenCV (cv2.VideoCapture) timeline-proportional sampling; verified. |
| 1.6a | Camera registry UI — `/cameras` page with Leaflet map + tabular grid, register modal | Frontend | done | Cameras.tsx: interactive Leaflet map plots all nodes with status popups; table shows thumbnail (16:9), name/ID, zone, neighbors, status badge, video count. Register modal wired to `POST /create-new-camera`. Verified via `npm run build`. |
| 1.6b | Camera CRUD — Edit, Delete, View Details modals with mini-maps | Frontend + Backend | done | Edit modal: live coordinate preview map (debounced 400ms), 16:9 thumbnail, altitude field, status select. Delete: case-insensitive name confirmation, red-gated submit button. View Details: full-width 16:9 thumbnail + metadata table + full-height Leaflet map. Backend: `PUT /cameras/{id}`, `DELETE /cameras/{id}` with cascade. Verified via `npm run build`. |
| 1.7 | SQLAlchemy `CameraProfile` schema + auto-migration on startup | Backend/DB | done | `models.py`: CameraProfile with `status` (TEXT) and `altitude` (Float) columns. `main.py`: `run_startup_migrations()` uses `PRAGMA table_info` + `ALTER TABLE` at boot — prevents OperationalError on schema evolution without full DB teardown. Verified: backend starts without error after schema change. |
| 1.8 | Camera Detail page `/cameras/[id]` — dual-tab video table (System / Original), polling | Frontend | done | `CameraDetail.tsx`: System Preprocessing tab is default and first (primary working surface); Original Audit tab is second with amber BACKUP label (forensic archive only). 3-second poll for pending/processing videos. Verified via `npm run build`. |
| 1.9 | Modal UX + Leaflet z-index fixes | Frontend | done | (a) All modals use `fixed inset-0` backdrop at `z-[100]` in root stacking context — covers full viewport including top. (b) Leaflet map section has `style={{ isolation: 'isolate' }}` — creates CSS stacking context that traps Leaflet's internal z-indices (200–650) so map tiles/markers never bleed above fixed modals. (c) Kebab menu rendered via `position:fixed` dropdown computed from `getBoundingClientRect` — escapes table `overflow` clipping. Verified via `npm run build`. |
| 1.10 | Ingestion Scaling Plan Phase 1 (Intermediate statuses, progress bars, early view enabling) | Backend + Frontend | done | Implemented progressive statuses (pending->transcoding->preprocessed->indexing->complete), progress bars in video list table, and unblocked video playback at the preprocessed stage. Verified via `npm run build`. |
| 1.11 | Area hierarchy — Area registry, camera assignment, custom thumbnails, grid/list view | Fullstack | done | Added additive `areas` schema/API with migration-created General Area, camera assignment/reassignment, upload or URL thumbnails, deletion guard, and `/areas` grid/list UI. Verified with backend compile/import and `GET /api/v1/areas`; frontend build was blocked only by the pre-existing unused `CheckCircle2` import in `PlateDetection.tsx` (resolved; `npm run build` passes as of 2026-10-08). |

### Phase 2 — Detection, Tracking, Embeddings

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 2.1 | Integrate YOLOv8 person detection on extracted frames | Backend/Detection | done | Integrated the supplied `backend/app/detection/weights/best.pt` checkpoint via Ultralytics YOLO; smoke-tested with a generated clip through `/api/v1/ingest`. |
| 2.2 | Integrate BMD-45 vehicle detection | Backend/Detection | done | Wired the local checkpoint into the person/vehicle detector path and verified the model loads through the new detection API. |
| 2.3 | Integrate ByteTrack via `supervision` for consistent track IDs | Backend/Detection | done | Added `ByteTrackWrapper` using the installed `supervision` version (`lost_track_buffer`/`update_with_detections`) and verified it in a synthetic ingest smoke test. |
| 2.4 | Build tracklet objects: track_id, object_type, camera_id, frame_range, timestamps, bbox, best_crop | Backend/Detection | done | `DetectionService` now emits tracklet summaries with frame ranges, timestamps, best bbox, and crop paths; verified by direct service run and API smoke test. |
| 2.5 | CLIP embedding extraction per tracklet (best crop or averaged) | Backend/Embeddings | done | Verified `POST /api/v1/videos/{video_id}/embeddings` generates `embeddings.json` and a 512-dim CLIP vector from a saved tracklet crop. |
| 2.6 | BLIP auto-caption per tracklet for extra text attributes | Backend/Embeddings | done | Implemented `BLIPCaptioner` (`Salesforce/blip-image-captioning-base`), integrated auto-captioning into `TrackletEmbeddingService`, updated SQLite `tracklets` table schema + startup migration, Qdrant payload, and UI candidate card badges. |
| 2.7 | Save thumbnails per tracklet to `/data/processed` | Backend | done | Tracklet crops are written under `data/processed/detections/<video_id>/crops`; confirmed in the smoke test output. |
| 2.8 | Frontend detections drawer on camera detail page | Frontend | done | Added a `Detections` action beside video playback and an inline tracklet summary drawer on `/cameras/[id]`; verified with `npm.cmd run build`. |

### Phase 3 — Storage & Search

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 3.1 | SQLAlchemy models: `Video`, `Tracklet`, `SearchLog`, `Alert` | Backend/DB | done | Models created in `db/models.py`, verified with auto-migrations on boot. |
| 3.2 | FAISS index build + persistence (save/load index to disk) | Backend/Search | done | Substituted FAISS with local persistent Qdrant collection saving directly to disk in `backend/data/vector_db`. |
| 3.3 | `POST /search` endpoint: text query → CLIP text embedding → FAISS search → metadata filter → ranked JSON results | Backend/Search | done | Implemented semantic search via Qdrant persistent client + metadata joining in `app/api/search.py` and `app/search/query_engine.py`. |
| 3.4 | `GET /clip/{tracklet_id}` — extract/return video clip for a tracklet | Backend | done | Added `/clip/{tracklet_id}` in `api/search.py` returning relative seek details. |
| 3.5 | Search audit logging (log every query + result count to `SearchLog`) | Backend/Audit | done | Every search query, filters, and match count logged to SQLite `search_logs` table. |
| 3.6 | Search UI: search bar, camera/time filters, results grid with thumbnails + confidence scores | Frontend | done | Implemented search dashboard in `Search.tsx` with camera nodes checkboxes, timeframe selectors, category filters, and results grid. |
| 3.7 | Clip playback modal/view | Frontend | done | Seek & Stream button opens player and seeks to the exact tracklet start timestamp in Annotated view. |
| 3.8 | Single Video Dedicated Page (`/cameras/[camera_id]/videos/[video_id]`) | Fullstack | done | Implemented `VideoDetail.tsx` with video-scoped CLIP search, clean/annotated stream toggle, interactive timeline density heatmap, and seek & pause action. |

### Phase 4 — Differentiators (priority order if time-constrained)

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 4.1 | Export with SHA-256 hash + audit record (evidentiary integrity) | Backend/Audit | done | Implemented results set export hashing (SHA-256) inside `Search.tsx` client-side, downloading a verified compliance text report. |
| 4.2 | Missing-person fast search (upload reference photo → search all tracklets) | Backend + Frontend | done | Implemented `ImageSearchService` + `POST /api/v1/search/image` + drag-drop UI toggle in `Search.tsx`; verified via `compileall`, `npm run build`, and `git push`. |
| 4.3 | Abandoned object detection (object-tracklet persists after associated person-tracklet ends) | Backend/Alerts | not started | Pure logic on existing tracklet data, no new model |
| 4.4 | Loitering / dwell-time detection (track_id stays in defined zone beyond threshold) | Backend/Alerts | done | Verified end-to-end with a real upload: user-drawn video zone, thresholded dwell analysis, deduplicated alert, evidence timeline, track inspection, and acknowledgement. |
| 4.4a | Video-scoped polygon-zone configuration, preview-frame API, and zone editor | Backend + Frontend | done | Manually verified upload opt-in, standardized-preview polling, polygon drawing, threshold configuration, and saved normalized zone. |
| 4.4b | Dwell-time analysis using bottom-centre track points, grace gaps, and alert deduplication | Backend/Alerts | done | Verified with synthetic dwell/gap cases and the real-video end-to-end run; alerts use bottom-centre points and respect configured grace gaps. |
| 4.4c | Loitering alert presentation, playback, acknowledgement, and end-to-end verification | Frontend + Backend | done | Manually verified Loitering Reviews evidence card, timeline, track inspection, and alert acknowledgement after a real upload. |
| 4.5 | Explainability display: show per-attribute match breakdown, not just overall confidence % | Frontend + Backend | done | Added per-result evidence: CLIP similarity, detector confidence, generated caption, caption/class overlap, unverified requested attributes, applied filters, and a human-review limitation. Verified with backend compilation, `npm.cmd run build`, a live `POST /api/v1/search`, and manual expansion of “Why this matched” in the Search UI. |
| 4.6 | Dynamic ML Model Registry (/models) and camera assignment | Backend + Frontend | done | Implemented model upload, dynamic file-system weights resolution, auto YOLO class parsing, and serving execution logs in UI. |
| 4.7 | Global Conversational AI Search Assistant & Full-Screen Copilot Overlay | Fullstack | done | Implemented `app/assistant/` engine (Ollama + Universal Cloud LLMs), MCP tool calling, session management, domain-locked refusal boundary, 429 rate limit backoff, `GlobalSearchBar` (Ctrl+K), and `AICopilotOverlay`. Verified via `compileall`, `npm run build`, and `git push`. |
| 4.8 | Outdoor Chain Snatching & Violent Theft Detection Engine | Backend + Docs | done | Implemented `ChainSnatchingAnalyzer` state machine, 4 FPS spatiotemporal proximity/fall/chase vector evaluation, persistent JSON config, API triggers, and full documentation at `docs/chain-snatching-api.md`. Refactored to keep kinematics OFF by default and run model-only theft/snatching class detection threshold rules. Added forensic evidence frame extraction, dynamic `[SUSPECT]` / `[VICTIM]` label mapping, and interactive Evidence Viewer Modal. Verified via `compileall` and `npm run build`. |
| 4.9 | Multi-Camera Intelligence Suite (Re-ID Journey Map & Pursuit Wave) | Fullstack | done | Implemented spatial graph (`camera_graph.py`), DAG trajectory engine (`trajectory_engine.py`), predictive pursuit manager (`pursuit_wave.py`), FastAPI router (`multicam.py`), interactive Leaflet journey map with step scrubber (`JourneyMapScrubber.tsx`), and floating pursuit HUD (`PursuitWaveHUD.tsx`). Verified via `compileall` and `npm run build`. |

| 4.10 | HCI Officer-Centric Audit Phase 1 (Toast System, Alert Badge, Search Validation & Legend, Copilot Chip Injection) | Fullstack | done | Built `useToast()` provider, 10s polling unack alert badge on sidebar, empty search validation toast, match score interpretation legend bar, and prompt chip injection into AI Copilot. |
| 4.11 | HCI Officer-Centric Audit Phase 2 (Forensic Operator Stamp, Alert Schema Migration, Bulk Ack) | Fullstack | done | Added `acknowledged_by` and `acknowledged_at` to SQLite `Alert` schema + startup migration, implemented operator timestamp stamps, bulk alert acknowledgement, and toast notifications. |
| 4.12 | HCI Officer-Centric Audit Phase 3 (Date/Time Utility, Role-Based ML Admin Gating) | Fullstack | done | Created `dateFormatter.ts` standardization module and implemented Role-Based ML Admin Gating toggle (`isAdminMode`) in sidebar. |
| 4.13 | Complete Officer-Centric HCI Upgrade Pass (Full alert/confirm elimination, formatDisplayDate adoption across all pages, Video Player keyboard controls, Dashboard 10s auto-refresh, AssaultDetection Command Center dark theme redesign) | Fullstack | done | Replaced all native `alert()` calls with `useToast()`, adopted `formatDisplayDate()` across all components, added video player keyboard controls (`Space`, `Left`/`Right` arrows), dashboard 10s auto-refresh interval, and redesigned `AssaultDetection` page in dark Command Center style. Verified via `cmd /c npm run build` and `python -m compileall`. |
| 4.14 | Full Resolution of Deep Feature Audit (`feature_audit_v2.md`) — 26 Bugs, Logical Flaws & Polish Items | Fullstack | done | Resolved all 26 audited items: fixed system jobs polling stutter & mount-only intervals, removed final `window.confirm()`, added Toast & error handling in TheftAlerts/Alerts, complete breadcrumbs generator across all 11 routes, unmount cleanup in FineTuning, Leaflet script ready guard & dynamic map center, photo search empty toast, dark forensic theme for FineTuning, centralized `api.ts`, `colors.ts`, `operator.ts`, `React.ErrorBoundary`, `Alt+1..5` keyboard shortcuts, and `sessionStorage` AI Copilot context persistence. Verified via `npm run build` (0 errors) and `git push`. |
| 4.15 | LUMPI Multi-Camera Benchmark Evaluation Suite (Stages 1–4) | Backend + Analytics | done | Integrated LUMPI dataset input contract (MIT license), built isolated `LumpiAdapter` under `backend/data/evaluation/lumpi/`, implemented `LumpiEvaluator` measuring cross-camera link precision, recall, F1, IDSW, and transit time error, and wired REST endpoints (`/evaluation/lumpi/run`, `/evaluation/lumpi/report`). Verified end-to-end via TestClient (Precision: 1.0, Recall: 0.8, F1: 0.8889). **Superseded by 4.15a** — those figures came from the synthetic sample and the real-data path had attribution/noise defects. |
| 4.15a | LUMPI evaluator correctness pass + in-product Benchmark tab | Backend + Frontend + Docs | done | Fixed: camera sessions now filtered by `experimentId` (was loading all 21 cameras across experiments); sightings attributed by projecting 3D labels through rvec/tvec/intrinsic (validated 75–78 % in-frame), with nearest-camera fallback for uncalibrated/synthetic data; embedding noise rescaled to a noise-to-signal ratio (same-object cosine was 0.43 at σ 0.05, now 0.998); handover distance measured co-temporally; DAG anchored at the query sighting; transit error measured end→start; seeded `default_rng` instead of reseeding global numpy; data-driven tuning findings; 400/404 error handling on `/run`. Added `LumpiBenchmarkPanel.tsx` as the third tab on `/multicam` (experiment picker, σ/gate/weights/handover controls, KPI tiles, per-class table, camera sessions, findings, per-target audit with red impostor hops). Measured on real LUMPI `test_data`: Exp 0 P 1.00/R 1.00, Exp 1 P 1.00/R 0.976, Exp 4 P 1.00/R 0.974, 0 IDSW. Verified via `py_compile`, direct evaluator runs, FastAPI TestClient on all three endpoints incl. error paths, and `npm run build` (0 errors). `docs/lumpi-evaluation.md` rewritten with real numbers, stress table, and demo script. |
| 4.15b | LUMPI Multi-Camera Fusion Replay — real-detector video demo on `/multicam` | Backend + Frontend + Docs | done | `app/analytics/lumpi/replay.py`: runs the registered YOLO weights (`data/models/vehicle_detector.pt` default) + `ByteTrackWrapper` on the three synchronized LUMPI clips, back-projects each box's foot point through rvec/tvec/intrinsic onto the label-derived ground plane, fuses per-camera tracks by co-temporal ground distance (2 m person / 3.5 m vehicle, ≥3 shared frames, union-find, one track per camera per identity), writes clean + annotated H.264 clips and `replay.json` under `backend/data/evaluation/lumpi/replay/exp{N}/`. Routes `GET/POST/DELETE /api/v1/multicam/replay/lumpi/...` with background-thread builds registered as System Jobs, 409 on concurrent builds, 400 on weights outside `backend/data`. `LumpiReplayPanel.tsx` = new **Fusion Replay** tab: three synced `<video>`s with canvas overlays drawn from JSON, click-to-follow across views, dim-others, frame stepping, 0.25/0.5/1× rates, bird's-eye ground-plane canvas with trails and camera positions, selection card listing fused local tracks. Measured exp 1: 8,385 dets → 123 local tracks → 70 identities (37 multi-camera) in 43 s; exp 0 built via the API in 36 s. Verified via `py_compile`, direct build, annotated-frame visual check (IDs consistent across cams 9/10), FastAPI TestClient on all routes incl. 404/409/400 and static MP4 serving, and `npm run build` (0 errors). UI verified live: backend + Vite dev server driven with headless Chromium (`/multicam?tab=replay&autoplay=1`), screenshot confirmed three synced views at f95 with aligned overlays, ground-plane map, and identity chips; letterbox-aware overlay mapping and ground-range filter (roof false positives) added after the first render. Demo script in `docs/lumpi-evaluation.md` §6. |
| 4.18 | Rename: the former pursuit feature keyword removed from the whole project (feature is now **Pursuit Wave**) + multicam reproduction guide | Fullstack + Docs | done | 131 occurrences replaced across 14 files; analytics module → `pursuit_wave.py` (`PursuitWaveManager`, `activate_pursuit_wave`), HUD → `PursuitWaveHUD.tsx`, model → `PursuitSession`, routes → `/api/v1/multicam/pursuit/*`, Copilot command → `/pursuit`, assistant tool → `activate_pursuit_wave`. Startup migration in `main.py` renames the legacy sessions table to `pursuit_sessions` in place (rows kept) and drops the legacy index names so `optimize_database` recreates them; the old table name necessarily remains inside that migration SQL only. Verified: `compileall`, `npm run build` (0 errors), TestClient boot prints the migration message, `GET /multicam/pursuit/sessions` 200 and old path 404, a case-insensitive grep over the repo finds the old keyword only in the migration. Added `docs/multicam-reproduce.md` (fresh-clone to on-stage steps for the Fusion Replay). |
| 4.16 | Facial Intelligence Suite (YOLOv8-Face, ByteTrack, CLIP/FaceNet, Qdrant Faces, VideoDetail Switcher & Global Face Search) | Fullstack | done | Implemented YOLOv8-face detection + ByteTrack tracking, separate Qdrant collection `tracenet_faces`, `FaceTracklet` schema, FaceNet/CLIP switchable embeddings, 10 REST endpoints (`/api/v1/face-search/*`, `/api/v1/videos/{id}/faces/*`), VideoDetail dual-mode canvas (#00FF41 thick boxes) + search grid, `/face-search` global page with text/image/label search, model switching/uploading, and identity tagging. Verified via `npm run build` (0 errors) and backend import smoke test. |
| 4.17 | Traffic Collision & Accident Detection Engine + Unified Alerts UI Redesign | Fullstack | done | Integrated YOLO11x accident weights (`yolo11x_epoch61.pt`), spatiotemporal persistence filter (>=3 frames), multi-vehicle collision IoU association, 3-stage keyframe extraction (Pre, Impact, Post), automated background ingestion integration in `upload.py`, emergency dispatch API (`POST /api/v1/accidents/{id}/dispatch`), and unified `/alerts` UI with multi-category tabs (`All`, `Accidents`, `Loitering`, `Abandoned`), red-glowing emergency cards, and 3-stage `CrashReconstructionModal`. Verified via `npm run build` (0 errors) and Python compileall. |
| 4.19 | Explicit colour / vehicle-type attributes (HSV extractor, query parser, boost/strict/off search, backfill) | Backend + Frontend | done | `app/attributes/color_extractor.py`, `app/search/attribute_parser.py`, `/search/parse`, `/attributes/backfill`; per-result attribute verdicts in "Why this matched", colour swatches and mode selector in `Search.tsx`. Also fixed legacy class normalisation (`pedestrain`/`two-wheeler`) that made the person/vehicle filter return nothing, and the indexer storing `tracker_id=0`. Verified with 25 pytest cases, a live backfill of 26 real tracklets, live searches against the real index, and a headless render of the Search page. Colour is a heuristic (see `docs/forensic-export-and-attributes.md`). |
| 4.20 | Forensic export bundle (clips, annotated frames, manifest, SHA256SUMS, custody log, HTML report, registry, verification, Evidence Vault UI) | Fullstack | done | `app/export/`, `app/api/exports.py`, `ForensicExport` table, `ExportDialog.tsx`, `EvidenceVault.tsx` (`/evidence`). Verified with 7 pytest cases (real ffmpeg clips, tamper / forged-hash / unregistered / invalid detection), a live export of real tracklets (clips decode, source hashes MATCH, VERIFIED, tampered copy flagged TAMPERED), and headless render of the Evidence Vault. Face redaction fails closed when no detector exists (none present in this environment, so blur on real footage is untested; the redaction logic is covered with an injected detector). Buttons in the dialog were not clicked through in a real browser. |
| 4.21 | ANPR OCR replaced with PaddleOCR (PP-OCRv5) and made switchable (PaddleOCR <-> lightweight fast-plate-ocr) from the frontend via a persisted global | Backend + Frontend | done | `app/detection/plate_ocr.py` (engine registry, `anpr_config.json`), `/anpr/ocr/config` + `/anpr/ocr/switch`, `OcrEngineSelector.tsx` on `/plates` and the ANPR page. Verified with 12+10 pytest cases (real PaddleOCR on single-row, two-row and low-res plates; real lightweight engine), and a live switch + forced re-read on real CCTV plates and switch back. Environment change: OpenCV pinned to 4.10.0.84 (PaddleX requires `opencv-contrib-python`; mixed OpenCV versions corrupt `cv2`); Paddle runs with `enable_mkldnn=False`. |
| 4.22 | Vehicle number-plate pass in the core pipeline + plates in all vehicle search results + `/plates` Vehicle Plate Search page + backfill | Fullstack | done | Pass runs between vehicle detection/tracking and embeddings/faces (`app/detection/vehicle_plates.py`, hooked in `upload.py` step 4b); one `license_plate_detections` row per vehicle tracklet with status read / blurry / not_detected (+ cutout, OCR confidence, engine), watchlist alerts, additive migration, cleanup on video delete. `plate` is attached to global search, local video search/grid and Copilot cards; `/anpr/search` (exact / estimate edit distance 1-3 / partial), `/anpr/vehicles`, `/anpr/backfill`. Verified with 31 pytest cases (143 total passing) and a real ingest of a video built from the project's real CCTV photos through `/ingest` (vehicle detector -> plates `6J05JP4199`, `GJ05JX7789` x2, one `not_detected`), live exact/estimate/partial searches, and headless renders of `/plates` and the video page grid with real plate cutouts. Not verified live: global Search page and Copilot cards (compile + API verified; Qdrant is single-process and was held by another server). Image-based plate matching intentionally NOT built (text is primary; see docs/plate-search.md). |
| 4.23 | Live Multi-Stream CCTV Control Room Wall (5 Edge Feeds, SMC Central Zone, Tunable Rolling Buffer Ingestion, Synchronized Playback, Telemetry Ticker) | Fullstack | done | Created 5 authentic Areas and CameraProfiles for Surat locations with GPS coordinates; transcoded 5 5-min AVI to 720p MP4 master assets with thumbnails; pre-sliced 25 1-min rolling buffer chunks; created `/api/v1/cctv-wall/feeds`, `/config`, `/telemetry` endpoints; built `CCTVWall.tsx` with synced master playback, canvas bounding box overlays, archival notifications, and dispatch settings modal. Verified via Python compileall and `npm run build`. |
| 4.24 | Multilingual Forensic Search & Rank (Offline Neural MarianMT + Multilingual CLIP ViT-B-32 + Indic/Latin Rule Engine) | Fullstack + AI | done | Integrated local offline multilingual models stored strictly in `backend/data/models/` (`clip-ViT-B-32-multilingual-v1` + `opus-mt-hi-en`); implemented Indic script detection (Hindi Devanagari, Gujarati, Hinglish, Gujlish), forensic CCTV phrase mapping, MarianMT neural translation pipeline, 512-dim multilingual embedding blending with English text encoder, and transparent "Why this matched" audit evidence disclosure. Updated `/api/v1/search/parse`, `SearchLog` SQLite forensic chain-of-custody logging, live translation banner, quick query chips, and result language badges in `Search.tsx`. Verified via backend test suite, live API e2e verification, and `npm run build` (0 errors). |
| 4.25 | Live streaming overhaul: live = vehicle detection only, chunk check-in runs the upload pipeline, broadcaster moved out of the dashboard, HTTPS for phones | Fullstack + Docs | done | Root causes fixed on `/cameras/<id>/live`: React dev double-mount left `isMounted=false` so WHEP never started (boxes without video); WHIP/WHEP proxy was a blocking call inside an async handler and deadlocked on MediaMTX's auth hook (now `httpx.AsyncClient`); overlay ignored letterboxing; pairing dropped the operator's config (now persisted in `pair_codes.stream_config` + migration). `StreamConfig`: `live_detector='vehicle'` (fixed `data/models/vehicle_detector.pt`), `live_alert_rules=False`, `auto_import_chunks=True`. `InferenceWorker` runs only detector+ByteTrack live; `StreamChunker` checks each chunk into the WORM store as a `VideoAsset(is_live_recording)` and calls `process_video_background` (same pipeline as `/ingest`). `/api/v1/stream/whip|whep/{cam}` proxies (MediaMTX internal), `/access-urls`; `serve.py` runs HTTP :8000 + HTTPS :8443 in one process with a self-signed LAN cert (`app/tls.py`); `dev.ps1`/`dev.bat`/`serve.ps1` launchers pinned to the venv. Frontend: `/live-connect` removed; pair dialog gained chunk length / live FPS / archive toggle + HTTPS LAN URL; live page retries WHEP, honest session labels. Verified: TestClient on pair/proxy/error paths; `serve.py` dual listeners; fake camera via ffmpeg RTSP publish → headless Chromium showed 1920×1080 video with aligned live boxes and 2 chunks checked in; `npm run build` 0 errors. Docs: `docs/live-streaming.md`. Fix 2026-10-09: `/access-urls` (and the pair-code response) advertised `https://…:8443` whenever the cert file existed, even under plain uvicorn where nothing listens on :8443 (ERR_CONNECTION_REFUSED on the phone); now probes the port (3 s cache) and falls back to the :8000 link with a "start with serve.py" note. Verified live against the running dev server with and without a throwaway listener on :8443. |
| 4.26 | Multilingual query support on every search surface (not only `/search`) | Fullstack | done | Backend: `FaceQueryEngine.search_by_text` now normalises Hindi/Gujarati/Hinglish/Gujlish to English via `normalize_query` and blends the offline multilingual CLIP vector (`encode_multilingual_query`) when the active encoder is 512-d, so `/face-search/text` (Face Search page + VideoDetail face tab) behaves like the tracklet search; the video-scoped `/search` already did. Frontend: shared `components/MultilingualQueryHint.tsx` (`useQueryParseMeta` hook → `/api/v1/search/parse`, live banner, `MultilingualBadge`) wired into `VideoDetail.tsx` (tracklet search + face search) and `FaceSearch.tsx` (text tab), with the MULTILINGUAL badge in each results header; `Search.tsx` keeps its original inline implementation. Merge: upstream's OpenRouter-key hardening (`_openrouter_key()` from `backend/.env`, `extra='forbid'`, no key in browser storage) kept while preserving the `offline_ai` backend and model-health fields. Verified: `py_compile`, TestClient Hindi queries on `/search/parse`, `/search` (video-scoped) and `/face-search/text`, `npm run build` 0 errors. |
| 4.27 | UI consistency pass with the installed design skills (DESIGN.md compliance, shared primitives) | Frontend | done | Audit-first (design-taste-frontend §11): screenshots of Dashboard/Cameras/Search/Alerts in both themes + a mechanical scan (radius, shadows, heading scale, spinners, inline SVGs). Design read: redesign-preserve of a dense trust-first forensic dashboard on the project's own `DESIGN.md` tokens; the landing-page rules were not applied (`Landing.tsx` is unrouted). Added `components/ui/index.tsx`: `PageHeader`, `Panel`, `StatTile`, `StatusBadge`, `Skeleton`/`SkeletonText`/`TableSkeleton`/`CardSkeleton`, `EmptyState`, `Button`/`buttonClass`, shared tone maps and focus ring. Adopted `PageHeader` on Dashboard, Cameras, Search, Alerts; Alerts KPI tiles → `StatTile` (consistent weights, tone for unacknowledged/theft, drill-down links), spinner → `TableSkeleton`/`CardSkeleton`, analysis cards no longer pinned to 190px. Cameras: 16 hand-drawn SVG icons replaced with lucide (`MapPin`, `Plus`, `ChevronRight`, `MoreVertical`, `Eye`, `Pencil`, `Link2`, `Trash2`, `X`, `AlertTriangle`, `Info`, `Loader2`) with `aria-hidden`; map and table widened to the header width. 64 `rounded-xl/2xl` uses normalised to the 4px scale on 16 operator pages; Search containers lose `shadow-sm`; `.surface` radius 10→6px; `prefers-reduced-motion` rule in `index.css`; top-bar job pill shows 28 chars. Verified: `npm run build` 0 errors; headless Chromium screenshots of Alerts (light+dark), Cameras and Search after the change. Not touched: dark command-centre pages (Multicam, CCTV Wall, Assault), modals. |

### Phase 5 — Polish & Demo Prep

| # | Task | Owner/Layer | Status | Notes |
|---|---|---|---|---|
| 5.1 | End-to-end test with real sample video (full pipeline: upload → search → results → playback) | All | not started | Do not consider MVP done until this passes |
| 5.2 | Curate demo query set (known good queries that return clean results) | All | not started | |
| 5.3 | `docs/scalability.md` — production architecture writeup (edge processing, tiered storage, Kafka) for pitch, not implementation | Docs | not started | Reference the architecture diagram already agreed on |
| 5.4 | README with setup/run instructions | Docs | not started | |
| 5.5 | Error handling pass (empty results, failed uploads, malformed queries) | Backend + Frontend | done | Verified empty search query toast warnings, duplicate target tagging prevention, and server status auto-recovery. |
| 5.6 | `docs/detection-tracking-api.md` — detection/tracking API quick guide and model placement | Docs | done | Added a short operator guide for `best.pt`, the detection endpoints, and the frontend review flow. |
| 5.7 | `docs/loitering-detection.md` — zone-selection and alert-review operator guide | Docs | done | Added a concise operator/developer guide covering upload opt-in, manual polygon selection, evidence review, API endpoints, and guardrails. |
| 5.8 | Interactive Pipeline Status Pill & Task Queue Modal | Fullstack | done | Integrated `SystemJob` DB model, crud helper hooks, FastAPI status API, clickable header status pill, auto-updating animation, queue list modal, and instant no-animation route navigation. Verified via `compileall` and `npm run build`. |
| 5.9 | Shared S3 golden-snapshot sync (`python -m app.storage.sync check/status/push/pull`) | Backend + Docs | done | `app/storage/` (content-addressed blobs + manifest commit, SQLite backup-API snapshot, DB path rebasing to the local `backend/data`, secret/machine-local exclusions, server-running guard, pre-pull backup), Windows-root CA bundle for TLS-scanning antivirus (truststore rejected: thread-unsafe verification on Windows). Verified live against the real bucket under a throwaway `_selftest/` prefix: 2,445-file push, pull into a clean dir (all hashes identical, 889 `D:\` paths rebased, Qdrant 2,432 points, integrity ok), idempotent re-push, 1-file incremental push, `status` outdated detection, guards; badssl.com rejection tests; 3 offline pytest cases. Test objects deleted afterwards. Real golden push not yet done (owner: golden machine). |
| 5.10 | Uploads fixed + S3-primary media store with local fallback (videos + models) | Backend + Docs | done | Root cause: the registered model's `file_path` pointed at another machine (`D:\Aayush\...`). Added `resolve_model_file` (stored path -> rebased local path -> S3) used by ingest, re-runs, `load_detection_model`, plates, live worker and LUMPI replay, plus `resolve_camera_detection_model` fallbacks (default -> registry -> bundled `best.pt`). Ingest archives original (+SHA-256 metadata) and 720p video to S3 in the background; model uploads go to S3; missing files are fetched on demand; `/videos/{id}/stream` 307-redirects to a SigV4 presigned URL when not cached; deletes remove S3 copies; golden snapshot no longer duplicates media. Verified: 3 real uploads to CAM_002 with no workaround, S3 objects + content types + metadata checked, local copies removed -> stream redirect (206 range) + byte-identical re-fetch, deletes leave 0 objects; 7 offline tests with a fake S3; 16-thread / 6-process client race test. |
| 5.11 | Person/vehicle filter: normalise 230 legacy tracklets (`HCV`, `LCV`, `Three-wheeler` object_type) | Backend | done | `normalize_legacy_object_types` (Qdrant payload first, then SQLite; idempotent) runs in the startup hook. Verified live: 'truck' + vehicle filter went from 0 to 37 HCV results; second start normalises 0 rows. |
| 5.12 | Journey Map rewrite: anchored, distinctiveness-based, spatio-temporally feasible | Backend + Frontend | done | Measured CLIP image-image similarity: different people score 0.86-0.96, so absolute thresholds cannot re-identify. New engine anchors on the chosen sighting, keeps a camera only when its best sighting stands out (robust z >= 2.5) and beats a different-pass runner-up, then grows the route through feasible camera changes in recording time; reports `rejected_cameras` with reasons. Also fixed missing imports (`uuid`, `os`, `get_data_path`) and a dead CLIP fallback; Hot Targets journey panel was always empty (read `trajectory` instead of `journey_steps`). Verified with 3 ground-truth synthetic tests (true route found, look-alikes / 50 km teleport / ambiguous camera rejected, split track handled) and live API on real data (origin always included, no fabricated hops). |
| 5.13 | Copilot: deterministic off-topic guard, Hinglish support, broken read tools | Backend | done | `app/assistant/guard.py` refuses clear off-topic requests before any LLM call; LLM prompt no longer contains a refusal sentence (qwen2.5:3b copied it and refused valid questions); Hindi/Gujarati/Hinglish messages get an English rendering. Fixed `execute_tool` local-import shadowing that crashed `list_cameras`, `get_camera_details`, `get_dashboard_metrics`, `list_models`, `assign_camera_model`. Verified: 29 guard tests; live Ollama run 10/10 in-domain answered (incl. Hinglish) and 4/4 off-topic refused in 0.0 s. |
| 5.14 | Secrets: copilot API key never sent to the browser; OpenRouter key only from `backend/.env` | Backend + Frontend | done | `GET /assistant/config` returns `cloud_api_key_set` + last-4 hint; blank key on save keeps the stored one, explicit remove option. `/search/multilingual/config` rejects unknown fields (422 on a key) and reads `OPENROUTER_API_KEY` from settings; Language page shows configured/not-configured and clears any key left in localStorage. Verified live (GET masked, POST keeps key byte-identical, 422 / 200) and `npm run build`. |
| 5.15 | Vector index: no silent in-memory fallback when the Qdrant folder is locked | Backend | done | Reverted the local-only fallback (empty searches + vectors lost on restart); now raises a clear error naming the likely second process. |
| 5.16 | Copilot write tools require officer confirmation | Fullstack | done | `app/assistant/confirmations.py`: `assign_camera_model`, `trigger_video_reindex`, `tag_hot_target`, `activate_pursuit_wave`, `analyze_chain_snatching`, `detect_assault` are only *proposed* by the LLM (stored server-side, 15 min expiry, plain-language summary with names resolved); missing required arguments go back to the model as "ask the user". `POST /api/v1/assistant/actions/{id}/confirm|cancel` runs only the stored arguments, at most once, writes a `copilot_action` audit entry and records the outcome in the chat session; the overlay shows a Confirm / Cancel card. A test fails if a new tool outside the read-only prefixes is not classified. Verified: 8 tests, and live with qwen2.5:3b (the earlier "Which model is assigned to CAM_004?" now answers read-only; explicit assign proposed -> cancel no change -> confirm applied once, 2nd confirm 404, audit + session recorded). Card UI compiled, not clicked through in a browser. |
| 5.17 | Light-theme support for the four dark-only surfaces (Language Settings, CCTV Stream Wall, LUMPI Benchmark, Fusion Replay) | Frontend | done | These files had zero `dark:` variants, so they stayed slate-950 under the light theme. Converted 236 lines to light-first classes with the original token kept as the `dark:` variant (surfaces slate-100/white/slate-50, 400-weight accent text -> 700, white text kept only on solid coloured buttons); overlays drawn on top of `<video>` and the ground-plane canvas intentionally stay dark. Verified: `npm run build` (0 errors) and headless Chromium light-theme renders of `/language-settings`, `/cctv-wall`, `/multicam?tab=benchmark`, `/multicam?tab=replay`. Dark theme unchanged by construction. |

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
- **End-to-end smoke test (task 5.1) is the critical gate**: Phase 1 UI and backend
  are built and compile-verified, but full pipeline (upload → preprocess → CLIP embed
  → FAISS search → result display) has not been run end-to-end yet. Do not start
  Phase 3 search work until the Phase 2 detection/embedding outputs are confirmed.
- **Frontend architecture note — Leaflet + modals**: Any future page that renders a
  Leaflet map AND modals must apply `style={{ isolation: 'isolate' }}` to the map
  container. Omitting this causes Leaflet's internal z-index panes (200–650) to bleed
  above `position:fixed` overlays in the page root stacking context.
- ~~**Copilot write tools need confirmation**~~ — resolved in task 5.16.
- **Tab ordering contract**: On `/cameras/[id]`, the System Preprocessing tab is
  always first and default. The Original Audit tab is second and labeled BACKUP. All
  future pipeline modules (detection, embeddings, search) must operate on the
  standardized/transcoded output (system tab), never on the raw original file.

---

## 9. Rules for Agents Editing This File

- Never delete completed task rows — this file is the project's audit trail.
- If you discover a task is bigger than scoped, split it into sub-rows (e.g. 2.4a,
  2.4b) rather than silently expanding scope under one row.
- If you deviate from the tech stack in Section 3, you must update Section 3 and
  explain why in the Notes column of the relevant task row.
- If blocked, set status to `blocked` and add the reason to Section 8, not just in
  the task's Notes column.
