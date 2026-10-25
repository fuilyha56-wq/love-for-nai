"""No SSH, credentials or Docker required: validate the release readiness gate."""
import importlib.util
import hashlib
import io
import json
import os
import shlex
import subprocess
import tempfile
import tarfile
from contextlib import contextmanager
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'lfn_deploy', Path(__file__).resolve().parents[1] / 'scripts' / 'deploy-paramiko.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentReadinessTest(unittest.TestCase):
    def test_interrupted_upload_resumes_only_after_prefix_verification(self):
        class RemoteFile:
            data = b'valid-prefix'

            def stat(self, path):
                return type('Stat', (), {'st_size': len(self.data)})()

            @contextmanager
            def open(self, path, mode, bufsize=0):
                stream = io.BytesIO(b'' if mode == 'wb' else self.data)
                stream.set_pipelined = lambda value: None
                yield stream
                self.data = stream.getvalue()

        remote = RemoteFile()
        content = remote.data + b'image-bytes' * 200000
        with tempfile.TemporaryDirectory(prefix='lfn-upload-') as directory:
            archive = Path(directory) / 'image.gz'
            archive.write_bytes(content)
            with patch.object(deploy, 'run_remote', return_value=hashlib.sha256(remote.data).hexdigest() + '  -'):
                offset = deploy.verified_upload_offset(object(), remote, archive, '/release/image.gz')
            self.assertEqual(offset, len(b'valid-prefix'))
            deploy.upload_file_confirmed(remote, archive, '/release/image.gz', lambda sent, total: None, offset)
            self.assertEqual(remote.data, content)
            with patch.object(deploy, 'run_remote', return_value='incorrect-digest  -'):
                self.assertEqual(deploy.verified_upload_offset(object(), remote, archive, '/release/image.gz'), 0)

    def test_reused_export_must_match_exact_image(self):
        with tempfile.TemporaryDirectory(prefix='lfn-export-') as directory:
            archive = Path(directory) / 'image.tar.gz'
            manifest = json.dumps([{'Config': 'blobs/sha256/current-image'}]).encode()
            with tarfile.open(archive, 'w:gz') as destination:
                entry = tarfile.TarInfo('manifest.json')
                entry.size = len(manifest)
                destination.addfile(entry, io.BytesIO(manifest))
            self.assertTrue(deploy.archive_matches_image(archive, 'sha256:current-image'))
            self.assertFalse(deploy.archive_matches_image(archive, 'sha256:other-image'))
            with tarfile.open(archive, 'w:gz') as destination:
                index = json.dumps({'manifests': [{'digest': 'sha256:oci-image-index'}]}).encode()
                entry = tarfile.TarInfo('index.json')
                entry.size = len(index)
                destination.addfile(entry, io.BytesIO(index))
            self.assertTrue(deploy.archive_matches_image(archive, 'sha256:oci-image-index'))
            self.assertFalse(deploy.archive_matches_image(archive, 'sha256:other-image'))

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
