"""
LUMPI multi-camera fusion replay.

Runs TraceNet's own detector + ByteTrack on the three synchronized LUMPI camera clips of one
experiment, back-projects every detection's foot point through the real camera calibration onto
the shared ground plane, fuses per-camera tracks into cross-camera identities by co-temporal
ground distance, and writes browser-playable clips plus a JSON the UI overlays interactively.

Everything is written under backend/data/evaluation/lumpi/replay/exp{N}/ (served via /data).
"""
import os
import csv
import json
import math
import glob
import time
import shutil
import colorsys
import subprocess
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
from loguru import logger

from app.config import get_data_path
from app.analytics.lumpi.adapter import LumpiAdapter, LumpiCameraInfo, rodrigues_to_matrix
from app.runtime.device import get_device, use_half_precision

REPLAY_FPS_FALLBACK = 30.0
MIN_TRACK_FRAMES = 3                 # drop one/two-frame tracker flickers
MIN_COMMON_FRAMES = 3                # frames two tracks must share before they can be fused
FUSE_RADIUS_M = {"person": 2.0, "vehicle": 3.5}
MAX_GROUND_RANGE_M = 120.0           # foot points farther than this from the camera are not on the road (roof/sky false positives)
BOUNDS_PERCENTILE = (2.0, 98.0)      # map extent from robust percentiles so one stray point cannot squash the view
GID_SEED_HUE = 0.61


def gid_color(gid: int) -> str:
    """Stable, well-separated hex colour per global identity (golden-ratio hue walk)."""
    h = (GID_SEED_HUE + gid * 0.618033988749895) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.72, 0.98)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


def class_to_object_type(name: str) -> str:
    n = (name or "").lower()
    if "pedestr" in n or "person" in n or "people" in n:
        return "person"
    return "vehicle"


class _UnionFind:
    def __init__(self):
        self.parent: Dict[Tuple[str, int], Tuple[str, int]] = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


