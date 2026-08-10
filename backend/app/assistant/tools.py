from __future__ import annotations

import base64
import json
from typing import Any, Dict, List, Optional
from loguru import logger
from sqlalchemy.orm import Session

from app.search.query_engine import QueryEngine
from app.search.image_search import ImageSearchService
from app.db.models import CameraProfile, Alert, SearchLog, VideoAsset, MLModel, Tracklet


TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_tracklets",
            "description": "Perform natural language vector search over indexed CCTV video tracklets to locate matching people or vehicles.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Description of person or vehicle, e.g. 'man in red jacket', 'blue sedan'"
                    },
                    "camera_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of camera node IDs to scope search"
                    },
                    "object_type": {
                        "type": "string",
                        "enum": ["all", "person", "vehicle"],
                        "description": "Filter by target category"
                    },
                    "top_k": {
                        "type": "integer",
                        "default": 10,
                        "description": "Number of top matching tracklets to return"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_cameras",
            "description": "Retrieve all registered smart city CCTV camera nodes, GIS coordinates, corridor groups, and status.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_camera_details",
            "description": "Get detailed metadata, active model, and video feed records for a specific camera ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "camera_id": {
                        "type": "string",
                        "description": "Target camera node ID, e.g. 'CAM_001'"
                    }
                },
                "required": ["camera_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_alerts",
            "description": "Retrieve security alerts (loitering or abandoned objects) recorded across camera nodes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "alert_type": {
                        "type": "string",
                        "enum": ["all", "loitering", "abandoned_object"]
                    },
                    "limit": {
                        "type": "integer",
                        "default": 10
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_search_logs",
            "description": "Retrieve evidentiary search audit log history for court validation compliance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "default": 10
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_metrics",
            "description": "Retrieve high-level Smart City system overview metrics (total cameras, active nodes, video assets, tracklets, alerts).",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_models",
            "description": "Retrieve registered ML object detection models, YOLO weights, class definitions, and camera assignments.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "assign_camera_model",
            "description": "Assign or update the ML object detection model for a target camera node.",
            "parameters": {
                "type": "object",
                "properties": {
                    "camera_id": {
                        "type": "string",
                        "description": "Target camera node ID, e.g. 'CAM_001'"
                    },
                    "model_id": {
                        "type": "string",
                        "description": "Registered model ID to assign, e.g. 'yolov8n-custom-uuid'"
                    }
                },
                "required": ["camera_id", "model_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_video_reindex",
            "description": "Trigger re-indexing of tracklet embeddings into Qdrant vector database for a target video asset ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "video_id": {
                        "type": "string",
                        "description": "Video asset ID to re-index"
                    }
                },
                "required": ["video_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "reconstruct_trajectory",
            "description": "Reconstruct multi-camera spatial-temporal DAG journey trajectory path for a target tracklet ID across smart city camera graph.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tracklet_id": {
                        "type": "string",
                        "description": "Target tracklet ID, e.g. 'video_uuid_trk_5'"
                    },
                    "speed_mode": {
                        "type": "string",
                        "enum": ["pedestrian", "vehicle", "auto"],
                        "default": "pedestrian",
                        "description": "Velocity profile for transit transition feasibility"
                    }
                },
                "required": ["tracklet_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "activate_sentinel_wave",
            "description": "Activate predictive downstream Sentinel search wave pursuit across neighbor cameras from an origin camera node.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin_camera_id": {
                        "type": "string",
                        "description": "Origin camera ID where suspect/target was last seen, e.g. 'CAM_001'"
                    },
                    "target_tracklet_id": {
                        "type": "string",
                        "description": "Optional target tracklet ID to track"
                    },
                    "speed_mode": {
                        "type": "string",
                        "enum": ["pedestrian", "vehicle"],
                        "default": "pedestrian"
                    }
                },
                "required": ["origin_camera_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_chain_snatching_alerts",
            "description": "Retrieve outdoor chain snatching and violent theft security alerts recorded across smart city camera nodes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "default": 10
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_chain_snatching",
            "description": "Trigger 4 FPS kinematic chain snatching and violent theft analysis on a target video asset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "video_id": {
                        "type": "string",
                        "description": "Video asset ID to analyze for chain snatching"
                    }
                },
                "required": ["video_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_assault_alerts",
            "description": "Retrieve physical assault, fighting, and violent incident alerts detected by VideoMAE model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "default": 10
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "tag_hot_target",
            "description": "Tag a specific suspect, thief, or vehicle as a Hot Target for cross-camera persistent pursuit and tracking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "label": {
                        "type": "string",
                        "description": "Human readable target label, e.g. 'Suspect Red Sedan #VEC-09' or 'Chauta Bazar Snatcher'"
                    },
                    "origin_camera_id": {
                        "type": "string",
                        "description": "Camera ID where target was first identified, e.g. 'CAM_001'"
                    },
                    "origin_tracklet_id": {
                        "type": "string",
                        "description": "Optional tracklet ID of the target"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["NORMAL", "HIGH", "CRITICAL"],
                        "default": "HIGH"
                    }
                },
                "required": ["label", "origin_camera_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_hot_targets",
            "description": "List all active tagged hot targets currently under multi-camera pursuit.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["active", "resolved", "all"],
                        "default": "active"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "detect_assault",
            "description": "Trigger VideoMAE physical assault & fighting detection scan on a target video file asset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "video_id": {
                        "type": "string",
                        "description": "Video asset ID to scan for physical assault or fighting"
                    }
                },
                "required": ["video_id"]
            }
        }
    }
]


