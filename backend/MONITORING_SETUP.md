# Monitoring & Observability Setup Guide

This guide provides instructions for setting up comprehensive monitoring, logging, and alerting for the TraceNet & DRISHTI system.

## Overview

The monitoring stack includes:
1. **Prometheus** - Metrics collection and storage
2. **Grafana** - Visualization and dashboarding
3. **Loki** - Log aggregation
4. **AlertManager** - Alert routing and notification
5. **Application Metrics** - Built-in Prometheus metrics in the API

---

## 1. Prometheus Setup

### Installation

#### Docker (Recommended)
```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

#### Local Installation
```bash
# Download Prometheus
wget https://github.com/prometheus/prometheus/releases/download/v2.50.0/prometheus-2.50.0.linux-amd64.tar.gz
tar xvfz prometheus-2.50.0.linux-amd64.tar.gz
cd prometheus-2.50.0.linux-amd64
```

### Configuration File

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'drishti-monitor'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - localhost:9093

rule_files:
  - 'alert_rules.yml'

scrape_configs:
  - job_name: 'tracenet-api'
    static_configs:
      - targets: ['localhost:8000']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'grafana'
    static_configs:
      - targets: ['localhost:3000']
```

### Starting Prometheus

```bash
./prometheus --config.file=prometheus.yml
```

Access Prometheus UI: http://localhost:9090

---

## 2. Grafana Setup

### Installation

#### Docker (Recommended)
```bash
docker run -d \
  --name grafana \
  -p 3000:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  grafana/grafana
```

#### Local Installation
```bash
# Download Grafana
wget https://dl.grafana.com/oss/release/grafana-10.2.0.linux-amd64.tar.gz
tar -zxvf grafana-10.2.0.linux-amd64.tar.gz
cd grafana-10.2.0
./bin/grafana-server
```

### Initial Setup

1. Access Grafana: http://localhost:3000
2. Login with default credentials: `admin` / `admin`
3. Add Prometheus data source:
   - Settings > Data Sources > Add data source
   - Select Prometheus
   - URL: `http://localhost:9090`
   - Save & test

### Create Dashboards

#### 1. System Health Dashboard

**Panel 1: HTTP Request Rate**
```
rate(http_requests_total[5m])
```

