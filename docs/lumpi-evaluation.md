# LUMPI Benchmark Evaluation Suite for Multi-Camera Tracking

## 1. Overview & Context

TraceNet features a multi-camera journey reconstruction pipeline powered by:
- **`trajectory_engine.py`**: Directed Acyclic Graph (DAG) longest-path Dynamic Programming.
- **`camera_graph.py`**: Spatial-temporal feasibility, Haversine physical distance, and delay probability scoring.
- **`multicam.py`**: FastAPI routing for target pursuit, route building, and this benchmark.
- **`MultiCameraTracking.tsx`**: Interactive Leaflet journey map, pursuit HUD, and the **LUMPI Benchmark** tab.

While visual embedding similarity and spatial speed limits form candidate journeys across CCTV cameras, candidate links in real-world surveillance can suffer from visual ambiguity (similar clothing or car models) and timing inaccuracies.

To benchmark the precision and recall of cross-camera journey links, TraceNet reads the **LUMPI dataset** ([GitHub: St3ff3nBusch/LUMPI-SDK-Python](https://github.com/St3ff3nBusch/LUMPI-SDK-Python), MIT). The parser is TraceNet's own (`backend/app/analytics/lumpi/adapter.py`); the `lumpi_sdk` Python package is **not** a runtime dependency.

> **Scope boundary.** LUMPI is used strictly as an **offline evaluation and tuning benchmark**. Its synchronized ground-truth object IDs do not exist on operational city CCTV feeds, and nothing here participates in natural-language search, ingestion, or alerting.

> **What this benchmark does and does not measure.** LUMPI labels are fused 3D tracks, not per-camera appearance crops, so the adapter synthesizes one identity embedding per object and perturbs it per sighting with a controllable noise level. The scores therefore measure TraceNet's **spatiotemporal feasibility and DAG linking logic**, not the CLIP re-identification model. Say this plainly in any demo.

---

## 2. Input Specification & Contract

- **License**: MIT.
- **Layout** (as shipped in the SDK's `test_data`, placed at `backend/data/evaluation/lumpi/test_data/`):
  ```
  meta.json                     # sessions: cameras (rvec, tvec, intrinsic, distortion, fps, experimentId) and lidars
  Measurement{N}/Label.csv      # fused 3D ground-truth tracks for experiment N
  Measurement{N}/cam/{dev}/video.mp4   # 3.2 s synchronized clips per camera (used only to read frame size)
  ```
- **Label.csv columns**: `time, object id, 2d x, y, w, h, score, class_id, visibility, 3D box center x, y, z, length, width, height, heading, ...`
- **Classes**: `0` pedestrian → TraceNet `person`; `1` car, `2` bicycle, `3` motorcycle, `4` bus, `5` truck, `6` van → TraceNet `vehicle`.
- **Calibration convention** (validated against the labels: 75–78 % of 3D label points project inside each camera's frame): `rvec`/`tvec` are OpenCV world→camera; the 4×4 `extrinsic` is camera→world, so its translation column is the camera's world position.

If no dataset is present the adapter generates a small **synthetic** 3-camera sample (`sample_sequence/`) so the endpoints still work. Its results must never be reported as LUMPI results; the API and UI label it `synthetic`.

---

## 3. Architecture & Components

```
LUMPI meta.json + Measurement{N}/Label.csv
                 │
                 ▼
     [LumpiAdapter (adapter.py)]
  • Selects only the camera sessions tagged with the requested experimentId
  • Reads each camera's frame size from its video (fallback: 2·principal point)
  • Attribution mode:
      projection      – projects every 3D label through rvec/tvec/intrinsic; a camera
                        "sees" the object when the point lands inside its image
      nearest-camera  – fallback when calibration is absent or <20 % of labels project
  • Splits per-camera sightings on >1 s gaps; keeps a sampled [t, x, y] ground track
  • Synthetic identity embeddings (seeded Generator, never reseeds global numpy)
    noise σ = noise-to-signal ratio → same-object cosine ≈ 1 / (1 + σ²)
  • Ground-truth journeys: consecutive sightings → transitions; a transition whose
    sightings overlap in time is a *handover* (transit time 0)
                 │
                 ▼
     [LumpiEvaluator (evaluator.py)]
  • Query = earliest sighting of each multi-camera object
  • Visual gate: cosine ≥ min_visual_similarity
  • DAG longest-path DP anchored at the query
      handover (gap ≤ 0.05 s): feasible if co-temporal ground distance ≤ handover_radius_m
      travel (gap > 0.05 s):   feasible if speed ≤ 1.5 · v_max(class)
      link score S = w_vis·S_vis + w_temp·P_temp + w_spat·S_spat
  • Link precision / recall / F1, identity switches, transit-time error,
    route continuity, per-class breakdown, visual separability profile,
    data-driven tuning findings, per-target audit trail
                 │
                 ▼
     REST (multicam.py)  ──►  LUMPI Benchmark tab (LumpiBenchmarkPanel.tsx)
```

All parsed sequences and reports live under `backend/data/evaluation/lumpi/` via `get_data_path()`.

---

## 4. API Endpoints

### 4.1 Status
```http
GET /api/v1/multicam/evaluation/lumpi/status
```
```json
{
  "status": "ready",
  "dataset_path": "…\\backend\\data\\evaluation\\lumpi\\test_data",
  "is_available": true,
  "dataset_kind": "lumpi",
  "experiments": [
    {"experiment_id": 1, "camera_sessions": ["3", "4", "5"], "camera_count": 3, "label_rows": 861, "has_video": true}
  ],
  "last_report_generated_at": "2026-10-08T04:40:55+00:00",
  "last_report_experiment_id": 1
}
```

### 4.2 Run
```http
POST /api/v1/multicam/evaluation/lumpi/run
Content-Type: application/json

{
  "dataset_path": null,
  "experiment_id": 1,
  "min_visual_similarity": 0.45,
  "visual_weight": 0.55,
  "temporal_weight": 0.25,
  "spatial_weight": 0.20,
  "embedding_noise_sigma": 0.05,
  "handover_radius_m": 15.0
}
```
Returns the full report (`metrics`, `class_breakdown`, `similarity_profile`, `camera_sessions`, `tuning_recommendations`, `audited_examples`, …). `404` when the Measurement folder is missing, `400` for invalid weights or gate.

### 4.3 Latest report
```http
GET /api/v1/multicam/evaluation/lumpi/report
```

### 4.4 Quick test without the UI
```powershell
cd D:\CODING\TraceNet\backend
..\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000
# second terminal
Invoke-RestMethod http://localhost:8000/api/v1/multicam/evaluation/lumpi/status
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"experiment_id":1}' http://localhost:8000/api/v1/multicam/evaluation/lumpi/run
```
Swagger: `http://localhost:8000/docs` → tag **Multi-Camera Analytics**.

---

## 5. Measured Performance (real LUMPI `test_data`, defaults: gate 0.45, σ 0.05, handover 15 m)

| Experiment | Cameras | Sightings | Multi-cam targets | GT links | Precision | Recall | F1 | IDSW |
|---|---|---|---|---|---|---|---|---|
| Measurement 0 | 3 | 59 | 20 | 38 | 1.000 | 1.000 | 1.000 | 0 |
| Measurement 1 | 3 | 125 | 42 | 82 | 1.000 | 0.976 | 0.988 | 0 |
| Measurement 4 | 3 | 235 | 75 | 117 | 1.000 | 0.974 | 0.987 | 0 |

Measurement 1 per class: person P 1.00 / R 1.00, vehicle P 1.00 / R 0.97 (2 of 58 links missed; both are a van whose handover jump exceeded 15 m).

Mean transit-time error is 0.0 s on this dataset because every LUMPI transition is a same-time handover between overlapping cameras; the metric only becomes informative on non-overlapping camera networks.

### Stress test (Measurement 1) — what the knobs prove

| σ (visual noise) | same-object cos | Gate | Impostors above gate | Precision | Recall | IDSW |
|---|---|---|---|---|---|---|
| 0.05 | 0.998 | 0.45 | 0 % | 1.000 | 0.976 | 0 |
| 1.30 | 0.368 | 0.45 | 0 % | 1.000 | 0.024 | 0 |
| 1.30 | 0.368 | 0.20 | 0 % | 1.000 | 0.976 | 0 |
| 2.00 | 0.197 | 0.10 | 67 % | 0.884 | 0.927 | 10 |
| 2.00 | 0.197 | 0.00 | 100 % | 0.155 | 0.842 | 376 |

Reading: when the visual gate is too strict for the noise level, recall collapses (row 2); lowering the gate restores it (row 3). With two thirds of sightings having a visual impostor above the gate (row 4) the spatiotemporal feasibility check still holds precision at 88 %. Removing the gate entirely (row 5) shows the feasibility check alone cannot carry identity at a single intersection where every object is a plausible handover.

### Historical note
Earlier versions of this document reported P 1.00 / R 0.80 / F1 0.889 "across 3 cameras, 4 targets". Those figures came from the **synthetic sample**, and the real-data runs at the time were distorted by three defects fixed on 2026-10-08: camera sessions of *all* experiments were loaded at once (21 cameras instead of 3, with labels attributed to cameras from other experiments), the embedding noise was mis-scaled so same-object similarity averaged 0.43 and half the true matches failed the 0.45 gate, and handover distance compared positions taken at different instants.

---

## 6. Fusion Replay — the video demo (`/multicam` → **Fusion Replay** tab)

The replay is the stage demo. It runs **TraceNet's own detector + ByteTrack** on the three synchronized LUMPI
clips of one experiment, back-projects every detection's foot point through the real calibration onto the
shared ground plane, and fuses per-camera tracks that occupy the same spot at the same time into one
identity. No dataset labels are used anywhere in it.

Pipeline (`backend/app/analytics/lumpi/replay.py`):
1. Per camera: YOLO (`data/models/vehicle_detector.pt` by default, 7 classes) → `ByteTrackWrapper` → for each box, ray through
   the bottom-centre pixel `K⁻¹[u,v,1]`, rotated by `Rᵀ`, intersected with the ground plane `z = median(label centre z − h/2)`.
2. Fusion: tracks from *different* cameras with the same object type, ≥ 3 shared frames and mean co-temporal
   ground distance ≤ 2 m (person) / 3.5 m (vehicle) are joined greedily by cost with a union-find; a group never
   holds two tracks from one camera.
3. Output under `backend/data/evaluation/lumpi/replay/exp{N}/`: `cam_{dev}.mp4` (clean H.264), `cam_{dev}_annotated.mp4`
   (boxes with fused IDs burnt in, for slides), `replay.json` (cameras, fused tracks with ground trails, per-frame boxes).

Endpoints:
```http
GET    /api/v1/multicam/replay/lumpi/status?experiment_id=1   # built? building? progress, experiments with video
POST   /api/v1/multicam/replay/lumpi/build                      # {experiment_id, model_id?, weights_path?, conf, imgsz, force}
GET    /api/v1/multicam/replay/lumpi/{experiment_id}            # replay.json
DELETE /api/v1/multicam/replay/lumpi/{experiment_id}
```
`build` returns `202` immediately and runs in a background thread registered as a System Job (visible in the header
status pill). A build takes ~40 s on this machine. Measured on Measurement 1: 8,385 detections → 123 per-camera
tracks → 70 fused identities, 37 of them seen by two or more cameras.

### Stage script (about 3 minutes)
1. Open **Multi-Camera Intelligence Suite → Fusion Replay** (deep link for the stage: `/multicam?tab=replay&autoplay=1`). Measurement 1 is pre-built; press **Play all** if it is not already running. Three
   views run in sync with boxes drawn live from the JSON; the ground-plane map on the right shows every object's
   trail and the three camera positions.
2. Say what the colours mean: same colour and `#id` in every view is one physical object, decided only by where the
   detector put it on the calibrated ground plane. The white ring on the map marks objects currently seen by 2+ cameras.
3. Click the white bus (or any cyclist) in one camera. It lights up in all three views and on the map; everything else
   dims. The side card lists the per-camera local track IDs that were fused and the fusion rule that joined them.
4. Pause, use ‹ › to step frames, and show that the boxes and the map stay in lock-step.
5. If asked "is this real?": switch the experiment selector to a measurement that is not built yet and press
   **Build replay**. The progress bar runs through detection on each camera, fusion, and rendering, and the header
   status pill shows the job. It finishes in under a minute.
6. Close on the guard-rail text in the panel: fusion asserts co-location on a calibrated plane; it never asserts an
   identity on operational footage, and an officer still reviews every match.

The **LUMPI Benchmark** tab (section 7) stays available for a technical audience but is not part of the stage demo.

---

## 7. Benchmark Tab Script (LUMPI Benchmark tab on `/multicam`)

1. Open **Multi-Camera Intelligence Suite → LUMPI Benchmark**. The badge reads *REAL LUMPI CALIBRATED DATA*; the status line shows the dataset path under `backend/data`.
2. Run Measurement 1 with defaults → precision 100 %, recall 97.6 %, 0 identity switches. Open the audit table with *Issues only* to show the single missed van and explain the 15 m handover radius.
3. Set **Visual noise σ = 1.3**, run → recall drops to 2 %. Point at the *Visual separability* box (same-object similarity 0.37 is below the 0.45 gate).
4. Lower **Similarity gate** to 0.20, run → recall back to 97.6 %, still zero switches. This is the tuning loop a deployment team would run.
5. Set **σ = 2.0, gate = 0.10**, run → 67 % of sightings now have an impostor above the gate, yet precision stays 88 % and only 10 switches appear. The audit table marks each wrong hop in red with the impostor's object ID.
6. Close with the honesty statement in the panel header: this scores spatiotemporal linking on a benchmark; it never asserts an identity on operational footage, and human review stays mandatory.

Optional: the `video.mp4` clips in `Measurement1/cam/{8,9,10}` can be ingested as three cameras in one Area to show real LUMPI footage inside TraceNet, but they are only 3.2 s long, so cross-camera journeys there will be thin.

---

## 8. Known Limitations

- Visual embeddings are synthetic; CLIP re-identification quality is not measured here.
- LUMPI cameras share one mast over one intersection, so the benchmark exercises overlapping-FOV handovers, not long-range travel-time reasoning.
- Radial distortion is ignored when projecting (k₁ ≈ 0.01–0.02 changes in-frame coverage by < 0.2 %).
- The evaluator mirrors the production `TrajectoryEngine` scoring rather than calling it, because the production engine is bound to the SQLite/Qdrant tracklet stores.
