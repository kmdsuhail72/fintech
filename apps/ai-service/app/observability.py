"""CloudWatch EMF and W3C log correlation, without exporting private AI inputs."""
from contextvars import ContextVar
from functools import wraps
import json
import logging
import math
import os
import re
import secrets
import sys
from time import perf_counter, time
from uuid import uuid4
from datetime import datetime, timezone
from app import prometheus as prom
from app import tracing

NAMESPACE = "Asteriq/Application"
context = ContextVar("trace_context", default=None)


def create_context(parent=None):
    active = tracing.current_span_context()
    if active:
        return {'requestId': str(uuid4()), 'traceId': f'{active.trace_id:032x}',
                'spanId': f'{active.span_id:016x}',
                'traceparent': f'00-{active.trace_id:032x}-{active.span_id:016x}-{int(active.trace_flags) & 1:02x}'}
    match = re.fullmatch(r"00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])", parent or "")
    valid = match and match[1] != "0" * 32 and match[2] != "0" * 16
    trace_id = match[1] if valid else secrets.token_hex(16)
    span_id = secrets.token_hex(8)
    return {"requestId": str(uuid4()), "traceId": trace_id, "spanId": span_id,
            "traceparent": f"00-{trace_id}-{span_id}-{match[3] if valid else '00'}"}


def trace_headers():
    current = context.get()
    if tracing.current_span_context():
        return {**tracing.trace_headers(), **({'X-Request-Id': current['requestId']} if current else {})}
    return {"traceparent": current["traceparent"], "X-Request-Id": current["requestId"]} if current else {}


def metric_document(metrics, operation="runtime"):
    # Values are (number, CloudWatch unit); no request/user/document IDs as dimensions.
    values = {name: value for name, (value, _) in metrics.items() if math.isfinite(value)}
    if not values:
        raise ValueError("No finite metric values")
    return {
        "_aws": {"Timestamp": int(time() * 1000), "CloudWatchMetrics": [{
            "Namespace": NAMESPACE,
            "Dimensions": [["Environment", "Service"], ["Environment", "Service", "Operation"]],
            "Metrics": [{"Name": name, "Unit": metrics[name][1]} for name in values],
        }]},
        "Environment": os.getenv("ASTERIQ_ENVIRONMENT", "local"), "Service": "ai-service",
        "Operation": operation, "level": "info", "message": "application_metrics",
        **values, **(context.get() or {}),
    }


def emit_metrics(metrics, operation="runtime"):
    if os.getenv("OBSERVABILITY_ENABLED") != "true":
        return
    try:
        print(json.dumps(metric_document(metrics, operation), allow_nan=False), flush=True)
    except Exception:
        pass  # Observability must not change business outcomes.


class JsonFormatter(logging.Formatter):
    def format(self, record):
        message = record.getMessage()
        for key in ("OPENAI_API_KEY", "DATABASE_URL", "RAG_DATABASE_URL", "REDIS_URL", "JWT_ACCESS_SECRET", "SMTP_URL"):
            value = os.getenv(key)
            if value:
                message = message.replace(value, "[REDACTED]")
        message = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", message, flags=re.I)
        current = context.get() or {}
        request_id = getattr(record, 'requestId', current.get('requestId'))
        trace_id = getattr(record, 'traceId', current.get('traceId'))
        return json.dumps({"timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(), "level": record.levelname.lower(),
            "service": "ai-service", "environment": os.getenv("ASTERIQ_ENVIRONMENT", "local"),
            "namespace": os.getenv('POD_NAMESPACE'), "pod": os.getenv('POD_NAME'),
            "request_id": request_id, "trace_id": trace_id,
            "user_safe_identifier": None, "endpoint": getattr(record, 'endpoint', None),
            "status_code": getattr(record, 'status_code', None),
            "event": getattr(record, 'event', None),
            "message": message[:1000],
            **({"traceId": record.traceId, "requestId": record.requestId}
               if hasattr(record, "traceId") and hasattr(record, "requestId") else {}),
            **(context.get() or {})})


