# 🔍 TraceNet — AI-Driven Descriptive Search for Smart City CCTV

> **Hackathon Submission · Problem Statement ERH26_PS_07 — Digital Forensics / AI Video Analytics**

TraceNet is an AI-powered forensic surveillance platform that transforms passive CCTV infrastructure into an active investigative tool. Instead of an officer manually scrubbing through hours of footage, they type a natural-language description of a person or vehicle and get ranked, time-stamped, explainable results across an entire camera network — in seconds.

> *"Man in a red jacket carrying a black backpack near Gate 3 after 5 PM."*

The platform is designed for the **day-to-day operational reality of a police surveillance team** — prioritising speed of investigation, evidentiary integrity, human-in-the-loop confirmation, and a forensic command-centre aesthetic built for shift-long use.

---

## 📐 System Architecture

### Pipeline Flow Architecture

The diagram below shows the 7 functional subsystems that form the TraceNet processing pipeline — from raw camera feed all the way to investigative search results and multi-camera command intelligence.

![TraceNet Pipeline Flow Architecture](./flow%20arch%20of%20project.jpeg)

| # | Subsystem | Core Function |
|---|---|---|
| 01 | **Streaming & Ingestion** | RTSP/SRT live feeds + batch video ingest with forensic SHA-256 hashing |
| 02 | **Vision** | YOLOv11 object detection · ByteTrack multi-object tracking · Motion & trajectory extraction |
| 03 | **Identity & Semantic Intelligence** | CLIP visual embeddings · BLIP auto-captioning · LLM scene reasoning · Cross-camera Re-ID |
| 04 | **Threat & Event Intelligence** | Loitering / dwell-time · Theft / chain-snatching · Assault/fight · Abandoned objects · Suspect reappearance |
| 05 | **Search & Forensics** | NL query search · Visual / missing-person reverse photo search · Evidence export with integrity manifest |
| 06 | **Command & Multi-Camera Intelligence** | Security command centre · GIS pursuit map · Sentinel Wave predictive camera handoff · Real-time alerts |
| 07 | **Security, Privacy & Evidence Integrity** | Secure communication · Immutable audit logs · Chain-of-custody SHA-256 verification |

---

## 🎯 Feature Overview

### 🔵 Ingestion & Preprocessing
- **Batch video upload** — supports `.mp4`, `.avi`, `.mov`
- **Live WebRTC streaming** — WHIP/WHEP via MediaMTX; browser or mobile device broadcaster at `/live-connect`
- **FFmpeg transcoding** — standardises all inputs to 720p / 10 FPS H.264
- **OpenCV 4-FPS timeline-proportional frame sampling** — zero disk-write overhead
- **SHA-256 forensic intake hash** on every uploaded asset for chain-of-custody
- **Progressive ingestion status** — `pending → transcoding → preprocessed → indexing → complete` with live progress bars
- **System Job queue** — clickable status pill in topbar shows active pipeline jobs

### 🟣 Detection & Tracking
- **YOLOv8/v11 person + vehicle detection** with custom-trained weights (`best.pt`)
- **ByteTrack** consistent cross-frame track IDs via `supervision` library
- **Tracklet extraction** — frame range, timestamp, best bounding-box crop, confidence score
- **CLIP 512-dim visual embedding** per tracklet (best-crop)
- **BLIP auto-captioning** per tracklet (`Salesforce/blip-image-captioning-base`)
- **Annotated video export** — server-side bounding-box render to MP4

### 🟢 Search & Investigation (`/search`)
- **Natural language text search** — CLIP text embedding → Qdrant vector similarity → ranked results
- **Reverse photo search** — drag-and-drop reference image → CLIP image-to-image similarity
- **Multi-filter matrix** — camera nodes, time range, object type (person / vehicle)
- **Explainability panel** — per-result "Why this matched" breakdown (CLIP score, detector confidence, caption overlap, unverified terms, applied filters)
- **Hot-Target tagging** — pin any result as a pursuit target directly from search
- **SHA-256 evidence export** — client-side hashed compliance report download
- **Search audit logging** — every query logged to SQLite `search_logs` with operator ID, timestamp, result count
- **Per-video scoped search** — CLIP search limited to a single video in the Video Detail view

### 🟡 Alert Center (`/alerts`)
- **Unified Alert Dashboard** — filterable by type, camera, acknowledgement status; bulk-acknowledge
- **Loitering / Dwell-Time Detection** — user-drawn polygon zones, configurable dwell threshold (seconds), bottom-centre tracking, grace-gap deduplication
- **Outdoor Theft / Chain-Snatching Detection** — state-machine analyser, spatiotemporal proximity / fall / chase vectors, forensic evidence frame extraction, SUSPECT/VICTIM label mapping
- **Physical Assault Detection** — YOLO class-based detection, 7-day statistics, per-frame confidence timeline drill-down
- **Abandoned Object Detection** — configurable abandon time and visitor-radius parameters
- **Operator acknowledgement stamp** — operator ID + timestamp on every resolved alert
- **Real-time alert badge** — sidebar unacknowledged count with live polling

