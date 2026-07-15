from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import warnings

import supervision as sv


@dataclass
class TrackerConfig:
    track_activation_threshold: float = 0.25
    minimum_matching_threshold: float = 0.8
    minimum_consecutive_frames: int = 1
    max_time_lost: int = 30


class ByteTrackWrapper:
    """Small wrapper around supervision's ByteTrack proxy.

    The installed supervision version marks ByteTrack as deprecated, but it is still
    available and stable enough for the current MVP demo scope.
    """

    def __init__(self, config: Optional[TrackerConfig] = None) -> None:
        config = config or TrackerConfig()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            self._tracker = sv.ByteTrack(
                track_activation_threshold=config.track_activation_threshold,
                minimum_matching_threshold=config.minimum_matching_threshold,
                minimum_consecutive_frames=config.minimum_consecutive_frames,
                lost_track_buffer=config.max_time_lost,
                frame_rate=30,
            )

    def update(self, detections: sv.Detections) -> sv.Detections:
        return self._tracker.update_with_detections(detections)

    def reset(self) -> None:
        self._tracker.reset()
