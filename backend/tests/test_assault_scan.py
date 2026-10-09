"""VideoMAE assault scan: alert recording, re-scan dedup, statistics, frame inspection from the saved timeline."""

import pytest

import app.api.assault_detection as assault_api
import app.detection.detector as detector_module
from app.cache.cache_manager import get_cache
from app.db.models import Alert, CameraProfile, VideoAsset


class FakeDetector:
    model_name = "OPear/videomae-large-finetuned-UCF-Crime"
    confidence_threshold = 0.6
    assault_classes = ["Assault", "Fighting", "Abuse", "Robbery", "Shooting"]
    labels = []
    device = "cpu"
    model = None

    def __init__(self, peak):
        self.peak = peak
        self.calls = 0

    def weights_available(self):
        return True

    def predict_with_frames(self, video_path, **_):
        self.calls += 1
        windows = [
            {"frame_number": 20, "timestamp_seconds": 1.0, "start_seconds": 0.0, "end_seconds": 2.0,
             "class": "Fighting", "confidence": 0.1, "top_label": "Normal_Videos_event"},
            {"frame_number": 60, "timestamp_seconds": 3.0, "start_seconds": 2.0, "end_seconds": 4.0,
             "class": "Fighting", "confidence": self.peak, "top_label": "Fighting"},
        ]
        has = self.peak >= self.confidence_threshold
        return {"has_assault": has, "assault_type": "Fighting" if has else "normal", "confidence": self.peak,
                "peak_timestamp_seconds": 3.0, "peak_window": [2.0, 4.0], "frame_results": windows,
                "frames_analyzed": 2, "windows_flagged": int(has)}


@pytest.fixture
def scene(db, monkeypatch, tmp_path):
    get_cache().clear()
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"x")
    monkeypatch.setattr(detector_module, "resolve_standardized_video_path", lambda video, fetch=True: str(clip))
    db.add(CameraProfile(camera_id="CAM_A", name="Gate", adjacency="[]"))
    db.add(VideoAsset(id="vid_1", camera_id="CAM_A", original_filename="a.mp4", standardized_filename="a.mp4", intake_sha256="0" * 64,
                      processing_status="complete"))
    db.commit()

    def use(peak):
        fake = FakeDetector(peak)
        monkeypatch.setattr(assault_api, "get_assault_detector", lambda: fake)
        import app.api.frame_inspection as fi
        monkeypatch.setattr(fi, "get_assault_detector", lambda: fake)
        return fake

    return db, use


def test_violent_scan_records_one_alert_with_video_and_timeline(client, scene):
    db, use = scene
    use(0.91)
    body = {"video_id": "vid_1", "camera_id": "CAM_A"}
    r = client.post("/api/v1/assault-detection/analyze-video", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["has_assault"] and data["assault_type"] == "Fighting" and data["alert_id"]
    assert data["peak_timestamp_seconds"] == 3.0 and len(data["windows"]) == 2

    alert = db.query(Alert).filter(Alert.alert_type == "assault").one()
    assert alert.video_id == "vid_1" and alert.camera_id == "CAM_A"

    # a re-scan refreshes the same alert instead of adding another
    use(0.95)
    assert client.post("/api/v1/assault-detection/analyze-video", json=body).json()["alert_id"] == alert.id
    assert db.query(Alert).filter(Alert.alert_type == "assault").count() == 1

    listed = client.get("/api/v1/assault-detection/alerts").json()["alerts"][0]
    assert listed["video_id"] == "vid_1" and listed["assault_type"] == "Fighting" and listed["confidence"] == 0.95

    stats = client.get("/api/v1/assault-detection/statistics").json()
    assert stats["assaults_detected"] == 1 and stats["assault_types"] == {"Fighting": 1}
    assert stats["high_confidence_assaults"] == 1


def test_frame_inspection_uses_saved_windows_without_rescanning(client, scene):
    db, use = scene
    fake = use(0.91)
    alert_id = client.post("/api/v1/assault-detection/analyze-video",
                           json={"video_id": "vid_1", "camera_id": "CAM_A"}).json()["alert_id"]
    r = client.get(f"/api/v1/frame-inspection/alert/{alert_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["video_id"] == "vid_1" and data["has_assault"]
    assert [f["timestamp_seconds"] for f in data["detected_frames"]] == [3.0]  # only windows above 30 %
    assert data["detected_frames"][0]["is_key_frame"]
    assert fake.calls == 1  # no second VideoMAE pass


def test_normal_scan_raises_no_alert(client, scene):
    db, use = scene
    use(0.2)
    data = client.post("/api/v1/assault-detection/analyze-video",
                       json={"video_id": "vid_1", "camera_id": "CAM_A"}).json()
    assert not data["has_assault"] and data["alert_id"] is None and not data["alert_created"]
    assert db.query(Alert).filter(Alert.alert_type == "assault").count() == 0


def test_unknown_video_is_404(client, scene):
    assert client.post("/api/v1/assault-detection/analyze-video",
                       json={"video_id": "nope", "camera_id": "CAM_A"}).status_code == 404
