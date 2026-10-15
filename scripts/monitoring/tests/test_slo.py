"""Validate generated assets and actual PromQL evaluation without a cluster."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import yaml

ROOT = Path(__file__).resolve().parents[3]


def test_assets_match_generator_and_are_provisioned():
    generated, dashboard = runpy.run_path(str(ROOT / 'scripts/monitoring/build_slo.py'))['build']()
    assert yaml.safe_load((ROOT / 'k8s/monitoring/prometheus/slo-rules.yaml').read_text()) == generated
    assert json.loads((ROOT / 'k8s/monitoring/grafana/dashboards/slo.json').read_text()) == dashboard
    assert len(dashboard['panels']) == 9
    assert 'slo-rules.yaml' in (ROOT / 'k8s/monitoring/prometheus/kustomization.yaml').read_text()
    assert 'slo.json=dashboards/slo.json' in (ROOT / 'k8s/monitoring/grafana/kustomization.yaml').read_text()
    for environment in ['dev', 'staging', 'production']:
        values = yaml.safe_load((ROOT / f'gitops/app-of-apps/values/{environment}/monitoring.yaml').read_text())
        assert values['prometheus']['prometheusSpec']['retention'] == '45d'


def test_real_promql_burn_windows_budgets_and_empty_traffic(tmp_path):
    configured = os.environ.get('PROMTOOL_BIN')
    fallback = ROOT / '.runtime/prometheus-tools/prometheus-3.15.0.windows-amd64/promtool.exe'
    executable = configured or (str(fallback) if fallback.exists() else 'promtool')
    resource = yaml.safe_load((ROOT / 'k8s/monitoring/prometheus/slo-rules.yaml').read_text())
    rules = tmp_path / 'slo.yaml'
    rules.write_text(yaml.safe_dump({'groups': resource['spec']['groups']}), encoding='utf-8')
    subprocess.run([executable, 'check', 'rules', str(rules)], check=True, capture_output=True, text=True)
    labels = '{namespace="asteriq-production",slo="api-availability",service="api"}'
    # Isolate alert inputs from recording evaluation so both-window behavior is explicit.
    alert_rules = tmp_path / 'alerts.yaml'
    alert_rules.write_text(yaml.safe_dump({'groups': [resource['spec']['groups'][1]]}), encoding='utf-8')
    tests = []
    for long, short, fires in [(20, 20, True), (20, 0, False), (0, 20, False), (14.4, 14.4, False)]:
        expected = []
        if fires:
            alert = resource['spec']['groups'][1]['rules'][0]
            expected = [{'exp_labels': {'namespace': 'asteriq-production', 'service': 'api', 'slo': 'api-availability', **alert['labels']},
                         'exp_annotations': {'summary': 'api-availability error budget is burning', **{k: v for k, v in alert['annotations'].items() if k != 'summary'}}}]
        tests.append({'interval': '1m', 'input_series': [
            {'series': 'asteriq:slo_burn_rate:1h'+labels, 'values': f'{long}+0x5'},
            {'series': 'asteriq:slo_burn_rate:5m'+labels, 'values': f'{short}+0x5'}],
            'alert_rule_test': [{'eval_time': '4m', 'alertname': 'AsteriqSLOBurnFast', 'exp_alerts': expected}]})
    suite = tmp_path / 'alerts-test.yaml'
    suite.write_text(yaml.safe_dump({'rule_files': [str(alert_rules)], 'evaluation_interval': '1m', 'tests': tests}), encoding='utf-8')
    subprocess.run([executable, 'test', 'rules', str(suite)], check=True, capture_output=True, text=True)
    series = []
    for namespace, status, values in [('asteriq-production', '200', '0+99x65'), ('asteriq-production', '500', '0+1x65'),
                                      ('asteriq-staging', '200', '0+0x65'), ('asteriq-dev', '200', '0+100x65')]:
        series.append({'series': f'asteriq_http_requests_total{{namespace="{namespace}",operation="core",method="GET",status="{status}"}}', 'values': values})
    for status, increment in [('200', 999), ('429', 1), ('400', 10000)]:
        series.append({'series': f'asteriq_http_requests_total{{namespace="asteriq-production",operation="trading",method="POST",status="{status}"}}', 'values': f'0+{increment}x65'})
    for metric, extra, increment in [('asteriq_ai_request_duration_seconds_count', '', 100),
                                     ('asteriq_ai_request_duration_seconds_bucket', ',le="5.0"', 95)]:
        series.append({'series': f'{metric}{{namespace="asteriq-production",operation="research"{extra}}}', 'values': f'0+{increment}x65'})
    suite.write_text(yaml.safe_dump({'rule_files': [str(rules)], 'evaluation_interval': '1m', 'tests': [{
        'interval': '1m', 'input_series': series, 'promql_expr_test': [
            {'expr': 'asteriq:slo_bad_ratio:5m{slo="api-availability",namespace="asteriq-production"}', 'eval_time': '1h',
             'exp_samples': [{'labels': 'asteriq:slo_bad_ratio:5m'+labels, 'value': 2/1100}]},
            {'expr': 'asteriq:slo_bad_ratio:5m{slo="api-availability",namespace="asteriq-dev"}', 'eval_time': '1h',
             'exp_samples': [{'labels': 'asteriq:slo_bad_ratio:5m{namespace="asteriq-dev",slo="api-availability",service="api"}', 'value': 0}]},
            {'expr': 'asteriq:slo_bad_ratio:5m{slo="api-availability",namespace="asteriq-staging"} >= 0', 'eval_time': '1h', 'exp_samples': []},
            {'expr': 'asteriq:slo_budget_remaining:ratio{slo="api-availability",namespace="asteriq-production"}', 'eval_time': '1h',
             'exp_samples': [{'labels': 'asteriq:slo_budget_remaining:ratio'+labels, 'value': 1-(2/1100)/.001}]},
            {'expr': 'asteriq:slo_burn_rate:5m{slo="trade-success",namespace="asteriq-production"}', 'eval_time': '1h',
             'exp_samples': [{'labels': 'asteriq:slo_burn_rate:5m{namespace="asteriq-production",slo="trade-success",service="api"}', 'value': 2}]},
            {'expr': 'asteriq:slo_bad_ratio:5m{slo="ai-research-latency",namespace="asteriq-production"}', 'eval_time': '1h',
             'exp_samples': [{'labels': 'asteriq:slo_bad_ratio:5m{namespace="asteriq-production",slo="ai-research-latency",service="ai-service"}', 'value': 1-.95}]},
        ]}]}), encoding='utf-8')
    subprocess.run([executable, 'test', 'rules', str(suite)], check=True, capture_output=True, text=True)


def test_alert_grouping_and_inhibition_preserve_slo_boundary():
    for name in ['alertmanager.example.yaml', 'alertmanager-teams.example.yaml']:
        config = yaml.safe_load((ROOT / 'k8s/monitoring/alertmanager' / name).read_text())
        route = next(r for r in config['route']['routes'] if 'alert_family="slo-burn"' in r.get('matchers', []))
        assert 'slo' in route['group_by'] and 'alertname' not in route['group_by']
        assert any('slo' in r['equal'] and 'severity="critical"' in r['source_matchers'] for r in config['inhibit_rules'])
