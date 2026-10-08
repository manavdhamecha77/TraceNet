"""Seed script to ensure realistic demo data (alerts, reports, active targets) exists in drishti.db."""

import os
import json
import uuid
from datetime import datetime, timezone, timedelta
from app.config import get_data_path
from app.db.session import SessionLocal
from app.db.models import Alert, CrimeReport, HotTarget, Tracklet, VideoAsset, CameraProfile


def seed_demo_data():
    db = SessionLocal()
    try:
        # Check available tracklets and videos
        tracklets = db.query(Tracklet).limit(10).all()
        if not tracklets:
            print("No tracklets found in database to seed from.")
            return

        t1 = tracklets[0]
        t2 = tracklets[1] if len(tracklets) > 1 else t1
        t3 = tracklets[2] if len(tracklets) > 2 else t1
        t4 = tracklets[3] if len(tracklets) > 3 else t1

        now = datetime.now(timezone.utc)

        # 1. Clear old alerts to avoid duplicate clutter and seed fresh realistic ones
        existing_alerts = db.query(Alert).count()
        if existing_alerts == 0:
            alerts = [
                Alert(
                    alert_type="chain_snatching",
                    camera_id=t1.camera_id or "CAM_001",
                    tracklet_id=t1.id,
                    video_id=t1.video_id,
                    abandon_duration_seconds=45.0,
                    analysis_log=json.dumps({
                        "event": "Rapid acceleration vector (velocity jump > 3.2x) and spatial proximity threshold exceeded.",
                        "confidence": 0.94,
                        "suspect_label": "[SUSPECT_01]",
                        "victim_label": "[VICTIM_01]"
                    }),
                    timestamp=now - timedelta(minutes=18),
                    acknowledged=False
                ),
                Alert(
                    alert_type="loitering",
                    camera_id=t2.camera_id or "CAM_001",
                    tracklet_id=t2.id,
                    video_id=t2.video_id,
                    abandon_duration_seconds=84.5,
                    analysis_log=json.dumps({
                        "zone_name": "High-Security North Gate",
                        "dwell_seconds": 84.5,
                        "threshold_seconds": 60.0,
                        "status": "threshold_exceeded"
                    }),
                    timestamp=now - timedelta(minutes=48),
                    acknowledged=False
                ),
                Alert(
                    alert_type="assault",
                    camera_id=t3.camera_id or "CAM_002",
                    tracklet_id=t3.id,
                    video_id=t3.video_id,
                    abandon_duration_seconds=30.0,
                    analysis_log=json.dumps({
                        "event": "Physical altercation detected with high confidence.",
                        "confidence": 0.89,
                        "keyframe_index": 142
                    }),
                    timestamp=now - timedelta(hours=2, minutes=15),
                    acknowledged=True,
                    acknowledged_by="Forensic Operator (Badge #4082)",
                    acknowledged_at=now - timedelta(hours=1, minutes=55)
                ),
                Alert(
                    alert_type="abandoned_object",
                    camera_id=t4.camera_id or "CAM_009",
                    tracklet_id=t4.id,
                    video_id=t4.video_id,
                    object_tracklet_id=t4.id,
                    abandon_duration_seconds=120.0,
                    analysis_log=json.dumps({
                        "object_class": "backpack",
                        "unattended_duration_sec": 120.0,
                        "potential_visitors": 2
                    }),
                    timestamp=now - timedelta(hours=4),
                    acknowledged=True,
                    acknowledged_by="Supervisor (Badge #1104)",
                    acknowledged_at=now - timedelta(hours=3, minutes=30)
                )
            ]
            for a in alerts:
                db.add(a)
            db.commit()
            print(f"Seeded {len(alerts)} alerts into database.")

        # 2. Seed Crime Reports if empty
        existing_reports = db.query(CrimeReport).count()
        if existing_reports == 0:
            first_alert = db.query(Alert).filter(Alert.alert_type == "chain_snatching").first()
            second_alert = db.query(Alert).filter(Alert.alert_type == "loitering").first()

            reports = [
                CrimeReport(
                    id=str(uuid.uuid4()),
                    report_type="theft",
                    alert_id=first_alert.id if first_alert else None,
                    camera_id=t1.camera_id or "CAM_001",
                    video_id=t1.video_id,
                    title="Incident Report #CR-2026-089: Snatching Incident at Market Perimeter",
                    description="Automated threat intelligence flagged high-speed physical snatching and pedestrian theft event. Suspect tracked on departure vector toward Gate 4.",
                    severity="high",
                    status="reviewed",
                    detection_confidence=0.94,
                    detected_objects=json.dumps(["person", "handbag", "motorcycle"]),
                    frame_count=45,
                    incident_timestamp=now - timedelta(minutes=18),
                    detection_timestamp=now - timedelta(minutes=15),
                    report_generated_at=now - timedelta(minutes=12),
                    location="Zone 1 Market Perimeter",
                    assigned_to="Insp. Vikram Singh (Badge #4082)",
                    notes="Forensic keyframes reviewed and tagged for Sentinel Wave cross-camera pursuit.",
                    created_by="admin_operator"
                ),
                CrimeReport(
                    id=str(uuid.uuid4()),
                    report_type="loitering",
                    alert_id=second_alert.id if second_alert else None,
                    camera_id=t2.camera_id or "CAM_001",
                    video_id=t2.video_id,
                    title="Incident Report #CR-2026-090: Dwell-Time Violation Near Perimeter",
                    description="Subject loitering inside restricted entrance zone for 84.5s, exceeding the configured 60s threshold.",
                    severity="medium",
                    status="pending",
                    detection_confidence=0.85,
                    detected_objects=json.dumps(["person"]),
                    frame_count=84,
                    incident_timestamp=now - timedelta(minutes=48),
                    detection_timestamp=now - timedelta(minutes=45),
                    report_generated_at=now - timedelta(minutes=40),
                    location="Restricted North Entry",
                    assigned_to="Officer Rajesh Patel (Badge #3120)",
                    notes="Patrol unit dispatched for field verification.",
                    created_by="admin_operator"
                )
            ]
            for r in reports:
                db.add(r)
            db.commit()
            print(f"Seeded {len(reports)} crime reports into database.")

        # 3. Ensure at least 2 hot targets are active for live pursuit demo
        targets = db.query(HotTarget).all()
        if targets:
            for idx, target in enumerate(targets[:2]):
                target.status = "active"
                target.priority = "CRITICAL" if idx == 0 else "HIGH"
            db.commit()
            print("Set top 2 hot targets to 'active' status for live pursuit HUD demonstration.")

    except Exception as e:
        db.rollback()
        print(f"Error seeding demo data: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_data()