# Prometheus monitoring

The [SRE reliability model](../slo/README.md) defines the five request-based SLOs,
30-day budgets, burn alerts and incident thresholds. `slo-rules.yaml` is included
by this Kustomization; its Grafana dashboard is provisioned alongside the existing
dashboards. Retain at least 30 days of complete metrics (examples use 45 days).

Alert definitions are centralized in `asteriq-alerts.yaml`; prior resource names
retain recording rules. See the [Alertmanager runbook](../alertmanager/README.md)
for receiver activation, severity, grouping and inhibition.

The AI service also exposes the unprefixed metric names listed in the
[FastAPI metrics guide](../../../docs/fastapi-metrics.md); existing `asteriq_*`
series remain available for compatibility.

API and AI expose Prometheus text format at `/metrics` on their private HTTP
ports (3000/8000). Scrapes do not count as application requests. CloudWatch EMF
continues alongside Prometheus. Counters reset on process restart; use `rate`
and `increase`, never raw counter subtraction. Deploy one Node process and one
Uvicorn worker per pod; scale with replicas. Multiple Python workers require
the client's multiprocess configuration and lifecycle cleanup before use.

## Installation

Install a reviewed, pinned kube-prometheus-stack chart using
`values.example.yaml` after replacing the storage class. It enables
kube-state-metrics, node-exporter and kubelet/cAdvisor scraping. On EKS the
inaccessible scheduler/controller-manager/etcd targets remain disabled.
Configure Alertmanager receivers through managed Secrets and test delivery.
Node-exporter needs host access; authorize its namespace Pod Security policy
and chart-specific permissions deliberately. Ensure Prometheus can reach
nodes/kubelet over TLS with approved credentials and network rules.

After the operator CRDs exist, reconcile this directory's Kustomization through
Argo CD or apply it from the platform administrator's workstation. The
App-of-Apps monitoring child now includes this source. Provision
`scrape-network-policies.yaml` separately through the namespace/security owner:
it grants Prometheus pods in `monitoring` access to application ports. Do not
expose `/metrics` with a public Ingress. Existing monitoring egress isolation
must allow DNS, application scrapes, kubelet and exporters. Kubernetes network
policy is port-level, not path-level; an HTTP path restriction requires a proxy.

The chart common label `asteriq.ai/monitoring: enabled` selects both stack and
Asteriq rules/ServiceMonitors. The application monitors select labeled Services
across all three namespaces. Helm Services already carry these labels; canonical
Kustomize Services now do too. If you change namespace or port, update selectors
and scrape policies. Use a chart that supports the supplied values and review
`helm template` output before installation.

## Metrics and queries

| Signal                              | PromQL                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Node CPU fraction                   | `1 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m]))`                                                 |
| Node memory fraction                | `1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes`                                                     |
| Pod CPU cores                       | `asteriq:pod_cpu_cores`                                                                                               |
| Pod memory working set              | `asteriq:pod_memory_bytes`                                                                                            |
| Pod restarts                        | `increase(kube_pod_container_status_restarts_total[15m])`                                                             |
| Pod availability                    | `kube_pod_status_ready{condition="true"}`                                                                             |
| Desired / ready deployment replicas | `kube_deployment_spec_replicas` / `kube_deployment_status_replicas_available`                                         |
| Container failures                  | `kube_pod_container_status_waiting_reason` and `kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}` |
| API request rate                    | `sum(rate(asteriq_http_requests_total[5m]))`                                                                          |
| API p95 latency seconds             | `histogram_quantile(0.95,sum by(le)(rate(asteriq_http_request_duration_seconds_bucket[5m])))`                         |
| HTTP 4xx / 5xx rate                 | `sum(rate(asteriq_http_requests_total{status=~"4.."}[5m]))` / matching `5..`                                          |
| API active requests                 | `sum(asteriq_http_active_requests)`                                                                                   |
| Database p95 seconds                | `histogram_quantile(0.95,sum by(le)(rate(asteriq_database_query_duration_seconds_bucket[5m])))`                       |
| WebSocket connections               | `sum(asteriq_websocket_connections)`                                                                                  |
| Trading attempts                    | `sum(rate(asteriq_trading_requests_total[5m]))`                                                                       |
| AI requests                         | `sum(rate(asteriq_ai_requests_total[5m]))`                                                                            |
| Local model duration                | `asteriq_model_inference_duration_seconds_bucket`                                                                     |
| LLM latency / failures              | `asteriq_llm_api_duration_seconds_bucket` / `asteriq_llm_failures_total`                                              |
| Token usage                         | `sum by(direction)(increase(asteriq_llm_tokens_total[1h]))`                                                           |
| Research requests                   | `sum(rate(asteriq_research_requests_total[5m]))`                                                                      |
| Trades per minute                   | `asteriq:trades_per_minute`                                                                                           |
| Failed orders per minute            | `asteriq:failed_orders_per_minute`                                                                                    |
| Active users                        | `asteriq_active_users` per instance                                                                                   |
| Watchlist activity                  | `sum(rate(asteriq_watchlist_activity_total[5m]))`                                                                     |
| Price alerts                        | `sum(increase(asteriq_price_alert_triggers_total[1h]))`                                                               |

Filter Kubernetes queries by `namespace=~"asteriq-(dev|staging|production)"`.
Keep environments separate when evaluating global queries on a shared cluster.
HTTP operation/method/status labels are bounded; there are no user, symbol,
prompt, document, SQL or raw URL labels. Failed orders count HTTP failures,
including validation/auth errors, rather than solely executed engine failures.
Watchlist activity includes successful reads. Active users are a capped 10,000
per-process, five-minute authenticated HTTP approximation; summing replicas
overcounts users routed to multiple pods and excludes idle WebSocket users.
Use an explicitly designed distributed analytics service for a unique-user KPI.

Trade counters increment after commit and exclude idempotent replays. Alert
counters count distinct alert IDs after commit, not notification channels.
Standalone alert workers have separate registries and need their own scrape
endpoint if deployed; the current API-hosted worker is covered. Metrics are
operational indicators, not a durable financial ledger: a crash between commit
and increment or missed scrapes can undercount. Reconcile finance KPIs from DB.
Token counts include only returned research LLM metadata; embedding APIs do not
currently provide token metadata. Missing provider metadata is not estimated.
Provider timing includes wrapper setup/parsing; local inference includes feature
processing, but excludes model loading in the trend route.

Rules include target failures, API errors/latency, LLM failures, replica deficits,
restarts, container startup errors, node CPU and memory pressure. Thresholds are
starting values to calibrate under load. Validate Prometheus Targets, loaded
rules and controlled failure alerts before calling monitoring operational.

Client references: [Node client](https://github.com/prometheus/client_js),
[Python client](https://prometheus.github.io/client_python/).
