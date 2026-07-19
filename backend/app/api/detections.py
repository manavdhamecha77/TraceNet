from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings, get_data_path
from app.db.models import VideoAsset
from app.db.session import get_db
from app.detection.detector import DetectionService, resolve_standardized_video_path
from app.embeddings.tracklet_embeddings import TrackletEmbeddingService

router = APIRouter(prefix="/api/v1", tags=["detection"])


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATED VIDEO EXPORT LOGIC
# ─────────────────────────────────────────────────────────────────────────────
# DESIGN NOTE (Decoupling contract for future GPU service):
# The actual render work is isolated in `_render_annotated_video()` — a pure
# function that takes the artifact dict + video path + output path.
# To move this to a dedicated GPU/worker service later:
#   1. Extract `_render_annotated_video` into a Celery task (e.g. @celery_app.task)
#   2. Replace the direct call below with `task.delay(...)` or enqueue via RQ
#   3. Return a 202 Accepted with a job_id; poll a /jobs/{id} endpoint for status
#   The FastAPI endpoint shape (request/response schema) stays unchanged.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Roboflow-style diverse palette (BGR for OpenCV) ─────────────────────────
# Hex RGB → BGR: #RRGGBB → (BB, GG, RR)
_CLASS_COLORS_BGR: dict[str, tuple[int, int, int]] = {
    "person":        (56,  56,  255),  # vivid red      #FF3838
    "car":           (151, 157, 255),  # salmon pink    #FF9D97
    "truck":         (31, 112,  255),  # deep orange    #FF701F
    "bus":           (29, 178,  255),  # amber gold     #FFB21D
    "motorcycle":    (49, 210,  207),  # acid lime      #CFD231
    "bicycle":       (10, 249,  72),   # neon green     #48F90A
    "van":           (23, 204,  146),  # olive green    #92CC17
    "cat":           (134, 219, 61),   # mint           #3DDB86
    "dog":           (52,  147,  26),  # forest green   #1A9334
    "bird":          (187, 212,  0),   # teal           #00D4BB
    "horse":         (168, 153, 44),   # steel blue     #2C99A8
    "cow":           (255, 194,  0),   # sky blue       #00C2FF
    "sheep":         (147,  69,  52),  # navy           #344593
    "airplane":      (255, 115, 100),  # periwinkle     #6473FF
    "boat":          (236,  24,   0),  # deep blue      #0018EC
    "train":         (255,  56, 132),  # violet         #8438FF
    "traffic_light": (133,   0,  82),  # dark purple    #520085
    "stop_sign":     (255,  56, 203),  # magenta        #CB38FF
    "fire_hydrant":  (200, 149, 255),  # blush          #FF95C8
}
# Fallback palette \u2014 12 vivid hues cycling for any unknown class
_FALLBACK_BGR = [
    (75,  25,  230),  # #E6194B
    (75,  180,  60),  # #3CB44B
    (216, 99,   67),  # #4363D8
    (49,  130, 245),  # #F58231
    (180,  30, 145),  # #911EB4
    (244, 212,  66),  # #42D4F4
    (230,  50, 240),  # #F032E6
    (69,  239, 191),  # #BFEF45
    (212, 190, 250),  # #FABED4
    (144, 153,  70),  # #469990
    (255, 190, 220),  # #DCBEFF
    (36,  99,  154),  # #9A6324
]


def _class_color_bgr(class_name: str) -> tuple[int, int, int]:
    key = class_name.lower()
    if key in _CLASS_COLORS_BGR:
        return _CLASS_COLORS_BGR[key]
    # djb2 hash \u2014 same algorithm as frontend classColor() for consistency
    h = 5381
    for ch in key:
        h = ((h << 5) + h) + ord(ch)
    return _FALLBACK_BGR[abs(h) % len(_FALLBACK_BGR)]



