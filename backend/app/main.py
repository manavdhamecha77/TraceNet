import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.cameras import router as cameras_router
from app.api.detections import router as detections_router
from app.api.upload import router as upload_router
from app.api.models import router as models_router
from app.api.embedding_models import router as embedding_models_router
from app.api.search import router as search_router
from app.api.metrics import router as metrics_router
from app.api.alerts import router as alerts_router
from app.api.analytics import router as analytics_router
from app.api.audit import router as audit_router
from app.api.assault_detection import router as assault_detection_router
from app.api.processing import router as processing_router
from app.api.webhooks import router as webhooks_router
from app.api.frame_inspection import router as frame_inspection_router
from app.api.finetuning import router as finetuning_router
from app.api.system_jobs import router as system_jobs_router
from app.api.streaming import router as streaming_router
from app.config import get_settings, get_data_path
from app.embeddings.clip_encoder import get_clip_encoder
from app.db.models import Base
from app.db.session import engine
from app.db.optimize import optimize_database
import sqlite3

# Ensure data folders exist absolutely in backend/data/
os.makedirs(get_data_path(""), exist_ok=True)
os.makedirs(get_data_path("minio_mock"), exist_ok=True)
os.makedirs(get_data_path("cameras"), exist_ok=True)
os.makedirs(get_data_path("processed/detections"), exist_ok=True)
os.makedirs(get_data_path("models"), exist_ok=True)
os.makedirs(get_data_path("finetuned_models"), exist_ok=True)
os.makedirs(get_data_path("audit_logs"), exist_ok=True)
os.makedirs(get_data_path("streams"), exist_ok=True)
# Run schema migrations for SQLite dynamically to prevent OperationalError
def run_startup_migrations():
    db_path = get_data_path("drishti.db")
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        try:
            cursor = conn.cursor()
            # Check if cameras table exists first
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cameras'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(cameras)")
                columns = [c[1] for c in cursor.fetchall()]
                
                if "status" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN status VARCHAR DEFAULT 'active'")
                    conn.commit()
                    print("Schema Migration: Added 'status' column to cameras.")
                    
                if "altitude" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN altitude FLOAT")
                    conn.commit()
                    print("Schema Migration: Added 'altitude' column to cameras.")

                if "model_id" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN model_id VARCHAR REFERENCES models(id)")
                    conn.commit()
                    print("Schema Migration: Added 'model_id' column to cameras.")

                if "participate_in_alerts" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN participate_in_alerts BOOLEAN DEFAULT 1")
                    conn.commit()
                    print("Schema Migration: Added 'participate_in_alerts' column to cameras.")

                if "theft_model_id" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN theft_model_id VARCHAR REFERENCES models(id)")
                    conn.commit()
                    print("Schema Migration: Added 'theft_model_id' column to cameras.")

                if "abandoned_model_id" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN abandoned_model_id VARCHAR REFERENCES models(id)")
                    conn.commit()
                    print("Schema Migration: Added 'abandoned_model_id' column to cameras.")

                if "assault_model_id" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN assault_model_id VARCHAR REFERENCES models(id)")
                    conn.commit()
                    print("Schema Migration: Added 'assault_model_id' column to cameras.")

                if "is_streaming" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN is_streaming BOOLEAN DEFAULT 0")
                    conn.commit()
                    print("Schema Migration: Added 'is_streaming' column to cameras.")

                if "stream_key" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN stream_key VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'stream_key' column to cameras.")

                if "stream_auth_token" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN stream_auth_token VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'stream_auth_token' column to cameras.")

                if "stream_token_expires_at" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN stream_token_expires_at DATETIME")
                    conn.commit()
                    print("Schema Migration: Added 'stream_token_expires_at' column to cameras.")

                if "stream_started_at" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN stream_started_at DATETIME")
                    conn.commit()
                    print("Schema Migration: Added 'stream_started_at' column to cameras.")

            # Check if videos table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='videos'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(videos)")
                v_cols = [c[1] for c in cursor.fetchall()]
                if "is_live_recording" not in v_cols:
                    cursor.execute("ALTER TABLE videos ADD COLUMN is_live_recording BOOLEAN DEFAULT 0")
                    conn.commit()
                    print("Schema Migration: Added 'is_live_recording' column to videos.")

            # Check if models table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='models'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(models)")
                m_cols = [c[1] for c in cursor.fetchall()]

                if "category" not in m_cols:
                    cursor.execute("ALTER TABLE models ADD COLUMN category VARCHAR DEFAULT 'general'")
                    conn.commit()
                    print("Schema Migration: Added 'category' column to models.")

                if "is_default" not in m_cols:
                    cursor.execute("ALTER TABLE models ADD COLUMN is_default BOOLEAN DEFAULT 0")
                    conn.commit()
                    print("Schema Migration: Added 'is_default' column to models.")

            # Check if videos table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='videos'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(videos)")
                columns = [c[1] for c in cursor.fetchall()]
                
                if "progress_percentage" not in columns:
                    cursor.execute("ALTER TABLE videos ADD COLUMN progress_percentage INTEGER DEFAULT 0")
                    conn.commit()
                    print("Schema Migration: Added 'progress_percentage' column to videos.")
                
                if "is_bin" not in columns:
                    cursor.execute("ALTER TABLE videos ADD COLUMN is_bin BOOLEAN DEFAULT 0")
                    conn.commit()
                    print("Schema Migration: Added 'is_bin' column to videos.")

            # Check if alerts table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(alerts)")
                columns = [c[1] for c in cursor.fetchall()]
                
                if "video_id" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN video_id VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'video_id' column to alerts.")
                
                if "object_tracklet_id" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN object_tracklet_id VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'object_tracklet_id' column to alerts.")

                if "owner_tracklet_ids" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN owner_tracklet_ids TEXT DEFAULT '[]'")
                    conn.commit()
                    print("Schema Migration: Added 'owner_tracklet_ids' column to alerts.")

                if "visitor_tracklet_ids" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN visitor_tracklet_ids TEXT DEFAULT '[]'")
                    conn.commit()
                    print("Schema Migration: Added 'visitor_tracklet_ids' column to alerts.")

                if "reid_match_tracklet_id" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN reid_match_tracklet_id VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'reid_match_tracklet_id' column to alerts.")

                if "abandon_duration_seconds" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN abandon_duration_seconds FLOAT")
                    conn.commit()
                    print("Schema Migration: Added 'abandon_duration_seconds' column to alerts.")

                if "analysis_log" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN analysis_log TEXT")
                    conn.commit()
                    print("Schema Migration: Added 'analysis_log' column to alerts.")

                if "acknowledged_by" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN acknowledged_by VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'acknowledged_by' column to alerts.")

                if "acknowledged_at" not in columns:
                    cursor.execute("ALTER TABLE alerts ADD COLUMN acknowledged_at DATETIME")
                    conn.commit()
                    print("Schema Migration: Added 'acknowledged_at' column to alerts.")

            # Check if tracklets table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tracklets'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(tracklets)")
                columns = [c[1] for c in cursor.fetchall()]

                if "attributes" not in columns:
                    cursor.execute("ALTER TABLE tracklets ADD COLUMN attributes TEXT")
                    conn.commit()
                    print("Schema Migration: Added 'attributes' column to tracklets.")

            # Check if webhooks table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='webhooks'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE webhooks (
                        id VARCHAR PRIMARY KEY,
                        url VARCHAR NOT NULL,
                        webhook_type VARCHAR NOT NULL,
                        is_active BOOLEAN DEFAULT 1,
                        confidence_threshold FLOAT DEFAULT 0.6,
                        camera_ids TEXT DEFAULT '[]',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_triggered_at DATETIME,
                        delivery_count INTEGER DEFAULT 0
                    )
                """)
                conn.commit()
                print("Schema Migration: Created 'webhooks' table.")

            # Check if live_stream_sessions table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='live_stream_sessions'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE live_stream_sessions (
                        id VARCHAR PRIMARY KEY,
                        camera_id VARCHAR NOT NULL REFERENCES cameras(camera_id),
                        status VARCHAR DEFAULT 'active',
                        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        ended_at DATETIME,
                        total_duration_sec FLOAT,
                        chunks_recorded INTEGER DEFAULT 0,
                        alerts_generated INTEGER DEFAULT 0,
                        inference_model_id VARCHAR,
                        stream_config TEXT DEFAULT '{}'
                    )
                """)
                conn.commit()
                print("Schema Migration: Created 'live_stream_sessions' table.")

            # Check if stream_chunks table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stream_chunks'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE stream_chunks (
                        id VARCHAR PRIMARY KEY,
                        session_id VARCHAR NOT NULL REFERENCES live_stream_sessions(id),
                        camera_id VARCHAR NOT NULL,
                        chunk_index INTEGER DEFAULT 0,
                        file_path VARCHAR NOT NULL,
                        start_time DATETIME,
                        end_time DATETIME,
                        duration_sec FLOAT,
                        file_size_bytes INTEGER,
                        imported_as_video_id VARCHAR
                    )
                """)
                conn.commit()
                print("Schema Migration: Created 'stream_chunks' table.")

            # Check if live_alerts table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='live_alerts'")
            if not cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE live_alerts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        alert_type VARCHAR NOT NULL,
                        camera_id VARCHAR NOT NULL,
                        session_id VARCHAR NOT NULL REFERENCES live_stream_sessions(id),
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        acknowledged BOOLEAN DEFAULT 0
                    )
                """)
                conn.commit()
                print("Schema Migration: Created 'live_alerts' table.")
            # Pair codes table migration (auto-create if missing)
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pair_codes'")
            if not cursor.fetchone():
                cursor.execute('''
                    CREATE TABLE pair_codes (
                        id VARCHAR PRIMARY KEY,
                        camera_id VARCHAR REFERENCES cameras(camera_id),
                        code_display VARCHAR NOT NULL,
                        device_label VARCHAR,
                        created_at DATETIME,
                        expires_at DATETIME NOT NULL,
                        used BOOLEAN DEFAULT 0,
                        device_auth_token VARCHAR
                    )
                ''')
                conn.commit()
                print("Schema Migration: Created 'pair_codes' table.")

            # Crime reports table migration (auto-create if missing)
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='crime_reports'")
            if not cursor.fetchone():
                cursor.execute('''
                    CREATE TABLE crime_reports (
                        id VARCHAR PRIMARY KEY,
                        report_type VARCHAR NOT NULL,
                        alert_id INTEGER REFERENCES alerts(id),
                        camera_id VARCHAR NOT NULL REFERENCES cameras(camera_id),
                        video_id VARCHAR REFERENCES videos(id),
                        title VARCHAR NOT NULL,
                        description TEXT,
                        severity VARCHAR DEFAULT 'medium',
                        status VARCHAR DEFAULT 'pending',
                        detection_confidence FLOAT,
                        detected_objects TEXT DEFAULT '[]',
                        frame_count INTEGER DEFAULT 0,
                        incident_timestamp DATETIME NOT NULL,
                        detection_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        report_generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        pdf_file_path VARCHAR,
                        pdf_generated_at DATETIME,
                        location VARCHAR,
                        assigned_to VARCHAR,
                        notes TEXT,
                        report_data TEXT DEFAULT '{}',
                        created_by VARCHAR
                    )
                ''')
                conn.commit()
                print("Schema Migration: Created 'crime_reports' table.")

            # Create indexes on crime_reports for common queries
            cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_crime_reports_camera_id'")
            if not cursor.fetchone():
                cursor.execute("CREATE INDEX idx_crime_reports_camera_id ON crime_reports(camera_id)")
                cursor.execute("CREATE INDEX idx_crime_reports_report_type ON crime_reports(report_type)")
                cursor.execute("CREATE INDEX idx_crime_reports_severity ON crime_reports(severity)")
                cursor.execute("CREATE INDEX idx_crime_reports_status ON crime_reports(status)")
                conn.commit()
                print("Schema Migration: Created indexes on 'crime_reports' table.")

        except Exception as e:
            print("Startup Migration Error:", str(e))
        finally:
            conn.close()

