# 📖 Outdoor Chain Snatching & Violent Theft Analytics API & Algorithm Specification

> **Module Location:** `backend/app/alerts/chain_snatching.py`  
> **API Location:** `backend/app/api/alerts.py`  
> **Configuration Persistence:** `backend/data/chain_snatching_config.json`

---

## 1. Executive Summary & Design Philosophy

### The Single-Frame YOLO Fallacy
Fine-tuning single-frame 2D object detectors (e.g. YOLO) to classify concepts like `theft`, `thief`, or `victim` is fundamentally flawed in real-world surveillance:
1. **Temporal Context Gap ($\Delta t = 0$):** Theft is a temporal sequence ($P_{\text{approach}} \rightarrow P_{\text{contact}} \rightarrow P_{\text{escape}}$), not a static visual object. In a single RGB frame, a person reaching for another person looks 100% mathematically identical whether it is a hand-shake or a chain snatch.
2. **Semantic Overfitting:** Classifying bounding boxes as "thief" forces neural networks to overfit on static shortcuts (clothing color, skin tone, background noise) rather than physical motion trajectories.

### The 4 FPS Kinematic Macro-Anomaly Solution
TraceNet ingests/samples CCTV footage at **4 FPS ($\Delta t = 250\text{ ms}$ per frame)**. At 4 FPS, micro-gestures (e.g., wrist-to-neck contact lasting 0.3s) are subject to severe motion blur and missing frames. 

Instead of unviable micro-gestures, **ChainSnatchingAnalyzer** tracks **Macro-Kinematic Anomalies**:
- **Vehicle-Pedestrian Proximity Spikes**
- **Victim Aspect Ratio Fall Events ($\frac{\text{Height}}{\text{Width}}$)**
- **Vector-Aligned Pursuit Acceleration**

---

## 2. Spatiotemporal State Machine Engine

The `ChainSnatchingAnalyzer` replays frame-by-frame tracker output (`detections.json`) and evaluates three deterministic rules:

```
[ 4 FPS Stream ] ──► [ByteTrack Trajectories] ──► [Rule A: Proximity Spike] ──► [Rule B: Fall OR Rule C: Chase] ──► [Alert SQLite]
```

### Rule A: High-Risk Proximity Spike Event (The Setup)
- **Condition:** The Euclidean distance between a vehicle centroid $P_{\text{vehicle}}$ and a person centroid $P_{\text{person}}$ drops below `proximity_threshold_px` (default: `120px` at 720p).
- **State Change:** Arms a **4-frame (1-second) observation window** for that specific $(\text{Vehicle\_ID}, \text{Person\_ID})$ pair. Proximity alone **NEVER** triggers an alert.

### Rule B: Victim Fall Anomaly (Kinematic Impact)
- **Aspect Ratio Transition:** The victim's bounding box aspect ratio $R = \frac{\text{Height}}{\text{Width}}$ rapidly drops from Vertical ($R > 1.1$) to Horizontal ($R < \text{fall\_aspect\_ratio\_trigger}$, default: `0.85`) within $\le \text{fall\_frame\_window}$ frames (default: `2 frames`).
- **Centroid Y-Drop:** Alternatively, the vertical centroid position $y_{\text{center}}$ drops downward by $> 35\%$ of bounding box height in $\le 2$ frames.
- **State Change:** Flags `FALL_DETECTED = True`.

### Rule C: Post-Impact Chase Vector (Pursuit Dynamics)
- **Velocity Spike:** Person velocity magnitude $|\vec{V}_{\text{person}}|$ spikes to $> \text{chase\_velocity\_multiplier} \times \text{baseline\_speed}$ (default: `3.0x`).
- **Vector Directional Alignment:** The person's displacement vector aligns with the vehicle's escape vector:
  $$\text{Cosine Similarity} = \frac{\vec{V}_{\text{person}} \cdot \vec{V}_{\text{vehicle}}}{\|\vec{V}_{\text{person}}\| \|\vec{V}_{\text{vehicle}}\|} > \text{chase\_vector\_cosine\_sim} \quad (\text{default: } 0.75)$$
- **State Change:** Flags `CHASE_DETECTED = True`.

### Final Alert Trigger Gate
$$\text{CHAIN\_SNATCHING\_ALERT} = \text{Proximity\_Event} \land (\text{FALL\_DETECTED} \lor \text{CHASE\_DETECTED})$$

---

## 3. API Endpoints Reference

### 3.1 Get Chain Snatching Configuration
- **HTTP Method:** `GET`
- **Endpoint:** `/api/v1/alerts/chain-snatching-config`
- **Response Code:** `200 OK`
- **Response Body:**
```json
{
  "proximity_threshold_px": 120,
  "fall_aspect_ratio_trigger": 0.85,
  "fall_frame_window": 2,
  "chase_velocity_multiplier": 3.0,
  "chase_vector_cosine_sim": 0.75,
  "observation_window_frames": 4
}
```

