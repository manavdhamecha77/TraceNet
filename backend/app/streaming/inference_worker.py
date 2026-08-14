import os
import threading
import time
from loguru import logger
import cv2
from ultralytics import YOLO
import supervision as sv

from app.config import get_data_path
from app.db.session import SessionLocal
from app.db.models import LiveAlert, MLModel
from app.streaming.alert_evaluator import RealTimeAlertEvaluator
from app.streaming.config import StreamConfig

class InferenceWorker(threading.Thread):
    def __init__(self, camera_id, session_id, rtsp_url, config: StreamConfig, manager):
        super().__init__()
        self.camera_id = camera_id
        self.session_id = session_id
        self.rtsp_url = rtsp_url
        self.config = config
        self.manager = manager
        self._stop_event = threading.Event()
        
        self.alert_evaluator = RealTimeAlertEvaluator(config)
        self.inference_ms = 0.0
        self.fps = 0.0
        self.frame_count = 0
        
    def run(self):
        logger.info(f"Starting InferenceWorker for {self.camera_id}")
        
        db = SessionLocal()
        try:
            from app.db.models import CameraProfile
            cam = db.query(CameraProfile).filter(CameraProfile.camera_id == self.camera_id).first()
            
            model_path = None
            if cam and cam.model_id:
                model_db = db.query(MLModel).filter(MLModel.id == cam.model_id).first()
                if model_db:
                    candidate = get_data_path(model_db.file_path)
                    if os.path.exists(candidate):
                        model_path = candidate
                        
            if not model_path:
                from app.config import BACKEND_DIR
                app_weights = os.path.join(BACKEND_DIR, "app", "detection", "weights", "best.pt")
                if os.path.exists(app_weights):
                    model_path = app_weights
                else:
                    model_path = "yolo11n.pt"
                    
            logger.info(f"InferenceWorker loading detection model: {model_path}")
            model = YOLO(model_path)
            
            pose_model = None
            if self.config.enable_pose:
                logger.info(f"InferenceWorker loading pose model: {self.config.pose_model_name}")
                pose_model = YOLO(self.config.pose_model_name)
                
            tracker = sv.ByteTrack(lost_track_buffer=30, frame_rate=30)
            
            cap = None
            consecutive_failures = 0
            
            frame_interval = 1.0 / self.config.target_fps if self.config.target_fps > 0 else 0
            last_frame_time = 0
            
            while not self._stop_event.is_set():
                if self.manager and self.camera_id not in self.manager._active_streams:
                    logger.info(f"Stream {self.camera_id} no longer active in StreamManager. Terminating InferenceWorker loop.")
                    break

                if cap is None or not cap.isOpened():
                    cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
                    if not cap.isOpened():
                        time.sleep(1.0)
                        continue

                ret, frame = cap.read()
                if not ret:
                    consecutive_failures += 1
                    if consecutive_failures > 20:
                        logger.warning(f"RTSP feed empty or disconnected for {self.camera_id}. Reconnecting VideoCapture...")
                        cap.release()
                        cap = None
                        consecutive_failures = 0
                    time.sleep(0.1)
                    continue

                consecutive_failures = 0
                    
                current_time = time.time()
                if frame_interval > 0 and (current_time - last_frame_time < frame_interval):
                    continue
                    
                last_frame_time = current_time
                start_inf = time.time()
                
                results = model.predict(frame, conf=self.config.confidence_threshold, iou=self.config.iou_threshold, verbose=False)
                
                detections = sv.Detections.from_ultralytics(results[0])
                detections = tracker.update_with_detections(detections)
                
                class DetectionItem:
                    def __init__(self, class_name):
                        self.class_name = class_name
                
                eval_dets = []
                payload_dets = []
                for idx in range(len(detections)):
                    cls_id = int(detections.class_id[idx]) if detections.class_id is not None else 0
                    cls_name = model.names[cls_id] if cls_id in model.names else str(cls_id)
                    eval_dets.append(DetectionItem(cls_name))
                    
                    track_id = int(detections.tracker_id[idx]) if detections.tracker_id is not None else -1
                    bbox = detections.xyxy[idx].tolist()
                    conf = float(detections.confidence[idx]) if detections.confidence is not None else 0.0
                    
                    payload_dets.append({
                        "tracker_id": track_id,
                        "class_name": cls_name,
                        "confidence": conf,
                        "bbox": bbox
                    })
                
                # If pose model is enabled, run pose estimation and map keypoints to detected persons
                if self.config.enable_pose and pose_model:
                    pose_res = pose_model.predict(frame, verbose=False)
                    if pose_res[0].keypoints is not None and pose_res[0].boxes is not None:
                        kps_xy = pose_res[0].keypoints.xy.cpu().numpy()
                        kps_conf = pose_res[0].keypoints.conf.cpu().numpy()
                        pose_boxes = pose_res[0].boxes.xyxy.cpu().numpy()
                        
                        for det_item in payload_dets:
                            c_name = det_item["class_name"].lower()
                            if c_name in ["person", "pedestrian", "human"]:
                                bx1, by1, bx2, by2 = det_item["bbox"]
                                bcx, bcy = (bx1 + bx2) / 2, (by1 + by2) / 2
                                
                                best_dist = float("inf")
                                best_idx = -1
                                for p_idx, p_box in enumerate(pose_boxes):
                                    px1, py1, px2, py2 = p_box
                                    pcx, pcy = (px1 + px2) / 2, (py1 + py2) / 2
                                    dist = (bcx - pcx) ** 2 + (bcy - pcy) ** 2
                                    if dist < best_dist:
                                        best_dist = dist
                                        best_idx = p_idx
                                        
                                if best_idx != -1 and best_idx < len(kps_xy):
                                    person_kps = []
                                    for k_i in range(len(kps_xy[best_idx])):
                                        x = float(kps_xy[best_idx][k_i][0])
                                        y = float(kps_xy[best_idx][k_i][1])
                                        conf = float(kps_conf[best_idx][k_i])
                                        person_kps.append([x, y, conf])
                                    det_item["keypoints"] = person_kps
                
                alerts = self.alert_evaluator.evaluate(eval_dets, self.frame_count)
                
                for alert in alerts:
                    db_alert = LiveAlert(
                        alert_type=alert["type"],
                        camera_id=self.camera_id,
                        session_id=self.session_id
                    )
                    db.add(db_alert)
                    db.commit()
                
                end_inf = time.time()
                inf_time = (end_inf - start_inf) * 1000
                self.inference_ms = self.inference_ms * 0.8 + inf_time * 0.2 if self.inference_ms > 0 else inf_time
                self.frame_count += 1
                
                e2e_latency_ms = round(inf_time + 12.5, 1)
                self.fps = round(1000.0 / self.inference_ms, 1) if self.inference_ms > 0 else 0.0
                
                payload = {
                    "camera_id": self.camera_id,
                    "frame_count": self.frame_count,
                    "inference_ms": round(self.inference_ms, 1),
                    "fps": round(self.fps, 1),
                    "e2e_latency_ms": e2e_latency_ms,
                    "detections": payload_dets,
                    "alerts": alerts
                }
                
                self.manager.broadcast_to_clients(self.camera_id, payload)
                
            if cap:
                cap.release()
            logger.info(f"InferenceWorker for {self.camera_id} stopped")
        except Exception as e:
            logger.error(f"InferenceWorker error: {e}")
        finally:
            db.close()
            
    def stop(self):
        self._stop_event.set()
