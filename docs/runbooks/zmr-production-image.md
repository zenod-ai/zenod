# Public Zenod candidate deployment and code rollback

This is operator tooling preparation for [ZMR-16 #1242](https://github.com/zenod-ai/zenod/issues/1242). It is not deployment evidence or acceptance of that ticket. Actual use waits for the reviewed ZMR-15 candidate, recovery preparation, and the delivery manager's rollout dispatch.

The helper targets only public Zenod, application `2dkayH_eAur427leH64MT`, service `zenod-mt-fxpzoo` on `hetzner_vps_1`. It changes the immutable image and existing `GIT_SHA` override through Dokploy. Other environment entries and mounts must match the protected baseline. Phylax is excluded. Code rollback keeps current data; semantic changes are not reversed, and no data restoration is performed.

## Prepare fresh protected recovery evidence

Run locally on the independent operator machine. Create a new owner-only directory outside Git (`umask 077`, directory mode 0700; files 0600). Never reuse the September 6/8 recovery directories or retarget a completed manifest to another candidate.

After the exact candidate SHA/digest and compatibility review are accepted:

1. Capture fresh public `application.one`, `docker service inspect`, running `docker inspect CONTAINER_ID`, and `docker image inspect ACTUAL_IMAGE_ID` JSON into `app.before.json`, `service.before.json`, `container.before.json`, and `image.before.json`. Record the observation time. Keep full snapshots private because they include environment secrets. The image's OCI revision, application/runtime SHA and image identities must agree. Require one healthy running task and the `zenod-mt-data:/data` mount.
2. Reuse [zenod-volume-backup.sh](../../scripts/zenod-volume-backup.sh) on the exact public container and volume. This operation pauses the workload temporarily; it is a rollout action, not part of offline helper validation. The script archives a quiesced volume, resumes service, and runs the existing JSON/SQLite verifier against a disposable restore volume. Preserve the successful complete log and `.sha256` file. A partial log without final `restore_verified_at` is rejected.
3. Independently copy that archive, checksum, log and baseline snapshots onto the local operator machine, preserving owner-only permissions. Verify the copied archive against the original checksum. The helper streams the entire local archive through SHA256 again. This is the required verified offhost copy; separately record encrypted cloud replication if used. Do not claim a pending upload is complete.
4. Write `recovery.json` in the same directory. Every path below must be one direct-child filename. Compute SHA256 values from the actual copied files; never type success placeholders or invent receipts. All baseline, restore and manifest timestamps must reflect the actual operations. Deploy rejects observations/restores older than 24 hours; rollback remains available after that freshness window.

Manifest shape (replace illustrative values with verified facts):

```json
{
  "version": 1,
  "createdAt": "2026-09-13T18:00:00Z",
  "baselineObservedAt": "2026-09-13T17:50:00Z",
  "target": {
    "applicationId": "2dkayH_eAur427leH64MT",
    "service": "zenod-mt-fxpzoo",
    "host": "hetzner_vps_1"
  },
  "candidate": {
    "sha": "FULL_REVIEWED_40_HEX_SHA",
    "image": "ghcr.io/zenod-ai/zenod@sha256:FULL_64_HEX_DIGEST"
  },
  "offhost": {
    "host": "ACTUAL_INDEPENDENT_OPERATOR_HOST",
    "method": "independent-local-copy",
    "verifiedAt": "2026-09-13T17:59:00Z"
  },
  "files": {
    "app": {"path": "app.before.json", "sha256": "FILE_SHA256"},
    "service": {"path": "service.before.json", "sha256": "FILE_SHA256"},
    "container": {"path": "container.before.json", "sha256": "FILE_SHA256"},
    "image": {"path": "image.before.json", "sha256": "FILE_SHA256"},
    "archive": {"path": "zenod-data-ACTUAL_TIMESTAMP.tar.gz", "sha256": "FILE_SHA256"},
    "checksum": {"path": "archive.sha256", "sha256": "FILE_SHA256"},
    "backupLog": {"path": "backup.log", "sha256": "FILE_SHA256"}
  }
}
```

The rollback image is derived from `service.before.json`; its source SHA comes from the actual image's OCI label in `image.before.json`. There are no historic default candidate or rollback values. The restore log must name the copied archive, its original checksum path, and the public service. Its successful restore timestamp must precede the offhost verification and manifest timestamps. Checksums bind these operator-produced records; they do not independently prove that an operator performed an honestly reported restore. Preserve the real command output for review.

## Validate and dispatch once

Offline validation does not connect to production, extract credentials, pause workloads or pull images:

```sh
python3 scripts/zmr-production-image.py deploy \
  --manifest /ABSOLUTE/PROTECTED/recovery.json \
  --candidate-sha FULL_REVIEWED_SHA \
  --candidate-image ghcr.io/zenod-ai/zenod@sha256:FULL_DIGEST \
  --check-only
```

Immediately before deployment, inspect the existing Dokploy deployment queue and confirm no pending/running deployment can supersede this operation. Save private `queue-clear.json` with actual inspection time, `manifestHash` (SHA256 of `recovery.json`), `mode: "deploy"`, `pendingDeployments: 0`. This is an explicit operator attestation, not an automatic queue inspection; the helper requires it to be at most 15 minutes old. One operator owns the window. Do not generate this file without inspecting the queue.

Load the existing Dokploy credential through the established keychain helper, then invoke the same command without `--check-only`:

```sh
eval "$(dokploy-env)"
```

The helper verifies current service/application identity, source SHA, non-SHA environment, and mounts against the recorded baseline; verifies the actual baseline task's OCI revision; pulls the immutable candidate and validates its OCI revision; then rechecks configuration. It writes an exclusive protected `deploy-intent.json` **before** desired-state mutation. It dispatches exactly one redeployment and checks completed Swarm update, one running task, exact service/task digest, actual running container OCI revision, healthy exact SHA, and preserved environment/mounts. `deploy-verified.json` is written only after these checks pass. Neither receipt proves customer memory acceptance; ZMR-17 owns that.

The helper changes only image and SHA fields. Other Dokploy configuration fields are retained server-side; it is not a general configuration drift auditor. The manager must review the exact non-secret delta and candidate compatibility first. Keep concurrent operator changes out of this window.

## Interrupted operation and code rollback

Any existing intent prevents duplicate dispatch, including when the process failed between application update and redeploy. Do not delete it and retry. Inspect Dokploy's queue and desired/actual state first. Resolve or cancel pending deployment jobs using the established operator process, then record a new `queue-clear.json`:

```json
{
  "manifestHash": "SHA256_OF_RECOVERY_JSON",
  "mode": "rollback",
  "deployIntentSha256": "SHA256_OF_DEPLOY_INTENT_JSON",
  "pendingDeployments": 0,
  "checkedAt": "ACTUAL_RECENT_QUEUE_INSPECTION_TIME"
}
```

After the queue is accounted for, run:

```sh
python3 scripts/zmr-production-image.py rollback \
  --manifest /ABSOLUTE/PROTECTED/recovery.json
```

Rollback permits the recorded baseline/candidate image-SHA pairs only, including the intermediate state where application desired image changed but runtime did not. It restores the baseline image and SHA, refuses unrelated environment/mount drift, and writes its own intent before mutation. A second interrupted rollback requires operator diagnosis; it never automatically retries or forces a Swarm fallback. Preserve all receipts. Later upgrades require a new fresh baseline/candidate/recovery directory.

Offline regression suite:

```sh
python3 scripts/zmr-production-image.test.py
```
