"""Exercise the actual managed TLS extension transform without Docker or SSH."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from unittest.mock import Mock
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('api_https', root / 'scripts/configure-api-https.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApiHttpsConfigurationTest(unittest.TestCase):
    def test_reload_signals_only_the_identified_existing_master(self):
        deploy = Mock()
        deploy.run_remote.side_effect = [' 123 nginx nginx: master process /www/server/nginx/sbin/nginx -c /www/server/nginx/conf/nginx.conf\n', '']
        module.reload_host_nginx(deploy, object(), 'love-for-nai:test')
        command = deploy.run_remote.call_args.args[1]
        self.assertIn('--cap-drop ALL --cap-add KILL', command)
        self.assertIn('const pid=123;', command)
        self.assertIn('"SIGHUP"', command)
        self.assertNotIn('--privileged', command)

    def test_preview_backup_update_and_repetition_leave_existing_tls_site_unchanged(self):
        with tempfile.TemporaryDirectory(prefix='lfn-api-tls-') as directory:
            base = Path(directory)
            site = '203.0.113.8'
            host = base / (site + '.conf')
            original = f'server {{ listen 443 ssl; ssl_certificate /cert/fullchain.pem; include /extension/{site}/*.conf; }}'
            host.write_text(original)
            folder = base / 'extension' / site
            folder.mkdir(parents=True)
            target = folder / 'lfn-api-prefix.conf'
            previous = module.LABEL + '\n# previous managed content\n'
            target.write_text(previous)
            desired = (root / 'deploy/nginx-lfn-api-prefix.conf').read_text(encoding='utf-8')

            def execute(apply):
                code = module.mutation_script(site, 'test-release', desired, apply).replace("root='/vhosts'", 'root=' + json.dumps(directory))
                result = subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True)
                return json.loads(result.stdout)

            self.assertTrue(execute(False)['wouldChange'])
            self.assertEqual(target.read_text(), previous)
            self.assertTrue(execute(True)['backupCreated'])
            self.assertEqual(target.read_text(), desired)
            self.assertEqual(Path(str(target) + '.bak-test-release').read_text(), previous)
            self.assertEqual(host.read_text(), original)
            self.assertFalse(execute(True)['changed'])

    def test_refuses_to_overwrite_an_unmanaged_extension(self):
        with tempfile.TemporaryDirectory(prefix='lfn-api-tls-unmanaged-') as directory:
            base = Path(directory)
            site = '203.0.113.8'
            (base / (site + '.conf')).write_text(f'listen 443 ssl; ssl_certificate /cert/public.pem; include /extension/{site}/*.conf;')
            folder = base / 'extension' / site
            folder.mkdir(parents=True)
            target = folder / 'lfn-api-prefix.conf'
            target.write_text('unmanaged owner configuration')
            code = module.mutation_script(site, 'test-release', 'new', True).replace("root='/vhosts'", 'root=' + json.dumps(directory))
            result = subprocess.run(['node', '-e', code], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_text(), 'unmanaged owner configuration')

    def test_rejects_path_injection_and_keeps_preview_mount_read_only(self):
        with self.assertRaises(ValueError):
            module.mutation_script('203.0.113.8', '../wrong', '', False)
        with self.assertRaises(ValueError):
            module.mutation_script('../wrong', 'test', '', False)
        command = module.container_command('love-for-nai:test', 'console.log(1)')
        self.assertIn('target=/vhosts,readonly', command)
        self.assertIn('--network none', command)
        self.assertNotIn('privileged', command)


if __name__ == '__main__':
    unittest.main()
