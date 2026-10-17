#!/usr/bin/env python3
"""Reuse the existing managed IP certificate for /lfn API access.
Usage: python scripts/configure-api-https.py <release-tag> [--apply]
Defaults to read-only preview. Never registers an ACME account or reads TLS keys.
"""
import importlib.util
import ipaddress
import json
import re
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VHOST_ROOT = '/www/server/panel/vhost/nginx'
LABEL = '# Managed LFN API HTTPS prefix.'


def mutation_script(site, tag, content, apply):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}', tag):
        raise ValueError('Invalid release tag')
    ipaddress.ip_address(site)
    return r'''
const fs=require('fs'),path=require('path');
const site=SITE,tag=TAG,content=CONTENT,root='/vhosts';
const host=fs.readFileSync(path.join(root,site+'.conf'),'utf8');
if(!/listen\s+443\s+ssl\s*;/.test(host)||!host.includes('/extension/'+site+'/*.conf;')||!host.includes('ssl_certificate '))throw Error('Existing TLS site does not match the managed extension contract');
const dir=path.join(root,'extension',site),target=path.join(dir,'lfn-api-prefix.conf');
const original=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;
if(original!==null&&!original.startsWith('# Managed LFN API HTTPS prefix.'))throw Error('Refusing to replace an unmanaged configuration');
if(original===content){console.log(JSON.stringify({changed:false}));process.exit(0);}
if(!APPLY){console.log(JSON.stringify({changed:false,wouldChange:true,existingTlsSite:true,existingManagedExtension:original!==null}));process.exit(0);}
fs.mkdirSync(dir,{recursive:true,mode:0o755});
const backup=target+'.bak-'+tag;
if(original!==null)fs.writeFileSync(backup,original,{mode:0o600,flag:'wx'});
const tmp=target+'.tmp-'+tag;fs.writeFileSync(tmp,content,{mode:0o644,flag:'wx'});fs.renameSync(tmp,target);
console.log(JSON.stringify({changed:true,backupCreated:original!==null,created:original===null}));
'''.replace('SITE', json.dumps(site)).replace('TAG', json.dumps(tag)).replace('CONTENT', json.dumps(content)).replace('APPLY', 'true' if apply else 'false')


def container_command(image, script, writable=False):
    mount = 'type=bind,source=' + VHOST_ROOT + ',target=/vhosts' + ('' if writable else ',readonly')
    return ('docker run --rm --network none --read-only --user 0 --cap-drop ALL '
            '--cap-add DAC_OVERRIDE --security-opt no-new-privileges --mount ' + shlex.quote(mount) +
            ' --entrypoint node ' + shlex.quote(image) + ' -e ' + shlex.quote(script))


def run_sudo_remote(deploy, client, command):
    # Use the existing SSH administrator's normal sudo authority. Passwords go
    # only over SSH stdin, never into process arguments, files or tool output.
    password = deploy.load_ssh_config()[3]
    stdin, stdout, stderr = client.exec_command("sudo -S -p '' -- /bin/sh -c " + shlex.quote(command), timeout=45)
    stdin.write(password + '\n')
    stdin.flush()
    stdin.channel.shutdown_write()
    output = stdout.read().decode('utf-8', errors='replace')
    error = stderr.read().decode('utf-8', errors='replace')
    if stdout.channel.recv_exit_status():
        raise RuntimeError('Host nginx operation failed: ' + (output + error)[-1000:])


def reload_host_nginx(deploy, client):
    nginx = '/www/server/nginx/sbin/nginx'
    config = ' -c /www/server/nginx/conf/nginx.conf'
    run_sudo_remote(deploy, client, nginx + ' -t' + config + ' && ' + nginx + ' -s reload' + config)


def main():
    if len(sys.argv) not in (2, 3) or sys.argv[2:] not in ([], ['--apply']):
        raise SystemExit(__doc__)
    tag, apply = sys.argv[1], '--apply' in sys.argv
    content = (ROOT / 'deploy/nginx-lfn-api-prefix.conf').read_text(encoding='utf-8-sig')
    spec = importlib.util.spec_from_file_location('deploy', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    site = str(ipaddress.IPv4Address(deploy.load_ssh_config()[0]))
    script = mutation_script(site, tag, content, apply)
    client = deploy.connect()
    result = None
    try:
        info = json.loads(deploy.run_remote(client, 'docker inspect love-for-nai', quiet=True))[0]
        image = info['Config']['Image']
        bindings = info['HostConfig']['PortBindings'].get('3000/tcp') or []
        if not bindings or any(b['HostIp'] != '127.0.0.1' or b['HostPort'] != '41801' for b in bindings):
            raise RuntimeError('HTTPS API proxy requires the existing loopback-only application port')
        # Parse the proposed location directives using the installed nginx image,
        # before touching the existing TLS virtual host or reading any TLS keys.
        validation = 'events {}\nhttp { server { listen 127.0.0.1:44444;\n' + content + '\n} }\n'
        temporary = '/tmp/lfn-api-' + tag + '.conf'
        check = ('file=' + shlex.quote(temporary) + '; test ! -e "$file" || exit 1; '
                 '(umask 077; set -C; cat > "$file") || exit 1; '
                 'trap \'rm -f "$file"\' EXIT; nginx -t -c "$file"')
        deploy.run_remote(client, "printf '%s' " + shlex.quote(validation) + ' | docker exec -i lfn-edge sh -c ' + shlex.quote(check), quiet=True)
        if apply:
            run_sudo_remote(deploy, client, '/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf')
        result = json.loads(deploy.run_remote(client, container_command(image, script, apply), quiet=True))
        if apply:
            if result['changed']:
                reload_host_nginx(deploy, client)
            url = 'https://' + site + '/lfn/api/health'
            # A short bounded retry accommodates graceful worker replacement.
            payload = json.loads(deploy.run_remote(client, 'curl --fail --silent --show-error --retry 3 --retry-delay 1 --retry-all-errors --max-time 10 ' + shlex.quote(url), quiet=True))
            if payload.get('status') != 'ok' or payload.get('readiness', {}).get('freeImageAdmission') != 'ready':
                raise RuntimeError('Trusted HTTPS API ingress did not pass readiness')
            result['health'] = 'ready'
        result['publicApiUrl'] = 'https://' + site + '/lfn'
        print(json.dumps(result), flush=True)
    except Exception:
        if apply and result and result.get('changed'):
            rollback = ('const fs=require("fs"),path=require("path");const file=path.join("/vhosts/extension",' + json.dumps(site) + ',"lfn-api-prefix.conf");'
                        'if(!fs.readFileSync(file,"utf8").startsWith(' + json.dumps(LABEL) + '))throw Error("Extension changed externally");' +
                        ('fs.copyFileSync(file+".bak-"+' + json.dumps(tag) + ',file);' if result.get('backupCreated') else 'fs.unlinkSync(file);'))
            deploy.run_remote(client, container_command(image, rollback, True), quiet=True)
            reload_host_nginx(deploy, client)
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
