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
    def __init__(self, camera_id, session_id, rtsp_url, config):
        self.camera_id = camera_id
        self.session_id = session_id
        self.rtsp_url = rtsp_url
        self.config = config
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

        cmd = [
            "ffmpeg",
            "-y",
            "-rtsp_transport", "tcp",
            "-i", self.rtsp_url,
            "-c", "copy",
            "-map", "0",
            "-f", "segment",
            "-segment_time", str(self.config.max_chunk_duration_sec),
            "-segment_format", "mp4",
            "-reset_timestamps", "1",
            "-strftime", "1",
            output_pattern
        ]

        logger.info(f"FFmpeg chunker thread started for {self.camera_id} (segment_time={self.config.max_chunk_duration_sec}s)")

        chunk_idx = 0
        while not self._stop_event.is_set():
            try:
                self.process = subprocess.Popen(
                    cmd, 
                    stdout=subprocess.DEVNULL, 
                    stderr=subprocess.DEVNULL
                )
                
                while not self._stop_event.is_set():
                    poll = self.process.poll()
                    if poll is not None:
                        logger.warning(f"FFmpeg chunker exited (code {poll}). Retrying in 2s...")
                        break
                    time.sleep(1.0)
                    chunk_idx = self._sync_recorded_chunks(output_dir, chunk_idx)

            except Exception as e:
                logger.error(f"FFmpeg chunker execution error for {self.camera_id}: {e}")
                time.sleep(2.0)

    def _sync_recorded_chunks(self, output_dir, current_idx):
        mp4_files = sorted(glob.glob(os.path.join(output_dir, "*.mp4")))
        if not mp4_files:
            return current_idx

        db = SessionLocal()
        try:
            for filepath in mp4_files:
                if filepath in self._recorded_files:
                    continue
                # Skip current active segment file (the newest one being written to)
                if filepath == mp4_files[-1] and len(mp4_files) > 1:
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
