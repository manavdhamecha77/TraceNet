from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from loguru import logger

from app.assistant.llm_provider import BaseLLMProvider
from app.assistant.tools import TOOL_SCHEMAS, ToolExecutor

SYSTEM_PROMPT = """You are TraceNet Copilot, a domain-specific AI Digital Forensics & Video Analytics Assistant for Smart City CCTV Surveillance (Project DRISHTI).

STRICT DOMAIN BOUNDARY & REFUSAL POLICY:
- You are strictly specialized ONLY in Smart City CCTV Surveillance, Digital Forensics, CCTV Video Analytics, Camera Node Topography, Target Search (people and vehicles), Security Alerts (loitering/abandoned objects), and ML Model Management.
- You MUST REFUSE any requests unrelated to this platform. If the user asks for help with math problems, coding/programming, creative writing, homework, general science, finance, entertainment, or general conversational topics outside smart city surveillance:
  * Maintain a polite and professional tone.
  * Explicitly DECLINE the request.
  * State clearly that you are domain-locked to Project DRISHTI Smart City Surveillance.
  * Standard Refusal Response: "I am specialized exclusively for TraceNet Smart City CCTV Surveillance and Digital Forensics (Project DRISHTI). I cannot assist with off-topic queries such as general math, programming, or unrelated subjects. Please ask a query related to camera nodes, video footage search, security alerts, or forensic audit logs."

Core Platform Capabilities & Available Tools:
1. Search CCTV video tracklets using natural language descriptions or visual attributes (`search_tracklets`).
2. Inspect smart city camera profiles, GIS map coordinates, and corridor topologies (`list_cameras`, `get_camera_details`).
3. Query real-time loitering and abandoned baggage security alerts (`get_system_alerts`).
4. Review evidentiary search history audit logs for forensic chain-of-custody validation (`get_search_logs`).
5. Retrieve high-level Smart City command-center overview metrics (`get_dashboard_metrics`).
6. Inspect registered ML object detection models and YOLO weights (`list_models`).
7. Assign an ML object detection model to a target camera node (`assign_camera_model`).
8. Trigger vector re-indexing for a video feed (`trigger_video_reindex`).

Instructions for In-Domain Queries:
- Always use relevant tool calls (`search_tracklets`, `list_cameras`, `get_camera_details`, `get_system_alerts`, `get_search_logs`, `get_dashboard_metrics`, `list_models`, `assign_camera_model`, `trigger_video_reindex`) to query actual database evidence before making assertions.
- Format answers with clean GitHub Markdown.
- Highlight key forensic parameters (camera name/ID, timestamps, similarity confidence scores, tracklet IDs).
"""


class AssistantAgent:
    """Agent orchestrating LLM tool calling loops and response construction."""

    def __init__(self, provider: BaseLLMProvider):
        self.provider = provider

    def run_conversation(
        self,
        messages: List[Dict[str, Any]],
        db: Session,
        max_tool_loops: int = 3
    ) -> Dict[str, Any]:
        executor = ToolExecutor(db)
        # Keep only the last 6 messages to stay well within API token rate limits (TPM)
        history = list(messages[-6:])
        executed_tools: List[Dict[str, Any]] = []
        structured_attachments: List[Dict[str, Any]] = []

        for loop_idx in range(max_tool_loops):
            res = self.provider.chat(messages=history, tools=TOOL_SCHEMAS, system_prompt=SYSTEM_PROMPT)
            content = res.get("content", "")
            tool_calls = res.get("tool_calls", [])

            if not tool_calls:
                return {
                    "role": "assistant",
                    "content": content,
                    "executed_tools": executed_tools,
                    "attachments": structured_attachments
                }

            # 1. Format assistant message with list of requested tool_calls
            assistant_tool_calls = []
            for i, tc in enumerate(tool_calls):
                call_id = tc.get("id") or f"call_{loop_idx}_{i}"
                fn_name = tc["function"]["name"]
                fn_args = tc["function"]["arguments"]
                args_str = json.dumps(fn_args) if isinstance(fn_args, dict) else str(fn_args)

                assistant_tool_calls.append({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": fn_name,
                        "arguments": args_str
                    }
                })

            history.append({
                "role": "assistant",
                "content": content or None,
                "tool_calls": assistant_tool_calls
            })

            # 2. Execute each tool and append tool result message with matching tool_call_id
            for i, tc in enumerate(tool_calls):
                call_id = assistant_tool_calls[i]["id"]
                fn_name = tc["function"]["name"]
                fn_args = tc["function"]["arguments"]

                tool_result = executor.execute_tool(fn_name, fn_args)
                executed_tools.append({
                    "name": fn_name,
                    "args": fn_args,
                    "status": tool_result.get("status", "success"),
                    "result_count": tool_result.get("count", 0)
                })

                if fn_name == "search_tracklets" and "results" in tool_result:
                    structured_attachments.extend(tool_result["results"])

                history.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": fn_name,
                    "content": json.dumps(tool_result)
                })

        # Final turn after max tool loops
        final_res = self.provider.chat(messages=history, tools=None, system_prompt=SYSTEM_PROMPT)
        return {
            "role": "assistant",
            "content": final_res.get("content", ""),
            "executed_tools": executed_tools,
            "attachments": structured_attachments
        }