def configure_logging(level="INFO"):
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
    # Avoid duplicate plaintext access logs containing submitted URLs.
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    for handler in logging.getLogger("uvicorn.error").handlers:
        handler.setFormatter(JsonFormatter())


def observe_provider(function):
    async def observed(*args, **kwargs):
        parent = context.get()
        child = create_context(parent["traceparent"] if parent else None)
        if parent:
            child["requestId"] = parent["requestId"]
        token = context.set(child)
        started, failed = perf_counter(), False
        try:
            return await function(*args, **kwargs)
        except BaseException:
            failed = True
            raise
        finally:
            operation = 'research' if function.__name__ == 'generate' else 'embedding'
            prom.provider_requests.labels(operation).inc()
            prom.provider_failures.labels(operation).inc(int(failed))
            prom.provider_duration.labels(operation).observe(perf_counter() - started)
            prom.llm_calls_total.inc()
            prom.llm_failures_total.inc(int(failed))
            emit_metrics({"AIProviderRequests": (1, "Count"), "AIProviderFailures": (int(failed), "Count"),
                          "AIProviderLatency": ((perf_counter() - started) * 1000, "Milliseconds")}, "provider")
            context.reset(token)
    @wraps(function)
    async def wrapper(*args, **kwargs):
        with tracing.operation_span('llm.request' if function.__name__ == 'generate' else 'ai.embeddings'):
            return await observed(*args, **kwargs)
    return wrapper


class ObservabilityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope['path'] in {'/metrics', '/metrics/'}:
            return await self.app(scope, receive, send)
        prom.active.inc()
        headers = dict(scope.get("headers", []))
        current = create_context(headers.get(b"traceparent", b"").decode("ascii", errors="ignore"))
        state = scope.setdefault("state", {})
        state.update(request_id=current["requestId"], trace_id=current["traceId"])
        token = context.set(current)
        started, status, failed = perf_counter(), 500, False

        async def observed_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                extra = [(b"x-request-id", current["requestId"].encode()),
                         (b"x-trace-id", current["traceId"].encode()),
                         (b"traceparent", current["traceparent"].encode())]
                message = {**message, "headers": [item for item in message.get("headers", [])
                           if item[0].lower() not in {key for key, _ in extra}] + extra}
            await send(message)

        try:
            await self.app(scope, receive, observed_send)
        except BaseException:
            failed = True
            raise
        finally:
            duration = (perf_counter() - started) * 1000
            prom.observe_request(scope['path'], scope['method'], duration / 1000)
            health = scope["path"] in {"/health", "/health/live", "/health/ready"}
            operation = "health" if health else "research" if scope["path"].startswith("/research") else "analysis"
            prom.active.dec()
            prom.requests.labels(operation, str(500 if failed else status)).inc()
            prom.duration.labels(operation).observe(duration / 1000)
            if operation == 'research':
                prom.research_requests.inc()
            eligible = not health and scope["method"] != "OPTIONS" and (status < 400 or status == 429 or status >= 500 or failed)
            successful = eligible and status < 400 and not failed
            emit_metrics({
                "RequestCount": (1, "Count"), "RequestLatency": (duration, "Milliseconds"),
                "HTTP4xx": (int(400 <= status < 500), "Count"),
                "HTTP5xx": (int(status >= 500 or failed), "Count"),
                "SloRequests": (int(eligible), "Count"),
                "SloErrors": (int(eligible and (status >= 500 or status == 429 or failed)), "Count"),
                "SuccessfulRequests": (int(successful), "Count"),
                "SlowRequests": (int(successful and duration > 10000), "Count"),
            }, operation)
            route = getattr(scope.get("route"), "path", "unmatched")
            event = 'authentication_failure' if status == 401 else 'ai_failure' if failed or status >= 500 else 'http_request'
            logging.getLogger(__name__).info("HTTP request completed method=%s route=%s status=%s duration_ms=%.2f failed=%s",
                                            scope["method"], route, status, duration, failed,
                                            extra={'endpoint': route, 'status_code': 500 if failed else status, 'event': event})
            context.reset(token)
