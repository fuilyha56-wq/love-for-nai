"""No SSH, credentials or Docker required: validate the release readiness gate."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'lfn_deploy', Path(__file__).resolve().parents[1] / 'scripts' / 'deploy-paramiko.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentReadinessTest(unittest.TestCase):
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
