from __future__ import annotations

import io
import imghdr
import tempfile
from pathlib import Path
from typing import Optional, Sequence
from datetime import datetime

from PIL import Image
from starlette.concurrency import run_in_threadpool
from loguru import logger
from sqlalchemy.orm import Session

from app.embeddings.clip_encoder import get_clip_encoder
from app.search.query_engine import QueryEngine

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_FORMATS = {"jpeg", "png", "webp", "bmp"}


class ImageSearchService:
    """
    Validates and encodes an uploaded reference image, then delegates
    vector search to QueryEngine using the image embedding instead of text.
    Reuses all existing Qdrant + SQLite enrichment logic via search_by_vector().
    """

    async def search_from_upload(
        self,
        file_bytes: bytes,
        filename: str,
        db: Session,
        camera_ids: Optional[Sequence[str]] = None,
        time_start: Optional[datetime] = None,
        time_end: Optional[datetime] = None,
        object_type: Optional[str] = None,
        top_k: int = 15,
        user_id: str = "demo",
    ) -> list[dict]:
        # 1. Validate file size
        if len(file_bytes) > MAX_FILE_BYTES:
            raise ValueError(
                f"Image exceeds maximum size of {MAX_FILE_BYTES // (1024 * 1024)} MB."
            )

        # 2. Validate format using stdlib imghdr (no extra deps)
        detected = imghdr.what(None, h=file_bytes)
        if detected not in ALLOWED_FORMATS:
            raise ValueError(
                f"Unsupported image format: '{detected}'. Must be JPEG, PNG, WebP, or BMP."
            )

        # 3. Open and convert to RGB using Pillow
        try:
            pil_image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        except Exception as exc:
            raise ValueError(f"Could not open image: {exc}") from exc

        # 4. Write to a NamedTemporaryFile — ClipEncoder.embed_image() takes a path
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = Path(tmp.name)
            pil_image.save(tmp_path, format="JPEG", quality=95)

        try:
            # 5. Encode with CLIP in a thread pool (CPU-bound)
            encoder = get_clip_encoder()
            image_vector = await run_in_threadpool(encoder.embed_image, str(tmp_path))
            logger.info(
                f"ImageSearchService: encoded '{filename}' -> {len(image_vector)}-dim vector"
            )
        finally:
            tmp_path.unlink(missing_ok=True)  # Always clean up temp file

        # 6. Delegate to QueryEngine's shared vector-search core
        engine = QueryEngine()
        results = await run_in_threadpool(
            engine.search_by_vector,
            db=db,
            query_vector=image_vector,
            query_label=f"[IMAGE SEARCH] {filename}",
            camera_ids=camera_ids,
            time_start=time_start,
            time_end=time_end,
            object_type=object_type,
            top_k=top_k,
            user_id=user_id,
        )
        return results