---

### 3.2 Update Chain Snatching Configuration
- **HTTP Method:** `PUT`
- **Endpoint:** `/api/v1/alerts/chain-snatching-config`
- **Request Body:** `ChainSnatchingAnalysisConfig`
- **Response Code:** `200 OK`
- **Description:** Updates analysis thresholds and persists changes to `backend/data/chain_snatching_config.json`.

---

### 3.3 Trigger Chain Snatching Analysis on All Eligible Videos
- **HTTP Method:** `POST`
- **Endpoint:** `/api/v1/alerts/trigger-chain-snatching-all`
- **Request Body (Optional):** Custom `ChainSnatchingAnalysisConfig`
- **Response Code:** `200 OK`
- **Response Body:**
```json
{
  "status": "started",
  "video_count": 3,
  "message": "Chain Snatching analysis started for 3 eligible videos."
}
```

---

### 3.4 Trigger Chain Snatching Analysis on Single Video
- **HTTP Method:** `POST`
- **Endpoint:** `/api/v1/alerts/trigger-chain-snatching/{video_id}`
- **Response Codes:**
  - `200 OK`: Analysis background task scheduled.
  - `400 Bad Request`: Video not fully processed (`processing_status != 'complete'`) or is in bin.
  - `404 Not Found`: Video ID does not exist.

---

### 3.5 Get Chain Snatching Analysis Execution Log
- **HTTP Method:** `GET`
- **Endpoint:** `/api/v1/alerts/chain-snatching-analysis-log`
- **Response Code:** `200 OK`
- **Response Body:**
```json
{
  "entries": [
    {
      "video_id": "vid_1784728337",
      "video_name": "street_footage.mp4",
      "camera_name": "CAM_003 (Main Street)",
      "status": "complete",
      "eligible": true,
      "skip_reason": null,
      "alerts_created": 1,
      "log_entries": [
        "[OK] Model contains Person and Vehicle tracking capabilities.",
        "[PROXIMITY_SPIKE] Person #4 & Vehicle #12 distance=84.2px at frame 14",
        "[VICTIM_FALL] Person #4 aspect ratio dropped from 1.34 to 0.62",
        "[CHAIN_SNATCHING_ALERT] TRIGGERED for Person #4 (Victim) & Vehicle #12 (Suspect)"
      ],
      "progress_percentage": 100
    }
  ]
}
```

---

## 4. Edge Cases & Mitigation Matrix

| Edge Case Scenario | Cause / Physics Problem | System Solution & Calibration |
|---|---|---|
| **Traffic Congestion / Pillion Riders** | Motorcycles naturally pass within 50px of pedestrians in busy streets. | Proximity **never** triggers an alert by itself. Proximity only arms a 1-second observation window. An alert strictly requires a post-proximity **Fall** or **Chase** verification. |
| **Tying Shoes / Bending Down** | Pedestrian bending down flips their aspect ratio ($R < 0.85$). | Bending down takes $1.5 - 3\text{ seconds}$ without a vehicle proximity spike. The state machine requires the flip to occur in $\le 2\text{ frames}$ immediately after a proximity event. |
| **ByteTrack Occlusion at 4 FPS** | Motorcycle passing in front of a person causes ByteTrack to lose or flip tracker IDs. | Implement a **Spatial Grace Buffer**: If a person ID is lost during proximity and a new person ID appears within $30\text{ px}$ with a horizontal aspect ratio within 2 frames, stitch the tracklets automatically. |
| **Overhead Bird's-Eye Cameras** | Overhead views do not display vertical-to-horizontal aspect ratio drops. | Combine Aspect Ratio with **Bounding Box Area Expansion ($\Delta \text{Area}$)**. On overhead views, a fallen body occupies a larger 2D area ($H \times W$). |

---

## 5. Database & Audit Schema

Created alerts are written to the `alerts` table in SQLite (`backend/data/drishti.db`):

- `alert_type`: `'chain_snatching'`
- `tracklet_id`: `{video_id}_trk_{person_trid}` (Victim Tracklet)
- `object_tracklet_id`: `{video_id}_trk_{vehicle_trid}` (Suspect Vehicle Tracklet)
- `owner_tracklet_ids`: `["{video_id}_trk_{person_trid}"]` (Victim)
- `visitor_tracklet_ids`: `["{video_id}_trk_{vehicle_trid}"]` (Suspect Vehicle)
- `analysis_log`: JSON string array capturing the exact telemetry telemetry (proximity distance, aspect ratio flip, velocity vector alignment).
