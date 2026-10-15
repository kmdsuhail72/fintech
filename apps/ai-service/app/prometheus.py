"""Bounded Prometheus metrics; one Uvicorn worker per Kubernetes pod."""
from contextlib import contextmanager
from time import perf_counter
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST

registry = CollectorRegistry()
ai_requests_total = Counter('ai_requests_total', 'Completed AI HTTP requests, excluding health and metrics.', registry=registry)
ai_request_duration_seconds = Histogram('ai_request_duration_seconds', 'AI HTTP duration in seconds, excluding health and metrics.', buckets=(.01, .1, .5, 1, 5, 10, 30, 60, 120), registry=registry)
llm_calls_total = Counter('llm_calls_total', 'LLM and embedding provider wrapper attempts, including failed attempts.', registry=registry)
llm_failures_total = Counter('llm_failures_total', 'Failed LLM or embedding attempts, including configuration and parsing failures.', registry=registry)
sentiment_requests_total = Counter('sentiment_requests_total', 'POST attempts to sentiment endpoints, including validation failures.', registry=registry)
technical_analysis_total = Counter('technical_analysis_total', 'POST attempts to technical analysis endpoints, including validation failures.', registry=registry)
model_inference_duration_seconds = Histogram('model_inference_duration_seconds', 'Local model inference duration including feature processing.', buckets=(.001, .01, .1, .5, 1, 5, 10, 30), registry=registry)
# Retain namespaced metrics for existing dashboards and rules.
requests = Counter('asteriq_ai_requests_total', 'Completed AI HTTP requests.', ['operation', 'status'], registry=registry)
duration = Histogram('asteriq_ai_request_duration_seconds', 'AI HTTP duration.', ['operation'], buckets=(.01, .1, .5, 1, 5, 10, 30, 60, 120), registry=registry)
active = Gauge('asteriq_ai_active_requests', 'AI requests in flight.', registry=registry)
provider_requests = Counter('asteriq_llm_requests_total', 'LLM and embedding provider attempts.', ['operation'], registry=registry)
provider_failures = Counter('asteriq_llm_failures_total', 'Failed provider calls, including configuration and parsing errors.', ['operation'], registry=registry)
provider_duration = Histogram('asteriq_llm_api_duration_seconds', 'Provider wrapper duration including parsing.', ['operation'], buckets=(.1, .5, 1, 5, 10, 30, 60, 120), registry=registry)
tokens = Counter('asteriq_llm_tokens_total', 'Tokens reported by provider metadata; never estimated.', ['direction'], registry=registry)
inference_duration = Histogram('asteriq_model_inference_duration_seconds', 'Local model operation duration including feature processing.', ['operation'], buckets=(.001, .01, .1, .5, 1, 5, 10, 30), registry=registry)
research_requests = Counter('asteriq_research_requests_total', 'AI research HTTP requests.', registry=registry)


def record_tokens(raw):
    usage = getattr(raw, 'usage_metadata', None) or {}
    for key, direction in [('input_tokens', 'input'), ('output_tokens', 'output')]:
        value = usage.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            tokens.labels(direction).inc(value)


@contextmanager
def inference(operation):
    started = perf_counter()
    try:
        yield
    finally:
        elapsed = perf_counter() - started
        inference_duration.labels(operation).observe(elapsed)
        model_inference_duration_seconds.observe(elapsed)


def observe_request(path, method, elapsed):
    if path in {'/health', '/health/live', '/health/ready', '/metrics', '/metrics/'}:
        return
    ai_requests_total.inc()
    ai_request_duration_seconds.observe(elapsed)
    if method == 'POST':
        if path.rstrip('/') in {'/analysis/sentiment', '/news/sentiment', '/news/sentiment/batch'}:
            sentiment_requests_total.inc()
        if path.rstrip('/') in {'/analysis/technical', '/analysis/technical/report'}:
            technical_analysis_total.inc()
