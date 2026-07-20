import os
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from loguru import logger

from app.db.session import get_db
from app.db.models import VideoAsset
from app.embeddings.clip_encoder import get_clip_encoder, ClipEncoder
from app.search.vector_index import VectorIndexService
from app.config import get_data_path

router = APIRouter(prefix="/api/v1", tags=["embedding-models"])

# File to store current selected embedding model configuration
CONFIG_PATH = get_data_path("embedding_model_config.json")

DEFAULT_EMBEDDING_MODELS = [
    {
        "id": "clip-vit-b-32-openai",
        "name": "OpenAI CLIP ViT-B/32",
        "architecture": "ViT-B-32",
        "pretrained": "openai",
        "dimension": 512,
        "framework": "OpenCLIP",
        "description": "Standard balanced baseline for fast visual-text search across general categories.",
        "category": "CLIP Baseline",
        "is_active": True,
    },
    {
        "id": "clip-vit-b-16-openai",
        "name": "OpenAI CLIP ViT-B/16",
        "architecture": "ViT-B-16",
        "pretrained": "openai",
        "dimension": 512,
        "framework": "OpenCLIP",
        "description": "Higher spatial granularity patch-16 tokenization for finer attribute matching.",
        "category": "CLIP Baseline",
        "is_active": False,
    },
    {
        "id": "openclip-laion-vit-b16",
        "name": "OpenCLIP (LAION) ViT-B/16",
        "architecture": "ViT-B-16",
        "pretrained": "laion2b_s34b_b88k",
        "dimension": 512,
        "framework": "OpenCLIP / LAION-2B",
        "description": "Trained on LAION-2B web dataset. Stronger open-world vocabulary zero-shot score.",
        "category": "OpenCLIP Web-Scale",
        "is_active": False,
    },
    {
        "id": "openclip-laion-vit-l14",
        "name": "OpenCLIP (LAION) ViT-L/14",
        "architecture": "ViT-L-14",
        "pretrained": "laion2b_s32b_b82k",
        "dimension": 768,
        "framework": "OpenCLIP Large",
        "description": "Large vision backbone with 768-dim vector embeddings for complex detailed queries.",
        "category": "OpenCLIP Web-Scale",
        "is_active": False,
    },
    {
        "id": "siglip2-google",
        "name": "SigLIP 2 (Google, 2025)",
        "architecture": "ViT-B-16-SigLIP",
        "pretrained": "webli",
        "dimension": 768,
        "framework": "Google SigLIP",
        "description": "Sigmoid loss vision-language model. State-of-the-art fine-grained text attribute grounding.",
        "category": "Next-Gen Contrastive",
        "is_active": False,
    },
    {
        "id": "eva-clip-laion",
        "name": "EVA-CLIP (EVA02-E-14-plus)",
        "architecture": "EVA02-E-14-plus",
        "pretrained": "laion2b_s9b_b144k",
        "dimension": 1024,
        "framework": "EVA-CLIP",
        "description": "Giant EVA02 Transformer trunk with 1024-dim embedding space for forensic precision.",
        "category": "High-Capacity Vision",
        "is_active": False,
    },
    {
        "id": "irra-tbps-clip-person",
        "name": "Fine-Tuned Person-Retrieval (IRRA / TBPS-CLIP)",
        "architecture": "convnext_base_w",
        "pretrained": "laion2b_s13b_b82k",
        "dimension": 640,
        "framework": "Person-ReID Fine-Tuned",
        "description": "Text-based person retrieval branch optimized for clothing color, backpack, and gait attributes.",
        "category": "Forensic Domain-Specific",
        "is_active": False,
    },
    {
        "id": "blip2-multimodal-llm",
        "name": "BLIP-2 / Multimodal LLM Embeddings",
        "architecture": "coca_ViT-B-32",
        "pretrained": "mscoco_finetuned",
        "dimension": 512,
        "framework": "CoCa / BLIP-2 Multimodal",
        "description": "Contrastive + Captioning dual-loss encoder for natural language query understanding.",
        "category": "Multimodal LLM",
        "is_active": False,
    },
]


def load_active_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return DEFAULT_EMBEDDING_MODELS[0]


def save_active_config(model_dict: dict):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(model_dict, f, indent=2)


class SelectModelRequest(BaseModel):
    model_id: str


@router.get("/embedding-models")
def list_embedding_models():
    active = load_active_config()
    active_id = active.get("id", "clip-vit-b-32-openai")

    result = []
    for m in DEFAULT_EMBEDDING_MODELS:
        item = dict(m)
        item["is_active"] = (item["id"] == active_id)
        result.append(item)
    return {"active_model": active, "models": result}


@router.post("/embedding-models/select")
def select_embedding_model(req: SelectModelRequest):
    target = next((m for m in DEFAULT_EMBEDDING_MODELS if m["id"] == req.model_id), None)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Embedding model '{req.model_id}' not found in registry."
        )

    save_active_config(target)
    
    # Reset singleton encoder cache so next query uses new model architecture
    get_clip_encoder.cache_clear()
    logger.info(f"Switched active embedding model to: {target['name']} ({target['architecture']})")

    return {
        "status": "success",
        "message": f"Activated {target['name']}. Re-indexing is recommended to align vector dimensions.",
        "active_model": target
    }


@router.post("/embedding-models/reindex")
def reindex_all_tracklets(db: Session = Depends(get_db)):
    """Triggers re-indexing of all completed videos with the active embedding model."""
    videos = db.query(VideoAsset).filter(VideoAsset.processing_status == "complete").all()
    if not videos:
        return {"reindexed_count": 0, "status": "no_videos", "message": "No completed videos to re-index."}

    indexer = VectorIndexService()
    reindexed = 0

    for video in videos:
        try:
            indexer.index_video_tracklets(video.id, db)
            reindexed += 1
        except Exception as e:
            logger.error(f"Failed to re-index video {video.id}: {e}")

    return {
        "status": "success",
        "reindexed_count": reindexed,
        "message": f"Re-indexed tracklets for {reindexed} video assets using active model."
    }
