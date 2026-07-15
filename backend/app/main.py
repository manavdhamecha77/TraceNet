import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.cameras import router as cameras_router
from app.api.upload import router as upload_router
from app.config import get_settings
from app.db.models import Base
from app.db.session import engine

# Ensure tables are created
Base.metadata.create_all(bind=engine)

# Ensure data folders exist
os.makedirs("data", exist_ok=True)
os.makedirs("data/minio_mock", exist_ok=True)
os.makedirs("data/cameras", exist_ok=True)

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
app.include_router(upload_router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "TraceNet & DRISHTI API is running"}
