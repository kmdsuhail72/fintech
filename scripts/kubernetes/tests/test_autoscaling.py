"""Check rendered HPA integration for both deployment ownership paths."""
from pathlib import Path
import subprocess
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
BOUNDS = {'frontend': (2, 10), 'api': (3, 20), 'ai-service': (2, 15)}


@pytest.mark.parametrize('profile', ['kustomize', 'helm', 'helm-custom', 'helm-queue'])
def test_scaling_targets_and_optional_metrics(profile):
    if profile == 'kustomize':
        command = ['kubectl', 'kustomize', str(ROOT / 'k8s/environments/production')]
    else:
        command = ['helm', 'template', 'asteriq', str(ROOT / 'helm/asteriq-platform'),
                   '-f', str(ROOT / 'helm/asteriq-platform/values-production.yaml')]
        if profile in ['helm-custom', 'helm-queue']:
            command += ['-f', str(ROOT / 'k8s/autoscaling/custom-metrics-values.example.yaml')]
        if profile == 'helm-queue':
            command += ['-f', str(ROOT / 'k8s/autoscaling/ai-queue-values.example.yaml')]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    docs = [obj for obj in yaml.safe_load_all(result.stdout) if obj]
    deployments = {obj['metadata']['name']: obj for obj in docs if obj['kind'] == 'Deployment'}
    hpas = {obj['metadata']['name']: obj for obj in docs if obj['kind'] == 'HorizontalPodAutoscaler'}
    assert set(hpas) == set(BOUNDS)
    for name, (minimum, maximum) in BOUNDS.items():
        spec = hpas[name]['spec']
        assert (spec['minReplicas'], spec['maxReplicas']) == (minimum, maximum)
        assert spec['scaleTargetRef']['name'] == name
        resources = {metric['resource']['name']: metric['resource']['target']['averageUtilization']
                     for metric in spec['metrics'] if metric['type'] == 'Resource'}
        assert resources == {'cpu': 65, 'memory': 80}
        pod = deployments[name]['spec']['template']['spec']
        assert all({'cpu', 'memory'} <= container['resources']['requests'].keys()
                   for container in pod['containers'])
        assert spec['behavior']['scaleDown']['stabilizationWindowSeconds'] >= 300
        if profile.startswith('helm'):
            assert 'replicas' not in deployments[name]['spec']
    if profile in ['helm-custom', 'helm-queue']:
        names = {m['pods']['metric']['name'] for m in hpas['api']['spec']['metrics'] if m['type'] == 'Pods'}
        assert names == {'asteriq_http_requests_per_second', 'asteriq_websocket_connections'}
    if profile == 'helm-queue':
        metric = next(m for m in hpas['ai-service']['spec']['metrics'] if m['type'] == 'External')
        assert metric['external']['target'] == {'type': 'AverageValue', 'averageValue': '5'}
