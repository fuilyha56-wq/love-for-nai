"""Activate the approved NAI release after deploy-paramiko.py --prepare-only.

Coordinates the existing Gateway source mount, NewAPI, and LFN image with
private backups, a brief image-endpoint maintenance gate, and rollback.
"""
import hashlib
import importlib.util
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-release-20261022'
IMAGE = 'love-for-nai:nai-official-20261022-r1'
spec = importlib.util.spec_from_file_location('lfn_deploy', ROOT / 'scripts/deploy-paramiko.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def ensure_directory(sftp, name):
    import stat
    try:
        sftp.mkdir(name, 0o700)
    except OSError:
        if not stat.S_ISDIR(sftp.lstat(name).st_mode):
            raise RuntimeError('Release backup path is not a directory')


def read(sftp, name):
    with sftp.open(name, 'rb') as source:
        return source.read()


def write(sftp, name, data, mode=0o600, atomic=True):
    target = name + '.nai-release-tmp' if atomic else name
    with sftp.open(target, 'wb') as destination:
        destination.write(data)
        destination.flush()
    sftp.chmod(target, mode)
    if atomic:
        sftp.posix_rename(target, name)


def api(action, backup=None):
    arguments = [sys.executable, str(ROOT / 'scripts/apply-nai-pricing.py'), action]
    if backup:
        arguments.append(backup)
    subprocess.run(arguments, check=True, cwd=ROOT)
    key = 'rollback' if action == '--rollback' else 'apply'
    return json.loads((DIRECTORY / ('newapi-' + key + '-result.json')).read_text(encoding='utf-8'))


def main():
    inventory = json.loads((DIRECTORY / 'inventory.json').read_text(encoding='utf-8'))
    expected_policy = json.loads((ROOT / 'docs/nai-pricing-live-snapshot-2026-10-22.json').read_text(encoding='utf-8'))['dailyPolicy']
    client = deploy.connect()
    sftp = client.open_sftp()
    gateway_changed = lfn_changed = maintenance = False
    api_backup = None
    stamp = time.strftime('%Y%m%d%H%M%S')
    state = {'image': IMAGE, 'approved': True, 'applied': False, 'startedAt': stamp}
    state_file = DIRECTORY / 'activation-result.json'

    def save():
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def run(command, timeout=120):
        return deploy.run_remote(client, command, quiet=True, timeout=timeout)

    def nginx_reload():
        run('docker exec lfn-edge nginx -t', 20)
        run('docker exec lfn-edge nginx -s reload', 20)

    def policy():
        js = "const fs=require('fs'),path=require('path');console.log(fs.readFileSync(path.resolve(process.env.LFN_DATA_DIR||'data','daily-billing/policy.json'),'utf8'));"
        return json.loads(run('docker exec love-for-nai node -e ' + shlex.quote(js), 30))

    try:
        current = json.loads(run('docker inspect love-for-nai novelai-gateway lfn-edge'))
        for item in current:
            name = item['Name'].lstrip('/')
            if item['Id'] != inventory[name]['containerId']:
                raise RuntimeError('The live ' + name + ' container changed since preparation')
        run('docker image inspect ' + shlex.quote(IMAGE) + ' --format ' + shlex.quote('{{.Id}}'))
        if policy() != expected_policy:
            raise RuntimeError('Daily price tiers changed since user review')

        lfn_root = inventory['love-for-nai']['composeDir']
        gateway_root = inventory['novelai-gateway']['composeDir']
        for name in (lfn_root, gateway_root):
            if not name.startswith('/') or '..' in name.split('/') or '\n' in name:
                raise RuntimeError('Invalid existing deployment directory')
        compose = inventory['love-for-nai']['composeFiles']
        edge = next(x['source'] for x in inventory['lfn-edge']['mounts'] if x['destination'] == '/etc/nginx/conf.d/default.conf')
        gateway_src = next(x['source'] for x in inventory['novelai-gateway']['mounts'] if x['destination'] == '/app/src')
        service = inventory['love-for-nai']['service']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', service):
            raise RuntimeError('Invalid existing compose service')
        up = 'cd ' + shlex.quote(lfn_root) + ' && docker compose -f ' + shlex.quote(compose) + ' up -d --no-build --pull never ' + shlex.quote(service)
        original_compose = read(sftp, compose)
        updated_compose, count = re.subn(rb'(?m)^(\s*image:\s*)(?:love-for-nai:[^\r\n]+|\$\{LFN_IMAGE[^\r\n]+)', lambda match: match[1] + IMAGE.encode(), original_compose)
        if count != 1:
            raise RuntimeError('Expected exactly one existing LFN image reference')
        original_edge = read(sftp, edge)
        gate = b'\n    # NAI approved pricing release maintenance\n    if ($uri ~ "^/(api/images/(generate|operate)(/|$)|v1/images/(generations|edits)(/|$)|ai/(generate-image|generate-image-stream|upscale|augment-image|encode-vibe)(/|$))") { return 503; }\n'
        gated_edge, count = re.subn(rb'\bserver\s*\{', lambda match: match[0] + gate, original_edge)
        if count < 1:
            raise RuntimeError('Cannot locate the current edge server block')
        edge_mode = sftp.stat(edge).st_mode & 0o777
        compose_mode = sftp.stat(compose).st_mode & 0o777

        backup_root = lfn_root + '/.release-backups'
        ensure_directory(sftp, backup_root)
        backup_dir = backup_root + '/nai-official-20261022-r1-' + stamp
        ensure_directory(sftp, backup_dir)
        write(sftp, backup_dir + '/compose.prod.yml', original_compose)
        write(sftp, backup_dir + '/nginx-lfn.conf', original_edge)
        write(sftp, backup_dir + '/daily-policy.json', (json.dumps(expected_policy, ensure_ascii=False) + '\n').encode())
        files = []
        for name in ('openai.py', 'app.py'):
            target = gateway_src + '/proxy/' + name
            original = read(sftp, target)
            captured = (DIRECTORY / ('gateway-live-' + name)).read_text(encoding='utf-8')
            if original.decode('utf-8').strip() != captured.strip():
                raise RuntimeError('Gateway source changed since review: ' + name)
            updated = (Path('E:/novelai-gateway/src/proxy') / name).read_bytes()
            compile(updated, name, 'exec')
            mode = sftp.stat(target).st_mode & 0o777
            write(sftp, backup_dir + '/gateway-' + name, original)
            staged = target + '.nai-official-stage'
            write(sftp, staged, updated, mode)
            if digest(read(sftp, staged)) != digest(updated):
                raise RuntimeError('Staged Gateway source checksum mismatch')
            files.append({'name': name, 'target': target, 'staged': staged, 'before': original, 'after': updated, 'mode': mode})
        state.update({'backupDirectory': backup_dir, 'previousLfnImage': inventory['love-for-nai']['image'], 'gatewayFiles': [{'name': x['name'], 'beforeSha256': digest(x['before']), 'afterSha256': digest(x['after'])} for x in files]})
        save()
        print('Backups and staged Gateway source verified; briefly pausing new image requests.', flush=True)
        if read(sftp, edge) != original_edge:
            raise RuntimeError('Edge configuration changed during preparation')
        maintenance = True
        # The edge mounts a single file: preserve its inode so the running
        # container sees the update; nginx reloads only after complete writes.
        write(sftp, edge, gated_edge, edge_mode, atomic=False)
        nginx_reload()
        probe = "import json,urllib.request;from src.proxy.config import settings;r=urllib.request.Request('http://127.0.0.1:'+str(settings.port)+'/admin/api/accounts',headers={'Authorization':'Bearer '+settings.gateway_password});p=json.load(urllib.request.urlopen(r,timeout=10));print(sum(bool(x.get('busy')) for x in p.get('accounts',[])))"
        quiet = 0
        for _ in range(30):
            busy = int(run('docker exec novelai-gateway python -c ' + shlex.quote(probe), 30))
            quiet = quiet + 1 if busy == 0 else 0
            if quiet >= 2:
                break
            time.sleep(2)
        else:
            raise RuntimeError('Gateway did not drain before release')

        gateway_changed = True
        for item in files:
            if read(sftp, item['target']) != item['before']:
                raise RuntimeError('Gateway source changed before activation')
            sftp.posix_rename(item['staged'], item['target'])
        print('Activating the official Gateway formulas and canvas limits...', flush=True)
        run('docker restart --timeout 120 novelai-gateway', 180)
        for _ in range(20):
            try:
                run('docker exec novelai-gateway python -c ' + shlex.quote(probe), 20)
                break
            except RuntimeError:
                time.sleep(2)
        else:
            raise RuntimeError('Gateway did not become ready')

        print('Applying the two approved NewAPI Medium expressions...', flush=True)
        result = api('--apply')
        api_backup = result.get('backupName')
        state['newApiBackupName'] = api_backup
        save()
        if policy() != expected_policy:
            raise RuntimeError('Daily policy changed before LFN activation')
        if read(sftp, compose) != original_compose:
            raise RuntimeError('Compose configuration changed before activation')
        lfn_changed = True
        write(sftp, compose, updated_compose, compose_mode)
        print('Activating the prepared LFN image...', flush=True)
        run(up, 180)
        for _ in range(30):
            try:
                if deploy.health(client, IMAGE):
                    break
            except Exception:
                pass
            time.sleep(2)
        else:
            raise RuntimeError('LFN internal / edge admission health did not pass')
        if policy() != expected_policy:
            raise RuntimeError('Daily tiers were not preserved')
        for item in files:
            if digest(read(sftp, item['target'])) != digest(item['after']):
                raise RuntimeError('Activated Gateway source checksum mismatch')
        run('curl --fail --silent --max-time 15 http://127.0.0.1:41800/studio -o /dev/null')
        if read(sftp, edge) != gated_edge:
            raise RuntimeError('Edge changed while image maintenance was active')
        write(sftp, edge, original_edge, edge_mode, atomic=False)
        nginx_reload()
        maintenance = False
        if not deploy.health(client, IMAGE):
            raise RuntimeError('Post-maintenance health did not pass')
        state.update({'applied': True, 'dailyTiersPreserved': True, 'maintenanceRemoved': True, 'completedAt': time.strftime('%Y%m%d%H%M%S')})
        save()
        print(json.dumps(state, ensure_ascii=True, indent=2), flush=True)
    except Exception as error:
        failures = []
        print('Activation failed; restoring the previous release: ' + str(error), flush=True)
        if lfn_changed:
            try:
                write(sftp, compose, original_compose, compose_mode)
                run(up, 180)
            except Exception as problem:
                failures.append('LFN: ' + str(problem))
        if api_backup:
            try:
                api('--rollback', api_backup)
            except Exception as problem:
                failures.append('NewAPI: ' + str(problem))
        if gateway_changed:
            try:
                for item in files:
                    write(sftp, item['target'], item['before'], item['mode'])
                run('docker restart --timeout 120 novelai-gateway', 180)
            except Exception as problem:
                failures.append('Gateway: ' + str(problem))
        if maintenance:
            try:
                write(sftp, edge, original_edge, edge_mode, atomic=False)
                nginx_reload()
            except Exception as problem:
                failures.append('Edge: ' + str(problem))
        state.update({'applied': False, 'rolledBack': not failures, 'error': str(error), 'rollbackErrors': failures})
        save()
        raise
    finally:
        sftp.close()
        client.close()


if __name__ == '__main__':
    main()