class ToolExecutor:
    """Executes tool function calls requested by the AI Assistant."""

    def __init__(self, db: Session):
        self.db = db

    def execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"ToolExecutor: executing '{name}' with args {args}")

        try:
            if name == "search_tracklets":
                query_text = args.get("query", "")
                camera_ids = args.get("camera_ids")
                object_type = args.get("object_type", "all")
                top_k = min(args.get("top_k", 5), 5)

                engine = QueryEngine()
                results = engine.search_tracklets(
                    db=self.db,
                    query_text=query_text,
                    camera_ids=camera_ids,
                    object_type=object_type,
                    top_k=top_k
                )
                
                # Concise summary for LLM token efficiency
                llm_summary = [
                    {
                        "tracklet_id": r.get("tracklet_id") or r.get("id"),
                        "camera_id": r.get("camera_id"),
                        "object_type": r.get("object_type"),
                        "class_name": r.get("class_name"),
                        "confidence": r.get("mean_confidence") or r.get("confidence"),
                        "timestamp_seconds": r.get("timestamp_start_seconds"),
                        "score": r.get("score")
                    }
                    for r in results[:5]
                ]

                return {
                    "status": "success",
                    "count": len(results),
                    "summary": llm_summary,
                    "results": results
                }

            elif name == "list_cameras":
                cameras = self.db.query(CameraProfile).all()
                camera_summaries = [
                    {
                        "camera_id": c.camera_id,
                        "name": c.name,
                        "status": c.status,
                        "corridor_group": c.corridor_group,
                        "latitude": c.latitude,
                        "longitude": c.longitude
                    }
                    for c in cameras
                ]
                return {"status": "success", "count": len(cameras), "cameras": camera_summaries}

            elif name == "get_camera_details":
                camera_id = args.get("camera_id", "").strip()
                camera = self.db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
                if not camera:
                    return {"status": "error", "message": f"Camera '{camera_id}' not found."}

                videos = self.db.query(VideoAsset).filter(VideoAsset.camera_id == camera_id).order_by(VideoAsset.upload_timestamp.desc()).limit(5).all()
                return {
                    "status": "success",
                    "camera": {
                        "camera_id": camera.camera_id,
                        "name": camera.name,
                        "status": camera.status,
                        "corridor_group": camera.corridor_group,
                        "model_id": camera.model_id
                    },
                    "recent_videos": [
                        {
                            "id": v.id,
                            "filename": v.original_filename,
                            "status": v.processing_status
                        }
                        for v in videos
                    ]
                }

            elif name == "get_system_alerts":
                alert_type = args.get("alert_type", "all")
                limit = min(args.get("limit", 5), 5)

                query = self.db.query(Alert)
                if alert_type != "all":
                    query = query.filter(Alert.alert_type == alert_type)

                alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
                alert_summaries = [
                    {
                        "id": a.id,
                        "alert_type": a.alert_type,
                        "camera_id": a.camera_id,
                        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                        "acknowledged": a.acknowledged
                    }
                    for a in alerts
                ]
                return {"status": "success", "count": len(alerts), "alerts": alert_summaries}

            elif name == "get_search_logs":
                limit = min(args.get("limit", 5), 5)
                logs = self.db.query(SearchLog).order_by(SearchLog.timestamp.desc()).limit(limit).all()
                log_summaries = [
                    {
                        "id": l.id,
                        "query": l.query_text if hasattr(l, 'query_text') else getattr(l, 'query', ''),
                        "results_count": l.results_count,
                        "timestamp": l.timestamp.isoformat() if l.timestamp else None
                    }
                    for l in logs
                ]
                return {"status": "success", "count": len(logs), "logs": log_summaries}

            elif name == "get_dashboard_metrics":
                total_cams = self.db.query(CameraProfile).count()
                active_cams = self.db.query(CameraProfile).filter(CameraProfile.status == 'active').count()
                total_videos = self.db.query(VideoAsset).filter(VideoAsset.is_bin == False).count()
                total_tracklets = self.db.query(Tracklet).count()
                total_alerts = self.db.query(Alert).count()
                return {
                    "status": "success",
                    "metrics": {
                        "total_cameras": total_cams,
                        "active_cameras": active_cams,
                        "total_videos": total_videos,
                        "total_tracklets": total_tracklets,
                        "total_alerts": total_alerts
                    }
                }

            elif name == "list_models":
                models = self.db.query(MLModel).all()
                model_summaries = [m.to_dict() for m in models]
                return {"status": "success", "count": len(models), "models": model_summaries}

            elif name == "assign_camera_model":
                camera_id = args.get("camera_id", "").strip()
                model_id = args.get("model_id", "").strip()
                camera = self.db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
                if not camera:
                    return {"status": "error", "message": f"Camera '{camera_id}' not found."}

                model_rec = self.db.query(MLModel).filter(MLModel.id == model_id).first()
                if not model_rec:
                    return {"status": "error", "message": f"ML Model '{model_id}' not found in registry."}

                camera.model_id = model_id
                self.db.commit()
                return {
                    "status": "success",
                    "message": f"Successfully assigned model '{model_rec.name}' ({model_id}) to camera '{camera_id}'."
                }

            elif name == "trigger_video_reindex":
                video_id = args.get("video_id", "").strip()
                from app.search.vector_index import VectorIndexService
                indexer = VectorIndexService()
                res = indexer.index_video_tracklets(video_id, self.db)
                return {"status": "success", "video_id": video_id, "indexing_result": res}

            elif name == "reconstruct_trajectory":
                tracklet_id = args.get("tracklet_id", "").strip()
                speed_mode = args.get("speed_mode", "pedestrian")
                from app.analytics.trajectory_engine import TrajectoryEngine
                engine = TrajectoryEngine(self.db)
                return engine.reconstruct_trajectory(target_tracklet_id=tracklet_id, speed_mode=speed_mode)

            elif name == "activate_sentinel_wave":
                origin_cam = args.get("origin_camera_id", "").strip()
                target_trk = args.get("target_tracklet_id")
                speed_mode = args.get("speed_mode", "pedestrian")
                from app.analytics.sentinel_wave import SentinelWaveManager
                manager = SentinelWaveManager(self.db)
                return manager.activate_sentinel_wave(
                    origin_camera_id=origin_cam,
                    target_tracklet_id=target_trk,
                    speed_mode=speed_mode
                )

            elif name == "tag_hot_target":
                label = args.get("label", "Hot Target Suspect")
                origin_cam = args.get("origin_camera_id", "CAM_001")
                origin_trk = args.get("origin_tracklet_id")
                priority = args.get("priority", "HIGH")
                from app.analytics.hot_target import HotTargetManager
                manager = HotTargetManager(self.db)
                return manager.tag_hot_target(
                    label=label,
                    origin_camera_id=origin_cam,
                    origin_tracklet_id=origin_trk,
                    priority=priority
                )

            elif name == "get_hot_targets":
                status = args.get("status", "active")
                from app.analytics.hot_target import HotTargetManager
                manager = HotTargetManager(self.db)
                return {"status": "success", "targets": manager.list_hot_targets(status=status)}

            elif name == "get_chain_snatching_alerts":
                limit = min(args.get("limit", 10), 20)
                alerts = self.db.query(Alert).filter(Alert.alert_type == "chain_snatching").order_by(Alert.timestamp.desc()).limit(limit).all()
                summaries = [
                    {
                        "id": a.id,
                        "camera_id": a.camera_id,
                        "video_id": a.video_id,
                        "victim_tracklet": a.tracklet_id,
                        "suspect_tracklet": a.object_tracklet_id,
                        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                        "acknowledged": a.acknowledged
                    }
                    for a in alerts
                ]
                return {"status": "success", "count": len(alerts), "alerts": summaries}

            elif name == "analyze_chain_snatching":
                video_id = args.get("video_id", "").strip()
                video = self.db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
                if not video:
                    return {"status": "error", "message": f"Video '{video_id}' not found."}

                from app.alerts.chain_snatching import ChainSnatchingAnalyzer
                from app.db.models import CameraProfile, MLModel
                cam = self.db.query(CameraProfile).filter(CameraProfile.camera_id == video.camera_id).first()
                model_classes = []
                if cam and cam.model_id:
                    m = self.db.query(MLModel).filter(MLModel.id == cam.model_id).first()
                    if m and m.classes:
                        try:
                            model_classes = json.loads(m.classes)
                        except Exception:
                            pass

                analyzer = ChainSnatchingAnalyzer()
                result = analyzer.analyze_video(video_id=video_id, model_classes=model_classes, db=self.db)
                return {"status": "success", "result": result}

            elif name == "get_assault_alerts":
                limit = min(args.get("limit", 10), 20)
                alerts = self.db.query(Alert).filter(Alert.alert_type.in_(["assault", "fighting"])).order_by(Alert.timestamp.desc()).limit(limit).all()
                summaries = [
                    {
                        "id": a.id,
                        "alert_type": a.alert_type,
                        "camera_id": a.camera_id,
                        "video_id": a.video_id,
                        "tracklet_id": a.tracklet_id,
                        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                        "acknowledged": a.acknowledged
                    }
                    for a in alerts
                ]
                return {"status": "success", "count": len(alerts), "alerts": summaries}

            elif name == "detect_assault":
                video_id = args.get("video_id", "").strip()
                video = self.db.query(VideoAsset).filter(VideoAsset.id == video_id).first()
                if not video:
                    return {"status": "error", "message": f"Video '{video_id}' not found."}

                from app.config import get_data_path
                video_path = get_data_path(os.path.join("processed", video.standardized_filename or f"{video_id}.mp4"))
                if not os.path.exists(video_path):
                    raw_path = get_data_path(os.path.join("minio_mock", video.original_filename))
                    if os.path.exists(raw_path):
                        video_path = raw_path

                from app.detection.assault_detector import get_assault_detector
                detector = get_assault_detector()
                result = detector.predict(video_path)
                return {"status": "success", "video_id": video_id, "prediction": result}

            else:
                return {"status": "error", "message": f"Unknown tool name '{name}'."}

        except Exception as e:
            logger.error(f"Error executing tool '{name}': {e}")
            return {"status": "error", "message": str(e)}