run_startup_migrations()

# Ensure tables are created
Base.metadata.create_all(bind=engine)

# Optimize database with indexes
optimize_database()

settings = get_settings()

app = FastAPI(
    title="TraceNet & DRISHTI API",
    description="Advanced Video Surveillance, Real-time Detection & Hybrid Search Intelligence (DRISHTI) - A comprehensive video retrieval and threat detection system",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url="/api/redoc",
    openapi_tags=[
        {
            "name": "Health",
            "description": "System health and status checks"
        },
        {
            "name": "Cameras",
            "description": "Camera management and configuration"
        },
        {
            "name": "Detection",
            "description": "Object detection results and management"
        },
        {
            "name": "Videos",
            "description": "Video upload and management"
        },
        {
            "name": "Models",
            "description": "Detection model management"
        },
        {
            "name": "Search",
            "description": "Hybrid video search using CLIP embeddings"
        },
        {
            "name": "Metrics",
            "description": "System performance metrics"
        },
        {
            "name": "Alerts",
            "description": "Alert management and acknowledgment"
        },
        {
            "name": "Analytics",
            "description": "Detection analytics and statistics"
        },
        {
            "name": "Audit",
            "description": "Audit logging and compliance"
        },
        {
            "name": "Assault Detection",
            "description": "Violence and assault detection using deep learning"
        },
        {
            "name": "Video Processing",
            "description": "Real-time video processing pipeline"
        },
        {
            "name": "Webhooks",
            "description": "Webhook configuration and management"
        },
        {
            "name": "Frame Inspection",
            "description": "Frame-level analysis and visualization"
        },
        {
            "name": "Fine-Tuning",
            "description": "Model fine-tuning and transfer learning"
        },
        {
            "name": "AI Assistant",
            "description": "MCP-based AI assistant with analysis tools"
        },
        {
            "name": "Multi-Camera Intelligence",
            "description": "Advanced multi-camera tracking and analytics"
        },
        {
            "name": "System Jobs",
            "description": "Background job management"
        }
    ]
)


