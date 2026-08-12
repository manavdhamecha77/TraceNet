import os
import glob
import time
import subprocess
import threading
from datetime import datetime, timezone
from app.config import get_data_path
from app.db.session import SessionLocal
from app.db.models import StreamChunk, LiveStreamSession
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

    def _run(self):
        output_dir = get_data_path(f"streams/{self.camera_id}/{self.session_id}")
        os.makedirs(output_dir, exist_ok=True)
        output_pattern = os.path.join(output_dir, "chunk_%Y%m%d_%H%M%S.mp4")

        # FFmpeg command optimized for WebRTC H.264 video segmenting
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-analyzeduration", "10000000",
            "-probesize", "10000000",
            "-i", self.rtsp_url,
            "-map", "0:v:0",         # Map primary video track only
            "-c:v", "copy",          # Zero-CPU video passthrough
            "-f", "segment",
            "-segment_time", str(self.config.max_chunk_duration_sec),
            "-segment_format", "mp4",
            "-reset_timestamps", "1",
            "-strftime", "1",
            output_pattern
        ]

        logger.info(f"FFmpeg chunker thread initialized for {self.camera_id} (segment_time={self.config.max_chunk_duration_sec}s)")

        chunk_idx = 0
        while not self._stop_event.is_set():
            # Check if camera stream is active in manager before running FFmpeg
            if self.manager:
                status = self.manager.get_status(self.camera_id)
                if not status or not status.get("is_streaming"):
                    time.sleep(2.0)
                    continue

            try:
                self.process = subprocess.Popen(
                    cmd, 
                    stdout=subprocess.DEVNULL, 
                    stderr=subprocess.DEVNULL
                )
                
                while not self._stop_event.is_set():
                    poll = self.process.poll()
                    if poll is not None:
                        # Process exited (e.g. stream temporary reconnect or stopped)
                        break
                    time.sleep(1.0)
                    chunk_idx = self._sync_recorded_chunks(output_dir, chunk_idx)

            except Exception as e:
                logger.error(f"FFmpeg chunker error for {self.camera_id}: {e}")
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
                    chunk = StreamChunk(
                        id=f"{self.session_id}_chk_{current_idx}",
                        session_id=self.session_id,
                        camera_id=self.camera_id,
                        chunk_index=current_idx,
                        file_path=filepath,
                        start_time=datetime.now(timezone.utc),
                        duration_sec=self.config.max_chunk_duration_sec,
                        file_size_bytes=file_size
                    )
                    db.add(chunk)
                    
                    session = db.query(LiveStreamSession).filter(LiveStreamSession.id == self.session_id).first()
                    if session:
                        session.chunks_recorded = (session.chunks_recorded or 0) + 1
                        
                    # Register as VideoAsset under camera so it appears on /cameras/:camera_id
                    try:
                        from app.db.models import VideoAsset, CameraProfile
                        from app.preprocess.preprocessor import sanitize_filename
                        import shutil
                        import hashlib

                        camera = db.query(CameraProfile).filter(CameraProfile.camera_id == self.camera_id).first()
                        cam_name = camera.name if (camera and camera.name) else self.camera_id
                        camera_dir_name = f"{self.camera_id}_{sanitize_filename(cam_name)}"
                        
                        orig_dir = get_data_path(os.path.join("cameras", camera_dir_name, "original_assets"))
                        trans_dir = get_data_path(os.path.join("cameras", camera_dir_name, "transcoded"))
                        os.makedirs(orig_dir, exist_ok=True)
                        os.makedirs(trans_dir, exist_ok=True)

                        filename = os.path.basename(filepath)
                        dest_orig = os.path.join(orig_dir, filename)
                        dest_trans = os.path.join(trans_dir, filename)

                        shutil.copy2(filepath, dest_orig)
                        shutil.copy2(filepath, dest_trans)

                        sha256_hash = hashlib.sha256(filename.encode()).hexdigest()
                        video_asset = VideoAsset(
                            id=f"vid_{chunk.id}",
                            camera_id=self.camera_id,
                            original_filename=filename,
                            standardized_filename=filename,
                            intake_sha256=sha256_hash,
                            transcoded_sha256=sha256_hash,
                            processing_status="complete",
                            progress_percentage=100,
                            duration=float(self.config.max_chunk_duration_sec),
                            upload_timestamp=datetime.now(timezone.utc)
                        )
                        db.add(video_asset)
                        logger.info(f"Auto-imported live chunk as VideoAsset: vid_{chunk.id} for camera {self.camera_id}")
                    except Exception as ve_err:
                        logger.warning(f"Could not register VideoAsset for chunk {chunk.id}: {ve_err}")

                    db.commit()
                    logger.info(f"Saved StreamChunk #{current_idx} for {self.camera_id}: {os.path.basename(filepath)} ({file_size} bytes)")
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
