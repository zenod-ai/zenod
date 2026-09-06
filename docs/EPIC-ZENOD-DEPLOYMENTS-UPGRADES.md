# Zenod deployments and upgrades

Status: active
Created: 2026-09-06
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
Steward since: 2026-09-06 Europe/Paris
Last reconciled commit: 500c28d — documentation base; production candidate separately pinned below
Planner: Jordi + ZMR-delivery-manager
Worker: sole deployment operator `/root/zmr_deploy_audit`
Tester: ZMR-delivery-manager

## Mission

Make a routine Zenod upgrade a small, repeatable operation: name the reviewed candidate, preserve the existing service configuration and data, deploy through Dokploy, prove the actual running version, and retain one explicit code-rollback command. Keep the operational lessons here so future releases reuse the supported path instead of assembling a new script or approval ceremony. This leaf owns the reusable process; product spines own their release acceptance.

## Current State

Phase: recording the minimal supported path during the authorized Memory Reliability production rollout
Last verified: 2026-09-06 Europe/Paris
Integration target: main
Fresh base commit: 500c28d; production candidate 392d058a599bdf5fc69d17157282b8f9154dcf28
Pinned-base rule: pinned; no rebases until the journey passes. Documentation movement does not replace the tested product candidate.
Dispatch condition: Jordi has authorized production deployment, testing, fixes, easy undo and durable simplification in the current task.
Next action: finish the current rollout and document its verified upgrade/rollback commands; parameterize only if a small, safe follow-up.
Blockers: no new user approval needed for this authorized rollout; final live evidence is pending; a generic wrapper is optional, not a release blocker.

## Execution Cursor

Last attempted: inventoried the current image-switch operator, backup script, historical release packet and target service with the sole production operator.
Result: a reusable base exists; current script is release-pinned; narrow parameterization is useful only if convenient now. A live rollout is in progress, not yet claimed successful here.
Execution status: active
Waiting on: sole deployment operator's final convergence, backup and rollback receipt evidence.
Approved work: complete the requested production upgrade and tests; review a small operator simplification if convenient; keep this leaf current.
Next action: reconcile the final operator handoff and replace the proposed command contract with actual tested commands.

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic worker | ZMR-delivery-manager | ZDU process and ZMR rollout | Coordinate, reconcile this leaf, integrate reviewed changes, own live acceptance. | Exact running version, reusable commands, residual limitations. |
| Ticket worker | /root/zmr_deploy_audit | Current public Zenod deployment | Sole production mutator; implement operator within delegated scope. | Secure receipt, sanitized evidence, rollback command. |
| Planner | /root/deployment_spine_leaf | New leaf plus atomic Foundation registration | Document design only; no production or operator changes. | Reviewed leaf and compact parent row. |
| Tester | ZMR-delivery-manager | Live customer journey | Validate the deployed candidate and report exact evidence. | Product acceptance to ZMR; process lessons to ZDU. |

## Write Scope

Bound spine: this document. Active steward: ZMR-delivery-manager.
Explicit narrow delegation: `/root/deployment_spine_leaf` authors this new leaf and its one Foundation registration row; no sibling state changes. Once handed off, the manager is the sole writer. Product [Memory Reliability](EPIC-ZENOD-MEMORY-RELIABILITY.md), [Phylax](EPIC-P-PHYLAX-SPRINT.md), and historical Alpha spines are read-only context. Record outgoing/incoming owner and time before any later stewardship transfer.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This leaf | Supported upgrade process, learned traps, scope and process backlog |
| Product spine and issue | Release intent and customer acceptance |
| Reviewed code and PR | Operator behavior actually implemented |
| Deployment receipt and named validation evidence | Exact running image/source, configuration comparison and pass/fail |
| Foundation | Parentage and project routing |

## Spine Map

Canonical lineage: Foundation → ZDU. No child spines.

Cross-link: [ZMR](EPIC-ZENOD-MEMORY-RELIABILITY.md) supplied the first rollout and owns its customer acceptance. This reusable process is a direct Foundation child because it also serves later releases.

