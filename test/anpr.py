import os
import sys
import shutil
import re
from pathlib import Path
from typing import Dict, Any, List, Tuple

# ==============================================================================
# 0. HPC CACHE ISOLATION (MUST BE AT THE VERY TOP)
# ==============================================================================
PROJECT_ROOT = Path(__file__).resolve().parent
CACHE_DIR = PROJECT_ROOT / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Force all libraries to use the local cache instead of ~/.cache (prevents quota crashes)
os.environ["TORCH_HOME"] = str(CACHE_DIR / "torch")
os.environ["YOLO_CONFIG_DIR"] = str(CACHE_DIR / "ultralytics")
os.environ["HF_HOME"] = str(CACHE_DIR / "huggingface")

import cv2
import numpy as np
import pandas as pd
import torch
from ultralytics import YOLO
import supervision as sv
from fast_plate_ocr import LicensePlateRecognizer

# ==============================================================================
# 1. CONFIGURATION & PATH SETUP
# ==============================================================================
OUTPUT_DIR = PROJECT_ROOT / "output"

VEHICLE_MODEL_PATH = PROJECT_ROOT / "vehicle_detection_master_v1.pt"
LP_MODEL_PATH      = PROJECT_ROOT / "license-plate-finetune-v1m.pt"
VIDEO_PATH         = PROJECT_ROOT / "input.mp4"

# Create output subdirectories
DIR_ANNOTATED = OUTPUT_DIR / "annotated_frames"
DIR_CUTOUTS   = OUTPUT_DIR / "plate_cutouts"
DIR_METADATA  = OUTPUT_DIR / "metadata"

for d in [DIR_ANNOTATED, DIR_CUTOUTS, DIR_METADATA]:
    d.mkdir(parents=True, exist_ok=True)

# Validate files exist locally (No internet downloads on worker nodes)
for p in [VEHICLE_MODEL_PATH, LP_MODEL_PATH, VIDEO_PATH]:
    if not p.exists():
        raise FileNotFoundError(f"Missing required file: {p.name}. Make sure it is in {PROJECT_ROOT}")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[+] Using device: {DEVICE}")

# ==============================================================================
# 2. INITIALIZE MODELS & TRACKER
# ==============================================================================
print("[+] Initializing Vehicle YOLO, License Plate YOLO, and Plate OCR...")
vehicle_detector = YOLO(str(VEHICLE_MODEL_PATH)).to(DEVICE)
lp_detector      = YOLO(str(LP_MODEL_PATH)).to(DEVICE)
ocr_engine       = LicensePlateRecognizer("cct-s-v2-global-model")

byte_tracker = sv.ByteTrack(
    track_activation_threshold=0.45,
    lost_track_buffer=30,
    minimum_matching_threshold=0.60,
    frame_rate=25
)

