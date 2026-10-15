import asyncio
from types import SimpleNamespace
import pytest
from prometheus_client.parser import text_string_to_metric_families
from app import prometheus as prom
from app.observability import observe_provider


def sample(name, labels):
    for family in text_string_to_metric_families(prom.generate_latest(prom.registry).decode()):
        for item in family.samples:
            if item.name == name and item.labels == labels:
                return item.value
    return 0


def test_provider_failure_is_counted_and_propagated():
    @observe_provider
    async def generate():
        raise RuntimeError('private provider response')
    before = sample('asteriq_llm_failures_total', {'operation': 'research'})
    calls_before = sample('llm_calls_total', {})
    failures_before = sample('llm_failures_total', {})
    with pytest.raises(RuntimeError):
        asyncio.run(generate())
    assert sample('asteriq_llm_failures_total', {'operation': 'research'}) == before + 1
    assert sample('llm_calls_total', {}) == calls_before + 1
    assert sample('llm_failures_total', {}) == failures_before + 1
    assert b'private provider response' not in prom.generate_latest(prom.registry)


def test_tokens_use_reported_metadata_only():
    before = sample('asteriq_llm_tokens_total', {'direction': 'input'})
    prom.record_tokens(SimpleNamespace(usage_metadata={'input_tokens': 12, 'output_tokens': 3}))
    prom.record_tokens(SimpleNamespace(usage_metadata={'input_tokens': -1}))
    prom.record_tokens(None)
    assert sample('asteriq_llm_tokens_total', {'direction': 'input'}) == before + 12


def test_metrics_endpoint_does_not_observe_itself():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        response = client.get('/metrics')
        assert response.status_code == 200
        assert 'text/plain' in response.headers['content-type']
        assert '# HELP asteriq_ai_requests_total' in response.text
        assert 'operation="metrics"' not in response.text


def test_exact_metric_names_and_request_classification():
    from fastapi.testclient import TestClient
    from app.main import app
    before = {name: sample(name, {}) for name in [
        'ai_requests_total', 'sentiment_requests_total', 'technical_analysis_total',
        'ai_request_duration_seconds_count',
    ]}
    with TestClient(app) as client:
        assert client.post('/analysis/sentiment', json={}).status_code == 422
        assert client.post('/analysis/technical', json={}).status_code == 422
        assert client.get('/health').status_code == 200
        body = client.get('/metrics').text
        assert client.get('/metrics').status_code == 200
    assert sample('ai_requests_total', {}) == before['ai_requests_total'] + 2
    assert sample('ai_request_duration_seconds_count', {}) == before['ai_request_duration_seconds_count'] + 2
    assert sample('sentiment_requests_total', {}) == before['sentiment_requests_total'] + 1
    assert sample('technical_analysis_total', {}) == before['technical_analysis_total'] + 1
    for name in ['ai_requests_total', 'ai_request_duration_seconds', 'llm_calls_total',
                 'llm_failures_total', 'sentiment_requests_total', 'technical_analysis_total',
                 'model_inference_duration_seconds']:
        assert f'# HELP {name} ' in body


def test_inference_duration_is_recorded_on_failure():
    before = sample('model_inference_duration_seconds_count', {})
    with pytest.raises(RuntimeError):
        with prom.inference('trend'):
            raise RuntimeError('model unavailable')
    assert sample('model_inference_duration_seconds_count', {}) == before + 1
