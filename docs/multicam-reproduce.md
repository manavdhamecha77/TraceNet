# Reproducing the Multi-Camera Fusion Replay (step by step)

This guide takes a fresh clone to the on-stage demo: three synchronized LUMPI intersection cameras,
TraceNet's own detector and tracker drawn live on each feed, and cross-camera identities fused on a
calibrated ground plane. Nothing in the replay uses dataset labels.

Time budget: ~10 minutes the first time (model downloads excluded), ~2 minutes afterwards.

---

## 0. What you need

| Item | Where | Notes |
|---|---|---|
| Python 3.10 venv with backend deps | repo root `.venv` | `pip install -r backend/requirements.txt` |
| Node 18+ | for the Vite frontend | `cd frontend && npm install` |
| ffmpeg | on `PATH` or via `imageio-ffmpeg` | the builder transcodes to H.264 for browsers |
| Detector weights | `backend/data/models/vehicle_detector.pt` (7 classes incl. Pedestrian) | any registered `.pt` under `backend/data/models/` works; see §3 |
| LUMPI test data | `backend/data/evaluation/lumpi/test_data/` | folder layout below |

LUMPI test data layout (copy it from the SDK repo's `test_data`, MIT licence:
<https://github.com/St3ff3nBusch/LUMPI-SDK-Python>):

```
backend/data/evaluation/lumpi/test_data/
├── meta.json                       # camera calibration (rvec, tvec, intrinsic, experimentId) + lidar sessions
└── Measurement{0..6}/
    ├── Label.csv                   # fused 3D ground-truth tracks (used only by the Benchmark tab, not the replay)
    └── cam/{deviceId}/video.mp4    # 3.2 s synchronized clip per camera
```

Everything the pipeline writes stays under `backend/data/` (project rule); nothing goes to the repo root.

---

## 1. Start the backend

```powershell
cd D:\CODING\TraceNet\backend
..\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Wait for `Uvicorn running on http://0.0.0.0:8000`. Startup runs the schema migrations automatically.
Sanity check from a second terminal:

```powershell
Invoke-RestMethod "http://localhost:8000/api/v1/multicam/replay/lumpi/status?experiment_id=1"
```

You should see `"experiments"` listing Measurements 0–6 with `has_video: true`. If `built` is `false`, continue with §2.

## 2. Build a replay (one per experiment, ~40–120 s each)

Either press **Build replay** in the UI (§4) or call the API:

```powershell
Invoke-RestMethod -Method Post -ContentType 'application/json' `
  -Body '{"experiment_id": 1}' `
  http://localhost:8000/api/v1/multicam/replay/lumpi/build
```

It returns `202 {"status":"started","job_id":...}` and runs in the background (visible as a System Job in the
header status pill). Poll until `building` is `false`:

```powershell
Invoke-RestMethod "http://localhost:8000/api/v1/multicam/replay/lumpi/status?experiment_id=1"
```

What the build does, per camera of that experiment (`backend/app/analytics/lumpi/replay.py`):

1. YOLO inference on every frame (`conf 0.3`, `imgsz 1280`) → `ByteTrackWrapper` for per-camera track IDs.
2. Each box's bottom-centre pixel is back-projected through the camera's `rvec`/`tvec`/`intrinsic` onto the
   ground plane `z = median(label centre z − height/2)` (≈ −2.1 m here). Points farther than 120 m from the
   camera are discarded (roof/sky false positives).
3. Tracks from different cameras with the same object type, ≥ 3 shared frames and a mean co-temporal
   ground distance ≤ 2 m (person) / 3.5 m (vehicle) are fused into one identity (union-find, never two tracks
   from the same camera in one identity).
4. Outputs in `backend/data/evaluation/lumpi/replay/exp{N}/`:
   `cam_{dev}.mp4` (clean H.264), `cam_{dev}_annotated.mp4` (IDs burnt in, for slides), `replay.json`.

Expected numbers for Measurement 1 with the default weights: ~8.4 k detections → ~120 per-camera tracks →
~67 fused identities, ~37 of them seen by two or more cameras.

Options on the build body: `model_id` (a registered model from `/models`), `weights_path` (any `.pt` under
`backend/data`), `conf`, `imgsz`, `force: true` to rebuild an existing experiment.

## 3. Start the frontend

```powershell
cd D:\CODING\TraceNet\frontend
npm run dev
```

Open <http://localhost:5173>. The frontend reads `API_BASE` from `src/config/api.ts` (defaults to port 8000).

## 4. Drive the demo

Direct link that opens the tab and starts playback: **<http://localhost:5173/multicam?tab=replay&autoplay=1>**

Add `&follow=<id>` to open with an identity already selected (e.g. `&follow=3` is the white bus in Measurement 1), handy for a slide or a rehearsed opening shot.

Manual path: sidebar **Multi-Cam Intelligence** → tab **Fusion Replay**.

1. Pick the experiment (Measurement 1 recommended) and press **Play all**. Three views run in sync; boxes are drawn
   live from the JSON; the right-hand map shows every object's ground trail and the three camera positions.
2. Explain the colours: same colour and `#id` in every view = one physical object, decided only by where the detector
   put it on the calibrated ground plane. White ring on the map = currently seen by 2+ cameras.
3. Click the white bus or a cyclist in any view. It lights up in all three cameras and on the map; everything else
   dims. The card on the right lists the per-camera local tracks that were fused and the rule that joined them.
4. Pause and use ‹ › to step single frames; boxes and map stay in lock-step. `0.25×` / `0.5×` slow playback.
5. To prove it is live, switch to an unbuilt measurement and press **Build replay**; the progress bar walks through
   detection on each camera, fusion, and rendering, and finishes in about a minute.
6. Close on the guard-rail text in the panel: fusion asserts co-location on a calibrated plane, never identity on
   operational footage; an officer reviews every match.

## 5. Verify without a browser (optional)

```powershell
cd D:\CODING\TraceNet\backend
..\.venv\Scripts\python.exe -c "from app.analytics.lumpi.replay import LumpiReplayBuilder as B; r=B(experiment_id=1).build(); print(r['stats'])"
```

This builds the replay in-process and prints the detection / track / fusion counts.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `status` says `"experiments": []` | test data not under `backend/data/evaluation/lumpi/test_data/` or `meta.json` missing |
| Build `404 LUMPI Label file not found` | that Measurement folder has no `Label.csv` (needed for the ground-plane height) |
| Build `409 already running` | wait for the previous build; status endpoint shows progress |
| Build `400 weights_path must point inside backend/data` | copy the `.pt` into `backend/data/models/` and reference it from there |
| Videos do not play in the browser | ffmpeg missing on the backend → clean clips were not transcoded; install ffmpeg or `pip install imageio-ffmpeg` |
| Boxes drift from the video | the overlay maps through the letterboxed content box; if it ever drifts, press `‹`/`›` once to resync |
| Everything in one map corner | one far false positive dominated the bounds; rebuild with `force: true` (the 120 m range filter removes it) |

## 7. Related

- `docs/lumpi-evaluation.md` — the offline Benchmark tab (precision/recall against LUMPI ground truth), kept for technical audiences.
- `backend/app/api/multicam.py` — all `/api/v1/multicam/...` routes: trajectory, hot targets, pursuit wave, benchmark, replay.
