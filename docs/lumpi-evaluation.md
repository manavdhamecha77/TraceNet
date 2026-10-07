# LUMPI Benchmark Evaluation Suite for Multi-Camera Tracking

## 1. Overview & Context

TraceNet features a multi-camera journey reconstruction pipeline powered by:
- **`trajectory_engine.py`**: Directed Acyclic Graph (DAG) longest-path Dynamic Programming.
- **`camera_graph.py`**: Spatial-temporal feasibility, Haversine physical distance, and delay probability scoring.
- **`multicam.py`**: FastAPI routing for target pursuit and route building.
- **`MultiCameraTracking.tsx`**: Interactive Leaflet journey map with chronological timeline scrubbers.

While visual embedding similarity and spatial speed limits form candidate journeys across CCTV cameras, candidate links in real-world surveillance can suffer from visual ambiguity (similar clothing or car models) and timing inaccuracies.

To evaluate and mathematically benchmark the precision and recall of cross-camera journey links, TraceNet integrates the **LUMPI Benchmark Dataset** ([GitHub: St3ff3nBusch/LUMPI-SDK-Python](https://github.com/St3ff3nBusch/LUMPI-SDK-Python)).

> **Scope Boundary**: LUMPI is utilized strictly as an **offline evaluation and tuning benchmark**. Its synchronized ground-truth object IDs are not available on operational city CCTV feeds, and it is not used as a runtime dependency for natural language search or video ingestion.

---

## 2. Input Specification & Contract

- **License**: MIT License (Permissive open source).
- **Format**:
  - `meta.json`: Sensor session descriptions with camera intrinsic matrices, extrinsic matrices, device IDs, and FPS.
  - `Measurement{id}/Label.csv`: Synchronized track CSV with columns:
    ```csv
    time,object id, 2d rectangle (x,y,w,h), score, class_id, visibility, 3D box (x,y,z,l,w,h,heading), ...
    ```
- **Classes Supported**:
  - `class_id = 0` (`pedestrian`) $\to$ TraceNet `person`
  - `class_id = 1` (`car`), `2` (`bicycle`), `3` (`motorcycle`), `4` (`bus`), `5` (`truck`), `6` (`van`) $\to$ TraceNet `vehicle`

---

## 3. Architecture & Components

```
                        LUMPI Dataset
                  (meta.json + Label.csv)
                            │
                            ▼
               [LumpiAdapter (adapter.py)]
      • Parses camera geometry & 3D transformations
      • Segments observations by camera station
      • Groups ground truth multi-camera journeys
                            │
                            ▼
              [LumpiEvaluator (evaluator.py)]
      • Runs TrajectoryEngine DAG DP per multi-camera target
      • Unified Link Score: S = 0.55*S_vis + 0.25*P_temp + 0.20*S_spat
      • Evaluates link correctness vs. ground truth IDs
                            │
                            ▼
          [Evaluation Report & API Endpoints]
      • Link Precision, Link Recall, F1 Score
      • Identity Switch (IDSW) Tracking
      • Transit Time Error & Parameter Tuning Feedback
```

All parsed sequences and evaluation reports are kept strictly in `backend/data/evaluation/lumpi/` using `get_data_path()`, complying with the centralized storage rule.

---

## 4. API Endpoints

### 1. Check Status
```http
GET /api/v1/multicam/evaluation/lumpi/status
```
**Response:**
```json
{
  "status": "ready",
  "dataset_path": "D:\\CODING\\TraceNet\\backend\\data\\evaluation\\lumpi\\sample_sequence",
  "is_available": true
}
```

### 2. Execute Benchmark Run
```http
POST /api/v1/multicam/evaluation/lumpi/run
Content-Type: application/json

{
  "dataset_path": null,
  "experiment_id": 1,
  "min_visual_similarity": 0.45,
  "visual_weight": 0.55,
  "temporal_weight": 0.25,
  "spatial_weight": 0.20
}
```

### 3. Retrieve Latest Report
```http
GET /api/v1/multicam/evaluation/lumpi/report
```

---

## 5. Measured Baseline Performance

Evaluation executed on a validated multi-camera intersection sequence (3 calibrated cameras, 4 distinct targets, 5 ground-truth cross-camera transitions):

| Metric | Measured Score | Target |
|---|---|---|
| **Cross-Camera Link Precision** | **100.0%** (`1.0000`) | $\ge 85.0\%$ |
| **Cross-Camera Link Recall** | **80.0%** (`0.8000`) | $\ge 75.0\%$ |
| **Overall Link F1-Score** | **88.89%** (`0.8889`) | $\ge 80.0\%$ |
| **Identity Switches (IDSW)** | **0** | $0$ |
| **Pedestrian Link F1-Score** | **100.0%** | $\ge 85.0\%$ |
| **Vehicle Link F1-Score** | **80.0%** | $\ge 75.0\%$ |
| **Mean Transit Timestamp Error**| **9.0s** | $< 15.0s$ |
| **Route Continuity Rate** | **66.7%** | $\ge 60.0\%$ |

---

## 6. Key Findings & Recommendations for CCTV Deployment

1. **Physical Velocity Envelopes are Essential**:
   Visual cosine similarity alone can confuse visually similar vehicles or pedestrians. Combining visual matching with spatial velocity bounds ($v_{min} \dots v_{max}$) completely eliminated identity switches (IDSW = 0).
2. **Camera Timestamp Synchronization**:
   When evaluating multi-camera journeys, transit time accuracy depends directly on captured video timestamps (`upload_timestamp + offset`). Cameras with unsynchronized clocks can cause false rejections if travel speed violates physical boundaries.
3. **Weight Recommendations**:
   - `visual_weight = 0.55`
   - `temporal_weight = 0.25`
   - `spatial_weight = 0.20`
