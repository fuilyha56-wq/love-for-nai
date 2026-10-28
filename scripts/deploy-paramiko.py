#!/usr/bin/env python3
"""Deploy a locally built LFN image through credentials in the project's .rsh.py.
Keeps the previous compose/image and automatically rolls back failed health checks.
Usage: python scripts/deploy-paramiko.py <image-tag> [--trusted-edge] [--sync-anlas-pricing] [--prepare-only] [--snapshot-rollback]
"""
import gzip
import ast
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import stat
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_ATTEMPTS = 32


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


def upload_file_confirmed(sftp, local_path, remote_path, progress, offset=0):
    """Pipeline a resumable SFTP upload; the caller verifies its remote SHA-256."""
    total = Path(local_path).stat().st_size
    if not 0 <= offset <= total:
        raise ValueError('Invalid upload offset')
    sent = offset
    with Path(local_path).open('rb') as source:
        source.seek(offset)
        mode = 'wb' if sent == 0 else 'r+b'
        with sftp.open(remote_path, mode, bufsize=0) as destination:
            if sent:
                destination.seek(sent)
            destination.set_pipelined(True)
            while True:
                batch = source.read(1024 * 1024)
                if not batch:
                    break
                for block_offset in range(0, len(batch), 32768):
                    block = batch[block_offset:block_offset + 32768]
                    destination.write(block)
                    sent += len(block)
                    progress(sent, total)
    return sent


def archive_matches_image(archive, image_id):
    """Reusing an interrupted export is safe only for the exact local image."""
    config_matches = False
    with tarfile.open(archive, 'r|gz') as source:
        for member in source:
            if member.name == 'index.json':
                manifests = json.load(source.extractfile(member)).get('manifests', [])
                if len(manifests) == 1 and manifests[0].get('digest') == image_id:
                    return True
            if member.name == 'manifest.json':
                manifests = json.load(source.extractfile(member))
                config_matches = len(manifests) == 1 and Path(manifests[0]['Config']).name.removesuffix('.json') == image_id.removeprefix('sha256:')
    return config_matches


def verified_upload_offset(client, sftp, local_path, remote_path):
    try:
        size = sftp.stat(remote_path).st_size
    except FileNotFoundError:
        return 0
    if not 0 < size <= Path(local_path).stat().st_size:
        return 0
    digest = hashlib.sha256()
    remaining = size
    with Path(local_path).open('rb') as source:
        while remaining:
            block = source.read(min(1024 * 1024, remaining))
            digest.update(block)
            remaining -= len(block)
    remote_digest = run_remote(client, f'head -c {size} {shlex.quote(remote_path)} | sha256sum', quiet=True).split()[0]
    return size if remote_digest == digest.hexdigest() else 0


def health(client, image):
    command = "docker inspect -f '{{.Config.Image}}' love-for-nai"
    if run_remote(client, command, quiet=True) != image:
        return False
    for url in ['http://127.0.0.1:41801/api/health', 'http://127.0.0.1:41800/api/health']:
        raw = run_remote(client, f'curl --fail --silent --max-time 8 {shlex.quote(url)}', quiet=True)
        payload = json.loads(raw)
        if payload.get('status') != 'ok':
            return False
        # A live process alone is insufficient: the real edge must satisfy the
        # same cached-policy/source check used for free image admission.
        if ':41800/' in url and payload.get('readiness', {}).get('freeImageAdmission') != 'ready':
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


