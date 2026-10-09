import os
import uuid
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
from app.api.plate_detection import router as plate_detection_router
from app.api.face_detection import router as face_detection_router
from app.api.accident_detection import router as accident_detection_router
from app.api.attributes import router as attributes_router
from app.api.exports import router as exports_router
from app.config import get_settings, get_data_path
from app.db.models import Area, Base
from app.db.session import SessionLocal, engine
from app.db.optimize import optimize_database
import sqlite3

# Ensure data folders exist absolutely in backend/data/
os.makedirs(get_data_path(""), exist_ok=True)
os.makedirs(get_data_path("minio_mock"), exist_ok=True)
os.makedirs(get_data_path("cameras"), exist_ok=True)
os.makedirs(get_data_path("processed/detections"), exist_ok=True)
os.makedirs(get_data_path("processed/faces"), exist_ok=True)
os.makedirs(get_data_path("processed/accidents"), exist_ok=True)
os.makedirs(get_data_path("exports"), exist_ok=True)
os.makedirs(get_data_path("models"), exist_ok=True)
os.makedirs(get_data_path("models/accident_detection"), exist_ok=True)
os.makedirs(get_data_path("audit_logs"), exist_ok=True)
os.makedirs(get_data_path("streams"), exist_ok=True)
# Run schema migrations for SQLite dynamically to prevent OperationalError
def run_startup_migrations():
    db_path = get_data_path("drishti.db")
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='areas'")
            if not cursor.fetchone():
                cursor.execute(
                    """
                    CREATE TABLE areas (
                        id VARCHAR PRIMARY KEY,
                        name VARCHAR NOT NULL UNIQUE,
                        description TEXT,
                        thumbnail_path VARCHAR,
                        thumbnail_url VARCHAR,
                        created_at DATETIME
                    )
                    """
                )
                conn.commit()
                print("Schema Migration: Created 'areas' table.")

            # Check if cameras table exists first
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cameras'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(cameras)")
                columns = [c[1] for c in cursor.fetchall()]

                if "area_id" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN area_id VARCHAR REFERENCES areas(id)")
                    conn.commit()
                    print("Schema Migration: Added 'area_id' column to cameras.")
                
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

                if "thumbnail_path" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN thumbnail_path VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'thumbnail_path' column to cameras.")

                if "thumbnail_url" not in columns:
                    cursor.execute("ALTER TABLE cameras ADD COLUMN thumbnail_url VARCHAR")
                    conn.commit()
                    print("Schema Migration: Added 'thumbnail_url' column to cameras.")

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

            # Rename legacy 'sentinel_sessions' table (feature renamed to Pursuit Wave); keeps existing rows
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sentinel_sessions'")
            legacy_exists = cursor.fetchone() is not None
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pursuit_sessions'")
            if legacy_exists and cursor.fetchone() is None:
                for idx in ("idx_sentinel_sessions_status", "idx_sentinel_sessions_origin_camera", "idx_sentinel_sessions_created_at"):
                    cursor.execute(f"DROP INDEX IF EXISTS {idx}")
                cursor.execute("ALTER TABLE sentinel_sessions RENAME TO pursuit_sessions")
                conn.commit()
                print("Schema Migration: Renamed 'sentinel_sessions' table to 'pursuit_sessions'.")
            # SQLAlchemy's own id index keeps its old name across a table rename; drop it so create_all recreates it
            cursor.execute("DROP INDEX IF EXISTS ix_sentinel_sessions_id")
            conn.commit()

            # pair_codes: operator-chosen stream config persisted with the code (applied on device verify)
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pair_codes'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(pair_codes)")
                pc_columns = [c[1] for c in cursor.fetchall()]
                if "stream_config" not in pc_columns:
                    cursor.execute("ALTER TABLE pair_codes ADD COLUMN stream_config TEXT")
                    conn.commit()
                    print("Schema Migration: Added 'stream_config' column to pair_codes.")

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

            cursor.execute("SELECT id FROM areas WHERE name = 'General'")
            default_area = cursor.fetchone()
            if not default_area:
                default_area_id = str(uuid.uuid4())
                cursor.execute(
                    "INSERT INTO areas (id, name, description, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                    (default_area_id, "General", "Default Area for existing camera nodes"),
                )
                default_area = (default_area_id,)
                conn.commit()
                print("Schema Migration: Created default 'General' Area.")
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cameras'")
            if cursor.fetchone():
                cursor.execute("UPDATE cameras SET area_id = ? WHERE area_id IS NULL", default_area)
                conn.commit()

            # Vehicle-linked plate columns on license_plate_detections (table itself is created by create_all)
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='license_plate_detections'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(license_plate_detections)")
                plate_cols = [row[1] for row in cursor.fetchall()]
                for col_name, ddl in (
                    ("tracklet_id", "ALTER TABLE license_plate_detections ADD COLUMN tracklet_id VARCHAR"),
                    ("ocr_confidence", "ALTER TABLE license_plate_detections ADD COLUMN ocr_confidence FLOAT"),
                    ("plate_status", "ALTER TABLE license_plate_detections ADD COLUMN plate_status VARCHAR DEFAULT 'read'"),
                    ("ocr_engine", "ALTER TABLE license_plate_detections ADD COLUMN ocr_engine VARCHAR"),
                ):
                    if col_name not in plate_cols:
                        cursor.execute(ddl)
                        print(f"Schema Migration: Added '{col_name}' to license_plate_detections.")
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_plate_tracklet_id ON license_plate_detections(tracklet_id)"
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS idx_plate_status ON license_plate_detections(plate_status)"
                )
                conn.commit()

            # Check if face_tracklets table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='face_tracklets'")
            if not cursor.fetchone():
                cursor.execute('''
                    CREATE TABLE face_tracklets (
                        id VARCHAR PRIMARY KEY,
                        video_id VARCHAR REFERENCES videos(id),
                        tracker_id INTEGER,
                        camera_id VARCHAR,
                        frame_start INTEGER,
                        frame_end INTEGER,
                        timestamp_start_seconds FLOAT,
                        timestamp_end_seconds FLOAT,
                        detection_count INTEGER,
                        mean_confidence FLOAT,
                        best_bbox TEXT,
                        best_crop_path VARCHAR,
                        label VARCHAR,
                        qdrant_point_id VARCHAR,
                        embedding_dim INTEGER DEFAULT 512,
                        embedding_backend VARCHAR DEFAULT 'clip',
                        indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                conn.commit()
                print("Schema Migration: Created 'face_tracklets' table.")

        except Exception as e:
            print("Startup Migration Error:", str(e))
        finally:
            conn.close()

run_startup_migrations()

# Ensure tables are created
Base.metadata.create_all(bind=engine)

# New installations do not have a SQLite file for the migration pass. Seed the
# same default Area after SQLAlchemy creates the tables so new cameras follow
# the same hierarchy as migrated installations.
with SessionLocal() as _startup_db:
    if not _startup_db.query(Area).filter(Area.name == "General").first():
        _startup_db.add(
            Area(
                id=str(uuid.uuid4()),
                name="General",
                description="Default Area for camera nodes",
            )
        )
        _startup_db.commit()

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
            "name": "ANPR",
            "description": "Automatic license plate detection, recognition, and watchlist alerting"
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

_mediamtx_lock = __import__('threading').Lock()

def start_mediamtx_server():
    global _mediamtx_process
    with _mediamtx_lock:  # HTTP and HTTPS listeners both fire the startup event (serve.py); launch once
        return _start_mediamtx_server_locked()


def _start_mediamtx_server_locked():
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
    """Start infrastructure without blocking API readiness on optional ML downloads."""
    print("Startup: CLIP encoder will load lazily when search or embedding work begins.")
    try:
        from app.auth.middleware import auth_enabled
        from app.db.models import UserAccount

        with SessionLocal() as db:
            if auth_enabled() and db.query(UserAccount).count() == 0:
                print("Startup: login is enabled but no accounts exist yet. Create the first Admin with:\n"
                      "    python -m app.auth.users add <username> --role admin --name \"<Name / Badge>\"")
    except Exception as exc:
        print(f"Startup Warning: could not check user accounts: {exc}")
    try:
        from app.runtime.device import log_device

        log_device()
    except Exception as exc:
        print(f"Startup Warning: could not determine compute device: {exc}")
    try:
        from app.search.vector_index import normalize_legacy_object_types

        with SessionLocal() as db:
            fixed = normalize_legacy_object_types(db)
        if fixed:
            print(f"Startup: normalised object_type on {fixed} legacy tracklets (person/vehicle filter).")
    except Exception as exc:
        print(f"Startup Warning: legacy object_type normalisation skipped: {exc}")
    try:
        from app.storage.media import normalize_model_paths

        with SessionLocal() as db:
            fixed = normalize_model_paths(db)
        if fixed:
            print(f"Startup: stored {fixed} model path(s) relative to backend/data (portable across machines).")
    except Exception as exc:
        print(f"Startup Warning: model path normalisation skipped: {exc}")
    start_mediamtx_server()

# Enable CORS for frontend integration (allow all origins for LAN / multi-device access)
# Login + Operator/Admin access control on every request (app/auth/policy.py). Registered before CORS so
# that CORS wraps it and even 401/403 responses carry CORS headers.
from app.auth.middleware import auth_middleware
app.middleware("http")(auth_middleware)

app.add_middleware(
    CORSMiddleware,
    # Reflect the requesting origin (LAN / multi-device access) — "*" cannot be combined with the
    # credentialed requests that carry the session cookie.
    allow_origin_regex=r".*",
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
from app.api.areas import router as areas_router

from app.api.cctv_wall import router as cctv_wall_router

# Register routes
from app.api.auth import router as auth_router
app.include_router(health_router, tags=["Health"])
app.include_router(auth_router, tags=["Auth"])
app.include_router(cameras_router, prefix=settings.api_prefix, tags=["Cameras"])
app.include_router(areas_router, tags=["Areas"])
app.include_router(cctv_wall_router, tags=["CCTV Wall"])
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
app.include_router(plate_detection_router, prefix=settings.api_prefix, tags=["ANPR"])
app.include_router(face_detection_router, prefix=settings.api_prefix, tags=["Face Detection"])
app.include_router(accident_detection_router, prefix=settings.api_prefix, tags=["Accident Detection"])
app.include_router(attributes_router, prefix=settings.api_prefix, tags=["Attributes"])
app.include_router(exports_router, prefix=settings.api_prefix, tags=["Forensic Export"])
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
