"""Exercise real Kyverno CEL evaluation; no cluster or registry is contacted."""
import copy
import os
from pathlib import Path
import re
import subprocess
import yaml
import pytest

ROOT = Path(__file__).resolve().parents[3]
SECURITY = ROOT / 'k8s/security'
CLI = os.environ.get('KYVERNO_BIN', 'kyverno')


def evaluate(policy, resource, expected, tmp_path):
    path = tmp_path / 'resource.yaml'
    path.write_text(yaml.safe_dump(resource, sort_keys=False), encoding='utf-8')
    result = subprocess.run([CLI, 'apply', str(SECURITY / 'kyverno' / policy),
        '-r', str(path), '--remove-color'], capture_output=True, text=True)
    output = result.stdout + result.stderr
    assert re.search(r'error: 0', output), output
    if expected:
        assert result.returncode == 0 and re.search(r'pass: [1-9]', output), output
    else:
        assert result.returncode == 1 and re.search(r'fail: [1-9]', output), output


def pod():
    return yaml.safe_load((SECURITY / 'tests/compliant-pod.yaml').read_text(encoding='utf-8'))


@pytest.mark.parametrize('case', [
    'valid', 'privileged', 'root', 'root-override', 'nonroot-false', 'host-network',
    'host-pid', 'host-ipc', 'host-root', 'docker-socket', 'writable-root',
    'escalation', 'capabilities', 'unconfined', 'default-account', 'token',
    'missing-memory-limit', 'zero-cpu', 'init-privileged', 'ephemeral-root',
    'valid-init', 'valid-ephemeral',
])
def test_pod_hardening(case, tmp_path):
    resource = pod()
    spec = resource['spec']
    container = spec['containers'][0]
    context = container['securityContext']
    if case == 'privileged': context['privileged'] = True
    if case == 'root': spec['securityContext']['runAsUser'] = 0
    if case == 'root-override': context['runAsUser'] = 0
    if case == 'nonroot-false': context['runAsNonRoot'] = False
    if case == 'host-network': spec['hostNetwork'] = True
    if case == 'host-pid': spec['hostPID'] = True
    if case == 'host-ipc': spec['hostIPC'] = True
    if case in ['host-root', 'docker-socket']:
        spec['volumes'] = [{'name': 'host', 'hostPath': {'path': '/' if case == 'host-root' else '/var/run/docker.sock'}}]
    if case == 'writable-root': context['readOnlyRootFilesystem'] = False
    if case == 'escalation': context['allowPrivilegeEscalation'] = True
    if case == 'capabilities': context['capabilities']['add'] = ['NET_ADMIN']
    if case == 'unconfined': context['seccompProfile'] = {'type': 'Unconfined'}
    if case == 'default-account': spec['serviceAccountName'] = 'default'
    if case == 'token': spec['automountServiceAccountToken'] = True
    if case == 'missing-memory-limit': del container['resources']['limits']['memory']
    if case == 'zero-cpu': container['resources']['requests']['cpu'] = '0.0'
    if case in ['valid-init', 'init-privileged']:
        init = copy.deepcopy(container)
        init['name'] = 'init'
        init['securityContext']['privileged'] = case == 'init-privileged'
        spec['initContainers'] = [init]
    if case in ['valid-ephemeral', 'ephemeral-root']:
        ephemeral = copy.deepcopy(container)
        ephemeral['name'] = 'debug'
        del ephemeral['resources']
        if case == 'ephemeral-root': ephemeral['securityContext']['runAsUser'] = 0
        spec['ephemeralContainers'] = [ephemeral]
    evaluate('pod-hardening.yaml', resource, case.startswith('valid'), tmp_path)


@pytest.mark.parametrize('kind', ['Deployment', 'Job', 'CronJob'])
@pytest.mark.parametrize('allowed', [True, False])
def test_controller_templates(kind, allowed, tmp_path):
    source = pod()
    if not allowed: source['spec']['containers'][0]['securityContext']['privileged'] = True
    template = {'metadata': {'labels': {'app': 'api'}}, 'spec': source['spec']}
    resource = {'apiVersion': 'apps/v1' if kind == 'Deployment' else 'batch/v1',
        'kind': kind, 'metadata': source['metadata'], 'spec': {'template': template}}
    if kind == 'Deployment':
        resource['spec']['selector'] = {'matchLabels': {'app': 'api'}}
    else:
        template['spec']['restartPolicy'] = 'Never'
    if kind == 'CronJob':
        resource['spec'] = {'schedule': '0 * * * *', 'jobTemplate': {'spec': {'template': template}}}
    evaluate('pod-hardening.yaml', resource, allowed, tmp_path)


