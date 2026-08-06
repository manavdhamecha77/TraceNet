import math
import json
from typing import Dict, List, Tuple, Optional
from sqlalchemy.orm import Session
from app.db.models import CameraProfile

# Speed limits in meters per second (m/s)
SPEED_BOUNDS = {
    "pedestrian": {
        "v_min": 0.3,   # ~1.08 km/h
        "v_max": 4.5,   # ~16.2 km/h (fast sprint / cycling)
        "v_ideal": 1.4  # ~5.0 km/h (average walking speed)
    },
    "vehicle": {
        "v_min": 1.5,   # ~5.4 km/h (heavy traffic / idling)
        "v_max": 35.0,  # ~126 km/h (highway speed limit)
        "v_ideal": 13.8 # ~50 km/h (city driving speed)
    }
}


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the Great Circle distance between two points in meters."""
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return 0.0
    if lat1 == lat2 and lon1 == lon2:
        return 0.0

    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


class CameraSpatialGraph:
    """Graph helper for multi-camera spatial-temporal routing and feasibility checks."""

    def __init__(self, db_session: Session):
        self.db = db_session
        self.cameras: Dict[str, CameraProfile] = {}
        self._load_cameras()

    def _load_cameras(self):
        cams = self.db.query(CameraProfile).all()
        for c in cams:
            self.cameras[c.camera_id] = c

    def get_distance(self, cam_id_a: str, cam_id_b: str) -> float:
        """Returns distance in meters between two cameras."""
        if cam_id_a == cam_id_b:
            return 0.0

        cam_a = self.cameras.get(cam_id_a)
        cam_b = self.cameras.get(cam_id_b)

        if not cam_a or not cam_b:
            return 500.0  # Fallback default distance if coordinates unassigned

        if cam_a.latitude is not None and cam_a.longitude is not None and cam_b.latitude is not None and cam_b.longitude is not None:
            dist = haversine_distance_meters(cam_a.latitude, cam_a.longitude, cam_b.latitude, cam_b.longitude)
            return dist if dist > 0 else 50.0

        return 500.0

    def check_transition_feasibility(
        self,
        cam_id_a: str,
        t_a: float,
        cam_id_b: str,
        t_b: float,
        speed_mode: str = "pedestrian"
    ) -> Tuple[bool, float, float]:
        """
        Check if moving from (cam_id_a at t_a) to (cam_id_b at t_b) is physically feasible.
        Returns: (is_feasible, speed_m_s, distance_meters)
        """
        delta_t = t_b - t_a
        if delta_t <= 0:
            # Cannot travel back in time or instant teleportation
            return False, 0.0, 0.0

        dist_m = self.get_distance(cam_id_a, cam_id_b)
        speed = dist_m / delta_t

        bounds = SPEED_BOUNDS.get(speed_mode, SPEED_BOUNDS["pedestrian"])

        # Allow generous bounds if cameras are the same (same location dwell)
        if cam_id_a == cam_id_b:
            return True, speed, dist_m

        if bounds["v_min"] <= speed <= bounds["v_max"]:
            return True, speed, dist_m

        # Also allow reasonable grace if distance is short (< 100m) and delta_t is reasonably large
        if dist_m <= 100.0 and delta_t >= 5.0 and speed <= bounds["v_max"] * 1.5:
            return True, speed, dist_m

        return False, speed, dist_m

    def get_downstream_neighbors(
        self,
        origin_cam_id: str,
        max_distance_meters: float = 3000.0
    ) -> List[Dict]:
        """Returns adjacent and nearby camera nodes within radius or adjacency list."""
        origin = self.cameras.get(origin_cam_id)
        if not origin:
            return []

        # Parse explicitly listed adjacencies
        try:
            adj_ids = json.loads(origin.adjacency) if origin.adjacency else []
        except Exception:
            adj_ids = []

        neighbors = []
        for cam_id, cam in self.cameras.items():
            if cam_id == origin_cam_id or not cam.is_active:
                continue

            dist_m = self.get_distance(origin_cam_id, cam_id)
            is_explicit = cam_id in adj_ids

            if is_explicit or dist_m <= max_distance_meters:
                neighbors.append({
                    "camera_id": cam_id,
                    "name": cam.name,
                    "latitude": cam.latitude,
                    "longitude": cam.longitude,
                    "distance_meters": round(dist_m, 1),
                    "is_direct_neighbor": is_explicit
                })

        # Sort by distance
        neighbors.sort(key=lambda x: x["distance_meters"])
        return neighbors
