# Zenod deployments and upgrades

Status: active — production upgraded; memory acceptance fixes in progress
Updated: 2026-09-06
Repository: zenod-ai/zenod
Primary document: `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md`
Spine ID: ZDU
Spine Type: branch
Root spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Active spine steward: ZMR-delivery-manager
Last reconciled commit: 500c28d documentation base; deployed product 392d058a599bdf5fc69d17157282b8f9154dcf28

## Mission

Keep one simple, supported upgrade and undo process. Reuse Dokploy and the existing backup/operator scripts; do not rebuild a deployment procedure for every release. This leaf owns operational learnings; [Memory Reliability](EPIC-ZENOD-MEMORY-RELIABILITY.md) owns that release's customer acceptance.

## Current State

Phase: public production upgrade verified at 2026-09-06 20:06:05 UTC; live memory fixes active.
Running source: `392d058a599bdf5fc69d17157282b8f9154dcf28`.
Running image: `ghcr.io/zenod-ai/zenod@sha256:d21468dbf09f33550c52eb53bed32adea616842b4a144cd5cda428861f151a93`.
Scope: public Zenod only; 52 non-SHA environment entries, mounts and private Phylax unchanged. No storage migration.
Recovery: fresh VPS archive restored and verified; independent Mac copy checksum matches. Encrypted cloud upload and full decrypted download comparison have also completed successfully.
Live tests: immutable learning `6910ca17` saved; exact read and chat passed. Automatic filing returned `classification_unavailable`; natural-language retrieval falsely reported absence. These remain unresolved; overall acceptance has not passed.
Next action: finish the bounded memory repair, repeat the failing live checks and record the actual deployed repair version.

## Execution Cursor

Last attempted: deploy approved image, verify actual running version and exercise authenticated live MCP capture/retrieval.
Result: deployment succeeded; raw learning survived, but filing and natural-query recall need repair.
Execution status: active
Waiting on: assigned memory repair and revalidation; no new user decision for this authorized work.
Approved work: bounded production testing/fixes and easy code rollback. Optional small operator parameterization only if convenient; a generic CLI is not a release blocker.
Next action: reconcile the repair handoff and repeat the same live checks before claiming acceptance.

## Upgrade and undo

