"""Offline recovery validation and mocked operator flows; no production calls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('operator_tool', Path(__file__).with_name('zmr-production-image.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
OLD = 'ghcr.io/zenod-ai/zenod@sha256:' + '1' * 64
NEW = 'ghcr.io/zenod-ai/zenod@sha256:' + '2' * 64
OLD_SHA, NEW_SHA = 'a' * 40, 'b' * 40


class Recovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.when = datetime.now(timezone.utc).isoformat()
        self.app = {'applicationId': operator.APP, 'sourceType': 'docker', 'dockerImage': OLD,
                    'env': 'GIT_SHA=' + OLD_SHA + '\nSIGNUP=0\nMODEL=unchanged'}
        self.old = {'Image': OLD, 'Env': self.app['env'].splitlines(),
                    'Mounts': [{'Source': 'zenod-mt-data', 'Target': '/data'}]}
        self.service = {'Spec': {'Name': operator.SERVICE, 'TaskTemplate': {'ContainerSpec': self.old}},
                        'UpdateStatus': {'State': 'completed'}}
        self.manifest = {'version': 1, 'createdAt': self.when, 'baselineObservedAt': self.when,
                         'target': {'applicationId': operator.APP, 'service': operator.SERVICE, 'host': operator.HOST},
                         'candidate': {'image': NEW, 'sha': NEW_SHA},
                         'offhost': {'host': 'independent-laptop', 'method': 'independent-local-copy', 'verifiedAt': self.when}, 'files': {}}
        self.save('app', self.app)
        self.save('service', [self.service])
        self.save('container', [{'Config': {'Image': OLD}, 'Image': 'sha256:actual-baseline'}])
        self.save('image', [{'Id': 'sha256:actual-baseline', 'Config': {'Labels': {'org.opencontainers.image.revision': OLD_SHA}}}])
        self.save('archive', b'non-sensitive archive fixture', 'zenod-data-fresh.tar.gz')
        self.save('checksum', (self.manifest['files']['archive']['sha256'] + '  /backups/zenod-data-fresh.tar.gz\n').encode())
        self.save('backupLog', ('backup=/backups/zenod-data-fresh.tar.gz\nchecksum=/backups/zenod-data-fresh.tar.gz.sha256\nquiesced=' + operator.SERVICE + '\nrestore_verified_at=' + self.when + '\n').encode())
        self.manifest_path = self.root / 'recovery.json'
        self.flush()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, name, value, filename=None):
        path = self.root / (filename or name + '.json')
        path.write_bytes(value if isinstance(value, bytes) else json.dumps(value).encode())
        path.chmod(0o600)
        self.manifest['files'][name] = {'path': path.name, 'sha256': operator.digest(path)}

    def flush(self):
        self.manifest_path.write_text(json.dumps(self.manifest))
        self.manifest_path.chmod(0o600)

    def load(self, **overrides):
        args = dict(manifest_path=self.manifest_path, mode='deploy', candidate_sha=NEW_SHA, candidate_image=NEW)
        args.update(overrides)
        return operator.load_recovery(**args)

    def test_baseline_derived_and_local_independent_copy_verified(self):
        self.assertEqual(self.load()['rollback'], {'image': OLD, 'sha': OLD_SHA})

    def test_missing_manifest_or_missing_archive_fails(self):
        with self.assertRaises(ValueError):
            self.load(manifest_path=self.root / 'absent.json')
        (self.root / self.manifest['files']['archive']['path']).unlink()
        with self.assertRaises(ValueError):
            self.load()

    def test_candidate_mismatch_sha_and_mutable_image_fail(self):
        for overrides in ({'candidate_sha': 'c' * 40}, {'candidate_image': 'ghcr.io/zenod-ai/zenod:latest'}):
            with self.assertRaises(ValueError):
                self.load(**overrides)

    def test_archive_or_snapshot_tampering_fails(self):
        for name in ('archive', 'service'):
            path = self.root / self.manifest['files'][name]['path']
            old = path.read_bytes()
            path.write_bytes(old + b'changed')
            with self.assertRaises(ValueError):
                self.load()
            path.write_bytes(old)

    def test_stale_backup_even_with_fresh_manifest_fails(self):
        self.save('backupLog', ('backup=/backups/zenod-data-fresh.tar.gz\nchecksum=/backups/zenod-data-fresh.tar.gz.sha256\nquiesced=' + operator.SERVICE + '\nrestore_verified_at=2026-01-01T00:00:00Z\n').encode())
        self.flush()
        with self.assertRaises(ValueError):
            self.load()

    def test_wrong_restore_archive_and_checksum_fail(self):
        self.save('checksum', (self.manifest['files']['archive']['sha256'] + '  /backups/another.tar.gz\n').encode())
        self.flush()
        with self.assertRaises(ValueError):
            self.load()

    def test_offhost_or_permissions_missing_fails(self):
        self.manifest['offhost']['host'] = operator.HOST
        self.flush()
        with self.assertRaises(ValueError):
            self.load()
        self.manifest['offhost']['host'] = 'laptop'
        self.flush()
        self.manifest_path.chmod(0o644)
        with self.assertRaises(ValueError):
            self.load()

    def test_rollback_oci_disagrees_with_baseline_fails(self):
        self.save('image', [{'Id': 'sha256:actual-baseline', 'Config': {'Labels': {'org.opencontainers.image.revision': 'f' * 40}}}])
        self.flush()
        with self.assertRaises(ValueError):
            self.load()

    def test_mount_env_sha_and_pending_drift_fail(self):
        recovery = self.load()
        identities = {(OLD, OLD_SHA)}
        operator.check_drift(recovery, self.service, self.app, identities)
        for field, value in [('Mounts', []), ('Env', ['GIT_SHA=' + OLD_SHA, 'SIGNUP=1']), ('Image', NEW)]:
            altered = copy.deepcopy(self.service)
            altered['Spec']['TaskTemplate']['ContainerSpec'][field] = value
            with self.assertRaises(ValueError):
                operator.check_drift(recovery, altered, self.app, identities)
        pending = {**self.app, 'env': self.app['env'].replace(OLD_SHA, NEW_SHA)}
        with self.assertRaises(ValueError):
            operator.check_drift(recovery, self.service, pending, identities)

    def test_check_only_never_uses_network(self):
        args = types.SimpleNamespace(manifest=str(self.manifest_path), mode='deploy', candidate_sha=NEW_SHA, candidate_image=NEW, check_only=True)
        with patch.object(operator, 'ssh', side_effect=AssertionError('network')), patch.object(operator, 'api', side_effect=AssertionError('network')):
            operator.execute(args)

    def run_flow(self, fail_dispatch=False, wrong_oci=False, wrong_actual=False, wrong_baseline=False):
        state = {'service': copy.deepcopy(self.service), 'app': copy.deepcopy(self.app)}
        mutations = []
        def api(root, endpoint, body=None):
            if endpoint.startswith('/application.one'):
                return copy.deepcopy(state['app'])
            mutations.append(endpoint)
            if endpoint == '/application.update':
                state['app'].update(body)
            elif endpoint == '/application.redeploy':
                if fail_dispatch and len(mutations) == 2:
                    raise RuntimeError('simulated interrupted redeploy')
                state['service']['Spec']['TaskTemplate']['ContainerSpec'].update(Image=state['app']['dockerImage'], Env=state['app']['env'].splitlines())
            return {}
        def ssh(command):
            if command.startswith('docker pull'):
                return ''
            if command.startswith('docker service ps'):
                return 'task1'
            if command == 'docker inspect task1':
                return json.dumps([{'Status': {'State': 'running', 'ContainerStatus': {'ContainerID': 'container1'}}, 'Spec': {'ContainerSpec': state['service']['Spec']['TaskTemplate']['ContainerSpec']}}])
            if command == 'docker inspect container1':
                is_new = state['service']['Spec']['TaskTemplate']['ContainerSpec']['Image'] == NEW
                image_id = 'sha256:actual-candidate' if is_new else 'sha256:actual-baseline'
                if (wrong_actual and is_new) or (wrong_baseline and not is_new):
                    image_id = 'sha256:wrong-image'
                return json.dumps([{'Image': image_id}])
            if command.startswith('docker image inspect --format') and '.Id' in command:
                return 'sha256:actual-candidate' if NEW in command else 'sha256:actual-baseline'
            raise AssertionError(command)
        def health(*args, **kwargs):
            return json.dumps({'status': 'ok', 'sha': operator.git_sha(state['app']['env'].splitlines())}).encode()
        args = types.SimpleNamespace(manifest=str(self.manifest_path), mode='deploy', candidate_sha=NEW_SHA, candidate_image=NEW, check_only=False)
        operator.write_receipt(self.root / 'queue-clear.json', {'manifestHash': operator.digest(self.manifest_path), 'mode': 'deploy', 'pendingDeployments': 0, 'checkedAt': self.when})
        with patch.object(operator, 'api', side_effect=api), patch.object(operator, 'inspect_service', side_effect=lambda: copy.deepcopy(state['service'])), patch.object(operator, 'ssh', side_effect=ssh), patch.object(operator, 'inspect_revision', side_effect=lambda image: ('f' * 40 if wrong_oci else NEW_SHA) if image in (NEW, 'sha256:actual-candidate') or (wrong_actual and image == 'sha256:wrong-image') else OLD_SHA), patch.object(operator.time, 'sleep'), patch.object(operator.subprocess, 'check_output', side_effect=health):
            if wrong_actual or wrong_baseline:
                with self.assertRaisesRegex(ValueError, 'image ID mismatch'):
                    operator.execute(args)
                self.assertFalse((self.root / 'deploy-verified.json').exists())
                if wrong_baseline:
                    self.assertEqual(mutations, [])
                return
            if wrong_oci:
                with self.assertRaises(ValueError):
                    operator.execute(args)
                self.assertEqual(mutations, [])
                self.assertFalse((self.root / 'deploy-intent.json').exists())
                return
            if fail_dispatch:
                with self.assertRaises(RuntimeError):
                    operator.execute(args)
            else:
                operator.execute(args)
            with self.assertRaises(ValueError):
                operator.execute(args)
            args.mode, args.candidate_sha, args.candidate_image = 'rollback', None, None
            with self.assertRaises(ValueError):
                operator.execute(args)
            operator.write_receipt(self.root / 'queue-clear.json', {'manifestHash': operator.digest(self.manifest_path), 'mode': 'rollback', 'deployIntentSha256': operator.digest(self.root / 'deploy-intent.json'), 'pendingDeployments': 0, 'checkedAt': self.when})
            operator.execute(args)
        self.assertEqual(state['app']['dockerImage'], OLD)
        self.assertEqual(state['app']['env'], self.app['env'])
        self.assertEqual(state['service']['Spec']['TaskTemplate']['ContainerSpec']['Mounts'], self.old['Mounts'])
        self.assertEqual(mutations, ['/application.update', '/application.redeploy'] * 2)

    def test_deploy_rollback_preserves_env_mount_and_blocks_repeat(self):
        self.run_flow()

    def test_interrupted_dispatch_blocks_repeat_but_allows_reviewed_rollback(self):
        self.run_flow(fail_dispatch=True)

    def test_same_sha_wrong_actual_image_cannot_verify(self):
        self.run_flow(wrong_actual=True)

    def test_same_sha_wrong_baseline_cannot_dispatch(self):
        self.run_flow(wrong_baseline=True)

    def test_wrong_candidate_oci_cannot_mutate_desired_state(self):
        self.run_flow(wrong_oci=True)


if __name__ == '__main__':
    unittest.main()
