"""Generate the reviewed, request-based 30-day reliability model."""
from pathlib import Path
import json
import runpy
import yaml

ROOT = Path(__file__).resolve().parents[2]
NS = 'namespace=~"asteriq-(dev|staging|production)"'
API = f'{NS},operation!="health",method!="OPTIONS"'
ELIGIBLE = 'status=~"[23]..|429|499|5.."'
BAD = 'status=~"429|499|5.."'
SLOS = {
    'api-availability': (.999, 'api', f'asteriq_http_requests_total{{{API},{ELIGIBLE}}}', f'asteriq_http_requests_total{{{API},{BAD}}}', None),
    'trade-success': (.9995, 'api', f'asteriq_http_requests_total{{{NS},operation="trading",method="POST",{ELIGIBLE}}}', f'asteriq_http_requests_total{{{NS},operation="trading",method="POST",{BAD}}}', None),
    'api-latency': (.95, 'api', f'asteriq_http_request_duration_seconds_count{{{NS},operation!~"health|research"}}', f'asteriq_http_request_duration_seconds_bucket{{{NS},operation!~"health|research",le="0.5"}}', '0.5'),
    'ai-availability': (.999, 'ai-service', f'asteriq_ai_requests_total{{{NS},operation!="health",{ELIGIBLE}}}', f'asteriq_ai_requests_total{{{NS},operation!="health",{BAD}}}', None),
    'ai-research-latency': (.95, 'ai-service', f'asteriq_ai_request_duration_seconds_count{{{NS},operation="research"}}', f'asteriq_ai_request_duration_seconds_bucket{{{NS},operation="research",le="5.0"}}', '5'),
}


