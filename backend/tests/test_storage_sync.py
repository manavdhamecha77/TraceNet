"""Offline tests for the golden-snapshot sync helpers (no S3 access needed)."""

import os
import sqlite3

from app.storage.sync import list_data_files, rebase_db_paths, snapshot_db


def _make_db(path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE models (id TEXT, file_path TEXT)")
    conn.execute("CREATE TABLE tracklets (id TEXT, best_crop_path TEXT, attributes TEXT)")
    conn.execute("CREATE TABLE chat_sessions (id TEXT, messages TEXT)")
    conn.executemany("INSERT INTO models VALUES (?, ?)", [
        ("m1", r"D:\Aayush\Projects\nexus\backend\data\models\abc.pt"),
        ("m2", "/home/teammate/TraceNet/backend/data/models/face_detection/yolov8n-face.pt"),
        ("m3", "models/relative.pt"),
    ])
    conn.executemany("INSERT INTO tracklets VALUES (?, ?, ?)", [
        ("t1", r"S:\TraceNet\backend\data\processed\detections\v1\crops\t1.jpg", '{"caption": "x"}'),
        ("t2", None, None),
    ])
    conn.execute("INSERT INTO chat_sessions VALUES ('c1', ?)", (r'[{"content": "D:\\x\\backend\\data\\y"}]',))
    conn.commit()
    conn.close()


def test_rebase_rewrites_foreign_absolute_paths(tmp_path):
    db = tmp_path / "drishti.db"
    _make_db(db)
    local_data = tmp_path / "data"

    assert rebase_db_paths(db, local_data) == 3

    conn = sqlite3.connect(db)
    paths = dict(conn.execute("SELECT id, file_path FROM models"))
    assert paths["m1"] == os.path.join(str(local_data), "models", "abc.pt")
    assert paths["m2"] == os.path.join(str(local_data), "models", "face_detection", "yolov8n-face.pt")
    assert paths["m3"] == "models/relative.pt"  # relative paths are left alone
    crop = conn.execute("SELECT best_crop_path FROM tracklets WHERE id='t1'").fetchone()[0]
    assert crop == os.path.join(str(local_data), "processed", "detections", "v1", "crops", "t1.jpg")
    # free-text chat history is never touched
    assert "D:" in conn.execute("SELECT messages FROM chat_sessions").fetchone()[0]
    conn.close()

    assert rebase_db_paths(db, local_data) == 0  # idempotent


def test_list_data_files_skips_secrets_locks_and_db(tmp_path):
    for rel in [
        "drishti.db", "assistant_config.json", "anpr_config.json", "audit_logs/2026.jsonl",
        "mediamtx/mediamtx.exe", "_backups/x/drishti.db", "certs/tracenet-dev.key", "vector_db/.lock", "processed/a.jpg.part",
        "models/vehicle.pt", "vector_db/meta.json", "processed/detections/v1/crops/t1.jpg",
        "chain_snatching_config.json",
    ]:
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    assert list_data_files(tmp_path) == [
        "chain_snatching_config.json",
        "models/vehicle.pt",
        "processed/detections/v1/crops/t1.jpg",
        "vector_db/meta.json",
    ]


def test_snapshot_db_is_a_consistent_copy(tmp_path):
    src = tmp_path / "src.db"
    _make_db(src)
    out = tmp_path / "out"
    out.mkdir()
    copy = snapshot_db(src, out)
    assert sqlite3.connect(copy).execute("SELECT count(*) FROM tracklets").fetchone()[0] == 2
