# Project DRISHTI — Phase 1 Ingestion & Preprocessing API Documentation

This document describes the REST API endpoints implemented for Phase 1: Ingestion & Preprocessing.

---

## 1. Camera Management Endpoints

### Register a Camera Profile
* **Route**: `POST /api/v1/create-new-camera` (or `POST /api/v1/cameras`)
* **Content-Type**: `application/json`
* **Request Body**:
```json
{
  "camera_id": "CAM_042",
  "name": "Intersection East",
  "latitude": 23.0225,
  "longitude": 72.5714,
  "corridor_group": "Zone-A",
  "adjacency": ["CAM_041", "CAM_043"],
  "status": "active"
}
```

* **Responses & Status Codes**:
  * **`201 Created`**: Registration successful.
    ```json
    {
      "camera_id": "CAM_042",
      "name": "Intersection East",
      "latitude": 23.0225,
      "longitude": 72.5714,
      "corridor_group": "Zone-A",
      "adjacency": ["CAM_041", "CAM_043"],
      "is_active": true,
      "status": "active",
      "video_count": 0
    }
    ```
  * **`400 Bad Request`**: Validation error (e.g. invalid string length, malformed JSON).
  * **`409 Conflict`**: Camera ID already registered.
    ```json
    {
      "detail": "Camera with ID 'CAM_042' is already registered."
    }
    ```

### List Camera Profiles
* **Route**: `GET /api/v1/cameras`
* **Responses & Status Codes**:
  * **`200 OK`**: Returns a list of all camera profiles.
    ```json
    [
      {
        "camera_id": "CAM_042",
        "name": "Intersection East",
        "latitude": 23.0225,
        "longitude": 72.5714,
        "corridor_group": "Zone-A",
        "adjacency": ["CAM_041", "CAM_043"],
        "is_active": true,
        "status": "active",
        "video_count": 2
      }
    ]
    ```

---

## 2. Ingestion Endpoints

### Upload and Ingest Video
* **Route**: `POST /api/v1/ingest`
* **Content-Type**: `multipart/form-data`
* **Request Fields**:
  * `file`: Binary file stream (accepts formats like `.avi`, `.mov`, `.mp4`, `.mkv`).
  * `camera_id`: String (e.g., `"CAM_042"`). Must be registered.
  * `start_time`: String (Optional, ISO-8601 format, e.g., `"2026-07-15T20:00:00+05:30"`).

* **Responses & Status Codes**:
  * **`202 Accepted`**: Ingestion task successfully enqueued to background workers.
    ```json
    {
      "asset_id": "8b0ea738-959c-493e-b83c-f4de37a6b0c2",
      "camera_id": "CAM_042",
      "original_filename": "traffic_clip.avi",
      "intake_sha256": "4b6aefd8f...39c09c2a",
      "status": "pending",
      "message": "Upload accepted. Video transcoding and analysis started in the background."
    }
    ```
  * **`400 Bad Request`**: Empty file upload or missing required form fields.
  * **`404 Not Found`**: The specified `camera_id` does not exist in the database.
    ```json
    {
      "detail": "Camera with ID 'CAM_042' is not registered. Register the camera profile first."
    }
    ```
  * **`409 Conflict`**: File duplicate detected. The exact same video file (matching SHA-256) is already uploaded for this camera.
    ```json
    {
      "detail": "Conflict: Video file with hash '4b6aefd8f...39c09c2a' already uploaded for camera 'CAM_042'."
    }
    ```
  * **`500 Internal Server Error`**: File write or database record failure.

---

## 3. Video Asset Endpoints

### List Videos for a Camera
* **Route**: `GET /api/v1/cameras/{camera_id}/videos`
* **Responses & Status Codes**:
  * **`200 OK`**: Returns a list of video assets associated with the camera, ordered by upload time.
    ```json
    [
      {
        "id": "8b0ea738-959c-493e-b83c-f4de37a6b0c2",
        "camera_id": "CAM_042",
        "original_filename": "traffic_clip.avi",
        "standardized_filename": "traffic_clip_1719234851.mp4",
        "intake_sha256": "4b6aefd8f...39c09c2a",
        "transcoded_sha256": "9a7bcf12...fdc89a7",
        "upload_timestamp": "2026-07-15T20:00:39+05:30",
        "processing_status": "complete",
        "duration": 12.4,
        "start_time": "2026-07-15T20:00:00+05:30",
        "end_time": "2026-07-15T20:00:12.4+05:30",
        "thumbnail_path": "data/cameras/CAM_042_Intersection_East/inference/traffic_clip_1719234851/thumbnail.jpg"
      }
    ]
    ```
  * **`404 Not Found`**: Camera profile not found.

---

## 4. Static Asset Endpoint

### Serve Assets (Thumbnails & Transcoded Videos)
* **Route**: `GET /data/{path:path}`
* **Description**: Mounts the `./data/` folder directly.
* **Usage**:
  * To get a video thumbnail: `http://localhost:8000/data/cameras/{camera_id}_{camera_name}/inference/{standardized_video_name}/thumbnail.jpg`
  * To play the transcoded video: `http://localhost:8000/data/cameras/{camera_id}_{camera_name}/original_assets/{standardized_video_name}.mp4`
