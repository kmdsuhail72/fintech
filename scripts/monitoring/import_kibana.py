"""Import the checked-in dashboards into an explicitly selected Kibana space."""
import argparse
import json
import os
from pathlib import Path
import re
import ssl
import urllib.error
import urllib.request
from uuid import uuid4


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--ca', type=Path, required=True)
    parser.add_argument('--space', default='default')
    args = parser.parse_args()
    if not args.url.startswith('https://') or not re.fullmatch(r'[a-z0-9_-]+', args.space):
        parser.error('Use verified HTTPS and a valid Kibana space ID.')
    key = os.environ.get('KIBANA_IMPORT_API_KEY')
    if not key:
        parser.error('Provide KIBANA_IMPORT_API_KEY through the managed secret mechanism.')
    asset = Path(__file__).resolve().parents[2] / 'k8s/monitoring/elk/kibana/asteriq-dashboards.ndjson'
    boundary = 'asteriq-' + uuid4().hex
    payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="asteriq-dashboards.ndjson"\r\n'
               'Content-Type: application/ndjson\r\n\r\n').encode() + asset.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    prefix = '' if args.space == 'default' else '/s/' + args.space
    request = urllib.request.Request(args.url.rstrip('/') + prefix + '/api/saved_objects/_import?overwrite=true',
        data=payload, headers={'Authorization': 'ApiKey ' + key, 'kbn-xsrf': 'asteriq-import',
                              'Content-Type': 'multipart/form-data; boundary=' + boundary})
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(args.ca))), NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            result = json.load(response)
            if not result.get('success'):
                raise RuntimeError('Kibana reported saved-object import errors; inspect the target space.')
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Kibana import failed: HTTP {error.code}') from None
    print('Kibana dashboard assets imported into space ' + args.space)


if __name__ == '__main__':
    main()
