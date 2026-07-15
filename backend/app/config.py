from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the TraceNet backend."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "TraceNet API"
    api_prefix: str = ""
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )
    cors_allow_credentials: bool = False
    cors_allow_methods: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_headers: list[str] = Field(default_factory=lambda: ["*"])
    detection_model_path: str = "app/detection/weights/best.pt"
    detection_confidence_threshold: float = 0.25
    detection_iou_threshold: float = 0.45
    detection_max_frames: int = 0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
