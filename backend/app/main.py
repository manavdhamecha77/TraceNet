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
    allow_origins=["*"],  # Allow all during local dev to prevent CORS blocks
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the data directory statically to allow access to thumbnails and transcoded clips
app.mount("/data", StaticFiles(directory=get_data_path("")), name="data")

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


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "TraceNet & DRISHTI API is running"}
