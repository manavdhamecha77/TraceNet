# TraceNet Detection & Tracking API

This guide covers the implemented YOLOv8 + ByteTrack detection pipeline.

## Model Placement

Place the provided weights file here:

`backend/app/detection/weights/best.pt`

The backend loads that file directly when running detection.

## What the API Does

- Runs object detection on the standardized video output
- Filters for person and vehicle classes
- Assigns consistent track IDs with ByteTrack
- Builds tracklet summaries with frame range, timestamps, confidence, and crop path
- Writes a detection artifact to disk for later UI retrieval

## Endpoints

### `GET /api/v1/detection/model`

Returns the detector configuration and whether `best.pt` is available.

Example response:

```json
{
  "model_path": "app/detection/weights/best.pt",
  "confidence_threshold": 0.25,
  "iou_threshold": 0.45,
  "max_frames": 0,
  "model_ready": true
}
```

### `POST /api/v1/videos/{video_id}/detections`

Runs detection and tracking for a stored video.

Request body:

```json
{
  "force": false
}
```

- Set `force` to `true` to rerun detection and overwrite the saved artifact.

### `GET /api/v1/videos/{video_id}/detections`

Returns the saved detection artifact for a processed video.

## Output Artifacts

Detection output is saved under:

`data/processed/detections/<video_id>/detections.json`

Tracklet crops are saved under:

`data/processed/detections/<video_id>/crops/`

## Frontend Check

On the camera detail page:

1. Upload a video to a registered camera.
2. Wait until processing status becomes `COMPLETE`.
3. Click `Detections`.
4. Review the tracklet drawer for:
   - tracklet ID
   - object type
   - class name
   - frame range
   - confidence
   - crop preview

## Smoke Test Notes

- If a clip contains visible people or vehicles, you should see non-empty tracklets.
- If a clip has no clear objects, the video can still process successfully with `0 tracklets`.
- The detection drawer is the normal review flow, not a debug-only screen.
