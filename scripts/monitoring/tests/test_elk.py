import json
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
ELK = ROOT / 'k8s/monitoring/elk'


@pytest.mark.parametrize('service,event,status,endpoint,category', [
    ('api', 'http_request', 200, '/quotes', 'application'),
    ('api', 'authentication_failure', 401, '/orders/*', 'security'),
    ('api', 'http_request', 200, '/login', 'security'),
    ('api', 'authentication_success', 200, '', 'security'),
    ('api', 'authorization_failure', 403, '/quotes', 'security'),
    ('api', 'trade_failure', 422, '/orders', 'trading'),
    ('ai-service', 'ai_failure', 503, '/research/assistant', 'ai'),
    ('ai-service', 'authentication_failure', 401, '/research/assistant', 'security'),
])
def test_lua_routing_and_privacy(service, event, status, endpoint, category):
    from lupa import LuaRuntime
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute((ELK / 'base/normalize.lua').read_text())
    record = lua.table_from({'kubernetes': {'namespace_name': 'asteriq-production',
        'pod_name': 'test-pod', 'container_name': service,
        'labels': {'app.kubernetes.io/name': service}},
        'application': {'event': event, 'status': status, 'endpoint': endpoint,
        'message': 'Bearer private-token postgresql://user:password@db/test ?token=private-value person@example.com',
        'password': 'never-export', 'userId': 'private-user', 'traceId': 'a' * 32}}, recursive=True)
    code, timestamp, result = lua.globals().normalize('kube.test', 123, record)
    assert code == 1 and timestamp == 123
    assert result['category'] == category
    assert result['es_index_prefix'] == 'asteriq-production-' + category
    assert result['status_code'] == status
    assert result['trace_id'] == 'a' * 32
    assert result['password'] is None and result['userId'] is None
    assert all(secret not in result['message'] for secret in ['private-token', 'user:password', 'private-value', 'person@example.com'])


def test_nonselected_namespaces_and_feedback_are_dropped():
    from lupa import LuaRuntime
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute((ELK / 'base/normalize.lua').read_text())
    for namespace, service in [('unrelated', 'api'), ('monitoring', 'elasticsearch')]:
        record = lua.table_from({'kubernetes': {'namespace_name': namespace,
            'container_name': service}}, recursive=True)
        assert lua.globals().normalize('test', 1, record)[0] == -1


@pytest.mark.parametrize('namespace,service,expected_service', [
    ('asteriq-production', 'frontend', 'web'),
    ('asteriq-production', 'api', 'api'),
    ('ingress-nginx', 'ingress-nginx', 'ingress-nginx'),
    ('kube-system', 'coredns', 'coredns'),
    ('cert-manager', 'cert-manager', 'cert-manager'),
])
def test_container_sources(namespace, service, expected_service, monkeypatch):
    from lupa import LuaRuntime
    monkeypatch.setenv('ASTERIQ_ENVIRONMENT', 'production')
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute((ELK / 'base/normalize.lua').read_text())
    record = lua.table_from({'kubernetes': {'namespace_name': namespace,
        'container_name': service, 'pod_name': 'fixture', 'host': 'worker-1'},
        'log': 'container stdout fixture'}, recursive=True)
    code, _, result = lua.globals().normalize('kube.test', 123, record)
    assert code == 1
    assert result['service'] == expected_service
    assert result['namespace'] == namespace and result['node'] == 'worker-1'
    assert result['es_index_prefix'] == 'asteriq-production-application'


def test_application_json_cannot_spoof_kubernetes_metadata():
    from lupa import LuaRuntime
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute((ELK / 'base/normalize.lua').read_text())
    record = lua.table_from({'kubernetes': {'namespace_name': 'asteriq-dev', 'container_name': 'api'},
        'application': {'kubernetes': {'namespace_name': 'asteriq-production'},
                        'status_code': {}, 'message': 'fixture'}}, recursive=True)
    code, _, result = lua.globals().normalize('test', 1, record)
    assert code == 1
    assert result['namespace'] == 'asteriq-dev'
    assert result['status_code'] is None


def test_saved_object_references_and_strict_index_schema():
    objects = [json.loads(line) for line in (ELK / 'kibana/asteriq-dashboards.ndjson').read_text().splitlines()]
    identities = {(obj['type'], obj['id']) for obj in objects}
    assert len(identities) == len(objects)
    assert len([obj for obj in objects if obj['type'] == 'dashboard']) == 5
    for obj in objects:
        for reference in obj['references']:
            assert (reference['type'], reference['id']) in identities
        for field in ['panelsJSON', 'visState', 'optionsJSON', 'uiStateJSON']:
            if field in obj['attributes']:
                json.loads(obj['attributes'][field])
        if obj['type'] == 'visualization':
            source = json.loads(obj['attributes']['kibanaSavedObjectMeta']['searchSourceJSON'])
            query = source['query']['query']
            assert '\\"' not in query
            if obj['id'].startswith('asteriq-authentication-'):
                assert 'event:authentication_*' in query
                assert '"/logout-all"' in query
    for category in ['application', 'security', 'trading', 'ai']:
        template = json.loads((ELK / f'elasticsearch/{category}-template.json').read_text())
        assert template['template']['mappings']['dynamic'] == 'strict'
        assert template['template']['mappings']['properties']['status_code']['type'] == 'integer'
    manifests = list(yaml.safe_load_all((ELK / 'base/fluent-bit.yaml').read_text()))
    daemon = next(obj for obj in manifests if obj['kind'] == 'DaemonSet')
    assert daemon['metadata']['namespace'] == 'logging-agents'
    assert daemon['spec']['template']['spec']['volumes'][0]['hostPath']['path'] == '/var/log'
