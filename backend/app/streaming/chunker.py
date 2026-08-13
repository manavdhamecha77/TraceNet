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
from app.db.models import StreamChunk, LiveStreamSession, VideoAsset, CameraProfile
from app.preprocess.preprocessor import VideoPreprocessor, sanitize_filename, calculate_file_sha256
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

    def _emit_log(self, chunk_idx: int, stage: str, message: str, level: str = "INFO"):
        """Broadcasts pipeline log updates to frontend WebSocket subscribers."""
        log_payload = {
            "type": "pipeline_log",
            "log": {
                "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "chunk_index": chunk_idx,
                "stage": stage,
                "message": message,
                "level": level
            }
        }
        logger.info(f"[LivePipeline {self.camera_id} #{chunk_idx}] {message}")
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
                    self._emit_log(current_idx, "recorded", f"Video chunk #{current_idx} recorded ({file_size} bytes, file: {filename})")
                    
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
                        
                    # Pre-processing pipeline & registration as VideoAsset
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

                        # Determine original video FPS using OpenCV
                        cap = cv2.VideoCapture(filepath)
                        orig_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
                        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
                        duration_sec = total_frames / orig_fps if orig_fps > 0 else float(self.config.max_chunk_duration_sec)
                        cap.release()

                        # Sample to 4 FPS via FFmpeg if original FPS > 4 (else keep original FPS)
                        target_fps = 4 if orig_fps > 4 else int(max(1, orig_fps))
                        self._emit_log(
                            current_idx, 
                            "preprocessing", 
                            f"Started pre-processing chunk #{current_idx} (Original: {orig_fps:.1f} FPS → Target: {target_fps} FPS via FFmpeg)"
                        )

                        VideoPreprocessor.transcode_video(dest_orig, dest_trans, fps=target_fps, resolution="1280:720")
                        transcoded_hash = calculate_file_sha256(dest_trans)

                        # Sample thumbnail
                        inference_dir = get_data_path(os.path.join("cameras", camera_dir_name, "inference", filename.replace(".mp4", "")))
                        meta = VideoPreprocessor.sample_and_analyze(dest_trans, inference_dir, sampling_fps=4.0)

                        self._emit_log(current_idx, "preprocessed", f"Done pre-processing chunk #{current_idx} (Thumbnail & 720p 4-FPS asset created)")

                        # Save into DB
                        video_asset = VideoAsset(
                            id=f"vid_{chunk.id}",
                            camera_id=self.camera_id,
                            original_filename=filename,
                            standardized_filename=filename,
                            intake_sha256=intake_hash,
                            transcoded_sha256=transcoded_hash,
                            processing_status="complete",
                            progress_percentage=100,
                            duration=duration_sec,
                            start_time=start_t,
                            end_time=datetime.now(timezone.utc),
                            thumbnail_path=meta.get("thumbnail_path"),
                            upload_timestamp=datetime.now(timezone.utc),
                            is_live_recording=True
                        )
                        db.add(video_asset)
                        db.commit()
                        self._emit_log(current_idx, "db_saved", f"Saved chunk #{current_idx} into DB as VideoAsset (vid_{chunk.id})")
                        self._emit_log(current_idx, "annotations", f"Annotations & frame detections index updated for chunk #{current_idx}")

                    except Exception as ve_err:
                        logger.warning(f"Could not register VideoAsset for chunk {chunk.id}: {ve_err}")
                        self._emit_log(current_idx, "error", f"Pre-processing error for chunk #{current_idx}: {ve_err}", level="ERROR")
                        db.commit()

        except Exception as e:
            logger.error(f"Error recording stream chunk: {e}")
        finally:
            db.close()
        return current_idx

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
