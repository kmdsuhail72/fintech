from pathlib import Path
import re
import yaml
import pytest

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / 'k8s/monitoring/alertmanager/alertmanager.example.yaml'


def matches(labels, expressions):
    for expression in expressions:
        key, operator, value = re.fullmatch(r'(\w+)(=~|=)"(.*)"', expression).groups()
        current = labels.get(key, '')
        if operator == '=~':
            if re.fullmatch(value, current) is None:
                return False
        elif current != value:
            return False
    return True


def inhibited(source, target):
    config = yaml.safe_load(CONFIG.read_text())
    return any(matches(source, rule['source_matchers']) and matches(target, rule['target_matchers'])
               and all(source.get(key, '') == target.get(key, '') for key in rule['equal'])
               for rule in config['inhibit_rules'])


def test_inhibition_does_not_cross_cluster_namespace_or_alert_family():
    source = {'severity': 'critical', 'alert_family': 'api-errors', 'service': 'api',
              'cluster': 'production', 'environment': 'production', 'namespace': 'asteriq-production'}
    target = dict(source, severity='warning')
    assert inhibited(source, target)
    for change in [{'cluster': 'staging'}, {'namespace': 'asteriq-staging'},
                   {'alert_family': 'trade-errors'}, {'severity': 'critical'}]:
        assert not inhibited(source, dict(target, **change))
    assert not inhibited({'severity': 'critical'}, {'severity': 'warning'})
    ingress = dict(source, service='ingress', alert_family='ingress-errors', load_balancer='alb-a')
    assert not inhibited(ingress, dict(ingress, severity='warning', load_balancer='alb-b'))


def test_node_and_crashloop_inhibition_is_resource_scoped():
    node = {'alertname': 'AsteriqNodeUnavailable', 'node': 'node-a', 'cluster': 'prod', 'environment': 'production'}
    pod = dict(node, alertname='AsteriqPodRestartsIncreasing', namespace='asteriq-production', pod='api-1')
    assert inhibited(node, pod)
    assert not inhibited(node, dict(pod, node='node-b'))
    crash = dict(pod, alertname='AsteriqPodCrashLoopBackOff')
    assert inhibited(crash, pod)
    assert not inhibited(crash, dict(pod, pod='api-2'))


@pytest.mark.parametrize('filename,integration,key', [
    ('alertmanager.example.yaml', 'slack_configs', 'slack-webhook'),
    ('alertmanager-teams.example.yaml', 'msteamsv2_configs', 'teams-webhook'),
])
def test_notifications_use_mounted_credentials_and_all_severity_levels(filename, integration, key):
    config = yaml.safe_load((CONFIG.parent / filename).read_text())
    assert config['global']['smtp_require_tls']
    assert 'smtp_auth_password' not in config['global']
    receivers = {receiver['name']: receiver for receiver in config['receivers']}
    for severity in ['critical', 'warning', 'info']:
        assert receivers[severity]['email_configs']
        chat = receivers[severity][integration][0]
        assert 'api_url' not in chat and 'webhook_url' not in chat
        assert chat.get('api_url_file', chat.get('webhook_url_file')).endswith(key)
        assert chat['send_resolved']
    assert config['route']['group_wait'] == '45s'
    null_route = config['route']['routes'][0]
    assert null_route['receiver'] == 'null'
    for helper in ['Watchdog', 'InfoInhibitor']:
        assert matches({'alertname': helper}, null_route['matchers'])
    assert not matches({'alertname': 'AsteriqPodPending'}, null_route['matchers'])
