from __future__ import annotations

import base64
import json
from typing import Any, Dict, List, Optional
from loguru import logger
from sqlalchemy.orm import Session

from app.search.query_engine import QueryEngine
from app.search.image_search import ImageSearchService
from app.db.models import CameraProfile, Alert, SearchLog, VideoAsset


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
                top_k = args.get("top_k", 10)

                engine = QueryEngine()
                results = engine.search_tracklets(
                    db=self.db,
                    query_text=query_text,
                    camera_ids=camera_ids,
                    object_type=object_type,
                    top_k=top_k
                )
                return {"status": "success", "count": len(results), "results": results}

            elif name == "list_cameras":
                cameras = self.db.query(CameraProfile).all()
                return {"status": "success", "count": len(cameras), "cameras": [c.to_dict() for c in cameras]}

            elif name == "get_camera_details":
                camera_id = args.get("camera_id", "").strip()
                camera = self.db.query(CameraProfile).filter(CameraProfile.camera_id == camera_id).first()
                if not camera:
                    return {"status": "error", "message": f"Camera '{camera_id}' not found."}

                videos = self.db.query(VideoAsset).filter(VideoAsset.camera_id == camera_id).all()
                return {
                    "status": "success",
                    "camera": camera.to_dict(),
                    "videos": [v.to_dict() for v in videos]
                }

            elif name == "get_system_alerts":
                alert_type = args.get("alert_type", "all")
                limit = args.get("limit", 10)

                query = self.db.query(Alert)
                if alert_type != "all":
                    query = query.filter(Alert.alert_type == alert_type)

                alerts = query.order_by(Alert.timestamp.desc()).limit(limit).all()
                return {"status": "success", "count": len(alerts), "alerts": [a.to_dict() for a in alerts]}

            elif name == "get_search_logs":
                limit = args.get("limit", 10)
                logs = self.db.query(SearchLog).order_by(SearchLog.timestamp.desc()).limit(limit).all()
                return {"status": "success", "count": len(logs), "logs": [l.to_dict() for l in logs]}

            else:
                return {"status": "error", "message": f"Unknown tool name '{name}'."}

        except Exception as e:
            logger.error(f"Error executing tool '{name}': {e}")
            return {"status": "error", "message": str(e)}