def build():
    recordings, alerts = [], []
    for slo, (objective, service, total, part, latency) in SLOS.items():
        labels = {'slo': slo, 'service': service}
        for window in ['5m', '30m', '1h', '2h', '6h', '1d', '3d', '30d']:
            denominator = f'sum by(namespace)(increase({total}[{window}]))'
            numerator = f'(sum by(namespace)(increase({part}[{window}])) or on(namespace) (0 * {denominator}))'
            ratio = f'({numerator} / {denominator})'
            if latency: ratio = f'(1 - {ratio})'
            # No denominator clamp: no requests is unknown, never 100% success.
            recordings.append({'record': f'asteriq:slo_bad_ratio:{window}', 'expr': f'clamp_max(clamp_min({ratio}, 0), 1)', 'labels': labels})
            recordings.append({'record': f'asteriq:slo_burn_rate:{window}', 'expr': f'asteriq:slo_bad_ratio:{window}{{slo="{slo}"}} / {1-objective:.6f}', 'labels': labels})
        recordings += [
            {'record': 'asteriq:slo_objective:ratio', 'expr': f'0 * sum by(namespace)({total}) + {objective}', 'labels': labels},
            {'record': 'asteriq:slo_requests:30d', 'expr': f'sum by(namespace)(increase({total}[30d]))', 'labels': labels},
            {'record': 'asteriq:slo_budget_remaining:ratio', 'expr': f'1 - asteriq:slo_burn_rate:30d{{slo="{slo}"}}', 'labels': labels},
        ]
    for name, long, short, burn, severity, response in [
        ('Fast', '1h', '5m', 14.4, 'critical', 'Page; acknowledge within 5 minutes.'),
        ('Sustained', '6h', '30m', 6, 'critical', 'Page; acknowledge within 5 minutes.'),
        ('Slow', '1d', '2h', 3, 'warning', 'Create incident ticket; triage within 4 hours.'),
        ('Persistent', '3d', '6h', 1, 'info', 'Review within one business day.'),
    ]:
        alerts.append({'alert': 'AsteriqSLOBurn' + name,
            'expr': f'(asteriq:slo_burn_rate:{long} > {burn}) and on(namespace,service,slo) (asteriq:slo_burn_rate:{short} > {burn})',
            'for': '2m', 'labels': {'severity': severity, 'alert_family': 'slo-burn'},
            'annotations': {'summary': '{{ $labels.slo }} error budget is burning',
                'description': f'Both {long} and {short} exceed {burn}x burn. {response} Inspect the SLO dashboard and confirm customer impact.',
                'runbook_url': 'https://github.com/REPLACE_OWNER/REPLACE_REPO/blob/main/k8s/monitoring/slo/README.md'}})
    alerts.append({'alert': 'AsteriqSLOBudgetExhausted', 'expr': 'asteriq:slo_budget_remaining:ratio <= 0', 'for': '15m',
        'labels': {'severity': 'warning', 'alert_family': 'slo-budget'},
        'annotations': {'summary': '{{ $labels.slo }} 30-day error budget exhausted', 'description': 'Freeze risk-increasing releases; prioritize reliability recovery. Validate coverage before declaring compliance.'}})
    resource = {'apiVersion': 'monitoring.coreos.com/v1', 'kind': 'PrometheusRule',
        'metadata': {'name': 'asteriq-slo', 'namespace': 'monitoring', 'labels': {'asteriq.ai/monitoring': 'enabled'}},
        'spec': {'groups': [{'name': 'asteriq.slo.recording', 'interval': '1m', 'rules': recordings}, {'name': 'asteriq.slo.alerts', 'rules': alerts}]}}
    helper = runpy.run_path(str(ROOT / 'scripts/monitoring/build_dashboards.py'))
    dashboard = json.loads((ROOT / 'k8s/monitoring/grafana/dashboards/application.json').read_text())
    dashboard.update(uid='asteriq-slo', title='Asteriq AI / SLO reliability', tags=['asteriq', 'slo'], panels=[])
    selector = '{namespace=~"$namespace"}'
    for title, expr, unit in [
        ('30-day SLI (target: API/AI 99.9%, trade 99.95%, latency 95%)', '1 - asteriq:slo_bad_ratio:30d' + selector, 'percentunit'),
        ('30-day error budget remaining (negative means exhausted)', 'asteriq:slo_budget_remaining:ratio' + selector, 'percentunit'),
        ('Short-window burn rate', 'asteriq:slo_burn_rate:5m' + selector, 'short'),
        ('Long-window burn rate', 'asteriq:slo_burn_rate:1h' + selector, 'short'),
        ('Measured requests in 30 days', 'asteriq:slo_requests:30d' + selector, 'short'),
        ('Allowed bad requests in 30 days', '(1 - asteriq:slo_objective:ratio' + selector + ') * asteriq:slo_requests:30d' + selector, 'short'),
        ('Core API p95 (target < 0.5s)', 'histogram_quantile(0.95,sum by(le,namespace)(rate(asteriq_http_request_duration_seconds_bucket{namespace=~"$namespace",operation!~"health|research"}[5m])))', 's'),
        ('AI research p95 (target < 5s)', 'histogram_quantile(0.95,sum by(le,namespace)(rate(asteriq_ai_request_duration_seconds_bucket{namespace=~"$namespace",operation="research"}[5m])))', 's'),
        ('Scrape coverage (0 is unavailable; absent is unknown)', 'up{namespace=~"$namespace",job=~".*(api|ai-service).*"}', 'short'),
    ]:
        panel = helper['panel'](title, [(expr, '{{namespace}} {{slo}} {{job}}')], unit=unit)
        i = len(dashboard['panels']); panel.update(id=i+1, gridPos={'x': (i % 2)*12, 'y': (i//2)*9, 'w': 12, 'h': 9})
        dashboard['panels'].append(panel)
    dashboard['description'] = 'Rolling 30-day request budgets. No traffic/missing data is unknown. Latency good events are <= bucket boundary (p95 is an estimate). Compliance requires 30 days of complete data; inspect scrape coverage.'
    return resource, dashboard


if __name__ == '__main__':
    resource, dashboard = build()
    (ROOT / 'k8s/monitoring/prometheus/slo-rules.yaml').write_text(yaml.safe_dump(resource, sort_keys=False), encoding='utf-8')
    (ROOT / 'k8s/monitoring/grafana/dashboards/slo.json').write_text(json.dumps(dashboard, indent=2)+'\n', encoding='utf-8')
