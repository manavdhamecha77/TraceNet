"""Journey reconstruction on a synthetic camera network with a known ground-truth route."""

import random
from datetime import datetime
from types import SimpleNamespace

import pytest

import app.analytics.trajectory_engine as te
from app.db.models import CameraProfile, Tracklet, VideoAsset

START = datetime(2026, 7, 10, 10, 0, 0)
# ~500 m apart in a line (0.0045 deg latitude), plus one camera ~50 km away
CAMERAS = {"CAM_A": (21.0000, 72.0), "CAM_B": (21.0045, 72.0), "CAM_C": (21.0090, 72.0), "CAM_FAR": (21.45, 72.0)}


class FakeIndex:
    """Stands in for the Qdrant-backed vector index: fixed similarity scores per point."""

    def __init__(self, scores):
        self.scores = scores
        self.client = self

    def get_vector_by_point_id(self, point_id):
        return [1.0, 0.0]

    def query_points(self, collection_name, query, query_filter=None, limit=100, with_payload=False):
        ranked = sorted(self.scores.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        return SimpleNamespace(points=[SimpleNamespace(id=pid, score=s) for pid, s in ranked])


def _network(db):
    for cam_id, (lat, lon) in CAMERAS.items():
        db.add(CameraProfile(camera_id=cam_id, name=cam_id, latitude=lat, longitude=lon, adjacency="[]"))
        db.add(VideoAsset(id=f"v_{cam_id}", camera_id=cam_id, original_filename="x.mp4",
                          standardized_filename="x.mp4", intake_sha256=cam_id, start_time=START))
    db.add(VideoAsset(id="v_target", camera_id="CAM_A", original_filename="t.mp4",
                      standardized_filename="t.mp4", intake_sha256="target", start_time=START))
    db.commit()


def _tracklet(db, tid, video_id, camera_id, t):
    db.add(Tracklet(id=tid, video_id=video_id, tracker_id=1, object_type="person", class_name="person",
                    camera_id=camera_id, frame_start=0, frame_end=10, timestamp_start_seconds=t,
                    timestamp_end_seconds=t + 5, detection_count=10, mean_confidence=0.9,
                    best_bbox="[0,0,1,1]", qdrant_point_id=tid))


def _engine(db, monkeypatch, scores):
    monkeypatch.setattr(te, "get_vector_index", lambda: FakeIndex(scores))
    return te.TrajectoryEngine(db)


def _lookalikes(db, scores, n=40, seed=3):
    rng = random.Random(seed)
    for i in range(n):
        cam = ["CAM_A", "CAM_B", "CAM_C"][i % 3]
        tid = f"look_{i}"
        _tracklet(db, tid, f"v_{cam}", cam, rng.uniform(0, 2000))
        scores[tid] = rng.uniform(0.84, 0.88)  # CLIP-typical similarity between different people


@pytest.fixture
def network(db):
    _network(db)
    _tracklet(db, "target", "v_target", "CAM_A", 0.0)
    return db


def test_finds_true_route_and_ignores_lookalikes_and_impossible_hops(network, monkeypatch):
    db, scores = network, {}
    _lookalikes(db, scores)
    _tracklet(db, "true_B", "v_CAM_B", "CAM_B", 400.0)     # 500 m in 400 s: walking pace
    _tracklet(db, "true_B_split", "v_CAM_B", "CAM_B", 405.0)  # same pass, split track: not a competitor
    _tracklet(db, "true_C", "v_CAM_C", "CAM_C", 800.0)
    _tracklet(db, "teleport", "v_CAM_FAR", "CAM_FAR", 100.0)  # very similar but 50 km in 100 s
    scores.update({"true_B": 0.975, "true_B_split": 0.970, "true_C": 0.968, "teleport": 0.99})
    db.commit()

    result = _engine(db, monkeypatch, scores).reconstruct_trajectory(target_tracklet_id="target")

    route = [s["tracklet_id"] for s in result["journey_steps"]]
    assert route == ["target", "true_B", "true_C"]
    assert result["journey_steps"][0]["is_origin"] is True
    assert all(s["distinctiveness_z"] >= te.MIN_DISTINCTIVENESS_Z for s in result["journey_steps"][1:])
    assert result["total_duration_seconds"] == 800.0
    assert 900 < result["total_distance_meters"] < 1100


def test_lookalikes_only_gives_origin_only_with_reasons(network, monkeypatch):
    db, scores = network, {}
    _lookalikes(db, scores)
    db.commit()

    result = _engine(db, monkeypatch, scores).reconstruct_trajectory(target_tracklet_id="target")

    assert [s["tracklet_id"] for s in result["journey_steps"]] == ["target"]
    assert {r["camera_id"] for r in result["rejected_cameras"]} == {"CAM_A", "CAM_B", "CAM_C"}
    assert all(r["reason"] for r in result["rejected_cameras"])


def test_two_equally_good_people_in_one_camera_is_ambiguous(network, monkeypatch):
    db, scores = network, {}
    _lookalikes(db, scores)
    _tracklet(db, "cand_1", "v_CAM_B", "CAM_B", 400.0)
    _tracklet(db, "cand_2", "v_CAM_B", "CAM_B", 900.0)  # different pass, same score: cannot tell them apart
    scores.update({"cand_1": 0.970, "cand_2": 0.968})
    db.commit()

    result = _engine(db, monkeypatch, scores).reconstruct_trajectory(target_tracklet_id="target")

    assert [s["tracklet_id"] for s in result["journey_steps"]] == ["target"]
    reasons = {r["camera_id"]: r["reason"] for r in result["rejected_cameras"]}
    assert reasons["CAM_B"].startswith("ambiguous")
