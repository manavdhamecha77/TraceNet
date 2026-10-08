from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from loguru import logger

from app.assistant.llm_provider import BaseLLMProvider
from app.assistant.guard import REFUSAL, is_off_topic
from app.assistant.tools import TOOL_SCHEMAS, ToolExecutor

SYSTEM_PROMPT = """You are TraceNet Copilot, a domain-specific AI Digital Forensics & Video Analytics Assistant for Smart City CCTV Surveillance (Project DRISHTI).

DOMAIN BOUNDARY:
- You serve ONLY Smart City CCTV Surveillance and Digital Forensics on this platform: camera nodes, footage search for people and vehicles, security alerts (loitering, abandoned objects, chain snatching/theft, assault/fighting, accidents), multi-camera tracking, pursuit waves, forensic audit logs and ML model management.
- Every request you receive has already passed an off-topic filter, so it IS about this platform. Never decline it: answer it using your tools, even when it is short, informal, or mentions places such as gates, stations or markets.

Core Platform Capabilities & Available Tools:
1. Search CCTV video tracklets using natural language descriptions or visual attributes (`search_tracklets`).
2. Inspect smart city camera profiles, GIS map coordinates, and corridor topologies (`list_cameras`, `get_camera_details`).
3. Query real-time loitering, abandoned baggage, chain snatching, and assault security alerts (`get_system_alerts`, `get_chain_snatching_alerts`, `get_assault_alerts`).
4. Reconstruct multi-camera spatial-temporal DAG journey trajectory path across camera nodes (`reconstruct_trajectory`).
5. Activate predictive downstream pursuit wave across neighbor cameras (`activate_pursuit_wave`).
6. Trigger 4 FPS kinematic chain snatching and violent theft analysis (`analyze_chain_snatching`).
7. Trigger VideoMAE physical assault & fighting detection scan on video feeds (`detect_assault`).
8. Review evidentiary search history audit logs for forensic chain-of-custody validation (`get_search_logs`).
9. Retrieve high-level Smart City command-center overview metrics (`get_dashboard_metrics`).
10. Inspect registered ML object detection models and YOLO weights (`list_models`).
11. Assign an ML object detection model to a target camera node (`assign_camera_model`).
12. Trigger vector re-indexing for a video feed (`trigger_video_reindex`).

Instructions for In-Domain Queries:
- Officers may write in Hindi, Gujarati or romanised Hinglish/Gujlish (e.g. "laal gaadi dikhao" = "show the red car"). These are normal in-domain requests, never refuse them for their language; an English rendering is added in brackets when available. Answer in English.
- Always use relevant tool calls (`search_tracklets`, `list_cameras`, `get_camera_details`, `get_system_alerts`, `get_search_logs`, `get_dashboard_metrics`, `list_models`, `assign_camera_model`, `trigger_video_reindex`, `reconstruct_trajectory`, `activate_pursuit_wave`, `get_chain_snatching_alerts`, `analyze_chain_snatching`, `get_assault_alerts`, `detect_assault`) to query actual database evidence before making assertions.
- Format answers with clean GitHub Markdown.
- Highlight key forensic parameters (camera name/ID, timestamps, similarity confidence scores, tracklet IDs).
"""


def _with_english_rendering(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Append an English rendering to the latest user message when it contains Hindi / Gujarati / Hinglish
    terms, so small local models recognise the request as in-domain and can call the right tools."""
    idx = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].get("role") == "user"), None)
    if idx is None or not messages[idx].get("content"):
        return messages
    try:
        from app.search.multilingual import normalize_query

        english, substitutions = normalize_query(str(messages[idx]["content"]))
    except Exception:
        return messages
    if not substitutions:
        return messages
    updated = list(messages)
    updated[idx] = {**messages[idx], "content": f"{messages[idx]['content']}\n[English: {english}]"}
    return updated


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
        last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
        if last_user and not last_user.get("image_b64") and is_off_topic(str(last_user.get("content") or "")):
            logger.info("Copilot domain guard: refused an off-topic request without calling the LLM.")
            return {"role": "assistant", "content": REFUSAL, "executed_tools": [], "attachments": []}

        messages = _with_english_rendering(messages)
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