_mediamtx_process = None

def start_mediamtx_server():
    global _mediamtx_process
    if _mediamtx_process is not None and _mediamtx_process.poll() is None:
        return _mediamtx_process
    try:
        import subprocess
        from app.streaming.mediamtx_downloader import ensure_mediamtx
        binary_path = ensure_mediamtx()
        config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../mediamtx/mediamtx.yml"))
        
        cmd = [binary_path]
        if os.path.exists(config_path):
            cmd.append(config_path)
            
        print(f"Startup: Launching MediaMTX WebRTC server ({binary_path})...")
        _mediamtx_process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return _mediamtx_process
    except Exception as e:
        print(f"Startup Warning: Failed to launch MediaMTX server: {e}")
        return None

@app.on_event("startup")
def load_startup_singletons() -> None:
    """Load shared ML models and MediaMTX server at app startup."""
    clip_encoder = get_clip_encoder()
    app.state.clip_encoder = clip_encoder
    print(
        "Startup: CLIP encoder loaded "
        f"(model={clip_encoder.model_name}, pretrained={clip_encoder.pretrained}, device={clip_encoder.device})."
    )
    start_mediamtx_server()

# Enable CORS for frontend integration (allow all origins for LAN / multi-device access)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the data directory statically to allow access to thumbnails and transcoded clips
app.mount("/data", StaticFiles(directory=get_data_path("")), name="data")

