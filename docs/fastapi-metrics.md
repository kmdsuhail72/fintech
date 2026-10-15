# FastAPI Prometheus metrics

The AI service exposes `GET /metrics` using `prometheus-client` and the
Prometheus text exposition format. The dependency is pinned in
`apps/ai-service/requirements.txt`. Instrumentation lives in
`apps/ai-service/app/prometheus.py` and the existing observability middleware.

| Metric                             | Type      | Meaning                                                                                           |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `ai_requests_total`                | Counter   | Completed non-health HTTP requests, including validation failures, errors and unmatched paths     |
| `ai_request_duration_seconds`      | Histogram | Duration of those requests, including failed requests                                             |
| `llm_calls_total`                  | Counter   | Research LLM and embedding provider wrapper attempts                                              |
| `llm_failures_total`               | Counter   | Failed provider attempts, including cancellation, configuration and parsing failures              |
| `sentiment_requests_total`         | Counter   | POST attempts to `/analysis/sentiment`, `/news/sentiment`, and `/news/sentiment/batch`            |
| `technical_analysis_total`         | Counter   | POST attempts to `/analysis/technical` and `/analysis/technical/report`                           |
| `model_inference_duration_seconds` | Histogram | Local trend and news model operation duration, including feature processing and failed operations |

Health checks and metrics scrapes are excluded from the requested HTTP counters
and latency histogram. Sentiment/technical counts include validation failures;
they measure HTTP demand rather than only successful computations. Local model
loading in the trend route is excluded from inference duration. LLM calls measure
wrapper attempts, not provider-billed network calls. Existing `asteriq_*` metrics
remain available for current dashboards; choose one naming family per query to
avoid counting the same event twice.

These seven metrics have no application labels, keeping cardinality bounded and
private user inputs out of telemetry. Prometheus adds target/pod labels during
scraping. All counters and histogram counts reset when a process restarts.

```bash
python -m uvicorn app.main:app --app-dir apps/ai-service --port 8000
curl http://127.0.0.1:8000/metrics
```

Example queries:

```promql
sum(rate(ai_requests_total[5m]))
histogram_quantile(0.95, sum by (le) (rate(ai_request_duration_seconds_bucket[5m])))
sum(rate(llm_failures_total[5m])) / clamp_min(sum(rate(llm_calls_total[5m])), 0.001)
sum(increase(sentiment_requests_total[1h]))
sum(increase(technical_analysis_total[1h]))
histogram_quantile(0.95, sum by (le) (rate(model_inference_duration_seconds_bucket[5m])))
```

Use the existing [Kubernetes ServiceMonitor and networking configuration](../k8s/monitoring/prometheus/README.md)
to scrape each pod's private HTTP port. Do not publish `/metrics` through the
public ingress. Run one Uvicorn worker per pod and scale replicas; multiple
workers need Prometheus multiprocess registry and lifecycle configuration.

Tests cover exposition names/content type, failure propagation, request
classification, scrape/health exclusion, token metadata, and inference failures.
The metrics follow the [official Python client](https://prometheus.github.io/client_python/).
