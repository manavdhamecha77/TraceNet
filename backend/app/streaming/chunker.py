import os
import subprocess
import threading
from app.config import get_data_path
from loguru import logger

class StreamChunker:
    def __init__(self, camera_id, session_id, rtsp_url, config):
        self.camera_id = camera_id
        self.session_id = session_id
        self.rtsp_url = rtsp_url
        self.config = config
        self.process = None
        self._stop_event = threading.Event()
        
    def start(self):
        output_dir = get_data_path(f"streams/{self.camera_id}/{self.session_id}")
        os.makedirs(output_dir, exist_ok=True)
        
        output_pattern = os.path.join(output_dir, "%Y%m%d_%H%M%S.mp4")
        
        cmd = [
            "ffmpeg",
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
        
        self.process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logger.info(f"Started FFmpeg chunker for {self.camera_id} (PID {self.process.pid})")
        
    def stop(self):
        self._stop_event.set()
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            logger.info(f"Stopped FFmpeg chunker for {self.camera_id}")