def sync_daily_anlas_pricing(client, tag):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}', tag):
        raise ValueError('Invalid release tag')
    script = r'''
const fs=require("fs"),path=require("path");
const file=path.resolve(process.env.LFN_DATA_DIR||"data","daily-billing/policy.json");
if(!fs.existsSync(file)){console.log(JSON.stringify({changed:false,source:"new-defaults"}));process.exit(0)}
const current=JSON.parse(fs.readFileSync(file,"utf8"));
if(current.v45AnlasCny===0.01&&current.v5AnlasCny===0.01&&current.strictApiBilling===false){console.log(JSON.stringify({changed:false}));process.exit(0)}
fs.copyFileSync(file,file+".bak-"+RELEASE_TAG,fs.constants.COPYFILE_EXCL);
const updated={...current,v45AnlasCny:0.01,v5AnlasCny:0.01,strictApiBilling:false};
const temporary=file+".pricing-sync.tmp";
fs.writeFileSync(temporary,JSON.stringify(updated,null,2),{mode:0o600});fs.renameSync(temporary,file);
console.log(JSON.stringify({changed:true,backupCreated:true,v45AnlasCny:0.01,v5AnlasCny:0.01,newApiFallback:true}));
'''.replace('RELEASE_TAG', json.dumps(tag))
    return json.loads(run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(script), quiet=True))


