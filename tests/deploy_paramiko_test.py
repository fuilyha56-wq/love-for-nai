"""No SSH, credentials or Docker required: validate the release readiness gate."""
import importlib.util
import json
import os
import shlex
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'lfn_deploy', Path(__file__).resolve().parents[1] / 'scripts' / 'deploy-paramiko.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentReadinessTest(unittest.TestCase):
    def test_anlas_migration_preserves_custom_tiers_and_is_idempotent(self):
        original = {'v45AnlasCny': 0.04, 'v5AnlasCny': 0.05, 'strictApiBilling': True,
                    'v45': [{'afterImages': 0, 'baseCny': 0.015}], 'enabled': True, 'custom': 'preserve'}
        with tempfile.TemporaryDirectory(prefix='lfn-pricing-migration-') as directory:
            policy = Path(directory) / 'daily-billing' / 'policy.json'
            policy.parent.mkdir()
            policy.write_text(json.dumps(original), encoding='utf-8')
            with patch.object(deploy, 'run_remote', return_value='{}') as remote:
                deploy.sync_daily_anlas_pricing(object(), 'test-release')
            command = shlex.split(remote.call_args.args[1])
            self.assertEqual(command[:5], ['docker', 'exec', 'love-for-nai', 'node', '-e'])
            environment = {**os.environ, 'LFN_DATA_DIR': directory}
            def execute():
                result = subprocess.run(['node', '-e', command[5]], env=environment,
                                        capture_output=True, text=True, check=True)
                return json.loads(result.stdout)
            self.assertTrue(execute()['changed'])
            self.assertEqual(json.loads(policy.read_text()), {**original, 'v45AnlasCny': 0.02,
                             'v5AnlasCny': 0.025, 'strictApiBilling': False})
            self.assertEqual(json.loads(Path(str(policy) + '.bak-test-release').read_text()), original)
            self.assertFalse(execute()['changed'])

    def check_edge(self, payload):
        with patch.object(deploy, 'run_remote', side_effect=[
            'love-for-nai:test', json.dumps({'status': 'ok'}), json.dumps(payload)
        ]):
            return deploy.health(object(), 'love-for-nai:test')

    def test_healthy_process_cannot_hide_unavailable_free_admission(self):
        self.assertFalse(self.check_edge({'status': 'ok', 'readiness': {'freeImageAdmission': 'unavailable'}}))

    def test_missing_probe_does_not_pass(self):
        self.assertFalse(self.check_edge({'status': 'ok'}))

    def test_actual_edge_admission_passes(self):
        self.assertTrue(self.check_edge({'status': 'ok', 'readiness': {'freeImageAdmission': 'ready'}}))


if __name__ == '__main__':
    unittest.main()
