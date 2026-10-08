"""Copilot write tools are proposed, never executed, until an officer confirms them."""

import json
from datetime import datetime, timedelta, timezone

import pytest

import app.api.audit as audit
from app.assistant import confirmations
from app.assistant.agent import AssistantAgent
from app.db.models import CameraProfile, ChatSession, MLModel


class ScriptedProvider:
    """Fake LLM: returns the scripted replies in order and records what it was sent."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def chat(self, messages, tools=None, system_prompt=None):
        self.calls.append([dict(m) for m in messages])
        return self.replies.pop(0) if self.replies else {"content": "ok", "tool_calls": []}


def _call(name, **args):
    return {"content": "", "tool_calls": [{"id": "c1", "function": {"name": name, "arguments": args}}]}


@pytest.fixture
def world(db, monkeypatch):
    audit_entries = []
    monkeypatch.setattr(audit, "write_audit_log", lambda entry: audit_entries.append(entry))
    confirmations._pending.clear()
    db.add(CameraProfile(camera_id="CAM_004", name="Surat Railway Station", adjacency="[]", model_id=""))
    db.add(MLModel(id="m1", name="Model v1", file_path="models/m1.pt", model_type="YOLOv8"))
    db.commit()
    return db, audit_entries


def _camera_model(db):
    db.expire_all()
    return db.query(CameraProfile).filter(CameraProfile.camera_id == "CAM_004").first().model_id


def test_write_tool_is_proposed_not_executed(world):
    db, _ = world
    reply = AssistantAgent(ScriptedProvider(_call("assign_camera_model", camera_id="CAM_004", model_id="m1"))).run_conversation(
        [{"role": "user", "content": "assign model m1 to CAM_004"}], db
    )
    action = reply["pending_action"]
    assert action["status"] == "pending"
    assert action["summary"] == "Assign detection model 'Model v1' to camera Surat Railway Station (CAM_004)"
    assert "confirmation" in reply["content"]
    assert _camera_model(db) == ""  # nothing changed


def test_missing_arguments_are_asked_for_not_guessed(world):
    db, _ = world
    provider = ScriptedProvider(_call("assign_camera_model", camera_id="CAM_004"), {"content": "Which model?", "tool_calls": []})
    reply = AssistantAgent(provider).run_conversation(
        [{"role": "user", "content": "Which model is assigned to CAM_004?"}], db
    )
    assert "pending_action" not in reply
    assert reply["content"] == "Which model?"
    tool_msgs = [m for m in provider.calls[-1] if m.get("role") == "tool"]
    assert json.loads(tool_msgs[0]["content"])["status"] == "not_executed"
    assert _camera_model(db) == ""


def test_read_tools_still_run_directly(world):
    db, _ = world
    provider = ScriptedProvider(_call("list_cameras"), {"content": "1 camera", "tool_calls": []})
    reply = AssistantAgent(provider).run_conversation([{"role": "user", "content": "list cameras"}], db)
    assert reply["executed_tools"][0]["name"] == "list_cameras"
    assert "pending_action" not in reply


def test_confirm_executes_stored_action_once_and_audits(world, client):
    db, audit_entries = world
    session = ChatSession(id="s1", title="t", messages=json.dumps([
        {"role": "assistant", "content": "confirm?", "pending_action": {"id": "x", "status": "pending"}}
    ]))
    db.add(session)
    db.commit()
    action = confirmations.propose(db, "assign_camera_model", {"camera_id": "CAM_004", "model_id": "m1"})
    confirmations.attach_session(action["id"], "s1")
    # patch the stored chat message id to the real action id
    session.messages = json.dumps([{"role": "assistant", "content": "confirm?", "pending_action": {"id": action["id"], "status": "pending"}}])
    db.commit()

    res = client.post(f"/api/v1/assistant/actions/{action['id']}/confirm", json={"decided_by": "Badge #4082"})
    assert res.status_code == 200 and res.json()["status"] == "confirmed"
    assert _camera_model(db) == "m1"
    assert audit_entries[-1].action == "confirmed" and audit_entries[-1].user_id == "Badge #4082"

    db.expire_all()
    history = json.loads(db.query(ChatSession).get("s1").messages)
    assert history[0]["pending_action"]["status"] == "confirmed"
    assert history[-1]["content"].startswith("Done: Assign detection model")

    again = client.post(f"/api/v1/assistant/actions/{action['id']}/confirm", json={})
    assert again.status_code == 404  # single use


def test_cancel_changes_nothing(world, client):
    db, audit_entries = world
    action = confirmations.propose(db, "assign_camera_model", {"camera_id": "CAM_004", "model_id": "m1"})
    res = client.post(f"/api/v1/assistant/actions/{action['id']}/cancel", json={})
    assert res.json()["status"] == "cancelled"
    assert _camera_model(db) == ""
    assert audit_entries[-1].action == "cancelled"
    assert client.post(f"/api/v1/assistant/actions/{action['id']}/confirm", json={}).status_code == 404


def test_expired_action_cannot_run(world, client):
    db, _ = world
    action = confirmations.propose(db, "assign_camera_model", {"camera_id": "CAM_004", "model_id": "m1"})
    confirmations._pending[action["id"]]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert client.post(f"/api/v1/assistant/actions/{action['id']}/confirm", json={}).status_code == 404
    assert _camera_model(db) == ""


def test_client_cannot_change_what_runs(world, client):
    db, _ = world
    db.add(MLModel(id="evil", name="Other", file_path="models/o.pt", model_type="YOLOv8"))
    db.commit()
    action = confirmations.propose(db, "assign_camera_model", {"camera_id": "CAM_004", "model_id": "m1"})
    client.post(f"/api/v1/assistant/actions/{action['id']}/confirm",
                json={"decided_by": "x", "args": {"camera_id": "CAM_004", "model_id": "evil"}})
    assert _camera_model(db) == "m1"


def test_every_write_tool_requires_confirmation():
    from app.assistant.tools import TOOL_SCHEMAS

    names = {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert set(confirmations.WRITE_TOOLS) <= names
    read_only = names - set(confirmations.WRITE_TOOLS)
    assert all(n.startswith(("get_", "list_", "search_", "reconstruct_")) for n in read_only), read_only