The existing helper supports this September 6 release and reviewed code-only repairs using its frozen recovery receipt. Its reviewed head is [4916c24](https://github.com/zenod-ai/zenod/commit/4916c24) in [PR #1218](https://github.com/zenod-ai/zenod/pull/1218). It is not a generic backup/deployment framework. Reuse the flags below rather than copying or editing release constants.

From `/Users/jordi/Documents/GitHub/wt-zmr-production` (or the repository after integration):

```sh
eval "$(dokploy-env)"
python3 scripts/zmr-production-image.py deploy
# A reviewed code-only repair using this same approved recovery receipt:
python3 scripts/zmr-production-image.py deploy --candidate-sha FULL_SHA --candidate-image ghcr.io/zenod-ai/zenod@sha256:FULL_DIGEST --state-dir SECURE_RECEIPT_DIR
# Undo this release while retaining the current data volume:
python3 scripts/zmr-production-image.py rollback
```

Replace the uppercase repair placeholders with the reviewed full source SHA, matching immutable image digest and existing secure receipt path; both candidate flags are required together. The helper atomically records approved attempted/prior images, so rollback still works after an interrupted repair. Three offline simulations cover override→rollback, sequential overrides→rollback, and a failed second override→rollback.

The matching secure receipt defaults to `/Users/jordi/.local/state/zenod-zmr-production-20260906`; `ZMR_DEPLOY_STATE` may point to that receipt's recovered location. Rollback targets prior source `fb8b07c5910b3424c4a15da4e1cfaa920cee4e22`, image `sha256:c4d5fbf98818ca407ef445159965143cffc519a38f6c63e4e8c4f04230ba286d`. No live rollback was performed during this successful image switch. Do not invoke `deploy` merely to check status.

For every upgrade:

1. Pin reviewed source and immutable published image; compare actual running state and OCI source. Select only the service affected by the change.
2. Save exact configuration and rollback image privately. Require a recoverable backup under the policy below. Use the existing Keychain-backed loader and SSH alias `hetzner_vps_1`; never paste credentials into Git or chat.
3. Update the image and necessary source-SHA override through Dokploy. Refuse unexpected runtime or pending Dokploy configuration drift. Preserve volumes, sessions and unrelated settings.
4. Require completed Swarm update, the actual running task's exact image, actual container OCI revision, correct health SHA and the product's live smoke checks. Desired state or a healthy endpoint alone is insufficient. On failure, inspect the receipt before retrying; use code rollback when appropriate.

Rollback changes code, not data. It retains captures written after deployment. Restoring an older data archive can erase later writes and needs a separately scoped recovery decision; never silently restore over the live volume.

## Backup policy

The current mechanism is `scripts/zenod-volume-backup.sh`: quiesce, archive, resume, checksum, then restore into a disposable volume and verify JSON/SQLite. This rollout paused public Zenod approximately three minutes (19:56–19:59 UTC): 1.6 GB source produced a 1.4 GB archive. Restore passed at 20:01:48 UTC with 1,127 files, 10 JSON files and 69 SQLite databases. Full backup and encrypted transfer dominated preparation time; the image update itself completed in seconds.

Today's accepted recovery proof is the fresh verified VPS archive plus independent checksum-matched Mac copy, mode 0600 inside a mode-0700 directory. Configuration receipts are already encrypted-uploaded and download-checked. The full 1,498,818,408-byte encrypted object upload and decrypted download comparison subsequently passed; the rollout did not wait for that redundant transfer. The established remote is `zenod-prod-crypt:` backed by `s31:vps-archives/zenod-production-encrypted`.

For future code-only upgrades with unchanged storage contracts, prefer a fresh recoverable scheduled backup and an already validated restore mechanism. Reuse within one repair rollout only when its recovery point and subsequent writes are recorded and accepted; do not repeatedly pause for identical proof. If a qualifying backup is absent, take a fresh one. A new destructive/storage migration needs fresh backup and a separate restoration plan. This is the reuse rule, not a claim that a qualifying scheduled backup currently exists. Incremental backup redesign is deferred.

## Decisions and eight durable lessons

1. **Production authorization persists within scope.** Jordi authorized this single-user deployment, tests and fixes. Do not re-ask for staging/provider setup already supplied by production. Future upgrades require their own applicable authorization.
2. **Deploy the smallest service set.** Memory-only code needed public Zenod; restarting private Phylax added no benefit.
3. **Prove the actual version.** Merge, publication, desired image and health are different facts. Require actual task/container identity and OCI source too.
4. **Preserve both runtime and pending configuration.** This release changed only `GIT_SHA` among 53 runtime entries. Refuse drift in both Swarm and Dokploy before writing the captured environment back.
5. **Code rollback is not data rollback.** No migration occurred, but additive memory metadata and later composition have compatibility limits. Preserve raw captures; never promise zero risk or automatic reversal of written semantics.
6. **Backup cost needs proportion.** A full cold archive caused the pause; cloud transfer took longer. Independent verified recovery allowed the slow redundant transfer to continue separately, explicitly disclosed.
7. **Reuse safe working transport.** Cloudflare rejected Python urllib's admin request fingerprint; existing curl worked. Keep API headers in temporary mode-0600 files, out of process arguments and exception messages.
8. **Test the real memory paths separately.** Exact reads/chat passed while natural-query recall and automatic filing failed. A saved raw record or healthy deployment does not prove customer acceptance; retain these live regressions.

## Evidence and ownership

[Production receipt](evidence/zmr-production-2026-09-06/README.md) owns deployment and backup proof. The [ZMR spine](EPIC-ZENOD-MEMORY-RELIABILITY.md) owns live regression results and the repair cursor. Actual container image ID was `sha256:f0b913fb3cfc6de695a04262e1d53af3e1eafc973ed1f9d742665d2c37ec5405`; task, OCI source and health matched the candidate at 20:06:05 UTC.

One operator mutates production at a time: `/root/zmr_deploy_audit` performed this rollout; the manager coordinates later assignments and remains sole leaf steward. On takeover, record incoming owner, time, receipt and actual runtime before retrying an interrupted operation. Source changes use isolated worktrees and reviewed CI-green PRs; never patch generated VPS code or the dirty shared clone. Console-specific [C1 instructions](C1-DEPLOYMENT.md) are not this public Zenod contract.

This is a direct Foundation leaf with no children. Its creation and one reciprocal Foundation row were delegated to `/root/deployment_spine_leaf`; stewardship returns to ZMR-delivery-manager at handoff. No sibling spine write authority follows from this leaf. Generic sprint templates are intentionally shortened per Jordi's request for a lightweight routine; direct live MCP tests are the approved current acceptance surface. No new ticket ceremony, generic CLI, or browser screenshot checklist blocks this upgrade.
