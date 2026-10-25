"""Capture a read-only deployment and pricing baseline for the mode fixes."""
import importlib.util
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-operations-20261023'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    deploy = load('deploy_modes_snapshot', ROOT / 'scripts/deploy-paramiko.py')
    pricing = load('pricing_modes_snapshot', ROOT / 'scripts/snapshot-nai-pricing-readonly.py')
    client = deploy.connect()
    sftp = client.open_sftp()
    try:
        data = json.loads(deploy.run_remote(client, 'docker inspect love-for-nai novelai-gateway lfn-edge', quiet=True))
        inventory = {}
        for item in data:
            labels = item['Config'].get('Labels') or {}
            inventory[item['Name'].lstrip('/')] = {
                'containerId': item['Id'], 'image': item['Config']['Image'], 'imageId': item['Image'],
                'startedAt': item['State']['StartedAt'],
                'composeDir': labels.get('com.docker.compose.project.working_dir'),
                'composeFiles': labels.get('com.docker.compose.project.config_files'),
                'service': labels.get('com.docker.compose.service'),
                'mounts': [{'source': x['Source'], 'destination': x['Destination'], 'rw': x['RW']} for x in item['Mounts']],
            }
        DIRECTORY.mkdir(parents=True, exist_ok=True)
        def save(name, value):
            (DIRECTORY / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        save('inventory.json', inventory)
        result = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(pricing.REMOTE), quiet=True, timeout=90))
        save('pricing-before.json', result)
        gateway = next(x['source'] for x in inventory['novelai-gateway']['mounts'] if x['destination'] == '/app/src')
        for name in ('openai.py', 'app.py'):
            with sftp.open(gateway + '/proxy/' + name, 'rb') as source:
                (DIRECTORY / ('gateway-live-' + name)).write_bytes(source.read())
        print(json.dumps({'image': inventory['love-for-nai']['image'], 'startedAt': inventory['love-for-nai']['startedAt'], 'modeExpressions': result['options']['billing_setting.billing_expr'], 'dailyPolicy': result['dailyPolicy']}, ensure_ascii=False, indent=2))
    finally:
        sftp.close()
        client.close()


if __name__ == '__main__':
    main()
