# 📖 TraceNet Architecture & Technology Specification
**Project DRISHTI: AI-Driven Descriptive Search & Security Analytics for Smart City CCTV**

This document outlines the features, technology stack, interface protocols, current single-node deployment, and the final production-ready, cost-effective architecture proposed for Project DRISHTI.

---

## 1. Directory of Implemented Features

TraceNet represents a comprehensive digital forensics and smart city video analytics platform containing the following core feature sets:

### A. Video Ingestion & Forensic Preprocessing
* **Standardized Transcoding**: Automated conversion of arbitrary video uploads (`.avi`, `.mov`, `.mkv`, etc.) to standard H.264 MP4 at 720p @ 10 FPS using `ffmpeg-python` to ensure web compatibility and timeline normalization.
* **4 FPS Temporal Sampling**: Extraction and temporal sub-sampling of frames via OpenCV at 4 FPS ($\Delta t = 250\text{ ms}$) to optimize downstream inference pipelines.
* **Progressive Pipeline Tracking**: Ingest pipeline lifecycle management updating statuses from `pending` $\rightarrow$ `transcoding` $\rightarrow$ `preprocessed` $\rightarrow$ `indexing` $\rightarrow$ `complete`.
* **System Jobs Queue**: Clicking the header status pill opens a live-refreshing Queue list of active/completed system indexing operations (`SystemJob` SQLite records).
* **Forensic Chain of Custody Integrity**: Double cryptographic hashing (SHA-256) computed at raw upload intake and post-transcoding to guarantee evidence tamper-resistance.

### B. Deep Learning Detection & ByteTrack Integration
* **YOLOv8/v11 Object Detection**: Automatic object parsing targeting classes such as `person` and `vehicle` along with accessories (`backpack`, `handbag`, `suitcase`, etc.) using PyTorch models.
* **ByteTrack Multi-Object Tracking**: Association of detections over time to generate continuous tracklet trajectories via the `supervision` library.
* **Tracklet Synthesis**: Extraction of individual visual crops, mean detection confidence, frame indices, spatiotemporal bounds, and keyframes.

### C. Dense Feature Extraction & Semantic Auto-Captioning
* **CLIP Visual Embeddings**: Generation of 512-dimensional visual vector representations from tracklet keyframe crops using CLIP (`sentence-transformers/clip-ViT-B-32` or `open-clip-torch`).
* **BLIP Auto-Captioning**: Generation of natural language visual attribute summaries (e.g. *"a man in a black jacket and jeans"* or *"a white hatchback car"*) from crops using Salesforce BLIP (`Salesforce/blip-image-captioning-base`) to index text search indicators directly into the database.

### D. Hybrid Search & Digital Forensics
* **Natural Language Text Search**: Query input embedding via CLIP text encoder matched against indexed vector embeddings in a vector database.
* **Visual Photo Search (Missing Person)**: Image-to-image matching utilizing drag-and-drop reference photo uploads, bypassing text filters.
* **Why-Matched Explainability Panel**: Operator card expansion showing visual confidence breakdown, caption overlap scores, and specific matching attributes.
* **Cryptographic Compliance Export**: Exporting search result sets along with an evidentiary integrity manifest containing a SHA-256 compliance hash.
* **Video-Scoped Search**: Re-triggering CLIP visual similarity queries locked strictly within a single target video stream to track local recurrence.

### E. Security Command Center & Alert Heuristics
* **Loitering & Dwell-Time Detection**: User-defined normalized polygon boundaries configured on video preview frames. Tracks dwell times using bounding-box `bottom_center` coordinates, grace periods, and deduplication gates.
* **4 FPS Kinematic Chain Snatching & Theft Analyzer**: Kinematic spatiotemporal state machine evaluating proximity spikes, aspect ratio transitions (victim falls), and velocity cosine similarity alignment (suspect escapes on motorcycle).
* **VideoMAE Assault & Fight Detection**: Time-series action classification using HuggingFace Timesformer (`OPear/videomae-large-finetuned-UCF-Crime`) on video frame clips.
* **Suspect Reappearance Alerting**: Matching real-time camera crops against high-priority "Hot Target" vectors to trigger cross-camera suspect reappearance alarms.

### F. Multi-Camera Sentinel Pursuit Wave
* **Spatial-Temporal Topology Modeling**: Mapping camera nodes to a GIS map, tracking coordinates, corridors, altitudes, and neighbors.
* **DAG Trajectory Journey Scrubber**: Reconstruction of most-likely target routes based on visual similarity and spatiotemporal transition feasibility.
* **Sentinel Wave Pursuit HUD**: One-click predictive target tracking that alerts downstream camera nodes to prepare for incoming targets based on speed modes (pedestrian vs. vehicle).

---

## 2. Current Architecture (Local MVP Development)

