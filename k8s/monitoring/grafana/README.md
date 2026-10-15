# Grafana profile

Install a separately pinned Grafana chart with `values.example.yaml`. Apply this
Kustomization to provision labeled datasource/dashboard ConfigMaps for its sidecars.
Services remain private; no Grafana Ingress is created.

Two replicas require a shared PostgreSQL metadata database. Supply Secrets
`grafana-admin` (`admin-user`, `admin-password`) and `grafana-database` (`host`,
`database`, `username`, `password`, `sslmode`) through the secret controller.
Use verified TLS and mount the correct public CA for RDS. Do not use SQLite HA,
reuse the trading database identity, or commit credentials.

Datasource URLs assume Prometheus fullname `asteriq-monitoring` and Loki fullname
`loki` in `monitoring`. Adjust renamed releases. The Loki tenant header is routing
metadata, not authentication. Configure SSO and datasource/log access controls
before exposing the UI. Five dashboards now cover Kubernetes, application,
trading, AI and database signals. See the
[Grafana chart](https://github.com/grafana/helm-charts/tree/main/charts/grafana)
and [provisioning guide](https://grafana.com/docs/grafana/latest/administration/provisioning/).

## Dashboards

Portable JSON files live in `dashboards/`. Import them in Grafana with a
Prometheus datasource, or reconcile this directory through Argo CD. Its
Kustomization packages each dashboard in a stable, labeled ConfigMap. Grafana's
dashboard/datasource sidecars must be enabled. The App-of-Apps monitoring child
includes this source and enables those sidecars, with its generated default
datasource disabled to prevent duplicate provisioning of the `prometheus` UID.
The old `dashboards.yaml` example is superseded and is not reconciled.

Each dashboard has a datasource selector, namespace selection, stable UID,
one-hour initial time window and 30-second refresh. Database panels have
separate exporter-job/database selectors; selecting an application namespace
does not change the managed database target. Cluster-wide node/disk/network
panels also remain independent of application namespaces. A shared Prometheus
covering multiple clusters must add a cluster label/filter before using these
queries. Empty metrics show **No data**, not a fabricated zero.

| Dashboard          | Panels                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes Cluster | Node/pod CPU and memory, filesystem capacity, network throughput, ready nodes/pods, restarts, deployment replicas, startup errors and OOM reasons |
| Application        | Request rate, p50/p95/p99 API latency, 4xx/5xx rate, 5xx ratio, WebSocket sessions, active requests and scrape health                             |
| Trading            | Order attempts, successful responses, failed requests, failure ratio, committed trades, per-pod active-user estimate, watchlists and price alerts |
| AI                 | AI demand, request and inference percentiles, LLM latency/failures, reported token rate/range totals and sentiment/technical demand               |
| Database           | PostgreSQL connections/capacity, API query percentiles, slow-query rate/ratio, commits/rollbacks and exporter health                              |

Success panels measure HTTP success responses, including idempotent replay;
they are not unique order counts. Trade counters exclude replay, but operational
metrics are not the durable financial ledger. Active users are shown per pod to
avoid implying globally distinct users. LLM latency includes wrapper processing;
token consumption includes only reported research metadata. Rate panels use
`$__rate_interval` to accommodate scrape frequency.

## Thresholds and alerting

Panel threshold lines are visual indicators. Actual alerts are PrometheusRule
resources in `../prometheus/asteriq-alerts.yaml`; configure
Alertmanager routing/contact receivers to deliver them. These are Prometheus
alerts, not Grafana Unified Alerting rules. Reconcile the Prometheus directory
alongside dashboards; importing JSON alone does not install alarms.

| Signal                    | Warning / critical starting thresholds            | Evaluation                                     |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Node CPU                  | 80% / 95%                                         | 10 minutes                                     |
| Node memory               | 85% / 95%                                         | 10 minutes                                     |
| Disk capacity             | Visual warning 80%; critical alert 90%            | 10 minutes                                     |
| HTTP 5xx ratio            | 2% / 5%                                           | 5 minutes; critical requires >0.1 requests/sec |
| API total latency p95     | 1 second warning (includes research)              | 10 minutes                                     |
| Failed order ratio        | 5% / 10%                                          | 5 minutes; >1 order attempt/minute             |
| LLM failure ratio         | 10% / 25%                                         | 5 minutes; critical requires >1 call/minute    |
| LLM wrapper p95           | 30 seconds warning                                | 10 minutes                                     |
| Local inference p95       | Visual warning 1 second; critical alert 5 seconds | 10 minutes                                     |
| API-observed database p95 | 500ms warning                                     | 10 minutes                                     |
| PostgreSQL connections    | 80% / 90% of max_connections                      | 10 / 5 minutes                                 |
| Database unreachable      | pg_up = 0                                         | 3 minutes                                      |
| Node not Ready            | Ready = false                                     | 5 minutes                                      |

CPU/latency thresholds are initial values to calibrate with load tests. Rate
ratios need traffic guards; low-volume windows should not page on one failure.
Do not infer a business outage solely from zero trades, orders or tokens: quiet
hours and market schedules can legitimately produce zero activity. Alert on
errors, dependency health and service objectives instead.

## PostgreSQL exporter prerequisite

Application query latency/slow queries already use the API histogram. Slow
queries mean API-observed queries taking >1 second, excluding pool acquisition;
this is not a server-wide slow-query log and includes network time.

Connection and transaction panels require a separately installed, pinned
`prometheus-postgres-exporter` chart with `postgres-exporter-values.example.yaml`.
Provision the `postgres-exporter` Secret's `uri` externally with a dedicated
monitoring identity, verified TLS (`sslmode=verify-full` and
`sslrootcert=/etc/rds-ca/global-bundle.pem`), and the public `rds-ca` ConfigMap
in `monitoring`. Grant only CONNECT and reviewed `pg_monitor`/statistics access;
do not reuse the trading owner or migration identity. Allow approved networking
to RDS:5432 and Prometheus scraping of exporter:9187. One exporter instance per
database target avoids double-counting server-wide statistics.

Enable settings metrics for `pg_settings_max_connections`; verify the selected
exporter emits `pg_stat_database_numbackends`, `pg_stat_database_xact_commit`,
`pg_stat_database_xact_rollback`, and `pg_up`. The profile selects our existing
Prometheus ServiceMonitor label. No exporter credentials or live database
installation are included in dashboard provisioning.

## Maintenance and validation

Edit `scripts/monitoring/build_dashboards.py`, regenerate with
`python scripts/monitoring/build_dashboards.py`, format with
`npx prettier --write "k8s/monitoring/grafana/dashboards/*.json"`, and review the JSON diff.
Dashboard files use Grafana's portable classic JSON format. Validate queries and
alerts against the actual Prometheus/exporter versions, check Grafana import,
and test notification delivery before production activation.

References: [Grafana JSON model](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/),
[PostgreSQL exporter](https://github.com/prometheus-community/postgres_exporter).
