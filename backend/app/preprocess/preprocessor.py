import os
import re
import time
import hashlib
import json
import subprocess
from datetime import datetime, timezone, timedelta
import cv2
from loguru import logger

def sanitize_filename(filename: str) -> str:
    """Sanitizes filename to prevent path traversal and ensure safety."""
    name, ext = os.path.splitext(filename)
    # Remove non-alphanumeric except hyphens and underscores
    clean_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', name)
    # Collapse multiple underscores
    clean_name = re.sub(r'_+', '_', clean_name).strip('_')
    if not clean_name:
        clean_name = "video"
    return clean_name

def calculate_file_sha256(filepath: str) -> str:
    """Calculates SHA-256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(65536), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

class VideoPreprocessor:
    """Engine responsible for transcoding and frame sampling."""
    
    @staticmethod
    def transcode_video(input_path: str, output_path: str, fps: int = 10, resolution: str = "1280:720") -> bool:
        """Transcodes a video to standard H.264 MP4 with forced FPS and resolution."""
        logger.info(f"Transcoding video {input_path} to {output_path} (FPS: {fps}, Res: {resolution})")
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-vf", f"scale={resolution},fps={fps}",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            logger.info("FFmpeg transcode completed successfully.")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg transcode failed. Return code: {e.returncode}")
            logger.error(f"Stderr: {e.stderr}")
            raise RuntimeError(f"FFmpeg transcode failed: {e.stderr}")

    @staticmethod
    def sample_and_analyze(video_path: str, inference_dir: str, sampling_fps: float = 4.0) -> dict:
        """Samples frames at exactly sampling_fps in-memory, saves a single video thumbnail,

        and collects video metadata.
        """
        logger.info(f"Sampling video {video_path} at {sampling_fps} FPS.")
        os.makedirs(inference_dir, exist_ok=True)
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open video file {video_path} using OpenCV.")
            
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        if fps <= 0 or total_frames <= 0:
            # Fallback or estimate if metadata is corrupted
            fps = 10.0
            total_frames = 1
            
        duration = total_frames / fps
        logger.info(f"Video metadata: {width}x{height} @ {fps} FPS, Total Frames: {total_frames}, Duration: {duration:.2f}s")
        
        sampled_count = 0
        last_slot = -1
        thumbnail_saved = False
        thumbnail_path = None
        
        # Read frame-by-frame
        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            # Time stamp of current frame
            t = frame_idx / fps
            slot = int(t * sampling_fps)
            
            # If we transition to a new slot, sample this frame
            if slot != last_slot:
                sampled_count += 1
                last_slot = slot
                
                # Capture a single middle frame as a thumbnail
                if not thumbnail_saved and frame_idx >= (total_frames // 3):
                    thumb_file = os.path.join(inference_dir, "thumbnail.jpg")
                    # Resize thumbnail to a small standard width (e.g. 320px) keeping aspect ratio
                    thumb_h, thumb_w = frame.shape[:2]
                    target_w = 320
                    target_h = int(thumb_h * (target_w / thumb_w))
                    resized_thumb = cv2.resize(frame, (target_w, target_h))
                    cv2.imwrite(thumb_file, resized_thumb)
                    thumbnail_path = thumb_file
                    thumbnail_saved = True
                    logger.info(f"Saved video thumbnail to {thumbnail_path}")
            
            frame_idx += 1
            
        # Fallback: if no thumbnail was saved (e.g., video too short), save the first frame
        if not thumbnail_saved:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
            if ret:
                thumb_file = os.path.join(inference_dir, "thumbnail.jpg")
                cv2.imwrite(thumb_file, frame)
                thumbnail_path = thumb_file
                logger.info(f"Fallback: Saved first frame as thumbnail to {thumbnail_path}")
                
        cap.release()
        
        return {
            "duration": duration,
            "width": width,
            "height": height,
            "fps": fps,
            "total_frames": total_frames,
            "sampled_frames_count": sampled_count,
            "thumbnail_path": thumbnail_path
        }
        
    @classmethod
    def run_pipeline(
        cls, 
        raw_video_path: str, 
        camera_id: str, 
        camera_name: str, 
        original_filename: str, 
        asset_id: str,
        intake_sha256: str,
        start_time: datetime = None
    ) -> dict:
        """Runs the entire preprocessing pipeline end-to-end.
        
        Returns database updates and manifest path.
        """
        timestamp_slug = int(time.time())
        sanitized_name = sanitize_filename(original_filename)
        standardized_video_name = f"{sanitized_name}_{timestamp_slug}"
        
        # Build physical layout folders
        camera_dir_name = f"{camera_id}_{sanitize_filename(camera_name)}"
        camera_dir = os.path.join("./data/cameras", camera_dir_name)
        original_assets_dir = os.path.join(camera_dir, "original_assets")
        inference_dir = os.path.join(camera_dir, "inference", standardized_video_name)
        
        os.makedirs(original_assets_dir, exist_ok=True)
        os.makedirs(inference_dir, exist_ok=True)
        
        standardized_video_path = os.path.join(original_assets_dir, f"{standardized_video_name}.mp4")
        
        # 1. Transcode
        cls.transcode_video(raw_video_path, standardized_video_path, fps=10, resolution="1280:720")
        
        # 2. Calculate transcoded hash
        transcoded_sha256 = calculate_file_sha256(standardized_video_path)
        
        # 3. Sample and extract properties
        meta = cls.sample_and_analyze(standardized_video_path, inference_dir, sampling_fps=4.0)
        
        # 4. Determine timestamps
        if not start_time:
            start_time = datetime.now(timezone.utc)
        
        end_time = start_time + timedelta(seconds=meta["duration"])
        
        # 5. Create Chain of Custody manifest
        manifest = {
            "asset_id": asset_id,
            "camera_id": camera_id,
            "original_filename": original_filename,
            "standardized_filename": f"{standardized_video_name}.mp4",
            "intake_sha256": intake_sha256,
            "transcoded_sha256": transcoded_sha256,
            "transcode_resolution": "1280x720",
            "transcode_fps": 10,
            "sampling_fps": 4,
            "total_sampled_frames": meta["sampled_frames_count"],
            "duration": meta["duration"],
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        manifest_path = os.path.join(inference_dir, "manifest_hash.json")
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)
            
        logger.info(f"Chain of custody manifest saved at {manifest_path}")
        
        return {
            "standardized_filename": f"{standardized_video_name}.mp4",
            "standardized_video_path": standardized_video_path,
            "transcoded_sha256": transcoded_sha256,
            "duration": meta["duration"],
            "start_time": start_time,
            "end_time": end_time,
            "thumbnail_path": meta["thumbnail_path"],
            "inference_dir": inference_dir,
            "manifest_path": manifest_path
        }
