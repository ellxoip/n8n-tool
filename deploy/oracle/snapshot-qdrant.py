#!/usr/bin/env python3
"""Create and download Qdrant snapshots without copying live storage."""
import json
import urllib.request
from pathlib import Path
root = Path(__file__).resolve().parents[2]
target = root / '.runtime/oracle-migration/qdrant-snapshots'
target.mkdir(parents=True, exist_ok=True)
base = 'http://127.0.0.1:6333'
def request(path, method='GET'):
    with urllib.request.urlopen(urllib.request.Request(base + path, method=method), timeout=120) as response:
        return json.load(response)['result']
manifest = []
for collection in request('/collections')['collections']:
    name = collection['name']
    info = request('/collections/' + name)
    snapshot = request('/collections/' + name + '/snapshots', 'POST')['name']
    with urllib.request.urlopen(base + '/collections/' + name + '/snapshots/' + snapshot, timeout=120) as response:
        (target / snapshot).write_bytes(response.read())
    manifest.append({'collection': name, 'snapshot': snapshot, 'points': info.get('points_count')})
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps(manifest))
