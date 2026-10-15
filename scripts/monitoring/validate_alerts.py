"""Check rules/configuration and dry-run routing; never sends notifications."""
import argparse
from pathlib import Path
import subprocess
from uuid import uuid4
import yaml

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--promtool', required=True, type=Path)
    parser.add_argument('--amtool', required=True, type=Path)
    args = parser.parse_args()
    work = ROOT / '.runtime' / ('alert-validation-' + uuid4().hex)
    work.mkdir(parents=True)
    exported = []
    for name in ['asteriq-alerts', 'rules', 'dashboard-alerts', 'slo-rules']:
        resource = yaml.safe_load((ROOT / f'k8s/monitoring/prometheus/{name}.yaml').read_text())
        path = work / (name + '.rules.yaml')
        path.write_text(yaml.safe_dump({'groups': resource['spec']['groups']}, sort_keys=False))
        exported.append(str(path))
    tests = ROOT / 'k8s/monitoring/alertmanager/rule-tests.yaml'
    (work / 'rule-tests.yaml').write_text(tests.read_text())
    subprocess.run([str(args.promtool.resolve()), 'check', 'rules', *exported], check=True)
    subprocess.run([str(args.promtool.resolve()), 'test', 'rules', str(work / 'rule-tests.yaml')], check=True)
    for file in ['alertmanager.example.yaml', 'alertmanager-teams.example.yaml']:
        config = ROOT / 'k8s/monitoring/alertmanager' / file
        subprocess.run([str(args.amtool.resolve()), 'check-config', str(config)], check=True)
        for severity in ['critical', 'warning', 'info']:
            subprocess.run([str(args.amtool.resolve()), 'config', 'routes', 'test',
                '--config.file=' + str(config), '--verify.receivers=' + severity,
                'severity=' + severity, 'alertname=AsteriqAPI5xxCritical', 'service=api',
                'cluster=test', 'environment=production', 'namespace=asteriq-production'], check=True)
        for helper in ['Watchdog', 'InfoInhibitor']:
            subprocess.run([str(args.amtool.resolve()), 'config', 'routes', 'test',
                '--config.file=' + str(config), '--verify.receivers=null',
                'alertname=' + helper, 'severity=info'], check=True)
    print('Alert expressions, firing cases and Slack/Teams receiver routing validated without delivery.')


if __name__ == '__main__':
    main()
