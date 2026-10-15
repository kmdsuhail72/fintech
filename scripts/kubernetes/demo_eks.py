"""Render the EKS demo locally. Never applies resources or calls AWS APIs."""
import argparse
from pathlib import Path
import subprocess
import yaml

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.runtime/eks-demo.yaml')
    args = parser.parse_args()
    command = ['helm', 'template', 'asteriq-demo', str(ROOT / 'helm/asteriq-platform'),
               '--namespace', 'asteriq-production',
               '-f', str(ROOT / 'helm/asteriq-platform/values-production.yaml'),
               '-f', str(ROOT / 'infrastructure/eks/demo/application-values.yaml')]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    docs = [doc for doc in yaml.safe_load_all(result.stdout) if doc]
    deployments = {doc['metadata']['name']: doc for doc in docs if doc['kind'] == 'Deployment'}
    if set(deployments) != {'frontend', 'api', 'ai-service'}:
        raise RuntimeError('Expected exactly three Asteriq deployments.')
    for deployment in deployments.values():
        image = deployment['spec']['template']['spec']['containers'][0]['image']
        if not image.endswith('@sha256:' + '0' * 64):
            raise RuntimeError('Demo must retain intentionally nondeployable image digests.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('# DEMO ONLY: fake AWS identifiers and zero image digests. DO NOT APPLY.\n' + result.stdout,
                           encoding='utf-8')
    print(f'Rendered {len(docs)} demo resources to {args.output}. No deployment performed.')


if __name__ == '__main__':
    main()
