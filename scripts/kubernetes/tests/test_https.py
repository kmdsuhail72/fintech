"""Render dual-domain HTTPS profiles without AWS or Kubernetes API access."""
from pathlib import Path
import os
import subprocess
import yaml
import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize('engine', ['helm', 'kustomize'])
@pytest.mark.parametrize('mode', ['acm', 'cloudfront'])
def test_https_host_routing_redirect_and_private_api(engine, mode, tmp_path):
    if engine == 'helm':
        command = ['helm', 'template', 'https-demo', str(ROOT / 'helm/asteriq-platform'),
            '--namespace', 'asteriq-production', '-f', str(ROOT / 'helm/asteriq-platform/values-production.yaml'),
            '-f', str(ROOT / 'k8s/https/acm/values.yaml')]
        if mode == 'cloudfront': command += ['-f', str(ROOT / 'k8s/https/cloudfront/values.yaml')]
    else:
        command = ['kubectl', 'kustomize', str(ROOT / 'k8s/https' / mode)]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    docs = [doc for doc in yaml.safe_load_all(result.stdout) if doc]
    ingresses = [doc for doc in docs if doc['kind'] == 'Ingress']
    assert len(ingresses) == 1
    ingress = ingresses[0]
    ingress['metadata'].setdefault('namespace', 'asteriq-production')
    annotations = ingress['metadata']['annotations']
    assert ingress['spec']['ingressClassName'] == 'alb'
    assert annotations['alb.ingress.kubernetes.io/ssl-redirect'] == '443'
    assert annotations['alb.ingress.kubernetes.io/ssl-policy'] == 'ELBSecurityPolicy-TLS13-1-2-2021-06'
    assert 'max-age=31536000' in annotations['alb.ingress.kubernetes.io/listener-attributes.HTTPS-443']
    rules = {rule['host']: rule for rule in ingress['spec']['rules']}
    assert set(rules) == {'app.asteriq.ai', 'api.asteriq.ai'}
    assert {path['path'] for path in rules['api.asteriq.ai']['http']['paths']} == {'/api/v1', '/socket.io'}
    for rule in rules.values():
        for path in rule['http']['paths']:
            assert path['backend']['service'] == {'name': 'frontend', 'port': {'number': 8080}}
    services = [doc for doc in docs if doc['kind'] == 'Service']
    assert all(doc['spec'].get('type', 'ClusterIP') == 'ClusterIP' for doc in services)
    api_config = next(doc['data'] for doc in docs if doc['kind'] == 'ConfigMap' and doc['metadata']['name'] == 'api-config')
    assert api_config['CORS_ORIGINS'] == 'https://app.asteriq.ai'
    assert api_config['AUTH_WEB_URL'] == 'https://app.asteriq.ai'
    assert api_config['TRUST_PROXY_HOPS'] == ('3' if mode == 'cloudfront' else '2')
    expected_ports = '[{"HTTPS":443}]' if mode == 'cloudfront' else '[{"HTTP":80},{"HTTPS":443}]'
    assert annotations['alb.ingress.kubernetes.io/listen-ports'] == expected_ports
    cli = os.environ.get('KYVERNO_BIN')
    if cli:
        # Substitute a synthetic correctly shaped ARN for offline policy tests.
        annotations['alb.ingress.kubernetes.io/certificate-arn'] = 'arn:aws:acm:ap-south-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
        path = tmp_path / 'ingress.yaml'
        path.write_text(yaml.safe_dump(ingress), encoding='utf-8')
        checked = subprocess.run([cli, 'apply', str(ROOT / 'k8s/security/kyverno/ingress-and-services.yaml'),
            '-r', str(path), '--remove-color'], capture_output=True, text=True, check=True)
        assert 'pass: 1' in checked.stdout and 'error: 0' in checked.stdout
