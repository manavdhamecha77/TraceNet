"""Tests for the vehicle-plate pass, plate text search, OCR engine switching and result enrichment."""
import json
import os
from datetime import datetime, timezone
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

import app.detection.plate_detector as plate_detector_module
import app.detection.plate_ocr as plate_ocr
import app.detection.vehicle_plates as vp
from app.db.models import Alert, Camera, LicensePlateDetection, Tracklet, VideoAsset
from app.detection.plate_detector import PlateDetector
from app.search.plate_matching import levenshtein, match_distance, normalize, substring_distance
from test_plate_ocr import _Box, _Result, _plate_image

PLATE_TEXT = "GJ05AB1234"


# ------------------------------------------------------------------ matching maths
def test_normalize_ignores_case_spacing_and_punctuation():
    assert normalize(" gj-05 ab.1234 ") == PLATE_TEXT


@pytest.mark.parametrize("a,b,expected", [
    ("GJ05AB1234", "GJ05AB1234", 0),
    ("GJ05AB1234", "GJO5AB1234", 1),      # O instead of 0: the classic OCR slip
    ("GJ05AB1234", "GJ05AB123", 1),       # dropped character
    ("GJ05AB1234", "GJ06AB1239", 2),
    ("GJ05AB1234", "MH12DE1433", 8),
    ("", "ABC", 3),
])
def test_levenshtein(a, b, expected):
    assert levenshtein(a, b) == expected


def test_substring_distance_finds_partial_text():
    assert substring_distance("AB12", "GJ05AB1234") == 0
    assert substring_distance("AB13", "GJ05AB1234") == 1
    assert substring_distance("ZZZZ", "GJ05AB1234") == 4


def test_match_distance_modes():
    assert match_distance("GJ05AB1234", "GJ05AB1234", "exact", False, 3) == 0
    assert match_distance("GJ05AB1234", "GJO5AB1234", "exact", False, 3) is None
    assert match_distance("GJ05AB1234", "GJO5AB1234", "estimate", False, 3) == 1
    assert match_distance("GJ05AB1234", "GJ06AB1239", "estimate", False, 1) is None
    assert match_distance("GJ05AB1234", "GJ06AB1239", "estimate", False, 3) == 2
    assert match_distance("1234", "GJ05AB1234", "exact", True, 3) == 0       # partial exact = contains
    assert match_distance("1234", "GJ05AB1234", "exact", False, 3) is None   # whole-plate exact is not
    assert match_distance("AB1239", "GJ05AB1234", "estimate", True, 1) == 1


# ------------------------------------------------------------------ synthetic scene
CLEAN = _plate_image([PLATE_TEXT])
BLURRED = cv2.GaussianBlur(CLEAN, (31, 31), 12)


class FakeLocaliser:
    """Plate 'model' that finds our two known plate images by template matching inside the crop."""

    def predict(self, source, **kwargs):
        boxes = []
        for template in (CLEAN, BLURRED):
            th, tw = template.shape[:2]
            if source.shape[0] < th or source.shape[1] < tw:
                continue
            scores = cv2.matchTemplate(source, template, cv2.TM_CCOEFF_NORMED)
            _, best, _, loc = cv2.minMaxLoc(scores)
            if best > 0.95:
                boxes.append(_Box([loc[0], loc[1], loc[0] + tw, loc[1] + th], 0.9))
        return [_Result(boxes)]


class FakeEngine:
    key, engine_name, loaded = "fake", "Fake OCR", True

    def load(self):
        pass

    def read(self, cutout):
        if cutout.shape == CLEAN.shape and np.abs(cutout.astype(int) - CLEAN.astype(int)).mean() < 5:
            return PLATE_TEXT, 0.95
        return "", 0.0


VEHICLES = {  # tracker_id: (class, bbox)
    1: ("Car", [20, 20, 330, 260]),
    2: ("Three-wheeler", [400, 20, 740, 260]),
    3: ("Two-wheeler", [20, 330, 200, 560]),
    4: ("Pedestrian", [400, 330, 500, 560]),
}