## Definition Of Done

SHIP — manager verifies the actual deployed version and exercises the live MCP capture/retrieval journey. Jordi explicitly preferred direct MCP tests for this rollout over an unavailable browser chat journey. This user-approved scope overrides the generic sprint browser requirement; do not manufacture browser evidence. Fix the first failure and repeat the same bounded journey.

- [ ] 1. Select the exact reviewed/published candidate and produce a read-only plan showing service, source, immutable image, config delta and rollback baseline — PORT from the ZMR image operator and publish proof.
- [ ] 2. Execute the supported upgrade, obtaining a secure receipt and verified backup reference without changing unrelated service configuration — PORT from the existing image operator and `scripts/zenod-volume-backup.sh`.
- [ ] 3. Verify actual running task, OCI source, immutable image and health; authenticate through the existing live MCP connection — PORT from current rollout checks and ZMR journey.
- [ ] 4. Capture one synthetic memory and retrieve it, with accurate evidence and no missing existing content — PORT from the ZMR live acceptance journey. Record every test write for bounded cleanup.
- [ ] 5. Confirm the receipt supplies a usable code-rollback command, mechanically test rollback failure modes, and hand the same MCP journey to Jordi — PORT from the pinned rollback operator. A live rollback demonstration is recorded only if actually performed.

HARDEN — deferred until Jordi approves SHIP:

- [ ] Incremental/snapshot backup mechanism that reduces pause time, with one restore drill before replacing the existing archive mechanism.
- [ ] Optional staging service or automated browser journey. Its absence does not block today's explicitly authorized single-user production test.

## Bootstrap Map

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | [Foundation](EPIC-0-FOUNDATION-SPINE.md) | Routing and current project scope | Always |
| 2 | This document | One upgrade process and lessons | Every upgrade |
| 3 | `scripts/zenod-volume-backup.sh` and `.test.sh` | Existing quiesce, resume, checksum and disposable restore mechanism | Backup changes |
| 4 | [Current rollout evidence](evidence/zmr-production-2026-09-06/README.md) | Exact deployment and recovery record; supplied by operator's companion change | Current deployment |
| 5 | [ZMR validation](evidence/zmr-8-release-validation/README.md) | Product candidate evidence | This release |
| 6 | [Historical release packet](evidence/zpf-10-release-gate-2026-08-27/README.md) | Established encrypted backup mechanism; older multi-service gates are release-specific | Recovery context |

## Supported workflow

**Current implementation:** the operator worktree contains `scripts/zmr-production-image.py deploy|rollback`, pinned to the September 6 release. Its code and live evidence remain in the operator's companion change until reviewed and integrated. It is not a general upgrade command. Do not copy it and substitute SHAs for each future release.

**Optional narrow improvement:** accept a candidate and secure receipt instead of hardcoded release values, retaining the existing deploy/rollback checks. Do this now only if convenient and safely tested; a broader CLI redesign is not required for deployment. The four stages below are process requirements, not commands advertised as implemented.

1. **Plan:** read the current Dokploy application and actual Swarm task; resolve the candidate source SHA to an immutable published image and check OCI source labels. Show only target, old/new versions, mount and configuration comparison, backup requirement and rollback feasibility. Fail before mutation on source/image mismatch or unexpected drift.
2. **Upgrade:** snapshot the exact current application/service configuration into a private receipt outside Git, choose the backup policy below, then update only the selected application's image and necessary source-SHA override through Dokploy. Preserve credentials, provider/commercial/signup settings, mounts, sessions and unrelated services.
3. **Verify:** wait for desired service and actual running task to converge to the immutable image, inspect actual container OCI source, require completed update and correct health SHA, then run the product's live smoke journey. Return a nonzero result and the receipt location on timeout or mismatch. Never silently force a Swarm image update around failed Dokploy reconciliation.
4. **Undo:** use the receipt to restore the previous immutable image and previous SHA/configuration through Dokploy, refuse unexpected drift, and run the same convergence checks. Keep the live data volume. Data restore is a different, explicitly scoped operation because it can erase writes made after the snapshot.

