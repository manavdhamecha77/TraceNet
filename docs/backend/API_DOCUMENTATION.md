# TraceNet & DRISHTI API Documentation

Comprehensive API reference for the Video Surveillance, Real-time Detection & Hybrid Search Intelligence (DRISHTI) system.

## API Base URL

```
http://localhost:8000/api/v1
```

## Authentication

All API endpoints require an Authorization header with a Bearer token:

```http
Authorization: Bearer <token>
```

### Available Test Tokens (Development)

- `admin_user` - Full system access (Admin role)
- `operator_user` - Alert management & monitoring (Operator role)
- `analyst_user` - Data analysis & search (Analyst role)
- `viewer_user` - Read-only access (Viewer role)

### User Roles & Permissions

#### Admin
- Full system access
- Can create/update/delete cameras, models, users
- Can configure webhooks and audit settings
- Can trigger fine-tuning jobs

#### Operator
- View and acknowledge alerts
- Manage webhooks
- View assault detection results
- View frame inspection data

#### Analyst
- View all data
- Run searches
- View analytics and statistics
- Read audit logs

#### Viewer
- Read-only access to most endpoints
- Cannot modify any data

#### Guest
- Limited read-only access
- Basic camera and alert viewing only

---

## API Endpoints

### Health & Status

#### Get Health Status
```http
GET /api/v1/health
```

Returns system health and status information.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-08-12T10:30:00Z"
}
```

---

### Cameras

#### List All Cameras
```http
GET /api/v1/cameras
```

**Query Parameters:**
- `status` (optional): Filter by status ('active', 'inactive', 'maintenance')
- `limit` (optional): Max results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
[
  {
    "camera_id": "CAM_001",
    "name": "Front Entrance",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "status": "active",
    "model_id": "yolo11-general",
    "assault_model_id": "videomae-assault"
  }
]
```

#### Get Camera Details
```http
GET /api/v1/cameras/{camera_id}
```

**Requires Permission:** `cameras:read`

**Response:**
```json
{
  "camera_id": "CAM_001",
  "name": "Front Entrance",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "altitude": 10.5,
  "status": "active",
  "participate_in_alerts": true,
  "model_id": "yolo11-general",
  "theft_model_id": "yolo11-theft",
  "abandoned_model_id": "yolo11-abandoned",
  "assault_model_id": "videomae-assault"
}
```

#### Create Camera
```http
POST /api/v1/cameras
```

**Requires Permission:** `cameras:create`

**Request Body:**
```json
{
  "camera_id": "CAM_002",
  "name": "Back Parking Lot",
  "latitude": 40.7130,
  "longitude": -74.0061,
  "altitude": 5.0,
  "status": "active"
}
```

#### Update Camera
```http
PUT /api/v1/cameras/{camera_id}
```

**Requires Permission:** `cameras:update`

**Request Body:**
```json
{
  "name": "Updated Camera Name",
  "status": "active",
  "assault_model_id": "videomae-assault"
}
```

#### Delete Camera
```http
DELETE /api/v1/cameras/{camera_id}
```

**Requires Permission:** `cameras:delete`

---

### Alerts

#### List Alerts
```http
GET /api/v1/alerts
```

**Query Parameters:**
- `camera_id` (optional): Filter by camera
- `alert_type` (optional): Filter by type
- `acknowledged` (optional): true/false
- `limit` (optional): Max results
- `offset` (optional): Pagination offset

**Response:**
```json
[
  {
    "id": 1,
    "alert_type": "assault",
    "camera_id": "CAM_001",
    "video_id": "video_001",
    "timestamp": "2024-08-12T10:30:00Z",
    "acknowledged": false,
    "confidence": 0.92,
    "assault_type": "physical_assault"
  }
]
```

#### Get Alert Details
```http
GET /api/v1/alerts/{alert_id}
```

**Requires Permission:** `alerts:read`

#### Acknowledge Alert
```http
PUT /api/v1/alerts/{alert_id}/acknowledge
```

**Requires Permission:** `alerts:update`

**Request Body:**
```json
{
  "acknowledged_by": "operator_user"
}
```

#### Delete Alert
```http
DELETE /api/v1/alerts/{alert_id}
```

**Requires Permission:** `alerts:delete`

**Requires Role:** Admin

---

### Assault Detection

#### Get Assault Detection Model Status
```http
GET /api/v1/assault-detection/model/status
```

**Response:**
```json
{
  "model_name": "videomae-large-finetuned-UCF-Crime",
  "model_loaded": true,
  "device": "cuda:0",
  "confidence_threshold": 0.6
}
```

#### List Assault Alerts
```http
GET /api/v1/assault-detection/alerts
```

**Query Parameters:**
- `camera_id` (optional): Filter by camera
- `acknowledged` (optional): true/false
- `limit` (optional): Max results

**Requires Permission:** `assault_detection:read`

**Response:**
```json
{
  "alerts": [
    {
      "id": 42,
      "camera_id": "CAM_001",
      "video_id": "video_001",
      "timestamp": "2024-08-12T10:30:00Z",
      "confidence": 0.95,
      "assault_type": "physical_assault"
    }
  ]
}
```