### 🔴 Pursuit & Multi-Camera Intelligence (`/targets`)
- **Hot Targets registry** — label, priority (NORMAL / HIGH / CRITICAL), status (active / resolved), reappearance tracking
- **Journey Map** — interactive Leaflet multi-camera trajectory scrubber with timeline step navigation
- **Sentinel Wave Pursuit HUD** — floating predictive downstream-camera handoff panel; monitors adjacent nodes in real-time
- **Cross-camera Re-ID** — CLIP embedding similarity through spatial graph DAG trajectory engine
- **Tag from search or video detail** — one-click pursuit target assignment anywhere in the platform

### 🟣 Live Streaming
- **LiveCameraView** (`/cameras/:id/live`) — real-time WHEP player with canvas annotation overlay, pair-code QR system, skeleton pose keypoints, telemetry sparklines (FPS, inference ms, latency), chunk pipeline logs
- **Live Broadcaster Console** (`/live-connect`) — browser WebRTC WHIP broadcaster with configurable inference FPS, chunk duration, and auto-import to indexing pipeline

### 🔵 Forensic Reports (`/api/v1/reports`)
- **Automated PDF crime report generation** — per-alert incident reports with severity classification, evidence frame attachments, chain-of-custody tagging, assigned operator fields
- **Compliance audit trail** — `GET /audit/search-history`, `GET /audit/alert-history`, `GET /audit/compliance-report`
- **Evidence export with integrity hash** — SHA-256 signed compliance bundles downloadable from Search page

### 🟢 AI Copilot (`Ctrl+K`)
- **Global search bar** — launches from anywhere in the app
- **Full-screen AI overlay** — multi-session conversation sidebar with history
- **Ollama support** — local models (`qwen2.5:3b`) for fully offline operation
- **Cloud LLM support** — OpenAI, Groq, DeepSeek, OpenRouter via configurable API key
- **MCP tool calling** — domain-locked assistant can query the live search API, alert system, and camera registry
- **Session persistence** — conversation history survives overlay open/close via `sessionStorage`
- **Quick prompt chips** — pre-loaded investigative queries on the Dashboard

### 🟣 ML Admin (Admin-Gated)
- **Detector Model Registry** (`/models`) — upload `.pt` weights, auto-parse YOLO class names, per-camera assignment, execution logs
- **CLIP Embedding Config** (`/embedding-models`) — model swap configuration
- **YOLO Fine-Tuning** (`/finetuning`) — training job submission, live polling, history log
- **Role-based gating** — LOCKED / UNLOCKED sidebar toggle restricts ML admin routes from officer view

### 🟡 HCI & Operator Experience
- Forensic Command Centre dark-mode aesthetic (default)
- `Alt+1..5` global keyboard shortcuts for rapid navigation
- Toast notification system replacing all native `alert()` / `confirm()` dialogs
- `ErrorBoundary` wrapping all routes — crash isolation per-route
- Standardised `formatDisplayDate()` across all timestamps
- Breadcrumb navigation for all 11+ routes
- Collapsible sidebar with icon-only collapsed mode

---

## 🛠️ Tech Stack

### Backend

| Layer | Technology |
|---|---|
| API Framework | FastAPI + Pydantic + Uvicorn |
| Database ORM | SQLAlchemy + SQLite (`drishti.db`) with startup auto-migrations |
| Video Processing | OpenCV (`cv2`), FFmpeg (`ffmpeg-python`) |
| Object Detection | Ultralytics YOLOv8/v11 (`best.pt`) |
| Object Tracking | ByteTrack via `supervision` library |
| Visual Embeddings | CLIP (`open-clip-torch`, `ViT-B/32`) |
| Auto-Captioning | BLIP (`transformers`, `Salesforce/blip-image-captioning-base`) |
| Vector Database | Qdrant (local persistent client) |
| Live Streaming | MediaMTX (WHIP / WHEP / SRT / RTMP) |
| PDF Reports | ReportLab |
| Logging | Loguru |
| ML Framework | PyTorch ≥ 2.5, torchvision ≥ 0.20 |

### Frontend

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Styling | TailwindCSS |
| Routing | React Router v7 |
| Maps | Leaflet + react-leaflet |
| Icons | Lucide React |
| Live Streaming | WebRTC (WHIP / WHEP native browser APIs) |
| HTTP | Native `fetch` (centralised via `src/config/api.ts`) |

---

## 📁 Repository Structure