In its current development configuration, TraceNet is deployed on a single local server running the following stack:

```mermaid
flowchart TD
    subgraph Client [Browser Client React + Vite]
        UI[Surveillance Dashboard]
        Player[Web Video Player]
        WS_Client[WS Telemetry Connection]
    end

    subgraph Host [Single Local Dev Host]
        API[FastAPI Web Server]
        Media[MediaMTX Streaming Proxy]
        
        subgraph SQLite [Metadata Store SQLite]
            DB[(drishti.db)]
        end

        subgraph InProcess [Vector DB / Storage]
            Qdrant[(Qdrant Local Path)]
            FS[(Local Disk Storage)]
        end
    end

    UI -- HTTP/REST Requests --> API
    Player -- WHEP WebRTC Stream --> Media
    WS_Client -- WS Connection --> API
    
    API -- SQLite/SQLAlchemy --> DB
    API -- In-Process client --> Qdrant
    API -- FFmpeg / PIL / cv2 --> FS
    Media -- HTTP Auth Hook --> API
```

### Technical Assessment of Current Setup:
1. **Concurrency Limitations**: Using SQLite (`drishti.db`) introduces write-lock contentions during parallel video uploads and high-frequency alert ingestion.
2. **Resource-Heavy Background Tasks**: Video transcoding and deep learning inference (YOLO, CLIP, VideoMAE) are handled inside FastAPI's in-process `BackgroundTasks` thread pool. Large video uploads can saturate CPU/GPU cores, causing API request timeouts.
3. **In-Process Qdrant Client**: Qdrant is instantiated in-process using SQLite-backed local directories. This prevents horizontally scaling the API server.
4. **MediaMTX Co-location**: MediaMTX runs as a subprocess launched directly by the Python process, locking storage and port binding configuration to the local host's boundaries.

---

## 3. Technology Stack & Protocol Matrix

### A. Implemented Technology Stack

| Layer | Component / Library | Details |
|---|---|---|
| **Frontend Framework** | React v18 + TS + Vite | Fluid layout, components modularity. |
| **Styling Engine** | TailwindCSS + Vanilla CSS | Fluid-grid styling, Command Center theme. |
| **GIS Mapping** | Leaflet + react-leaflet | Camera node topography and neighbor mapping. |
| **Backend Framework** | FastAPI + Uvicorn | High-performance ASGI interface. |
| **ORM / Migrations** | SQLAlchemy | SQLite driver, startup schema migrations. |
| **Video Preprocessing** | OpenCV (`cv2`) + `ffmpeg-python` | Transcoding and 4 FPS temporal extraction. |
| **Computer Vision / DL** | Ultralytics YOLOv11 & YOLOv8 | Object detection, keypoints, and pose parsing. |
| **Tracking Algorithm** | ByteTrack (`supervision`) | Tracking ID retention. |
| **Embeddings Model** | `sentence-transformers/clip-ViT-B-32` | 512-dimension visual & textual vectors. |
| **Text Generator** | `Salesforce/blip-image-captioning-base` | Image captioning for semantic tags. |
| **Vector Engine** | Qdrant (`qdrant-client`) | Vector storage via Cosine Similarity. |
| **Action Recognition** | `OPear/videomae-large-finetuned-UCF-Crime` | HuggingFace Timesformer video classification. |
| **PDF Generation** | ReportLab | Evidentiary PDF audit report creation. |

### B. Network Protocols & Interface Mappings

TraceNet uses a multi-tiered communication protocol strategy to optimize real-time alerts and minimize streaming latency:

```
[Camera Edge Device] 
      │ (RTMP / RTSP / WHIP)
      ▼
[MediaMTX Stream Server] ◄──(HTTP/REST Auth Verification)──► [FastAPI API Engine]
      │                                                           │
      │ (WHEP WebRTC Stream)                                      │ (WebSockets Telemetry / JSON)
      ▼                                                           ▼
[React Dashboard Client] ◄────────────────────────────────────────┘
```

* **Transport Protocols**: 
  * **TCP**: Utilized for standard API routes, database connections, and WebSocket frames.
  * **UDP**: Utilized for WebRTC RTP video streaming media and STUN ICE negotiation (ports `8189`, `19302`) to ensure ultra-low latency.
* **REST (HTTP/HTTPS)**: Main API surface (`/api/v1/*`) used for camera registry, search parameters, video uploads, PDF exports, and MediaMTX webhook authentications (`/api/v1/stream/mediamtx-auth`).
* **WebRTC (WHIP - WebRTC HTTP Ingestion)**: Ingest protocol used by edge devices (e.g. smartphones, IP cameras) to push video streams directly to MediaMTX on `/whip` paths.
* **WebRTC (WHEP - WebRTC HTTP Egress)**: Playback protocol used by the React client to pull live camera streams with sub-second latency from MediaMTX via the `/whep` path.
* **RTSP / RTMP**: Legacy streaming fallback paths configured on MediaMTX to ingest traditional IP camera feeds.
* **WebSockets (WS/WSS)**: Bidirectional persistent socket connections on `/api/v1/stream/ws/{camera_id}`. Ingests live tracking coordinates from background workers and broadcasts them to operator UI instances.
* **SRT (Secure Reliable Transport)**: Proposed for production edge ingestion across lossy, cellular networks (4G/5G).

