import secrets
import json
import asyncio
from datetime import datetime, timedelta, timezone
from loguru import logger
from app.db.models import CameraProfile, LiveStreamSession
from app.streaming.inference_worker import InferenceWorker
from app.streaming.chunker import StreamChunker
from app.streaming.config import StreamConfig

class StreamManager:
    _active_streams = {}

    def generate_stream_token(self, camera_id, db, config: StreamConfig = None):
        if not config:
            config = StreamConfig()
            
        cam = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
        if not cam:
            return None
            
        token = secrets.token_urlsafe(32)
        stream_key = secrets.token_urlsafe(16)
        session_id = secrets.token_urlsafe(16)
        
        cam.stream_auth_token = token
        cam.stream_key = stream_key
        cam.stream_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        
        session = LiveStreamSession(
            id=session_id,
            camera_id=camera_id,
            status="active",
            inference_model_id=cam.model_id,
            stream_config=json.dumps(config.__dict__)
        )
        db.add(session)
        db.commit()
        
        return {
            "token": token,
            "stream_key": stream_key,
            "session_id": session_id,
            "whip_url": f"{config.mediamtx_whip_base}/{camera_id}/whip?token={token}&stream_key={stream_key}",
            "whep_url": f"{config.mediamtx_whip_base}/{camera_id}/whep",
            "rtsp_url": f"{config.mediamtx_rtsp_base}/{camera_id}"
        }
        
    def validate_token(self, token, stream_key, db):
        try:
            cam = db.query(CameraProfile).filter(
                CameraProfile.stream_auth_token == token,
                CameraProfile.stream_key == stream_key
            ).first()
            if not cam:
                cam = db.query(CameraProfile).filter(
                    CameraProfile.camera_id == stream_key,
                    CameraProfile.stream_auth_token == token
                ).first()
            if not cam:
                logger.warning(f"No matching camera found for stream_key='{stream_key}', token='{token}'")
                return False
            return True
        except Exception as e:
            logger.error(f"validate_token exception: {e}")
            return False

    def start_inference(self, camera_id, session_id, config: StreamConfig, db):
        cam = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
        if not cam:
            return
            
        rtsp_url = f"{config.mediamtx_rtsp_base}/{camera_id}"
        
        worker = InferenceWorker(camera_id, session_id, rtsp_url, config, self)
        chunker = StreamChunker(camera_id, session_id, rtsp_url, config)
        
        self._active_streams[camera_id] = {
            "worker_thread": worker,
            "chunker_process": chunker,
            "session_id": session_id,
            "ws_clients": set(),
            "config": config,
            "loop": None
        }
        
        cam.is_streaming = True
        cam.stream_started_at = datetime.now(timezone.utc)
        db.commit()
        
        worker.start()
        chunker.start()
        
    def stop_stream(self, camera_id, db):
        if camera_id in self._active_streams:
            stream_data = self._active_streams[camera_id]
            stream_data["worker_thread"].stop()
            stream_data["chunker_process"].stop()
            
            session_id = stream_data["session_id"]
            session = db.query(LiveStreamSession).filter(LiveStreamSession.id == session_id).first()
            if session:
                session.status = "ended"
                session.ended_at = datetime.now(timezone.utc)
                if session.started_at:
                    session.total_duration_sec = (session.ended_at - session.started_at.replace(tzinfo=timezone.utc)).total_seconds()
            
            del self._active_streams[camera_id]
            
        cam = db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
        if cam:
            cam.is_streaming = False
        db.commit()
        
    def get_status(self, camera_id):
        if camera_id in self._active_streams:
            worker = self._active_streams[camera_id]["worker_thread"]
            return {
                "status": "streaming",
                "session_id": self._active_streams[camera_id]["session_id"],
                "fps": worker.fps,
                "inference_ms": worker.inference_ms,
                "frame_count": worker.frame_count
            }
        return {"status": "stopped"}

    def register_ws_client(self, camera_id, websocket):
        if camera_id in self._active_streams:
            self._active_streams[camera_id]["ws_clients"].add(websocket)
            try:
                self._active_streams[camera_id]["loop"] = asyncio.get_running_loop()
            except RuntimeError:
                pass
            
    def unregister_ws_client(self, camera_id, websocket):
        if camera_id in self._active_streams:
            if websocket in self._active_streams[camera_id]["ws_clients"]:
                self._active_streams[camera_id]["ws_clients"].remove(websocket)
                
    def broadcast_to_clients(self, camera_id, message_dict):
        if camera_id in self._active_streams:
            clients = self._active_streams[camera_id]["ws_clients"].copy()
            if not clients:
                return
            
            async def _send():
                for client in clients:
                    try:
                        await client.send_json(message_dict)
                    except Exception:
                        pass
                        
            loop = self._active_streams[camera_id].get("loop")
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(_send(), loop)
            else:
                try:
                    current_loop = asyncio.get_event_loop()
                    if current_loop.is_running():
                        asyncio.run_coroutine_threadsafe(_send(), current_loop)
                    else:
                        asyncio.run(_send())
                except RuntimeError:
                    asyncio.run(_send())