```
TraceNet/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entrypoint + startup auto-migration runner
│   │   ├── api/                     # All API routers (22 files)
│   │   │   ├── cameras.py           # Camera CRUD
│   │   │   ├── upload.py            # Video ingest + background processing pipeline
│   │   │   ├── search.py            # NL + photo search endpoints
│   │   │   ├── alerts.py            # Loitering / theft / assault / abandoned alerts
│   │   │   ├── streaming.py         # WebRTC WHIP/WHEP live streaming
│   │   │   ├── reports.py           # PDF crime report generation
│   │   │   ├── audit.py             # Search + alert audit trail
│   │   │   ├── multicam.py          # Multi-camera trajectory + Sentinel Wave
│   │   │   ├── assistant.py         # AI Copilot (Ollama / Cloud LLM + MCP)
│   │   │   ├── models.py            # YOLO model registry
│   │   │   ├── detections.py        # Tracklet inspection endpoints
│   │   │   ├── assault_detection.py # Assault statistics + alerts
│   │   │   ├── metrics.py           # Dashboard metrics aggregation
│   │   │   └── system_jobs.py       # Pipeline job queue
│   │   ├── alerts/
│   │   │   ├── loitering.py         # Dwell-time polygon zone analyser
│   │   │   └── chain_snatching.py   # Violent theft / snatching state machine
│   │   ├── analytics/
│   │   │   ├── camera_graph.py      # Spatial adjacency graph
│   │   │   ├── trajectory_engine.py # DAG-based cross-camera trajectory
│   │   │   ├── sentinel_wave.py     # Predictive pursuit manager
│   │   │   └── hot_target.py        # Hot target manager
│   │   ├── embeddings/
│   │   │   ├── clip_encoder.py      # CLIP visual embedding extractor
│   │   │   ├── captioner.py         # BLIP auto-captioning
│   │   │   └── tracklet_embeddings.py
│   │   ├── detection/
│   │   │   ├── detector.py          # YOLOv8/v11 detection wrapper
│   │   │   ├── tracker.py           # ByteTrack wrapper
│   │   │   └── weights/best.pt      # Model weights
│   │   ├── search/
│   │   │   ├── vector_index.py      # Qdrant index service
│   │   │   ├── query_engine.py      # Hybrid NL search logic
│   │   │   └── image_search.py      # CLIP image-to-image search
│   │   ├── streaming/               # MediaMTX integration + chunker + inference worker
│   │   ├── reporting/               # PDF report generator (ReportLab)
│   │   ├── preprocess/              # FFmpeg + OpenCV pipeline
│   │   ├── db/
│   │   │   ├── models.py            # SQLAlchemy ORM models
│   │   │   ├── crud.py
│   │   │   └── session.py
│   │   ├── assistant/               # Ollama / Cloud LLM + MCP tool calling
│   │   └── config.py                # Centralised data path resolver (get_data_path)
│   ├── data/                        # ALL runtime data (auto-created on first launch)
│   │   ├── drishti.db               # SQLite database
│   │   ├── minio_mock/              # Raw uploaded video files
│   │   ├── processed/               # Transcoded MP4s, tracklet crops, frames
│   │   ├── vector_db/               # Qdrant persistent collection
│   │   └── audit_logs/              # Daily JSONL audit files
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Central routing, state, sidebar, modals
│   │   ├── pages/                   # 18 page components
│   │   ├── components/              # Shared UI components
│   │   ├── config/
│   │   │   ├── api.ts               # Centralised API_BASE constant
│   │   │   └── operator.ts          # DEMO_OPERATOR identity constant
│   │   └── utils/
│   │       ├── colors.ts            # classColor() for detection class colouring
│   │       └── dateFormatter.ts     # formatDisplayDate() standardisation
│   └── package.json
│
├── docs/
│   ├── scalability.md               # Production city-scale architecture
│   ├── preprocess-api.md
│   ├── detection-tracking-api.md
│   ├── loitering-detection.md
│   ├── chain-snatching-api.md
│   └── embeddings-api.md
│
├── flow arch of project.jpeg
├── proposed technical architecture at scale.jpeg
└── AGENTS.md
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- FFmpeg installed and on `PATH` (verify: `ffmpeg -version`)
- (Optional) CUDA-capable GPU for faster YOLO + CLIP inference

### Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**URLs:**
| Endpoint | URL |
|---|---|
| REST API | `http://localhost:8000` |
| Swagger UI | `http://localhost:8000/docs` |
| ReDoc | `http://localhost:8000/redoc` |
| Health check | `http://localhost:8000/health` |

> **Note:** All data (SQLite DB, video files, vector index, audit logs) is stored under `backend/data/`. The directory structure is created automatically on first launch. The server also runs startup auto-migrations on every boot — existing data is preserved.

### Frontend Setup

