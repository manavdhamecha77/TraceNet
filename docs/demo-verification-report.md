# TraceNet: Pre-Presentation Verification Report

> **Status update (2026-10-09):** this is a snapshot of the 2026-10-08 checks. Fixed since then: uploads
> (model paths from other machines + S3-primary media store), the `torchaudio` startup crash, the vehicle
> filter, the Journey Map, the Copilot off-topic guard and broken read tools, API-key exposure in
> `/assistant/config` and `/search/multilingual/config`, and the MediaMTX status check.
> See `AGENTS.md` tasks 5.10–5.15 for details. Still open: missing model weights, the 23 videos without
> sightings, the golden S3 push, and Copilot write tools running without confirmation.

> **Date:** 2026-10-08  **Branch:** `main` @ `aa80435`  **Machine:** Windows 11, RTX 4060 (PyTorch is CPU-only)
>
> **Method:** 143 backend tests, a real 15-second CCTV clip through the full ingest pipeline, and about 40 live API calls against a running backend.
> All test data was removed afterwards and the database and vector index were restored from a backup, so the demo data is unchanged.

---

## 🔁 Re-check after pulling `03becbe` (3 new commits)

The pull added multilingual search (Hindi / Gujarati / Hinglish), a plate-OCR fallback fix, an i18n UI (EN / HI / GU), a filters modal and Areas fixes.
**None of the earlier backend issues were addressed:** the code for upload, the trajectory engine, the assistant, streaming and the vehicle filter is unchanged.

### 🆕 New regression

| Issue | Severity | Detail |
|---|:-:|---|
| **Backend won't start** | 🔴 | `plate_ocr.py` now does `import torchaudio` and catches only `OSError`. Without torchaudio (it's not in `requirements.txt`) every import of `app.main` crashes. **Fixed locally (uncommitted)** with `except (OSError, ImportError)`. This fix must be committed |

### Status of the earlier findings

