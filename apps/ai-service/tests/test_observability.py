import asyncio
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.observability import (
    ObservabilityMiddleware, JsonFormatter, context, create_context,
    metric_document, observe_provider,
)


def test_trace_parent_and_metric_dimensions():
    current = create_context(f"00-{'a' * 32}-{'b' * 16}-01")
    assert current["traceId"] == "a" * 32
    assert current["spanId"] != "b" * 16
    assert create_context("bad\nheader")["traceparent"].endswith("-00")
    document = metric_document({"RequestCount": (1, "Count"), "Invalid": (float("nan"), "None")})
    assert "Invalid" not in document
    assert document["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [
        ["Environment", "Service"], ["Environment", "Service", "Operation"],
    ]


def test_provider_failure_preserves_exception_and_trace(monkeypatch, capsys):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", "true")
    parent = create_context()
    token = context.set(parent)

    @observe_provider
    async def fail():
        assert context.get()["traceId"] == parent["traceId"]
        assert context.get()["spanId"] != parent["spanId"]
        raise RuntimeError("synthetic")

    try:
        with pytest.raises(RuntimeError, match="synthetic"):
            asyncio.run(fail())
        event = json.loads(capsys.readouterr().out)
        assert event["AIProviderFailures"] == 1
        assert event["traceId"] == parent["traceId"]
        assert context.get() == parent
    finally:
        context.reset(token)


def test_http_metrics_and_trace_header(monkeypatch, capsys):
    monkeypatch.setenv("OBSERVABILITY_ENABLED", "true")
    app = FastAPI()
    app.add_middleware(ObservabilityMiddleware)

    @app.get("/analysis/{id}")
    def endpoint(id: str):
        return {"ok": True}

    with TestClient(app) as client:
        result = client.get("/analysis/private-id?token=must-not-log",
                            headers={"traceparent": f"00-{'a' * 32}-{'b' * 16}-00"})
    assert result.headers["X-Trace-Id"] == "a" * 32
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith('{"_aws"')]
    assert len(events) == 1
    assert events[0]["RequestCount"] == 1
    assert events[0]["SloErrors"] == 0
    assert "must-not-log" not in json.dumps(events)


def test_log_formatter_redacts_known_secrets(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-secret")
    record = logging.LogRecord("test", logging.ERROR, "", 0, "synthetic-secret Bearer abcdef", (), None)
    line = JsonFormatter().format(record)
    assert "synthetic-secret" not in line
    assert "abcdef" not in line


def test_json_log_schema_includes_correlated_http_fields():
    record = logging.LogRecord('test', logging.ERROR, '', 0, 'AI request failed', (), None)
    record.requestId = 'test-request'
    record.traceId = 'a' * 32
    record.endpoint = '/research/assistant'
    record.status_code = 503
    record.event = 'ai_failure'
    entry = json.loads(JsonFormatter().format(record))
    required = {'timestamp', 'service', 'environment', 'namespace', 'pod', 'level',
                'request_id', 'trace_id', 'user_safe_identifier', 'endpoint', 'status_code'}
    assert required <= entry.keys()
    assert entry['request_id'] == 'test-request'
    assert entry['trace_id'] == 'a' * 32
    assert entry['status_code'] == 503
    assert entry['user_safe_identifier'] is None