```bash
cd frontend

npm install

npm run dev
```

**Frontend URL:** `http://localhost:5173`

---

## 🎬 Demo Walkthrough

### 1. Register a Camera Node
`/cameras` → **Register Camera** → enter Camera ID (e.g. `CAM_001`), name, lat/lon coordinates, and optionally assign a YOLO detector model.

### 2. Upload a CCTV Video
Camera Detail page → **Ingest Video** → select a video file → optionally enable **Loitering Zone Detection** with a polygon zone and dwell threshold → upload.

The pipeline runs automatically in the background:
```
Upload → FFmpeg transcode (720p/10FPS) → OpenCV frame sampling (4FPS)
→ YOLOv8 detection → ByteTrack tracking → CLIP embedding → BLIP captioning
→ Qdrant vector upsert → Status: complete
```

### 3. Search for a Person or Vehicle
`/search` → type a natural-language description (e.g. `"person in blue hoodie near the entrance"`) → filter by camera nodes and time range → run search.

Results show: thumbnail crop, CLIP similarity score, camera + timestamp, BLIP caption, and a "Why this matched" explainability panel.

### 4. Tag a Suspect for Pursuit
On any search result → **Tag as Hot Target** → assign label and priority → the suspect is registered in the Pursuit registry and monitored via **Sentinel Wave** across adjacent camera nodes.

### 5. Review Alerts
`/alerts` → review loitering, theft, and assault alerts → click any alert to view evidence frames, tracklet timeline → acknowledge with operator stamp.

### 6. Live Monitoring
- **Watch Live** — `/cameras/:id/live` — real-time WebRTC stream with bounding-box overlays and performance telemetry.
- **Broadcast from Browser** — `/live-connect` — broadcast from this device's camera into the inference pipeline via WebRTC WHIP.

---

## 📡 Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/cameras` | List all camera nodes |
| `POST` | `/api/v1/cameras/create-new-camera` | Register a camera |
| `POST` | `/api/v1/ingest` | Upload and process a CCTV video |
| `POST` | `/api/v1/search` | Natural language search |
| `POST` | `/api/v1/search/image` | Reverse photo search |
| `GET` | `/api/v1/alerts` | List all alerts (filterable by type, camera, status) |
| `PUT` | `/api/v1/alerts/{id}/acknowledge` | Acknowledge an alert |
| `POST` | `/api/v1/multicam/trajectory/reconstruct` | Reconstruct cross-camera trajectory |
| `POST` | `/api/v1/multicam/targets/tag` | Tag a suspect as hot target |
| `POST` | `/api/v1/stream/start` | Start a live stream session |
| `POST` | `/api/v1/stream/pair/generate` | Generate a mobile device pair code |
| `POST` | `/api/v1/reports/generate` | Generate a PDF crime report |
| `GET` | `/api/v1/audit/compliance-report` | Get system compliance report |
| `GET` | `/api/v1/metrics/dashboard` | Get dashboard metrics |
| `GET` | `/api/v1/jobs` | Get system job queue status |

Full interactive documentation: `http://localhost:8000/docs`

---

## 🏗️ Architecture at Scale

For the proposed city-scale production architecture (edge node processing, GPU worker pools, Qdrant cluster, PostgreSQL + pgvector, MediaMTX cluster, AWS S3 tiered storage), see:

📄 **[`docs/scalability.md`](./docs/scalability.md)**

![Proposed Production Architecture at Scale](./proposed%20technical%20architecture%20at%20scale.jpeg)

---

## ⚖️ Ethical Guardrails

TraceNet is designed with strict ethical boundaries for law-enforcement use:

1. **Human-in-the-loop always** — the system ranks and surfaces candidates. It never auto-declares an identity match.
2. **Explainability over black-box scores** — every result shows *why* it matched, not just a number.
3. **Privacy-conscious** — no predictive-policing or "suspicious intent" classifiers. Attribute search only (appearance, location, time).
4. **Audit everything** — every search query, alert acknowledgement, and export is logged with operator identity and timestamp.
5. **Scope discipline** — person + vehicle attribute search only. No open-vocabulary action/activity recognition.

---

## 🔬 Problem Statement

**ERH26_PS_07 — Digital Forensics / AI Video Analytics**

Smart city surveillance networks generate terabytes of footage that are effectively unsearchable with legacy tools. A detective investigating a crime must manually review camera by camera, hour by hour. TraceNet turns this on its head — the investigator describes what they are looking for in plain language, and the system surfaces the most relevant evidence across the entire camera network, ranked by semantic similarity, with full chain-of-custody audit trails suitable for use in an evidentiary context.

---

## 📄 License

Built for demonstration and hackathon evaluation purposes. Not licensed for production law-enforcement deployment without appropriate legal and ethical review.