Use the existing macOS Keychain-backed `dokploy-env` credential loader and SSH alias `hetzner_vps_1`; do not ask Jordi to paste working credentials or print secrets. Receipts belong in a mode-0700 directory with mode-0600 files. Commit only sanitized evidence and recovery instructions. A receipt must remain recoverable through the existing encrypted backup mechanism (`zenod-prod-crypt:` → `s31:vps-archives/zenod-production-encrypted`).

## Backup policy

The existing backup is a consistent **cold/quiesced full archive**, not incremental. It resumes the service before disposable-volume integrity verification. The September 6 archive pause was approximately three minutes (19:56–19:59 UTC); the source was 1.6 GB and the compressed archive 1.4 GB. The disposable restore passed at 20:01:48 UTC with 1,127 files, 10 JSON files and 69 SQLite checks. Encrypted upload/download verification was still pending at this leaf’s inspection. Do not describe this as zero downtime.

Every upgrade records an exact configuration snapshot and recovery baseline. The full archive, encryption and off-host upload/download dominate this rollout’s preparation cost, rather than the image switch. For future routine code-only upgrades, prefer a fresh recoverable scheduled backup and an already validated restore mechanism instead of re-proving the same mechanism on each patch. This is a proposed policy simplification, not evidence that a qualifying scheduled backup currently exists or permission to skip the active backup. A previously verified backup may be reused only when its age/recovery point and subsequent writes are explicitly recorded and accepted for that rollout; the receipt must identify it. If that evidence or accepted recovery point is absent, use the existing fresh backup mechanism. Do not silently invent a freshness threshold or imply a prior backup contains new writes. Storage migrations or destructive changes require a fresh snapshot, checksum, mechanism restore proof, and a separate rollback/restore plan. Repeated code fixes within one authorized rollout should reuse a suitable verified backup instead of repeatedly pausing the service, while clearly retaining the same recovery point.

## Architecture And Context

Inventory found reusable implementations in this repository: volume backup/restore verification, immutable image publish proof, and the current pinned Dokploy operator. Existing infrastructure is public Zenod `cloud.zenod.dev`, application `2dkayH_eAur427leH64MT`, service `zenod-mt-fxpzoo`, volume `zenod-mt-data:/data`; private Phylax is a separate running service. The inventory is scoped to the actual target and its existing operational dependencies, not a claim that all user repositories were exhaustively audited. No replacement platform is needed.

Historical [C1 deployment instructions](C1-DEPLOYMENT.md) concern the Console service and are not the public Zenod immutable-image upgrade contract. Do not apply an old multi-service launch packet to a memory-only release by habit.

The current release is a substantial behavior change delivered through reviewed increments, not one tiny patch. It introduces no storage migration; additive metadata and retained raw evidence reduce rollback risk, but old-version future writes are not proved to preserve all new metadata. Code rollback preserves captures; it does not undo semantic changes already written to memory.

## Decisions