def _render_annotated_video(
    artifact: dict,
    source_video_path: str,
    output_path: str,
    filter_class: Optional[str] = None,
) -> None:
    """
    Pure function: reads source video + detection artifact, draws bounding boxes
    with class labels per frame, writes annotated MP4 to output_path.

    ISOLATION CONTRACT: This function MUST remain dependency-free from FastAPI.
    It is designed to be extracted as a Celery/RQ task body verbatim.
    """
    import cv2  # local import — keeps this function fully portable

    frame_detections_by_index: dict[int, list[dict]] = {}
    for fd in artifact.get("frame_detections", []):
        frame_detections_by_index[fd["frame_index"]] = fd.get("detections", [])

    cap = cv2.VideoCapture(source_video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source video: {source_video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    frame_index = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            boxes = frame_detections_by_index.get(frame_index, [])
            for box in boxes:
                class_name = box.get("class_name", "unknown")
                if filter_class and class_name.lower() != filter_class.lower():
                    frame_index += 1
                    continue
                bbox = box.get("bbox", [])
                if len(bbox) < 4:
                    continue
                x1, y1, x2, y2 = (int(v) for v in bbox[:4])
                color = _class_color_bgr(class_name)
                conf = box.get("confidence", 0.0)
                tid = box.get("tracker_id")
                label = f"{class_name}"
                if tid is not None:
                    label += f" #{tid}"
                label += f" {conf:.0%}"

                # Draw filled rect header + bounding box
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                label_y = max(y1 - 6, 12)
                (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                cv2.rectangle(frame, (x1, label_y - lh - 4), (x1 + lw + 4, label_y + 2), color, -1)
                cv2.putText(frame, label, (x1 + 2, label_y - 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)

            writer.write(frame)
            frame_index += 1
    finally:
        cap.release()
        writer.release()



class DetectionServiceInfo(BaseModel):
    model_path: str
    confidence_threshold: float
    iou_threshold: float
    max_frames: int
    model_ready: bool


class DetectionRunResponse(BaseModel):
    video_id: str
    camera_id: str
    model_path: str
    video_path: str
    frame_count: int
    fps: float
    frame_detections: list[dict]
    tracklets: list[dict]
    artifact_path: str


class TrackletEmbeddingRecordResponse(BaseModel):
    tracklet_id: str
    video_id: str
    camera_id: str
    object_type: str
    best_crop_path: str
    embedding_dim: int
    embedding: list[float]


class TrackletEmbeddingRunResponse(BaseModel):
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
    tracklets: list[TrackletEmbeddingRecordResponse]


class DetectionRunRequest(BaseModel):
    force: bool = Field(default=False, description="Re-run detection even if an artifact already exists.")


@router.get("/detection/model", response_model=DetectionServiceInfo)
def get_detection_model_info() -> DetectionServiceInfo:
    settings = get_settings()
    model_path = settings.detection_model_path
    resolved_path = Path(model_path)
    if not resolved_path.is_absolute():
        local_path = resolved_path.resolve()
        fallback_path = Path(__file__).resolve().parents[2] / resolved_path
        if local_path.exists():
            resolved_path = local_path
        else:
            resolved_path = fallback_path
    return DetectionServiceInfo(
        model_path=model_path,
        confidence_threshold=settings.detection_confidence_threshold,
        iou_threshold=settings.detection_iou_threshold,
        max_frames=settings.detection_max_frames,
        model_ready=resolved_path.exists(),
    )


@router.post("/videos/{video_id}/detections", response_model=DetectionRunResponse)
def run_video_detections(
    video_id: str,
    payload: DetectionRunRequest,
    db: Session = Depends(get_db),
) -> DetectionRunResponse:
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_dir = get_data_path(os.path.join("processed/detections", video_id))
    artifact_path = os.path.join(artifact_dir, "detections.json")
    if os.path.exists(artifact_path) and not payload.force:
        with open(artifact_path, "r", encoding="utf-8") as handle:
            TrackletEmbeddingService().embed_detection_artifact(artifact_path)
            return DetectionRunResponse.model_validate_json(handle.read())

    try:
        video_path = resolve_standardized_video_path(video)
        service = DetectionService()
        result = service.analyze_video(
            video_path=video_path,
            output_dir=artifact_dir,
            camera_id=video.camera_id,
            video_id=video.id,
        )
        TrackletEmbeddingService().embed_detection_artifact(artifact_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return DetectionRunResponse.model_validate(result.to_dict())


@router.get("/videos/{video_id}/detections", response_model=DetectionRunResponse)
def get_video_detections(video_id: str, db: Session = Depends(get_db)) -> DetectionRunResponse:
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
    if not os.path.exists(artifact_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No detection artifact found for video '{video_id}'. Run detection first.",
        )

    with open(artifact_path, "r", encoding="utf-8") as handle:
        return DetectionRunResponse.model_validate_json(handle.read())


@router.post("/videos/{video_id}/embeddings", response_model=TrackletEmbeddingRunResponse)
def run_video_embeddings(video_id: str, db: Session = Depends(get_db)) -> TrackletEmbeddingRunResponse:
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
    if not os.path.exists(artifact_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No detection artifact found for video '{video_id}'. Run detection first.",
        )

    result = TrackletEmbeddingService().embed_detection_artifact(artifact_path)
    return TrackletEmbeddingRunResponse.model_validate(result.to_dict())


@router.get("/videos/{video_id}/embeddings", response_model=TrackletEmbeddingRunResponse)
def get_video_embeddings(video_id: str, db: Session = Depends(get_db)) -> TrackletEmbeddingRunResponse:
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_path = get_data_path(os.path.join("processed/detections", video_id, "embeddings.json"))
    if not os.path.exists(artifact_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No embedding artifact found for video '{video_id}'. Run embeddings first.",
        )

    with open(artifact_path, "r", encoding="utf-8") as handle:
        return TrackletEmbeddingRunResponse.model_validate_json(handle.read())


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATED VIDEO EXPORT ENDPOINT
# ─────────────────────────────────────────────────────────────────────────────

class AnnotatedExportRequest(BaseModel):
    filter_class: Optional[str] = Field(
        default=None,
        description="If set, only draw boxes for this class name (e.g. 'person', 'car')."
    )
    force: bool = Field(
        default=False,
        description="Re-render even if a cached export already exists."
    )


class AnnotatedExportResponse(BaseModel):
    video_id: str
    output_url: str           # Relative URL served via /data/ static mount
    output_path: str          # Absolute path on disk
    filter_class: Optional[str]
    cached: bool              # True if the file already existed and was reused


@router.post("/videos/{video_id}/export-annotated", response_model=AnnotatedExportResponse)
def export_annotated_video(
    video_id: str,
    payload: AnnotatedExportRequest,
    db: Session = Depends(get_db),
) -> AnnotatedExportResponse:
    """
    On-demand annotated video generation.
    Renders bounding boxes from detections.json onto the standardized video
    and saves the result as an MP4 that the frontend can stream.

    SCALING NOTE: When a dedicated GPU rendering service is introduced,
    replace the _render_annotated_video() call with a queue enqueue call
    and return 202 Accepted + job_id. The endpoint signature stays unchanged.
    """
    video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video asset with ID '{video_id}' does not exist.",
        )

    artifact_path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
    if not os.path.exists(artifact_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No detection artifact found for video '{video_id}'. Run detection first.",
        )

    # Determine output filename (include filter_class in name to allow caching per class)
    class_suffix = f"_{payload.filter_class}" if payload.filter_class else "_all"
    output_filename = f"annotated{class_suffix}.mp4"
    output_dir = get_data_path(os.path.join("processed/detections", video_id))
    output_path = os.path.join(output_dir, output_filename)

    # Cache hit — return existing file if not forcing
    if os.path.exists(output_path) and not payload.force:
        output_url = f"/data/processed/detections/{video_id}/{output_filename}"
        return AnnotatedExportResponse(
            video_id=video_id,
            output_url=output_url,
            output_path=output_path,
            filter_class=payload.filter_class,
            cached=True,
        )

    # Resolve source video path
    source_video_path = resolve_standardized_video_path(video)
    if not os.path.exists(source_video_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source video file not found at '{source_video_path}'.",
        )

    # Load artifact and render
    with open(artifact_path, "r", encoding="utf-8") as fh:
        artifact = json.load(fh)

    try:
        _render_annotated_video(
            artifact=artifact,
            source_video_path=source_video_path,
            output_path=output_path,
            filter_class=payload.filter_class,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Annotated video render failed: {exc}",
        ) from exc

    output_url = f"/data/processed/detections/{video_id}/{output_filename}"
    return AnnotatedExportResponse(
        video_id=video_id,
        output_url=output_url,
        output_path=output_path,
        filter_class=payload.filter_class,
        cached=False,
    )

