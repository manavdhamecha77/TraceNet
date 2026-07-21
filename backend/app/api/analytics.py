from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import List

from app.db.session import get_db
from app.db.models import SearchLog, VideoAsset, Tracklet, Alert
from app.cache import get_cache

router = APIRouter(prefix="/api/v1", tags=["analytics"])


@router.get("/analytics/dashboard")
def get_analytics_dashboard(days: int = 7, db: Session = Depends(get_db)):
    """Get analytics dashboard with search trends and system metrics."""
    cache = get_cache()

    # Try to get from cache
    cached = cache.get("analytics:dashboard")
    if cached is not None:
        return cached

    start_date = datetime.now() - timedelta(days=days)

    # Search statistics
    total_searches = db.query(SearchLog).filter(
        SearchLog.timestamp >= start_date
    ).count()

    searches_by_day = db.query(
        func.date(SearchLog.timestamp).label("date"),
        func.count(SearchLog.id).label("count")
    ).filter(SearchLog.timestamp >= start_date).group_by(
        func.date(SearchLog.timestamp)
    ).order_by("date").all()

    # Detection statistics
    total_videos_processed = db.query(VideoAsset).filter(
        VideoAsset.processing_status == "completed"
    ).count()

    total_tracklets = db.query(Tracklet).count()

    # Alert statistics
    total_alerts = db.query(Alert).count()
    unacknowledged_alerts = db.query(Alert).filter(
        Alert.acknowledged == False
    ).count()

    # Most searched terms
    top_searches = db.query(
        SearchLog.query_text,
        func.count(SearchLog.id).label("search_count")
    ).filter(SearchLog.timestamp >= start_date).group_by(
        SearchLog.query_text
    ).order_by(func.count(SearchLog.id).desc()).limit(10).all()

    result = {
        "period_days": days,
        "search_statistics": {
            "total_searches": total_searches,
            "searches_by_day": [
                {"date": str(row[0]), "count": row[1]}
                for row in searches_by_day
            ],
            "top_searches": [
                {"query": row[0], "count": row[1]}
                for row in top_searches
            ]
        },
        "detection_statistics": {
            "total_videos_processed": total_videos_processed,
            "total_tracklets_detected": total_tracklets,
            "average_tracklets_per_video": (
                total_tracklets / total_videos_processed
                if total_videos_processed > 0 else 0
            )
        },
        "alert_statistics": {
            "total_alerts": total_alerts,
            "unacknowledged_alerts": unacknowledged_alerts,
            "acknowledgment_rate": (
                ((total_alerts - unacknowledged_alerts) / total_alerts * 100)
                if total_alerts > 0 else 0
            )
        },
        "timestamp": datetime.now().isoformat()
    }

    # Cache for 5 minutes
    cache.set("analytics:dashboard", result, 300)

    return result


@router.get("/analytics/search-logs")
def get_search_logs(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get search history with pagination."""
    logs = db.query(SearchLog).order_by(
        SearchLog.timestamp.desc()
    ).limit(limit).offset(offset).all()

    total = db.query(SearchLog).count()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "logs": [log.to_dict() for log in logs]
    }


@router.get("/analytics/detection-stats")
def get_detection_stats(camera_id: str = None, db: Session = Depends(get_db)):
    """Get detection statistics by camera."""
    cache = get_cache()
    cache_key = f"analytics:detection:{camera_id or 'all'}"

    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    query = db.query(VideoAsset)
    if camera_id:
        query = query.filter(VideoAsset.camera_id == camera_id)

    total_videos = query.count()
    processed_videos = query.filter(
        VideoAsset.processing_status == "completed"
    ).count()
    pending_videos = query.filter(
        VideoAsset.processing_status == "pending"
    ).count()
    failed_videos = query.filter(
        VideoAsset.processing_status == "failed"
    ).count()

    result = {
        "camera_id": camera_id or "all_cameras",
        "total_videos": total_videos,
        "processed": processed_videos,
        "pending": pending_videos,
        "failed": failed_videos,
        "processing_rate": (
            processed_videos / total_videos * 100
            if total_videos > 0 else 0
        )
    }

    cache.set(cache_key, result, 600)

    return result


@router.get("/analytics/cache-stats")
def get_cache_statistics():
    """Get cache performance statistics."""
    cache = get_cache()
    return {
        "cache_stats": cache.get_stats(),
        "timestamp": datetime.now().isoformat()
    }


@router.post("/analytics/cache/clear")
def clear_cache():
    """Clear entire cache."""
    cache = get_cache()
    cache.clear()
    return {"message": "Cache cleared successfully"}
