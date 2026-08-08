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
from app.config import get_settings, get_data_path
from app.embeddings.clip_encoder import get_clip_encoder
from app.db.models import Base
from app.db.session import engine
import sqlite3

# Ensure data folders exist absolutely in backend/data/
os.makedirs(get_data_path(""), exist_ok=True)
os.makedirs(get_data_path("minio_mock"), exist_ok=True)
os.makedirs(get_data_path("cameras"), exist_ok=True)
os.makedirs(get_data_path("processed/detections"), exist_ok=True)
os.makedirs(get_data_path("models"), exist_ok=True)
os.makedirs(get_data_path("finetuned_models"), exist_ok=True)
os.makedirs(get_data_path("audit_logs"), exist_ok=True)

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

            # Check if tracklets table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tracklets'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(tracklets)")
                columns = [c[1] for c in cursor.fetchall()]

                if "attributes" not in columns:
                    cursor.execute("ALTER TABLE tracklets ADD COLUMN attributes TEXT")
                    conn.commit()
                    print("Schema Migration: Added 'attributes' column to tracklets.")

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
        except Exception as e:
            print("Startup Migration Error:", str(e))
        finally:
            conn.close()

run_startup_migrations()

# Ensure tables are created
Base.metadata.create_all(bind=engine)

settings = get_settings()

app = FastAPI(title=settings.app_name)


@app.on_event("startup")
def load_startup_singletons() -> None:
    """Load shared ML models once at app startup."""
    clip_encoder = get_clip_encoder()
    app.state.clip_encoder = clip_encoder
    print(
        "Startup: CLIP encoder loaded "
        f"(model={clip_encoder.model_name}, pretrained={clip_encoder.pretrained}, device={clip_encoder.device})."
    )

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:[0-9]+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the data directory statically to allow access to thumbnails and transcoded clips
app.mount("/data", StaticFiles(directory=get_data_path("")), name="data")

from app.api.assistant import router as assistant_router
# from app.api.multicam import router as multicam_router

# Register routes
app.include_router(health_router, prefix=settings.api_prefix)
app.include_router(cameras_router, prefix=settings.api_prefix)
app.include_router(detections_router, prefix=settings.api_prefix)
app.include_router(upload_router, prefix=settings.api_prefix)
app.include_router(models_router, prefix=settings.api_prefix)
app.include_router(embedding_models_router, prefix=settings.api_prefix)
app.include_router(search_router, prefix=settings.api_prefix)
app.include_router(metrics_router, prefix=settings.api_prefix)
app.include_router(alerts_router, prefix=settings.api_prefix)
app.include_router(analytics_router, prefix=settings.api_prefix)
app.include_router(audit_router, prefix=settings.api_prefix)
app.include_router(assault_detection_router, prefix=settings.api_prefix)
app.include_router(processing_router, prefix=settings.api_prefix)
app.include_router(webhooks_router, prefix=settings.api_prefix)
app.include_router(frame_inspection_router, prefix=settings.api_prefix)
app.include_router(finetuning_router, prefix=settings.api_prefix)
app.include_router(assistant_router, prefix=settings.api_prefix)
app.include_router(system_jobs_router, prefix=settings.api_prefix)
# app.include_router(multicam_router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "TraceNet & DRISHTI API is running"}
