"""A camera rename must not break access to videos stored under the camera's old folder name."""

import os
from types import SimpleNamespace

import app.config as config
from app.detection.detector import resolve_standardized_video_path


def _video(camera_id, camera_name, filename):
    return SimpleNamespace(camera_id=camera_id, camera=SimpleNamespace(name=camera_name),
                           standardized_filename=filename)


def test_finds_video_under_old_camera_folder_after_rename(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "get_data_path", lambda rel: str(tmp_path / rel))
    old = tmp_path / "cameras" / "TEST_CAM_001_Test_Camera_1" / "original_assets"
    old.mkdir(parents=True)
    (old / "clip_123.mp4").write_bytes(b"v")
    # another camera whose id starts the same way must not match
    other = tmp_path / "cameras" / "TEST_CAM_0010_X" / "original_assets"
    other.mkdir(parents=True)

    path = resolve_standardized_video_path(_video("TEST_CAM_001", "Camera 1", "clip_123.mp4"), fetch=False)

    assert os.path.exists(path) and "TEST_CAM_001_Test_Camera_1" in path


def test_current_folder_is_preferred_and_missing_stays_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "get_data_path", lambda rel: str(tmp_path / rel))
    cur = tmp_path / "cameras" / "CAM_1_Gate" / "original_assets"
    cur.mkdir(parents=True)
    (cur / "a.mp4").write_bytes(b"v")

    assert "CAM_1_Gate" in resolve_standardized_video_path(_video("CAM_1", "Gate", "a.mp4"), fetch=False)
    missing = resolve_standardized_video_path(_video("CAM_1", "Gate", "nope.mp4"), fetch=False)
    assert not os.path.exists(missing)
