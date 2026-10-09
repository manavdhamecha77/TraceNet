"""The VideoMAE assault classifier is a registry model, but never a frame detector."""

import json

import pytest

import app.detection.assault_detector as assault_module
from app.db.models import CameraProfile, MLModel, VideoAsset
from app.detection.detector import ingest_detector_id, is_detector_model, resolve_camera_detection_model


@pytest.fixture
def registry(db, tmp_path, monkeypatch):
    weights = tmp_path / "models" / "assault_videomae"
    weights.mkdir(parents=True)
    (weights / "model.safetensors").write_bytes(b"x")
    (weights / "config.json").write_text(json.dumps({"id2label": {"0": "Abuse", "1": "Arrest", "2": "Fighting"}}))
    monkeypatch.setattr(assault_module, "get_data_path", lambda rel="": str(tmp_path / rel))
    db.add(MLModel(id="yolo-general", name="Traffic", file_path="models/traffic.pt", model_type="YOLOv8",
                   category="general", is_default=True, classes=json.dumps(["Car", "Pedestrian"])))
    db.add(MLModel(id="yolo-theft", name="Theft", file_path="models/theft.pt", model_type="YOLOv11",
                   category="theft", is_default=True, classes="[]"))
    db.commit()
    return db


def test_registration_is_idempotent_and_reads_labels(registry):
    assert assault_module.register_in_registry(registry) is True
    assert assault_module.register_in_registry(registry) is False
    row = registry.get(MLModel, assault_module.REGISTRY_ID)
    assert row.model_type == "VideoMAE" and row.category == "assault" and row.is_default
    assert json.loads(row.classes) == ["Abuse", "Arrest", "Fighting"]
    assert not is_detector_model(row) and is_detector_model(registry.get(MLModel, "yolo-general"))


def test_classifier_never_becomes_the_ingest_detector(registry, monkeypatch):
    assault_module.register_in_registry(registry)
    import app.storage.media as media
    monkeypatch.setattr(media, "resolve_model_file", lambda p: f"/weights/{p}")
    cam = CameraProfile(camera_id="C1", name="Gate", adjacency="[]", model_id="yolo-general",
                        assault_model_id=assault_module.REGISTRY_ID)
    registry.add(cam)
    registry.commit()
    path, model_id = resolve_camera_detection_model(registry, cam)
    assert model_id == "yolo-general" and path.endswith("traffic.pt")
    assert ingest_detector_id(registry, cam) == "yolo-general"


def test_fallback_uses_a_general_detector_not_another_categorys_default(registry, monkeypatch):
    import app.storage.media as media
    import app.detection.detector as detector

    monkeypatch.setattr(media, "resolve_model_file", lambda p: None if p is None or "default" in str(p) else f"/w/{p}")
    monkeypatch.setattr(detector, "get_settings", lambda: type("S", (), {"detection_model_path": "default.pt"})())
    _, model_id = resolve_camera_detection_model(registry, CameraProfile(camera_id="C2", name="x", adjacency="[]"))
    assert model_id == "yolo-general"  # not the theft default


def test_camera_slots_reject_the_classifier_except_assault(client, registry):
    assault_module.register_in_registry(registry)
    registry.add(CameraProfile(camera_id="C3", name="Gate", adjacency="[]"))
    registry.commit()
    bad = client.put("/api/v1/cameras/C3", json={"model_id": assault_module.REGISTRY_ID})
    assert bad.status_code == 400 and "assault model" in bad.json()["detail"]
    ok = client.put("/api/v1/cameras/C3", json={"assault_model_id": assault_module.REGISTRY_ID, "model_id": "yolo-general"})
    assert ok.status_code == 200
    assert client.get("/api/v1/cameras/C3").json()["ingest_model_id"] == "yolo-general"


def test_scan_refused_when_assault_is_off_for_the_camera(client, registry):
    registry.add(CameraProfile(camera_id="C4", name="Platform", adjacency="[]", assault_model_id="OFF"))
    registry.add(VideoAsset(id="v4", camera_id="C4", original_filename="a.mp4", standardized_filename="a.mp4",
                            intake_sha256="0" * 64, processing_status="complete"))
    registry.commit()
    r = client.post("/api/v1/assault-detection/analyze-video", json={"video_id": "v4", "camera_id": "C4"})
    assert r.status_code == 409 and "turned off" in r.json()["detail"]
