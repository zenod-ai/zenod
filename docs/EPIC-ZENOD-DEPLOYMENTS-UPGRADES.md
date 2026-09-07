# Zenod deployments and upgrades

Status: current — bounded production upgrade verified; deployment scope enforced
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
Last reconciled commit: 29ddb62d349d9f3bd9c5b471848a4ef775155827 running

## Mission

Permanent repository deployment scope, explicitly set by Jordi on 2026-09-07: **live Zenod production images and, when appropriate, the default Phylax/WhatsApp companion only**. No other agent/service may automatically deploy from pushes, merges or releases in this repository. Default Phylax is not a blanket authorization to restart unrelated private services on every release. The four legacy sibling triggers stay disabled.

Keep one simple, supported upgrade and undo process. Reuse Dokploy and the existing backup/operator scripts; do not rebuild a deployment procedure for every release. This leaf owns operational learnings; [Memory Reliability](EPIC-ZENOD-MEMORY-RELIABILITY.md) owns that release's customer acceptance.

## Current State

Phase: bounded production upgrade complete; final affected live checks passed.
Running source: `29ddb62d349d9f3bd9c5b471848a4ef775155827`.
Running image: `ghcr.io/zenod-ai/zenod@sha256:fab0414121a6912ace825f3cdf07fc5f508944afc3cafec7352660db32a83042`.
Verified: Swarm update completed 2026-09-07 00:17:23 UTC; actual container 572e253d41a8, OCI revision and public health match.
Scope: public Zenod only; private Phylax unchanged. No migration or data restoration.
Recovery: verified VPS archive, independent checksum-matched Mac copy, encrypted cloud upload and decrypted download comparison complete; original rollback receipt retained.
Live tests: filing repair passed; final boundary recall passed 3/3 fresh conversations with current evidence citations. [Exact final evidence](evidence/zmr-live-29ddb62/README.md). Broader memory-release benchmarks remain separate.
Next action: use this leaf for the next authorized upgrade; no further deployment requested.

## Execution Cursor

Last attempted: deploy reviewed PR #1226 after CI/publication, verify runtime and repeat the affected live question.
Result: actual29ddb62 verified; three fresh recalls passed. Bounded deployment work complete.
Execution status: complete for this upgrade
Waiting on: no production action; durable receipt integration only.
Approved work: current bounded upgrade completed; future upgrades follow applicable authorization and the procedure below.
Next action: retain recovery receipt and disabled unrelated automatic deployments; repository separation and broader acceptance remain follow-ups.

Prior repair `56c815f38aab6790b8afc165a8001e8fc0b5732b` was verified live on `ghcr.io/zenod-ai/zenod@sha256:4baf0239c48c0aba3acbab797d3ba441c5f10bee2bc1c82a1f5bb388a623e342`. Retained job 10083 completed; the queue was empty (zero active/waiting) at verification. Actual container `0ba7100e3ec6` OCI revision matched, with one running task, completed Swarm update, health OK, unchanged mount and 52 non-SHA environment entries. Private Phylax stayed on `sha256:1ae6607fb5cabf059a7058ae0b80abc2a492dab32d034b903dc920b73759b53e`. See the correction below for the cause and permanent trigger pause.

## Upgrade and undo

