# TraceNet — Production Architecture at City Scale

> This document describes how the TraceNet MVP prototype scales to a full smart-city surveillance deployment — covering thousands of cameras, real-time ingestion pipelines, GPU worker pools, and high-availability data storage. **This is pitch/planning material, not implemented in the MVP codebase.**

![Proposed Production Architecture at Scale](../proposed%20technical%20architecture%20at%20scale.jpeg)

---

## Overview

The MVP runs on a single machine with SQLite and a local Qdrant instance. The production architecture disaggregates every layer into independently scalable components, adds streaming protocols designed for low-latency camera networks, and replaces single-node storage with distributed, high-availability alternatives.

**Five major tiers:**
1. Edge Camera Layer
2. Scalable Ingestion & API Tier
3. Scalable GPU Worker Pool
4. High-Availability Data Tier
5. Low-Latency Streaming Core

---

## 1. Edge Camera Layer

At city scale, each camera node runs a **lightweight edge inference process** rather than sending raw video to the cloud. Only tracklets, crops, and embeddings are transmitted upstream — reducing bandwidth by ~98%.

| Component | Description |
|---|---|
| **IP Cameras** | Standard RTSP / ONVIF IP cameras (existing city infrastructure) |
| **Edge Compute** | Jetson Nano or Raspberry Pi 5 per camera cluster |
| **YOLOv11-Nano** | Nano-variant YOLO model — 4-8 FPS inference at <15W per device |
| **ByteTrack** | Consistent track IDs across frames, running at the edge |
| **Output** | Only tracklets (track ID, bbox, confidence), low-res crops, and CLIP embeddings are transmitted — not full video frames |

The edge nodes connect to the ingestion tier via `HTTPS/REST` for tracklet data and `SRT/RTMP` for full-resolution forensic video archival of priority cameras.

**Why edge processing?**
- Reduces upstream bandwidth by ~98% vs raw video transmission
- Enables 10,000+ cameras without saturating WAN links
- Privacy by design: raw PII-heavy full-frame video never leaves the camera enclosure

---

## 2. Scalable Ingestion & API Tier

Multiple stateless FastAPI nodes sit behind a load balancer. A Redis-backed Celery task queue decouples time-consuming GPU work from the request/response cycle.

```
Load Balancer
    ├── FastAPI Node 1
    ├── FastAPI Node 2
    └── FastAPI Node N
         ↓
    Redis Broker  ←→  Celery Task Queue  →  GPU Worker Pool
```

| Component | Technology | Purpose |
|---|---|---|
| **Load Balancer** | Nginx / AWS ALB | Distributes HTTP traffic across API nodes |
| **FastAPI Nodes** | Uvicorn (horizontal scale) | Stateless REST API: video upload, search, alert management |
| **Redis Broker** | Redis Cluster | Message broker for async task dispatch |
| **Celery Task Queue** | Celery + Redis | Dispatches transcoding, detection, and embedding jobs to GPU workers |

**Scaling:** API nodes scale horizontally via Kubernetes HPA. Video ingest is fully async — the API returns `asset_id` immediately and the background pipeline completes independently.

---

## 3. Scalable GPU Worker Pool

Dedicated worker pools handle the three compute-heavy pipeline stages independently, each scaling based on queue depth.

| Worker Type | Technology | Output |
|---|---|---|
| **FFmpeg Transcode Worker** | ffmpeg subprocess | Normalised MP4 (720p/10FPS) → S3 |
| **CLIP GPU Embedding Worker** | open-clip-torch + CUDA | 512-dim visual embedding per tracklet → Qdrant |
| **VideoMAE GPU Action Worker** | transformers VideoMAE | Temporal action features for assault/loitering validation |

**GPU node pools:**
- CLIP workers: AWS `g4dn.xlarge` (16GB VRAM) — throughput ~200 tracklets/second
- VideoMAE workers: AWS `g4dn.2xlarge` — throughput ~30 clips/second
- Transcode workers: CPU-only `c5.4xlarge` — throughput ~50 videos/hour per node

---

## 4. High-Availability Data Tier

### PostgreSQL + pgvector

Replaces SQLite with a production-grade relational database that also supports vector search as a secondary index.

| Aspect | Detail |
|---|---|
| **Replaces** | SQLite (MVP) |
| **Schema** | Cameras, VideoAssets, Tracklets, Alerts, SearchLogs, AuditLogs, CrimeReports |
| **pgvector extension** | SQL-native ANN queries on embedding columns — backup path for Qdrant |
| **High Availability** | Primary + 2 replicas (Patroni + etcd); automatic failover <30s |
| **Backups** | Continuous WAL archival to S3; point-in-time recovery |

### Qdrant Vector Cluster

Replaces local Qdrant persistent client with a horizontally sharded vector cluster.

