"""Account-free checks of the credential boundary and rendered pod wiring."""
from pathlib import Path
import json
import subprocess
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
EXPECTED = {
    'api-secrets': {'DATABASE_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET', 'SMTP_URL'},
    'ai-service-secrets': {'RAG_DATABASE_URL', 'OPENAI_API_KEY'},
    'migration-secrets': {'DATABASE_URL'},
}


@pytest.mark.parametrize('environment', ['dev', 'staging', 'production'])
def test_rendered_secret_boundary(environment):
    result = subprocess.run(['kubectl', 'kustomize', str(ROOT / 'k8s/environments' / environment)],
                            capture_output=True, text=True, check=True)
    docs = [d for d in yaml.safe_load_all(result.stdout) if d]
    external = {d['metadata']['name']: d for d in docs if d['kind'] == 'ExternalSecret'}
    assert set(external) == set(EXPECTED)
    for name, keys in EXPECTED.items():
        spec = external[name]['spec']
        assert spec['refreshPolicy'] == 'Periodic' and spec['refreshInterval'] == '5m'
        assert spec['target']['deletionPolicy'] == 'Retain'
        assert spec['target']['creationPolicy'] == 'Owner'
        assert {d['secretKey'] for d in spec['data']} == keys
        assert all(d['remoteRef']['key'].startswith(f'asteriq-{environment}/') for d in spec['data'])
    store = next(d for d in docs if d['kind'] == 'SecretStore')
    assert store['spec']['provider']['aws']['auth'] == {'jwt': {'serviceAccountRef': {'name': 'secrets-reader'}}}
    assert not any(d['kind'] == 'Secret' and d['metadata']['name'] in EXPECTED for d in docs)
    for d in docs:
        if d['kind'] != 'Deployment':
            continue
        name = d['metadata']['name']
        spec = d['spec']['template']['spec']
        refs = {item['secretRef']['name'] for c in spec['containers'] for item in c.get('envFrom', []) if 'secretRef' in item}
        if name == 'api': assert refs == {'api-secrets'}
        elif name == 'ai-service': assert refs == {'ai-service-secrets'}
        elif name == 'frontend': assert not refs


def test_no_terraform_secret_values_and_exact_iam_example():
    module = (ROOT / 'infrastructure/terraform/modules/secrets/main.tf').read_text(encoding='utf-8')
    assert 'aws_secretsmanager_secret_version' not in module
    assert 'secret_string' not in module
    policy = json.loads((ROOT / 'k8s/security/iam/secrets-reader-policy.example.json').read_text())
    statement = policy['Statement'][0]
    assert set(statement['Action']) == {'secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'}
    assert len(statement['Resource']) == 7
    assert all('*' not in arn for arn in statement['Resource'])
    iam = (ROOT / 'infrastructure/eks/foundation/iam.tf').read_text(encoding='utf-8')
    assert 'Resource = values(module.secrets.arns)' in iam
    assert 'system:serviceaccount:${local.namespace}:secrets-reader' in iam
    assert ':aud" = "sts.amazonaws.com"' in iam