class LumpiReplayBuilder:
    def __init__(
        self,
        experiment_id: int = 1,
        weights_path: Optional[str] = None,
        conf: float = 0.3,
        imgsz: int = 1280,
        dataset_path: Optional[str] = None,
        progress_cb: Optional[Callable[[float, str], None]] = None,
    ):
        self.experiment_id = int(experiment_id)
        self.conf = float(conf)
        self.imgsz = int(imgsz)
        self.adapter = LumpiAdapter(dataset_path=dataset_path)
        self.weights_path = weights_path or self._default_weights()
        self.out_dir = get_data_path(f"evaluation/lumpi/replay/exp{self.experiment_id}")
        self.json_path = os.path.join(self.out_dir, "replay.json")
        self.progress_cb = progress_cb

    # ------------------------------------------------------------------ discovery

    @staticmethod
    def _default_weights() -> str:
        preferred = get_data_path("models/vehicle_detector.pt")
        if os.path.exists(preferred):
            return preferred
        candidates = sorted(glob.glob(get_data_path("models/*.pt")))
        if candidates:
            return candidates[0]
        fallback = os.path.join(os.path.dirname(get_data_path("")), "yolo11n.pt")
        return fallback

    def status(self) -> Dict[str, Any]:
        built = os.path.exists(self.json_path)
        info: Dict[str, Any] = {
            "experiment_id": self.experiment_id,
            "built": built,
            "json_url": f"/data/evaluation/lumpi/replay/exp{self.experiment_id}/replay.json" if built else None,
            "generated_at": None,
            "model": None,
            "stats": None,
        }
        if built:
            try:
                with open(self.json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                info["generated_at"] = data.get("generated_at")
                info["model"] = data.get("model")
                info["stats"] = data.get("stats")
            except Exception:
                pass
        return info

    def _report(self, pct: float, msg: str) -> None:
        logger.info(f"LUMPI replay exp{self.experiment_id} {pct:5.1f}% – {msg}")
        if self.progress_cb:
            try:
                self.progress_cb(pct, msg)
            except Exception:
                pass

    # ------------------------------------------------------------------ geometry

    def _ground_z(self) -> float:
        """Ground height = median over labels of (box centre z − box height / 2)."""
        meas_dir = os.path.join(self.adapter.dataset_path, f"Measurement{self.experiment_id}")
        label_csv = self.adapter._find_label_csv(meas_dir)
        if not label_csv:
            return 0.0
        vals = []
        with open(label_csv, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                try:
                    vals.append(float(row[11]) - float(row[14]) / 2.0)
                except (ValueError, IndexError):
                    continue
        return float(np.median(vals)) if vals else 0.0

    @staticmethod
    def _camera_geometry(cam: LumpiCameraInfo):
        R = rodrigues_to_matrix(cam.rvec)
        t = np.asarray(cam.tvec, dtype=float)
        K = np.asarray(cam.intrinsic, dtype=float)
        K_inv = np.linalg.inv(K)
        C = -R.T @ t  # camera centre in world coordinates
        return R, t, K_inv, C

    @staticmethod
    def _pixel_to_ground(u: float, v: float, R, K_inv, C, ground_z: float) -> Optional[Tuple[float, float]]:
        d_cam = K_inv @ np.array([u, v, 1.0])
        a = R.T @ d_cam
        if abs(a[2]) < 1e-9:
            return None
        s = (ground_z - C[2]) / a[2]
        if s <= 0:
            return None
        p = C + s * a
        return float(p[0]), float(p[1])

    # ------------------------------------------------------------------ build

    def build(self) -> Dict[str, Any]:
        t_build = time.time()
        import cv2
        import supervision as sv
        from ultralytics import YOLO
        from app.detection.tracker import ByteTrackWrapper, TrackerConfig
        from app.preprocess.preprocessor import VideoPreprocessor

        if not self.adapter.is_dataset_available():
            raise FileNotFoundError(f"LUMPI dataset not found at {self.adapter.dataset_path}")
        meta = self.adapter._read_meta()
        cameras = self.adapter._parse_cameras(meta, self.experiment_id)
        cameras = {k: c for k, c in cameras.items() if c.can_project()}
        if not cameras:
            raise ValueError(f"Experiment {self.experiment_id} has no calibrated camera sessions.")

        meas_dir = os.path.join(self.adapter.dataset_path, f"Measurement{self.experiment_id}")
        videos: Dict[str, str] = {}
        for cam_id, cam in cameras.items():
            vp = os.path.join(meas_dir, "cam", str(cam.device_id), "video.mp4")
            if os.path.exists(vp):
                videos[cam_id] = vp
        if not videos:
            raise FileNotFoundError(f"No camera videos under {os.path.join(meas_dir, 'cam')}")

        os.makedirs(self.out_dir, exist_ok=True)
        ground_z = self._ground_z()
        self._report(2, f"{len(videos)} camera clips, ground plane z={ground_z:.2f} m, weights={os.path.basename(self.weights_path)}")

        model = YOLO(self.weights_path)
        class_names = {int(k): str(v) for k, v in model.names.items()}

        # ---------- pass 1: detect + track + ground-project every camera
        per_frame: Dict[str, List[List[Dict[str, Any]]]] = {}   # cam -> frames -> detections
        local_tracks: Dict[Tuple[str, int], Dict[str, Any]] = {}
        fps_by_cam: Dict[str, float] = {}
        size_by_cam: Dict[str, Tuple[int, int]] = {}
        total_dets = 0
        cam_list = list(videos.keys())

        for ci, cam_id in enumerate(cam_list):
            cam = cameras[cam_id]
            R, t, K_inv, C = self._camera_geometry(cam)
            cap = cv2.VideoCapture(videos[cam_id])
            fps = cap.get(cv2.CAP_PROP_FPS) or REPLAY_FPS_FALLBACK
            n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps_by_cam[cam_id] = float(fps)
            size_by_cam[cam_id] = (w, h)
            tracker = ByteTrackWrapper(TrackerConfig(track_activation_threshold=self.conf, max_time_lost=int(fps)))
            frames: List[List[Dict[str, Any]]] = []
            f_idx = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                result = model.predict(frame, conf=self.conf, imgsz=self.imgsz, verbose=False, device=get_device())[0]
                dets = sv.Detections.from_ultralytics(result)
                tracked = tracker.update(dets)
                frame_dets: List[Dict[str, Any]] = []
                if tracked.tracker_id is not None:
                    for k in range(len(tracked)):
                        tid = int(tracked.tracker_id[k])
                        x1, y1, x2, y2 = [float(v) for v in tracked.xyxy[k]]
                        cls_id = int(tracked.class_id[k]) if tracked.class_id is not None else -1
                        cls_name = class_names.get(cls_id, str(cls_id))
                        conf = float(tracked.confidence[k]) if tracked.confidence is not None else 0.0
                        g = self._pixel_to_ground((x1 + x2) / 2.0, y2, R, K_inv, C, ground_z)
                        if g and math.hypot(g[0] - C[0], g[1] - C[1]) > MAX_GROUND_RANGE_M:
                            g = None  # projects beyond the visible road surface: keep the box, skip fusion/map
                        d = {"tid": tid, "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                             "conf": round(conf, 3), "cls": cls_name, "type": class_to_object_type(cls_name),
                             "g": [round(g[0], 2), round(g[1], 2)] if g else None}
                        frame_dets.append(d)
                        lt = local_tracks.setdefault((cam_id, tid), {"frames": [], "points": {}, "cls": {}, "type": {}})
                        lt["frames"].append(f_idx)
                        if g:
                            lt["points"][f_idx] = g
                        lt["cls"][cls_name] = lt["cls"].get(cls_name, 0) + 1
                        lt["type"][d["type"]] = lt["type"].get(d["type"], 0) + 1
                frames.append(frame_dets)
                total_dets += len(frame_dets)
                f_idx += 1
                if n_frames and f_idx % 16 == 0:
                    self._report(5 + 55 * (ci + f_idx / n_frames) / len(cam_list), f"camera {cam_id}: frame {f_idx}/{n_frames}")
            cap.release()
            per_frame[cam_id] = frames

        frame_count = min(len(v) for v in per_frame.values())
        fps = float(np.median(list(fps_by_cam.values()))) if fps_by_cam else REPLAY_FPS_FALLBACK

        # ---------- consolidate local tracks
        for key, lt in list(local_tracks.items()):
            if len(lt["frames"]) < MIN_TRACK_FRAMES or not lt["points"]:
                del local_tracks[key]
                continue
            lt["cls_name"] = max(lt["cls"].items(), key=lambda kv: kv[1])[0]
            lt["object_type"] = max(lt["type"].items(), key=lambda kv: kv[1])[0]
        self._report(62, f"{total_dets} detections → {len(local_tracks)} local tracks; fusing across cameras")

        # ---------- cross-camera fusion by co-temporal ground distance
        uf = _UnionFind()
        for key in local_tracks:
            uf.find(key)
        pair_costs: List[Tuple[float, Tuple[str, int], Tuple[str, int]]] = []
        keys = list(local_tracks.keys())
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                a, b = keys[i], keys[j]
                if a[0] == b[0]:
                    continue  # same camera: never fuse
                la, lb = local_tracks[a], local_tracks[b]
                if la["object_type"] != lb["object_type"]:
                    continue
                common = sorted(set(la["points"]) & set(lb["points"]))
                if len(common) < MIN_COMMON_FRAMES:
                    continue
                d = [math.hypot(la["points"][f][0] - lb["points"][f][0], la["points"][f][1] - lb["points"][f][1]) for f in common]
                mean_d = float(np.mean(d))
                if mean_d <= FUSE_RADIUS_M[la["object_type"]]:
                    pair_costs.append((mean_d, a, b))
        pair_costs.sort(key=lambda x: x[0])
        taken: Dict[Tuple[str, int], set] = {k: set() for k in keys}  # which other cameras a track is already matched to
        for cost, a, b in pair_costs:
            if b[0] in taken[a] or a[0] in taken[b]:
                continue
            # keep groups free of two tracks from the same camera
            ra, rb = uf.find(a), uf.find(b)
            if ra == rb:
                continue
            cams_a = {k[0] for k in keys if uf.find(k) == ra}
            cams_b = {k[0] for k in keys if uf.find(k) == rb}
            if cams_a & cams_b:
                continue
            uf.union(a, b)
            taken[a].add(b[0])
            taken[b].add(a[0])

        groups: Dict[Tuple[str, int], List[Tuple[str, int]]] = {}
        for k in keys:
            groups.setdefault(uf.find(k), []).append(k)
        ordered = sorted(groups.values(), key=lambda members: min(local_tracks[m]["frames"][0] for m in members))

        tracks_out: List[Dict[str, Any]] = []
        gid_of: Dict[Tuple[str, int], int] = {}
        for gid, members in enumerate(ordered, start=1):
            for m in members:
                gid_of[m] = gid
            fused_points: Dict[int, List[Tuple[float, float]]] = {}
            cls_votes: Dict[str, int] = {}
            type_votes: Dict[str, int] = {}
            for m in members:
                lt = local_tracks[m]
                for f, p in lt["points"].items():
                    fused_points.setdefault(f, []).append(p)
                for c, n in lt["cls"].items():
                    cls_votes[c] = cls_votes.get(c, 0) + n
                for c, n in lt["type"].items():
                    type_votes[c] = type_votes.get(c, 0) + n
            pts = [[f, round(float(np.mean([p[0] for p in ps])), 2), round(float(np.mean([p[1] for p in ps])), 2)] for f, ps in sorted(fused_points.items())]
            first = min(local_tracks[m]["frames"][0] for m in members)
            last = max(local_tracks[m]["frames"][-1] for m in members)
            tracks_out.append({
                "gid": gid,
                "object_type": max(type_votes.items(), key=lambda kv: kv[1])[0],
                "class_name": max(cls_votes.items(), key=lambda kv: kv[1])[0],
                "color": gid_color(gid),
                "cameras": sorted({m[0] for m in members}),
                "members": [{"camera_id": m[0], "track_id": m[1], "first_frame": local_tracks[m]["frames"][0], "last_frame": local_tracks[m]["frames"][-1]} for m in sorted(members)],
                "first_frame": first,
                "last_frame": last,
                "points": pts,
            })
        multi_cam = sum(1 for t in tracks_out if len(t["cameras"]) > 1)
        self._report(68, f"{len(tracks_out)} fused identities ({multi_cam} seen by 2+ cameras); rendering clips")

        # ---------- per-frame payload with global ids
        frames_out: List[Dict[str, Any]] = []
        for f in range(frame_count):
            cams_payload: Dict[str, List[List[Any]]] = {}
            for cam_id in cam_list:
                rows = []
                for d in per_frame[cam_id][f]:
                    gid = gid_of.get((cam_id, d["tid"]))
                    if gid is None:
                        continue
                    rows.append([gid, *d["bbox"], d["conf"]])
                cams_payload[cam_id] = rows
            frames_out.append(cams_payload)

        # ---------- pass 2: browser-playable clean + annotated clips
        ffmpeg = VideoPreprocessor.get_ffmpeg_binary()
        cam_entries: List[Dict[str, Any]] = []
        all_pts = [p for t in tracks_out for p in t["points"]]
        for ci, cam_id in enumerate(cam_list):
            cam = cameras[cam_id]
            R, t, K_inv, C = self._camera_geometry(cam)
            look = self._pixel_to_ground(cam.image_width / 2.0, cam.image_height / 2.0, R, K_inv, C, ground_z)
            clean_name = f"cam_{cam.device_id}.mp4"
            annot_name = f"cam_{cam.device_id}_annotated.mp4"
            clean_path = os.path.join(self.out_dir, clean_name)
            annot_path = os.path.join(self.out_dir, annot_name)

            # clean: straight transcode to H.264 (browser-safe)
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", videos[cam_id], "-c:v", "libx264", "-preset", "veryfast",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", clean_path], check=True)

            # annotated: draw global ids with OpenCV, then transcode
            tmp_path = os.path.join(self.out_dir, f"_tmp_{cam.device_id}.mp4")
            cap = cv2.VideoCapture(videos[cam_id])
            w, h = size_by_cam[cam_id]
            writer = cv2.VideoWriter(tmp_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
            f_idx = 0
            while True:
                ok, frame = cap.read()
                if not ok or f_idx >= frame_count:
                    break
                for gid, x1, y1, x2, y2, conf in frames_out[f_idx].get(cam_id, []):
                    col_hex = gid_color(gid)
                    bgr = (int(col_hex[5:7], 16), int(col_hex[3:5], 16), int(col_hex[1:3], 16))
                    tr = next((tt for tt in tracks_out if tt["gid"] == gid), None)
                    label = f"#{gid} {tr['class_name'] if tr else ''} {conf:.2f}"
                    thick = 3 if (tr and len(tr["cameras"]) > 1) else 2
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), bgr, thick)
                    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(frame, (int(x1), int(y1) - th - 6), (int(x1) + tw + 6, int(y1)), bgr, -1)
                    cv2.putText(frame, label, (int(x1) + 3, int(y1) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (15, 15, 15), 1, cv2.LINE_AA)
                    cv2.circle(frame, (int((x1 + x2) / 2), int(y2)), 4, bgr, -1)
                cv2.putText(frame, f"TraceNet detector + ByteTrack | LUMPI cam {cam.device_id} | fused IDs", (16, 32),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
                writer.write(frame)
                f_idx += 1
            cap.release()
            writer.release()
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", tmp_path, "-c:v", "libx264", "-preset", "veryfast",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", annot_path], check=True)
            os.remove(tmp_path)

            cam_entries.append({
                "camera_id": cam_id,
                "device_id": cam.device_id,
                "name": f"LUMPI cam {cam.device_id}",
                "width": w,
                "height": h,
                "fps_native": fps_by_cam[cam_id],
                "video_url": f"/data/evaluation/lumpi/replay/exp{self.experiment_id}/{clean_name}",
                "annotated_video_url": f"/data/evaluation/lumpi/replay/exp{self.experiment_id}/{annot_name}",
                "position": [round(float(C[0]), 2), round(float(C[1]), 2), round(float(C[2]), 2)],
                "look_at": [round(look[0], 2), round(look[1], 2)] if look else None,
                "sightings": sum(1 for tt in tracks_out if cam_id in tt["cameras"]),
            })
            self._report(70 + 28 * (ci + 1) / len(cam_list), f"rendered camera {cam_id}")

        xs = np.asarray([p[1] for p in all_pts] or [0.0], dtype=float)
        ys = np.asarray([p[2] for p in all_pts] or [0.0], dtype=float)
        lo, hi = BOUNDS_PERCENTILE
        min_x, max_x = float(np.percentile(xs, lo)), float(np.percentile(xs, hi))
        min_y, max_y = float(np.percentile(ys, lo)), float(np.percentile(ys, hi))
        for ce in cam_entries:  # cameras always stay inside the map
            min_x, max_x = min(min_x, ce["position"][0]), max(max_x, ce["position"][0])
            min_y, max_y = min(min_y, ce["position"][1]), max(max_y, ce["position"][1])
        bounds = {"min_x": round(min_x - 5, 1), "max_x": round(max_x + 5, 1), "min_y": round(min_y - 5, 1), "max_y": round(max_y + 5, 1)}

        replay = {
            "experiment_id": self.experiment_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dataset_path": self.adapter.dataset_path,
            "model": {"weights": os.path.basename(self.weights_path), "classes": list(class_names.values()), "conf": self.conf, "imgsz": self.imgsz, "tracker": "ByteTrack (supervision)"},
            "fps": fps,
            "frame_count": frame_count,
            "duration_s": round(frame_count / fps, 3),
            "ground_z": round(ground_z, 3),
            "bounds": bounds,
            "fusion": {"radius_m": FUSE_RADIUS_M, "min_common_frames": MIN_COMMON_FRAMES},
            "cameras": cam_entries,
            "tracks": tracks_out,
            "frames": frames_out,
            "stats": {
                "detections": total_dets,
                "local_tracks": len(local_tracks),
                "fused_tracks": len(tracks_out),
                "multi_camera_tracks": multi_cam,
                "build_seconds": round(time.time() - t_build, 1),
            },
        }
        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump(replay, f)
        self._report(100, f"replay written to {self.json_path} in {replay['stats']['build_seconds']}s")
        return replay

    def clear(self) -> None:
        if os.path.isdir(self.out_dir):
            shutil.rmtree(self.out_dir, ignore_errors=True)
