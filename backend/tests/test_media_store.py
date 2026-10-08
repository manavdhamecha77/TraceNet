"""S3-primary media store: local cache + fallback behaviour, with an in-memory fake S3."""

import os

import pytest
from botocore.exceptions import ClientError

import app.storage.media as media


class FakeS3:
    def __init__(self):
        self.objects = {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": len(self.objects[Key])}

    def download_file(self, bucket, key, dest):
        with open(dest, "wb") as handle:
            handle.write(self.objects[key])

    def upload_file(self, src, bucket, key, ExtraArgs=None):
        with open(src, "rb") as handle:
            self.objects[key] = handle.read()

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://s3.example/{Params['Key']}?sig=1"


@pytest.fixture
def store(tmp_path, monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(media, "DATA_DIR", tmp_path)
    monkeypatch.setattr(media, "get_data_path", lambda rel: str(tmp_path / rel))
    monkeypatch.setattr(media, "_s3", lambda: (fake, "bucket"))
    monkeypatch.setattr(media, "store_enabled", lambda: True)
    return fake, tmp_path


def test_is_media():
    assert media.is_media("models/abc.pt")
    assert media.is_media("minio_mock/id_clip.avi")
    assert media.is_media("cameras/CAM_001_X/original_assets/clip.mp4")
    assert not media.is_media("cameras/CAM_001_X/thumbnails/clip.jpg")
    assert not media.is_media("processed/detections/v1/crops/t.jpg")
    assert not media.is_media("drishti.db")


def test_put_then_fetch_on_demand_when_local_copy_is_gone(store):
    fake, root = store
    video = root / "cameras" / "CAM_1_X" / "original_assets" / "clip.mp4"
    video.parent.mkdir(parents=True)
    video.write_bytes(b"video-bytes")

    assert media.put(str(video))
    assert fake.objects["media/cameras/CAM_1_X/original_assets/clip.mp4"] == b"video-bytes"

    video.unlink()
    assert media.ensure_local(str(video))
    assert video.read_bytes() == b"video-bytes"
    assert not list(video.parent.glob("*.part"))


def test_missing_everywhere_returns_false(store):
    _, root = store
    assert not media.ensure_local(str(root / "models" / "nope.pt"))


def test_model_path_from_another_machine_resolves_via_s3(store):
    fake, root = store
    fake.objects["media/models/e8f39b53.pt"] = b"weights"
    resolved = media.resolve_model_file(r"D:\Aayush\Projects\x\backend\data\models\e8f39b53.pt")
    assert resolved == os.path.join(str(root), "models", "e8f39b53.pt")
    assert open(resolved, "rb").read() == b"weights"


def test_presigned_only_when_object_exists(store):
    fake, root = store
    path = str(root / "minio_mock" / "a.mp4")
    assert media.presigned_url(path) is None
    fake.objects["media/minio_mock/a.mp4"] = b"x"
    assert media.presigned_url(path).startswith("https://s3.example/media/minio_mock/a.mp4")


def test_delete_removes_s3_copy(store):
    fake, root = store
    fake.objects["media/models/m.pt"] = b"x"
    media.delete(str(root / "models" / "m.pt"))
    assert "media/models/m.pt" not in fake.objects


def test_local_mode_never_touches_s3(tmp_path, monkeypatch):
    monkeypatch.setattr(media, "DATA_DIR", tmp_path)
    monkeypatch.setattr(media, "store_enabled", lambda: False)
    monkeypatch.setattr(media, "_s3", lambda: (_ for _ in ()).throw(AssertionError("S3 used in local mode")))
    path = tmp_path / "models" / "m.pt"
    assert not media.ensure_local(str(path))
    path.parent.mkdir()
    path.write_bytes(b"x")
    assert media.ensure_local(str(path))
    assert not media.put(str(path))
    assert media.presigned_url(str(path)) is None