# Serve the standalone edge camera client (decoupled device pairing app)
_camera_client_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../camera_client"))
if os.path.isdir(_camera_client_dir):
    app.mount("/camera-app", StaticFiles(directory=_camera_client_dir, html=True), name="camera_client")
    app.mount("/camera_client", StaticFiles(directory=_camera_client_dir, html=True), name="camera_client_alias")

from app.api.assistant import router as assistant_router
from app.api.multicam import router as multicam_router
from app.api.reports import router as reports_router

# Register routes
app.include_router(health_router, prefix=settings.api_prefix, tags=["Health"])
app.include_router(cameras_router, prefix=settings.api_prefix, tags=["Cameras"])
app.include_router(detections_router, prefix=settings.api_prefix, tags=["Detection"])
app.include_router(upload_router, prefix=settings.api_prefix, tags=["Videos"])
app.include_router(models_router, prefix=settings.api_prefix, tags=["Models"])
app.include_router(embedding_models_router, prefix=settings.api_prefix, tags=["Models"])
app.include_router(search_router, prefix=settings.api_prefix, tags=["Search"])
app.include_router(metrics_router, prefix=settings.api_prefix, tags=["Metrics"])
app.include_router(alerts_router, prefix=settings.api_prefix, tags=["Alerts"])
app.include_router(analytics_router, prefix=settings.api_prefix, tags=["Analytics"])
app.include_router(audit_router, prefix=settings.api_prefix, tags=["Audit"])
app.include_router(assault_detection_router, prefix=settings.api_prefix, tags=["Assault Detection"])
app.include_router(processing_router, prefix=settings.api_prefix, tags=["Video Processing"])
app.include_router(webhooks_router, prefix=settings.api_prefix, tags=["Webhooks"])
app.include_router(frame_inspection_router, prefix=settings.api_prefix, tags=["Frame Inspection"])
app.include_router(finetuning_router, prefix=settings.api_prefix, tags=["Fine-Tuning"])
app.include_router(reports_router, prefix=settings.api_prefix, tags=["Reports"])
app.include_router(assistant_router, prefix=settings.api_prefix, tags=["AI Assistant"])
app.include_router(multicam_router, tags=["Multi-Camera Intelligence"])
app.include_router(system_jobs_router, prefix=settings.api_prefix, tags=["System Jobs"])
app.include_router(streaming_router, prefix=settings.api_prefix, tags=["Streaming"])


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "TraceNet & DRISHTI API is running"}
