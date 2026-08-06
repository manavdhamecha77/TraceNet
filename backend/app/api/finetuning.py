"""
Model fine-tuning API endpoints.
Start, monitor, and manage fine-tuning jobs for local dataset adaptation.
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from loguru import logger

from app.training import get_fine_tuner

router = APIRouter(prefix="/api/v1", tags=["finetuning"])


class FineTuningRequest(BaseModel):
    camera_id: Optional[str] = None
    learning_rate: float = 2e-5
    num_epochs: int = 3
    batch_size: int = 2
    days: int = 30


class FineTuningResponse(BaseModel):
    training_id: str
    status: str
    progress: float = 0.0


class TrainingHistoryResponse(BaseModel):
    training_id: str
    status: str
    camera_id: Optional[str]
    num_videos: int
    avg_loss: float
    elapsed_seconds: float
    created_at: str
    error: Optional[str] = None


@router.post("/finetuning/start")
def start_finetuning(request: FineTuningRequest) -> FineTuningResponse:
    """
    Start a new fine-tuning job on local assault detection data.

    Parameters:
        camera_id: Optional camera filter for training data
        learning_rate: Optimizer learning rate (default 2e-5)
        num_epochs: Number of training epochs (default 3)
        batch_size: Training batch size (default 2)
        days: Days of historical data to use (default 30)

    Returns:
        Training job ID and initial status
    """
    tuner = get_fine_tuner()

    try:
        training_id = tuner.start_training(
            camera_id=request.camera_id,
            learning_rate=request.learning_rate,
            num_epochs=request.num_epochs,
            batch_size=request.batch_size
        )

        return FineTuningResponse(
            training_id=training_id,
            status="preparing",
            progress=0.1
        )

    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to start fine-tuning: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/finetuning/status/{training_id}")
def get_training_status(training_id: str) -> FineTuningResponse:
    """Get current status of a fine-tuning job."""
    tuner = get_fine_tuner()
    status_data = tuner.get_training_status(training_id)

    if not status_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Training job {training_id} not found"
        )

    return FineTuningResponse(
        training_id=training_id,
        status=status_data.get("status", "unknown"),
        progress=status_data.get("progress", 0.0)
    )


@router.get("/finetuning/history")
def get_finetuning_history() -> List[TrainingHistoryResponse]:
    """Get history of all fine-tuning jobs."""
    tuner = get_fine_tuner()
    history = tuner.get_training_history()

    return [
        TrainingHistoryResponse(
            training_id=item.get("training_id", "unknown"),
            status=item.get("status", "unknown"),
            camera_id=item.get("camera_id"),
            num_videos=item.get("num_videos", 0),
            avg_loss=item.get("avg_loss", 0.0),
            elapsed_seconds=item.get("elapsed_seconds", 0.0),
            created_at=item.get("created_at", ""),
            error=item.get("error")
        )
        for item in history
    ]


@router.get("/finetuning/info")
def get_finetuning_info() -> dict:
    """Get information about fine-tuning capabilities."""
    return {
        "base_model": "OPear/videomae-large-finetuned-UCF-Crime",
        "device": "cuda" if True else "cpu",
        "capabilities": [
            "transfer_learning",
            "local_dataset_adaptation",
            "incremental_training",
            "model_versioning"
        ],
        "default_parameters": {
            "learning_rate": 2e-5,
            "num_epochs": 3,
            "batch_size": 2,
            "num_frames": 8
        },
        "requirements": {
            "min_videos": 2,
            "min_days_data": 1
        }
    }
