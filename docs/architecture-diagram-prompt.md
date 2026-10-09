# Prompt: detailed architecture diagram of TraceNet (DRISHTI)

Paste everything below the line into a diagramming assistant (Eraser AI, Excalidraw text-to-diagram, Lucidchart AI, Mermaid-capable LLM) or an image model. It is written from the code on `main` as of 2026-10-09, so every component named here exists in the repository.

---

Create a detailed, presentation-quality system architecture diagram for **TraceNet (DRISHTI)**, an AI-driven forensic video search and multi-camera intelligence platform for a smart-city police department. Audience: hackathon judges and police IT reviewers. Style: clean technical diagram on a white background, left-to-right data flow, swim-lane style layers stacked top to bottom, one accent colour (teal #0F766E) for TraceNet-owned components, grey for third-party services, amber (#D97706) for alert paths, dashed lines for optional or cloud paths, solid lines for the default offline path. Label every arrow with what travels over it. Include a legend. Use real component names exactly as given. Do not add components that are not listed.

## Layer 1: Clients (top)

- **Operator dashboard**: React 18 + TypeScript + Vite + Tailwind, served on port 5173 in development. Pages: Situation Overview, Areas, Cameras, Camera Detail, Video Detail, CCTV Stream Wall, Live Camera View, Search & Investigate, Vehicle Plate Search, Facial Intelligence, Evidence Vault, Multi-Cam Intelligence (Journey Map, Pursuit Wave, Fusion Replay, LUMPI Benchmark), Pursuit & Hot Targets, Unified Alert Center (abandoned, theft, assault, plates, collisions), Frame Inspection, Models, Embedding Config, Fine-Tuning, Language Settings (EN / HI / GU). A global AI Copilot overlay (Ctrl+K).
- **Edge camera app**: a static page served by the backend at `/camera-app` over HTTPS port 8443, opened on a phone. Pairs with a 6-digit code, captures the phone camera with WebRTC, publishes via WHIP.
- **External systems**: webhook consumers (SIEM, messaging), Prometheus/Grafana scraping `/metrics`.

## Layer 2: API and realtime edge (TraceNet backend)

- **FastAPI application** (`app.main`), one process serving HTTP :8000 and HTTPS :8443 via `serve.py`; CORS open for LAN; startup auto-migrations on SQLite; serves `/data` static files and the camera app.
- Routers (draw as a row of boxes inside the API): cameras, areas, upload/ingest, processing queue, detections, search (text, image, multilingual config, parse), attributes, face-search, ANPR/plates (+ watchlist), alerts (loitering, abandoned, chain-snatching), assault-detection, accident-detection (+ dispatch), frame-inspection, exports (sealed bundles, verify), reports (PDF), audit, analytics, metrics, models + embedding-models + finetuning, multicam (trajectory, hot targets, pursuit wave, LUMPI evaluation, LUMPI replay), streaming (pair codes, WHIP/WHEP proxy, WebSocket telemetry), cctv-wall, webhooks, system-jobs, assistant (copilot), health.
- **Live streaming subsystem** (draw as its own box beside the API): **MediaMTX** media server (internal only: WebRTC :8889, RTSP :8554, ICE UDP :8189) with an auth hook back into the API; **StreamManager** holding per-camera **InferenceWorker** (reads RTSP, runs the vehicle/pedestrian detector + ByteTrack at a configured FPS, broadcasts boxes over a WebSocket) and **StreamChunker** (FFmpeg segments the RTSP feed into 15 to 120 second chunks and checks each chunk into the archive as a normal video). The browser never talks to MediaMTX directly: WHIP (publish) and WHEP (play) are proxied through the API.
- **AI Copilot engine**: provider-agnostic LLM client (Ollama local by default; OpenAI, Groq, DeepSeek, OpenRouter optional via `backend/.env`), tool-calling into the search, alerts, cameras and pursuit routers, deterministic off-topic guard, officer confirmation gate for every write tool.

## Layer 3: Processing pipeline (background workers, drawn as a left-to-right chain)

Triggered by an upload or a checked-in live chunk, run as background tasks tracked as **System Jobs**:

1. **Intake**: SHA-256 hash of the original file, stored in the WORM-style media store (`minio_mock`, mirrored to S3 when configured).
2. **VideoPreprocessor**: FFmpeg transcode to 720p H.264 at 10 FPS, OpenCV 4-FPS frame sampling, thumbnail.
3. **DetectionService**: YOLO (Ultralytics, per-camera assigned weights, default `vehicle_detector.pt`) + **ByteTrack** (supervision) producing tracklets with best crops.
4. **Vehicle plate pass**: plate detector on every vehicle tracklet, OCR with PaddleOCR PP-OCRv5 or the lightweight fast-plate-ocr fallback, read / blurry / not-detected states, watchlist matching.
5. **TrackletEmbeddingService**: CLIP ViT-B-32 image embeddings (512-d), BLIP captions, HSV colour and vehicle-type attributes; upsert into Qdrant.
6. **Face pass**: YOLOv8-face + ByteTrack, FaceNet or CLIP embeddings into a separate face collection.
7. **Accident pass**: YOLO11 collision model with 3-stage keyframe extraction.
8. **Alert engines** (amber): loitering (polygon zones, dwell threshold), abandoned object, chain-snatching / theft state machine, assault detection, plate watchlist hits, collision alerts; each writes Alerts, evidence frames, and fires registered webhooks.

## Layer 4: Search and intelligence services (draw between API and storage)

- **Query engine**: natural-language query → `multilingual.py` (script/language detection; offline MarianMT Hindi→English; Gujarati/Hinglish/Gujlish lexical engine; optional OpenRouter) → attribute parser (colour, vehicle type, verifiable vs unverifiable) → CLIP text vector blended with the multilingual CLIP vector → Qdrant similarity → metadata filters (camera, time, type, video) → per-result explanation ("why this matched") → audit log entry.
- **Image search**: reference photo → CLIP image vector → same index.
- **Face query engine**: text, photo or label → face collection.
- **Plate search**: text lookup over plate detections with fuzzy matching.
- **Multi-camera engine**: **CameraSpatialGraph** (Haversine distances, speed envelopes per class), **TrajectoryEngine** (anchored, distinctiveness-scored, spatio-temporally feasible journey; auto-selects the active hot target when no ID is given), **HotTargetManager** (registry, reappearance tracking), **PursuitWaveManager** (predicted downstream cameras), **LUMPI** adapter / evaluator / fusion replay (calibrated ground-plane fusion for the benchmark dataset).
- **Forensic export**: sealed bundles (clips, annotated frames, manifest, SHA256SUMS, custody log, HTML report), server-side and upload-based verification, face blurring of non-matched faces; **PDF crime reports**.

## Layer 5: Storage (bottom)

Everything lives under `backend/data/` on one workstation:

- **SQLite `drishti.db`** via SQLAlchemy with startup migrations. Tables: areas, cameras, videos, tracklets, face_tracklets, license_plate_detections, plate_watchlist, alerts, live_alerts, loitering_zones, hot_targets, pursuit_sessions, live_stream_sessions, stream_chunks, pair_codes, models, model_execution_logs, search_logs, crime_reports, forensic_exports, webhooks, chat_sessions, system_jobs.
- **Qdrant (embedded, on disk, `vector_db/`)**: collection `tracenet_tracklets` (512-d CLIP) and `tracenet_faces`.
- **Media and artefacts**: `minio_mock/` originals, `cameras/<id>/` transcoded videos, `processed/` crops, thumbnails, detections, plates, faces, accidents, `streams/` live chunks, `exports/` sealed bundles, `audit_logs/`.
- **Models**: `models/` (YOLO weights per task, `multilingual_clip/`, `translation_hi_en/`, accident model), `evaluation/lumpi/` benchmark data and replays, `certs/` self-signed TLS, `mediamtx/` binary.
- **Optional cloud (dashed)**: S3 bucket as primary media store with local fallback, plus a "golden snapshot" sync of DB + index between team machines.

## Cross-cutting (draw as a vertical band on the right)

Human-in-the-loop: nothing auto-declares an identity. Every search logged with query, language, filters, result count. SHA-256 at intake and on export. RBAC module. Prometheus metrics. i18n in three languages. Offline-first: all models local, no internet required.

## Key flows to show as numbered arrows

1. Phone → HTTPS :8443 → pair code verify → WHIP (proxied) → MediaMTX → InferenceWorker → WebSocket boxes → Live Camera View; StreamChunker → chunk check-in → pipeline.
2. Upload → intake hash → preprocess → detection/tracking → plates → embeddings → faces → accidents → alerts → webhooks.
3. Operator query (Hindi) → multilingual normalisation → CLIP + attribute filters → Qdrant → ranked results with explanations → audit log → tag as hot target.
4. Hot target → TrajectoryEngine across cameras → Journey Map; PursuitWave alerts downstream cameras.
5. Result → sealed export bundle → verification → PDF report.

Output requirements: one page, landscape, readable at A3; group components in labelled containers; show ports on the network edges (5173, 8000, 8443, 8889, 8554, 8189); keep third-party names in grey (FastAPI, React, SQLite, Qdrant, MediaMTX, FFmpeg, Ultralytics YOLO, ByteTrack, CLIP, BLIP, PaddleOCR, MarianMT, Ollama, Prometheus, S3).