| Earlier finding | Now | Note |
|---|:-:|---|
| New uploads fail (model path on `D:\`) | ❌ Still broken | DB still points to `D:\Aayush\...` |
| 23 videos with no sightings / CAM_002–003 empty | ❌ Still broken | Data unchanged |
| Missing face / plate / accident / theft / assault weights | ❌ Still missing | Only the vehicle model is present |
| BLIP generic captions | ❌ Still present | Needs `HF_HUB_OFFLINE=1` |
| No colour attributes on existing data | ❌ Still present | Backfill not run |
| "Vehicle" filter leaves out HCV / LCV / Three-wheeler | ❌ Still broken | 50 results → only Bus + Car |
| Empty query accepted by backend | ❌ Still present | |
| Journey Map misleading | ❌ Still broken | CAM_004 start → 23 steps all in CAM_001, starting sighting not included |
| Copilot doesn't refuse off-topic requests | ❌ Unchanged code | Only the UI changed; not re-run |
| `/assistant/config` exposes API key | ❌ Still present | |
| `mediamtx-status` false negative | ❌ Still present | |
| Plate-OCR switch test failing | ✅ **Fixed** | Upstream added `force=True` on revert |
| Frontend build | ✅ Passes | Builds with the new i18n packages |
| Backend tests | ✅ 134 pass | The only failure needs a live server |

### Multilingual search (new feature)

| Query | Normalised to | Result |
|---|---|:-:|
| `laal gaadi` | red car | ✅ 10/10 Car |
| `safed gaadi` | white car | ✅ 10/10 Car |
| `kaala maanas` | black man | ✅ 10/10 Pedestrian |
| `सफेद कार` | white car | ✅ 10/10 Car |
| `लाल गाड़ी` | red **गाड़ी** | ⚠️ Mostly pedestrians: Devanagari "गाड़ी" isn't translated |
| `લાલ ગાડી` | red **ગાડી** | ⚠️ Mostly pedestrians: Gujarati "ગાડી" isn't translated |
| `peeli riksha` | **peeli** rickshaw | ⚠️ "peeli" is missing from the search dictionary (it exists in the colour list) |
| `pass the bus` | **near** the bus | ⚠️ The English word "pass" gets rewritten |
| Audit log | original + `[normalized: …]` | ✅ Both are recorded |

> Also note: `POST /search/multilingual/config` accepts an OpenRouter API key with no authentication.

---

## At a glance

| | Count | Meaning |
|:-:|:-:|---|
| ✅ | **10** | Works end-to-end and was verified live |
| ⚠️ | **6** | Works only partly, or the result is misleading |
| ❌ | **4** | Fails, or can't run on this machine |

**Bottom line:** search, photo search, playback, export and reports are ready to demo.
**Uploading a new video fails on this machine right now**, and about half the alert and recognition features can't run because their model files are missing.

---

## Feature results

### 🔍 Search & investigation

| Feature | Status | Finding |
|---|:-:|---|
| Natural-language search | ✅ | "a bus" → 15/15 Bus · "white car" → 15/15 Car · "truck carrying goods" → 15/15 HCV · "auto rickshaw" → Three-wheeler first. About **0.2 s** per query once warm |
| Explanations ("Why this matched") | ✅ | Each result shows visual similarity, detector confidence, attribute checks, applied filters and a note that a human must review |
| Camera / time / single-video filters | ✅ | All filter correctly |
| Person / vehicle filter | ⚠️ | **"Vehicle" leaves out 230 trucks and autos.** They are stored with type `HCV` / `LCV` / `Three-wheeler` instead of `vehicle` |
| Colour attribute filter | ✅ | Works on newly uploaded videos. Existing demo data has **no colour attributes** (it needs the backfill run) |
| Photo search (reverse image) | ✅ | Searching with a crop returns that same sighting as #1 (score 1.000) |
| Clip playback / stream | ✅ | Thumbnail images, `/videos/{id}/stream` and `/clip/{id}` all return correctly |
| Search audit log | ✅ | Every query is recorded in `search_logs` |
| Empty-query handling | ⚠️ | The backend accepts an empty query and returns results; only the frontend blocks it |

### 📥 Ingestion pipeline

| Stage | Status | Finding |
|---|:-:|---|
| Upload + SHA-256 + duplicate guard | ✅ | Upload accepted, hash recorded |
| FFmpeg conversion to 720p/10 FPS | ✅ | Uses the bundled `imageio_ffmpeg` (no system ffmpeg needed) |
| **Person/vehicle detection** | ❌ | **Crashes.** The model's DB record points to `D:\Aayush\Projects\...\e8f39b53….pt`, which doesn't exist here. The fallback `data/models/vehicle_detector.pt` doesn't exist either |
| Detection with the path corrected | ✅ | 15 s clip → **138 sightings** in about 45 s (CPU), embedded and indexed, and searchable straight away |
| BLIP captions | ⚠️ | Every caption falls back to *"a person captured on CCTV feed"*. The model is **already downloaded** but fails on an SSL error. It works with `HF_HUB_OFFLINE=1` |
| Plate pass | ❌ | `license_plate_detector.pt` missing → all 17 vehicles marked `not_detected` |
| Face pass | ❌ | `face_detection/yolov8n-face-lindevs.pt` missing (skipped, ingest continues) |
| Accident pass | ❌ | `accident_detection/yolo11x_epoch61.pt` missing (skipped, ingest continues) |

### 🚨 Alerts & threat detection

| Feature | Status | Finding |
|---|:-:|---|
| Loitering (zone + dwell time) | ✅ | Zone saved after preview → alerts created → acknowledgement stamps the operator |
| Alert list / detail / acknowledge | ✅ | All endpoints respond correctly |
| Chain-snatching / theft | ⚠️ | The analyser runs (150 frames) but finds 0 alerts because no theft model is assigned |
| Abandoned object | ⚠️ | Skips correctly: *"Model has no abandonment-eligible classes"* |
| Assault | ❌ | VideoMAE model not loaded or cached; needs a download |
| Plate watchlist / accidents | ❌ | Blocked by the missing weights above |

### 🗺️ Multi-camera tracking

| Feature | Status | Finding |
|---|:-:|---|
| Hot-target tagging & registry | ✅ | Tag → list → status all work |
| Sentinel Wave activation | ✅ | Session created with downstream cameras |
| Camera neighbour graph | ✅ | Works. CAM_010 (`Testing`) has no coordinates and shows up as a 500 m neighbour |
| **Journey Map reconstruction** | ⚠️ | **Results are misleading.** It chains 20–46 lookalike sightings, mostly from one camera. A route started from a CAM_004 person returned 22 steps that were *all in CAM_001* and didn't include the starting sighting |

### 📦 Evidence & reporting

| Feature | Status | Finding |
|---|:-:|---|
| Forensic export bundle | ✅ | 7.8 MB zip with clips, annotated frames and a manifest |
| Export integrity check | ✅ | `VERIFIED`: 10 files checked, 0 mismatches |
| Export with face blur | ⚠️ | Refuses to export (no face model). This is deliberate, but the UI option will show an error |
| PDF crime report | ✅ | Valid `%PDF` generated and downloadable |
| Report statistics / compliance / audit | ✅ | All respond, including your local route-order fix in `reports.py` |
| Dashboard metrics / job queue | ✅ | Live counts and finished jobs listed |

### 🤖 AI Copilot

| Check | Status | Finding |
|---|:-:|---|
| Ollama (default provider) | ⚠️ | Not running by default. `qwen2.5:3b` **is already downloaded**; once started manually it works |
| Uses live data | ✅ | "Find a white car" → a real CAM_004 sighting · "Unacknowledged alerts" → the real alert list |
| Refuses off-topic requests | ❌ | **Wrote a poem about cats.** The documented refusal behaviour isn't working |
| Accuracy | ⚠️ | Misquoted one alert's year (2022 instead of 2026); small-model hallucination |
| Groq fallback | ❌ | SSL certificate error from Python on this machine |

### 📡 Live streaming

| Check | Status | Finding |
|---|:-:|---|
| MediaMTX auto-start | ✅ | Running, listening on 8554 / 8889 / 8888 / 1935 |
| Pair-code generation | ✅ | e.g. `904-581` with a 10-minute expiry |
| `mediamtx-status` endpoint | ⚠️ | Always reports `running: false`. It checks admin port 9997, which is disabled in the config. Cosmetic, since the frontend doesn't use it |
| End-to-end camera stream | — | Not tested (needs a browser camera) |

### 🧪 Build & tests

| Check | Status | Finding |
|---|:-:|---|
| Frontend `npm run build` | ✅ | 0 errors (the old `CheckCircle2` blocker is gone). The bundle is 2 MB, so a size warning is printed |
| Backend `pytest` | ✅ | **133 passed**, 2 failed, 8 skipped. All 10 non-passing tests are caused by this machine's setup (PaddleOCR / fast-plate-ocr missing, one test needs a running server) |
| UI click-through in a browser | — | Not done |

---

## 📊 Demo data health

| Item | Value | Note |
|---|---|---|
| Cameras | 6 | CAM_001–004, CAM_009, CAM_010 (test) |
| Videos marked `complete` | 32 | **23 have 0 sightings** |
| Searchable cameras | CAM_001 · CAM_004 · CAM_009 | **CAM_002 and CAM_003 return nothing** |
| Sightings (tracklets) | 2,432 | 2,110 pedestrians, 322 vehicles |
| With BLIP caption | 547 (22%) | |
| With colour attributes | 0 | Run `POST /api/v1/attributes/backfill` |
| Faces / plates / exports | 0 / 0 / 0 | The new features have no data yet |
| Alerts | 4 | Demo seed data, one of each type |

---

## 🛠️ Fix before the presentation

| # | Priority | Action | Effort |
|:-:|:-:|---|:-:|
| 0 | 🔴 | **Commit the `torchaudio` import fix in `plate_ocr.py`**, or the backend won't start at all | 1 min |
| 1 | 🔴 | Point the `models` row at `S:\TraceNet\backend\data\models\e8f39b53-8bf8-46f0-a67d-42ff77c9356b.pt`, or else **every live upload fails** | 1 min |
| 2 | 🔴 | Re-process the 23 empty videos, **or** limit the demo to CAM_001 / CAM_004 / CAM_009 | 10–30 min |
| 3 | 🔴 | Download the theft / abandoned / assault / face / plate / accident weights (README Drive links), **or** leave those features out of the live demo | 15 min |
| 4 | 🟠 | Start the backend with `HF_HUB_OFFLINE=1` for real BLIP captions | 1 min |
| 5 | 🟠 | Run the colour attribute backfill so colour search works on existing data | 5 min |
| 6 | 🟠 | Fix the "vehicle" filter so it includes HCV / LCV / Three-wheeler | 10 min |
| 7 | 🟠 | Start Ollama before the demo; avoid off-topic copilot prompts or add a refusal check | 5 min |
| 8 | 🟡 | Use a **rehearsed** Journey Map example, not a live pick | — |
| 9 | 🟡 | `GET /api/v1/assistant/config` returns the Groq API key unauthenticated. **Rotate the key after the event** | — |

---

## 🎤 Safe demo script

1. **Search:** "a bus", "white car", "truck carrying goods", "woman in a saree" (CAM_001 / CAM_004 / CAM_009)
2. **Explainability:** expand "Why this matched" on the first result
3. **Photo search:** drag in a crop of a bus → exact match at #1
4. **Playback:** "Seek & Stream" on a result
5. **Tag hot target** → activate **Sentinel Wave**
6. **Export:** select results → forensic bundle → **Evidence Vault** shows `VERIFIED`
7. **Alerts:** loitering review → acknowledge → generate PDF report
8. **Copilot** (with Ollama running): "Find a white car seen on the cameras"

> Avoid live: uploading a new video (until fix #1), face search, plate search, theft / assault / accident alerts (until fix #3), and an unrehearsed Journey Map.
