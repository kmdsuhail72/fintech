from pathlib import Path
import subprocess

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
TREE = ROOT / 'gitops/app-of-apps'
NAMES = {'asteriq-web', 'asteriq-api', 'asteriq-ai-service', 'monitoring',
         'logging', 'ingress-controller', 'cert-manager'}


@pytest.mark.parametrize('env', ['dev', 'staging', 'production'])
def test_environment_ownership_and_sync_policy(env):
    folder = TREE / 'environments' / env
    composition = yaml.safe_load((folder / 'kustomization.yaml').read_text())
    assert set(composition['resources']) == {name + '.yaml' for name in NAMES}
    root = yaml.safe_load((TREE / 'roots' / (env + '.yaml')).read_text())
    assert root['spec']['source']['path'] == f'app-of-apps/environments/{env}'
    for name in NAMES:
        child = yaml.safe_load((folder / (name + '.yaml')).read_text())
        assert child['metadata']['name'] == f'{name}-{env}'
        assert 'finalizers' not in child['metadata']
        policy = child['spec']['syncPolicy']
        assert 'FailOnSharedResource=true' in policy['syncOptions']
        if env == 'production':
            assert 'automated' not in policy
        else:
            assert policy['automated']['selfHeal'] is True
            assert policy['automated']['prune'] == name.startswith('asteriq-')
    api = yaml.safe_load((folder / 'asteriq-api.yaml').read_text())
    assert any(s.get('path') == 'gitops/app-of-apps/migration'
               for s in api['spec']['sources'])


def test_projects_and_health():
    for env in ['dev', 'staging', 'production']:
        project = yaml.safe_load((TREE / 'projects' / (env + '-workloads.yaml')).read_text())
        assert project['spec']['clusterResourceWhitelist'] == []
        assert not any(p['kind'] == 'Secret' for p in project['spec']['namespaceResourceWhitelist'])
    health = yaml.safe_load((TREE / 'bootstrap/application-health.yaml').read_text())
    lua = health['data']['resource.customizations.health.argoproj.io_Application']
    assert '"Synced"' in lua and '"Healthy"' in lua


def test_migration_chart_renders_digest_and_hook():
    result = subprocess.run(['helm', 'template', 'asteriq', str(TREE / 'migration'),
                             '--set', 'migration.enabled=true', '--set',
                             'asteriq-api.image.repository=example/api', '--set',
                             'asteriq-api.image.digest=sha256:' + 'a' * 64],
                            capture_output=True, text=True, check=True)
    job = yaml.safe_load(result.stdout)
    assert job['metadata']['annotations']['argocd.argoproj.io/hook'] == 'PreSync'
    assert job['spec']['template']['spec']['containers'][0]['image'] == 'example/api@sha256:' + 'a' * 64
