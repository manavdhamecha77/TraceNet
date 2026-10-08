"""End-to-end tests for sealed forensic export bundles and integrity verification."""
import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone

import cv2
import numpy as np
import pytest

import app.api.exports as exports_api
import app.export.forensic_export as fx
from app.db.models import Camera, SearchLog, Tracklet, VideoAsset


@pytest.fixture
def evidence(db, sample_camera_data, tmp_path, monkeypatch):
    """A camera, a real (synthetic) 4 s video, and one tracklet with a crop image."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    def fake_data_path(rel):
        full = data_dir / rel
        return str(full)

    monkeypatch.setattr(fx, "get_data_path", fake_data_path)
    monkeypatch.setattr(exports_api, "get_data_path", fake_data_path)

    video_path = tmp_path / "source.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (320, 240))
    texture = np.random.RandomState(7).randint(0, 255, (240, 320, 3)).astype(np.uint8)
    for i in range(40):
        frame = texture.copy()
        cv2.rectangle(frame, (50 + i * 3, 80), (110 + i * 3, 200), (0, 0, 220), -1)
        writer.write(frame)
    writer.release()
    monkeypatch.setattr(fx, "resolve_standardized_video_path", lambda v: str(video_path))

    det_dir = data_dir / "processed" / "detections" / "vid1"
    det_dir.mkdir(parents=True)
    frames = [
        {"frame_index": i, "timestamp_seconds": i / 10, "detections": [
            {"tracker_id": 1, "confidence": 0.5 + (0.3 if i == 10 else 0.0), "bbox": [50 + 3 * i, 80, 110 + 3 * i, 200]}
        ]}
        for i in range(5, 31)
    ]
    (det_dir / "detections.json").write_text(json.dumps({"fps": 10, "model_path": "best.pt", "frame_detections": frames}))

    crop = tmp_path / "crop.jpg"
    cv2.imwrite(str(crop), np.full((120, 60, 3), (0, 0, 220), np.uint8))

    db.add(Camera(**sample_camera_data))
    video_sha = hashlib.sha256(video_path.read_bytes()).hexdigest()
    db.add(VideoAsset(
        id="vid1", camera_id="CAM_001", original_filename="raw.mp4", standardized_filename="source.mp4",
        intake_sha256="a" * 64, transcoded_sha256=video_sha, processing_status="complete",
        start_time=datetime(2026, 10, 8, 20, 0, 0, tzinfo=timezone.utc),
    ))
    db.add(Tracklet(
        id="vid1_trk_1", video_id="vid1", tracker_id=1, object_type="person", class_name="pedestrain",
        camera_id="CAM_001", frame_start=5, frame_end=30, timestamp_start_seconds=0.5,
        timestamp_end_seconds=3.0, detection_count=20, mean_confidence=0.8,
        best_bbox=json.dumps([60, 80, 120, 200]), best_crop_path=str(crop),
        attributes=json.dumps({"caption": "a person", "colors": ["red"]}),
    ))
    db.add(SearchLog(query_text="man in red", user_id="officer1", results_count=1))
    db.commit()
    return {"video_sha": video_sha}


def _payload(**over):
    body = {
        "items": [{"tracklet_id": "vid1_trk_1", "score": 0.42}],
        "query": "man in red",
        "filters": {"camera_ids": ["CAM_001"]},
        "case_reference": "FIR-2026-001",
        "operator": "officer1",
    }
    body.update(over)
    return body


def _rewrite_zip(src, dst, mutate):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            zout.writestr(info.filename, mutate(info.filename, data))


def test_export_bundle_contents_and_hashes(client, evidence, tmp_path):
    res = client.post("/api/v1/exports", json=_payload())
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["item_count"] == 1 and len(body["zip_sha256"]) == 64

    dl = client.get(body["download_url"])
    assert dl.status_code == 200
    assert hashlib.sha256(dl.content).hexdigest() == body["zip_sha256"] == dl.headers["x-content-sha256"]

    zpath = tmp_path / "bundle.zip"
    zpath.write_bytes(dl.content)
    with zipfile.ZipFile(zpath) as z:
        names = set(z.namelist())
        item = "items/001_vid1_trk_1"
        assert {"manifest.json", "SHA256SUMS.txt", "report.html",
                f"{item}/clip.mp4", f"{item}/annotated.jpg", f"{item}/crop.jpg", f"{item}/metadata.json"} <= names
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["created_by"] == "officer1" and manifest["case_reference"] == "FIR-2026-001"
        assert manifest["sources"][0]["integrity_status"] == "MATCH"
        events = [e["event"] for e in manifest["chain_of_custody"]]
        assert events == ["search_executed", "source_integrity_check", "export_created"]
        for entry in manifest["files"]:
            assert hashlib.sha256(z.read(entry["path"])).hexdigest() == entry["sha256"]
        assert hashlib.sha256(z.read("manifest.json")).hexdigest() == body["manifest_sha256"]
        # the clip must be a real, decodable H.264 video
        clip = tmp_path / "clip.mp4"
        clip.write_bytes(z.read(f"{item}/clip.mp4"))
        cap = cv2.VideoCapture(str(clip))
        assert cap.isOpened() and cap.read()[0]
        cap.release()
        assert "FIR-2026-001" in z.read("report.html").decode()

    # export hash is attached to the audit trail of the originating search
    assert client.get("/api/v1/search/logs").json()[0]["clip_export_hash"] == body["zip_sha256"]


def test_verify_detects_tampering(client, evidence, tmp_path):
    body = client.post("/api/v1/exports", json=_payload()).json()
    assert client.get(f"/api/v1/exports/{body['id']}/verify").json()["status"] == "VERIFIED"

    original = tmp_path / "orig.zip"
    original.write_bytes(client.get(body["download_url"]).content)

    # untouched copy verifies when uploaded
    with open(original, "rb") as fh:
        assert client.post("/api/v1/exports/verify-upload", files={"file": ("a.zip", fh)}).json()["status"] == "VERIFIED"

    # evidence file altered, hashes left alone -> TAMPERED
    altered = tmp_path / "altered.zip"
    _rewrite_zip(original, altered, lambda n, d: d + b"x" if n.endswith("crop.jpg") else d)
    with open(altered, "rb") as fh:
        result = client.post("/api/v1/exports/verify-upload", files={"file": ("a.zip", fh)}).json()
    assert result["status"] == "TAMPERED"
    assert any(m["path"].endswith("crop.jpg") for m in result["mismatches"])

    # attacker also fixes SHA256SUMS -> manifest hash no longer matches what we issued
    def forge(name, data):
        if name.endswith("crop.jpg"):
            return data + b"x"
        if name == "SHA256SUMS.txt":
            new = hashlib.sha256(zipfile.ZipFile(original).read(
                "items/001_vid1_trk_1/crop.jpg") + b"x").hexdigest()
            lines = [l for l in data.decode().splitlines()]
            return "\n".join(f"{new} *{l.split('*', 1)[1]}" if l.endswith("crop.jpg") else l for l in lines).encode() + b"\n"
        return data

    forged = tmp_path / "forged.zip"
    _rewrite_zip(original, forged, forge)
    with open(forged, "rb") as fh:
        result = client.post("/api/v1/exports/verify-upload", files={"file": ("a.zip", fh)}).json()
    assert result["status"] == "TAMPERED"  # manifest.json still lists the original crop hash

    # a non-bundle is rejected as invalid
    junk = tmp_path / "junk.zip"
    with zipfile.ZipFile(junk, "w") as z:
        z.writestr("hello.txt", "hi")
    with open(junk, "rb") as fh:
        assert client.post("/api/v1/exports/verify-upload", files={"file": ("a.zip", fh)}).json()["status"] == "INVALID"


def test_unregistered_bundle_is_flagged(client, evidence, tmp_path, db):
    body = client.post("/api/v1/exports", json=_payload()).json()
    path = tmp_path / "b.zip"
    path.write_bytes(client.get(body["download_url"]).content)
    from app.db.models import ForensicExport
    db.query(ForensicExport).delete()
    db.commit()
    with open(path, "rb") as fh:
        assert client.post("/api/v1/exports/verify-upload", files={"file": ("a.zip", fh)}).json()["status"] == "UNREGISTERED"


def test_blur_fails_closed_without_face_detector(client, evidence, monkeypatch):
    monkeypatch.setattr(fx.face_blur, "available_backend", lambda: None)
    res = client.post("/api/v1/exports", json=_payload(blur_faces=True))
    assert res.status_code == 409
    assert "no unredacted footage" in res.json()["detail"]


def test_blur_redacts_only_non_matched_faces(client, evidence, monkeypatch, tmp_path):
    other_face = (200, 100, 260, 160)   # outside the matched bbox [60,80,120,200]
    matched_face = (70, 90, 110, 130)   # inside the matched subject
    monkeypatch.setattr(fx.face_blur, "available_backend", lambda: "test-backend")
    monkeypatch.setattr(fx.face_blur, "detect_faces", lambda frame: [other_face, matched_face])

    res = client.post("/api/v1/exports", json=_payload(blur_faces=True))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["options"]["blur_non_matched_faces"] is True
    assert body["options"]["face_blur_method"] == "test-backend"

    path = tmp_path / "blur.zip"
    path.write_bytes(client.get(body["download_url"]).content)
    with zipfile.ZipFile(path) as z:
        meta = json.loads(z.read("items/001_vid1_trk_1/metadata.json"))
        assert meta["annotated_faces_redacted"] == 1       # the matched subject's face was left alone
        assert meta["clip_faces_redacted"] >= 1
        annotated = cv2.imdecode(np.frombuffer(z.read("items/001_vid1_trk_1/annotated.jpg"), np.uint8), 1)

    def detail(img, box):
        x1, y1, x2, y2 = box
        return float(img[y1 + 5:y2 - 5, x1 + 5:x2 - 5].std())

    texture = np.random.RandomState(7).randint(0, 255, (240, 320, 3)).astype(np.uint8)
    assert detail(annotated, other_face) < detail(texture, other_face) * 0.6   # pixelated -> detail destroyed


def test_request_validation(client, evidence):
    assert client.post("/api/v1/exports", json=_payload(items=[{"tracklet_id": "nope"}])).status_code == 404
    assert client.post("/api/v1/exports", json=_payload(items=[])).status_code == 422


def test_source_tamper_is_reported(client, evidence, db):
    video = db.query(VideoAsset).filter(VideoAsset.id == "vid1").first()
    video.transcoded_sha256 = "f" * 64
    db.commit()
    body = client.post("/api/v1/exports", json=_payload(include_clips=False)).json()
    verify_bundle_path = os.path.join(os.path.dirname(fx.export_zip_path(body["id"])), f"{body['id']}.zip")
    with zipfile.ZipFile(verify_bundle_path) as z:
        manifest = json.loads(z.read("manifest.json"))
    assert manifest["sources"][0]["integrity_status"] == "MISMATCH"
    assert any("MISMATCH" in w for w in manifest["warnings"])
