"""Vehicle <-> license plate linking pass.

Runs in the core ingest pipeline right after vehicle detection/tracking and before facial
recognition. For every *vehicle* tracklet (Car, Bus, HCV, LCV, Two-wheeler, Three-wheeler) it:

  1. picks up to ``SAMPLES_PER_VEHICLE`` well-spaced frames where the vehicle is large and confident,
  2. runs the plate detector inside the (padded) vehicle box of each frame and reads each plate,
  3. combines the readings (the text with the highest summed confidence wins) and stores ONE row
     per vehicle in ``license_plate_detections`` with a status:

        read          plate text recognised (stored exactly as OCR produced it, no parsing)
        blurry        a plate was found but could not be read
        not_detected  no plate was found in any sampled frame

     The row also keeps the plate cutout image, so the UI can show "blurry" plates to a human.

Rows are keyed ``plate:<tracklet_id>`` so re-running is idempotent. A matched watchlist plate raises
an ``anpr_watchlist`` alert (once per vehicle).
"""
from __future__ import annotations

import json
import os
import shutil
import threading
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import cv2
from loguru import logger
from sqlalchemy.orm import Session

from app.attributes.color_extractor import canonical_object_type
from app.config import get_data_path
from app.db.models import LicensePlateDetection, VideoAsset
from app.detection.plate_alerts import active_watchlist, raise_watchlist_alert
from app.detection.plate_detector import PlateDetector, get_plate_detector
from app.detection.plate_ocr import get_active_engine_name

SAMPLES_PER_VEHICLE = 5
MIN_VEHICLE_SIDE_PX = 32
VEHICLE_PAD = 0.10


def plate_row_id(tracklet_id: str) -> str:
    return f"plate:{tracklet_id}"


def plates_dir(video_id: str) -> str:
    return get_data_path(os.path.join("processed/plates", video_id))


def delete_plates_for_video(db: Session, video_id: str) -> int:
    """Remove a video's plate rows and cutout images (used when a video is deleted)."""
    removed = db.query(LicensePlateDetection).filter(LicensePlateDetection.video_id == video_id).delete()
    shutil.rmtree(plates_dir(video_id), ignore_errors=True)
    return removed