@pytest.fixture
def scene(db, sample_camera_data, tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(vp, "get_data_path", lambda rel: str(data_dir / rel))

    frame = np.full((600, 800, 3), 90, np.uint8)
    frame[170:240, 45:305] = CLEAN                       # car with a readable plate
    frame[170:240, 430:690] = BLURRED                    # three-wheeler with an unreadable plate
    video_path = tmp_path / "scene.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (800, 600))
    for _ in range(30):
        writer.write(frame)
    writer.release()

    frames = [
        {"frame_index": i, "timestamp_seconds": i / 10, "detections": [
            {"tracker_id": tid, "class_name": cls, "object_type": cls.lower(), "confidence": 0.9, "bbox": bbox}
            for tid, (cls, bbox) in VEHICLES.items()
        ]}
        for i in range(30)
    ]
    tracklets = [
        {"tracklet_id": f"vid1_trk_{tid}", "tracker_id": tid, "class_name": cls, "object_type": cls.lower(),
         "camera_id": "CAM_001", "video_id": "vid1", "frame_start": 0, "frame_end": 29,
         "timestamp_start_seconds": 0.0, "timestamp_end_seconds": 2.9, "detection_count": 30,
         "mean_confidence": 0.9, "best_bbox": bbox, "best_crop_path": None}
        for tid, (cls, bbox) in VEHICLES.items()
    ]
    det_dir = data_dir / "processed" / "detections" / "vid1"
    det_dir.mkdir(parents=True)
    (det_dir / "detections.json").write_text(json.dumps({"fps": 10, "frame_detections": frames, "tracklets": tracklets}))

    db.add(Camera(**sample_camera_data))
    db.add(VideoAsset(
        id="vid1", camera_id="CAM_001", original_filename="scene.mp4", standardized_filename="scene.mp4",
        intake_sha256="a" * 64, processing_status="complete",
        start_time=datetime(2026, 10, 8, 20, 0, tzinfo=timezone.utc),
    ))
    for tid, (cls, bbox) in VEHICLES.items():
        db.add(Tracklet(
            id=f"vid1_trk_{tid}", video_id="vid1", tracker_id=tid, object_type=cls.lower(), class_name=cls,
            camera_id="CAM_001", frame_start=0, frame_end=29, timestamp_start_seconds=0.0,
            timestamp_end_seconds=2.9, detection_count=30, mean_confidence=0.9, best_bbox=json.dumps(bbox),
        ))
    db.commit()

    monkeypatch.setattr(plate_detector_module, "get_ocr_engine", lambda *a, **k: FakeEngine())
    detector = PlateDetector()
    detector.model = FakeLocaliser()      # skip YOLO weight loading
    detector.vehicle_model = None
    return SimpleNamespace(video_path=str(video_path), detector=detector, data_dir=data_dir)


def _run(scene, db, **kw):
    return vp.VehiclePlateService(scene.detector).process_video("vid1", db, video_path=scene.video_path, **kw)


# ------------------------------------------------------------------ the pass
def test_every_vehicle_gets_a_status_and_people_are_skipped(scene, db):
    summary = _run(scene, db)
    assert summary["vehicles"] == 3 and summary["processed"] == 3
    assert (summary["read"], summary["blurry"], summary["not_detected"]) == (1, 1, 1)

    rows = {r.tracklet_id: r for r in db.query(LicensePlateDetection).all()}
    assert set(rows) == {"vid1_trk_1", "vid1_trk_2", "vid1_trk_3"}   # the pedestrian has no row

    car, auto, bike = rows["vid1_trk_1"], rows["vid1_trk_2"], rows["vid1_trk_3"]
    assert (car.plate_status, car.plate_text) == ("read", PLATE_TEXT)
    assert car.ocr_confidence == 0.95 and car.cutout_path and os.path.exists(car.cutout_path)
    assert car.bbox != "[]"
    assert (auto.plate_status, auto.plate_text) == ("blurry", "")
    assert auto.cutout_path and os.path.exists(auto.cutout_path)     # a human can still look at it
    assert (bike.plate_status, bike.plate_text, bike.cutout_path) == ("not_detected", "", None)


def test_rerun_is_idempotent_and_force_rereads(scene, db):
    _run(scene, db)
    second = _run(scene, db)
    assert second["processed"] == 0 and second["skipped"] == 3
    assert db.query(LicensePlateDetection).count() == 3

    forced = _run(scene, db, force=True)
    assert forced["processed"] == 3
    assert db.query(LicensePlateDetection).count() == 3              # rows are updated, not duplicated


def test_watchlist_match_raises_one_alert_per_vehicle(scene, db):
    from app.db.models import PlateWatchlistEntry
    db.add(PlateWatchlistEntry(id="w1", plate_number=PLATE_TEXT, reason="stolen"))
    db.commit()

    summary = _run(scene, db)
    assert summary["watchlist_hits"] == 1
    alert = db.query(Alert).filter(Alert.alert_type == "anpr_watchlist").one()
    assert alert.tracklet_id == "vid1_trk_1"
    assert db.query(LicensePlateDetection).filter_by(tracklet_id="vid1_trk_1").one().is_watchlisted

    _run(scene, db, force=True)                                       # re-read must not alert again
    assert db.query(Alert).filter(Alert.alert_type == "anpr_watchlist").count() == 1


def test_delete_removes_rows_and_cutouts(scene, db):
    _run(scene, db)
    assert os.path.isdir(vp.plates_dir("vid1"))
    assert vp.delete_plates_for_video(db, "vid1") == 3
    db.commit()
    assert not os.path.exists(vp.plates_dir("vid1"))


# ------------------------------------------------------------------ API
def test_plate_text_search_exact_estimate_partial(client, scene, db):
    _run(scene, db)

    exact = client.get("/api/v1/anpr/search", params={"q": "gj 05-ab1234", "mode": "exact"}).json()
    assert exact["total"] == 1 and exact["results"][0]["distance"] == 0
    hit = exact["results"][0]
    assert hit["plate"]["plate_text"] == PLATE_TEXT and hit["plate"]["cutout_url"].startswith("/data/")
    assert hit["vehicle"]["class_name"] == "Car" and hit["vehicle"]["camera_id"] == "CAM_001"

    miss = client.get("/api/v1/anpr/search", params={"q": "GJO5AB1234", "mode": "exact"}).json()
    assert miss["total"] == 0

    near = client.get("/api/v1/anpr/search", params={"q": "GJO5AB1234", "mode": "estimate", "max_distance": 3}).json()
    assert near["total"] == 1 and near["results"][0]["distance"] == 1 and near["counts_by_distance"] == {"1": 1}

    too_far = client.get("/api/v1/anpr/search", params={"q": "MH12DE1433", "mode": "estimate"}).json()
    assert too_far["total"] == 0

    assert client.get("/api/v1/anpr/search", params={"q": "AB12", "mode": "exact"}).json()["total"] == 0
    assert client.get("/api/v1/anpr/search", params={"q": "AB12", "mode": "exact", "partial": True}).json()["total"] == 1
    assert client.get("/api/v1/anpr/search", params={"q": ""}).json()["results"] == []


def test_unreadable_vehicles_can_be_browsed(client, scene, db):
    _run(scene, db)
    blurry = client.get("/api/v1/anpr/vehicles", params={"plate_status": "blurry"}).json()
    assert blurry["total"] == 1 and blurry["results"][0]["vehicle"]["class_name"] == "Three-wheeler"
    assert blurry["results"][0]["plate"]["cutout_url"]
    none = client.get("/api/v1/anpr/vehicles", params={"plate_status": "not_detected"}).json()
    assert none["results"][0]["vehicle"]["class_name"] == "Two-wheeler"

    stats = client.get("/api/v1/anpr/statistics").json()
    assert (stats["total_detections"], stats["blurry_plates"], stats["vehicles_without_plate"]) == (1, 1, 1)
    # the legacy detections list only shows recognised plates
    assert client.get("/api/v1/anpr/detections").json()["total"] == 1


# ------------------------------------------------------------------ search-result enrichment
def test_search_results_carry_plate_info(db, scene, monkeypatch):
    import app.search.query_engine as qe

    _run(scene, db)

    class FakeQdrant:
        def collection_exists(self, name):
            return True

        def get_collection(self, name):
            return SimpleNamespace(config=SimpleNamespace(params=SimpleNamespace(vectors=SimpleNamespace(size=4))))

        def query_points(self, **kw):
            pts = [SimpleNamespace(score=0.3 - i * 0.01, payload={"tracklet_id": f"vid1_trk_{i + 1}"}) for i in range(4)]
            return SimpleNamespace(points=pts)

    monkeypatch.setattr(qe, "get_qdrant_client", lambda: FakeQdrant())
    results = {
        r["tracklet_id"]: r
        for r in qe.QueryEngine().search_by_vector(db=db, query_vector=[0.1, 0.2, 0.3, 0.4], query_label="x", top_k=10)
    }
    assert results["vid1_trk_1"]["plate"]["status"] == "read" and results["vid1_trk_1"]["plate"]["text"] == PLATE_TEXT
    assert results["vid1_trk_2"]["plate"]["status"] == "blurry" and results["vid1_trk_2"]["plate"]["text"] == ""
    assert results["vid1_trk_3"]["plate"]["status"] == "not_detected"
    assert results["vid1_trk_4"]["plate"] is None                      # people have no plate


# ------------------------------------------------------------------ switchable OCR engine
@pytest.fixture
def isolated_ocr_config(tmp_path, monkeypatch):
    monkeypatch.setattr(plate_ocr, "_config_path", lambda: str(tmp_path / "anpr_config.json"))
    monkeypatch.setattr(plate_ocr, "_active_engine", None)
    yield tmp_path / "anpr_config.json"
    plate_ocr._active_engine = None


def test_ocr_engine_defaults_to_paddle_and_lists_both(client, isolated_ocr_config):
    config = client.get("/api/v1/anpr/ocr/config").json()
    assert config["active"] == "paddleocr"
    assert {e["key"] for e in config["engines"]} == {"paddleocr", "fast-plate-ocr"}
    assert [e["key"] for e in config["engines"] if e["active"]] == ["paddleocr"]


def test_ocr_engine_switch_is_global_and_persisted(client, isolated_ocr_config, monkeypatch):
    class Stub(plate_ocr.PlateOCREngine):
        key, engine_name, description, lightweight = "fast-plate-ocr", "Stub", "stub", True
        loaded = True

        def is_available(self):
            return True, ""

        def load(self):
            pass

    monkeypatch.setitem(plate_ocr._ENGINES, "fast-plate-ocr", Stub())
    res = client.post("/api/v1/anpr/ocr/switch", json={"engine": "fast-plate-ocr"})
    assert res.status_code == 200 and res.json()["active"] == "fast-plate-ocr"
    assert json.loads(isolated_ocr_config.read_text())["ocr_engine"] == "fast-plate-ocr"
    assert plate_ocr.get_active_engine_name() == "fast-plate-ocr"
    assert client.get("/api/v1/anpr/model/status").json()["ocr_engine"] == "fast-plate-ocr"

    # a fresh process reads the persisted choice
    monkeypatch.setattr(plate_ocr, "_active_engine", None)
    assert plate_ocr.get_active_engine_name() == "fast-plate-ocr"


def test_ocr_switch_rejects_unknown_and_reverts_on_load_failure(client, isolated_ocr_config, monkeypatch):
    assert client.post("/api/v1/anpr/ocr/switch", json={"engine": "nope"}).status_code == 400

    class Broken(plate_ocr.PlateOCREngine):
        key, engine_name, description, lightweight = "fast-plate-ocr", "Broken", "", True
        loaded = False

        def is_available(self):
            return True, ""

        def load(self):
            raise RuntimeError("weights download failed")

    monkeypatch.setitem(plate_ocr._ENGINES, "fast-plate-ocr", Broken())
    res = client.post("/api/v1/anpr/ocr/switch", json={"engine": "fast-plate-ocr"})
    assert res.status_code == 500 and "weights download failed" in res.json()["detail"]
    assert plate_ocr.get_active_engine_name() == "paddleocr"           # reverted


def test_real_lightweight_engine_reads_a_plate():
    engine = plate_ocr.FastPlateOCR()
    available, _ = engine.is_available()
    if not available:
        pytest.skip("fast-plate-ocr not installed")
    text, score = engine.read(CLEAN)
    # the lightweight engine is less accurate (O vs 0, G vs S); the edit-distance search absorbs such slips
    assert levenshtein(text, PLATE_TEXT) <= 2 and score > 0.5
