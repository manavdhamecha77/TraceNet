"""Tests for colour/type attribute extraction, query parsing and attribute evaluation."""
import cv2
import numpy as np
import pytest

from app.attributes.color_extractor import (
    canonical_object_type,
    canonical_vehicle_type,
    dominant_colors,
    extract_tracklet_attributes,
)
from app.search.attribute_parser import evaluate_constraints, parse_query, verdict_counts

BGR = {
    "red": (0, 0, 220), "blue": (220, 40, 0), "green": (0, 180, 0), "yellow": (0, 230, 230),
    "black": (10, 10, 10), "white": (250, 250, 250), "gray": (128, 128, 128),
    "orange": (0, 140, 255), "purple": (160, 0, 140), "pink": (200, 170, 255),
}


def solid(color, h=40, w=40):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = BGR[color]
    return img


@pytest.mark.parametrize("name", list(BGR))
def test_dominant_color_of_solid_patch(name):
    assert dominant_colors(solid(name)) == [name]


def test_person_upper_and_lower_regions(tmp_path):
    img = np.zeros((200, 80, 3), dtype=np.uint8)
    img[:] = BGR["white"]
    img[30:105] = BGR["red"]      # torso band
    img[112:185] = BGR["blue"]    # legs band
    path = tmp_path / "person.jpg"
    cv2.imwrite(str(path), img)

    attrs = extract_tracklet_attributes(str(path), "pedestrain")
    assert attrs["kind"] == "person"
    assert attrs["upper_colors"][0] == "red"
    assert attrs["lower_colors"][0] == "blue"
    assert {"red", "blue"} <= set(attrs["colors"])


def test_vehicle_body_colour_and_type(tmp_path):
    path = tmp_path / "car.jpg"
    cv2.imwrite(str(path), solid("red", 80, 120))
    attrs = extract_tracklet_attributes(str(path), "car", caption="a red hatchback parked on the street")
    assert attrs["kind"] == "vehicle"
    assert attrs["vehicle_type"] == "car"
    assert attrs["body_style"] == "hatchback"
    assert attrs["body_colors"] == ["red"]


def test_missing_crop_does_not_raise():
    attrs = extract_tracklet_attributes("does/not/exist.jpg", "two-wheeler")
    assert attrs["color_status"] == "unavailable"
    assert attrs["vehicle_type"] == "motorcycle"


def test_legacy_detector_classes_are_canonicalised():
    assert canonical_object_type("pedestrain") == "person"
    assert canonical_object_type("two-wheeler") == "vehicle"
    assert canonical_object_type("object") == "object"
    assert canonical_vehicle_type("two-wheeler") == "motorcycle"


def test_parse_clothing_query_marks_headwear_unverifiable():
    parsed = {(c.kind, c.value, c.region): c for c in parse_query("Find a male wearing a yellow t-shirt and black cap")}
    assert ("color", "yellow", "upper") in parsed and parsed[("color", "yellow", "upper")].verifiable
    assert ("color", "black", "head") in parsed and not parsed[("color", "black", "head")].verifiable
    assert ("object_kind", "person", None) in parsed


def test_parse_vehicle_query():
    keys = {(c.kind, c.value, c.region) for c in parse_query("Show all red hatchbacks near the station")}
    assert ("color", "red", "body") in keys
    assert ("vehicle_type", "car", "body") in keys
    assert ("body_style", "hatchback", "body") in keys


def test_parse_shared_garment_for_two_colours():
    keys = {(c.kind, c.value, c.region) for c in parse_query("red and black jacket")}
    assert ("color", "red", "upper") in keys and ("color", "black", "upper") in keys


def test_evaluate_matched_mismatched_unverified():
    attrs = {"kind": "person", "upper_colors": ["yellow"], "lower_colors": ["blue"], "colors": ["yellow", "blue"], "color_status": "ok"}
    verdicts = evaluate_constraints(parse_query("yellow t-shirt and black cap and red jeans"), attrs, "pedestrain", "person")
    by = {(v["value"], v["region"]): v["verdict"] for v in verdicts if v["kind"] == "color"}
    assert by[("yellow", "upper")] == "matched"
    assert by[("black", "head")] == "unverified"
    assert by[("red", "lower")] == "mismatched"
    assert verdict_counts(verdicts)[:2] == (1 + 0, 1)  # one matched colour (+0 object_kind unknown->matched below)


