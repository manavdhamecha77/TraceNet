"""Tests for the PaddleOCR-based plate reader and the ANPR pipeline wiring."""
import cv2
import numpy as np
import pytest

import app.api.plate_detection as plate_api
from app.db.models import Camera, LicensePlateDetection, VideoAsset
from app.detection.plate_detector import PlateDetector
from app.detection.plate_ocr import PaddlePlateOCR, assemble_lines, clean_plate_text, prepare_cutout

paddle_available = pytest.importorskip  # readability alias


def _plate_image(rows, width=260, row_height=70, font_scale=1.25):
    """Render a synthetic plate: black text on white, one text row per entry."""
    img = np.full((row_height * len(rows), width, 3), 255, np.uint8)
    cv2.rectangle(img, (2, 2), (width - 3, row_height * len(rows) - 3), (0, 0, 0), 3)
    for i, text in enumerate(rows):
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 3)[0]
        x = (width - size[0]) // 2
        cv2.putText(img, text, (x, row_height * i + 48), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 3, cv2.LINE_AA)
    return img


# ------------------------------------------------------------------ pure logic
def test_clean_plate_text_strips_everything_but_alnum():
    assert clean_plate_text(" gj-05 ab.1234\n") == "GJ05AB1234"


def test_two_row_plate_is_read_top_to_bottom():
    lines = [
        ([10, 60, 100, 100], "ab1234", 0.9),   # bottom row
        ([20, 10, 90, 50], "GJ05", 0.95),      # top row
    ]
    text, score = assemble_lines(lines)
    assert text == "GJ05AB1234"
    assert 0.9 < score < 0.96


def test_same_row_is_read_left_to_right_and_low_scores_dropped():
    lines = [
        ([150, 10, 240, 50], "1234", 0.9),
        ([10, 12, 140, 52], "GJ05AB", 0.9),
        ([5, 5, 8, 9], "X", 0.1),             # unsure fragment must be ignored
    ]
    assert assemble_lines(lines)[0] == "GJ05AB1234"


def test_nothing_legible_returns_empty():
    assert assemble_lines([]) == ("", 0.0)
    assert assemble_lines([([0, 0, 5, 5], "??", 0.9)]) == ("", 0.0)


def test_small_cutouts_are_upscaled_with_margin():
    tiny = np.zeros((20, 60, 3), np.uint8)
    out = prepare_cutout(tiny)
    assert out.shape[0] >= 64 + 20 and out.shape[1] > 60


# ------------------------------------------------------------------ real PaddleOCR
@pytest.fixture(scope="module")
def ocr():
    pytest.importorskip("paddleocr")
    pytest.importorskip("paddle")
    return PaddlePlateOCR()


def test_paddle_reads_single_row_plate(ocr):
    text, score = ocr.read(_plate_image(["GJ05AB1234"]))
    assert text == "GJ05AB1234"
    assert score > 0.9


def test_paddle_reads_two_row_plate(ocr):
    text, _ = ocr.read(_plate_image(["GJ05", "AB1234"], width=200, row_height=80, font_scale=1.6))
    assert text == "GJ05AB1234"


def test_paddle_reads_a_small_low_res_cutout(ocr):
    small = cv2.resize(_plate_image(["MH12DE1433"]), (130, 35), interpolation=cv2.INTER_AREA)
    text, score = ocr.read(small)
    assert text == "MH12DE1433" and score > 0.5


def test_paddle_returns_nothing_for_blank_cutout(ocr):
    assert ocr.read(np.full((60, 200, 3), 128, np.uint8)) == ("", 0.0)


# ------------------------------------------------------------------ detector + API wiring
class _Arr:
    def __init__(self, arr):
        self._arr = np.asarray(arr)

    def cpu(self):
        return self

    def numpy(self):
        return self._arr


class _Box:
    def __init__(self, xyxy, conf):
        self.xyxy = [_Arr(xyxy)]
        self.conf = [_Arr(conf)]


class _Result:
    def __init__(self, boxes):
        self.boxes = boxes


class _FakePlateLocaliser:
    """Stands in for the YOLO plate model: reports the known plate position in every frame."""

    def __init__(self, xyxy):
        self.xyxy = xyxy

    def predict(self, **kwargs):
        return [_Result([_Box(self.xyxy, 0.9)])]


PLATE_POS = (200, 300)


def _scene(plate):
    frame = np.full((480, 640, 3), 90, np.uint8)
    h, w = plate.shape[:2]
    frame[PLATE_POS[1]:PLATE_POS[1] + h, PLATE_POS[0]:PLATE_POS[0] + w] = plate
    return frame, [PLATE_POS[0], PLATE_POS[1], PLATE_POS[0] + w, PLATE_POS[1] + h]


def _detector(box):
    pytest.importorskip("paddleocr")
    pytest.importorskip("paddle")
    det = PlateDetector()
    det.model = _FakePlateLocaliser(box)   # skip YOLO weight loading
    det.vehicle_model = None               # full-frame mode
    return det


def test_detect_frame_reads_plate_with_paddle_and_maps_bbox():
    frame, box = _scene(_plate_image(["GJ05AB1234"]))
    detections = _detector(box).detect_frame(frame, frame_number=7, timestamp_seconds=0.7)
    assert len(detections) == 1
    d = detections[0]
    assert d["plate_text"] == "GJ05AB1234"
    assert d["bbox"] == box
    assert d["ocr_confidence"] > 0.9


def test_unreadable_plate_below_ocr_threshold_is_dropped():
    frame, box = _scene(np.full((70, 260, 3), 128, np.uint8))
    assert _detector(box).detect_frame(frame) == []


def test_analyze_video_endpoint_end_to_end(client, db, sample_camera_data, tmp_path, monkeypatch):
    plate = _plate_image(["GJ05AB1234"])
    frame, box = _scene(plate)
    video_path = tmp_path / "plates.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (640, 480))
    for _ in range(20):
        writer.write(frame)
    writer.release()

    db.add(Camera(**sample_camera_data))
    db.add(VideoAsset(
        id="v-anpr", camera_id="CAM_001", original_filename="a.mp4", standardized_filename="plates.mp4",
        intake_sha256="a" * 64, processing_status="complete",
    ))
    db.commit()

    detector = _detector(box)
    monkeypatch.setattr(plate_api, "get_plate_detector", lambda: detector)
    monkeypatch.setattr(plate_api, "_resolve_video_path", lambda *_: str(video_path))
    monkeypatch.setattr(plate_api, "get_data_path", lambda rel: str(tmp_path / rel))

    # watchlist the plate (typed with punctuation: must normalise to the OCR output)
    assert client.post("/api/v1/anpr/watchlist", json={"plate_number": "gj-05 ab 1234", "reason": "test"}).status_code == 200

    res = client.post("/api/v1/anpr/analyze-video", json={"video_id": "v-anpr", "camera_id": "CAM_001"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["plates_detected"] == 1 and body["watchlist_hits"] == 1
    sighting = body["sightings"][0]
    assert sighting["plate_text"] == "GJ05AB1234" and sighting["is_watchlisted"] is True
    assert sighting["ocr_confidence"] > 0.9

    row = db.query(LicensePlateDetection).one()
    assert row.plate_text == "GJ05AB1234" and row.is_watchlisted

    status = client.get("/api/v1/anpr/model/status").json()
    assert status["ocr_model"] == "PaddleOCR PP-OCRv5"