def _pick_sample_frames(track: dict[int, tuple[list[float], float]], count: int) -> list[int]:
    """Largest/most confident frames first, but keep them spread out so we see different poses."""
    scored = []
    for frame_index, (bbox, conf) in track.items():
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if min(w, h) < MIN_VEHICLE_SIDE_PX:
            continue
        scored.append((conf * w * h, frame_index))
    if not scored:  # tiny vehicle everywhere: still try its single best frame
        scored = [(conf * max(1.0, (b[2] - b[0]) * (b[3] - b[1])), f) for f, (b, conf) in track.items()]
    scored.sort(reverse=True)

    span = max(track) - min(track) + 1 if track else 1
    min_gap = max(2, span // (2 * count))
    chosen: list[int] = []
    for _, frame_index in scored:
        if all(abs(frame_index - c) >= min_gap for c in chosen):
            chosen.append(frame_index)
        if len(chosen) >= count:
            break
    return sorted(chosen)


class VehiclePlateService:
    def __init__(self, detector: Optional[PlateDetector] = None):
        self.detector = detector or get_plate_detector()

    # ------------------------------------------------------------------ artifact loading
    @staticmethod
    def _load_artifact(video_id: str) -> dict[str, Any]:
        path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
        if not os.path.exists(path):
            raise FileNotFoundError(f"Detection artifact not found for video {video_id}: {path}")
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)

    # ------------------------------------------------------------------ main entry
    def process_video(
        self,
        video_id: str,
        db: Session,
        video_path: Optional[str] = None,
        force: bool = False,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> dict[str, Any]:
        video = db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
        if not video:
            raise ValueError(f"Video {video_id} not found")

        if video_path is None:
            from app.detection.detector import resolve_standardized_video_path

            video_path = resolve_standardized_video_path(video)
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        artifact = self._load_artifact(video_id)
        fps = float(artifact.get("fps") or 10.0)
        engine_key = get_active_engine_name()

        # tracker_id -> {frame_index: (bbox, confidence)}
        tracks: dict[int, dict[int, tuple[list[float], float]]] = defaultdict(dict)
        for frame in artifact.get("frame_detections", []):
            for det in frame.get("detections", []):
                if det.get("tracker_id") is not None:
                    tracks[int(det["tracker_id"])][int(frame["frame_index"])] = (
                        det["bbox"], float(det.get("confidence", 0.0))
                    )

        vehicles = [
            t for t in artifact.get("tracklets", [])
            if canonical_object_type(t.get("class_name"), t.get("object_type")) == "vehicle"
        ]

        existing = {
            r.tracklet_id: r
            for r in db.query(LicensePlateDetection).filter(
                LicensePlateDetection.video_id == video_id, LicensePlateDetection.tracklet_id.isnot(None)
            )
        }
        todo = [t for t in vehicles if force or t["tracklet_id"] not in existing]

        # frame_index -> [(tracklet, bbox)] so each frame is decoded once
        frame_jobs: dict[int, list[tuple[dict, list[float]]]] = defaultdict(list)
        for tracklet in todo:
            track = tracks.get(int(tracklet["tracker_id"]), {})
            for frame_index in _pick_sample_frames(track, SAMPLES_PER_VEHICLE):
                frame_jobs[frame_index].append((tracklet, track[frame_index][0]))

        candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open video {video_path}")
        try:
            ordered = sorted(frame_jobs)
            for done, frame_index in enumerate(ordered, start=1):
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = cap.read()
                if not ok:
                    continue
                height, width = frame.shape[:2]
                for tracklet, bbox in frame_jobs[frame_index]:
                    x1, y1, x2, y2 = bbox
                    pad_x, pad_y = (x2 - x1) * VEHICLE_PAD, (y2 - y1) * VEHICLE_PAD
                    region = (
                        max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y)),
                        min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y)),
                    )
                    if region[2] <= region[0] or region[3] <= region[1]:
                        continue
                    try:
                        found = self.detector.analyze_region(frame, region)
                    except Exception as exc:
                        logger.warning(f"Plate analysis failed for {tracklet['tracklet_id']} @ {frame_index}: {exc}")
                        continue
                    for cand in found:
                        cand["frame_index"] = frame_index
                        candidates[tracklet["tracklet_id"]].append(cand)
                if progress:
                    progress(done, len(ordered))
        finally:
            cap.release()

        summary = {
            "video_id": video_id, "vehicles": len(vehicles), "processed": len(todo),
            "skipped": len(vehicles) - len(todo), "read": 0, "blurry": 0, "not_detected": 0,
            "watchlist_hits": 0, "engine": engine_key,
        }
        watchlist = active_watchlist(db)
        os.makedirs(plates_dir(video_id), exist_ok=True)

        for tracklet in todo:
            tracklet_id = tracklet["tracklet_id"]
            status, best = self._aggregate(candidates.get(tracklet_id, []))
            summary[status] += 1

            cutout_path = None
            if best is not None:
                cutout_path = os.path.join(plates_dir(video_id), f"{_safe(tracklet_id)}.jpg")
                cv2.imwrite(cutout_path, best["cutout"], [cv2.IMWRITE_JPEG_QUALITY, 92])

            row = existing.get(tracklet_id) or LicensePlateDetection(id=plate_row_id(tracklet_id))
            row.video_id = video_id
            row.camera_id = video.camera_id
            row.tracklet_id = tracklet_id
            row.plate_status = status
            row.plate_text = best["plate_text"] if status == "read" else ""
            row.confidence = round(best["confidence"], 4) if best else 0.0
            row.ocr_confidence = round(best["ocr_confidence"], 4) if best and status == "read" else None
            row.ocr_engine = engine_key
            row.bbox = json.dumps(best["bbox"]) if best else "[]"
            row.frame_number = best["frame_index"] if best else None
            row.timestamp_seconds = round(best["frame_index"] / fps, 2) if best else None
            row.cutout_path = cutout_path
            row.is_watchlisted = False
            if existing.get(tracklet_id) is None:
                db.add(row)

            entry = watchlist.get(row.plate_text) if status == "read" else None
            if entry is not None:
                row.is_watchlisted = True
                summary["watchlist_hits"] += 1
                if row.alert_id is None:  # one alert per vehicle, even across re-reads
                    alert = raise_watchlist_alert(
                        db, entry, plate_text=row.plate_text, confidence=row.confidence or 0.0,
                        camera_id=video.camera_id, video_id=video_id, tracklet_id=tracklet_id,
                    )
                    if alert is not None:
                        row.alert_id = alert.id

        db.commit()
        logger.info(f"Vehicle plate pass for {video_id}: {summary}")
        return summary

    # ------------------------------------------------------------------ combining readings
    @staticmethod
    def _aggregate(cands: list[dict[str, Any]]) -> tuple[str, Optional[dict[str, Any]]]:
        """Pick the best plate for one vehicle. Returns (status, representative candidate)."""
        if not cands:
            return "not_detected", None

        reads = [c for c in cands if c["plate_text"]]
        if reads:
            weight = lambda c: c["confidence"] * c["ocr_confidence"]  # noqa: E731
            totals: dict[str, float] = defaultdict(float)
            for c in reads:
                totals[c["plate_text"]] += weight(c)
            winner = max(totals, key=totals.get)  # same text seen in several frames outvotes one lucky read
            return "read", max((c for c in reads if c["plate_text"] == winner), key=weight)

        # Plate boxes but no usable text: keep the most confident/sharpest cutout for a human to look at.
        def sharpness(c: dict[str, Any]) -> float:
            gray = cv2.cvtColor(c["cutout"], cv2.COLOR_BGR2GRAY)
            return float(cv2.Laplacian(gray, cv2.CV_64F).var())

        return "blurry", max(cands, key=lambda c: (c["confidence"], sharpness(c)))