#### Get Assault Statistics
```http
GET /api/v1/assault-detection/statistics?days=7
```

**Query Parameters:**
- `days` (optional): Time window in days (default: 7)
- `camera_id` (optional): Filter by camera

**Requires Permission:** `assault_detection:read`

**Response:**
```json
{
  "total_videos_analyzed": 150,
  "assaults_detected": 12,
  "high_confidence_assaults": 8,
  "assault_types": {
    "physical_assault": 7,
    "weapon_involvement": 3,
    "group_violence": 2
  },
  "average_confidence": 0.87
}
```

---

### Frame Inspection

#### Get Frame Analysis by Alert
```http
GET /api/v1/frame-inspection/alert/{alert_id}
```

**Requires Permission:** `frame_inspection:read`

**Response:**
```json
{
  "video_id": "video_001",
  "camera_id": "CAM_001",
  "alert_id": 42,
  "has_assault": true,
  "assault_type": "physical_assault",
  "peak_confidence": 0.95,
  "detected_frames": [
    {
      "frame_number": 150,
      "timestamp_seconds": 5.0,
      "confidence": 0.92,
      "assault_type": "physical_assault",
      "is_key_frame": true
    }
  ],
  "total_frames_analyzed": 300,
  "video_duration_seconds": 10.0,
  "detection_timestamp": "2024-08-12T10:30:00Z"
}
```

#### Get Frame Analysis by Video
```http
GET /api/v1/frame-inspection/video/{video_id}
```

**Requires Permission:** `frame_inspection:read`

---

### Fine-Tuning

#### Get Fine-Tuning Model Info
```http
GET /api/v1/finetuning/info
```

**Response:**
```json
{
  "base_model": "videomae-large",
  "default_learning_rate": 0.00002,
  "default_epochs": 3,
  "default_batch_size": 2
}
```

#### Start Fine-Tuning Job
```http
POST /api/v1/finetuning/start
```

**Requires Permission:** `finetuning:start`

**Request Body:**
```json
{
  "camera_id": "CAM_001",
  "learning_rate": 0.00002,
  "num_epochs": 3,
  "batch_size": 2,
  "days": 30
}
```

**Response:**
```json
{
  "training_id": "train_abc123",
  "status": "pending",
  "camera_id": "CAM_001",
  "created_at": "2024-08-12T10:30:00Z"
}
```

#### Get Fine-Tuning Job Status
```http
GET /api/v1/finetuning/status/{training_id}
```

**Requires Permission:** `finetuning:read`

**Response:**
```json
{
  "training_id": "train_abc123",
  "status": "running",
  "progress": 45,
  "avg_loss": 0.324,
  "elapsed_seconds": 1200,
  "num_videos": 150
}
```

#### Get Fine-Tuning History
```http
GET /api/v1/finetuning/history
```

**Requires Permission:** `finetuning:read`

**Response:**
```json
[
  {
    "training_id": "train_abc123",
    "status": "completed",
    "camera_id": "CAM_001",
    "avg_loss": 0.123,
    "created_at": "2024-08-12T10:00:00Z"
  }
]
```

---

### Webhooks

#### Register Webhook
```http
POST /api/v1/webhooks
```

**Requires Permission:** `webhooks:create`

**Request Body:**
```json
{
  "url": "https://example.com/webhook",
  "webhook_type": "assault",
  "confidence_threshold": 0.7,
  "camera_ids": ["CAM_001", "CAM_002"]
}
```

**Response:**
```json
{
  "id": "webhook_001",
  "url": "https://example.com/webhook",
  "webhook_type": "assault",
  "is_active": true,
  "confidence_threshold": 0.7,
  "camera_ids": ["CAM_001", "CAM_002"],
  "delivery_count": 0,
  "created_at": "2024-08-12T10:30:00Z"
}
```

#### List Webhooks
```http
GET /api/v1/webhooks
```

**Requires Permission:** `webhooks:read`

#### Update Webhook
```http
PUT /api/v1/webhooks/{webhook_id}
```

**Requires Permission:** `webhooks:update`

#### Delete Webhook
```http
DELETE /api/v1/webhooks/{webhook_id}
```

**Requires Permission:** `webhooks:delete`

---

### Video Processing

#### Get Processing Job Status
```http
GET /api/v1/processing/jobs/{job_id}
```

**Response:**
```json
{
  "job_id": "job_xyz789",
  "status": "processing",
  "video_id": "video_001",
  "camera_id": "CAM_001",
  "progress_percentage": 65,
  "processed_frames": 650,
  "total_frames": 1000,
  "started_at": "2024-08-12T10:00:00Z"
}
```

---

### Models

#### List Available Models
```http
GET /api/v1/models
```

**Query Parameters:**
- `category` (optional): Filter by category (general, theft, abandoned, assault)
- `is_default` (optional): true/false

**Response:**
```json
[
  {
    "id": "yolo11-general",
    "name": "YOLOv11 General Detection",
    "model_type": "YOLOv11",
    "category": "general",
    "is_default": true,
    "classes": ["person", "vehicle", "backpack", "handbag"]
  },
  {
    "id": "videomae-assault",
    "name": "VideoMAE Assault Detection",
    "model_type": "VideoMAE",
    "category": "assault",
    "classes": ["physical_assault", "weapon_involvement"]
  }
]
```

