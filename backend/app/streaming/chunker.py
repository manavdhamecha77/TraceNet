import os
import glob
import time
import cv2
import shutil
import hashlib
import subprocess
import threading
from datetime import datetime, timezone
from app.config import get_data_path
from app.db.session import SessionLocal
from app.db.models import StreamChunk, LiveStreamSession, VideoAsset, CameraProfile, MLModel
from app.preprocess.preprocessor import VideoPreprocessor, sanitize_filename, calculate_file_sha256
from app.detection.detector import DetectionService
from app.embeddings.tracklet_embeddings import TrackletEmbeddingService
from app.search.vector_index import VectorIndexService
from loguru import logger

class StreamChunker:
    def __init__(self, camera_id, session_id, rtsp_url, config, manager=None):
        self.camera_id = camera_id
        self.session_id = session_id
        self.rtsp_url = rtsp_url
        self.config = config
        self.manager = manager
        self.process = None
        self._stop_event = threading.Event()
        self._thread = None
        self._recorded_files = set()

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _emit_log(self, chunk_idx: int, stage: str, message: str, progress: int = 0, level: str = "INFO"):
        """Broadcasts pipeline log updates to frontend WebSocket subscribers in real time."""
        log_payload = {
            "type": "pipeline_log",
            "log": {
                "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "chunk_index": chunk_idx,
                "stage": stage,
                "message": message,
                "progress": progress,
                "level": level
            }
        }
        logger.info(f"[LivePipeline {self.camera_id} #{chunk_idx} ({progress}%)] {message}")
        if self.manager:
            try:
                self.manager.broadcast_to_clients(self.camera_id, log_payload)
            except Exception as err:
                logger.warning(f"Could not broadcast pipeline log: {err}")

    def _run(self):
        output_dir = get_data_path(f"streams/{self.camera_id}/{self.session_id}")
        os.makedirs(output_dir, exist_ok=True)
        output_pattern = os.path.join(output_dir, "chunk_%Y%m%d_%H%M%S.mp4")

        ffmpeg_bin = VideoPreprocessor.get_ffmpeg_binary()
        seg_time_sec = int(self.config.max_chunk_duration_sec or 30)

        # FFmpeg command forcing keyframe placement at exact segment duration
        cmd = [
            ffmpeg_bin,
            "-y",
            "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-analyzeduration", "5000000",
            "-probesize", "5000000",
            "-i", self.rtsp_url,
            "-map", "0:v:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "23",
            "-g", str(seg_time_sec * 10),
            "-force_key_frames", f"expr:gte(t,n_forced*{seg_time_sec})",
            "-f", "segment",
            "-segment_time", str(seg_time_sec),
            "-segment_format", "mp4",
            "-reset_timestamps", "1",
            "-strftime", "1",
            output_pattern
        ]

        logger.info(f"FFmpeg chunker initialized for {self.camera_id} using executable '{ffmpeg_bin}' (segment_time={seg_time_sec}s)")

        chunk_idx = 0
        while not self._stop_event.is_set():
            if self.manager:
                status = self.manager.get_status(self.camera_id)
                if not status or not status.get("is_streaming"):
                    time.sleep(1.0)
                    continue

            try:
                self.process = subprocess.Popen(
                    cmd, 
                    stdout=subprocess.PIPE, 
                    stderr=subprocess.PIPE,
                    text=True
                )
                logger.info(f"FFmpeg chunker process spawned (PID {self.process.pid}) for {self.camera_id}")
                
                while not self._stop_event.is_set():
                    poll = self.process.poll()
                    if poll is not None:
                        err_out = self.process.stderr.read() if self.process.stderr else ""
                        logger.warning(f"FFmpeg chunker process exited with code {poll}. Stderr: {err_out[:300]}")
                        break
                    time.sleep(0.5)
                    chunk_idx = self._sync_recorded_chunks(output_dir, chunk_idx)

            except Exception as e:
                logger.error(f"FFmpeg chunker execution error for {self.camera_id}: {e}")
                time.sleep(2.0)

    def _sync_recorded_chunks(self, output_dir, current_idx, force_flush=False):
        mp4_files = sorted(glob.glob(os.path.join(output_dir, "*.mp4")))
        if not mp4_files:
            return current_idx

        db = SessionLocal()
        try:
            for filepath in mp4_files:
                if filepath in self._recorded_files:
                    continue
                # Skip current active segment file unless force_flush is True
                if not force_flush and filepath == mp4_files[-1]:
                    continue
                
                file_size = os.path.getsize(filepath)
                if file_size > 0:
                    self._recorded_files.add(filepath)
                    current_idx += 1
                    
                    filename = os.path.basename(filepath)
                    self._emit_log(current_idx, "recorded", f"Video chunk #{current_idx} recorded ({file_size} bytes, file: {filename})", progress=10)
                    
                    start_t = datetime.now(timezone.utc)
                    chunk = StreamChunk(
                        id=f"{self.session_id}_chk_{current_idx}",
                        session_id=self.session_id,
                        camera_id=self.camera_id,
                        chunk_index=current_idx,
                        file_path=filepath,
                        start_time=start_t,
                        duration_sec=self.config.max_chunk_duration_sec,
                        file_size_bytes=file_size
                    )
                    db.add(chunk)
                    
                    session = db.query(LiveStreamSession).filter(LiveStreamSession.id == self.session_id).first()
                    if session:
                        session.chunks_recorded = (session.chunks_recorded or 0) + 1
                    db.commit()

                    # Spawn asynchronous pipeline worker thread so RTSP chunking is never blocked
                    pipeline_thread = threading.Thread(
                        target=self._process_chunk_pipeline,
                        args=(current_idx, filepath, chunk.id, start_t),
                        daemon=True
                    )
                    pipeline_thread.start()

        except Exception as e:
            logger.error(f"Error recording stream chunk: {e}")
        finally:
            db.close()
        return current_idx

    def _process_chunk_pipeline(self, current_idx: int, filepath: str, chunk_id: str, start_t: datetime):
        """Asynchronous pipeline processor for recorded live chunks."""
        filename = os.path.basename(filepath)
        asset_id = f"vid_{chunk_id}"
        db = SessionLocal()

        try:
            camera = db.query(CameraProfile).filter(CameraProfile.camera_id == self.camera_id).first()
            cam_name = camera.name if (camera and camera.name) else self.camera_id
            camera_dir_name = f"{self.camera_id}_{sanitize_filename(cam_name)}"
            
            orig_dir = get_data_path(os.path.join("cameras", camera_dir_name, "original_assets"))
            trans_dir = get_data_path(os.path.join("cameras", camera_dir_name, "transcoded"))
            os.makedirs(orig_dir, exist_ok=True)
            os.makedirs(trans_dir, exist_ok=True)

            dest_orig = os.path.join(orig_dir, filename)
            dest_trans = os.path.join(trans_dir, filename)

            # Copy original asset
            shutil.copy2(filepath, dest_orig)
            intake_hash = calculate_file_sha256(dest_orig)

            # Create VideoAsset record with 'transcoding' status
            video_asset = VideoAsset(
                id=asset_id,
                camera_id=self.camera_id,
                original_filename=filename,
                standardized_filename=filename,
                intake_sha256=intake_hash,
                processing_status="transcoding",
                progress_percentage=15,
                upload_timestamp=datetime.now(timezone.utc),
                is_live_recording=True
            )
            db.add(video_asset)
            db.commit()

            # Determine original video FPS using OpenCV
            cap = cv2.VideoCapture(filepath)
            orig_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
            duration_sec = total_frames / orig_fps if orig_fps > 0 else float(self.config.max_chunk_duration_sec)
            cap.release()

            target_fps = 4 if orig_fps > 4 else int(max(1, orig_fps))
            self._emit_log(
                current_idx, 
                "preprocessing", 
                f"Started pre-processing chunk #{current_idx} (FFmpeg {target_fps} FPS resampling & 720p H.264 transcode)...",
                progress=25
            )

            # 1. Transcode & sample thumbnail
            VideoPreprocessor.transcode_video(dest_orig, dest_trans, fps=target_fps, resolution="1280:720")
            transcoded_hash = calculate_file_sha256(dest_trans)

            inference_dir = get_data_path(os.path.join("cameras", camera_dir_name, "inference", filename.replace(".mp4", "")))
            meta = VideoPreprocessor.sample_and_analyze(dest_trans, inference_dir, sampling_fps=4.0)

            video_asset.standardized_filename = filename
            video_asset.transcoded_sha256 = transcoded_hash
            video_asset.duration = duration_sec
            video_asset.start_time = start_t
            video_asset.end_time = datetime.now(timezone.utc)
            video_asset.thumbnail_path = meta.get("thumbnail_path")
            video_asset.processing_status = "preprocessed"
            video_asset.progress_percentage = 45
            db.commit()

            self._emit_log(current_idx, "preprocessed", f"Done pre-processing chunk #{current_idx} (720p 4-FPS asset & thumbnail ready)", progress=45)

            # 2. Run object detection & ByteTrack tracking
            video_asset.processing_status = "indexing"
            video_asset.progress_percentage = 60
            db.commit()

            self._emit_log(current_idx, "indexing", f"Running YOLOv8 object detection & ByteTrack tracking on chunk #{current_idx}...", progress=60)

            detection_output_dir = get_data_path(os.path.join("processed/detections", asset_id))
            
            # Resolve camera active model path
            model_path = None
            if camera:
                active_m_id = camera.model_id or camera.theft_model_id or camera.abandoned_model_id or camera.assault_model_id
                if active_m_id and active_m_id != "OFF":
                    m_rec = db.query(MLModel).filter(MLModel.id == active_m_id).first()
                    if m_rec and os.path.exists(m_rec.file_path):
                        model_path = m_rec.file_path

            detector = DetectionService(model_path=model_path)
            det_results = detector.analyze_video(
                video_path=dest_trans,
                output_dir=detection_output_dir,
                camera_id=self.camera_id,
                video_id=asset_id
            )
            num_tracklets = len(det_results.get("tracklets", [])) if isinstance(det_results, dict) else 0

            self._emit_log(current_idx, "indexing", f"Detected {num_tracklets} tracklets/objects in chunk #{current_idx}", progress=80)

            # 3. Generate CLIP embeddings & index tracklets
            video_asset.progress_percentage = 85
            db.commit()

            self._emit_log(current_idx, "indexing", f"Generating CLIP vectors & indexing tracklets for chunk #{current_idx}...", progress=85)

            emb_service = TrackletEmbeddingService()
            det_file = os.path.join(detection_output_dir, "detections.json")
            if os.path.exists(det_file):
                emb_service.embed_detection_artifact(det_file)

            try:
                vec_index = VectorIndexService()
                vec_index.index_tracklets(asset_id)
            except Exception as vec_err:
                logger.warning(f"Vector indexing warning for chunk {chunk_id}: {vec_err}")

            # 4. Complete asset pipeline
            video_asset.processing_status = "complete"
            video_asset.progress_percentage = 100
            db.commit()

            self._emit_log(current_idx, "db_saved", f"Saved chunk #{current_idx} into DB as VideoAsset ({asset_id})", progress=100)
            self._emit_log(current_idx, "complete", f"Chunk #{current_idx} pipeline 100% COMPLETE! (Indexed {num_tracklets} tracklets into vector DB)", progress=100)

        except Exception as ve_err:
            logger.error(f"Pipeline failure for chunk {chunk_id}: {ve_err}")
            self._emit_log(current_idx, "error", f"Pipeline error for chunk #{current_idx}: {ve_err}", level="ERROR")
            if db:
                asset = db.query(VideoAsset).filter(VideoAsset.id == asset_id).first()
                if asset:
                    asset.processing_status = "failed"
                    db.commit()
        finally:
            db.close()

    def stop(self):
        self._stop_event.set()
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=3)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            logger.info(f"Stopped FFmpeg chunker for {self.camera_id}")
            
        output_dir = get_data_path(f"streams/{self.camera_id}/{self.session_id}")
        self._sync_recorded_chunks(output_dir, len(self._recorded_files), force_flush=True)