| Aspect | Detail |
|---|---|
| **Replaces** | Local Qdrant client (MVP) |
| **Cluster size** | 3 nodes minimum (1 leader + 2 replicas per shard) |
| **Sharding** | By `camera_id` prefix for spatial locality |
| **Index** | HNSW (ef_construction=200, m=16) — recall >=0.97 at <50ms P99 |
| **Payload filtering** | Pre-filter by `camera_id`, `timestamp_range`, `object_type` before vector scoring |

---

## 5. Low-Latency Streaming Core

Live video from priority cameras flows through a MediaMTX cluster. Segments are archived to S3 with tiered retention policies. The React dashboard receives the live feed via WHEP/WebRTC at sub-500ms latency.

```
IP Cameras → SRT / RTMP → MediaMTX Cluster
                                ↓
                        Video Segments → AWS S3 (tiered storage)
                                ↓
                          WHEP / WebRTC → React Surveillance Dashboard
```

| Component | Technology | Purpose |
|---|---|---|
| **MediaMTX Cluster** | MediaMTX (load-balanced) | Receives SRT/RTMP; serves WHEP to dashboards |
| **Video Segments** | HLS/DASH fragmented MP4 (2s chunks) | Stored to S3 for forensic archival |
| **AWS S3** | S3 + lifecycle policies | Raw video archive with tiered storage |
| **WHEP WebRTC** | Browser-native WebRTC | Sub-second latency live feed |

**Latency targets:**

| Stream type | Target |
|---|---|
| WHEP WebRTC (live monitor) | < 500ms |
| HLS (forensic web playback) | 3-8 seconds |
| SRT ingest (camera to MediaMTX) | < 200ms |

**Storage tiers:**

| Tier | Storage Class | Retention |
|---|---|---|
| Hot | S3 Standard | 7 days — full-resolution forensic archive |
| Warm | S3-IA | 30 days — downsampled (480p) |
| Cold | S3 Glacier | 1 year — compressed, query-on-demand |

---

## Capacity Estimates

| Metric | Value | Basis |
|---|---|---|
| Cameras supported | 10,000+ | Edge inference; only tracklets/embeddings transmitted |
| Ingest throughput | 500+ videos/hour | Celery + GPU worker pool auto-scaling |
| Search latency | < 200ms P99 | Qdrant HNSW with payload pre-filter |
| Vector store size (1M tracklets) | ~2 GB | 512 dims x float32 = 2 KB per vector |
| Video storage (1,000 cameras, 30 days) | ~500 TB | With tiered compression |
| API nodes required (10K cameras) | 8-16 nodes | 500 RPS per node load target |

---

## Kubernetes Deployment Layout

```
Kubernetes (EKS / GKE / on-prem)
├── tracenet-api
│   ├── fastapi-api          (autoscale 4-32 pods)
│   └── celery-worker-cpu    (autoscale 2-20 pods)
├── tracenet-gpu
│   ├── celery-clip-gpu      (autoscale 1-8 pods, GPU node pool)
│   └── celery-videomae-gpu  (autoscale 0-4 pods)
├── tracenet-data
│   ├── postgresql-ha        (3 pods, Patroni + etcd)
│   └── qdrant-cluster       (3 pods)
├── tracenet-stream
│   └── mediamtx             (autoscale 2-16 pods)
└── tracenet-infra
    ├── redis-cluster
    └── nginx-ingress
```

---

## MVP vs. Production Comparison

| Dimension | MVP (current prototype) | Production |
|---|---|---|
| Database | SQLite (single file) | PostgreSQL + pgvector (HA cluster) |
| Vector store | Qdrant local client | Qdrant distributed cluster (3+ nodes) |
| Task queue | Synchronous background threads | Celery + Redis |
| Video storage | Local filesystem | AWS S3 with tiered lifecycle policies |
| API deployment | Single Uvicorn process | Horizontal FastAPI pods + load balancer |
| GPU workers | Inline in request thread | Dedicated Celery GPU worker pool |
| Live streaming | Single MediaMTX instance | MediaMTX cluster with SRT load balancing |
| Camera scale | 1-10 cameras (demo) | 1,000-10,000 cameras |
| Edge processing | None (all server-side) | YOLOv11-Nano + ByteTrack at edge |
| Auth | None (demo operator) | OAuth2 + role-based access control |

---

## Security Considerations

- **TLS everywhere** — all camera-to-API and API-to-DB connections encrypted with mTLS
- **API authentication** — JWT tokens with role-based access (officer / supervisor / admin)
- **Audit immutability** — audit logs written to append-only object storage (S3 Object Lock)
- **Network segmentation** — camera VLAN isolated from public internet; API tier in DMZ
- **Data residency** — all data stored on-premises or in government-approved cloud regions
- **PII minimisation** — face blur applied to non-matched detections before any export