**Panel 2: API Latency**
```
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

**Panel 3: Active Alerts**
```
sum(active_alerts)
```

**Panel 4: Model Inference Rate**
```
rate(model_inferences_total[5m])
```

#### 2. Assault Detection Dashboard

**Panel 1: Assaults Detected (24h)**
```
sum(increase(assault_detections_total[24h]))
```

**Panel 2: Average Confidence Score**
```
histogram_quantile(0.5, rate(assault_detection_confidence_bucket[1h]))
```

**Panel 3: High Confidence Assaults**
```
sum(assault_detections_total{confidence_level="high"})
```

**Panel 4: Assaults by Camera**
```
sum by (camera_id) (assault_detections_total)
```

#### 3. Performance Dashboard

**Panel 1: Database Query Latency**
```
histogram_quantile(0.95, rate(db_query_duration_seconds_bucket[5m]))
```

**Panel 2: Cache Hit Rate**
```
rate(cache_hits_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))
```

**Panel 3: Fine-tuning Job Status**
```
finetuning_jobs_total
```

**Panel 4: Webhook Delivery Success Rate**
```
rate(webhook_deliveries_total{status="success"}[5m]) / rate(webhook_deliveries_total[5m])
```

---

## 3. Alert Rules

Create `alert_rules.yml`:

```yaml
groups:
  - name: tracenet_alerts
    interval: 30s
    rules:
      # API Availability
      - alert: APIDown
        expr: up{job="tracenet-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "TraceNet API is down"
          description: "TraceNet API has been unavailable for more than 1 minute"

      # High Error Rate
      - alert: HighErrorRate
        expr: rate(errors_total[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is above 5%"

      # High Latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API latency is high"
          description: "95th percentile latency is above 2 seconds"

      # Model Inference Failures
      - alert: ModelInferenceFailing
        expr: rate(errors_total{error_type=~"ModelError|InferenceError"}[5m]) > 0.01
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Model inference is failing"
          description: "Model inference error rate is above 1%"

      # Low Cache Hit Rate
      - alert: LowCacheHitRate
        expr: |
          rate(cache_hits_total[5m]) / 
          (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m])) < 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache efficiency is low"
          description: "Cache hit rate is below 50%"

      # Webhook Delivery Failures
      - alert: WebhookDeliveryFailing
        expr: |
          rate(webhook_deliveries_total{status="failure"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Webhook delivery failures detected"
          description: "Webhook failure rate is above 10%"

      # High Active Alerts
      - alert: TooManyUnacknowledgedAlerts
        expr: sum(active_alerts) > 50
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Too many unacknowledged alerts"
          description: "There are more than 50 active alerts"

      # Database Connection Pool
      - alert: HighDatabaseConnections
        expr: active_connections > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High database connection usage"
          description: "Database connections are above 80"

      # GPU Memory
      - alert: HighGPUMemoryUsage
        expr: gpu_memory_usage_bytes > 12000000000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "GPU memory usage is high"
          description: "GPU memory usage is above 12GB"
```

---

## 4. AlertManager Setup

### Installation

```bash
# Download AlertManager
wget https://github.com/prometheus/alertmanager/releases/download/v0.26.0/alertmanager-0.26.0.linux-amd64.tar.gz
tar xvfz alertmanager-0.26.0.linux-amd64.tar.gz
cd alertmanager-0.26.0.linux-amd64
```

### Configuration

Create `alertmanager.yml`:

```yaml
global:
  resolve_timeout: 5m
  slack_api_url: 'YOUR_SLACK_WEBHOOK_URL'

route:
  receiver: 'default'
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      continue: true
    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'default'
    slack_configs:
      - channel: '#alerts'
        title: 'Alert: {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'

  - name: 'slack'
    slack_configs:
      - channel: '#warnings'
        color: '#FF9900'
        title: 'Warning: {{ .GroupLabels.alertname }}'
```

### Running AlertManager

```bash
./alertmanager --config.file=alertmanager.yml
```

Access AlertManager UI: http://localhost:9093

---

## 5. Loki Setup (Log Aggregation)

### Installation

#### Docker
```bash
docker run -d \
  --name loki \
  -p 3100:3100 \
  grafana/loki:latest
```

### Configuration

Create `loki-config.yml`:

```yaml
auth_enabled: false

ingester:
  chunk_idle_period: 3m
  max_chunk_age: 1h
  chunk_retain_period: 1m
  max_streams_limit: 10000

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema:
        version: v11
        index:
          prefix: index_
          period: 24h

server:
  http_listen_port: 3100

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/boltdb-shipper-active
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

chunk_store_config:
  max_look_back_period: 0s

table_manager:
  retention_deletes_enabled: false
  retention_period: 0s
```

### Application Logging Configuration

Update `backend/app/config.py` to send logs to Loki:

```python
# Configure Loki logging
import logging
from pythonjsonlogger import jsonlogger

# JSON logging for Loki
handler = logging.FileHandler('logs/app.log')
formatter = jsonlogger.JsonFormatter()
handler.setFormatter(formatter)

logger = logging.getLogger()
logger.addHandler(handler)
logger.setLevel(logging.INFO)
```

---

## 6. Metrics Endpoint Integration

The application already exposes metrics at `/metrics` endpoint.

### Verifying Metrics Endpoint

```bash
curl http://localhost:8000/metrics
```

Should return Prometheus-formatted metrics like:

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{endpoint="/api/v1/alerts",method="GET",status_code="200"} 42

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{endpoint="/api/v1/alerts",method="GET",le="0.005"} 10
http_request_duration_seconds_bucket{endpoint="/api/v1/alerts",method="GET",le="0.01"} 20
```

---

## 7. Docker Compose Setup

Create `docker-compose.monitoring.yml`:

```yaml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./alert_rules.yml:/etc/prometheus/alert_rules.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      - prometheus

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/config.yml
    command:
      - '--config.file=/etc/alertmanager/config.yml'

  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - loki_data:/loki

volumes:
  prometheus_data:
  grafana_data:
  loki_data:
```

### Start Monitoring Stack

```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

---

## 8. Key Metrics to Monitor

### System Health
- `http_requests_total` - Request volume
- `http_request_duration_seconds` - API latency
- `errors_total` - Error rate
- `active_connections` - Database connection pool usage

### Detection Performance
- `model_inferences_total` - Detection rate
- `model_inference_duration_seconds` - Detection latency
- `assault_detections_total` - Assault detection count
- `assault_detection_confidence` - Detection confidence scores

### Alert Management
- `alerts_created_total` - Alert creation rate
- `alerts_acknowledged_total` - Acknowledgment rate
- `active_alerts` - Unacknowledged alerts

### Data Processing
- `videos_processed_total` - Video processing rate
- `db_queries_total` - Database query rate
- `cache_hits_total` - Cache effectiveness

### Model Training
- `finetuning_jobs_total` - Fine-tuning job count
- `finetuning_job_duration_seconds` - Training time
- `finetuning_loss` - Training loss values

---

## 9. SLA Targets

Recommended Service Level Agreements:

```
API Availability:        99.9% (4 nines)
Alert Detection Latency: < 2 seconds
Model Inference Time:    < 5 seconds (90th percentile)
API Response Time:       < 500ms (95th percentile)
Cache Hit Rate:          > 80%
Webhook Delivery Success: > 99%
```

---

## 10. Troubleshooting

### Prometheus not scraping metrics
```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Verify endpoint is accessible
curl http://localhost:8000/metrics
```

### Alerts not firing
```bash
# Check alert rules
curl http://localhost:9090/api/v1/rules

# Verify AlertManager is connected
curl http://localhost:9093/api/v1/status
```

### Missing data in Grafana
```bash
# Verify data source connection
# Grafana > Configuration > Data Sources > Prometheus > Test

# Check query in Explore tab
# Grafana > Explore > Select Prometheus data source
```

---

## 11. Best Practices

1. **Retention Policies**
   - Prometheus: 15 days raw data
   - Archive older data to long-term storage
   - Loki: 30 days retention

2. **Alert Tuning**
   - Start with conservative thresholds
   - Gradually tune based on baseline behavior
   - Avoid alert fatigue

3. **Dashboard Organization**
   - Create team-specific dashboards
   - Use standardized naming conventions
   - Include runbooks in panel descriptions

4. **Regular Reviews**
   - Weekly review of alert firing patterns
   - Monthly review of performance metrics
   - Quarterly update of thresholds based on trends

---

## Support & Documentation

- Prometheus: https://prometheus.io/docs/
- Grafana: https://grafana.com/docs/
- AlertManager: https://prometheus.io/docs/alerting/latest/overview/
- Loki: https://grafana.com/docs/loki/latest/

For TraceNet-specific monitoring issues, refer to the main project documentation.
