"""Check portable dashboard assets and provisioning contracts without a cluster."""
import json
from pathlib import Path
import runpy

import yaml

ROOT = Path(__file__).resolve().parents[3]
GRAFANA = ROOT / 'k8s/monitoring/grafana'


def test_dashboard_assets_are_reproducible_and_panels_do_not_overlap():
    generated = runpy.run_path(str(ROOT / 'scripts/monitoring/build_dashboards.py'))['build']()
    assert len(generated) == 5
    uids = set()
    for name, expected in generated.items():
        data = json.loads((GRAFANA / 'dashboards' / (name + '.json')).read_text())
        assert data == expected
        assert data['uid'] not in uids
        uids.add(data['uid'])
        occupied = set()
        ids = set()
        for panel in data['panels']:
            assert panel['id'] not in ids
            ids.add(panel['id'])
            position = panel['gridPos']
            assert position['x'] + position['w'] <= 24
            cells = {(x, y) for x in range(position['x'], position['x'] + position['w'])
                     for y in range(position['y'], position['y'] + position['h'])}
            assert not occupied.intersection(cells)
            occupied.update(cells)
            assert panel['datasource']['type'] == 'prometheus'
            for target in panel['targets']:
                assert ' or vector(0)' not in target['expr']
                if 'histogram_quantile' in target['expr']:
                    assert 'by(le' in target['expr']


def test_configmaps_bundle_all_dashboards_and_gitops_enables_sidecars():
    config = yaml.safe_load((GRAFANA / 'kustomization.yaml').read_text())
    assert config['generatorOptions']['labels']['grafana_dashboard'] == '1'
    entries = config['configMapGenerator']
    assert len(entries) == 6
    for entry in entries:
        for file in entry['files']:
            assert (GRAFANA / file.split('=', 1)[1]).is_file()
    for env in ['dev', 'staging', 'production']:
        values = yaml.safe_load((ROOT / f'gitops/app-of-apps/values/{env}/monitoring.yaml').read_text())
        assert values['grafana']['sidecar']['dashboards']['enabled']
        assert not values['grafana']['sidecar']['datasources']['defaultDatasourceEnabled']
        app = yaml.safe_load((ROOT / f'gitops/app-of-apps/environments/{env}/monitoring.yaml').read_text())
        assert any(source.get('path') == 'k8s/monitoring/grafana' for source in app['spec']['sources'])


def test_alerts_have_no_grafana_variables_and_exporter_uses_existing_secret():
    rules = yaml.safe_load((ROOT / 'k8s/monitoring/prometheus/asteriq-alerts.yaml').read_text())
    for group in rules['spec']['groups']:
        for rule in group['rules']:
            assert '$' not in rule['expr']
            assert rule['for']
            assert rule['labels']['severity'] in {'warning', 'critical', 'info'}
    exporter = yaml.safe_load((GRAFANA / 'postgres-exporter-values.example.yaml').read_text())
    assert exporter['config']['datasourceSecret']['name'] == 'postgres-exporter'
    assert 'password' not in exporter['config']
