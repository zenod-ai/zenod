#!/usr/bin/env python3
"""Candidate-bound public Zenod image switch; never restores production data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time
from datetime import datetime, timezone

APP = '2dkayH_eAur427leH64MT'
SERVICE = 'zenod-mt-fxpzoo'
HOST = 'hetzner_vps_1'
API = 'https://dokploy.polyqu.com/api'
HEALTH = 'https://cloud.zenod.dev/api/health'
SHA = r'[0-9a-f]{40}'
IMAGE = r'ghcr.io/zenod-ai/zenod@sha256:[0-9a-f]{64}'
MAX_AGE = 24 * 3600


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def protected(path, directory=False):
    require(not path.is_symlink(), 'Recovery paths must not be symlinks')
    require(path.is_dir() if directory else path.is_file(), 'Missing recovery file/directory')
    stat = path.stat()
    require(stat.st_uid == os.getuid() and stat.st_mode & 0o077 == 0,
            'Recovery files require owner-only permissions')
    return path


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'Recovery timestamp needs timezone')
    return parsed.timestamp()


def fresh(value, now, age=MAX_AGE):
    require(0 <= now - timestamp(value) <= age, 'Stale/future recovery evidence')


def git_sha(env):
    entries = [line[8:] for line in env if line.startswith('GIT_SHA=')]
    require(len(entries) == 1 and re.fullmatch(SHA, entries[0]), 'Expected one full GIT_SHA')
    return entries[0]


def stable_env(env):
    return sorted(line for line in env if not line.startswith('GIT_SHA='))


def load_recovery(manifest_path, mode, candidate_sha=None, candidate_image=None, now=None):
    """Offline validation. Paths are relative to a protected off-VPS recovery directory."""
    now = time.time() if now is None else now
    root = protected(manifest_path.parent, directory=True)
    protected(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    require(manifest['version'] == 1, 'Unsupported recovery manifest')
    require(manifest['target'] == {'applicationId': APP, 'service': SERVICE, 'host': HOST}, 'Wrong deployment target')
    candidate = manifest['candidate']
    require(re.fullmatch(SHA, candidate['sha']) and re.fullmatch(IMAGE, candidate['image']), 'Invalid candidate SHA/image')
    if mode == 'deploy':
        require(candidate_sha == candidate['sha'] and candidate_image == candidate['image'], 'Candidate differs from recovery manifest')
        fresh(manifest['createdAt'], now)
        fresh(manifest['baselineObservedAt'], now)
    require(manifest['offhost']['host'] != HOST and bool(manifest['offhost']['host']), 'Offhost copy must be independent of VPS')
    require(manifest['offhost']['method'] == 'independent-local-copy', 'Expected independently copied local recovery files')
    paths = {}
    for name in ('app', 'service', 'container', 'image', 'archive', 'checksum', 'backupLog'):
        record = manifest['files'][name]
        relative = Path(record['path'])
        require(not relative.is_absolute() and len(relative.parts) == 1, 'Recovery files must be direct children')
        path = protected(root / relative)
        require(re.fullmatch(r'[0-9a-f]{64}', record['sha256']) and digest(path) == record['sha256'], 'Recovery checksum mismatch: ' + name)
        paths[name] = path
    app = json.loads(paths['app'].read_text())
    service = json.loads(paths['service'].read_text())[0]
    container = json.loads(paths['container'].read_text())[0]
    image = json.loads(paths['image'].read_text())[0]
    old = service['Spec']['TaskTemplate']['ContainerSpec']
    rollback = {'image': old['Image'], 'sha': image['Config']['Labels']['org.opencontainers.image.revision']}
    require(re.fullmatch(IMAGE, rollback['image']) and re.fullmatch(SHA, rollback['sha']), 'Invalid recorded rollback identity')
    require(service['Spec']['Name'] == SERVICE and app['applicationId'] == APP and app['sourceType'] == 'docker', 'Snapshot target mismatch')
    require(app.get('modeSwarm', 'missing') is None and app.get('serverId', 'missing') is None, 'Expected local public application without Swarm mode override')
    require(app.get('replicas') == 1 and service['Spec'].get('Mode', {}).get('Replicated', {}).get('Replicas') == 1, 'Expected one declared public replica')
    require(app['dockerImage'] == old['Image'] and container['Config']['Image'] == old['Image'], 'Baseline image mismatch')
    require(container['Image'] == image['Id'], 'Baseline actual image ID mismatch')
    require(git_sha(old['Env']) == rollback['sha'] == git_sha(app['env'].splitlines()), 'Baseline SHA mismatch')
    require(any(m.get('Source') == 'zenod-mt-data' and m.get('Target') == '/data' for m in old['Mounts']), 'Expected public data mount')
    log = paths['backupLog'].read_text()
    fields = dict(re.findall(r'^(backup|checksum|quiesced|restore_verified_at)=(.+)$', log, re.M))
    require(fields.get('quiesced') == SERVICE, 'Backup does not bind public service')
    require(Path(fields['backup']).name == paths['archive'].name, 'Restore log archive mismatch')
    require(fields['checksum'] == fields['backup'] + '.sha256', 'Restore log checksum mismatch')
    checksum = paths['checksum'].read_text().strip().split(maxsplit=1)
    require(len(checksum) == 2 and checksum[0] == manifest['files']['archive']['sha256']
            and checksum[1].lstrip('*') == fields['backup'], 'Backup checksum does not bind restored archive')
    require(timestamp(manifest['baselineObservedAt']) <= timestamp(fields['restore_verified_at']) <= timestamp(manifest['offhost']['verifiedAt']) <= timestamp(manifest['createdAt']), 'Recovery evidence order invalid')
    if mode == 'deploy':
        fresh(fields['restore_verified_at'], now)
    return {'root': root, 'manifestHash': digest(manifest_path), 'app': app, 'service': service,
            'old': old, 'candidate': candidate, 'rollback': rollback, 'baselineImageId': image['Id']}


def check_drift(recovery, live, pending, identities):
    old = recovery['old']
    current = live['Spec']['TaskTemplate']['ContainerSpec']
    require(live['Spec']['Name'] == SERVICE and pending['applicationId'] == APP, 'Live target mismatch')
    require(current['Mounts'] == old['Mounts'], 'Mount drift')
    require(stable_env(current['Env']) == stable_env(old['Env']), 'Runtime environment drift')
    require(stable_env(pending['env'].splitlines()) == stable_env(recovery['app']['env'].splitlines()), 'Pending environment drift')
    require(pending['sourceType'] == recovery['app']['sourceType'], 'Source type drift')
    require(pending.get('modeSwarm', 'missing') is None and pending.get('serverId', 'missing') is None, 'Application placement/Swarm mode drift')
    require(pending.get('replicas') == 1 and live['Spec'].get('Mode', {}).get('Replicated', {}).get('Replicas') in (0, 1), 'Replica configuration drift')
    require((current['Image'], git_sha(current['Env'])) in identities, 'Runtime image/SHA drift')
    require((pending['dockerImage'], git_sha(pending['env'].splitlines())) in identities, 'Pending image/SHA drift')


def ssh(command):
    return subprocess.check_output(['ssh', '-o', 'ClearAllForwardings=yes', HOST, command], text=True)


def api(root, endpoint, body=None):
    # Header file keeps the key out of process arguments and exception text.
    require(os.environ.get('DOKPLOY_API_BASE', API).rstrip('/') == API, 'Unexpected API endpoint')
    with tempfile.NamedTemporaryFile(mode='w', dir=root) as header:
        header.write('x-api-key: ' + os.environ['DOKPLOY_API_KEY'] + '\nContent-Type: application/json\n')
        header.flush()
        args = ['curl', '--fail', '--silent', '--show-error', '--max-time', '60', '--header', '@' + header.name]
        if body is not None:
            args += ['-X', 'POST', '--data-binary', '@-']
        raw = subprocess.check_output(args + [API + endpoint], input=json.dumps(body).encode() if body is not None else None)
        return json.loads(raw) if raw else None


def write_receipt(path, value, exclusive=False):
    # Exclusive intent creation prevents duplicate dispatch after interruption.
    if exclusive:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(value, output); output.flush(); os.fsync(output.fileno())
        return
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as output:
        json.dump(value, output); output.flush(); os.fsync(output.fileno())
    os.replace(output.name, path)


def inspect_service():
    return json.loads(ssh('docker service inspect ' + SERVICE))[0]


def inspect_image_id(image):
    return ssh('docker image inspect --format ' + shlex.quote('{{.Id}}') + ' ' + shlex.quote(image)).strip()


def inspect_revision(image):
    return ssh('docker image inspect --format ' + shlex.quote('{{index .Config.Labels "org.opencontainers.image.revision"}}') + ' ' + shlex.quote(image)).strip()


TERMINAL_TASK_STATES = ('complete', 'shutdown', 'failed', 'rejected', 'remove', 'removed')

def task_states():
    """One call: task id plus current state. A separate lookup by id races the
    daemon's removal of the very task that scaling to zero just stopped, which
    aborted a real deploy after quiescence and before any image change."""
    rows = []
    for line in ssh("docker service ps --format '{{.ID}} {{.CurrentState}}' " + SERVICE).splitlines():
        fields = line.split()
        if fields:
            rows.append((fields[0], fields[1].lower() if len(fields) > 1 else ''))
    return rows

def public_is_quiesced():
    """Check all task states, including shutdown-desired tasks still stopping."""
    live = inspect_service()
    require(live['Spec']['Name'] == SERVICE, 'Quiescence target mismatch')
    if live['Spec'].get('Mode', {}).get('Replicated', {}).get('Replicas') != 0:
        return False
    # Orphaned/unknown tasks cannot prove their process has stopped.
    if any(state not in TERMINAL_TASK_STATES for _, state in task_states()):
        return False
    return not ssh("docker ps --filter label=com.docker.swarm.service.name=" + SERVICE + " --format '{{.ID}}'").split()

def update_state(live):
    """Swarm reports null rather than a mapping when no update is in progress,
    which is also the settled state after Dokploy recreates the service."""
    return (live.get('UpdateStatus') or {}).get('State')

def quiesce_public():
    # Dokploy's recorded application retains replicas=1 and restores it on deploy.
    # Never depend on start-first/stop-first ordering across incompatible binaries.
    ssh('docker service scale --detach ' + SERVICE + '=0')
    for _ in range(60):
        if public_is_quiesced():
            return
        time.sleep(1)
    raise ValueError('Public tasks did not quiesce; no image update or redeploy dispatched. Intent retained for reviewed rollback.')


def execute(args):
    recovery = load_recovery(Path(args.manifest).absolute(), args.mode, args.candidate_sha, args.candidate_image)
    root = recovery['root']
    if args.check_only:
        print('Recovery manifest, local independent copy and recorded restore evidence: PASS (offline only)')
        return
    target = recovery['candidate'] if args.mode == 'deploy' else recovery['rollback']
    intent_path = root / (args.mode + '-intent.json')
    require(not intent_path.exists(), 'Existing attempt: inspect deployment queue; do not dispatch twice')
    identities = {(recovery['rollback']['image'], recovery['rollback']['sha'])}
    reviewed = json.loads(protected(root / 'queue-clear.json').read_text())
    require(reviewed['manifestHash'] == recovery['manifestHash'] and reviewed['mode'] == args.mode
            and reviewed['pendingDeployments'] == 0, 'Queue clearance does not bind this operation')
    fresh(reviewed['checkedAt'], time.time(), 15 * 60)
    if args.mode == 'rollback':
        deployed = json.loads(protected(root / 'deploy-intent.json').read_text())
        require(deployed['manifestHash'] == recovery['manifestHash'], 'Attempt belongs to another manifest')
        # Even after successful deploy the operator checks Dokploy for pending jobs.
        require(reviewed['deployIntentSha256'] == digest(root / 'deploy-intent.json') and reviewed['pendingDeployments'] == 0, 'Queue clearance does not bind deployment attempt')
        fresh(reviewed['checkedAt'], time.time(), 15 * 60)
        identities.add((recovery['candidate']['image'], recovery['candidate']['sha']))
    live = inspect_service()
    pending = api(root, '/application.one?applicationId=' + APP)
    check_drift(recovery, live, pending, identities)
    if args.mode == 'deploy':
        require(update_state(live) in (None, 'completed'), 'Baseline update is not settled')
        require(live['Spec']['Mode']['Replicated']['Replicas'] == 1, 'Expected running baseline replica')
        ids = ssh("docker service ps --filter desired-state=running --format '{{.ID}}' " + SERVICE).split()
        require(len(ids) == 1, 'Expected one baseline task')
        task = json.loads(ssh('docker inspect ' + shlex.quote(ids[0])))[0]
        require(task['Status']['State'] == 'running' and task['Spec']['ContainerSpec']['Image'] == recovery['rollback']['image'], 'Baseline task mismatch')
        actual = json.loads(ssh('docker inspect ' + shlex.quote(task['Status']['ContainerStatus']['ContainerID'])))[0]
        require(actual['Image'] == recovery['baselineImageId'] == inspect_image_id(recovery['rollback']['image']), 'Actual baseline image ID mismatch')
        require(inspect_revision(actual['Image']) == recovery['rollback']['sha'], 'Actual baseline OCI mismatch')
    ssh('docker pull ' + shlex.quote(target['image']))
    require(inspect_revision(target['image']) == target['sha'], 'Target OCI revision mismatch')
    target_image_id = inspect_image_id(target['image'])
    require(bool(target_image_id), 'Missing target image ID')
    if args.mode == 'rollback':
        require(target_image_id == recovery['baselineImageId'], 'Rollback image ID mismatch')
    # Re-check after pull, immediately before writing intent and mutating desired state.
    check_drift(recovery, inspect_service(), api(root, '/application.one?applicationId=' + APP), identities)
    receipt = {'mode': args.mode, 'manifestHash': recovery['manifestHash'], **target,
               'imageId': target_image_id, 'phase': 'quiescing', 'startedAt': datetime.now(timezone.utc).isoformat()}
    write_receipt(intent_path, receipt, exclusive=True)
    quiesce_public()
    check_drift(recovery, inspect_service(), api(root, '/application.one?applicationId=' + APP), identities)
    require(public_is_quiesced(), 'Public tasks resumed before image update; intent retained')
    receipt.update(phase='quiesced', quiescedAt=datetime.now(timezone.utc).isoformat())
    write_receipt(intent_path, receipt)
    env, count = re.subn(r'^GIT_SHA=.*$', 'GIT_SHA=' + target['sha'], recovery['app']['env'], flags=re.M)
    require(count == 1, 'Expected one SHA override')
    api(root, '/application.update', {'applicationId': APP, 'dockerImage': target['image'], 'env': env})
    require(public_is_quiesced(), 'Public tasks resumed before redeploy; intent retained')
    api(root, '/application.redeploy', {'applicationId': APP, 'title': 'ZMR ' + args.mode + ' ' + target['sha'][:7]})
    print('Requested one public deployment; verifying exact running image', flush=True)
    for attempt in range(60):
        time.sleep(5)
        live = inspect_service()
        ids = ssh("docker service ps --filter desired-state=running --format '{{.ID}}' " + SERVICE).split()
        tasks = json.loads(ssh('docker inspect ' + ' '.join(shlex.quote(i) for i in ids))) if ids else []
        current = live['Spec']['TaskTemplate']['ContainerSpec']
        if not (update_state(live) in (None, 'completed') and len(tasks) == 1
                and tasks[0]['Status']['State'] == 'running' and tasks[0]['Spec']['ContainerSpec']['Image'] == target['image']
                and current['Image'] == target['image'] and live['Spec']['Mode']['Replicated']['Replicas'] == 1):
            continue
        container_id = tasks[0]['Status']['ContainerStatus']['ContainerID']
        running = ssh("docker ps --no-trunc --filter label=com.docker.swarm.service.name=" + SERVICE + " --format '{{.ID}}'").split()
        require(running == [container_id], 'Unexpected overlapping public container')
        actual = json.loads(ssh('docker inspect ' + shlex.quote(container_id)))[0]
        require(actual['Image'] == target_image_id, 'Actual container image ID mismatch')
        require(inspect_revision(actual['Image']) == target['sha'], 'Actual container OCI mismatch')
        try:
            health = json.loads(subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--max-time', '10', HEALTH]))
        except (subprocess.CalledProcessError, ValueError):
            continue
        if health.get('status') != 'ok' or health.get('sha') != target['sha']:
            continue
        check_drift(recovery, live, api(root, '/application.one?applicationId=' + APP), {(target['image'], target['sha'])})
        write_receipt(root / (args.mode + '-verified.json'), {**receipt, 'health': health, 'task': ids[0],
                      'container': container_id, 'verifiedAt': datetime.now(timezone.utc).isoformat()})
        print(json.dumps({'mode': args.mode, **target, 'health': 'PASS', 'otherEnvAndMounts': 'unchanged'}))
        return
    raise ValueError('Not converged; inspect existing Dokploy queue before recovery. Intent retained; no automatic retry or data restore.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['deploy', 'rollback'])
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--candidate-sha')
    parser.add_argument('--candidate-image')
    parser.add_argument('--check-only', action='store_true', help='Offline manifest/checksum validation; no production calls')
    args = parser.parse_args()
    if args.mode == 'deploy' and not (args.candidate_sha and args.candidate_image):
        parser.error('Deploy requires explicit full candidate SHA and immutable image')
    if args.mode == 'rollback' and (args.candidate_sha or args.candidate_image):
        parser.error('Rollback derives identity from protected actual baseline snapshots')
    try:
        execute(args)
    except (ValueError, KeyError, IndexError, OSError, subprocess.CalledProcessError) as error:
        # Do not print potentially secret snapshot content or subprocess response bodies.
        raise SystemExit('Deployment guard failed: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__)) from None


if __name__ == '__main__':
    main()
