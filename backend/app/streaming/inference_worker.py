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
            if cam and cam.model_id:
                model_db = db.query(MLModel).filter(MLModel.id == cam.model_id).first()
                if model_db:
                    model_path = get_data_path(model_db.file_path)
                else:
                    model_path = get_data_path("models/best.pt")
            else:
                model_path = get_data_path("models/best.pt")
                
            model = YOLO(model_path)
            pose_model = None
            if self.config.enable_pose:
                pose_model = YOLO(self.config.pose_model_name)
                
            tracker = sv.ByteTrack(lost_track_buffer=30, frame_rate=30)
            
            cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
            
            frame_interval = 1.0 / self.config.target_fps if self.config.target_fps > 0 else 0
            last_frame_time = 0
            
            while not self._stop_event.is_set():
                ret, frame = cap.read()
                if not ret:
                    time.sleep(0.1)
                    continue
                    
                current_time = time.time()
                if frame_interval > 0 and (current_time - last_frame_time < frame_interval):
                    continue
                    
                last_frame_time = current_time
                start_inf = time.time()
                
                results = model.predict(frame, conf=self.config.confidence_threshold, iou=self.config.iou_threshold, verbose=False)
                
                keypoints_data = None
                if self.config.enable_pose and pose_model:
                    pose_res = pose_model.predict(frame, verbose=False)
                    if pose_res[0].keypoints is not None:
                        kps_xy = pose_res[0].keypoints.xy.cpu().numpy()
                        kps_conf = pose_res[0].keypoints.conf.cpu().numpy()
                        keypoints_data = {"xy": kps_xy.tolist(), "conf": kps_conf.tolist()}
                        
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
                self.inference_ms = self.inference_ms * 0.9 + inf_time * 0.1
                self.frame_count += 1
                
                if self.frame_count % 10 == 0:
                    self.fps = 1000.0 / self.inference_ms if self.inference_ms > 0 else 0
                
                payload = {
                    "camera_id": self.camera_id,
                    "frame_count": self.frame_count,
                    "inference_ms": self.inference_ms,
                    "fps": self.fps,
                    "detections": payload_dets,
                    "keypoints": keypoints_data,
                    "alerts": alerts
                }
                
                self.manager.broadcast_to_clients(self.camera_id, payload)
                
            cap.release()
            logger.info(f"InferenceWorker for {self.camera_id} stopped")
        except Exception as e:
            logger.error(f"InferenceWorker error: {e}")
        finally:
            db.close()
            
    def stop(self):
        self._stop_event.set()
