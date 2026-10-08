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

                    if not self.config.auto_import_chunks:
                        self._emit_log(current_idx, "recorded", f"Chunk #{current_idx} kept in stream storage (auto check-in is off for this session)", progress=100)
                        continue
                    # Spawn asynchronous check-in thread so RTSP chunking is never blocked
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
        """Checks a finished chunk into the camera node as a regular video asset and runs the SAME
        background pipeline an uploaded file gets (transcode -> detection/tracking -> plates -> CLIP
        index -> faces -> accident engine). Nothing analytic runs on the live loop except the detector."""
        from app.preprocess.storage import MockStorageProvider
        from app.api.upload import process_video_background

        filename = os.path.basename(filepath)
        asset_id = f"vid_{chunk_id}"
        db = SessionLocal()
        try:
            camera = db.query(CameraProfile).filter(CameraProfile.camera_id == self.camera_id).first()
            cam_name = camera.name if (camera and camera.name) else self.camera_id

            # 1. Check the raw chunk into the WORM intake store exactly like an upload
            with open(filepath, "rb") as f:
                file_bytes = f.read()
            if not file_bytes:
                raise ValueError("recorded chunk is empty")
            intake_hash = hashlib.sha256(file_bytes).hexdigest()
            duplicate = db.query(VideoAsset).filter(
                VideoAsset.camera_id == self.camera_id, VideoAsset.intake_sha256 == intake_hash
            ).first()
            if duplicate:
                self._emit_log(current_idx, "db_saved", f"Chunk #{current_idx} already checked in as {duplicate.id}", progress=100)
                return
            raw_filepath = MockStorageProvider().upload_file(file_bytes, f"{asset_id}_{filename}")

            video_asset = VideoAsset(
                id=asset_id,
                camera_id=self.camera_id,
                original_filename=filename,
                standardized_filename="pending_transcode.mp4",
                intake_sha256=intake_hash,
                processing_status="pending",
                progress_percentage=0,
                upload_timestamp=datetime.now(timezone.utc),
                is_live_recording=True,
            )
            db.add(video_asset)
            chunk = db.query(StreamChunk).filter(StreamChunk.id == chunk_id).first()
            if chunk is not None and hasattr(chunk, "video_asset_id"):
                chunk.video_asset_id = asset_id
            db.commit()
            self._emit_log(current_idx, "checked_in", f"Chunk #{current_idx} checked into camera archive as video {asset_id}; full pipeline queued", progress=20)
        except Exception as e:
            logger.error(f"Chunk check-in failure for {chunk_id}: {e}")
            self._emit_log(current_idx, "error", f"Check-in error for chunk #{current_idx}: {e}", level="ERROR")
            db.close()
            return
        finally:
            try:
                db.close()
            except Exception:
                pass

        # 2. Same pipeline as POST /api/v1/ingest (runs synchronously in this worker thread)
        try:
            process_video_background(
                asset_id=asset_id,
                camera_id=self.camera_id,
                camera_name=cam_name,
                raw_filepath=raw_filepath,
                original_filename=filename,
                intake_sha256=intake_hash,
                start_time_iso=start_t.isoformat(),
            )
            self._emit_log(current_idx, "complete", f"Chunk #{current_idx} pipeline complete (video {asset_id})", progress=100)
        except Exception as pipe_err:
            logger.error(f"Pipeline failure for checked-in chunk {chunk_id}: {pipe_err}")
            self._emit_log(current_idx, "error", f"Pipeline error for chunk #{current_idx}: {pipe_err}", level="ERROR")

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
