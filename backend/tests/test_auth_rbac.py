"""Login + Operator/Admin access control, enforced on every request."""

import json

import pytest
from sqlalchemy.orm import sessionmaker

import app.api.audit as audit
import app.api.auth as auth_api
import app.auth.middleware as mw
import app.auth.security as security
from app.assistant import confirmations
from app.auth.policy import ADMIN, PUBLIC, USER, required_access
from app.db.models import Alert, CameraProfile, MLModel, UserAccount


@pytest.fixture
def secure(engine, db, client, monkeypatch):
    """Login enforced, accounts read from the test DB, fixed signing secret."""
    monkeypatch.setattr(mw, "auth_enabled", lambda: True)
    monkeypatch.setattr(auth_api, "auth_enabled", lambda: True)
    monkeypatch.setattr(mw, "_session_factory", sessionmaker(bind=engine))
    monkeypatch.setattr(security, "_secret", lambda: b"test-secret")
    monkeypatch.setattr(audit, "write_audit_log", lambda entry: None)
    monkeypatch.setattr(auth_api.time, "sleep", lambda s: None)
    mw._cache.clear()
    confirmations._pending.clear()
    db.add(UserAccount(id="u-admin", username="chief", display_name="Insp. Chief / #1", role="admin",
                       password_hash=security.hash_password("admin-pass-123")))
    db.add(UserAccount(id="u-op", username="officer", display_name="J. Doe / Badge #4082", role="operator",
                       password_hash=security.hash_password("operator-pass-123")))
    db.commit()
    client.cookies.clear()
    return client


def login(client, username, password):
    return client.post("/api/v1/auth/login", json={"username": username, "password": password})


def test_requests_need_login_but_public_routes_stay_open(secure):
    assert secure.get("/api/v1/cameras").status_code == 401
    assert secure.get("/data/cameras/CAM_1_X/thumbnails/a.jpg").status_code == 401  # media files too
    assert secure.get("/health").status_code == 200
    assert secure.get("/api/v1/auth/status").json() == {"auth_enabled": True, "has_users": True}
    # Device endpoints are not blocked by login: they answer with their own device-token check
    res = secure.post("/api/v1/stream/pair/stop")
    assert res.status_code == 401 and res.json()["detail"] == "Invalid device token"


def test_login_sets_session_cookie_and_rejects_bad_passwords(secure):
    assert login(secure, "officer", "wrong-password").status_code == 401
    res = login(secure, "OFFICER", "operator-pass-123")  # usernames are case-insensitive
    assert res.status_code == 200 and res.json()["user"]["role"] == "operator"
    assert "password_hash" not in res.json()["user"]
    assert secure.get("/api/v1/auth/me").json()["user"]["username"] == "officer"
    assert secure.get("/api/v1/cameras").status_code == 200
    secure.post("/api/v1/auth/logout")
    assert secure.get("/api/v1/cameras").status_code == 401


