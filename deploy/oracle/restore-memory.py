import json
import urllib.request
from pathlib import Path

base = 'http://127.0.0.1:6333'
folder = Path('/backup/qdrant-snapshots')
for item in json.loads((folder / 'manifest.json').read_text()):
    snapshot = folder / item['snapshot']
    boundary = 'oracle-n8n-snapshot-upload'
    payload = ('--' + boundary + '\r\nContent-Disposition: form-data; name="snapshot"; filename="' + snapshot.name + '"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() + snapshot.read_bytes() + ('\r\n--' + boundary + '--\r\n').encode()
    req = urllib.request.Request(base + '/collections/' + item['collection'] + '/snapshots/upload?priority=snapshot', data=payload, method='POST', headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(req, timeout=180) as response:
        assert json.load(response)['status'] == 'ok'
    print(json.dumps({'collection': item['collection'], 'restored': True, 'expectedPoints': item['points']}))
