#!/usr/bin/env python3
"""Deploy a locally built LFN image through credentials in the project's .rsh.py.
Keeps the previous compose/image and automatically rolls back failed health checks.
Usage: python scripts/deploy-paramiko.py <image-tag> [--trusted-edge]
"""
import gzip
import ast
import hashlib
import json
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_ssh_config():
    # Read literals only: loading credentials must never execute a legacy script.
    tree = ast.parse((ROOT / '.rsh.py').read_text(encoding='utf-8-sig'))
    values = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            for target in statement.targets:
                if isinstance(target, ast.Name) and target.id in {'HOST', 'PORT', 'USER', 'PASS'}:
                    values[target.id] = ast.literal_eval(statement.value)
    return values['HOST'], int(values.get('PORT', 22)), values['USER'], values['PASS']


def connect():
    import paramiko
    host, port, username, password = load_ssh_config()
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    known_hosts = ROOT / 'scripts' / '.tmp' / 'known_hosts'
    known_hosts.parent.mkdir(exist_ok=True)
    known_hosts.touch(exist_ok=True)
    client.load_host_keys(str(known_hosts))
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=username, password=password, timeout=30,
                   banner_timeout=90, auth_timeout=30, allow_agent=False, look_for_keys=False)
    client.get_transport().set_keepalive(15)
    return client


def run_remote(client, command, timeout=600, quiet=False):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    status = stdout.channel.recv_exit_status()
    if not quiet and out.strip():
        print(out.strip(), flush=True)
    if status:
        raise RuntimeError(f'Remote operation failed ({status}): {err[-1500:]}')
    return out.strip()


def health(client, image):
    command = "docker inspect -f '{{.Config.Image}}' love-for-nai"
    if run_remote(client, command, quiet=True) != image:
        return False
    for url in ['http://127.0.0.1:41801/api/health', 'http://127.0.0.1:41800/api/health']:
        raw = run_remote(client, f'curl --fail --silent --max-time 8 {shlex.quote(url)}', quiet=True)
        if json.loads(raw).get('status') != 'ok':
            return False
    return True


def sync_trusted_proxy_runtime(client, tag):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}', tag):
        raise ValueError('Invalid release tag')
    script = r'''
const fs=require("fs"),path=require("path");
const file=path.resolve(process.env.LFN_DATA_DIR||"data","platform/config.json");
if(!fs.existsSync(file)){console.log(JSON.stringify({changed:false,source:"environment"}));process.exit(0)}
const current=JSON.parse(fs.readFileSync(file,"utf8"));
if(current.settings?.trustProxy===true){console.log(JSON.stringify({changed:false}));process.exit(0)}
const backup=file+".bak-"+RELEASE_TAG;
fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
current.settings={...current.settings,trustProxy:true};
const temporary=file+".trusted-proxy.tmp";
fs.writeFileSync(temporary,JSON.stringify(current,null,2),{mode:0o600});
fs.renameSync(temporary,file);
console.log(JSON.stringify({changed:true,backupCreated:true}));
'''.replace('RELEASE_TAG', json.dumps(tag))
    return json.loads(run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(script), quiet=True))