# ==============================================================================
# 3. CORE PROCESSING FUNCTION
# ==============================================================================
def process_anpr_frame(
    frame: np.ndarray,
    frame_id: int = 0,
    vehicle_conf: float = 0.25,
    lp_conf: float = 0.25,
    crop_padding: float = 0.10,
    save_annotated: bool = True
) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
    
    if frame is None or frame.size == 0:
        return frame, []

    h, w = frame.shape[:2]
    annotated = frame.copy()
    frame_results: List[Dict[str, Any]] = []

    veh_results = vehicle_detector.predict(source=frame, conf=vehicle_conf, verbose=False, device=DEVICE)
    sv_detections = sv.Detections.from_ultralytics(veh_results[0])
    
    # Optional Debug: Draw raw vehicle detections
    for box in sv_detections.xyxy:
        rx1, ry1, rx2, ry2 = box.astype(int)
        cv2.rectangle(annotated, (rx1, ry1), (rx2, ry2), (0, 0, 255), 1)
    
    tracked_vehicles = byte_tracker.update_with_detections(sv_detections)

    for idx in range(len(tracked_vehicles)):
        vx1, vy1, vx2, vy2 = tracked_vehicles.xyxy[idx].astype(int)
        v_conf = float(tracked_vehicles.confidence[idx]) if tracked_vehicles.confidence is not None else 0.0
        v_id   = int(tracked_vehicles.tracker_id[idx]) if tracked_vehicles.tracker_id is not None else idx

        pw, ph = int((vx2 - vx1) * crop_padding), int((vy2 - vy1) * crop_padding)
        crop_x1, crop_y1 = max(0, vx1 - pw), max(0, vy1 - ph)
        crop_x2, crop_y2 = min(w, vx2 + pw), min(h, vy2 + ph)

        veh_crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
        
        lp_found = False
        global_lp_bbox = None
        lp_score = 0.0
        plate_text = "NO_PLATE"
        cutout_filename = ""

        if veh_crop.size > 0:
            lp_res = lp_detector.predict(source=veh_crop, conf=lp_conf, imgsz=640, verbose=False, device=DEVICE)
            
            if lp_res and lp_res[0].boxes and len(lp_res[0].boxes) > 0:
                best_box = max(lp_res[0].boxes, key=lambda b: float(b.conf[0]))
                lx1, ly1, lx2, ly2 = best_box.xyxy[0].cpu().numpy().astype(int)
                lp_score = float(best_box.conf[0].cpu().numpy())

                lx1, ly1 = max(0, lx1), max(0, ly1)
                lx2, ly2 = min(veh_crop.shape[1], lx2), min(veh_crop.shape[0], ly2)

                if lx2 > lx1 and ly2 > ly1:
                    lp_cutout = veh_crop[ly1:ly2, lx1:lx2]
                    lp_found = True

                    global_lp_bbox = [crop_x1 + lx1, crop_y1 + ly1, crop_x1 + lx2, crop_y1 + ly2]

                    cutout_filename = f"frame_{frame_id:06d}_veh_{v_id:04d}_lp.jpg"
                    cv2.imwrite(str(DIR_CUTOUTS / cutout_filename), lp_cutout, [cv2.IMWRITE_JPEG_QUALITY, 95])

                    try:
                        res = ocr_engine.run(lp_cutout)
                        raw_text = getattr(res, 'text', str(res[0] if isinstance(res, (list, tuple)) else res))
                        clean_text = re.sub(r"[^A-Z0-9]", "", raw_text.upper()).strip()
                        plate_text = clean_text if clean_text else "UNREADABLE"
                    except Exception:
                        plate_text = "UNREADABLE"

        cv2.rectangle(annotated, (vx1, vy1), (vx2, vy2), (255, 200, 0), 2)
        cv2.putText(annotated, f"ID: {v_id}", (vx1, max(20, vy1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 0), 2)

        if lp_found and global_lp_bbox:
            gx1, gy1, gx2, gy2 = global_lp_bbox
            cv2.rectangle(annotated, (gx1, gy1), (gx2, gy2), (0, 255, 0), 2)
            cv2.putText(annotated, f"{plate_text}", (gx1, max(20, gy1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)

        frame_results.append({
            "frame_id": frame_id,
            "vehicle_id": v_id,
            "vehicle_bbox": [vx1, vy1, vx2, vy2],
            "vehicle_conf": round(v_conf, 4),
            "plate_detected": lp_found,
            "plate_bbox": global_lp_bbox if lp_found else None,
            "plate_confidence": round(lp_score, 4) if lp_found else None,
            "plate_text": plate_text,
            "cutout_path": str(DIR_CUTOUTS / cutout_filename) if cutout_filename else None
        })

    if save_annotated:
        cv2.imwrite(str(DIR_ANNOTATED / f"annotated_frame_{frame_id:06d}.jpg"), annotated)

    return annotated, frame_results

# ==============================================================================
# 4. EXECUTION
# ==============================================================================
if __name__ == "__main__":
    cap = cv2.VideoCapture(str(VIDEO_PATH))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"[+] Processing Video: {VIDEO_PATH.name} ({total_frames} frames)")

    all_video_results = []
    frame_counter = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        annotated_frame, detections = process_anpr_frame(
            frame=frame,
            frame_id=frame_counter,
            vehicle_conf=0.25, 
            lp_conf=0.25,
            save_annotated=True 
        )
        
        all_video_results.extend(detections)
        frame_counter += 1

        if frame_counter % 50 == 0:
            print(f"  ...processed {frame_counter}/{total_frames} frames", flush=True)

    cap.release()

    df_results = pd.DataFrame(all_video_results)
    csv_path = DIR_METADATA / "anpr_results.csv"
    df_results.to_csv(csv_path, index=False)
    
    print("\n[+] PIPELINE COMPLETE")
    print(f"Results saved to: {csv_path}")