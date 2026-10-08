# Forensic Export & Attribute Search

Covers two features: **attribute-aware search** (explicit colour / vehicle-type checks) and **sealed forensic
export bundles** (clips, annotated frames, chain of custody, SHA-256 integrity).

---

## 1. Attribute search (colour & type)

CLIP similarity alone cannot enforce "red hatchback" (a blue car can still be visually close), so every tracklet
gets structured, auditable attributes computed from its best crop (`app/attributes/color_extractor.py`):

| Object | Attributes stored in `tracklets.attributes` |
|---|---|
| person | `upper_colors` (torso band), `lower_colors` (leg band), `colors` |
| vehicle | `body_colors`, `vehicle_type` (car / motorcycle / bus / truck / van / bicycle / auto-rickshaw), `body_style` (from the BLIP caption when present) |

Colours are classified per pixel in HSV into 11 names (black, white, gray, red, orange, yellow, green, blue, purple,
pink, brown); names covering ≥ 15 % of a region are kept (max two). This is a deterministic heuristic — fast enough for
edge deployment and easy to explain — **not** a trained attribute model. Known limits: strong shadows and compression
shift colours; patterned clothing can report a secondary colour; the detector's own classes decide person vs vehicle.

### Query understanding (`app/search/attribute_parser.py`)

`man in yellow t-shirt and black cap` becomes:

| Phrase | Region | Verifiable? |
|---|---|---|
| yellow t-shirt | upper body | yes |
| black cap | head | **no** — headwear colour is not extracted, so it is shown to the operator as *unverifiable* instead of being silently ignored |
| man | person | yes |

`red and black jacket` shares the garment between both colours; plurals (`red hatchbacks`) are understood.
Preview what the system will check with `GET /api/v1/search/parse?q=...`.

### Search modes (`POST /api/v1/search`)

| Field | Meaning |
|---|---|
| `attribute_mode: "boost"` (default) | verified attributes add +0.08 each (max +0.12), contradicted ones subtract 0.08 each (max −0.20); results are re-ranked |
| `"strict"` | results with any *contradicted* attribute are dropped (unverified ones stay and are flagged) |
| `"off"` | pure visual similarity |
| `colors: ["red"]`, `vehicle_type: "car"` | explicit filters merged with whatever the query text implies |

Every result carries `explanation.attribute_checks` (matched / mismatched / unverified + why) and the raw visual
similarity next to the final score, so a reviewer can see exactly what moved a result.

### Indexing & backfill

New videos get attributes automatically during embedding. For data indexed earlier run once:

```
POST /api/v1/attributes/backfill        # ?force=true recomputes everything
```

It also normalises legacy detector classes (`pedestrain` → `person`, `two-wheeler` → `vehicle`) in SQLite and Qdrant
and repairs `tracker_id` values that older index runs stored as `0`.

---

## 2. Forensic export bundles

`POST /api/v1/exports` seals the selected results into `EXP-<date>-<time>-<id>.zip` under `backend/data/exports/`:

```
manifest.json        items, options, source-video hashes, chain-of-custody events, per-file SHA-256
SHA256SUMS.txt       `sha256sum -c` compatible; covers every file including manifest.json
report.html          printable case report (print to PDF)
items/001_<tracklet>/clip.mp4        H.264 clip, ±2 s padding, max 30 s
items/001_<tracklet>/annotated.jpg   full frame, subject boxed, camera / absolute time / score burned in
items/001_<tracklet>/crop.jpg        original crop used for matching
items/001_<tracklet>/metadata.json   per-item record incl. attributes and warnings
```

Request body: `items[{tracklet_id, score}]`, `query`, `filters`, `case_reference`, `operator`, `notes`,
`include_clips`, `include_annotated`, `blur_faces`, `clip_padding_seconds`, `max_clip_seconds`.

### Integrity controls

1. **Per-file SHA-256** in the manifest and in `SHA256SUMS.txt`.
2. **Source integrity check at export time**: the standardized recording is re-hashed and compared with the
   `transcoded_sha256` recorded at ingest (`MATCH` / `MISMATCH` / `SOURCE_MISSING`); the original upload hash
   (`intake_sha256`) is carried along. A mismatch is written to the manifest warnings and the custody log.
3. **Chain-of-custody events** (`search_executed`, `source_integrity_check`, `export_created`) with actor and UTC time.
4. **Registry**: the ZIP hash and manifest hash are stored in `forensic_exports` and the ZIP hash is written to
   `search_logs.clip_export_hash`, so a copy can later be proven identical to what the system issued.
5. **Subject boxes only when provable**: the annotated frame uses the detection artifact's per-frame box; if it is
   unavailable no box is drawn (a box on the wrong frame would be misleading evidence) and a warning is recorded.

### Verification

| Endpoint | Purpose |
|---|---|
| `GET /exports` / `GET /exports/{id}` | registry |
| `GET /exports/{id}/download` | bundle (`X-Content-SHA256` header) |
| `GET /exports/{id}/verify` | re-hash the stored bundle |
| `POST /exports/verify-upload` | check any bundle (e.g. received from another agency) |

Verdicts: **VERIFIED** (all hashes match and the bundle is what we issued) · **UNREGISTERED** (self-consistent but
not issued by this installation) · **TAMPERED** (modified / missing / extra files, or manifest differs from the
issued one) · **INVALID** (not an evidence bundle). The UI lives on the **Evidence Vault** page (`/evidence`).

An attacker who edits a file *and* rewrites `SHA256SUMS.txt` is still caught: the manifest hash (which lists the
original file hashes) no longer matches the registry.

### Privacy: face redaction

`blur_faces: true` pixelates every face except the matched subject's, in annotated frames and clips. Detectors, in
order: the project's YOLO face weights (`backend/data/models/face_detection/`), then OpenCV Haar cascades if the
OpenCV build ships them. **If neither is available the export is cancelled (HTTP 409)** — it never silently releases
unredacted footage. Detection is best-effort (small, turned or occluded faces can be missed); the manifest says so and
manual review is still required before release.

### Notes & limits

- Results are *candidates for human review*, not identity determinations; the report and every annotated frame say so.
- Up to 50 results per export; clips are cut synchronously, so large exports take a while.
- Verification proves a bundle was not altered after issue; it does not prove the original footage was authentic.