---

### Search

#### Perform Semantic Search
```http
POST /api/v1/search
```

**Request Body:**
```json
{
  "query": "person in red shirt running",
  "camera_ids": ["CAM_001", "CAM_002"],
  "days": 7,
  "confidence_threshold": 0.5
}
```

**Requires Permission:** `search:read`

**Response:**
```json
{
  "query": "person in red shirt running",
  "results": [
    {
      "tracklet_id": "tracklet_001",
      "video_id": "video_001",
      "camera_id": "CAM_001",
      "confidence": 0.89,
      "timestamp": "2024-08-12T10:30:00Z",
      "thumbnail_url": "/data/thumbnails/tracklet_001.jpg"
    }
  ],
  "total_results": 15
}
```

---

### Analytics

#### Get Detection Analytics
```http
GET /api/v1/analytics/detections?days=30
```

**Requires Permission:** `analytics:read`

**Response:**
```json
{
  "period_days": 30,
  "total_videos_processed": 500,
  "total_detections": 2500,
  "detection_types": {
    "person": 1500,
    "vehicle": 800,
    "backpack": 200
  },
  "top_cameras": [
    {
      "camera_id": "CAM_001",
      "detection_count": 450
    }
  ]
}
```

---

### Audit

#### Get Audit Logs
```http
GET /api/v1/audit/logs
```

**Query Parameters:**
- `user_id` (optional): Filter by user
- `action` (optional): Filter by action
- `limit` (optional): Max results

**Requires Permission:** `audit:read`

**Response:**
```json
[
  {
    "id": 1,
    "user_id": "operator_user",
    "action": "acknowledge_alert",
    "resource": "alert_42",
    "timestamp": "2024-08-12T10:30:00Z",
    "details": {"alert_id": 42}
  }
]
```

---

## Error Responses

### 400 Bad Request
```json
{
  "detail": "Invalid request parameters"
}
```

### 401 Unauthorized
```json
{
  "detail": "Missing or invalid authorization header"
}
```

### 403 Forbidden
```json
{
  "detail": "Permission denied. Required: alerts:delete"
}
```

### 404 Not Found
```json
{
  "detail": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "Internal server error"
}
```

---

## Rate Limiting

API endpoints are rate limited to prevent abuse:

- **Standard endpoints**: 100 requests per minute
- **Search endpoint**: 10 requests per minute
- **Fine-tuning**: 5 jobs per hour

---

## Documentation Links

- **Interactive API Docs (Swagger UI)**: `http://localhost:8000/api/docs`
- **ReDoc Documentation**: `http://localhost:8000/api/redoc`
- **OpenAPI Schema**: `http://localhost:8000/api/openapi.json`

---

## Example Usage

### Using curl

```bash
# Get cameras (as Analyst)
curl -X GET "http://localhost:8000/api/v1/cameras" \
  -H "Authorization: Bearer analyst_user"

# Acknowledge an alert (as Operator)
curl -X PUT "http://localhost:8000/api/v1/alerts/42/acknowledge" \
  -H "Authorization: Bearer operator_user" \
  -H "Content-Type: application/json" \
  -d '{"acknowledged_by": "operator_user"}'

# Start fine-tuning (as Admin)
curl -X POST "http://localhost:8000/api/v1/finetuning/start" \
  -H "Authorization: Bearer admin_user" \
  -H "Content-Type: application/json" \
  -d '{
    "camera_id": "CAM_001",
    "learning_rate": 0.00002,
    "num_epochs": 3,
    "batch_size": 2,
    "days": 30
  }'
```

### Using Python requests

```python
import requests

BASE_URL = "http://localhost:8000/api/v1"
HEADERS = {"Authorization": "Bearer analyst_user"}

# Get alerts
response = requests.get(
    f"{BASE_URL}/alerts",
    headers=HEADERS,
    params={"camera_id": "CAM_001"}
)
alerts = response.json()

# Search
response = requests.post(
    f"{BASE_URL}/search",
    headers=HEADERS,
    json={
        "query": "person in red shirt",
        "days": 7
    }
)
results = response.json()
```

### Using JavaScript/TypeScript

```typescript
const API_BASE = "http://localhost:8000/api/v1";
const token = "analyst_user";

async function getAlerts(cameraId?: string) {
  const params = new URLSearchParams();
  if (cameraId) params.append("camera_id", cameraId);

  const response = await fetch(`${API_BASE}/alerts?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return response.json();
}

async function search(query: string) {
  const response = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      days: 7,
      confidence_threshold: 0.5
    })
  });

  return response.json();
}
```

---

## Version History

- **v1.0.0** (2024-08-12)
  - Initial API release
  - Core endpoints for cameras, alerts, detection
  - Assault detection with VideoMAE
  - Webhook notifications
  - Frame inspection
  - Fine-tuning support
  - Role-based access control

---

## Support

For issues or questions about the API, please contact the development team or submit an issue on the project repository.