def test_bearer_token_works_and_tampered_token_does_not(secure):
    token = login(secure, "chief", "admin-pass-123").json()["token"]
    secure.cookies.clear()
    assert secure.get("/api/v1/auth/users", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    body, sig = token.split(".")
    forged = security._b64(json.dumps({"sub": "u-op", "role": "admin", "exp": 9999999999}).encode()) + "." + sig
    assert secure.get("/api/v1/cameras", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_operator_cannot_reach_admin_actions(secure):
    login(secure, "officer", "operator-pass-123")
    assert secure.post("/api/v1/models").status_code == 403
    assert secure.delete("/api/v1/videos/v1/delete").status_code == 403
    assert secure.post("/api/v1/create-new-camera", json={}).status_code == 403
    assert secure.get("/api/v1/auth/users").status_code == 403
    assert secure.get("/api/v1/audit/search-history").status_code == 403
    assert secure.post("/api/v1/assistant/config", json={}).status_code == 403


def test_records_carry_the_logged_in_user_not_the_browser_value(secure, db):
    db.add(Alert(id=7, alert_type="loitering", tracklet_id="t1", camera_id="CAM_1"))
    db.commit()
    login(secure, "officer", "operator-pass-123")
    res = secure.put("/api/v1/alerts/7/acknowledge", params={"acknowledged_by": "Someone Else"})
    assert res.status_code == 200 and res.json()["acknowledged_by"] == "J. Doe / Badge #4082"


def test_admin_manages_users_and_disabling_takes_effect_immediately(secure):
    login(secure, "chief", "admin-pass-123")
    created = secure.post("/api/v1/auth/users", json={
        "username": "night1", "display_name": "Night Shift 1", "role": "operator", "password": "night-pass-123"})
    assert created.status_code == 201
    assert secure.post("/api/v1/auth/users", json={
        "username": "x1", "display_name": "x", "role": "operator", "password": "short"}).status_code == 422
    # last active admin cannot be demoted or disabled
    assert secure.patch("/api/v1/auth/users/u-admin", json={"role": "operator"}).status_code == 409

    secure.cookies.clear()
    login(secure, "night1", "night-pass-123")
    assert secure.get("/api/v1/cameras").status_code == 200
    night_cookie = dict(secure.cookies)
    secure.cookies.clear()
    login(secure, "chief", "admin-pass-123")
    secure.patch(f"/api/v1/auth/users/{created.json()['id']}", json={"is_active": False})
    secure.cookies.clear()
    assert secure.get("/api/v1/cameras", cookies=night_cookie).status_code == 401


def test_admin_only_copilot_tools_need_an_admin_to_confirm(secure, db):
    db.add(CameraProfile(camera_id="CAM_004", name="Station", adjacency="[]", model_id=""))
    db.add(MLModel(id="m1", name="Model v1", file_path="models/m1.pt", model_type="YOLOv8"))
    db.commit()
    action = confirmations.propose(db, "assign_camera_model", {"camera_id": "CAM_004", "model_id": "m1"})

    login(secure, "officer", "operator-pass-123")
    assert secure.post(f"/api/v1/assistant/actions/{action['id']}/confirm", json={}).status_code == 403
    secure.cookies.clear()
    login(secure, "chief", "admin-pass-123")
    res = secure.post(f"/api/v1/assistant/actions/{action['id']}/confirm", json={})  # still pending
    assert res.status_code == 200 and res.json()["status"] == "confirmed"


@pytest.mark.parametrize("method, path, expected", [
    ("GET", "/api/v1/search/logs", USER),
    ("POST", "/api/v1/search", USER),
    ("POST", "/api/v1/ingest", USER),
    ("PUT", "/api/v1/alerts/5/acknowledge", USER),
    ("POST", "/api/v1/multicam/targets/tag", USER),
    ("POST", "/api/v1/exports", USER),
    ("GET", "/data/cameras/x/original_assets/a.mp4", USER),
    ("POST", "/api/v1/models", ADMIN),
    ("PUT", "/api/v1/cameras/CAM_1", ADMIN),
    ("POST", "/api/v1/cameras/CAM_1/thumbnail", ADMIN),
    ("DELETE", "/api/v1/cameras/CAM_1/thumbnail", ADMIN),
    ("DELETE", "/api/v1/videos/abc/delete", ADMIN),
    ("POST", "/api/v1/reindex-all", ADMIN),
    ("PATCH", "/api/v1/auth/users/abc", ADMIN),
    ("POST", "/api/v1/auth/login", PUBLIC),
    ("POST", "/api/v1/stream/mediamtx-auth", PUBLIC),
    ("GET", "/camera-app/index.html", PUBLIC),
])
def test_policy_table(method, path, expected):
    assert required_access(method, path) == expected


@pytest.mark.parametrize("path", [
    "/data/drishti.db", "/data/assistant_config.json", "/data/.auth_secret", "/data/vector_db/meta.json",
    "/data/models/x.pt", "/data/audit_logs/a.jsonl", "/data/_backups/x/drishti.db", "/data",
    "/data/cameras/../drishti.db",
])
def test_sensitive_data_files_are_never_served(path, client, monkeypatch):
    # enforced even with login disabled (the default in tests)
    assert required_access("GET", path) == "denied"
    assert client.get(path).status_code == 404


def test_media_folders_are_still_served():
    for path in ("/data/cameras/CAM_1_X/thumbnails/a.jpg", "/data/processed/detections/v/crops/t.jpg",
                 "/data/areas/a1/thumb.png", "/data/streams/CAM_1/c.mp4"):
        assert required_access("GET", path) == USER
