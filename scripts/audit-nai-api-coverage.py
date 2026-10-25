"""Read-only API billing audit; credentials stay inside the deployed container."""
import importlib.util
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-api-coverage-20261024'
REMOTE = r'''
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.LFN_DATA_DIR||'data');
const config=JSON.parse(fs.readFileSync(path.join(root,'platform/config.json'),'utf8'));
console.log(JSON.stringify({modelBilling:Object.fromEntries(Object.entries(config.modelBilling||{}).filter(([model])=>/^nai-/.test(model)))}));
'''

if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('deploy_api_audit', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    client = deploy.connect()
    try:
        result = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(REMOTE), quiet=True))
        DIRECTORY.mkdir(parents=True, exist_ok=True)
        (DIRECTORY / 'runtime-billing.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result, indent=2))
    finally:
        client.close()
