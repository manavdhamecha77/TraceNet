# Number Plates: Pipeline, Search & Switchable OCR

## 1. Where plates are read (core pipeline)

```
upload → transcode → [4] vehicle detection + tracking
                     [4b] VEHICLE PLATE PASS   ← app/detection/vehicle_plates.py
                     [5] embeddings + indexing → [6] faces → [7] accidents
```

The plate pass runs right after vehicle detection/tracking and before faces. It covers every tracklet of
the core detector's vehicle classes: **Car, Bus, HCV, LCV, Two-wheeler, Three-wheeler** (people are skipped).
For each vehicle it

1. picks up to 5 well-spaced frames where the vehicle is large and confident,
2. runs the plate detector inside the (padded) vehicle box of each frame and reads each plate with the active OCR engine,
3. keeps the reading with the highest summed confidence (the same text seen in several frames outvotes one lucky read),
4. stores **one row per vehicle** in `license_plate_detections`, plus the plate cutout under
   `backend/data/processed/plates/<video_id>/`.

| `plate_status` | Meaning | Shown to the operator as |
|---|---|---|
| `read` | text recognised | the text, exactly as OCR produced it |
| `blurry` | a plate was found but is unreadable (OCR confidence < 0.5 or < 3 characters) | **Blurry number plate** + the cutout |
| `not_detected` | no plate in any sampled frame | **No number plate detected** |
| *(no row yet)* | footage processed before this feature | *Number plate not scanned yet* |

No format rules or parsing are applied to the text (only upper-casing and removing non-alphanumerics);
small OCR mistakes are expected and handled by edit-distance search. Rows are keyed `plate:<tracklet_id>`, so
re-running is idempotent. A plate matching an active watchlist entry raises one `anpr_watchlist` alert per vehicle.

Failures in this step never abort ingestion (logged, rolled back).

## 2. Plates in search results

`QueryEngine` attaches a `plate` object to every vehicle result (`null` for people), so it appears in all of:
global **Search**, the per-video (**local**) search and grid on the video page, and the **AI Copilot / Ctrl+K** result cards.
`GET /api/v1/videos/{video_id}/plates` returns `{tracklet_id: plate}` for a whole video.

## 3. Vehicle Plate Search page (`/plates`)

Search by the **recognised text** (plate-image matching is intentionally not the primary path).

| Option | Behaviour |
|---|---|
| **Exact** | whole plate equals the query (case, spaces, punctuation ignored) |
| **Estimate** | plates within edit distance 1, 2, 3 (Levenshtein) of the query too; results grouped by distance, differing characters highlighted |
| **Match anywhere in plate** | query may appear inside the plate (`1234` finds `GJ05AB1234`); with Estimate it is an approximate-substring match |

Results update as you type (250 ms debounce) and show the vehicle crop, the plate cutout, text, OCR confidence, camera, time
and *Seek & Stream*. Two extra tabs list **Unreadable plates** and **No plate found** so a person can inspect cutouts that text search cannot cover.
Deep links: `/plates?q=GJ05AB1234&mode=exact&partial=1&tab=blurry`.

API: `GET /api/v1/anpr/search?q=&mode=exact|estimate&max_distance=1..3&partial=&camera_id=&video_id=`,
`GET /api/v1/anpr/vehicles?plate_status=read|blurry|not_detected`.

## 4. Switchable OCR engine

| Engine | Notes |
|---|---|
| `paddleocr` (default) | PaddleOCR PP-OCRv5; most accurate, reads two-row plates; ~0.4 s/plate on CPU |
| `fast-plate-ocr` | lightweight ONNX model; ~0.03 s/plate; less accurate |

The active engine is a **process-wide global**, persisted in `backend/data/anpr_config.json`, switched from the frontend
(Plate Search page and the ANPR page) via `POST /api/v1/anpr/ocr/switch {"engine": "..."}`; `GET /api/v1/anpr/ocr/config` lists engines.
The switch loads the engine immediately (and reverts if loading fails). It affects plates read **from then on**; click
*Re-read all vehicles* (or `POST /api/v1/anpr/backfill?force=true`) to re-read existing footage.

## 5. Existing footage (backfill)

`POST /api/v1/anpr/backfill[?force=true&video_id=...]` starts a background job reading plates for already-processed videos;
`GET /api/v1/anpr/backfill/status` reports progress. The UI exposes this as *Scan existing footage* / *Re-read all vehicles*.

## 6. Setup notes

* `requirements.txt` pins `opencv-python`, `opencv-contrib-python` and `opencv-python-headless` to the same version (4.10.0.84):
  PaddleOCR (via PaddleX) requires `opencv-contrib-python`, and mixed OpenCV versions corrupt the shared `cv2` module.
* PaddleOCR is run with `enable_mkldnn=False` (Paddle 3.x oneDNN CPU path fails on the detection model).
  Weights (~20 MB) download to `~/.paddlex` on first use.
* The old *Scan for Plates* page still works; its sightings are linked to the vehicle they belong to and stored in the same table.