def _safe(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)[:120]


# --------------------------------------------------------------------------- background backfill job
_job_lock = threading.Lock()
_job: dict[str, Any] = {"running": False}


def backfill_status() -> dict[str, Any]:
    with _job_lock:
        return dict(_job)


def start_backfill(force: bool = False, video_id: Optional[str] = None) -> bool:
    """Start reading plates for already-processed videos in a background thread. False if one is running."""
    with _job_lock:
        if _job.get("running"):
            return False
        _job.clear()
        _job.update({
            "running": True, "force": force, "engine": get_active_engine_name(),
            "videos_total": 0, "videos_done": 0, "current_video": None,
            "read": 0, "blurry": 0, "not_detected": 0, "vehicles": 0, "errors": [],
            "started_at": datetime.now(timezone.utc).isoformat(), "finished_at": None,
        })
    threading.Thread(target=_run_backfill, args=(force, video_id), daemon=True, name="plate-backfill").start()
    return True


def _run_backfill(force: bool, only_video: Optional[str]) -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        query = db.query(VideoAsset).filter(VideoAsset.is_bin == False)  # noqa: E712
        if only_video:
            query = query.filter(VideoAsset.id == only_video)
        videos = [
            v for v in query.all()
            if os.path.exists(get_data_path(os.path.join("processed/detections", v.id, "detections.json")))
        ]
        with _job_lock:
            _job["videos_total"] = len(videos)

        service = VehiclePlateService()
        for video in videos:
            with _job_lock:
                _job["current_video"] = video.id
            try:
                result = service.process_video(video.id, db, force=force)
                with _job_lock:
                    for key in ("read", "blurry", "not_detected"):
                        _job[key] += result[key]
                    _job["vehicles"] += result["processed"]
            except Exception as exc:
                db.rollback()
                logger.error(f"Plate backfill failed for {video.id}: {exc}")
                with _job_lock:
                    _job["errors"].append({"video_id": video.id, "error": str(exc)})
            with _job_lock:
                _job["videos_done"] += 1
    except Exception as exc:
        logger.error(f"Plate backfill crashed: {exc}")
        with _job_lock:
            _job["errors"].append({"video_id": None, "error": str(exc)})
    finally:
        db.close()
        with _job_lock:
            _job["running"] = False
            _job["current_video"] = None
            _job["finished_at"] = datetime.now(timezone.utc).isoformat()
