"""Database optimization script - adds indexes for performance improvement."""

import sqlite3
from loguru import logger
from app.config import get_data_path
import os


def optimize_database():
    """Add indexes to frequently queried columns for improved performance."""
    db_path = get_data_path("drishti.db")

    if not os.path.exists(db_path):
        logger.info("Database not found, skipping optimization.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Define indexes for each table
        indexes = [
            # Videos table - frequently filtered by camera_id, status, timestamp
            ("idx_videos_camera_id", "videos", "camera_id"),
            ("idx_videos_status", "videos", "processing_status"),
            ("idx_videos_timestamp", "videos", "upload_timestamp"),
            ("idx_videos_camera_status", "videos", "(camera_id, processing_status)"),

            # Tracklets table - frequently filtered by camera_id, video_id, object_type
            ("idx_tracklets_camera_id", "tracklets", "camera_id"),
            ("idx_tracklets_video_id", "tracklets", "video_id"),
            ("idx_tracklets_object_type", "tracklets", "object_type"),
            ("idx_tracklets_camera_video", "tracklets", "(camera_id, video_id)"),
            ("idx_tracklets_indexed_at", "tracklets", "indexed_at"),

            # Alerts table - frequently filtered by camera_id, alert_type, timestamp, acknowledged
            ("idx_alerts_camera_id", "alerts", "camera_id"),
            ("idx_alerts_alert_type", "alerts", "alert_type"),
            ("idx_alerts_timestamp", "alerts", "timestamp"),
            ("idx_alerts_acknowledged", "alerts", "acknowledged"),
            ("idx_alerts_camera_timestamp", "alerts", "(camera_id, timestamp DESC)"),
            ("idx_alerts_type_timestamp", "alerts", "(alert_type, timestamp DESC)"),
            ("idx_alerts_video_id", "alerts", "video_id"),

            # Model Execution Logs - frequently filtered by model_id, camera_id, timestamp
            ("idx_model_exec_logs_model_id", "model_execution_logs", "model_id"),
            ("idx_model_exec_logs_camera_id", "model_execution_logs", "camera_id"),
            ("idx_model_exec_logs_timestamp", "model_execution_logs", "timestamp"),
            ("idx_model_exec_logs_video_id", "model_execution_logs", "video_id"),

            # Search Logs - frequently filtered by user_id, timestamp
            ("idx_search_logs_user_id", "search_logs", "user_id"),
            ("idx_search_logs_timestamp", "search_logs", "timestamp"),
            ("idx_search_logs_user_timestamp", "search_logs", "(user_id, timestamp DESC)"),

            # Loitering Zones - frequently filtered by video_id, enabled
            ("idx_loitering_zones_video_id", "loitering_zones", "video_id"),
            ("idx_loitering_zones_enabled", "loitering_zones", "enabled"),

            # Webhooks - frequently filtered by webhook_type, is_active
            ("idx_webhooks_type", "webhooks", "webhook_type"),
            ("idx_webhooks_is_active", "webhooks", "is_active"),
            ("idx_webhooks_created_at", "webhooks", "created_at"),

            # Cameras - frequently filtered by status, is_active
            ("idx_cameras_status", "cameras", "status"),
            ("idx_cameras_is_active", "cameras", "is_active"),

            # Models - frequently filtered by category, is_default
            ("idx_models_category", "models", "category"),
            ("idx_models_is_default", "models", "is_default"),

            # Sentinel Sessions - frequently filtered by status, origin_camera_id
            ("idx_sentinel_sessions_status", "sentinel_sessions", "status"),
            ("idx_sentinel_sessions_origin_camera", "sentinel_sessions", "origin_camera_id"),
            ("idx_sentinel_sessions_created_at", "sentinel_sessions", "created_at"),

            # Hot Targets - frequently filtered by status, priority, object_type
            ("idx_hot_targets_status", "hot_targets", "status"),
            ("idx_hot_targets_priority", "hot_targets", "priority"),
            ("idx_hot_targets_object_type", "hot_targets", "object_type"),
            ("idx_hot_targets_created_at", "hot_targets", "created_at"),

            # Chat Sessions - frequently filtered by user access (created_at)
            ("idx_chat_sessions_created_at", "chat_sessions", "created_at"),
            ("idx_chat_sessions_updated_at", "chat_sessions", "updated_at"),
        ]

        created_count = 0
        skipped_count = 0

        for idx_name, table_name, columns in indexes:
            try:
                # Check if index already exists
                cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                    (idx_name,)
                )

                if cursor.fetchone():
                    logger.debug(f"Index {idx_name} already exists, skipping.")
                    skipped_count += 1
                    continue

                # Check if table exists
                cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                    (table_name,)
                )

                if not cursor.fetchone():
                    logger.debug(f"Table {table_name} does not exist, skipping index {idx_name}.")
                    skipped_count += 1
                    continue

                # Create index
                create_index_sql = f"CREATE INDEX {idx_name} ON {table_name} {columns}"
                cursor.execute(create_index_sql)
                logger.info(f"Created index: {idx_name} on {table_name}({columns})")
                created_count += 1

            except sqlite3.OperationalError as e:
                logger.warning(f"Could not create index {idx_name}: {str(e)}")
                skipped_count += 1
                continue

        conn.commit()
        logger.info(f"Database optimization complete. Created {created_count} indexes, skipped {skipped_count}.")

    except Exception as e:
        logger.error(f"Database optimization error: {str(e)}")
        conn.rollback()
    finally:
        conn.close()


def analyze_database():
    """Run ANALYZE to update query planner statistics."""
    db_path = get_data_path("drishti.db")

    if not os.path.exists(db_path):
        logger.info("Database not found, skipping analysis.")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("ANALYZE")
        conn.commit()
        logger.info("Database analysis complete.")
        conn.close()
    except Exception as e:
        logger.error(f"Database analysis error: {str(e)}")


def vacuum_database():
    """Run VACUUM to optimize storage."""
    db_path = get_data_path("drishti.db")

    if not os.path.exists(db_path):
        logger.info("Database not found, skipping vacuum.")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("VACUUM")
        conn.commit()
        logger.info("Database vacuum complete.")
        conn.close()
    except Exception as e:
        logger.error(f"Database vacuum error: {str(e)}")


if __name__ == "__main__":
    optimize_database()
    analyze_database()
    vacuum_database()
