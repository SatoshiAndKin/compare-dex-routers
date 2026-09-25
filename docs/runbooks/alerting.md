# Alerting Configuration

## Sentry Alerts

Sentry is configured as the primary error tracking and alerting system.

### Configured Alerts (via Sentry dashboard)

| Alert | Condition | Action |
|-------|-----------|--------|
| Error Spike | >10 errors in 5 minutes | Email + Slack notification |
| New Issue | First occurrence of new error | Email notification |
| Unresolved Critical | P0 issue unresolved >1 hour | PagerDuty escalation |

### Setup Instructions

1. Go to Sentry project settings > Alerts
2. Create alert rules matching the table above
3. Configure integrations:
   - Slack: Settings > Integrations > Slack
   - PagerDuty: Settings > Integrations > PagerDuty

## Metrics-Based Alerts

The `/metrics` endpoint exposes Prometheus-compatible metrics. Configure alerts in your monitoring stack:

### Recommended Alert Rules

```yaml
# High error rate
- alert: HighErrorRate
  expr: rate(http_errors_total[5m]) > 0.1
  for: 5m
  labels:
    severity: warning

# Slow responses
- alert: SlowQuoteResponse
  expr: http_request_duration_ms{path=~"/quote"} > 30000
  for: 5m
  labels:
    severity: warning

# Service down
- alert: ServiceDown
  expr: up{job="dex-router-compare"} == 0
  for: 1m
  labels:
    severity: critical
```

## Health Check Monitoring

Configure external monitoring (UptimeRobot, Pingdom, etc.) to poll:
- `GET /health` every 60 seconds
- Alert if 3 consecutive failures
