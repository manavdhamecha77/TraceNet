from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from loguru import logger

from app.assistant.llm_provider import BaseLLMProvider
from app.assistant.tools import TOOL_SCHEMAS, ToolExecutor

SYSTEM_PROMPT = """You are TraceNet Copilot, an elite AI Digital Forensics and Video Analytics Assistant for Smart City CCTV Surveillance.
You assist surveillance teams and law enforcement officers in analyzing CCTV archives, searching for targets (people and vehicles), inspecting camera GIS nodes, and reviewing loitering/abandoned object security alerts.

Core Capabilities:
1. Search tracklets using natural language (`search_tracklets`).
2. List camera profiles, locations, and corridor groups (`list_cameras`, `get_camera_details`).
3. Query loitering and abandoned baggage security alerts (`get_system_alerts`).
4. Inspect evidentiary search history audit logs (`get_search_logs`).

Instructions:
- Use tool calls to fetch actual database data before making claims.
- Be concise, evidentiary, professional, and clear.
- Use GitHub markdown for formatting response text.
- Highlight key matching observations (camera name, timestamps, similarity confidence scores).
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