---

## 4. Production-Scale Proposed Architecture

To transition TraceNet from a single-node hackathon prototype to a resilient, enterprise-ready smart city deployment, a decoupled microservices architecture is proposed. This architecture keeps cloud GPU costs low while ensuring horizontal scalability.

### Proposed Production Topology

```mermaid
flowchart TB
    subgraph EdgeNode ["Edge Camera Nodes"]
        EdgeCam[IP Camera + RTSP]
        EdgeInference[YOLOv11-Nano Edge Processor]
        EdgeInference -- Push Tracklets & Embeddings Only --> EdgePush[API Gateway]
    end

    subgraph CloudAPI ["Scalable Ingestion & Gateway Tier"]
        LB[Load Balancer]
        Gate[FastAPI API Gateway Nodes]
        Broker[Redis Message Broker & Cache]
        CeleryQueue[Celery Task Queue]
    end

    subgraph Workers ["Scalable GPU Worker Pool"]
        TranscodeWorker[FFmpeg Transcode Worker]
        EmbeddingWorker[CLIP GPU Embedding Worker]
        ViolenceWorker[VideoMAE GPU Action Worker]
    end

    subgraph Streaming ["Low Latency Streaming Core"]
        MediaMTXCluster[MediaMTX Cluster]
        S3Bucket[MinIO / AWS S3 Object Storage]
    end

    subgraph Databases ["High-Availability Database Tier"]
        Postgres[(PostgreSQL Metadata DB + pgvector)]
        QdrantCluster[(Qdrant Vector Cluster)]
    end

    EdgeCam -- SRT / RTMP Stream --> MediaMTXCluster
    EdgePush -- HTTPS / REST --> LB
    LB --> Gate
    Gate -- Queue Task --> Broker
    Broker --> CeleryQueue
    CeleryQueue --> TranscodeWorker
    CeleryQueue --> EmbeddingWorker
    CeleryQueue --> ViolenceWorker
    
    TranscodeWorker -- Save mp4/crops --> S3Bucket
    EmbeddingWorker -- Upsert Vectors --> QdrantCluster
    Gate -- SQL Queries --> Postgres
    Gate -- Search Vectors --> QdrantCluster
    
    MediaMTXCluster -- Segment Video --> S3Bucket
```

### Cost-Effective Optimization Strategy

1. **Edge-Hybrid Inference (Bandwidth & Cloud Cost Reduction)**:
   * Rather than streaming high-resolution 1080p video feeds constantly to the cloud (which creates massive bandwidth bills), edge devices or low-cost NVR boxes run lightweight YOLO and ByteTrack models locally.
   * Only detected bounding boxes, 512-dimension vectors, and low-res target crop images are pushed to the cloud backend. **This cuts network egress and cloud GPU cost by up to 90%**.
2. **Decoupled Task Queue**:
   * API endpoints immediately return `202 Accepted` and offload transcoding, BLIP captioning, and VideoMAE action analysis to **Celery GPU workers** powered by a **Redis** or **RabbitMQ** broker.
   * Auto-scaling policies adjust the GPU worker pool size based on the depth of the preprocessing queue.
3. **Database Upgrade**:
   * Replace SQLite with a managed **PostgreSQL** instance to handle concurrent writes.
   * Deploy **Qdrant** in a distributed cluster with memory mapping enabled. For small deployments, **pgvector** can run inside PostgreSQL to keep operational complexity low.
4. **Archival Cold Storage**:
   * Store raw and transcoded video files in **AWS S3 or MinIO**. Apply lifecycle rules to automatically migrate older surveillance assets to low-cost archival storage classes (e.g. S3 Glacier) after a set retention period.

---

## 5. Containerization Blueprint

Containerization ensures consistent runtime environments across different development and deployment targets. This is especially important for managing complex system packages like PyTorch CUDA libraries and local FFmpeg binaries.

### Container Definitions

For a production deployment, the application is split into **7 distinct containers**:

1. **`tracenet-frontend`**: Serves compiled React assets using Nginx.
2. **`tracenet-api`**: Runs the FastAPI backend server under Uvicorn.
3. **`tracenet-worker`**: Celery worker container that handles GPU-intensive video preprocessing, CLIP encoding, and VideoMAE inference.
4. **`tracenet-redis`**: Acts as the message broker for Celery tasks and serves as a cache for API routes.
5. **`tracenet-db`**: PostgreSQL relational database storing metadata and audit logs.
6. **`tracenet-vector-db`**: Qdrant server for semantic tracklet indexing.
7. **`tracenet-streaming`**: MediaMTX server managing RTMP, RTSP, WHIP, and WHEP streams.

