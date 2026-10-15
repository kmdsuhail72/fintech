"""Apply reviewed index policies/templates and scoped roles over verified HTTPS."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import ssl
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2] / 'k8s/monitoring/elk/elasticsearch'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--ca', type=Path, required=True)
    parser.add_argument('--environment', choices=['dev', 'staging', 'production'], required=True)
    args = parser.parse_args()
    if not args.url.startswith('https://'):
        parser.error('Use verified HTTPS for Elasticsearch.')
    key = os.environ.get('ELASTIC_BOOTSTRAP_API_KEY')
    if not key:
        parser.error('Provide ELASTIC_BOOTSTRAP_API_KEY through the managed secret mechanism.')
    trust = ssl.create_default_context(cafile=str(args.ca))
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=trust), NoRedirect())

    def put(path, body):
        request = urllib.request.Request(args.url.rstrip('/') + path,
            data=json.dumps(body).encode(), method='PUT',
            headers={'Authorization': 'ApiKey ' + key, 'Content-Type': 'application/json'})
        try:
            with opener.open(request, timeout=30) as response:
                result = json.load(response)
                if result.get('acknowledged') is False:
                    raise RuntimeError('Elasticsearch did not acknowledge ' + path)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Elasticsearch request failed: HTTP {error.code} for {path}') from None

    for category in ['application', 'security', 'trading', 'ai']:
        put('/_ilm/policy/asteriq-' + category, json.loads((ROOT / (category + '-ilm.json')).read_text()))
        template = json.loads((ROOT / (category + '-template.json')).read_text())
        template['index_patterns'] = [f'asteriq-{args.environment}-{category}-*']
        put('/_index_template/asteriq-' + args.environment + '-' + category, template)
    for name in ['log-writer', 'log-reader', 'security-reader']:
        role = json.loads((ROOT / (name + '-role.json')).read_text())
        for indices in role['indices']:
            indices['names'] = [pattern.replace('asteriq-*-', 'asteriq-' + args.environment + '-')
                                for pattern in indices['names']]
        put('/_security/role/asteriq-' + args.environment + '-' + name, role)
    date = datetime.now(timezone.utc).strftime('%Y.%m.%d')
    for category in ['application', 'security', 'trading', 'ai']:
        path = f'/asteriq-{args.environment}-{category}-{date}'
        request = urllib.request.Request(args.url.rstrip('/') + path, method='HEAD',
            headers={'Authorization': 'ApiKey ' + key})
        try:
            with opener.open(request, timeout=30):
                pass
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise RuntimeError(f'Index inspection failed: HTTP {error.code}') from None
            put(path, {})
    print('Index policies, environment templates, scoped roles and four daily indexes applied.')


if __name__ == '__main__':
    main()