def main():
    if len(sys.argv) not in (2, 3) or not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}', sys.argv[1]) or (len(sys.argv) == 3 and sys.argv[2] != '--trusted-edge'):
        raise SystemExit('Usage: deploy-paramiko.py <lowercase-image-tag> [--trusted-edge]')
    trusted_edge = '--trusted-edge' in sys.argv
    tag = sys.argv[1]
    image = f'love-for-nai:{tag}'
    temporary = ROOT / 'scripts' / '.tmp'
    temporary.mkdir(exist_ok=True)
    archive = temporary / f'love-for-nai-{tag}.tar'
    compressed = archive.with_suffix('.tar.gz')
    print(f'Exporting locally built image {image}', flush=True)
    subprocess.run(['docker', 'image', 'inspect', image], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'save', '-o', str(archive), image], check=True)
    with archive.open('rb') as source, gzip.open(compressed, 'wb', compresslevel=3) as destination:
        shutil.copyfileobj(source, destination, 1024 * 1024)
    archive.unlink()
    with compressed.open('rb') as source:
        checksum = hashlib.file_digest(source, 'sha256').hexdigest()
    print(f'Archive: {compressed.stat().st_size / 1048576:.1f} MiB', flush=True)
    client = connect()
    transport = client.get_transport()
    if transport is not None:
        transport.set_keepalive(15)
    remote_archive = None
    compose = backup = None
    previous = None
    switched = False
    loaded = False
    try:
        service = run_remote(client, "docker inspect -f '{{index .Config.Labels \"com.docker.compose.service\"}}' love-for-nai", quiet=True)
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', service):
            raise RuntimeError('Cannot identify the existing LFN compose service')
        previous = run_remote(client, "docker inspect -f '{{.Config.Image}}' love-for-nai", quiet=True)
        container = json.loads(run_remote(client, 'docker inspect love-for-nai', quiet=True))[0]
        environment = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
        if trusted_edge or environment.get('LFN_TRUST_PROXY') == 'true':
            bindings = container['HostConfig'].get('PortBindings') or {}
            if any(binding.get('HostIp') not in ('127.0.0.1', '::1') for values in bindings.values() for binding in (values or [])):
                raise RuntimeError('Trusted proxy mode requires the application port to be loopback-only')
            edge_config = run_remote(client, 'docker exec lfn-edge nginx -T 2>/dev/null', quiet=True)
            if 'proxy_set_header X-Real-IP $remote_addr;' not in edge_config:
                raise RuntimeError('The edge must overwrite X-Real-IP')
        deploy_dir = run_remote(client, "docker inspect -f '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}' love-for-nai", quiet=True)
        if not deploy_dir.startswith('/') or '\n' in deploy_dir or '..' in deploy_dir.split('/'):
            raise RuntimeError('Cannot identify the existing compose working directory')
        compose = deploy_dir.rstrip('/') + '/compose.prod.yml'
        backup = compose + f'.bak-{tag}-{time.strftime("%Y%m%d%H%M%S")}'

        sftp = client.open_sftp()
        try:
            # /tmp can be RAM-backed on small hosts. Keep large image artifacts
            # beside the existing deployment on its persistent filesystem.
            upload_dir = deploy_dir.rstrip('/') + '/.release-upload'
            try:
                sftp.mkdir(upload_dir, mode=0o700)
            except IOError:
                import stat
                if not stat.S_ISDIR(sftp.lstat(upload_dir).st_mode):
                    raise RuntimeError('Upload directory is not a real directory')
            available_kib = int(run_remote(client, f'df -k --output=avail {shlex.quote(upload_dir)} | tail -n1', quiet=True))
            if available_kib * 1024 < compressed.stat().st_size + 512 * 1024 * 1024:
                raise RuntimeError('Insufficient persistent disk space for the image archive and extraction')
            remote_archive = upload_dir + f'/lfn-{tag}.tar.gz'
            with sftp.open(compose, 'r') as source:
                original = source.read().decode('utf-8')
            updated, count = re.subn(r'(?m)^(\s*image:\s*)(?:love-for-nai:[^\r\n]+|\$\{LFN_IMAGE[^\r\n]+)', lambda match: match[1] + image, original)
            if count != 1:
                raise RuntimeError('Expected exactly one LFN image in the existing compose')
            if trusted_edge:
                edge_config = run_remote(client, 'docker exec lfn-edge nginx -T 2>/dev/null', quiet=True)
                if 'proxy_set_header X-Real-IP $remote_addr;' not in edge_config:
                    raise RuntimeError('Trusted edge must overwrite X-Real-IP before enabling IP recording')
                updated, proxy_count = re.subn(r'(?m)^(\s*LFN_TRUST_PROXY:)\s*[^\r\n]+', r'\1 "true"', updated)
                if proxy_count != 1:
                    raise RuntimeError('Expected exactly one LFN_TRUST_PROXY setting')
                migration = sync_trusted_proxy_runtime(client, tag)
                if migration.get('changed'):
                    print('Trusted proxy runtime setting synchronized; private backup preserved', flush=True)
            last_progress = [0.0]
            def progress(sent, total):
                if time.monotonic() - last_progress[0] >= 20 or sent == total:
                    print(f'Upload {sent / max(total, 1):.0%} ({sent / 1048576:.1f} MiB)', flush=True)
                    last_progress[0] = time.monotonic()
            sftp.put(str(compressed), remote_archive, callback=progress)
            sftp.chmod(remote_archive, 0o600)
            remote_checksum = run_remote(client, f'sha256sum {shlex.quote(remote_archive)}', quiet=True).split()[0]
            if remote_checksum != checksum:
                raise RuntimeError('Uploaded image archive checksum mismatch')
            print('Image archive SHA256 verified', flush=True)
            print('Loading transferred image on server...', flush=True)
            run_remote(client, f'docker load -i {shlex.quote(remote_archive)}', timeout=900)
            loaded = True
            run_remote(client, f'cp -p {shlex.quote(compose)} {shlex.quote(backup)}')
            staged = compose + '.release-tmp'
            with sftp.open(staged, 'w') as destination:
                destination.write(updated)
            run_remote(client, f'mv {shlex.quote(staged)} {shlex.quote(compose)}')
            switched = True
            up = f'cd {shlex.quote(deploy_dir)} && docker compose -f compose.prod.yml up -d --no-build --pull never {shlex.quote(service)}'
            print('Recreating the existing LFN service...', flush=True)
            run_remote(client, up, timeout=180)
            print('Checking internal and public health...', flush=True)
            for _ in range(30):
                try:
                    if health(client, image):
                        break
                except Exception:
                    pass
                time.sleep(5)
            else:
                raise RuntimeError('New LFN container did not pass health checks')
            run_remote(client, 'curl --fail --silent --max-time 15 http://127.0.0.1:41800/studio -o /dev/null')
            print(f'DEPLOYED={image}\nPREVIOUS={previous}\nCOMPOSE_BACKUP={backup}', flush=True)
        finally:
            sftp.close()
    except Exception:
        if switched:
            print('Health/deploy failed; restoring previous compose and container...', flush=True)
            run_remote(client, f'cp -p {shlex.quote(backup)} {shlex.quote(compose)}')
            run_remote(client, up, timeout=180)
            print(f'ROLLED_BACK={previous}', flush=True)
        raise
    finally:
        try:
            if remote_archive and transport is not None and transport.is_active():
                run_remote(client, f'rm -f {shlex.quote(remote_archive)}', quiet=True)
        finally:
            client.close()
        if loaded:
            compressed.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
