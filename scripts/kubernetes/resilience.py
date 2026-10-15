"""Render staging-only chaos examples. Never contacts Kubernetes or AWS."""
import argparse
import re
from pathlib import Path
import yaml

EXPERIMENTS = ('api-pod-crash', 'ai-pod-crash', 'redis-outage', 'database-connection-failure', 'high-cpu', 'high-memory', 'network-latency')


def render(name, duration=180, endpoint=None):
    if name not in EXPERIMENTS or not 30 <= duration <= 900:
        raise ValueError('Choose a known experiment and duration between 30 and 900 seconds.')
    namespace = 'asteriq-staging'
    service = 'ai-service' if name == 'ai-pod-crash' else 'api'
    spec = {'mode': 'one', 'selector': {'namespaces': [namespace], 'labelSelectors': {
        'app.kubernetes.io/name': service, 'app.kubernetes.io/part-of': 'asteriq'}}, 'duration': f'{duration}s'}
    kind = 'PodChaos'
    if name in ('api-pod-crash', 'ai-pod-crash'):
        spec.update(action='pod-kill', gracePeriod=0)
    elif name in ('high-cpu', 'high-memory'):
        kind = 'StressChaos'
        spec['containerNames'] = ['api']
        spec['stressors'] = {'cpu': {'workers': 2, 'load': 90}} if name == 'high-cpu' else {'memory': {'workers': 1, 'size': '256MB'}}
    elif name in ('redis-outage', 'database-connection-failure'):
        if not endpoint or not re.fullmatch(r'(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', endpoint):
            raise ValueError('An explicit test dependency hostname or IPv4 address is required, without URL, port, wildcard or credentials.')
        kind = 'NetworkChaos'
        spec.update(action='loss', direction='to', externalTargets=[endpoint], loss={'loss': '100', 'correlation': '0'}, mode='all')
    else:
        kind = 'NetworkChaos'
        spec.update(action='delay', direction='to', delay={'latency': '600ms', 'jitter': '50ms', 'correlation': '0'},
                    target={'mode': 'all', 'selector': {'namespaces': [namespace], 'labelSelectors': {
                        'app.kubernetes.io/name': 'ai-service', 'app.kubernetes.io/part-of': 'asteriq'}}})
    return {'apiVersion': 'chaos-mesh.org/v1alpha1', 'kind': kind,
        'metadata': {'name': 'asteriq-' + name, 'namespace': namespace,
            'labels': {'asteriq.ai/resilience-test': name},
            'annotations': {'asteriq.ai/purpose': 'Manual staging game day; never included in GitOps'}}, 'spec': spec}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('experiment', choices=EXPERIMENTS)
    parser.add_argument('--duration', type=int, default=180)
    parser.add_argument('--endpoint', help='Actual staging Redis/RDS endpoint; metadata only, no credentials.')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        resource = render(args.experiment, args.duration, args.endpoint)
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(yaml.safe_dump(resource, sort_keys=False), encoding='utf-8')
    print(f'Rendered {resource["kind"]} to {args.output}. No cluster calls made.')


if __name__ == '__main__':
    main()
