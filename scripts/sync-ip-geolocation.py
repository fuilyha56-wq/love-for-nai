"""Download the official offline databases at one immutable upstream revision.
Runtime queries use local files; no user IPs are sent to this download source.
"""
import hashlib
import json
import pathlib
import urllib.request
from datetime import datetime, timezone

target = pathlib.Path(__file__).resolve().parents[1] / 'resources' / 'ip-geolocation'
target.mkdir(parents=True, exist_ok=True)
headers = {'User-Agent': 'LFN-offline-ip-database'}
def download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        return response.read()

metadata = json.loads(download('https://api.github.com/repos/lionsoul2014/ip2region/commits/master'))
revision = metadata['sha']
base = f'https://raw.githubusercontent.com/lionsoul2014/ip2region/{revision}'
files = {}
for name in ['ip2region_v4.xdb', 'ip2region_v6.xdb']:
    content = download(f'{base}/data/{name}')
    if len(content) < 524544 or content[:1] == b'<':
        raise RuntimeError(f'Invalid offline database: {name}')
    (target / name).write_bytes(content)
    files[name] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
    print(f'Downloaded {name}: {len(content)/1048576:.1f} MiB', flush=True)
(target / 'LICENSE.md').write_bytes(download(f'{base}/LICENSE.md'))
manifest = {'provider': 'ip2region', 'revision': revision, 'source': 'https://github.com/lionsoul2014/ip2region', 'sourceUpdatedAt': metadata['commit']['committer']['date'], 'downloadedAt': datetime.now(timezone.utc).isoformat(), 'files': files}
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('DATABASE_REVISION=' + revision)
