import os
import json
import math
import csv
import glob
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
from loguru import logger

from app.config import get_data_path

LUMPI_CLASS_DICT = {
    0: "pedestrian",
    1: "car",
    2: "bicycle",
    3: "motorcycle",
    4: "bus",
    5: "truck",
    6: "van",
    7: "unknown"
}

# Seed for the deterministic synthetic-embedding generator. A dedicated Generator is used
# so the benchmark never reseeds numpy's process-global RNG (which other services share).
EMBEDDING_RNG_SEED = 42
EMBEDDING_DIM = 512

# Observations of the same object in the same camera separated by more than this many
# seconds are treated as two distinct sightings (object left and re-entered the frame).
SAME_CAMERA_REAPPEARANCE_GAP_S = 1.0

# Projection-based attribution is only trusted when at least this fraction of the labels
# lands inside some camera image; below it the calibration is not usable for this data.
MIN_PROJECTION_COVERAGE = 0.2


def map_lumpi_class_to_tracenet(class_id: int) -> str:
    """Maps LUMPI numeric class ID to TraceNet object type ('person' or 'vehicle')."""
    if class_id == 0:
        return "person"
    elif class_id in (1, 2, 3, 4, 5, 6):
        return "vehicle"
    return "unknown"


def rodrigues_to_matrix(rvec: List[float]) -> np.ndarray:
    """Converts an OpenCV-style Rodrigues rotation vector into a 3x3 rotation matrix."""
    rv = np.asarray(rvec, dtype=float).reshape(3)
    theta = float(np.linalg.norm(rv))
    if theta < 1e-12:
        return np.eye(3)
    k = rv / theta
    K = np.array([
        [0.0, -k[2], k[1]],
        [k[2], 0.0, -k[0]],
        [-k[1], k[0], 0.0]
    ])
    return np.eye(3) + math.sin(theta) * K + (1.0 - math.cos(theta)) * (K @ K)


@dataclass
class LumpiCameraInfo:
    camera_id: str
    device_id: int
    name: str
    fps: float
    latitude: float
    longitude: float
    altitude: float = 5.0
    intrinsic: List[List[float]] = field(default_factory=list)
    extrinsic: List[List[float]] = field(default_factory=list)
    rvec: List[float] = field(default_factory=list)          # world -> camera rotation (Rodrigues)
    tvec: List[float] = field(default_factory=list)          # world -> camera translation (metres)
    image_width: int = 0
    image_height: int = 0
    experiment_id: Optional[int] = None
    world_position: List[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])

    def can_project(self) -> bool:
        return (
            len(self.rvec) == 3
            and len(self.tvec) == 3
            and len(self.intrinsic) == 3
            and self.image_width > 0
            and self.image_height > 0
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LumpiTrackletObservation:
    observation_id: str
    ground_truth_id: int
    camera_id: str
    object_type: str
    class_id: int
    start_time: float
    end_time: float
    start_frame: int
    end_frame: int
    bbox_sample: List[float]  # [x, y, w, h]
    position_3d: List[float]  # [x, y, z] at the midpoint of the sighting
    embedding: Optional[List[float]] = None
    position_3d_start: List[float] = field(default_factory=list)
    position_3d_end: List[float] = field(default_factory=list)
    trajectory: List[List[float]] = field(default_factory=list)  # sampled [t, x, y] ground-plane track

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def position_at(obs: LumpiTrackletObservation, t: float) -> List[float]:
    """Ground-plane [x, y] of a sighting at time t (linear interpolation, clamped to the sighting)."""
    traj = obs.trajectory
    if not traj:
        if t <= obs.start_time:
            p = obs.position_3d_start or obs.position_3d
        elif t >= obs.end_time:
            p = obs.position_3d_end or obs.position_3d
        else:
            p = obs.position_3d
        return [p[0], p[1]]
    if t <= traj[0][0]:
        return [traj[0][1], traj[0][2]]
    if t >= traj[-1][0]:
        return [traj[-1][1], traj[-1][2]]
    lo, hi = 0, len(traj) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if traj[mid][0] <= t:
            lo = mid
        else:
            hi = mid
    p0, p1 = traj[lo], traj[hi]
    span = p1[0] - p0[0]
    if span <= 0:
        return [p0[1], p0[2]]
    a = (t - p0[0]) / span
    return [p0[1] + a * (p1[1] - p0[1]), p0[2] + a * (p1[2] - p0[2])]


def sighting_distance_m(a: LumpiTrackletObservation, b: LumpiTrackletObservation) -> float:
    """
    Ground-plane distance an object would have to cover between sighting A and sighting B.
    Sequential sightings: from where A ended to where B began. Overlapping sightings (handover
    between cameras that see the same spot): compare both positions at the same instant.
    """
    if b.start_time >= a.end_time:
        pa = a.position_3d_end or a.position_3d
        pb = b.position_3d_start or b.position_3d
    else:
        t = max(a.start_time, b.start_time)
        pa = position_at(a, t)
        pb = position_at(b, t)
    return math.hypot(pb[0] - pa[0], pb[1] - pa[1])


@dataclass
class LumpiGroundTruthJourney:
    object_id: int
    object_type: str
    observations: List[LumpiTrackletObservation]
    transitions: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "object_id": self.object_id,
            "object_type": self.object_type,
            "observations": [o.to_dict() for o in self.observations],
            "transitions": self.transitions
        }