The existing helper supports this September 6 release and reviewed code-only repairs using its frozen recovery receipt. The reviewed helper is merged through [PR #1218](https://github.com/zenod-ai/zenod/pull/1218). It is not a generic backup/deployment framework. Reuse the flags below rather than copying or editing release constants.

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

If a future candidate remains queued, first cancel that exact pending candidate request through the supported queue operation after rechecking its application and waiting state, then invoke rollback. Otherwise an already queued upgrade could run after the undo. Do not cancel unrelated jobs.

Rollback changes code, not data. It retains captures written after deployment. Restoring an older data archive can erase later writes and needs a separately scoped recovery decision; never silently restore over the live volume.

## Backup policy

The current mechanism is `scripts/zenod-volume-backup.sh`: quiesce, archive, resume, checksum, then restore into a disposable volume and verify JSON/SQLite. This rollout paused public Zenod approximately three minutes (19:56–19:59 UTC): 1.6 GB source produced a 1.4 GB archive. Restore passed at 20:01:48 UTC with 1,127 files, 10 JSON files and 69 SQLite databases. Full backup and encrypted transfer dominated preparation time; the image update itself completed in seconds.

Today's accepted recovery proof is the fresh verified VPS archive plus independent checksum-matched Mac copy, mode 0600 inside a mode-0700 directory. Configuration receipts are already encrypted-uploaded and download-checked. The full 1,498,818,408-byte encrypted object upload and decrypted download comparison subsequently passed; the rollout did not wait for that redundant transfer. The established remote is `zenod-prod-crypt:` backed by `s31:vps-archives/zenod-production-encrypted`.

For future code-only upgrades with unchanged storage contracts, prefer a fresh recoverable scheduled backup and an already validated restore mechanism. Reuse within one repair rollout only when its recovery point and subsequent writes are recorded and accepted; do not repeatedly pause for identical proof. If a qualifying backup is absent, take a fresh one. A new destructive/storage migration needs fresh backup and a separate restoration plan. This is the reuse rule, not a claim that a qualifying scheduled backup currently exists. Incremental backup redesign is deferred. Another measured source of delay is CI/publishing: documentation-only PRs run the full product suite, and publication serially builds/checks both product images even when only public Zenod is being deployed. Path-aware documentation checks and affected-product publication are future simplifications; no pipeline redesign was mixed into this repair.

## Decisions and durable lessons

1. **Production authorization persists within scope.** Jordi authorized this single-user deployment, tests and fixes. Do not re-ask for staging/provider setup already supplied by production. Future upgrades require their own applicable authorization.
2. **Deploy the smallest service set.** Memory-only code needed public Zenod; restarting private Phylax added no benefit.
3. **Prove the actual version.** Merge, publication, desired image and health are different facts. Require actual task/container identity and OCI source too.
4. **Preserve both runtime and pending configuration.** This release changed only `GIT_SHA` among 53 runtime entries. Refuse drift in both Swarm and Dokploy before writing the captured environment back.
5. **Code rollback is not data rollback.** No migration occurred, but additive memory metadata and later composition have compatibility limits. Preserve raw captures; never promise zero risk or automatic reversal of written semantics.
6. **Backup cost needs proportion.** A full cold archive caused the pause; cloud transfer took longer. Independent verified recovery allowed the slow redundant transfer to continue separately, explicitly disclosed.
7. **Reuse safe working transport.** Cloudflare rejected Python urllib's admin request fingerprint; existing curl worked. Keep API headers in temporary mode-0600 files, out of process arguments and exception messages.
8. **Test the real memory paths separately.** Exact reads/chat passed while natural-query recall and automatic filing failed. A saved raw record or healthy deployment does not prove customer acceptance; retain these live regressions.

9. **Accepted is not started.** Dokploy can return HTTP 200 with an empty body while the request waits in its global BullMQ queue. The deployment-history endpoint only showed worker-started records. Both deploy and redeploy were working; changing endpoint names was not a demonstrated fix. A convergence timeout must trigger read-only queue inspection before any retry. Preserve the earliest request; cancel only verified duplicates with a supported operation. Never restart shared services or force Swarm merely to bypass the queue.

## Evidence and ownership

[Production receipt](evidence/zmr-production-2026-09-06/README.md) owns deployment and backup proof. The [ZMR spine](EPIC-ZENOD-MEMORY-RELIABILITY.md) owns live regression results and the repair cursor. Actual container image ID was `sha256:f0b913fb3cfc6de695a04262e1d53af3e1eafc973ed1f9d742665d2c37ec5405`; task, OCI source and health matched the candidate at 20:06:05 UTC.

One operator mutates production at a time: `/root/zmr_deploy_audit` performed this rollout; the manager coordinates later assignments and remains sole leaf steward. On takeover, record incoming owner, time, receipt and actual runtime before retrying an interrupted operation. Source changes use isolated worktrees and reviewed CI-green PRs; never patch generated VPS code or the dirty shared clone. Console-specific [C1 instructions](C1-DEPLOYMENT.md) are not this public Zenod contract.

This is a direct Foundation leaf with no children. Its creation and one reciprocal Foundation row were delegated to `/root/deployment_spine_leaf`; stewardship returns to ZMR-delivery-manager at handoff. No sibling spine write authority follows from this leaf. Generic sprint templates are intentionally shortened per Jordi's request for a lightweight routine; direct live MCP tests are the approved current acceptance surface. No new ticket ceremony, generic CLI, or browser screenshot checklist blocks this upgrade.

## 2026-09-07 — clear deployment path correction

The queue was not old development work legitimately blocking Zenod. Deployment descriptions proved our own `main` merges triggered source builds for Epaminon, Outbound, Callisthenes and x-mcp. All four compose services had `autoDeploy=true`, branch `main`, and no watch-path filter. Even documentation-only merges queued their builds. The manager should have inspected triggers before repeatedly merging and waiting.

Jordi explicitly authorized clearing this backlog and making future Zenod upgrades straightforward. The sole operator privately backed up all four complete compose configurations, changed only `autoDeploy` to false, verified the values, and removed ten unrelated pending jobs using supported BullMQ `Job.remove`. One Zenod job 10083 was preserved. Runtime settings, services and data were not changed. One already active local Outbound build was allowed to finish: the installed cancellation handler supports cloud/remote builds, not this local build; no shared worker or running service was killed.

Future path: legacy sibling services remain manually deployed until deliberately re-enabled; do not re-enable broad main-push deployment as part of a Zenod upgrade. A Zenod release reviews/merges code, publishes an immutable image, submits one public-service deployment, checks its actual queued/active/completed state and live version, and runs direct MCP smoke checks. Documentation changes do not need a production redeployment. Configuration backups make the trigger pause reversible, but restoring it recreates broad automatic builds unless path filters are designed first.

Verification: job 10083 subsequently completed at 22:15:07.905 UTC; zero active/waiting jobs remained. Configuration snapshots are privately stored under `/Users/jordi/.local/state/zenod-zmr-production-20260906/queue-cleanup/` and encrypted-copy/download verified under `zenod-prod-crypt:zmr-20260906/queue-cleanup`. The four IDs are epaminon `x9WtBYq_vcUFPW2WADcQP`, outbound `m9lceZf789T5ML8jznm79`, callisthenes `3_7gC5XUpAvFV4NSTWEZf`, and x-mcp `NYUUcRopSdjmfRGoEWzHL`. Deliberate re-enable uses authenticated `POST /compose.update` with only `{composeId: ID, autoDeploy: true}`; no redeploy is required. Do not expose full configuration backups.

## Follow-up repository separation

Move Epaminon, Outbound, Callisthenes, x-mcp and other independent agents into their own repositories with independent build/deploy triggers, preserving their running services and data. This is a separate incremental migration, not part of the current minimal Zenod upgrade. Until then, source co-location must not recreate shared automatic deployment. The immediate boundary is also enforced by repository agent instructions in `AGENTS.md`.

## 2026-09-07 — live filing proof and remaining recall issue

Historical filing verification: optional-refinement fix #1223 was deployed as `c5da66f`, image `sha256:d1b4b7448f9e681ef750710a6fd11d2f7368fe6dc717a35e0f1f60ad2f76561d`. Actual container `5c970815fc35` OCI, task and health verified; mount, 52 other environment entries and private image preserved. Inventory across six Dokploy projects found only the four known Zenod-source bindings, all with automatic deployment disabled.

Live filing job `31c1d895-d5bb-4b06-9129-65bf9b109796` succeeded: one topic, zero uncertain/pending, `Projects/Zenod.md`, revision `c906053fe23f8fb34d2c7ef154cf3ce6c9cdb5ba`, evidence `Log/2026-09-06.md#^e-7c5eb9`. The one classification call succeeded; this live run did not exercise fallback failure, which is covered by deterministic regression tests.

The subsequent open-ended recall still selected old page text and returned obsolete Herald scope. Direct read verified five correct new `memoryFacts` on the saved page; ordinary `read_note` omits frontmatter and the 10,758-character page places its fact updates late. A bounded reuse of verified-fact projection on ordinary meaning-page reads is assigned under #1196; exact/historical scope must remain intact. No full memory-acceptance claim follows from successful filing.

Final operator preservation receipt: all 52 non-GIT_SHA environment entries and mounts match the baseline; private Phylax remains on sha256:1ae6607fb5cabf059a7058ae0b80abc2a492dab32d034b903dc920b73759b53e. Queue has zero active/waiting/delayed/prioritized jobs. Fresh API reads confirm epaminon, outbound, callisthenes and x-mcp automatic deployment disabled. No additional backup pause, cleanup or unrelated restart. Protected runtime receipt: `/Users/jordi/.local/state/zenod-zmr-production-20260906/public-service.29ddb62.json`.
