"""Prometheus metrics for monitoring DRISHTI system performance."""

from prometheus_client import Counter, Histogram, Gauge, CollectorRegistry
from functools import wraps
import time
from loguru import logger

# Create registry for metrics
registry = CollectorRegistry()

# Request metrics
http_requests_total = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status_code'],
    registry=registry
)

http_request_duration_seconds = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint'],
    registry=registry
)

# Database metrics
db_queries_total = Counter(
    'db_queries_total',
    'Total database queries',
    ['query_type', 'table'],
    registry=registry
)

db_query_duration_seconds = Histogram(
    'db_query_duration_seconds',
    'Database query duration in seconds',
    ['query_type', 'table'],
    registry=registry
)

# Model inference metrics
model_inferences_total = Counter(
    'model_inferences_total',
    'Total model inferences',
    ['model_type', 'model_id'],
    registry=registry
)

model_inference_duration_seconds = Histogram(
    'model_inference_duration_seconds',
    'Model inference duration in seconds',
    ['model_type', 'model_id'],
    buckets=(0.1, 0.5, 1.0, 2.0, 5.0, 10.0),
    registry=registry
)

# Video processing metrics
videos_processed_total = Counter(
    'videos_processed_total',
    'Total videos processed',
    ['camera_id', 'status'],
    registry=registry
)

video_processing_duration_seconds = Histogram(
    'video_processing_duration_seconds',
    'Video processing duration in seconds',
    ['camera_id'],
    registry=registry
)

# Alert metrics
alerts_created_total = Counter(
    'alerts_created_total',
    'Total alerts created',
    ['alert_type', 'camera_id'],
    registry=registry
)

alerts_acknowledged_total = Counter(
    'alerts_acknowledged_total',
    'Total alerts acknowledged',
    ['alert_type'],
    registry=registry
)

active_alerts = Gauge(
    'active_alerts',
    'Current active alerts',
    ['alert_type'],
    registry=registry
)

# Assault detection metrics
assault_detections_total = Counter(
    'assault_detections_total',
    'Total assault detections',
    ['confidence_level', 'camera_id'],
    registry=registry
)

assault_detection_confidence = Histogram(
    'assault_detection_confidence',
    'Assault detection confidence scores',
    ['model_id'],
    buckets=(0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0),
    registry=registry
)

# Webhook delivery metrics
webhook_deliveries_total = Counter(
    'webhook_deliveries_total',
    'Total webhook delivery attempts',
    ['webhook_type', 'status'],
    registry=registry
)

webhook_delivery_duration_seconds = Histogram(
    'webhook_delivery_duration_seconds',
    'Webhook delivery duration in seconds',
    ['webhook_type'],
    registry=registry
)

# Fine-tuning metrics
finetuning_jobs_total = Counter(
    'finetuning_jobs_total',
    'Total fine-tuning jobs',
    ['status', 'model_type'],
    registry=registry
)

finetuning_job_duration_seconds = Histogram(
    'finetuning_job_duration_seconds',
    'Fine-tuning job duration in seconds',
    ['model_type'],
    registry=registry
)

finetuning_loss = Gauge(
    'finetuning_loss',
    'Current fine-tuning loss',
    ['job_id'],
    registry=registry
)

# Cache metrics
cache_hits_total = Counter(
    'cache_hits_total',
    'Total cache hits',
    ['cache_name'],
    registry=registry
)

cache_misses_total = Counter(
    'cache_misses_total',
    'Total cache misses',
    ['cache_name'],
    registry=registry
)

cache_size_bytes = Gauge(
    'cache_size_bytes',
    'Current cache size in bytes',
    ['cache_name'],
    registry=registry
)

# System metrics
active_connections = Gauge(
    'active_connections',
    'Current active database connections',
    registry=registry
)

memory_usage_bytes = Gauge(
    'memory_usage_bytes',
    'Memory usage in bytes',
    registry=registry
)

gpu_memory_usage_bytes = Gauge(
    'gpu_memory_usage_bytes',
    'GPU memory usage in bytes',
    registry=registry
)

# Error metrics
errors_total = Counter(
    'errors_total',
    'Total errors',
    ['error_type', 'endpoint'],
    registry=registry
)


def track_http_request(func):
    """Decorator to track HTTP request metrics."""
    @wraps(func)
    async def wrapper(*args, request=None, **kwargs):
        method = request.method if request else 'UNKNOWN'
        endpoint = request.url.path if request else 'UNKNOWN'

        start_time = time.time()
        try:
            result = await func(*args, request=request, **kwargs)
            duration = time.time() - start_time

            http_request_duration_seconds.labels(
                method=method,
                endpoint=endpoint
            ).observe(duration)

            http_requests_total.labels(
                method=method,
                endpoint=endpoint,
                status_code=200
            ).inc()

            return result
        except Exception as e:
            duration = time.time() - start_time
            http_request_duration_seconds.labels(
                method=method,
                endpoint=endpoint
            ).observe(duration)

            errors_total.labels(
                error_type=type(e).__name__,
                endpoint=endpoint
            ).inc()

            raise

    return wrapper


def track_model_inference(model_type: str, model_id: str):
    """Decorator to track model inference metrics."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start_time

                model_inference_duration_seconds.labels(
                    model_type=model_type,
                    model_id=model_id
                ).observe(duration)

                model_inferences_total.labels(
                    model_type=model_type,
                    model_id=model_id
                ).inc()

                return result
            except Exception as e:
                logger.error(f"Model inference failed: {str(e)}")
                raise

        return wrapper
    return decorator


def track_alert_creation(alert_type: str, camera_id: str, is_high_confidence: bool = False):
    """Track alert creation metrics."""
    alerts_created_total.labels(
        alert_type=alert_type,
        camera_id=camera_id
    ).inc()

    if is_high_confidence:
        assault_detections_total.labels(
            confidence_level='high',
            camera_id=camera_id
        ).inc()


def track_webhook_delivery(webhook_type: str, success: bool, duration: float):
    """Track webhook delivery metrics."""
    status = 'success' if success else 'failure'

    webhook_deliveries_total.labels(
        webhook_type=webhook_type,
        status=status
    ).inc()

    if success:
        webhook_delivery_duration_seconds.labels(
            webhook_type=webhook_type
        ).observe(duration)


def update_active_alerts_gauge(alert_type: str, count: int):
    """Update active alerts gauge."""
    active_alerts.labels(alert_type=alert_type).set(count)


def track_finetuning_job(status: str, model_type: str, duration: float = None, job_id: str = None):
    """Track fine-tuning job metrics."""
    finetuning_jobs_total.labels(
        status=status,
        model_type=model_type
    ).inc()

    if duration:
        finetuning_job_duration_seconds.labels(
            model_type=model_type
        ).observe(duration)


def update_finetuning_loss(job_id: str, loss: float):
    """Update fine-tuning loss metric."""
    finetuning_loss.labels(job_id=job_id).set(loss)


def track_cache_hit(cache_name: str):
    """Track cache hit."""
    cache_hits_total.labels(cache_name=cache_name).inc()


def track_cache_miss(cache_name: str):
    """Track cache miss."""
    cache_misses_total.labels(cache_name=cache_name).inc()


def update_cache_size(cache_name: str, size_bytes: int):
    """Update cache size metric."""
    cache_size_bytes.labels(cache_name=cache_name).set(size_bytes)
