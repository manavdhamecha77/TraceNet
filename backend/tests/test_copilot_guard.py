"""The Copilot domain guard refuses clearly off-topic requests and never blocks platform questions."""

import pytest

from app.assistant.agent import AssistantAgent
from app.assistant.guard import REFUSAL, is_off_topic

OFF_TOPIC = [
    "Write me a poem about cats",
    "write a poem about a CCTV camera",
    "Tell me a joke",
    "Solve this equation: 2x + 3 = 11",
    "Help me with my calculus homework",
    "Write a python function to reverse a list",
    "What is the capital of France?",
    "Who is the prime minister of India?",
    "What's the weather forecast for tomorrow?",
    "Give me a recipe for paneer butter masala",
    "Should I buy bitcoin?",
]

IN_DOMAIN = [
    "Find a white car seen on the cameras",
    "Show me unacknowledged alerts",
    "man in red jacket near gate 3 after 5 PM",
    "List all cameras in the Surat station area",
    "Reconstruct the journey for tracklet 2fce7e8a-efb1-43e2-b031-ae7bb3980736_trk_4",
    "Any theft or chain snatching alerts today?",
    "Which detector model is assigned to CAM_004?",
    "Show the search audit logs",
    "Write an incident report for the loitering alert",
    "Generate the pair code for the live stream",
    "laal gaadi dikhao",
    "kaala maanas gate paas",
    "सफेद कार",
    "Who is the suspect in the CAM_001 footage?",
    "thanks",
    "show more",
    "",
]


@pytest.mark.parametrize("text", OFF_TOPIC)
def test_refuses_off_topic(text):
    assert is_off_topic(text)


@pytest.mark.parametrize("text", IN_DOMAIN)
def test_allows_platform_questions(text):
    assert not is_off_topic(text)


class _FailingProvider:
    def chat(self, **kwargs):
        raise AssertionError("LLM must not be called for an off-topic request")


def test_agent_refuses_without_calling_llm(db):
    reply = AssistantAgent(_FailingProvider()).run_conversation(
        messages=[{"role": "user", "content": "Write me a poem about cats"}], db=db
    )
    assert reply["content"] == REFUSAL
    assert reply["executed_tools"] == []