| ID | Date | Outcome | Decision / Attempt | Durable Summary | Rule / Absence Rule | Evidence | Revisit When |
|---|---|---|---|---|---|---|---|
| D1 | 2026-09-06 | accepted | Production-first for this single-user release | Jordi explicitly authorized deploy, test and fix with easy undo. | Proceed within that scope; no repeated approval for the same action. Future upgrades use their current authorization. | Current user request; rollout evidence | Scope changes |
| D2 | 2026-09-06 | accepted | Smallest service scope | Memory-only change updates public Zenod; private Phylax remains unchanged. | Expand only for demonstrated dependency change. | Operator target inventory | Protocol/dependency change |
| D3 | 2026-09-06 | rejected | Healthy endpoint means deployed | Desired image and health can disagree with the actual running task. | Require task/container image, OCI source and health convergence. | Current operator checks | Never |
| D4 | 2026-09-06 | accepted | Preserve configuration | 53 runtime environment entries; only GIT_SHA changes, 52 preserved. | Fail on unexpected non-SHA environment or mount drift. | Rollout configuration comparison | Explicit config release |
| D5 | 2026-09-06 | accepted | Code undo and data recovery are separate | Image rollback retains user writes; archive restore can lose later writes. | Never restore a live volume implicitly during rollback. | Current rollback operator | Separate data-recovery decision |
| D6 | 2026-09-06 | accepted | Reuse working mechanisms | Existing Dokploy, encrypted backup remote and verifier already solve most of the operation. | Parameterize and test them; avoid per-release replacement scripts. | Bootstrap inventory | Proven limitation |
| D7 | 2026-09-06 | accepted | Backup pause is real | Full compression while quiesced caused an approximately three-minute pause. | Show expected interruption; use verified reuse policy for repeat code fixes; defer incremental redesign. | Operator observation; final receipt pending | Proven new backup mechanism |
| D8 | 2026-09-06 | accepted | Existing credentials | Keychain loader and configured encrypted remote already exist. | Read them securely; ask only if unavailable, never recreate by default. | `dokploy-env`; historical packet | Access failure |
| D9 | 2026-09-06 | accepted | Anything unanswered | Keep routine upgrades simple. | Simplest compatible option, journal it, keep moving; destructive changes remain scoped separately. | User simplification request | Material risk or scope change |

## Issue Ledger

No new issue is needed for the current bounded continuation. Optional parameterization is not a blocker and should remain small.

| Issue | Role | Owner / Assignment | Title | Status | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|
| draft — current-task continuation | Ticket worker | /root/zmr_deploy_audit | Finish rollout; retain tested upgrade/rollback and optional small parameterization | draft | `codex/zmr-production` | candidate 392d058 | Companion rollout evidence | 2026-09-06 | Finish verified backup and deployment |

## Branch And Integration

Use dedicated worktrees and reviewed PRs; never switch the dirty shared clone. The documentation worktree is `/Users/jordi/Documents/GitHub/wt-zmr-deployment-docs`, branch `codex/zmr-deployment-docs`, base `500c28d`. Required CI and independent review gate integration. Full product suites run once per frozen candidate, not again for documentation-only movement. One operator mutates production at a time. Code merged or image published is not deployment evidence.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Current production upgrade | Jordi | September 6 ZMR rollout | Already approved: deploy, test, fix and make undo easy. | Entire bounded upgrade and verification |
| Destructive data restore/migration or unrelated commercial/provider changes | Jordi | Work exceeds code-upgrade scope | Exact proposed data/config change and recovery consequence | Read-only diagnosis; safe code rollback within current scope |
| Product SHIP acceptance | Jordi | Manager has completed same live journey | Walk the tested journey and accept or report failure | Record evidence and keep rollback available |

## Recovery And Takeover

Only one production operator may act. On interruption, read the secure receipt and actual task state before retrying; never infer failure from a timeout or blindly issue another deploy. The incoming owner records identity, time, source/image and last verified action. This documentation assignment transfers back to ZMR-delivery-manager on PR handoff.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-09-06 | Process inventory | 500c28d plus operator working tree | Read-only local docs/code | Inspect backup script, current operator and release packets | Existing mechanisms identified; optional parameterization pending | Bootstrap links |
| 2026-09-06 | Production rollout | 392d058a599bdf5fc69d17157282b8f9154dcf28 candidate | Public Zenod | Sole operator backup/deploy/verify | In progress; no pass claimed here | Companion rollout evidence |

## Handoff Journal

### 2026-09-06 — deployment_spine_leaf — reusable deployment ownership

Jordi requested durable deployment learnings and a simple supported upgrade path during the authorized live ZMR rollout. This leaf is registered atomically under Foundation; unrelated Phylax and ZMR states remain owned by their stewards. The existing operator and backup are the implementation base. Final live proof remains pending. Next: manager integrates the operator handoff and updates this leaf with actual commands and outcome; parameterize only if convenient, otherwise retain the minimal working operator.

## Open Questions

None permitted. Use Decisions and the existing authorization; choose the simplest compatible option, journal it, and keep moving.
