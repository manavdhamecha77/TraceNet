import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.cameras import router as cameras_router
from app.api.detections import router as detections_router
from app.api.upload import router as upload_router
from app.config import get_settings
from app.db.models import Base
from app.db.session import engine
import sqlite3

# Ensure data folders exist
os.makedirs("data", exist_ok=True)
os.makedirs("data/minio_mock", exist_ok=True)
os.makedirs("data/cameras", exist_ok=True)
os.makedirs("data/processed/detections", exist_ok=True)

# Run schema migrations for SQLite dynamically to prevent OperationalError
def run_startup_migrations():
    db_path = "./data/drishti.db"
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
        except Exception as e:
            print("Startup Migration Error:", str(e))
        finally:
            conn.close()

run_startup_migrations()

# Ensure tables are created
Base.metadata.create_all(bind=engine)

settings = get_settings()

app = FastAPI(title=settings.app_name)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all during local dev to prevent CORS blocks
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the data directory statically to allow access to thumbnails and transcoded clips
app.mount("/data", StaticFiles(directory="data"), name="data")

# Register routes
app.include_router(health_router, prefix=settings.api_prefix)
app.include_router(cameras_router, prefix=settings.api_prefix)
app.include_router(detections_router, prefix=settings.api_prefix)
app.include_router(upload_router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "TraceNet & DRISHTI API is running"}
