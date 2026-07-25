from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from loguru import logger

from app.embeddings.clip_encoder import ClipEncoder, get_clip_encoder
from app.embeddings.captioner import get_blip_captioner


@dataclass
class TrackletEmbeddingRecord:
    tracklet_id: str
    video_id: str
    camera_id: str
    object_type: str
    best_crop_path: str
    embedding_dim: int
    embedding: list[float]
    caption: str = ""
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class TrackletEmbeddingRunResult:
    video_id: str
    camera_id: str
    source_artifact_path: str
    embeddings_artifact_path: str
    model_name: str
    pretrained: str
    embedding_dim: int
    total_tracklets: int
    embedded_tracklets: int
    skipped_tracklets: int
    tracklets: list[TrackletEmbeddingRecord]

    def to_dict(self) -> dict[str, Any]:
        return {
            "video_id": self.video_id,
            "camera_id": self.camera_id,
            "source_artifact_path": self.source_artifact_path,
            "embeddings_artifact_path": self.embeddings_artifact_path,
            "model_name": self.model_name,
            "pretrained": self.pretrained,
            "embedding_dim": self.embedding_dim,
            "total_tracklets": self.total_tracklets,
            "embedded_tracklets": self.embedded_tracklets,
            "skipped_tracklets": self.skipped_tracklets,
            "tracklets": [asdict(tracklet) for tracklet in self.tracklets],
        }


class TrackletEmbeddingService:
    """Generate CLIP embeddings and BLIP auto-captions for saved tracklet crops."""

    def __init__(self, encoder: ClipEncoder | None = None) -> None:
        self.encoder = encoder or get_clip_encoder()
        self.captioner = get_blip_captioner()

    def embed_detection_artifact(self, detection_artifact_path: str | Path) -> TrackletEmbeddingRunResult:
        artifact_path = Path(detection_artifact_path)
        if not artifact_path.exists():
            raise FileNotFoundError(f"Detection artifact not found at '{artifact_path}'.")

        with open(artifact_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)

        tracklet_items = payload.get("tracklets", [])
        embedded_records: list[TrackletEmbeddingRecord] = []
        skipped_tracklets = 0

        for tracklet in tracklet_items:
            crop_path = tracklet.get("best_crop_path")
            if not crop_path or not os.path.exists(crop_path):
                skipped_tracklets += 1
                continue

            obj_type = str(tracklet.get("object_type", "unknown"))

            # Generate CLIP vector embedding
            embedding = self.encoder.embed_image(crop_path)

            # Generate BLIP auto-caption for extra text attributes
            caption = self.captioner.caption_image(crop_path, object_type=obj_type)
            attr_payload = {
                "caption": caption,
                "model": "Salesforce/blip-image-captioning-base",
                "class_name": tracklet.get("class_name")
            }

            embedded_records.append(
                TrackletEmbeddingRecord(
                    tracklet_id=str(tracklet.get("tracklet_id", "")),
                    video_id=str(tracklet.get("video_id", "")),
                    camera_id=str(tracklet.get("camera_id", "")),
                    object_type=obj_type,
                    best_crop_path=str(crop_path),
                    embedding_dim=len(embedding),
                    embedding=embedding,
                    caption=caption,
                    attributes=attr_payload,
                )
            )

        embeddings_artifact_path = artifact_path.with_name("embeddings.json")
        result = TrackletEmbeddingRunResult(
            video_id=str(payload.get("video_id", "")),
            camera_id=str(payload.get("camera_id", "")),
            source_artifact_path=str(artifact_path),
            embeddings_artifact_path=str(embeddings_artifact_path),
            model_name=self.encoder.model_name,
            pretrained=self.encoder.pretrained,
            embedding_dim=len(embedded_records[0].embedding) if embedded_records else 0,
            total_tracklets=len(tracklet_items),
            embedded_tracklets=len(embedded_records),
            skipped_tracklets=skipped_tracklets,
            tracklets=embedded_records,
        )

        with open(embeddings_artifact_path, "w", encoding="utf-8") as handle:
            json.dump(result.to_dict(), handle, indent=2)

        logger.info(
            "Embedding run complete for video {}: {} tracklets embedded & BLIP captioned, {} skipped.",
            result.video_id,
            result.embedded_tracklets,
            result.skipped_tracklets,
        )
        return result