@pytest.mark.parametrize('case', ['valid', 'tag', 'foreign-registry', 'zero-digest', 'init-tag'])
def test_production_image_identity(case, tmp_path):
    resource = pod()
    container = resource['spec']['containers'][0]
    if case == 'tag': container['image'] = container['image'].split('@')[0] + ':latest'
    if case == 'foreign-registry': container['image'] = 'docker.io/example/api@sha256:' + 'a' * 64
    if case == 'zero-digest': container['image'] = container['image'].split('@')[0] + '@sha256:' + '0' * 64
    if case == 'init-tag': resource['spec']['initContainers'] = [dict(copy.deepcopy(container), name='init', image='busybox:latest')]
    evaluate('images.yaml', resource, case == 'valid', tmp_path)


@pytest.mark.parametrize('case', ['valid', 'no-certificate', 'http-only', 'extra-http-port'])
def test_tls_ingress(case, tmp_path):
    annotations = {'alb.ingress.kubernetes.io/certificate-arn': 'arn:aws:acm:ap-south-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                   'alb.ingress.kubernetes.io/listen-ports': '[{"HTTPS":443}]'}
    resource = {'apiVersion': 'networking.k8s.io/v1', 'kind': 'Ingress',
        'metadata': {'name': 'asteriq', 'namespace': 'asteriq-production', 'annotations': annotations},
        'spec': {'ingressClassName': 'alb'}}
    if case == 'no-certificate': del annotations['alb.ingress.kubernetes.io/certificate-arn']
    if case == 'http-only': annotations['alb.ingress.kubernetes.io/listen-ports'] = '[{"HTTP":80}]'
    if case == 'extra-http-port': annotations['alb.ingress.kubernetes.io/listen-ports'] = '[{"HTTPS":443},{"HTTP":8080}]'
    evaluate('ingress-and-services.yaml', resource, case == 'valid', tmp_path)


def test_support_role_does_not_grant_secrets_exec_or_writes():
    docs = list(yaml.safe_load_all((SECURITY / 'rbac/resources.yaml').read_text(encoding='utf-8')))
    role = next(doc for doc in docs if doc['kind'] == 'Role')
    for rule in role['rules']:
        assert set(rule['verbs']) <= {'get', 'list', 'watch'}
        assert not set(rule['resources']) & {'secrets', 'pods/exec', 'pods/attach', 'serviceaccounts/token', '*'}


@pytest.mark.parametrize('case', ['valid', 'nodeport', 'loadbalancer', 'external-ip'])
def test_private_services(case, tmp_path):
    resource = {'apiVersion': 'v1', 'kind': 'Service',
        'metadata': {'name': 'api', 'namespace': 'asteriq-production'},
        'spec': {'type': 'ClusterIP', 'ports': [{'port': 3000}]}}
    if case == 'nodeport': resource['spec']['type'] = 'NodePort'
    if case == 'loadbalancer': resource['spec']['type'] = 'LoadBalancer'
    if case == 'external-ip': resource['spec']['externalIPs'] = ['203.0.113.1']
    evaluate('ingress-and-services.yaml', resource, case == 'valid', tmp_path)


@pytest.mark.parametrize('allowed', [True, False])
def test_namespace_cannot_remove_restricted_security(allowed, tmp_path):
    resource = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {
        'name': 'asteriq-production', 'labels': {
            'pod-security.kubernetes.io/enforce': 'restricted' if allowed else 'privileged',
            'pod-security.kubernetes.io/audit': 'restricted',
            'pod-security.kubernetes.io/warn': 'restricted'}}}
    evaluate('namespaces.yaml', resource, allowed, tmp_path)


def test_rendered_helm_deployments_satisfy_hardening(tmp_path):
    result = subprocess.run(['helm', 'template', 'security-review', str(ROOT / 'helm/asteriq-platform'),
        '--namespace', 'asteriq-production', '-f', str(ROOT / 'helm/asteriq-platform/values-production.yaml'),
        '-f', str(ROOT / 'infrastructure/eks/demo/application-values.yaml')],
        capture_output=True, text=True, check=True)
    docs = [doc for doc in yaml.safe_load_all(result.stdout) if doc]
    deployments = [doc for doc in docs if doc['kind'] == 'Deployment']
    assert len(deployments) == 3
    for doc in deployments:
        # Helm assigns release namespace during install when metadata omits it.
        doc['metadata'].setdefault('namespace', 'asteriq-production')
        evaluate('pod-hardening.yaml', doc, True, tmp_path)
    config = next(doc for doc in docs if doc['kind'] == 'ConfigMap' and doc['metadata']['name'] == 'api-config')
    assert 'DEV_AUTH_TOKEN_OUTPUT' not in config['data']
    api = next(doc for doc in deployments if doc['metadata']['name'] == 'api')
    env = api['spec']['template']['spec']['containers'][0]['env']
    assert next(item['value'] for item in env if item['name'] == 'DEV_AUTH_TOKEN_OUTPUT') == 'false'
