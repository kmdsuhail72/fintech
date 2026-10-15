# Asteriq AI reliability model

These are rolling **30-day, request-based** objectives, evaluated per environment
namespace and cluster. Production is the customer commitment; dev/staging are
validation environments. AI availability at 99.9% is a proposed default requiring
product-owner approval. The other targets follow the requested requirements.

| SLO / SLI | Good / eligible events | Objective | Error budget per 1M eligible events |
| --- | --- | --- | --- |
| API availability | HTTP 2xx/3xx / eligible non-health, non-OPTIONS requests | 99.9% | 1,000 failures |
| Trade API success | HTTP 2xx/3xx / eligible POST /api/v1/orders attempts | 99.95% | 500 failures |
| Core API latency | Requests in <=500ms histogram bucket / completed non-health, non-research requests | 95% (p95 <500ms target) | 50,000 slow requests |
| AI service availability | HTTP 2xx/3xx / eligible non-health AI requests | 99.9% proposed | 1,000 failures |
| AI research latency | Research requests in <=5s bucket / completed research requests | 95% (p95 <5s target) | 50,000 slow requests |

Eligible availability requests include 2xx, 3xx, 429, 499 and 5xx. All 429s count
as failures, including intentional rate limiting: change policy only by reviewed
agreement. API disconnects recorded as 499 count as failures, conservatively.
Other 4xx (invalid input/authentication/business rejection) and OPTIONS are excluded
from availability budgets; monitor security and rejection rates separately.
Trade success is HTTP acceptance, including idempotent replays, **not exchange
execution, settlement or profitable trading**. Broker execution needs a separate
accepted-to-terminal-order outcome SLI before live trading commitments.

Latency histograms currently include all outcomes and OPTIONS because they lack
status/method labels. They therefore measure all completed operations in scope,
not just successful eligible requests. API excludes research because research has
a separate latency class. AI research includes all /research operations, including
document endpoints. Histogram buckets are inclusive, so exactly 500ms/5s is good;
the requested strict p95 thresholds are approximated at these boundaries. Displayed
p95 is interpolated; use the bucket ratio for budget accounting. Percentiles cannot
be averaged across pods or time; sum histogram buckets before calculating p95.

## Error budgets

For eligible count N, failures B, objective S:

- Allowed bad events = N × (1 − S).
- Observed SLI = 1 − B/N.
- Budget remaining = 1 − B/[N × (1 − S)]; negative means exhausted.
- Burn rate over window W = (B_W/N_W)/(1 − S).

At constant traffic, 99.9% is equivalent to 43m12s and 99.95% to 21m36s in
30 days. These are illustrative outage equivalents, not additional downtime
allowances. A burst of errors during a busy interval consumes more budget.
Budgets belong to each SLO independently and cannot be transferred between them.

No requests means unknown (NaN), not 100% availability. No metric series means no
measurement, not zero errors. A missing error-status series is treated as zero
only while a denominator exists. Complete pod/Ingress/DNS failures may emit no
application requests: retain existing AI-down, API target-down, node and ingress
alerts, and deploy authenticated synthetic/public-endpoint probes to cover that
gap. Never claim end-to-end availability from these service counters alone.
The current AI middleware does not separately classify all client disconnects.
Data gaps/restarts/lost final scrapes and replica label duplication can affect counts.

Prometheus retention is raised to 45 days in the example and all GitOps profiles.
Size storage for that retention; a 50Gi PVC is a starting example, not a guarantee.
Do not declare 30-day compliance until there is 30 days of complete history:
range queries during bootstrap contain partial history. Scrape health is shown on
the dashboard; also inspect retention, target discovery and monitoring outages.
For multi-cluster federation, preserve cluster in aggregation labels or query
separate per-cluster datasources. Deduplicate Prometheus HA replicas upstream.

## Burn alerts and response thresholds

Both the long and short windows must exceed the threshold. Rules wait two minutes
before firing. No minimum request gate silently removes failures at low traffic;
a single failure may page. Use synthetic traffic and tune response ownership for
low-volume environments instead of interpreting inactivity as health.

| Severity | Burn | Long / short window | Budget consumed at threshold | Response |
| --- | --- | --- | --- | --- |
| critical | >14.4× | 1h / 5m | 2% in 1h | Page; acknowledge within 5m; impact assessment within 10m |
| critical | >6× | 6h / 30m | 5% in 6h | Page; acknowledge within 5m; assign incident commander |
| warning | >3× | 1d / 2h | 10% in 1d | Ticket and team notification; triage within 4h |
| info | >1× | 3d / 6h | 10% in 3d | Review within one business day |

For example, fast-burn availability pages at >1.44% bad requests for API/AI and
>0.72% for trades; slow-event latency pages at >72%. Existing absolute latency
alerts catch acute regressions below that burn threshold. Burn alerts are a budget
signal, not the only outage detector. These use the
[Google SRE multiwindow pattern](https://sre.google/workbook/alerting-on-slos/).

Critical routes use existing email and Slack/Teams receivers. They are not an
acknowledging pager integration: connect an on-call escalation system before
promising a five-minute response. Alertmanager groups SLO burn events by
cluster/environment/namespace/service/SLO/severity and inhibits lower severity
burn notifications for the same SLO. Existing dependency alerts remain available.
Replace the runbook URL owner/repository placeholders before deployment.

Classify confirmed total API/trade outage, suspected duplicate orders, lost orders
or data corruption as SEV1 immediately, regardless of burn. Partial sustained
customer impact is SEV2. Warning/info without confirmed impact is investigation,
not an automatic major incident. Assign incident commander and communications
owner; preserve logs, trace IDs and order/idempotency IDs without credentials.
For trade correctness risks, disable order submission via the reviewed operational
control; never blindly retry orders. Establish the safety action before rollback.
Check releases, ingress, DB connection pools, Redis and AI/provider errors; mitigate
with a tested rollback or traffic reduction. Publish updates at least every 15m
for SEV1 and 30m for SEV2. Close after impact stops and the short window recovers;
long-window warnings may remain while historical errors age out. Produce a
blameless review within two business days with assigned corrective actions.

At <=25% budget remaining, require reliability review for risky releases. At <=0%
for 15m, the budget-exhausted warning fires: freeze risk-increasing features and
prioritize reliability work; security fixes and incident recovery may proceed with
incident-owner approval. Resume after budget is positive, the cause is mitigated
and the service owner approves. An exhausted rolling budget can take days to
recover; record exceptions rather than resetting the measurements.

## Deployment and dashboards

`prometheus/slo-rules.yaml` is included by the existing Prometheus Kustomization.
It uses the monitoring selector already configured on Prometheus. The Grafana
Kustomization provisions `Asteriq AI / SLO reliability` through its dashboard
sidecar. Panels show 30-day SLIs, budget remaining, allowed bad events, traffic,
short/long burn, API/AI p95 and scrape coverage. There is one rules owner:
Prometheus evaluates alerts and sends them to Alertmanager; Grafana displays them.

Regenerate with `python scripts/monitoring/build_slo.py`. Validate using
`python -m pytest scripts/monitoring/tests/test_slo.py -q` with PROMTOOL_BIN set
to a local promtool executable. These demo assets have not been applied to a live
cluster; notification destinations and operational coverage require commissioning.