def test_vehicle_constraint_rejects_person():
    attrs = {"kind": "person", "color_status": "ok", "colors": ["red"], "upper_colors": ["red"]}
    verdicts = evaluate_constraints(parse_query("red car"), attrs, "pedestrain", "person")
    assert any(v["kind"] == "vehicle_type" and v["verdict"] == "mismatched" for v in verdicts)


def test_missing_attributes_are_unverified_not_mismatched():
    verdicts = evaluate_constraints(parse_query("red jacket"), {}, "pedestrain", "person")
    assert verdicts[0]["verdict"] == "unverified"


def test_parse_endpoint(client):
    res = client.get("/api/v1/search/parse", params={"q": "man in yellow t-shirt and black cap"})
    assert res.status_code == 200
    body = res.json()
    assert any(c["value"] == "yellow" for c in body["verifiable"])
    assert any(c["value"] == "black" and c["region"] == "head" for c in body["unverifiable"])


# ---------------------------------------------------------------- query engine integration
class _FakeQdrant:
    def __init__(self, points):
        self._points = points

    def collection_exists(self, name):
        return True

    def get_collection(self, name):
        from types import SimpleNamespace
        return SimpleNamespace(config=SimpleNamespace(params=SimpleNamespace(vectors=SimpleNamespace(size=4))))

    def query_points(self, **kwargs):
        from types import SimpleNamespace
        return SimpleNamespace(points=self._points)


@pytest.fixture
def two_people(db, sample_camera_data, monkeypatch):
    import json
    from datetime import datetime, timezone
    from types import SimpleNamespace
    import app.search.query_engine as qe
    from app.db.models import Camera, Tracklet, VideoAsset

    db.add(Camera(**sample_camera_data))
    db.add(VideoAsset(
        id="v1", camera_id="CAM_001", original_filename="a.mp4", standardized_filename="a.mp4",
        intake_sha256="a" * 64, processing_status="complete",
        start_time=datetime(2026, 10, 8, 20, 0, tzinfo=timezone.utc),
    ))
    for tid, upper in (("blue_guy", "blue"), ("red_guy", "red")):
        db.add(Tracklet(
            id=tid, video_id="v1", tracker_id=1, object_type="person", class_name="pedestrain",
            camera_id="CAM_001", frame_start=0, frame_end=10, timestamp_start_seconds=1.0,
            timestamp_end_seconds=2.0, detection_count=5, mean_confidence=0.9, best_bbox="[0,0,1,1]",
            attributes=json.dumps({"caption": "", "kind": "person", "upper_colors": [upper],
                                   "lower_colors": ["black"], "colors": [upper, "black"], "color_status": "ok"}),
        ))
    db.commit()
    # visually the blue person is (slightly) the better CLIP match
    points = [
        SimpleNamespace(score=0.30, payload={"tracklet_id": "blue_guy"}),
        SimpleNamespace(score=0.28, payload={"tracklet_id": "red_guy"}),
    ]
    monkeypatch.setattr(qe, "get_qdrant_client", lambda: _FakeQdrant(points))
    return qe


def _search(qe, db, mode, **kw):
    from app.search.attribute_parser import merge_constraints, parse_query
    engine = qe.QueryEngine()
    return engine.search_by_vector(
        db=db, query_vector=[0.1, 0.2, 0.3, 0.4], query_label="man in red jacket",
        constraints=merge_constraints(parse_query("man in red jacket")), attribute_mode=mode, **kw,
    )


def test_boost_reranks_by_verified_colour(db, two_people):
    results = _search(two_people, db, "boost")
    assert [r["tracklet_id"] for r in results] == ["red_guy", "blue_guy"]
    red = results[0]
    labels = [e["label"] for e in red["explanation"]["evidence"]]
    assert "Attribute verified" in labels
    assert next(e for e in results[1]["explanation"]["evidence"] if e["label"].startswith("Attribute contradicted"))
    assert red["explanation"]["final_score_percent"] > red["explanation"]["evidence"][0]["value_percent"]


def test_strict_drops_contradicted_results(db, two_people):
    assert [r["tracklet_id"] for r in _search(two_people, db, "strict")] == ["red_guy"]


def test_off_keeps_pure_visual_ranking(db, two_people):
    assert [r["tracklet_id"] for r in _search(two_people, db, "off")] == ["blue_guy", "red_guy"]


def test_search_endpoint_rejects_bad_attribute_mode(client):
    res = client.post("/api/v1/search", json={"query": "red car", "attribute_mode": "nonsense"})
    assert res.status_code == 422
