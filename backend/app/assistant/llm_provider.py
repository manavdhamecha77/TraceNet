from __future__ import annotations

import abc
import json
import requests
from typing import Any, List, Dict, Optional
from loguru import logger


class BaseLLMProvider(abc.ABC):
    """Abstract base class for LLM providers."""

    @abc.abstractmethod
    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes a chat completion call.
        Returns standardized dict: {'content': str, 'tool_calls': list[dict]}
        """
        pass


class OllamaProvider(BaseLLMProvider):
    """Local LLM provider using Ollama REST API (e.g. Qwen2.5 3B/7B)."""

    def __init__(self, host: str = "http://localhost:11434", model: str = "qwen2.5:3b"):
        self.host = host.rstrip("/")
        self.model = model

    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        url = f"{self.host}/api/chat"
        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        
        for msg in messages:
            item = {"role": msg["role"], "content": msg["content"]}
            if "images" in msg:
                item["images"] = msg["images"]  # Base64 image strings for Ollama vision models
            formatted_messages.append(item)

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": formatted_messages,
            "stream": False
        }
        if tools:
            payload["tools"] = tools

        try:
            resp = requests.post(url, json=payload, timeout=90)

            # If 400 error occurs due to passing images to a text-only Ollama model, strip raw images and retry
            if resp.status_code == 400:
                has_images = any("images" in m for m in formatted_messages)
                if has_images:
                    logger.info(f"Ollama model '{self.model}' rejected raw image array. Retrying with text prompt + backend vector search...")
                    clean_messages = []
                    for m in formatted_messages:
                        c = dict(m)
                        c.pop("images", None)
                        clean_messages.append(c)
                    payload["messages"] = clean_messages
                    resp = requests.post(url, json=payload, timeout=90)

            if resp.status_code == 404:
                try:
                    err_data = resp.json()
                    err_detail = err_data.get("error", "")
                except Exception:
                    err_detail = ""

                if "not found" in err_detail.lower():
                    raise RuntimeError(
                        f"Ollama model '{self.model}' is not installed locally. "
                        f"Run 'ollama pull {self.model}' in your terminal, or switch to Cloud OpenAI API in Copilot Settings."
                    )
                else:
                    # Fallback try Ollama OpenAI-compatible v1 endpoint
                    v1_url = f"{self.host}/v1/chat/completions"
                    v1_resp = requests.post(v1_url, json=payload, timeout=90)
                    if v1_resp.status_code == 200:
                        v1_data = v1_resp.json()
                        v1_choice = v1_data["choices"][0]["message"]
                        return {
                            "content": v1_choice.get("content") or "",
                            "tool_calls": v1_choice.get("tool_calls", [])
                        }

            resp.raise_for_status()
            data = resp.json()
            msg = data.get("message", {})
            
            tool_calls = []
            if msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    func = tc.get("function", {})
                    tool_calls.append({
                        "function": {
                            "name": func.get("name"),
                            "arguments": func.get("arguments", {})
                        }
                    })

            return {
                "content": msg.get("content", ""),
                "tool_calls": tool_calls
            }
        except RuntimeError:
            raise
        except requests.exceptions.ConnectionError:
            raise RuntimeError(
                f"Could not connect to Ollama server at '{self.host}'. "
                f"Ensure Ollama application is running on your machine, or switch to Cloud OpenAI API in Copilot Settings."
            ) from None
        except Exception as e:
            logger.error(f"Ollama provider connection error on {self.host}: {e}")
            raise RuntimeError(f"Ollama local LLM connection error ({self.host}, model={self.model}): {e}") from e


class CloudOpenAIProvider(BaseLLMProvider):
    """Universal OpenAI-compatible API provider (e.g. Groq, OpenRouter, DeepSeek, Ollama v1, LMStudio, OpenAI)."""

    def __init__(self, api_key: str = "", model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key or ""
        self.model = model
        self.base_url = base_url.rstrip("/")

    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        # Handle trailing /chat/completions if user accidentally included it in base_url
        if self.base_url.endswith("/chat/completions"):
            url = self.base_url
        else:
            url = f"{self.base_url}/chat/completions"

        headers = {
            "Content-Type": "application/json"
        }
        if self.api_key.strip():
            headers["Authorization"] = f"Bearer {self.api_key.strip()}"

        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        
        for msg in messages:
            item: Dict[str, Any] = {"role": msg["role"]}
            if "image_b64" in msg and msg["image_b64"]:
                item["content"] = [
                    {"type": "text", "text": msg["content"]},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{msg['image_b64']}"}}
                ]
            else:
                item["content"] = msg["content"]
            formatted_messages.append(item)

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": formatted_messages
        }
        if tools:
            payload["tools"] = tools

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=90)
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]["message"]
            
            tool_calls = []
            if choice.get("tool_calls"):
                for tc in choice["tool_calls"]:
                    func = tc.get("function", {})
                    args_raw = func.get("arguments", {})
                    if isinstance(args_raw, str):
                        try:
                            args = json.loads(args_raw)
                        except Exception:
                            args = {}
                    else:
                        args = args_raw

                    tool_calls.append({
                        "function": {
                            "name": func.get("name"),
                            "arguments": args
                        }
                    })

            return {
                "content": choice.get("content") or "",
                "tool_calls": tool_calls
            }
        except Exception as e:
            logger.error(f"Universal API provider error on {url}: {e}")
            raise RuntimeError(f"API Provider execution error ({self.base_url}, model={self.model}): {e}") from e
