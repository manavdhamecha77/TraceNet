from dataclasses import dataclass, field

@dataclass
class StreamConfig:
    target_fps: float = 4.0              # inference FPS
    max_chunk_duration_sec: int = 120    # default 2 min (120s), configurable per camera
    confidence_threshold: float = 0.25
    iou_threshold: float = 0.45
    enable_pose: bool = False            # if True, run yolo11n-pose.pt ALONGSIDE registry model
    pose_model_name: str = "yolo11n-pose.pt"
    alert_types: list = field(default_factory=lambda: ["assault", "theft"])
    assault_consecutive_frames: int = 4
    theft_consecutive_frames: int = 4
    auto_import_chunks: bool = False     # per-camera configurable
    mediamtx_rtsp_base: str = "rtsp://localhost:8554"
    mediamtx_whip_base: str = "http://localhost:8889"
    mediamtx_api_base: str = "http://localhost:9997"
