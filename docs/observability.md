# Asteriq AI CloudWatch observability

Implemented: CloudWatch EMF metrics, structured application logs, W3C correlation,
native infrastructure monitoring, operations/SLO dashboards, metric alarms, and
multi-window error-budget burn alarms. Terraform includes the stack in dev,
staging, and production. No resources have been deployed or live ingestion verified.

## Metrics

Custom namespace: `Asteriq/Application`. Dimension sets are `Environment, Service`
and `Environment, Service, Operation`. Query exactly one dimension set, not both.
Request/user/task/document IDs and raw URLs are never metric dimensions.
EMF JSON is sent to stdout and extracted from existing ECS awslogs streams;
application AWS credentials or PutMetricData permissions are unnecessary.
[EMF specification](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html).

| Signal                  | Source                                                          | Interpretation                                         |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| API/AI HTTP latency     | `RequestLatency`                                                | Raw milliseconds; supports p50/p95/p99                 |
| Requests, 4xx, 5xx      | `RequestCount`, `HTTP4xx`, `HTTP5xx`                            | Sum per minute; raw counts include probes              |
| Client aborts           | `AbortedRequests`, api                                          | Logical 499; bad availability event                    |
| WebSocket connections   | `WebSocketConnections`                                          | Sampled Maximum = busiest API process, not fleet total |
| Socket activity         | `WebSocketOpened`, `WebSocketClosed`, `WebSocketAuthFailures`   | Fleet event sums                                       |
| Trades/minute           | `TradesExecuted`                                                | Newly committed trades; idempotent replays count zero  |
| DB connections          | RDS `DatabaseConnections`                                       | Total native connections                               |
| API DB pool             | `DatabasePoolTotal`, `DatabasePoolIdle`, `DatabasePoolWaiting`  | Maximum per process, not fleet sum                     |
| Redis health/latency    | `RedisHealthy`, `RedisPingLatency`                              | Minimum health 0/1; PING deadline 2 seconds            |
| Redis utilization       | Native engine CPU, memory usage, connections                    | All configured Redis nodes                             |
| API→AI latency/failures | `AIServiceLatency`, `AIServiceRequests`, `AIServiceFailures`    | Gateway elapsed time and failed calls                  |
| AI vendor failures      | `AIProviderLatency`, `AIProviderRequests`, `AIProviderFailures` | Instrumented research/embedding adapter calls          |
| CPU/memory              | Native ECS, RDS, ElastiCache metrics                            | Service/resource utilization                           |
| Running tasks           | Container Insights `RunningTaskCount`                           | Detects missing services without HTTP traffic          |
| Telemetry health        | `RuntimeHeartbeat`                                              | Missing API runtime observations have an alarm         |

Runtime gauges publish once/minute without task dimensions; use Maximum/Minimum.
Do not SUM sampled socket gauges to claim fleet connections. Exact fleet socket
totals need a TTL-backed registry with a single collector, or a collector managing
per-task/stale series. k6's client connection gauge provides an independent test view.

Trade metrics are best effort after commit. A process crash can lose a telemetry
event; financial reconciliation must use the durable database ledger. Metrics are
not an accounting or audit system.

## Logs and trace IDs

Node AsyncLocalStorage and Python ContextVar carry validated W3C version-00
traceparent values, trace IDs, span IDs, and generated request IDs. API→AI and AI
backend callbacks propagate the trace ID. Each hop has a separate request ID.
Responses expose X-Request-Id/X-Trace-Id. With OpenTelemetry enabled, trace IDs
match active exported spans; otherwise they provide log correlation only.
Trace and request IDs are never authorization claims.

Node request logs contain method, route template, status, durationMs, and aborted.
Python JSON logs contain service/environment and correlation; completion details
are currently inside message text. Use EMF for cross-language latency aggregation.
Nginx access logs are JSON and omit query strings. Duplicate Uvicorn access logs
are disabled. Some native/third-party error lines are still outside the JSON schema.
Secret fields/known connection credentials are redacted; do not log raw bodies,
authorization, cookies, prompts, portfolios, or document text. ALB S3 access logs
can still contain recovery-token query strings, requiring the separate security fix.

```text
fields @timestamp, service, message, requestId, traceId, status, durationMs
| filter traceId = 'PASTE_TRACE_ID'
| sort @timestamp asc
```

## Dashboards, SLIs, and SLOs

Terraform creates `asteriq-ENVIRONMENT-operations` and
`asteriq-ENVIRONMENT-slos`. Operations shows application/AI/business/resource
signals and recent failures. The SLO dashboard defaults to 30 days and calculates
attainment/error-budget remaining over the selected time range using event sums.

