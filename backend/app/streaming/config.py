from dataclasses import dataclass, field, fields
from typing import Any, Dict


@dataclass
class StreamConfig:
    # ---- live loop (what the operator sees in real time) ----------------------------------
    target_fps: float = 4.0              # inference FPS on the live feed
    confidence_threshold: float = 0.25
    iou_threshold: float = 0.45
    live_detector: str = "vehicle"       # 'vehicle' = fixed data/models/vehicle_detector.pt (cars, buses, LCV/HCV,
                                         #   two/three-wheelers, pedestrians) | 'camera' = camera's assigned primary model
    live_alert_rules: bool = False       # assault/theft frame rules on the live loop. Off by default: every analytic
                                         #   runs when a recorded chunk is checked into the camera's video archive.
    enable_pose: bool = False            # pose model alongside the live detector (expensive; off by default)
    pose_model_name: str = "yolo11n-pose.pt"
    alert_types: list = field(default_factory=lambda: ["assault", "theft"])
    assault_consecutive_frames: int = 4
    theft_consecutive_frames: int = 4

    # ---- recording / check-in -------------------------------------------------------------
    max_chunk_duration_sec: int = 30     # length of each recorded chunk
    auto_import_chunks: bool = True      # check each finished chunk into the camera node as a video and run the
                                         #   full upload pipeline (transcode, detection, plates, CLIP index, faces, ...)

    # ---- infrastructure (internal; MediaMTX is only reachable from the backend host) --------
    mediamtx_rtsp_base: str = "rtsp://localhost:8554"
    mediamtx_whip_base: str = "http://localhost:8889"
    mediamtx_api_base: str = "http://localhost:9997"

    @classmethod
    def from_dict(cls, data: Dict[str, Any] | None) -> "StreamConfig":
        """Builds a config from a loosely-typed dict (API body / stored JSON), ignoring unknown keys
        so older stored configs and extra client fields never raise."""
        allowed = {f.name for f in fields(cls)}
        clean = {k: v for k, v in (data or {}).items() if k in allowed and v is not None}
        cfg = cls(**clean)
        # defensive coercion for values coming from JSON / form inputs
        cfg.target_fps = float(cfg.target_fps or 4.0)
        cfg.max_chunk_duration_sec = max(5, int(cfg.max_chunk_duration_sec or 30))
        cfg.confidence_threshold = float(cfg.confidence_threshold)
        cfg.iou_threshold = float(cfg.iou_threshold)
        cfg.auto_import_chunks = bool(cfg.auto_import_chunks)
        cfg.live_alert_rules = bool(cfg.live_alert_rules)
        cfg.enable_pose = bool(cfg.enable_pose)
        if cfg.live_detector not in ("vehicle", "camera"):
            cfg.live_detector = "vehicle"
        return cfg

    def to_public_dict(self) -> Dict[str, Any]:
        """Config as shown to clients (internal MediaMTX addresses omitted)."""
        return {
            "target_fps": self.target_fps,
            "confidence_threshold": self.confidence_threshold,
            "live_detector": self.live_detector,
            "live_alert_rules": self.live_alert_rules,
            "enable_pose": self.enable_pose,
            "max_chunk_duration_sec": self.max_chunk_duration_sec,
            "auto_import_chunks": self.auto_import_chunks,
        }