---

### Docker Compose Deployment Blueprint

The following `docker-compose.yml` configures these services to run in a unified container network:

```yaml
version: '3.8'

networks:
  tracenet-network:
    driver: bridge

volumes:
  postgres_data:
  qdrant_data:
  shared_data:

services:
  # 1. Database Tier: Relational Postgres
  tracenet-db:
    image: postgres:15-alpine
    container_name: tracenet-db
    environment:
      POSTGRES_USER: tracenet_admin
      POSTGRES_PASSWORD: SecretProductionPassword123
      POSTGRES_DB: drishti_metadata
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    networks:
      - tracenet-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tracenet_admin -d drishti_metadata"]
      interval: 10s
      timeout: 5s
      retries: 5

  # 2. Database Tier: Vector Search Qdrant
  tracenet-vector-db:
    image: qdrant/qdrant:latest
    container_name: tracenet-vector-db
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - tracenet-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # 3. Message Queue Broker: Redis
  tracenet-redis:
    image: redis:7-alpine
    container_name: tracenet-redis
    ports:
      - "6379:6379"
    networks:
      - tracenet-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  # 4. Media Streaming Core: MediaMTX
  tracenet-streaming:
    image: bluenviron/mediamtx:1.6.0
    container_name: tracenet-streaming
    ports:
      - "8554:8554"   # RTSP Ingestion / Egress
      - "1935:1935"   # RTMP Ingestion
      - "8888:8888"   # HLS Playback
      - "8889:8889"   # WebRTC WHIP / WHEP (UDP/TCP)
      - "8189:8189/udp" # WebRTC ICE candidate local UDP
    volumes:
      - ./backend/mediamtx/mediamtx.yml:/mediamtx.yml
    networks:
      - tracenet-network
    restart: unless-stopped

  # 5. Application Gateway: FastAPI Web API
  tracenet-api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: tracenet-api
    environment:
      - DATABASE_URL=postgresql://tracenet_admin:SecretProductionPassword123@tracenet-db:5432/drishti_metadata
      - QDRANT_HOST=tracenet-vector-db
      - REDIS_URL=redis://tracenet-redis:6379/0
      - MEDIA_STREAM_SERVER=http://tracenet-streaming:8554
    volumes:
      - shared_data:/app/data
    ports:
      - "8000:8000"
    depends_on:
      tracenet-db:
        condition: service_healthy
      tracenet-vector-db:
        condition: service_healthy
      tracenet-redis:
        condition: service_healthy
    networks:
      - tracenet-network
    restart: always

  # 6. Scalable GPU Worker: Celery Task Pipeline
  tracenet-worker:
    build:
      context: ./backend
      dockerfile: Dockerfile.worker
    container_name: tracenet-worker-gpu
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    environment:
      - DATABASE_URL=postgresql://tracenet_admin:SecretProductionPassword123@tracenet-db:5432/drishti_metadata
      - QDRANT_HOST=tracenet-vector-db
      - REDIS_URL=redis://tracenet-redis:6379/0
    volumes:
      - shared_data:/app/data
    depends_on:
      - tracenet-redis
    networks:
      - tracenet-network
    restart: always

  # 7. Frontend User Interface: React served by Nginx
  tracenet-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: tracenet-frontend
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - tracenet-api
    networks:
      - tracenet-network
    restart: always
```

---

## 6. Security and Evidentiary Chain of Custody

Surveillance data used in judicial proceedings must adhere to strict evidentiary guidelines. TraceNet handles this using a built-in cryptographic audit and permission framework:

```
[Upload Action] ──► Calculate SHA-256 Hash ──► Write to SQLite VideoAsset Row
                                                     │
[Forensic Audit Search] ◄── Generate Result List ────┘
      │
      ├─► Group files into standard folder structure
      ├─► Compute combined results hash
      └─► Download Verified Compliance Report (.txt + PDF stamp)
```

1. **Intake Integrity Verification**: Every uploaded video file has its SHA-256 hash calculated immediately upon upload. If a file is uploaded again, the backend detects the matching hash and prevents duplication.
2. **Standardization Verification**: Post-transcoding, a second SHA-256 hash is generated for the H.264 file. This ensures that the frames analyzed by the AI models match the media displayed in the video player.
3. **Immutable Search Auditing**: Every search query, filter modification, and matching result count is written to the SQLite `search_logs` table.
4. **Tamper-Evident Exporting**: When exporting a search result set, TraceNet generates a verification hash. This hash seals the collection of exported clips, verifying to investigators that the exported files have not been modified or replaced.
