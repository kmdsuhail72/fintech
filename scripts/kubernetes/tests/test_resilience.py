"""Offline safety and scope contracts; not evidence of live fault recovery."""
from pathlib import Path
import runpy
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
MODULE = runpy.run_path(str(ROOT / 'scripts/kubernetes/resilience.py'))


@pytest.mark.parametrize('name', MODULE['EXPERIMENTS'])
def test_faults_are_bounded_and_staging_only(name):
    resource = MODULE['render'](name, endpoint='dependency.staging.example.invalid')
    assert resource['metadata']['namespace'] == 'asteriq-staging'
    spec = resource['spec']
    assert spec['selector']['namespaces'] == ['asteriq-staging']
    assert spec['selector']['labelSelectors']['app.kubernetes.io/part-of'] == 'asteriq'
    assert spec['duration'] == '180s'
    if spec['mode'] == 'all':
        assert name in ('redis-outage', 'database-connection-failure')
        assert spec['externalTargets'] == ['dependency.staging.example.invalid']
        assert spec['direction'] == 'to'
    else:
        assert spec['mode'] == 'one'
    assert yaml.safe_load(yaml.safe_dump(resource)) == resource


@pytest.mark.parametrize('endpoint', [None, '*', 'https://redis', 'redis:6379', 'user:password@redis', 'a b', 'token@redis', 'redis?token=value'])
def test_dependency_faults_require_explicit_noncredential_target(endpoint):
    with pytest.raises(ValueError): MODULE['render']('redis-outage', endpoint=endpoint)


@pytest.mark.parametrize('duration', [0, 29, 901, 3600])
def test_unbounded_durations_are_rejected(duration):
    with pytest.raises(ValueError): MODULE['render']('high-cpu', duration=duration)


def test_unknown_scenarios_and_live_commands_are_not_supported():
    with pytest.raises(ValueError): MODULE['render']('node-failure')
    source = (ROOT / 'scripts/kubernetes/resilience.py').read_text()
    assert 'subprocess' not in source and 'boto3' not in source
    report = yaml.safe_load((ROOT / 'k8s/resilience/results.example.yaml').read_text())
    assert report['status'] == 'not_run'
    assert report['evidence']['cleanup_verified'] is False
