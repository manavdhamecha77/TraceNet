"""Forensic evidence export: sealed ZIP bundles with integrity hashing and chain of custody.

Bundle layout::

    <export_id>.zip
      manifest.json          every item, source video hashes, options, custody events, per-file SHA-256
      SHA256SUMS.txt         `sha256sum -c` compatible list covering every other file (incl. manifest.json)
      report.html            human-readable case report (self-contained, print to PDF)
      items/001_<tracklet>/{clip.mp4, annotated.jpg, crop.jpg, metadata.json}

The bundle's own SHA-256 and the manifest's SHA-256 are recorded in the `forensic_exports` table
(and in `search_logs.clip_export_hash`), so a copy can later be proven identical to what was issued.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import cv2
from loguru import logger
from sqlalchemy.orm import Session

from app.config import get_data_path
from app.db.models import ForensicExport, SearchLog, Tracklet, VideoAsset
from app.detection.detector import resolve_standardized_video_path
from app.export import face_blur
from app.preprocess.preprocessor import VideoPreprocessor

EXPORT_SCHEMA = "tracenet-forensic-export/1.0"
MAX_ITEMS = 50
SUMS_NAME = "SHA256SUMS.txt"
MANIFEST_NAME = "manifest.json"

REVIEW_NOTICE = (
    "Search results are ranked CANDIDATES for human review. They are not an identity determination "
    "and must be verified by a trained operator before any action is taken."
)


# --------------------------------------------------------------------------- hashing helpers
def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _ascii(text: str) -> str:
    return re.sub(r"[^\x20-\x7e]", "?", text or "")


def _safe_name(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", text)[:80]


def export_root() -> str:
    path = get_data_path("exports")
    os.makedirs(path, exist_ok=True)
    return path


def export_zip_path(export_id: str) -> str:
    return os.path.join(export_root(), f"{export_id}.zip")


# --------------------------------------------------------------------------- bundle verification
def verify_bundle(zip_path: str) -> dict[str, Any]:
    """
    Check a bundle's internal consistency (SHA256SUMS + manifest hashes). Registry comparison
    (was this issued by us?) is added by the caller, which owns the DB session.
    """
    result: dict[str, Any] = {
        "status": "INVALID",
        "zip_sha256": None,
        "checked_files": 0,
        "mismatches": [],
        "missing": [],
        "unlisted": [],
        "manifest_sha256": None,
        "manifest": None,
        "problems": [],
    }
    if not os.path.exists(zip_path):
        result["problems"].append("File not found")
        return result

    result["zip_sha256"] = sha256_file(zip_path)
    try:
        archive = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        result["problems"].append("Not a valid ZIP archive")
        return result

    with archive:
        names = {i.filename for i in archive.infolist() if not i.is_dir()}
        if SUMS_NAME not in names or MANIFEST_NAME not in names:
            result["problems"].append(f"Missing {SUMS_NAME} or {MANIFEST_NAME}: not a TraceNet evidence bundle")
            return result

        actual: dict[str, str] = {}
        for name in names - {SUMS_NAME}:
            digest = hashlib.sha256()
            with archive.open(name) as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            actual[name] = digest.hexdigest()

        expected: dict[str, str] = {}
        for line in archive.read(SUMS_NAME).decode("utf-8", errors="replace").splitlines():
            match = re.match(r"^([0-9a-f]{64}) [ *](.+)$", line.strip())
            if match:
                expected[match.group(2)] = match.group(1)

        result["missing"] = sorted(set(expected) - set(actual))
        result["unlisted"] = sorted(set(actual) - set(expected))
        for name, want in expected.items():
            if name in actual and actual[name] != want:
                result["mismatches"].append({"path": name, "expected": want, "actual": actual[name]})
        result["checked_files"] = len(actual)
        result["manifest_sha256"] = actual.get(MANIFEST_NAME)

        try:
            manifest = json.loads(archive.read(MANIFEST_NAME))
            result["manifest"] = {
                k: manifest.get(k) for k in ("schema", "export_id", "created_at_utc", "created_by", "case_reference")
            }
            for entry in manifest.get("files", []):
                path = entry.get("path")
                if (
                    path in actual
                    and actual[path] != entry.get("sha256")
                    and not any(m["path"] == path for m in result["mismatches"])
                ):
                    result["mismatches"].append(
                        {"path": path, "expected": entry.get("sha256"), "actual": actual[path], "source": "manifest"}
                    )
        except Exception:
            result["problems"].append("manifest.json is unreadable")

    clean = not (result["mismatches"] or result["missing"] or result["unlisted"] or result["problems"])
    result["status"] = "CONSISTENT" if clean else "TAMPERED"
    return result


def verify_against_registry(db: Session, report: dict[str, Any]) -> dict[str, Any]:
    """Add registry comparison and the final verdict: VERIFIED | UNREGISTERED | TAMPERED | INVALID."""
    if report["status"] == "INVALID":
        return report

    record = None
    export_id = (report.get("manifest") or {}).get("export_id")
    if export_id:
        record = db.query(ForensicExport).filter(ForensicExport.id == export_id).first()
    if record is None and report.get("zip_sha256"):
        record = db.query(ForensicExport).filter(ForensicExport.zip_sha256 == report["zip_sha256"]).first()

    report["registry"] = {"found": record is not None}
    if record is not None:
        report["registry"].update({
            "export_id": record.id,
            "issued_at": _iso(record.created_at),
            "issued_to": record.created_by,
            "zip_hash_matches": record.zip_sha256 == report["zip_sha256"],
            "manifest_hash_matches": record.manifest_sha256 == report["manifest_sha256"],
        })

    if report["status"] == "TAMPERED":
        return report
    if record is None:
        report["status"] = "UNREGISTERED"
    elif not report["registry"]["manifest_hash_matches"]:
        report["status"] = "TAMPERED"
        report["problems"].append("Manifest differs from the one issued by this system")
    else:
        report["status"] = "VERIFIED"
    return report


def verify_stored_export(db: Session, record: ForensicExport) -> dict[str, Any]:
    path = get_data_path(record.zip_path)
    if not os.path.exists(path):
        report: dict[str, Any] = {"status": "MISSING", "problems": ["Stored bundle file is missing from disk"]}
    else:
        report = verify_against_registry(db, verify_bundle(path))
        if report["status"] == "VERIFIED" and not report["registry"].get("zip_hash_matches", True):
            report["status"] = "TAMPERED"
            report["problems"].append("Archive bytes differ from the issued archive hash")
    record.last_verified_at = _utc_now()
    record.last_verification = report["status"]
    db.commit()
    return report


# --------------------------------------------------------------------------- export service
class ForensicExportService:
    def __init__(self, db: Session):
        self.db = db
        self._frame_maps: dict[str, dict[str, Any]] = {}
        self._source_hashes: dict[str, dict[str, Any]] = {}
        self.warnings: list[str] = []

    # ---- source video / detection artifacts
    def _video_path(self, video: VideoAsset) -> Optional[str]:
        path = resolve_standardized_video_path(video)
        return path if os.path.exists(path) else None

    def _frame_map(self, video_id: str) -> dict[str, Any]:
        """Per-video detection artifact: fps, model path and {tracker_id: {frame_index: (bbox, conf)}}."""
        if video_id in self._frame_maps:
            return self._frame_maps[video_id]
        info: dict[str, Any] = {"fps": None, "model_path": None, "tracks": {}}
        path = get_data_path(os.path.join("processed/detections", video_id, "detections.json"))
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                info["fps"] = payload.get("fps")
                info["model_path"] = payload.get("model_path")
                for frame in payload.get("frame_detections", []):
                    for det in frame.get("detections", []):
                        tid = det.get("tracker_id")
                        if tid is not None:
                            info["tracks"].setdefault(int(tid), {})[int(frame["frame_index"])] = (
                                det["bbox"], float(det.get("confidence", 0.0))
                            )
            except Exception as exc:
                logger.warning(f"Could not load detection artifact for {video_id}: {exc}")
        self._frame_maps[video_id] = info
        return info

    def _source_integrity(self, video: VideoAsset, video_path: Optional[str]) -> dict[str, Any]:
        if video.id in self._source_hashes:
            return self._source_hashes[video.id]
        actual = sha256_file(video_path) if video_path else None
        expected = video.transcoded_sha256
        if actual is None:
            status = "SOURCE_MISSING"
        elif not expected:
            status = "NO_REFERENCE_HASH"
        else:
            status = "MATCH" if actual == expected else "MISMATCH"
        if status in ("MISMATCH", "SOURCE_MISSING"):
            self.warnings.append(f"Source video {video.id}: integrity status {status}")
        record = {
            "video_id": video.id,
            "camera_id": video.camera_id,
            "camera_name": video.camera.name if video.camera else video.camera_id,
            "original_filename": video.original_filename,
            "standardized_filename": video.standardized_filename,
            "intake_sha256_original_upload": video.intake_sha256,
            "transcoded_sha256_recorded_at_ingest": expected,
            "transcoded_sha256_at_export": actual,
            "integrity_status": status,
            "recording_start_utc": _iso(video.start_time or video.upload_timestamp),
        }
        self._source_hashes[video.id] = record
        return record

    @staticmethod
    def _absolute_time(video: VideoAsset, offset_seconds: float) -> Optional[str]:
        ref = video.start_time or video.upload_timestamp
        if not ref:
            return None
        if ref.tzinfo is None:
            ref = ref.replace(tzinfo=timezone.utc)
        return (ref + timedelta(seconds=offset_seconds)).isoformat(timespec="milliseconds")

    # ---- evidence rendering
    @staticmethod
    def _tracker_id(tracklet: Tracklet) -> int:
        """Tracklet ids are '<video>_trk_<tracker_id>'; older index runs stored tracker_id=0, so trust the id."""
        match = re.search(r"_trk_(\d+)$", tracklet.id)
        return int(match.group(1)) if match else int(tracklet.tracker_id)

    @staticmethod
    def _best_frame_index(track: dict[int, tuple], tracklet: Tracklet) -> tuple[int, Optional[list[float]]]:
        """Frame where the subject was detected most confidently, with its box. Without per-frame
        detections no box is returned: a box drawn on the wrong frame would be misleading evidence."""
        if track:
            frame_index, (bbox, _) = max(track.items(), key=lambda kv: kv[1][1])
            return frame_index, bbox
        return tracklet.frame_start, None

    @staticmethod
    def _read_frame(video_path: str, frame_index: int):
        cap = cv2.VideoCapture(video_path)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_index))
            ok, frame = cap.read()
            return frame if ok else None
        finally:
            cap.release()

    def _render_annotated(self, frame, bbox, lines: list[str], blur: bool, export_id: str) -> tuple[Any, int]:
        redacted = 0
        if blur:
            redacted, _ = face_blur.blur_non_matched_faces(frame, [bbox] if bbox else [])
        if bbox:
            x1, y1, x2, y2 = [int(v) for v in bbox]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
        banner_h = 22 * len(lines) + 12
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (frame.shape[1], banner_h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
        for i, line in enumerate(lines):
            cv2.putText(frame, _ascii(line), (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        footer = f"TraceNet {export_id} - candidate match, human review required"
        cv2.putText(frame, footer, (10, frame.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
        return frame, redacted

    def _make_clip(
        self,
        video_path: str,
        dst: str,
        t0: float,
        t1: float,
        track: dict[int, tuple],
        fps_hint: Optional[float],
        blur: bool,
        staging: str,
    ) -> dict[str, Any]:
        """Cut [t0, t1] to H.264 MP4, optionally redacting non-matched faces frame by frame."""
        ffmpeg = VideoPreprocessor.get_ffmpeg_binary()
        duration = max(0.5, t1 - t0)
        faces_redacted = 0

        if not blur:
            cmd = [
                ffmpeg, "-y", "-ss", f"{t0:.3f}", "-i", video_path, "-t", f"{duration:.3f}",
                "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", dst,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0 or not os.path.exists(dst):
                raise RuntimeError(f"ffmpeg clip cut failed: {proc.stderr[-300:]}")
            return {"faces_redacted": 0}

        raw = os.path.join(staging, f"_raw_{uuid.uuid4().hex[:8]}.mp4")
        cap = cv2.VideoCapture(video_path)
        try:
            fps = cap.get(cv2.CAP_PROP_FPS) or fps_hint or 10.0
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t0 * fps))
            writer = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
            index, end_index = int(t0 * fps), int(t1 * fps)
            cached_faces: Optional[list] = None
            tracked_frames = sorted(track) if track else []
            while index <= end_index:
                ok, frame = cap.read()
                if not ok:
                    break
                protected = []
                if tracked_frames:
                    nearest = min(tracked_frames, key=lambda f: abs(f - index))
                    if abs(nearest - index) <= 5:
                        protected = [track[nearest][0]]
                use_cache = cached_faces if (index % 2 == 1) else None  # re-detect every other frame
                count, cached_faces = face_blur.blur_non_matched_faces(frame, protected, use_cache)
                faces_redacted += count
                writer.write(frame)
                index += 1
            writer.release()
        finally:
            cap.release()

        cmd = [
            ffmpeg, "-y", "-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        try:
            os.remove(raw)
        except OSError:
            pass
        if proc.returncode != 0 or not os.path.exists(dst):
            raise RuntimeError(f"ffmpeg transcode failed: {proc.stderr[-300:]}")
        return {"faces_redacted": faces_redacted}

    # ---- main entry point
    def create(self, spec: dict[str, Any]) -> ForensicExport:
        items_in = spec["items"]
        if not items_in:
            raise ValueError("No results selected for export")
        if len(items_in) > MAX_ITEMS:
            raise ValueError(f"Too many results selected (max {MAX_ITEMS} per export)")

        ids = [i["tracklet_id"] for i in items_in]
        tracklets = {t.id: t for t in self.db.query(Tracklet).filter(Tracklet.id.in_(ids)).all()}
        missing = [i for i in ids if i not in tracklets]
        if missing:
            raise LookupError(f"Tracklets not found: {', '.join(missing[:5])}")

        if spec.get("blur_faces") and face_blur.available_backend() is None:
            raise face_blur.FaceRedactionUnavailable(
                "Face redaction requested but no face detector is available: add YOLO face weights under "
                "backend/data/models/face_detection/ or use an OpenCV build with Haar cascades. "
                "The export was cancelled so that no unredacted footage is released."
            )

        created = _utc_now()
        export_id = f"EXP-{created:%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
        operator = (spec.get("operator") or "demo").strip() or "demo"
        include_clips = bool(spec.get("include_clips", True))
        include_annotated = bool(spec.get("include_annotated", True))
        blur = bool(spec.get("blur_faces", False))
        pad = float(spec.get("clip_padding_seconds", 2.0))
        max_clip = float(spec.get("max_clip_seconds", 30))

        staging = os.path.join(export_root(), f"_staging_{export_id}")
        os.makedirs(os.path.join(staging, "items"), exist_ok=True)
        try:
            return self._build(
                spec, items_in, tracklets, export_id, created, operator,
                include_clips, include_annotated, blur, pad, max_clip, staging,
            )
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def _build(self, spec, items_in, tracklets, export_id, created, operator,
               include_clips, include_annotated, blur, pad, max_clip, staging) -> ForensicExport:
        manifest_items: list[dict[str, Any]] = []
        sources: dict[str, dict[str, Any]] = {}
        model_names: set[str] = set()

        for position, item_spec in enumerate(items_in, start=1):
            tracklet = tracklets[item_spec["tracklet_id"]]
            video = tracklet.video
            folder = f"items/{position:03d}_{_safe_name(tracklet.id)}"
            os.makedirs(os.path.join(staging, folder), exist_ok=True)

            video_path = self._video_path(video) if video else None
            if video:
                sources[video.id] = self._source_integrity(video, video_path)
            frame_info = self._frame_map(tracklet.video_id)
            if frame_info.get("model_path"):
                model_names.add(os.path.basename(str(frame_info["model_path"])))
            tracker_id = self._tracker_id(tracklet)
            track = frame_info["tracks"].get(tracker_id, {})

            try:
                attributes = json.loads(tracklet.attributes) if tracklet.attributes else {}
            except Exception:
                attributes = {}

            abs_start = self._absolute_time(video, tracklet.timestamp_start_seconds) if video else None
            abs_end = self._absolute_time(video, tracklet.timestamp_end_seconds) if video else None
            camera_name = video.camera.name if video and video.camera else tracklet.camera_id
            record: dict[str, Any] = {
                "position": position,
                "tracklet_id": tracklet.id,
                "tracker_id": tracker_id,
                "video_id": tracklet.video_id,
                "camera_id": tracklet.camera_id,
                "camera_name": camera_name,
                "object_type": tracklet.object_type,
                "class_name": tracklet.class_name,
                "match_score": item_spec.get("score"),
                "detector_confidence": tracklet.mean_confidence,
                "offset_start_seconds": tracklet.timestamp_start_seconds,
                "offset_end_seconds": tracklet.timestamp_end_seconds,
                "absolute_start_utc": abs_start,
                "absolute_end_utc": abs_end,
                "attributes": attributes,
                "files": [],
                "warnings": [],
            }

            # 1. original crop
            if tracklet.best_crop_path and os.path.exists(tracklet.best_crop_path):
                shutil.copyfile(tracklet.best_crop_path, os.path.join(staging, folder, "crop.jpg"))
                record["files"].append({"role": "crop", "path": f"{folder}/crop.jpg"})
            else:
                record["warnings"].append("crop image not found")

            # 2. annotated full frame
            if include_annotated:
                if not video_path:
                    record["warnings"].append("annotated frame skipped: source video missing")
                else:
                    frame_index, bbox = self._best_frame_index(track, tracklet)
                    if bbox is None:
                        record["warnings"].append("subject box omitted: per-frame detections unavailable for this video")
                    frame = self._read_frame(video_path, frame_index)
                    if frame is None:
                        record["warnings"].append("annotated frame skipped: frame could not be read")
                    else:
                        lines = [
                            f"{camera_name} ({tracklet.camera_id})  |  {abs_start or 'time unknown'}",
                            f"{tracklet.class_name} #{tracker_id}  |  video offset {tracklet.timestamp_start_seconds:.1f}s"
                            + (f"  |  match {item_spec['score'] * 100:.0f}%" if item_spec.get("score") is not None else ""),
                        ]
                        frame, redacted = self._render_annotated(frame, bbox, lines, blur, export_id)
                        cv2.imwrite(os.path.join(staging, folder, "annotated.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                        record["files"].append({"role": "annotated_frame", "path": f"{folder}/annotated.jpg"})
                        record["annotated_frame_index"] = frame_index
                        if blur:
                            record["annotated_faces_redacted"] = redacted

            # 3. clip
            if include_clips:
                if not video_path:
                    record["warnings"].append("clip skipped: source video missing")
                else:
                    t0 = max(0.0, tracklet.timestamp_start_seconds - pad)
                    t1 = tracklet.timestamp_end_seconds + pad
                    truncated = (t1 - t0) > max_clip
                    t1 = min(t1, t0 + max_clip)
                    try:
                        info = self._make_clip(
                            video_path, os.path.join(staging, folder, "clip.mp4"), t0, t1, track,
                            frame_info.get("fps"), blur, staging,
                        )
                        record["files"].append({"role": "clip", "path": f"{folder}/clip.mp4"})
                        record["clip_window_seconds"] = {"start": round(t0, 3), "end": round(t1, 3), "truncated": truncated}
                        if blur:
                            record["clip_faces_redacted"] = info["faces_redacted"]
                    except Exception as exc:
                        logger.error(f"Clip export failed for {tracklet.id}: {exc}")
                        record["warnings"].append(f"clip failed: {exc}")

            for w in record["warnings"]:
                self.warnings.append(f"{tracklet.id}: {w}")

            with open(os.path.join(staging, folder, "metadata.json"), "w", encoding="utf-8") as handle:
                json.dump(record, handle, indent=2, sort_keys=True)
            record["files"].append({"role": "metadata", "path": f"{folder}/metadata.json"})
            manifest_items.append(record)

        # ---- custody events
        search_log = self._find_search_log(spec)
        events: list[dict[str, Any]] = []
        if search_log is not None:
            events.append({
                "event": "search_executed",
                "at_utc": _iso(search_log.timestamp),
                "actor": search_log.user_id,
                "search_log_id": search_log.id,
                "query": search_log.query_text,
                "results_count": search_log.results_count,
            })
        for src in sources.values():
            events.append({
                "event": "source_integrity_check",
                "at_utc": _iso(created),
                "actor": "system",
                "video_id": src["video_id"],
                "status": src["integrity_status"],
                "expected_sha256": src["transcoded_sha256_recorded_at_ingest"],
                "actual_sha256": src["transcoded_sha256_at_export"],
            })
        events.append({
            "event": "export_created",
            "at_utc": _iso(created),
            "actor": operator,
            "export_id": export_id,
            "case_reference": spec.get("case_reference"),
            "items": len(manifest_items),
        })

        # ---- report (before hashing so it is covered)
        context = {
            "export_id": export_id, "created": created, "operator": operator,
            "case_reference": spec.get("case_reference"), "notes": spec.get("notes"),
            "query": spec.get("query") or "", "filters": spec.get("filters") or {},
            "blur": blur, "items": manifest_items, "sources": list(sources.values()),
            "events": events, "warnings": list(self.warnings),
        }
        with open(os.path.join(staging, "report.html"), "w", encoding="utf-8") as handle:
            handle.write(_render_report(context))

        # ---- hash every file, then manifest, then SHA256SUMS
        files: list[dict[str, Any]] = []
        for root, _dirs, names in os.walk(staging):
            for name in names:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, staging).replace(os.sep, "/")
                files.append({"path": rel, "sha256": sha256_file(full), "bytes": os.path.getsize(full)})
        files.sort(key=lambda f: f["path"])
        for item in manifest_items:
            for f in item["files"]:
                match = next((x for x in files if x["path"] == f["path"]), None)
                if match:
                    f["sha256"], f["bytes"] = match["sha256"], match["bytes"]

        manifest = {
            "schema": EXPORT_SCHEMA,
            "export_id": export_id,
            "created_at_utc": _iso(created),
            "created_by": operator,
            "case_reference": spec.get("case_reference"),
            "notes": spec.get("notes"),
            "review_notice": REVIEW_NOTICE,
            "search_context": {
                "query": spec.get("query") or "",
                "filters": spec.get("filters") or {},
                "search_log_id": search_log.id if search_log else None,
                "results_exported": len(manifest_items),
            },
            "options": {
                "include_clips": include_clips, "include_annotated": include_annotated,
                "blur_non_matched_faces": blur,
                "face_blur_method": face_blur.available_backend() if blur else None,
                "face_blur_limitations": (
                    "Best-effort automatic face detection; small, occluded or turned faces may not be "
                    "redacted. Manual review is still required before release."
                ) if blur else None,
                "clip_padding_seconds": pad, "max_clip_seconds": max_clip,
            },
            "system": {"name": "TraceNet", "detector_models": sorted(model_names)},
            "sources": list(sources.values()),
            "items": manifest_items,
            "files": files,
            "chain_of_custody": events,
            "warnings": list(self.warnings),
            "integrity": {
                "algorithm": "SHA-256",
                "verify": "Run `sha256sum -c SHA256SUMS.txt` inside the extracted bundle, or upload the ZIP to the Evidence Vault.",
                "note": "manifest.json is covered by SHA256SUMS.txt; the ZIP and manifest hashes are recorded by the issuing system.",
            },
        }
        manifest_path = os.path.join(staging, MANIFEST_NAME)
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
        manifest_sha = sha256_file(manifest_path)

        sums_lines = [f"{f['sha256']} *{f['path']}" for f in files]
        sums_lines.append(f"{manifest_sha} *{MANIFEST_NAME}")
        with open(os.path.join(staging, SUMS_NAME), "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(sorted(sums_lines, key=lambda l: l.split("*", 1)[1])) + "\n")

        # ---- seal
        zip_path = export_zip_path(export_id)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for rel in sorted([f["path"] for f in files] + [MANIFEST_NAME, SUMS_NAME]):
                archive.write(os.path.join(staging, rel), rel)
        zip_sha = sha256_file(zip_path)

        record = ForensicExport(
            id=export_id,
            created_at=created,
            created_by=operator,
            case_reference=spec.get("case_reference"),
            notes=spec.get("notes"),
            query_text=spec.get("query") or "",
            filters=json.dumps(spec.get("filters") or {}),
            options=json.dumps(manifest["options"]),
            item_count=len(manifest_items),
            zip_path=os.path.join("exports", f"{export_id}.zip"),
            zip_bytes=os.path.getsize(zip_path),
            zip_sha256=zip_sha,
            manifest_sha256=manifest_sha,
            search_log_id=search_log.id if search_log else None,
            last_verified_at=created,
            last_verification="VERIFIED",
        )
        self.db.add(record)
        if search_log is not None:
            search_log.clip_export_hash = zip_sha
        self.db.commit()
        self.db.refresh(record)
        logger.info(f"Sealed forensic export {export_id}: {len(manifest_items)} items, sha256={zip_sha[:16]}...")
        return record

    def _find_search_log(self, spec: dict[str, Any]) -> Optional[SearchLog]:
        if spec.get("search_log_id"):
            return self.db.query(SearchLog).filter(SearchLog.id == spec["search_log_id"]).first()
        query = spec.get("query")
        if not query:
            return None
        return (
            self.db.query(SearchLog)
            .filter(SearchLog.query_text == query)
            .order_by(SearchLog.timestamp.desc())
            .first()
        )


# --------------------------------------------------------------------------- HTML report
def _render_report(ctx: dict[str, Any]) -> str:
    e = html.escape

    def row(cells: list[str]) -> str:
        return "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"

    item_rows = []
    for it in ctx["items"]:
        files = {f["role"]: f["path"] for f in it["files"]}
        thumb = f'<a href="{e(files["annotated_frame"])}"><img src="{e(files["annotated_frame"])}" alt="annotated frame"></a>' \
            if "annotated_frame" in files else (f'<img src="{e(files["crop"])}" alt="crop">' if "crop" in files else "")
        attrs = it.get("attributes") or {}
        colours = ", ".join(attrs.get("colors", [])) or "n/a"
        links = " ".join(f'<a href="{e(p)}">{e(r)}</a>' for r, p in files.items())
        score = f"{it['match_score'] * 100:.0f}%" if it.get("match_score") is not None else "n/a"
        item_rows.append(row([
            str(it["position"]), thumb,
            f"{e(str(it['camera_name']))}<br><small>{e(str(it['camera_id']))}</small>",
            f"{e(str(it.get('absolute_start_utc') or 'unknown'))}<br><small>offset {it['offset_start_seconds']:.1f}s - {it['offset_end_seconds']:.1f}s</small>",
            f"{e(str(it['class_name']))}<br><small>colours: {e(colours)}</small>",
            score, links,
        ]))

    source_rows = [row([
        e(s["video_id"]), e(str(s["camera_name"])), e(str(s["original_filename"])),
        f"<code>{e(str(s['transcoded_sha256_at_export']))}</code>", e(s["integrity_status"]),
    ]) for s in ctx["sources"]]
    event_rows = [row([
        e(str(ev.get("at_utc"))), e(ev["event"]), e(str(ev.get("actor"))),
        e(", ".join(f"{k}={v}" for k, v in ev.items() if k not in ("at_utc", "event", "actor") and v is not None)),
    ]) for ev in ctx["events"]]
    warnings = "".join(f"<li>{e(w)}</li>" for w in ctx["warnings"]) or "<li>None</li>"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Evidence Report {e(ctx['export_id'])}</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:2rem;color:#111}}
h1{{margin-bottom:.2rem}} .banner{{background:#fff3cd;border:1px solid #e0a800;padding:.6rem 1rem;margin:1rem 0}}
table{{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}} td,th{{border:1px solid #bbb;padding:.35rem .5rem;font-size:.85rem;vertical-align:top;text-align:left}}
th{{background:#eee}} img{{max-width:240px;max-height:140px}} code{{font-size:.75rem;word-break:break-all}} small{{color:#555}}
</style></head><body>
<h1>Evidence Report</h1>
<div><b>Export ID:</b> {e(ctx['export_id'])} &nbsp; <b>Created (UTC):</b> {e(_iso(ctx['created']) or '')}
 &nbsp; <b>Operator:</b> {e(ctx['operator'])} &nbsp; <b>Case reference:</b> {e(str(ctx['case_reference'] or '-'))}</div>
<div class="banner">{e(REVIEW_NOTICE)}</div>
<h2>Search context</h2>
<p><b>Query:</b> {e(ctx['query'] or '-')}<br><b>Filters:</b> <code>{e(json.dumps(ctx['filters'], sort_keys=True))}</code><br>
<b>Notes:</b> {e(str(ctx['notes'] or '-'))}<br>
<b>Face redaction:</b> {'Non-matched faces pixelated (best-effort, manual review still required)' if ctx['blur'] else 'Not applied'}</p>
<h2>Exported results ({len(ctx['items'])})</h2>
<table><tr><th>#</th><th>Evidence</th><th>Camera</th><th>Time</th><th>Object</th><th>Match</th><th>Files</th></tr>{''.join(item_rows)}</table>
<h2>Source recordings</h2>
<table><tr><th>Video ID</th><th>Camera</th><th>Original file</th><th>SHA-256 at export</th><th>Integrity vs ingest</th></tr>{''.join(source_rows)}</table>
<h2>Chain of custody</h2>
<table><tr><th>Time (UTC)</th><th>Event</th><th>Actor</th><th>Details</th></tr>{''.join(event_rows)}</table>
<h2>Warnings</h2><ul>{warnings}</ul>
<h2>Integrity</h2>
<p>Every file in this bundle is listed with its SHA-256 in <code>manifest.json</code> and <code>SHA256SUMS.txt</code>.
Verify with <code>sha256sum -c SHA256SUMS.txt</code> or by uploading the ZIP to the TraceNet Evidence Vault.</p>
</body></html>"""
