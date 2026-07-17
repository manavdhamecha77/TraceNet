# TraceNet Embeddings API

This guide covers the CLIP-based tracklet embedding step that runs after detection and tracking.

## What It Does

- Loads the CLIP singleton once at FastAPI startup
- Reads saved tracklet crops from the detection output
- Generates a 512-dimensional embedding for each available crop
- Writes an `embeddings.json` sidecar file for later search/indexing work

## Endpoint

### `POST /api/v1/videos/{video_id}/embeddings`

Generates embeddings for the saved tracklets of a processed video.

Requirements:

- A detection artifact must already exist at `data/processed/detections/<video_id>/detections.json`
- Tracklet crops must exist under `data/processed/detections/<video_id>/crops/`

Example response:

```json
{
  "video_id": "73fc2c95-7898-4f30-8a83-3ceac8661e33",
  "camera_id": "CAM_SMOKE",
  "source_artifact_path": "data/processed/detections/73fc2c95-7898-4f30-8a83-3ceac8661e33/detections.json",
  "embeddings_artifact_path": "data/processed/detections/73fc2c95-7898-4f30-8a83-3ceac8661e33/embeddings.json",
  "model_name": "ViT-B-32",
  "pretrained": "openai",
  "embedding_dim": 512,
  "total_tracklets": 1,
  "embedded_tracklets": 1,
  "skipped_tracklets": 0,
  "tracklets": []
}
```

### `GET /api/v1/videos/{video_id}/embeddings`

Returns the saved embeddings artifact for a processed video.

## Output Artifact

Embeddings are written to:

`data/processed/detections/<video_id>/embeddings.json`

Each tracklet record includes:

- `tracklet_id`
- `video_id`
- `camera_id`
- `object_type`
- `best_crop_path`
- `embedding_dim`
- `embedding`

## Local Smoke Test

From `D:\Coding\Projects\TraceNet\backend`, with the API running:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/v1/videos/73fc2c95-7898-4f30-8a83-3ceac8661e33/embeddings" | ConvertTo-Json -Depth 10
```

Then verify the artifact exists:

```powershell
Test-Path "data\processed\detections\73fc2c95-7898-4f30-8a83-3ceac8661e33\embeddings.json"
```

## Direct Crop Test

If you only want to test one crop file:

```powershell
@'
from app.embeddings.clip_encoder import get_clip_encoder
enc = get_clip_encoder()
emb = enc.embed_image(r"data\processed\detections\73fc2c95-7898-4f30-8a83-3ceac8661e33\crops\73fc2c95-7898-4f30-8a83-3ceac8661e33_trk_2.jpg")
print("dim =", len(emb))
print("first5 =", emb[:5])
'@ | python -
```

Expected:

- `dim = 512`

## Notes

- The first CLIP load may take longer because the model weights are fetched once and cached locally.
- The embedding vector values are not meant to be read directly; they are used later for similarity search.
- This step is a prerequisite for FAISS indexing and natural-language search.
