"""Generate portable Grafana classic dashboards from reviewed PromQL panels."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'k8s/monitoring/grafana/dashboards'
DS = {'type': 'prometheus', 'uid': '${datasource}'}
APP = 'namespace=~"$namespace"'
DB = 'job=~"$database_job",datname=~"$database"'


def panel(title, expressions, unit='short', warn=None, critical=None, description='', kind='timeseries'):
    if isinstance(expressions, str):
        expressions = [(expressions, '')]
    steps = [{'color': 'green', 'value': None}]
    if title in {'Metrics targets up', 'Database exporter health'}:
        steps = [{'color': 'red', 'value': None}, {'color': 'green', 'value': 1}]
    if warn is not None:
        steps.append({'color': 'orange', 'value': warn})
    if critical is not None:
        steps.append({'color': 'red', 'value': critical})
    return {'title': title, 'type': kind, 'datasource': DS, 'description': description,
            'targets': [{'refId': chr(65+i), 'expr': expr, 'legendFormat': legend,
                         'range': kind != 'stat', 'instant': kind == 'stat', 'datasource': DS}
                        for i, (expr, legend) in enumerate(expressions)],
            'fieldConfig': {'defaults': {'unit': unit, 'thresholds': {'mode': 'absolute', 'steps': steps},
                                        'color': {'mode': 'thresholds' if kind == 'stat' else 'palette-classic'}, 'noValue': 'No data', 'custom': {'drawStyle': 'line', 'lineWidth': 2, 'fillOpacity': 8, 'showPoints': 'never', 'thresholdsStyle': {'mode': 'line'}}}, 'overrides': []},
            'options': {'legend': {'displayMode': 'table', 'placement': 'bottom', 'calcs': ['lastNotNull', 'max']}, 'tooltip': {'mode': 'multi'}, 'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'colorMode': 'value', 'graphMode': 'area'}}


def variable(name, query, label):
    return {'name': name, 'label': label, 'type': 'query', 'datasource': DS, 'query': query,
            'refresh': 1, 'multi': True, 'includeAll': True, 'allValue': '.*',
            'current': {'text': 'All', 'value': '$__all'}, 'options': []}


def dashboard(slug, title, panels, database=False):
    variables = [{'name': 'datasource', 'label': 'Prometheus', 'type': 'datasource', 'query': 'prometheus', 'current': {'text': 'Prometheus', 'value': 'prometheus'}}]
    variables.append({'name': 'namespace', 'label': 'Environment namespace', 'type': 'custom',
                      'query': 'asteriq-dev,asteriq-staging,asteriq-production', 'multi': True,
                      'includeAll': True, 'allValue': 'asteriq-(dev|staging|production)',
                      'current': {'text': 'All', 'value': '$__all'}, 'options': []})
    if database:
        variables += [variable('database_job', 'label_values(pg_up, job)', 'PostgreSQL exporter job'),
                      variable('database', 'label_values(pg_stat_database_numbackends{job=~"$database_job"}, datname)', 'Database')]
    for i, item in enumerate(panels):
        item['id'] = i+1
        item['gridPos'] = {'x': (i % 2)*12, 'y': (i//2)*9, 'w': 12, 'h': 9}
    return {'id': None, 'uid': 'asteriq-'+slug, 'title': 'Asteriq AI / '+title,
            'schemaVersion': 39, 'version': 1, 'editable': False, 'tags': ['asteriq', 'prometheus', slug],
            'timezone': 'browser', 'refresh': '30s', 'time': {'from': 'now-1h', 'to': 'now'},
            'graphTooltip': 1, 'annotations': {'list': []}, 'templating': {'list': variables},
            'links': [{'title': 'Asteriq dashboards', 'type': 'dashboards', 'tags': ['asteriq'], 'asDropdown': True, 'includeVars': True, 'keepTime': True}], 'panels': panels}


def build():
    datasets = {}
    datasets['kubernetes'] = dashboard('kubernetes', 'Kubernetes Cluster', [
        panel('Node CPU utilization', '1 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[$__rate_interval]))', 'percentunit', .8, .95, 'Cluster-wide node-exporter metrics; namespace selector does not filter nodes.'),
        panel('Node memory utilization', '1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes', 'percentunit', .85, .95),
        panel('Disk space used', '1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}', 'percentunit', .8, .9),
        panel('Node network throughput', [('sum by(instance)(rate(node_network_receive_bytes_total{device!="lo"}[$__rate_interval]))', '{{instance}} receive'), ('sum by(instance)(rate(node_network_transmit_bytes_total{device!="lo"}[$__rate_interval]))', '{{instance}} transmit')], 'Bps'),
        panel('Nodes ready / total', [('sum(kube_node_status_condition{condition="Ready",status="true"})', 'ready'), ('count(kube_node_info)', 'total')], kind='stat'),
        panel('Pods ready / total', [(f'sum(kube_pod_status_ready{{{APP},condition="true"}})', 'ready'), (f'count(kube_pod_info{{{APP}}})', 'total')], kind='stat'),
        panel('Pod CPU cores', f'sum by(namespace,pod)(rate(container_cpu_usage_seconds_total{{{APP},container!="",container!="POD"}}[$__rate_interval]))', 'cores'),
        panel('Pod memory working set', f'sum by(namespace,pod)(container_memory_working_set_bytes{{{APP},container!="",container!="POD"}})', 'bytes'),
        panel('Container restarts in 15 minutes', f'sum by(namespace,pod)(increase(kube_pod_container_status_restarts_total{{{APP}}}[15m]))', 'short', 1, 3),
        panel('Deployment replicas', [(f'kube_deployment_spec_replicas{{{APP}}}', '{{namespace}}/{{deployment}} desired'), (f'kube_deployment_status_replicas_available{{{APP}}}', '{{namespace}}/{{deployment}} available')]),
        panel('Container startup errors', f'sum by(namespace,pod,reason)(kube_pod_container_status_waiting_reason{{{APP},reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError"}})', 'short', 1, 2),
        panel('OOM terminations (last recorded reason)', f'kube_pod_container_status_last_terminated_reason{{{APP},reason="OOMKilled"}}', 'short', 1, 2),
    ])
    datasets['application'] = dashboard('application', 'Application', [
        panel('API request rate', f'sum by(namespace,operation)(rate(asteriq_http_requests_total{{{APP},operation!="health"}}[$__rate_interval]))', 'reqps'),
        panel('API latency p50 / p95 / p99', [(f'histogram_quantile({q},sum by(le,namespace)(rate(asteriq_http_request_duration_seconds_bucket{{{APP},operation!~"health|research"}}[$__rate_interval])))', '{{namespace}} p'+str(int(q*100))) for q in [.5,.95,.99]], 's', .5, 1),
        panel('HTTP 4xx / 5xx rate', [(f'sum by(namespace)(rate(asteriq_http_requests_total{{{APP},status=~"{code}.."}}[$__rate_interval]))', '{{namespace}} '+code+'xx') for code in ['4','5']], 'reqps'),
        panel('HTTP 5xx ratio', f'sum by(namespace)(rate(asteriq_http_requests_total{{{APP},operation!="health",status=~"5.."}}[$__rate_interval])) / clamp_min(sum by(namespace)(rate(asteriq_http_requests_total{{{APP},operation!="health"}}[$__rate_interval])),0.001)', 'percentunit', .02, .05),
        panel('WebSocket sessions', f'sum by(namespace)(asteriq_websocket_connections{{{APP}}})', description='Authenticated sockets; reconnects and browser tabs create multiple sessions.'),
        panel('Active HTTP requests', f'sum by(namespace)(asteriq_http_active_requests{{{APP}}})'),
        panel('Metrics targets up', f'up{{{APP}}}', 'short', description='Zero is down; a missing discovery target yields no data.', kind='stat'),
    ])
    datasets['trading'] = dashboard('trading', 'Trading', [
        panel('Orders per minute', f'sum by(namespace)(rate(asteriq_trading_requests_total{{{APP}}}[$__rate_interval])) * 60', 'short'),
        panel('Successful order responses per minute', f'sum by(namespace)(rate(asteriq_http_requests_total{{{APP},operation="trading",method="POST",status=~"2.."}}[$__rate_interval])) * 60', description='Includes successful idempotent replay responses; not a unique order count.'),
        panel('Failed order requests per minute', f'sum by(namespace)(rate(asteriq_failed_orders_total{{{APP}}}[$__rate_interval])) * 60', description='Includes authentication/validation failures and aborted requests.'),
        panel('Order failure ratio', f'sum by(namespace)(rate(asteriq_failed_orders_total{{{APP}}}[$__rate_interval])) / clamp_min(sum by(namespace)(rate(asteriq_trading_requests_total{{{APP}}}[$__rate_interval])),0.001)', 'percentunit', .05, .1),
        panel('Trades per minute', f'sum by(namespace)(rate(asteriq_trades_total{{{APP}}}[$__rate_interval])) * 60', description='Committed executions; excludes idempotent replay. Best effort, not a financial ledger.'),
        panel('Active users per pod (five-minute estimate)', f'asteriq_active_users{{{APP}}}', description='Per-pod distinct authenticated HTTP users, capped at 10000. Do not sum for global unique users.'),
        panel('Watchlist requests per minute', f'sum by(namespace)(rate(asteriq_watchlist_activity_total{{{APP}}}[$__rate_interval])) * 60'),
        panel('Price alert triggers per minute', f'sum by(namespace)(rate(asteriq_price_alert_triggers_total{{{APP}}}[$__rate_interval])) * 60'),
    ])
    datasets['ai'] = dashboard('ai', 'AI', [
        panel('AI requests per second', f'sum by(namespace)(rate(ai_requests_total{{{APP}}}[$__rate_interval]))', 'reqps'),
        panel('AI request latency p95 / p99', [(f'histogram_quantile({q},sum by(le,namespace)(rate(ai_request_duration_seconds_bucket{{{APP}}}[$__rate_interval])))','{{namespace}} p'+str(int(q*100))) for q in [.95,.99]], 's', 10, 30),
        panel('Model inference latency p95', f'histogram_quantile(0.95,sum by(le,namespace,operation)(rate(asteriq_model_inference_duration_seconds_bucket{{{APP}}}[$__rate_interval])))', 's', 1, 5),
        panel('LLM API wrapper latency p95', f'histogram_quantile(0.95,sum by(le,namespace,operation)(rate(asteriq_llm_api_duration_seconds_bucket{{{APP}}}[$__rate_interval])))', 's', 30, 45),
        panel('LLM failures per minute', f'sum by(namespace)(rate(llm_failures_total{{{APP}}}[$__rate_interval])) * 60'),
        panel('LLM failure ratio', f'sum by(namespace)(rate(llm_failures_total{{{APP}}}[$__rate_interval])) / clamp_min(sum by(namespace)(rate(llm_calls_total{{{APP}}}[$__rate_interval])),0.001)', 'percentunit', .1, .25),
        panel('Reported token consumption per minute', f'sum by(namespace,direction)(rate(asteriq_llm_tokens_total{{{APP}}}[$__rate_interval])) * 60', description='Provider-reported research tokens only; missing metadata and embedding token usage are not estimated.'),
        panel('Reported tokens over selected range', f'sum by(namespace,direction)(increase(asteriq_llm_tokens_total{{{APP}}}[$__range]))', kind='stat'),
        panel('Sentiment / technical demand per minute', [(f'sum by(namespace)(rate({metric}{{{APP}}}[$__rate_interval])) * 60', '{{namespace}} '+name) for metric,name in [('sentiment_requests_total','sentiment'),('technical_analysis_total','technical')]]),
    ])
    datasets['database'] = dashboard('database', 'Database', [
        panel('PostgreSQL connections by database', f'pg_stat_database_numbackends{{{DB}}}', description='Requires postgres_exporter. Database selection is independent of application namespace.'),
        panel('Connection capacity used', 'sum by(job,instance)(pg_stat_database_numbackends{job=~"$database_job"}) / on(job,instance) pg_settings_max_connections{job=~"$database_job"}', 'percentunit', .8, .9, 'All databases count toward server capacity; settings metrics must be enabled.'),
        panel('Application query latency p95 / p99', [(f'histogram_quantile({q},sum by(le,namespace)(rate(asteriq_database_query_duration_seconds_bucket{{{APP}}}[$__rate_interval])))','{{namespace}} p'+str(int(q*100))) for q in [.95,.99]], 's', .1, .5),
        panel('Application slow queries (> 1 second) per minute', f'clamp_min(sum by(namespace)(rate(asteriq_database_query_duration_seconds_count{{{APP}}}[$__rate_interval])) - sum by(namespace)(rate(asteriq_database_query_duration_seconds_bucket{{{APP},le="1"}}[$__rate_interval])),0) * 60', description='Observed API query durations only; no SQL text is exported.'),
        panel('Application slow query ratio (> 1 second)', f'clamp_min(sum by(namespace)(rate(asteriq_database_query_duration_seconds_count{{{APP}}}[$__rate_interval])) - sum by(namespace)(rate(asteriq_database_query_duration_seconds_bucket{{{APP},le="1"}}[$__rate_interval])),0) / clamp_min(sum by(namespace)(rate(asteriq_database_query_duration_seconds_count{{{APP}}}[$__rate_interval])),0.001)', 'percentunit', .05, .1),
        panel('PostgreSQL transaction rate', [(f'sum by(datname)(rate(pg_stat_database_xact_{outcome}{{{DB}}}[$__rate_interval]))', '{{datname}} '+outcome) for outcome in ['commit','rollback']], 'ops'),
        panel('PostgreSQL rollback ratio', f'sum(rate(pg_stat_database_xact_rollback{{{DB}}}[$__rate_interval])) / clamp_min(sum(rate(pg_stat_database_xact_commit{{{DB}}}[$__rate_interval])) + sum(rate(pg_stat_database_xact_rollback{{{DB}}}[$__rate_interval])),0.001)', 'percentunit', .05, .1),
        panel('Database exporter health', 'pg_up{job=~"$database_job"}', description='Requires exporter; absence remains no data, never a fabricated healthy zero.', kind='stat'),
    ], database=True)
    return datasets


if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    for name, data in build().items():
        (DEST / (name+'.json')).write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
    print('Generated five Grafana dashboards')