def sync_edge_request_host(client, tag):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}', tag):
        raise ValueError('Invalid release tag')
    info = json.loads(run_remote(client, 'docker inspect lfn-edge', quiet=True))[0]
    targets = [m['Source'] for m in info.get('Mounts', [])
               if m.get('Type') == 'bind' and m.get('Destination') == '/etc/nginx/conf.d/default.conf']
    if len(targets) != 1 or not targets[0].startswith('/'):
        raise RuntimeError('Cannot identify the edge configuration file')
    target = targets[0]
    sftp = client.open_sftp()
    try:
        if not stat.S_ISREG(sftp.lstat(target).st_mode):
            raise RuntimeError('Edge configuration is not a regular file')
        with sftp.open(target, 'r') as source:
            original = source.read().decode('utf-8')
        if 'proxy_set_header Host $http_host;' in original:
            return {'changed': False}
        if original.count('proxy_set_header Host $host;') != 1:
            raise RuntimeError('Unexpected edge Host configuration')
        updated = original.replace('proxy_set_header Host $host;',
            'proxy_set_header Host $http_host;\n        proxy_set_header X-Forwarded-Host $http_host;')
        backup = target + '.bak-' + tag
        with sftp.open(backup, 'wx') as destination:
            destination.write(original)
        sftp.chmod(backup, 0o600)
        try:
            # A bind-mounted file retains its inode; replacing by rename would
            # leave nginx looking at the old file until container recreation.
            with sftp.open(target, 'w') as destination:
                destination.write(updated)
            run_remote(client, 'docker exec lfn-edge nginx -t', quiet=True)
            run_remote(client, 'docker exec lfn-edge nginx -s reload', quiet=True)
        except Exception:
            with sftp.open(target, 'w') as destination:
                destination.write(original)
            run_remote(client, 'docker exec lfn-edge nginx -t', quiet=True)
            run_remote(client, 'docker exec lfn-edge nginx -s reload', quiet=True)
            raise
        return {'changed': True, 'backupCreated': True}
    finally:
        sftp.close()


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}', sys.argv[1]) or any(arg not in {'--trusted-edge', '--sync-anlas-pricing', '--resume-upload', '--prepare-only', '--snapshot-rollback'} for arg in sys.argv[2:]):
        raise SystemExit('Usage: deploy-paramiko.py <lowercase-image-tag> [--trusted-edge] [--sync-anlas-pricing] [--resume-upload] [--prepare-only] [--snapshot-rollback]')
    if '--prepare-only' in sys.argv and any(arg in sys.argv for arg in ('--trusted-edge', '--sync-anlas-pricing')):
        raise SystemExit('Preparing an image cannot migrate live configuration')
    trusted_edge = '--trusted-edge' in sys.argv
    tag = sys.argv[1]
    image = f'love-for-nai:{tag}'
    temporary = ROOT / 'scripts' / '.tmp'
    temporary.mkdir(exist_ok=True)
    archive = temporary / f'love-for-nai-{tag}.tar'
    compressed = archive.with_suffix('.tar.gz')
    image_id = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], text=True).strip()
    if '--resume-upload' in sys.argv and compressed.exists():
        if not archive_matches_image(compressed, image_id):
            raise RuntimeError('Interrupted archive does not match the exact current local image')
        print(f'Reusing verified export for {image}', flush=True)
    else:
        print(f'Exporting locally built image {image}', flush=True)
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
    rollback_image = None
    switched = False
    loaded = False
    try:
        # Read compose metadata from inspect JSON to avoid nested shell/Go-template quoting over SSH.
        container = json.loads(run_remote(client, 'docker inspect love-for-nai', quiet=True))[0]
        labels = container.get('Config', {}).get('Labels') or {}
        previous = container.get('Config', {}).get('Image') or container.get('Image', '')
        expected_image = os.environ.get('LFN_DEPLOY_EXPECTED_IMAGE', '').strip()
        if expected_image and previous != expected_image:
            raise RuntimeError('The running LFN image changed before deployment; rebuild against the current release')
        service = labels.get('com.docker.compose.service', '')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', service):
            raise RuntimeError('Cannot identify the existing LFN compose service')
        environment = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
        if trusted_edge or environment.get('LFN_TRUST_PROXY') == 'true':
            bindings = container['HostConfig'].get('PortBindings') or {}
            if any(binding.get('HostIp') not in ('127.0.0.1', '::1') for values in bindings.values() for binding in (values or [])):
                raise RuntimeError('Trusted proxy mode requires the application port to be loopback-only')
            edge_config = run_remote(client, 'docker exec lfn-edge nginx -T 2>/dev/null', quiet=True)
            if 'proxy_set_header X-Real-IP $remote_addr;' not in edge_config:
                raise RuntimeError('The edge must overwrite X-Real-IP')
        deploy_dir = labels.get('com.docker.compose.project.working_dir', '')
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
                migration = sync_edge_request_host(client, tag)
                if migration.get('changed'):
                    print('Edge preserves public Host and port; validated and reloaded', flush=True)
                edge_config = run_remote(client, 'docker exec lfn-edge nginx -T 2>/dev/null', quiet=True)
                if 'proxy_set_header X-Real-IP $remote_addr;' not in edge_config:
                    raise RuntimeError('Trusted edge must overwrite X-Real-IP before enabling IP recording')
                updated, proxy_count = re.subn(r'(?m)^(\s*LFN_TRUST_PROXY:)\s*[^\r\n]+', r'\1 "true"', updated)
                if proxy_count != 1:
                    raise RuntimeError('Expected exactly one LFN_TRUST_PROXY setting')
                migration = sync_trusted_proxy_runtime(client, tag)
                if migration.get('changed'):
                    print('Trusted proxy runtime setting synchronized; private backup preserved', flush=True)
            if '--sync-anlas-pricing' in sys.argv:
                migration = sync_daily_anlas_pricing(client, tag)
                if migration.get('changed'):
                    print('LFN Anlas rates synchronized: V4.5 CNY 0.01 / V5 CNY 0.01; private backup preserved', flush=True)
            last_progress = [0.0]
            def progress(sent, total):
                if time.monotonic() - last_progress[0] >= 20 or sent == total:
                    print(f'Upload {sent / max(total, 1):.0%} ({sent / 1048576:.1f} MiB)', flush=True)
                    last_progress[0] = time.monotonic()
            import paramiko
            for attempt in range(UPLOAD_ATTEMPTS):
                try:
                    offset = verified_upload_offset(client, sftp, compressed, remote_archive)
                    if offset:
                        print(f'Resuming verified upload at {offset / 1048576:.1f} MiB', flush=True)
                    upload_file_confirmed(sftp, compressed, remote_archive, progress, offset)
                    break
                except (EOFError, OSError, paramiko.SSHException) as error:
                    if attempt + 1 == UPLOAD_ATTEMPTS:
                        raise
                    print(f'Upload connection interrupted ({type(error).__name__}); retry {attempt + 1}/{UPLOAD_ATTEMPTS}, verifying the uploaded prefix...', flush=True)
                    sftp.close()
                    client.close()
                    client = connect()
                    transport = client.get_transport()
                    sftp = client.open_sftp()
            sftp.chmod(remote_archive, 0o600)
            remote_checksum = run_remote(client, f'sha256sum {shlex.quote(remote_archive)}', quiet=True).split()[0]
            if remote_checksum != checksum:
                raise RuntimeError('Uploaded image archive checksum mismatch')
            print('Image archive SHA256 verified', flush=True)
            print('Loading transferred image on server...', flush=True)
            run_remote(client, f'docker load -i {shlex.quote(remote_archive)}', timeout=900)
            loaded = True
            if '--prepare-only' in sys.argv:
                print(f'PREPARED={image}\nUNCHANGED={previous}', flush=True)
                return
            # Long transfers can outlive SSH session limits. Use a fresh session
            # for the short configuration switch and subsequent health checks.
            sftp.close()
            client.close()
            client = connect()
            transport = client.get_transport()
            sftp = client.open_sftp()
            current_container = json.loads(run_remote(client, 'docker inspect love-for-nai', quiet=True))[0]
            if current_container.get('Id') != container.get('Id'):
                raise RuntimeError('Another deployment changed the LFN container while the image was transferring')
            with sftp.open(compose, 'r') as source:
                if source.read().decode('utf-8') != original:
                    raise RuntimeError('The compose configuration changed while the image was transferring')
            if '--snapshot-rollback' in sys.argv:
                # Preserve hotfixes in the running container's writable layer.
                # Persistent data stays on its existing volume, outside the snapshot.
                rollback_image = f'love-for-nai:rollback-{tag}'
                run_remote(client, f'docker commit --pause=false {shlex.quote(container["Id"])} {shlex.quote(rollback_image)}', timeout=180, quiet=True)
                print(f'Running-container hotfix snapshot preserved: {rollback_image}', flush=True)
            run_remote(client, f'cp -p {shlex.quote(compose)} {shlex.quote(backup)}')
            staged = compose + '.release-tmp'
            with sftp.open(staged, 'w') as destination:
                destination.write(updated)
            sftp.chmod(staged, 0o600)
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
                raise RuntimeError('New LFN container did not pass health and edge free-image admission checks')
            run_remote(client, 'curl --fail --silent --max-time 15 http://127.0.0.1:41800/studio -o /dev/null')
            print(f'DEPLOYED={image}\nPREVIOUS={previous}\nCOMPOSE_BACKUP={backup}', flush=True)
        finally:
            sftp.close()
    except Exception:
        if switched:
            print('Health/deploy failed; restoring previous compose and container...', flush=True)
            client.close()
            client = connect()
            transport = client.get_transport()
            run_remote(client, f'cp -p {shlex.quote(backup)} {shlex.quote(compose)}')
            if rollback_image:
                rollback_content, count = re.subn(r'(?m)^(\s*image:\s*)(?:love-for-nai:[^\r\n]+|\$\{LFN_IMAGE[^\r\n]+)', lambda match: match[1] + rollback_image, original)
                if count != 1:
                    raise RuntimeError('Cannot restore the hotfixed LFN snapshot configuration')
                with client.open_sftp() as rollback_sftp:
                    staged = compose + '.rollback-tmp'
                    with rollback_sftp.open(staged, 'w') as destination:
                        destination.write(rollback_content)
                    rollback_sftp.chmod(staged, 0o600)
                run_remote(client, f'mv {shlex.quote(staged)} {shlex.quote(compose)}')
            run_remote(client, up, timeout=180)
            print(f'ROLLED_BACK={rollback_image or previous}', flush=True)
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