class LumpiAdapter:
    """
    Adapter for the LUMPI Benchmark Dataset.
    Loads, parses, and converts LUMPI multi-camera calibration and track labels
    into TraceNet evaluation formats.

    Two camera-assignment modes are supported:
      * ``projection`` (real LUMPI data): each fused 3D label is projected into every camera
        of the requested experiment using its rvec/tvec/intrinsic calibration; the object is
        "seen" by a camera when the projection lands inside that camera's image. Cameras at a
        LUMPI intersection overlap heavily, so one object yields simultaneous sightings.
      * ``nearest-camera`` (synthetic sample without calibration): each label is attached to
        the camera whose world position is closest.
    """

    def __init__(self, dataset_path: Optional[str] = None):
        self.default_data_dir = get_data_path("evaluation/lumpi")
        os.makedirs(self.default_data_dir, exist_ok=True)

        if dataset_path:
            self.dataset_path = dataset_path
        else:
            test_data_dir = os.path.join(self.default_data_dir, "test_data")
            if os.path.exists(test_data_dir) and os.path.exists(os.path.join(test_data_dir, "meta.json")):
                self.dataset_path = test_data_dir
            elif os.path.exists(os.path.join(self.default_data_dir, "meta.json")) and os.path.exists(os.path.join(self.default_data_dir, "Measurement1")):
                self.dataset_path = self.default_data_dir
            else:
                self.dataset_path = os.path.join(self.default_data_dir, "sample_sequence")

        self.cameras: Dict[str, LumpiCameraInfo] = {}
        self.observations: List[LumpiTrackletObservation] = []
        self.ground_truth_journeys: Dict[int, LumpiGroundTruthJourney] = {}
        self.evaluation_mode: str = "nearest-camera"
        self.projection_coverage: Optional[float] = None
        self.loaded_experiment_id: Optional[int] = None

    # ------------------------------------------------------------------ discovery

    def is_dataset_available(self) -> bool:
        meta_path = os.path.join(self.dataset_path, "meta.json")
        return os.path.exists(meta_path)

    def _read_meta(self) -> Dict[str, Any]:
        meta_path = os.path.join(self.dataset_path, "meta.json")
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def dataset_kind(self) -> str:
        """'lumpi' for calibrated LUMPI data, 'synthetic' for the generated sample, else 'missing'/'unknown'."""
        if not self.is_dataset_available():
            return "missing"
        try:
            meta = self._read_meta()
        except Exception:
            return "unknown"
        if meta.get("dataset") == "LUMPI_Evaluation_Sequence":
            return "synthetic"
        for s_data in meta.get("session", {}).values():
            if s_data.get("type") == "camera" and s_data.get("rvec") and s_data.get("tvec"):
                return "lumpi"
        return "unknown"

    def list_experiments(self) -> List[Dict[str, Any]]:
        """Enumerates Measurement{N} folders with label row counts, camera counts and video availability."""
        if not self.is_dataset_available():
            return []
        try:
            meta = self._read_meta()
        except Exception:
            meta = {}
        sessions = meta.get("session", {})
        camera_sessions = {k: v for k, v in sessions.items() if v.get("type") == "camera"}
        tagged = any("experimentId" in v for v in camera_sessions.values())

        experiments: List[Dict[str, Any]] = []
        for meas_dir in sorted(glob.glob(os.path.join(self.dataset_path, "Measurement*"))):
            base = os.path.basename(meas_dir)
            suffix = base[len("Measurement"):]
            if not suffix.isdigit():
                continue
            exp_id = int(suffix)
            label_csv = self._find_label_csv(meas_dir)
            if not label_csv:
                continue
            try:
                with open(label_csv, "r", encoding="utf-8") as f:
                    rows = max(0, sum(1 for _ in f) - 1)
            except Exception:
                rows = 0
            if tagged:
                cams = [k for k, v in camera_sessions.items() if v.get("experimentId") == exp_id]
            else:
                cams = list(camera_sessions.keys())
            has_video = len(glob.glob(os.path.join(meas_dir, "cam", "*", "video.mp4"))) > 0
            experiments.append({
                "experiment_id": exp_id,
                "camera_sessions": cams,
                "camera_count": len(cams),
                "label_rows": rows,
                "has_video": has_video
            })
        return experiments

    @staticmethod
    def _find_label_csv(meas_dir: str) -> Optional[str]:
        for name in ("Label.csv", "label.csv"):
            p = os.path.join(meas_dir, name)
            if os.path.exists(p):
                return p
        return None

    # ------------------------------------------------------------------ synthetic sample

    def ensure_sample_dataset(self) -> str:
        """
        Creates a synthetic but mathematically exact LUMPI sample sequence
        (meta.json + Measurement1/Label.csv) if not already present.
        """
        if self.is_dataset_available():
            logger.info(f"LUMPI dataset found at {self.dataset_path}")
            return self.dataset_path

        logger.info(f"Generating validated LUMPI sample evaluation sequence at {self.dataset_path}")
        os.makedirs(self.dataset_path, exist_ok=True)
        meas_dir = os.path.join(self.dataset_path, "Measurement1")
        os.makedirs(meas_dir, exist_ok=True)

        # 1. Generate meta.json with 3 calibrated cameras at an urban intersection
        # Cam 1 (South Gate), Cam 2 (Central Junction), Cam 3 (North Avenue)
        meta_data = {
            "dataset": "LUMPI_Evaluation_Sequence",
            "version": "1.0",
            "license": "MIT",
            "reference_crs": "EPSG:4326 / Local Metric UTM",
            "session": {
                "cam_1": {
                    "deviceId": 1,
                    "type": "camera",
                    "name": "LUMPI_CAM_1_SOUTH",
                    "fps": 10.0,
                    "coordinates": {"lat": 21.170240, "lon": 72.831060, "alt": 6.5},
                    "rvec": [0.1, 0.0, -0.05],
                    "tvec": [0.0, 15.0, 6.5],
                    "intrinsic": [
                        [920.0, 0.0, 640.0],
                        [0.0, 920.0, 360.0],
                        [0.0, 0.0, 1.0]
                    ],
                    "extrinsic": [
                        [1.0, 0.0, 0.0, 0.0],
                        [0.0, 1.0, 0.0, 15.0],
                        [0.0, 0.0, 1.0, 6.5],
                        [0.0, 0.0, 0.0, 1.0]
                    ],
                    "distortion": [-0.05, 0.02, 0.0, 0.0]
                },
                "cam_2": {
                    "deviceId": 2,
                    "type": "camera",
                    "name": "LUMPI_CAM_2_CENTRAL",
                    "fps": 10.0,
                    "coordinates": {"lat": 21.170950, "lon": 72.831620, "alt": 8.0},
                    "rvec": [0.15, 0.0, 0.1],
                    "tvec": [85.0, 60.0, 8.0],
                    "intrinsic": [
                        [950.0, 0.0, 640.0],
                        [0.0, 950.0, 360.0],
                        [0.0, 0.0, 1.0]
                    ],
                    "extrinsic": [
                        [0.98, -0.17, 0.0, 85.0],
                        [0.17, 0.98, 0.0, 60.0],
                        [0.0, 0.0, 1.0, 8.0],
                        [0.0, 0.0, 0.0, 1.0]
                    ],
                    "distortion": [-0.04, 0.015, 0.0, 0.0]
                },
                "cam_3": {
                    "deviceId": 3,
                    "type": "camera",
                    "name": "LUMPI_CAM_3_NORTH",
                    "fps": 10.0,
                    "coordinates": {"lat": 21.171800, "lon": 72.832250, "alt": 7.0},
                    "rvec": [0.12, -0.05, 0.02],
                    "tvec": [180.0, 140.0, 7.0],
                    "intrinsic": [
                        [910.0, 0.0, 640.0],
                        [0.0, 910.0, 360.0],
                        [0.0, 0.0, 1.0]
                    ],
                    "extrinsic": [
                        [0.95, -0.31, 0.0, 180.0],
                        [0.31, 0.95, 0.0, 140.0],
                        [0.0, 0.0, 1.0, 7.0],
                        [0.0, 0.0, 0.0, 1.0]
                    ],
                    "distortion": [-0.06, 0.02, 0.0, 0.0]
                }
            }
        }
        with open(os.path.join(self.dataset_path, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta_data, f, indent=2)

        # 2. Generate Measurement1/Label.csv conforming to LumpiParser format
        # time,object id, 2d rectangle: top left x,top left y, width,height,score,class_id,visibility,3D box: center x,y,z,length, width ,height,heading,...
        labels_file = os.path.join(meas_dir, "Label.csv")
        with open(labels_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "time", "object id", "2d_x", "2d_y", "width", "height",
                "score", "class_id", "visibility", "loc_x", "loc_y", "loc_z",
                "dim_l", "dim_w", "dim_h", "heading", "extra"
            ])

            # Object 101: Pedestrian moving Cam 1 (t=5..15) -> Cam 2 (t=65..75) -> Cam 3 (t=135..145)
            # Distance ~90m (Cam 1->2) at 1.5 m/s (~60s transit)
            for t in range(5, 16):
                writer.writerow([float(t), 101, 320, 240, 45, 110, 0.95, 0, 1, 5.0 + t*0.2, 10.0, 1.7, 0.6, 0.5, 1.75, 0.5, ""])
            for t in range(65, 76):
                writer.writerow([float(t), 101, 410, 220, 42, 105, 0.94, 0, 1, 88.0 + (t-65)*0.2, 58.0, 1.7, 0.6, 0.5, 1.75, 0.5, ""])
            for t in range(135, 146):
                writer.writerow([float(t), 101, 380, 200, 40, 100, 0.92, 0, 1, 182.0 + (t-135)*0.2, 138.0, 1.7, 0.6, 0.5, 1.75, 0.5, ""])

            # Object 201: Vehicle (Car) moving Cam 1 (t=10..18) -> Cam 2 (t=26..34) -> Cam 3 (t=42..50)
            # Distance ~90m in ~8s (~11.2 m/s or ~40 km/h)
            for t in range(10, 19):
                writer.writerow([float(t), 201, 150, 280, 120, 90, 0.98, 1, 1, 12.0 + (t-10)*1.8, 14.0, 1.5, 4.5, 1.9, 1.5, 0.8, ""])
            for t in range(26, 35):
                writer.writerow([float(t), 201, 200, 260, 115, 88, 0.97, 1, 1, 92.0 + (t-26)*1.8, 62.0, 1.5, 4.5, 1.9, 1.5, 0.8, ""])
            for t in range(42, 51):
                writer.writerow([float(t), 201, 220, 240, 110, 85, 0.96, 1, 1, 185.0 + (t-42)*1.8, 142.0, 1.5, 4.5, 1.9, 1.5, 0.8, ""])

            # Object 102: Distractor pedestrian on Cam 2 only (t=68..80)
            for t in range(68, 81):
                writer.writerow([float(t), 102, 180, 230, 44, 108, 0.91, 0, 1, 75.0, 52.0, 1.7, 0.6, 0.5, 1.72, 0.1, ""])

            # Object 202: Vehicle travelling opposite direction Cam 3 (t=55..63) -> Cam 2 (t=71..79)
            for t in range(55, 64):
                writer.writerow([float(t), 202, 450, 250, 118, 88, 0.96, 1, 1, 175.0 - (t-55)*1.7, 136.0, 1.5, 4.6, 1.9, 1.5, -2.3, ""])
            for t in range(71, 80):
                writer.writerow([float(t), 202, 410, 270, 122, 90, 0.95, 1, 1, 85.0 - (t-71)*1.7, 56.0, 1.5, 4.6, 1.9, 1.5, -2.3, ""])

        return self.dataset_path

    # ------------------------------------------------------------------ camera parsing

    @staticmethod
    def _flatten_vec(raw: Any) -> List[float]:
        """LUMPI stores rvec/tvec as [[x],[y],[z]]; the synthetic sample stores [x, y, z]."""
        if raw is None:
            return []
        try:
            arr = np.asarray(raw, dtype=float).reshape(-1)
        except Exception:
            return []
        return [float(v) for v in arr] if arr.size == 3 else []

    def _resolve_image_size(self, cam: LumpiCameraInfo, experiment_id: int) -> Tuple[int, int]:
        """Reads the camera's frame size from its LUMPI video if present, else infers it from the principal point."""
        video_path = os.path.join(self.dataset_path, f"Measurement{experiment_id}", "cam", str(cam.device_id), "video.mp4")
        if os.path.exists(video_path):
            try:
                import cv2  # local import: keeps the adapter importable without OpenCV
                cap = cv2.VideoCapture(video_path)
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                cap.release()
                if w > 0 and h > 0:
                    return w, h
            except Exception as e:
                logger.debug(f"LUMPI: could not read frame size from {video_path}: {e}")
        if len(cam.intrinsic) == 3 and len(cam.intrinsic[0]) >= 3:
            cx = float(cam.intrinsic[0][2])
            cy = float(cam.intrinsic[1][2])
            if cx > 0 and cy > 0:
                return int(round(2 * cx)), int(round(2 * cy))
        return 0, 0

    def _parse_cameras(self, meta: Dict[str, Any], experiment_id: int) -> Dict[str, LumpiCameraInfo]:
        sessions = meta.get("session", {})
        camera_sessions = {k: v for k, v in sessions.items() if v.get("type") == "camera"}
        tagged = any("experimentId" in v for v in camera_sessions.values())

        if tagged:
            selected = {k: v for k, v in camera_sessions.items() if v.get("experimentId") == experiment_id}
            if not selected:
                logger.warning(
                    f"LUMPI: no camera sessions tagged experimentId={experiment_id}; falling back to all {len(camera_sessions)} cameras."
                )
                selected = camera_sessions
        else:
            selected = camera_sessions

        cameras: Dict[str, LumpiCameraInfo] = {}
        for session_id, s_data in selected.items():
            coords = s_data.get("coordinates", {})
            extrinsic = s_data.get("extrinsic", []) or []
            rvec = self._flatten_vec(s_data.get("rvec"))
            tvec = self._flatten_vec(s_data.get("tvec"))

            # Camera position in the world frame: extrinsic (camera -> world) translation column,
            # or -R^T t from the world -> camera rvec/tvec pair.
            world_position = [0.0, 0.0, 0.0]
            if len(extrinsic) >= 3 and all(len(r) >= 4 for r in extrinsic[:3]):
                world_position = [float(extrinsic[0][3]), float(extrinsic[1][3]), float(extrinsic[2][3])]
            elif len(rvec) == 3 and len(tvec) == 3:
                R = rodrigues_to_matrix(rvec)
                world_position = [float(v) for v in (-R.T @ np.asarray(tvec))]

            cam_info = LumpiCameraInfo(
                camera_id=session_id,
                device_id=int(s_data.get("deviceId", 1)),
                name=s_data.get("name", f"LUMPI_CAM_{session_id}"),
                fps=float(s_data.get("fps", 10.0)),
                latitude=float(coords.get("lat", 21.1700)),
                longitude=float(coords.get("lon", 72.8310)),
                altitude=float(coords.get("alt", world_position[2] if world_position[2] else 5.0)),
                intrinsic=s_data.get("intrinsic", []) or [],
                extrinsic=extrinsic,
                rvec=rvec,
                tvec=tvec,
                experiment_id=s_data.get("experimentId"),
                world_position=world_position
            )
            cam_info.image_width, cam_info.image_height = self._resolve_image_size(cam_info, experiment_id)
            cameras[session_id] = cam_info
        return cameras

    # ------------------------------------------------------------------ geometry

    def _is_visible(self, cam: LumpiCameraInfo, point_3d: List[float]) -> bool:
        """Projects a world point with the camera's calibration and tests it against the image bounds."""
        R = rodrigues_to_matrix(cam.rvec)
        Xc = R @ np.asarray(point_3d, dtype=float) + np.asarray(cam.tvec, dtype=float)
        if Xc[2] <= 0.0:
            return False
        K = cam.intrinsic
        u = K[0][0] * Xc[0] / Xc[2] + K[0][2]
        v = K[1][1] * Xc[1] / Xc[2] + K[1][2]
        return 0.0 <= u < cam.image_width and 0.0 <= v < cam.image_height

    def _nearest_camera(self, point_3d: List[float]) -> str:
        best_cam_id = next(iter(self.cameras.keys()))
        min_dist = float("inf")
        for c_id, c_info in self.cameras.items():
            dx = point_3d[0] - c_info.world_position[0]
            dy = point_3d[1] - c_info.world_position[1]
            dist = math.hypot(dx, dy)
            if dist < min_dist:
                min_dist = dist
                best_cam_id = c_id
        return best_cam_id

    # ------------------------------------------------------------------ loading

    def load_dataset(self, experiment_id: int = 1, embedding_noise_sigma: float = 0.05) -> Dict[str, Any]:
        """
        Parses meta.json and Measurement{experiment_id}/Label.csv into TraceNet format.

        ``embedding_noise_sigma`` is the noise-to-signal ratio applied to the synthetic identity
        embeddings (same-object cosine ~ 1/(1+sigma^2)). 0.05 yields near-perfect visual
        re-identification; values near 1.0 push true matches down to the similarity gate so the
        spatiotemporal linking has to carry the disambiguation.
        """
        if not self.is_dataset_available():
            self.ensure_sample_dataset()

        meta = self._read_meta()
        self.loaded_experiment_id = experiment_id

        # 1. Cameras belonging to this experiment only
        self.cameras = self._parse_cameras(meta, experiment_id)
        if not self.cameras:
            raise ValueError(f"LUMPI meta.json at {self.dataset_path} defines no camera sessions.")

        # 2. Parse Label.csv
        meas_dir = os.path.join(self.dataset_path, f"Measurement{experiment_id}")
        label_csv = self._find_label_csv(meas_dir)
        if not label_csv:
            raise FileNotFoundError(f"LUMPI Label file not found in {meas_dir}")

        raw_tracks: Dict[int, List[Dict[str, Any]]] = {}
        with open(label_csv, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)  # header
            for row in reader:
                if len(row) < 12:
                    continue
                try:
                    time_val = float(row[0])
                    obj_id = int(float(row[1]))
                    bbox = [float(row[2]), float(row[3]), float(row[4]), float(row[5])]
                    score = float(row[6]) if len(row) > 6 else 1.0
                    class_id = int(float(row[7])) if len(row) > 7 else 0
                    loc_3d = [float(row[9]), float(row[10]), float(row[11])]
                except (ValueError, IndexError):
                    continue
                raw_tracks.setdefault(obj_id, []).append({
                    "time": time_val,
                    "bbox": bbox,
                    "score": score,
                    "class_id": class_id,
                    "position_3d": loc_3d
                })

        # 3. Decide how sightings are attributed to cameras. Projection needs full calibration AND
        #    must actually place the labels inside the images; otherwise (synthetic sample, bogus
        #    calibration) fall back to nearest-camera attribution.
        self.evaluation_mode = "projection" if all(c.can_project() for c in self.cameras.values()) else "nearest-camera"
        self.projection_coverage = None
        if self.evaluation_mode == "projection":
            total_points = 0
            visible_points = 0
            for pts in raw_tracks.values():
                for pt in pts:
                    total_points += 1
                    if any(self._is_visible(c, pt["position_3d"]) for c in self.cameras.values()):
                        visible_points += 1
            self.projection_coverage = (visible_points / total_points) if total_points else 0.0
            if self.projection_coverage < MIN_PROJECTION_COVERAGE:
                logger.warning(
                    f"LUMPI: only {self.projection_coverage:.0%} of labels project into any camera image; "
                    "falling back to nearest-camera attribution."
                )
                self.evaluation_mode = "nearest-camera"

        # 4. Segment every object's track into per-camera sightings
        rng = np.random.default_rng(EMBEDDING_RNG_SEED)
        self.observations = []
        obs_counter = 0

        for obj_id in sorted(raw_tracks.keys()):
            points = sorted(raw_tracks[obj_id], key=lambda p: p["time"])
            base_vec = rng.standard_normal(EMBEDDING_DIM)
            base_vec = base_vec / np.linalg.norm(base_vec)

            if self.evaluation_mode == "projection":
                per_camera: Dict[str, List[Dict[str, Any]]] = {c_id: [] for c_id in self.cameras}
                for pt in points:
                    for c_id, cam in self.cameras.items():
                        if self._is_visible(cam, pt["position_3d"]):
                            per_camera[c_id].append(pt)
                for c_id in self.cameras:  # deterministic camera order
                    for segment in self._split_by_gap(per_camera[c_id], SAME_CAMERA_REAPPEARANCE_GAP_S):
                        self.observations.append(
                            self._create_observation(obs_counter, obj_id, c_id, segment, base_vec, rng, embedding_noise_sigma)
                        )
                        obs_counter += 1
            else:
                current_cam: Optional[str] = None
                cluster: List[Dict[str, Any]] = []
                for pt in points:
                    cam_id = self._nearest_camera(pt["position_3d"])
                    gap = (pt["time"] - cluster[-1]["time"]) if cluster else 0.0
                    if cluster and (cam_id != current_cam or gap > 10.0):
                        self.observations.append(
                            self._create_observation(obs_counter, obj_id, current_cam, cluster, base_vec, rng, embedding_noise_sigma)
                        )
                        obs_counter += 1
                        cluster = []
                    current_cam = cam_id
                    cluster.append(pt)
                if cluster and current_cam is not None:
                    self.observations.append(
                        self._create_observation(obs_counter, obj_id, current_cam, cluster, base_vec, rng, embedding_noise_sigma)
                    )
                    obs_counter += 1

        self.observations.sort(key=lambda o: (o.start_time, o.camera_id, o.observation_id))

        # 4. Assemble ground-truth journeys and their camera-to-camera transitions
        self.ground_truth_journeys = {}
        for obs in self.observations:
            journey = self.ground_truth_journeys.get(obs.ground_truth_id)
            if journey is None:
                journey = LumpiGroundTruthJourney(
                    object_id=obs.ground_truth_id,
                    object_type=obs.object_type,
                    observations=[],
                    transitions=[]
                )
                self.ground_truth_journeys[obs.ground_truth_id] = journey
            journey.observations.append(obs)

        for journey in self.ground_truth_journeys.values():
            journey.observations.sort(key=lambda o: (o.start_time, o.end_time, o.camera_id))
            for k in range(len(journey.observations) - 1):
                from_obs = journey.observations[k]
                to_obs = journey.observations[k + 1]
                gap = to_obs.start_time - from_obs.end_time
                handover = gap <= 0.0
                transit = max(0.0, gap)
                dist_m = sighting_distance_m(from_obs, to_obs)
                cam_a = self.cameras.get(from_obs.camera_id)
                cam_b = self.cameras.get(to_obs.camera_id)
                cam_dist = 0.0
                if cam_a and cam_b:
                    cam_dist = math.hypot(
                        cam_b.world_position[0] - cam_a.world_position[0],
                        cam_b.world_position[1] - cam_a.world_position[1]
                    )
                journey.transitions.append({
                    "from_camera": from_obs.camera_id,
                    "to_camera": to_obs.camera_id,
                    "from_time": from_obs.end_time,
                    "to_time": to_obs.start_time,
                    "transit_time_seconds": round(transit, 2),
                    "is_handover": handover,
                    "distance_meters": round(dist_m, 2),
                    "camera_distance_meters": round(cam_dist, 2),
                    "avg_speed_mps": round(dist_m / transit, 2) if transit > 0 else 0.0
                })

        per_camera_counts = {c_id: 0 for c_id in self.cameras}
        for obs in self.observations:
            per_camera_counts[obs.camera_id] = per_camera_counts.get(obs.camera_id, 0) + 1

        multi_cam = [j for j in self.ground_truth_journeys.values() if len(j.observations) > 1]
        logger.info(
            f"LUMPI dataset loaded (exp {experiment_id}, mode={self.evaluation_mode}): {len(self.cameras)} cameras, "
            f"{len(self.observations)} sightings, {len(self.ground_truth_journeys)} objects, {len(multi_cam)} multi-camera."
        )

        return {
            "dataset_path": self.dataset_path,
            "dataset_kind": self.dataset_kind(),
            "evaluation_mode": self.evaluation_mode,
            "projection_coverage": round(self.projection_coverage, 4) if self.projection_coverage is not None else None,
            "experiment_id": experiment_id,
            "cameras_count": len(self.cameras),
            "observations_count": len(self.observations),
            "per_camera_observation_counts": per_camera_counts,
            "journeys_count": len(self.ground_truth_journeys),
            "multi_camera_targets_count": len(multi_cam)
        }

    @staticmethod
    def _split_by_gap(points: List[Dict[str, Any]], max_gap_s: float) -> List[List[Dict[str, Any]]]:
        segments: List[List[Dict[str, Any]]] = []
        current: List[Dict[str, Any]] = []
        for pt in points:
            if current and (pt["time"] - current[-1]["time"]) > max_gap_s:
                segments.append(current)
                current = []
            current.append(pt)
        if current:
            segments.append(current)
        return segments

    def _create_observation(
        self,
        obs_idx: int,
        obj_id: int,
        cam_id: str,
        cluster: List[Dict[str, Any]],
        base_vec: np.ndarray,
        rng: np.random.Generator,
        noise_sigma: float
    ) -> LumpiTrackletObservation:
        fps = self.cameras[cam_id].fps if cam_id in self.cameras else 10.0
        start_t = cluster[0]["time"]
        end_t = cluster[-1]["time"]
        class_id = cluster[0]["class_id"]
        obj_type = map_lumpi_class_to_tracenet(class_id)
        mid_pt = cluster[len(cluster) // 2]

        # Observation-level visual perturbation (camera angle / illumination noise).
        # noise_sigma is the noise-to-signal norm ratio: the perturbation vector has norm ~= sigma
        # relative to the unit identity vector, so two sightings of one object have an expected
        # cosine similarity of ~1 / (1 + sigma^2)  (0.05 -> 0.998, 0.6 -> 0.74, 1.0 -> 0.50).
        noise = rng.standard_normal(EMBEDDING_DIM) * (max(0.0, noise_sigma) / math.sqrt(EMBEDDING_DIM))
        obs_vec = base_vec + noise
        obs_vec = obs_vec / np.linalg.norm(obs_vec)

        return LumpiTrackletObservation(
            observation_id=f"lumpi_obs_{obs_idx:04d}",
            ground_truth_id=obj_id,
            camera_id=cam_id,
            object_type=obj_type,
            class_id=class_id,
            start_time=start_t,
            end_time=end_t,
            start_frame=int(start_t * fps),
            end_frame=int(end_t * fps),
            bbox_sample=mid_pt["bbox"],
            position_3d=mid_pt["position_3d"],
            embedding=obs_vec.tolist(),
            position_3d_start=list(cluster[0]["position_3d"]),
            position_3d_end=list(cluster[-1]["position_3d"]),
            trajectory=self._sample_trajectory(cluster)
        )

    @staticmethod
    def _sample_trajectory(cluster: List[Dict[str, Any]], max_points: int = 64) -> List[List[float]]:
        """Downsamples a sighting's labels to at most ``max_points`` [t, x, y] samples, always keeping the last one."""
        stride = max(1, len(cluster) // max_points)
        sampled = cluster[::stride]
        if sampled[-1] is not cluster[-1]:
            sampled = sampled + [cluster[-1]]
        return [[float(p["time"]), float(p["position_3d"][0]), float(p["position_3d"][1])] for p in sampled]