| Component objective      | SLI                                                     | Initial target     |
| ------------------------ | ------------------------------------------------------- | ------------------ |
| API core availability    | 1 − SloErrors / SloRequests                             | 99.9% over 30 days |
| API core latency         | 1 − SlowRequests / SuccessfulRequests; threshold 500 ms | 99% over 30 days   |
| AI research availability | Same availability ratio for ai-service/research         | 99% over 30 days   |
| AI research latency      | Same latency ratio; threshold 10 seconds                | 95% over 30 days   |

Core API and research operations are separated. Health/OPTIONS and ordinary 4xx
are excluded from SLO eligibility; 429/5xx/aborts are bad. Raw 4xx remain visible.
No eligible traffic yields unknown, not healthy. Availability and latency use
different denominators. Objectives are configurable design choices to adopt with
business owners, not measured performance guarantees.

```text
Budget fraction = 1 - goal
Burn rate = (bad / total) / budget fraction
Remaining budget = 1 - burn rate
```

These are custom request-based component objectives, **not managed Application
Signals SLO resources**. Component counters cannot see DNS/TLS failures or traffic
never reaching the service. Native ALB/task alarms cover some gaps; add Synthetics
canaries/RUM before claiming complete customer-journey SLIs.
[CloudWatch SLO concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-ServiceLevelObjectives.html).

## Alarms

- Fast burn: 14.4× in both 5-minute/1-hour windows. Slow burn: 6× in both
  30-minute/6-hour windows. At least 20 events/window; only the AND composite pages.
  These are CloudWatch period buckets, not a custom continuously sliding evaluator.
- ECS CPU above 80%; existing memory above 85%; running tasks below configured
  minimum. RDS CPU above 80%, free memory below 256 MiB, existing low-storage alarm.
- RDS connections above configurable `database_connection_threshold` (default 100).
  Calibrate against actual max_connections and administrative headroom.
- All Redis nodes: CPU above 75%, memory above 80%; failed PING; API pool waiting;
  WebSocket auth failures above 20/minute; missing API runtime telemetry.
- AI gateway failure rate above 10%, at least five calls/minute; ALB-generated
  5xx and existing unhealthy-target alarm. Most resource alarms use 3 of 5 minutes.

SNS receives alerts/recoveries. Subscribe and confirm an on-call destination;
an unconfigured topic does not page people. Missing request data does not page on
ratios alone; native/task/heartbeat alerts are essential. Missing Redis probes are
unknown rather than a claim that Redis failed. Test delivery in staging.

## Deployment and checks

Build/scanned images and review/apply the selected Terraform environment.
New task definitions set `OBSERVABILITY_ENABLED=true` and ASTERIQ_ENVIRONMENT.
Because Terraform ignores deployed service task revisions, explicitly roll out
the new configuration revision before further image promotion; otherwise CD may
copy an old task definition without telemetry enabled. Output `deployment` now
includes observability dashboard names and SLO definitions.

Verify synthetic success/failure requests, trace propagation, EMF extraction,
Redis node names, trade replay counting, alarm/recovery notifications, and metric
lag. No live AWS verification was performed by this implementation.

```sh
npm run typecheck --workspace @asteriq/api
node --import tsx --test apps/api/tests/observability.test.ts apps/api/tests/rag.test.ts
terraform fmt -check -recursive infrastructure/terraform
terraform -chdir=infrastructure/terraform/modules/stack init -backend=false
terraform -chdir=infrastructure/terraform/modules/stack test
```

From apps/ai-service: `python -m pytest tests/test_observability.py tests/test_health.py -q`.
EMF is disabled by default outside Terraform unless explicitly enabled.

## Optional collectors

OpenTelemetry SDKs and a Collector-to-Grafana-Tempo pipeline are implemented.
Enable the application SDKs and select the Collector deployment profile using
the [distributed tracing runbook](../k8s/monitoring/tracing/README.md). When enabled,
correlation IDs come from active spans and link logs to exported traces; when
disabled, the existing IDs provide log correlation only.

API and AI now expose private Prometheus `/metrics` endpoints with bounded
counters and histograms. See the [Kubernetes Prometheus runbook](../k8s/monitoring/prometheus/README.md)
for ServiceMonitors, scrape network policies, alerts and metric definitions.
Prometheus requires a private scrape endpoint and correct histogram/gauge identity;
Amazon Managed Service for Prometheus can store it. Grafana can read CloudWatch
with read-only IAM or that workspace. Avoid duplicate instrumentation/paging.
Retention is environment-specific (production at least 90 days); review viewer
roles, archive retention, ingestion cost, and extraction failures.
