# EPIC 3.7 · Decommission 2.x — turn off the per-user container fleet

Status: active
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.7-DECOMMISSION-2X.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Epic 3.7 delivery manager (Codex task `019f4933-a958-79b3-8e16-21841be40c53`)
Steward since: 2026-07-10 01:30 CEST
Last reconciled commit: `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Planner: Epic 3.0 planner
Worker: Epic 3.7 delivery manager + dispatched ticket workers
Tester: DX-7 final tester dispatched

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Decommission scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | Epic 3.7 delivery manager (`019f4933-a958-79b3-8e16-21841be40c53`) | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
| Ticket worker | Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`), Descartes (`019f493b-5ec9-73c1-bd3a-450ab687796c`), Faraday (`019f493b-5f51-7352-9bf4-9b4ee36888ea`) | #714, #722, #731 | Execute assigned issue branches. | PR/patch, commit, evidence, blocker, next action. |
| Tester | Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`) | #732 | Validate final sweep/restore runbook readiness. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md`
Active steward: Epic 3.7 delivery manager (Codex task `019f4933-a958-79b3-8e16-21841be40c53`)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.2-ZENOD-MULTITENANT.md`, `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md`, `docs/EPIC-3.5-EPAMINON-MULTITENANT.md` — migration epics whose cutovers gate retirement waves.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md`, `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md`, `docs/EPIC-2.9-EPAMINON-MOVE-0.md` — where the retired instances were minted.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Decommission intent, inventory, wave acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Scripts and cleanup that actually exist |
| Validation evidence | What was verified retired, for an exact date and environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Inventory and retire the entire Epic 2.x per-user container fleet — every per-tenant Dokploy application, container, volume, subdomain, TLS cert, watchdog entry, and provisioner artifact — safely and provably. Early wins (dead test tenants, never-claimed instances, abandoned experiments) can go down NOW. Live paying tenants retire in waves, each wave strictly AFTER that unit's multi-tenant migration verifies their data and their old token keeps working on the shared hostname. Everything reclaimed (RAM, DNS records, watchdog entries) is recorded as evidence. Nothing is deleted without a snapshot to restore from.

## Definition Of Done

- [ ] DX-1 inventory: authoritative list of ALL 2.x-era containers/apps on the VPS (Dokploy API + `docker ps -a`), each classified: live-paying / test / dead / unknown, with owner tenant, unit, volume, subdomain, watchdog entry.
- [ ] DX-2 early wins executed: all dead/test instances stopped, snapshotted, removed (containers, volumes archived, DNS records, Dokploy apps); reclaimed RAM/records measured and recorded.
- [ ] DX-3..n retirement waves: per migrated unit (after 3.2/3.3/3.5 cutovers), all its per-user instances retired with per-tenant verification: data present in the multi-tenant instance, old tokened URL answers on the shared hostname, snapshot archived, then container+volume+subdomain+watchdog entry removed.
- [ ] Provisioner artifacts retired: the 2.x Dokploy provisioning scripts, watchdog registration path (ZD-10), and per-tenant DNS minting removed from the control plane, with tombstone notes in the code.
- [ ] Final sweep: `docker ps -a` and Dokploy app list show ONLY the canonical fleet (`docs/final-container-map-deck.html` slide 1); watchdog list is the ~6 static checks; zero orphan volumes without an archived snapshot.
- [ ] Rollback proven once: one retired instance restored from its snapshot as a drill, documented as a runbook.

## Non-Goals

- The migrations themselves (3.2/3.3/3.5 own moving data; this epic only retires what they've replaced).
- Retiring Phylax (it is part of the canonical fleet) or the marketing/cloud services.
- Deleting snapshots/archives (retention is a later, deliberate decision by Jordi).

## Current State

Phase: execution
Last verified: 2026-07-10 01:30 CEST
Integration target: main
Fresh base commit: `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Next action: manage dispatched workers for #714, #722, #731, and #732; keep #728/#729/#730 blocked until 3.2/3.3/3.5 cutovers.
Blockers: destructive DX-2 execution is blocked until Jordi selects a snapshot archive target and approves the candidate list. Live retirement waves are blocked by 3.2/3.3/3.5 cutovers and per-wave Jordi approval. Initial read-only probes show visible per-tenant endpoints are HTTP 200, so early wins are currently classification/snapshot/runbook work, not blind deletion.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed inventory + waves. | Dispatched or named blocker. |
| Epic worker | Fleet retired per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove each wave: verified data, working URLs, clean removal, restorable snapshot. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Parent decisions; what replaces the retired fleet. | Always |
| 1 | `docs/final-container-map-deck.html` | CANONICAL end state: the only containers allowed to remain. | Always |
| 2 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | How 2.x instances were provisioned (Dokploy path, subdomains, watchdog). | Worker |
| 3 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` (Z-MT-4/6) | Migration + cutover this epic's waves depend on. | Worker |
| 4 | `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md` | Restore doctrine informing the snapshot/rollback drill. | Tester |

## Architecture And Context

The 2.x model minted one Dokploy application per tenant per unit: subdomain (`<tenant>.<host>`, `c-<slug>`, `e-<slug>`), container, `/data` volume, minted token, watchdog entry (host systemd timer with a static list — known to miss late tenants), and gateway key. Retirement must unwind ALL of these per instance, in order: verify replacement (for live tenants) → snapshot volume to archive storage → stop container → remove Dokploy app → remove DNS record → remove watchdog entry → record evidence row. Known 2.x reliability quirks work in our favor here (some "containers" are compose records that never materialized — DX-1 must distinguish record-only from running).

Execution constraint: workers cannot shell the VPS (2.x rule). Mechanics: Dokploy API for app/container lifecycle; snapshot scripts delivered to the repo and either run via the cloud control plane's existing access or handed to Jordi as a single reviewed command per wave (human gate).

Ticket sketch: DX-1 inventory + classification; DX-2 early-wins wave (dead/test); DX-3 Zenod wave (after Z-MT-6); DX-4 Callisthenes wave (after CA-MT-6); DX-5 Epaminon wave (after E-MT-7); DX-6 provisioner/watchdog/DNS artifact removal; DX-7 final sweep + restore drill + runbook.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Snapshot before every removal; archives are never deleted in this epic. | Live paying tenants; reversibility is the safety property. | parent D13 |
| 2026-07-10 | Waves keyed to unit cutovers, not calendar. | Retiring before verified migration risks customer data/URLs. | 3.2/3.3/3.5 spines |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#714](https://github.com/zenod-ai/zenod/issues/714) | Ticket worker | Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`) | DX-1 full 2.x fleet inventory + classification | ready for testing | - | [PR #746](https://github.com/zenod-ai/zenod/pull/746) / `codex/epic37-dx1-inventory` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | Every 2.x app/container listed and classified; record-only vs running distinguished. | `docs/EPIC-3.7-DX1-INVENTORY.md`: 35 Dokploy `zenod` rows classified; 16 running 2.x candidate rows; 4 failed duplicates; 5 orphan-volume candidates; watchdog entries mapped. | 2026-07-10 02:10 CEST | Steward review of unknown rows; DX-2 may plan snapshots for duplicate/test rows only. |
| [#722](https://github.com/zenod-ai/zenod/issues/722) | Ticket worker | Descartes (`019f493b-5ec9-73c1-bd3a-450ab687796c`) | DX-2 early wins: retire confirmed dead/test instances | blocked / package ready | #714 + archive target + Jordi approval | [PR #749](https://github.com/zenod-ai/zenod/pull/749) / `codex/epic37-dx2-early-wins` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All dead/test instances snapshotted + removed; reclaimed resources recorded. | Commit `fee2d6c7d5be02a256c2eb84af48ded536d952de`: runbook, candidate CSV, guarded retire script; dry-run failed closed on placeholder candidates as intended. | 2026-07-10 02:20 CEST | Jordi chooses archive target and approves exact DX-1 candidate rows; then run dry-run and reviewed command batch. |
| [#728](https://github.com/zenod-ai/zenod/issues/728) | Ticket worker | blocked | DX-3 Zenod retirement wave | blocked | 3.2 Z-MT-6 + #714 | `codex/epic37-dx3-zenod-wave` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All per-user Zenods retired with per-tenant verification. | Issue minted. | 2026-07-10 01:30 CEST | Wait for Zenod cutover; prepare wave checklist if spare capacity opens. |
| [#729](https://github.com/zenod-ai/zenod/issues/729) | Ticket worker | blocked | DX-4 Callisthenes retirement wave | blocked | 3.3 CA-MT-6 + #714 | `codex/epic37-dx4-callisthenes-wave` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All per-user Callisthenes retired with per-tenant verification. | Issue minted. | 2026-07-10 01:30 CEST | Wait for Callisthenes cutover; prepare wave checklist if spare capacity opens. |
| [#730](https://github.com/zenod-ai/zenod/issues/730) | Ticket worker | blocked | DX-5 Epaminon retirement wave | blocked | 3.5 E-MT-7 + #714 | `codex/epic37-dx5-epaminon-wave` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All per-user Epaminons retired; AWAIT_PROVISION fleet gone. | Issue minted. | 2026-07-10 01:30 CEST | Wait for Epaminon cutover. |
| [#731](https://github.com/zenod-ai/zenod/issues/731) | Ticket worker | Faraday (`019f493b-5f51-7352-9bf4-9b4ee36888ea`) | DX-6 retire provisioner, watchdog registration, DNS minting | blocked / audit ready | DX-3..5 + #741 + #745 for destructive removal | [PR #747](https://github.com/zenod-ai/zenod/pull/747) / `codex/epic37-dx6-provisioner-artifacts` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | 2.x provisioning code paths removed with tombstones. | Commit `76141afd0f9191a036d86159c0da5ee9f5c4122b`: public repo audit says `/api/provision`, `ZENOD_AWAIT_PROVISION`, suite-agent provisioning, and tests are still live; no production removal safe yet. | 2026-07-10 02:00 CEST | Implement #745 replacement, then destructive cleanup waits for waves. |
| [#741](https://github.com/zenod-ai/zenod/issues/741) | Ticket worker | Franklin (`019f4943-96fe-78b0-89fb-f17df5738be7`) | DX-6C cloud provisioner, DNS, and watchdog minting audit | blocked / audit ready | #731; destructive removal waits for #745 + DX-3..5 | [cloud PR #58](https://github.com/zenod-ai/cloud/pull/58) / `codex/epic37-dx6-cloud-audit` | cloud `4300ec34e0a59c4f3689fb789eae460c6d7354d0` | Cloud Dokploy app/domain/watchdog provisioning paths audited and cleanup plan split into now-safe vs gated. | Commit `775daa7dbd7ba02b384d347d775be157388afed3`: cloud still has live Stripe-triggered 2.x provisioners for Zenod, Callisthenes, and Ring; no current `/api/tenants` caller. | 2026-07-10 02:50 CEST | #745 must replace cloud Dokploy provisioners with unit `/api/tenants` flow before deletion. |
| [#745](https://github.com/zenod-ai/zenod/issues/745) | Ticket worker | blocked | DX-8 cloud `/api/tenants` checkout replacement | blocked | 3.1 tenants API + unit endpoints + #741 | future cloud branch | cloud base TBD | Stripe checkout provisions unit tenant rows instead of Dokploy compose/domain records. | Issue minted from #741 audit. | 2026-07-10 02:55 CEST | Start after tenant API contract/endpoints are available; test in cloud-test first. |
| [#732](https://github.com/zenod-ai/zenod/issues/732) | Tester | Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`) | DX-7 final sweep + restore drill + runbook | blocked / runbook ready | DX-3..6 for final pass | [PR #748](https://github.com/zenod-ai/zenod/pull/748) / `codex/epic37-dx7-final-sweep-restore` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | Fleet matches canonical slide; one snapshot restored as drill; runbook merged. | Commit `1a7de0b`: final sweep and restore-drill runbook pushed; no destructive commands executed; final pass blocked by retirement waves and restore target approval. | 2026-07-10 02:15 CEST | Review runbook; execute only after waves complete and restore target is approved. |

## Branch And Integration

- Default integration branch: `main`
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees for filesystem isolation.
- Dispatch record: branch, worktree if used, base commit, integration target, owner, and latest verified time.
- Review gate: implementation complete, PR open, and required automated checks passing.
- Testing gate: exact commit available in a named test surface; acceptance validation in progress.
- Done gate: acceptance passed, evidence linked, residual risk recorded, and spine reconciled.
- Integration rule: merge small reviewed work after required checks pass so new agents bootstrap from the freshest validated base.
- If not merged, the issue ledger must show branch/PR, blocker, owner, latest commit, and next action.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Any removal touching a live-paying tenant's instance | Jordi | DX-3..5 wave execution | Approve the wave's tenant list + window + rollback plan | Inventory, snapshots, dead/test removals |
| VPS-level script execution | Jordi | Any step Dokploy API cannot perform | Run the exact reviewed script/command provided in the issue | API-reachable steps |
| Archive retention policy | Jordi | After DX-7 | Decide snapshot retention/deletion | Nothing blocked; archives kept meanwhile |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Review draft PRs #746, #747, #748, #749, and cloud PR #58; keep blocked issues explicit.
- Coordinate wave timing with 3.2/3.3/3.5 epic workers via Proposed Cross-Spine Updates.

## Worker Queue

- Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`) owns #714.
- Descartes (`019f493b-5ec9-73c1-bd3a-450ab687796c`) owns #722.
- Faraday (`019f493b-5f51-7352-9bf4-9b4ee36888ea`) owns #731.
- Franklin (`019f4943-96fe-78b0-89fb-f17df5738be7`) completed #741.

## Tester Queue

- Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`) owns #732.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `8e12ebab64140f227f9c19d5a72e5d191de8d251` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.7-DECOMMISSION-2X.md` | pass | `docs/EPIC-3.7-DECOMMISSION-2X.md OK` |
| 2026-07-10 | Initial DX-1 read-only fleet probe | VPS `hetzner_vps_1`, Dokploy API | Dokploy + Docker + public HTTP | `project.all`; `docker ps -a`; `docker volume ls`; `docker stats --no-stream`; public `/api/health` and `/connect` probes | pass / action required | 6 Dokploy projects, 100 Docker containers, 81 Docker volumes, watchdog active/enabled, visible per-tenant endpoints probed HTTP 200. |
| 2026-07-10 | DX-1 authoritative inventory | `8e12ebab64140f227f9c19d5a72e5d191de8d251` plus working tree artifact | local repo + Alpha9 VPS read-only evidence | Joined `/tmp/zenod-dokploy-inventory-sanitized.json`, `/tmp/zenod-docker-inventory-sanitized.json`, `/tmp/zenod-docker-stats.jsonl`, `/tmp/zenod-docker-volumes.jsonl`; read-only watchdog env check; public probes | ready for testing | `docs/EPIC-3.7-DX1-INVENTORY.md`; no destructive action taken; raw Dokploy git URLs not copied because source snapshot includes an embedded credential. |
| 2026-07-10 | DX-2 early-wins execution package | `fee2d6c7d5be02a256c2eb84af48ded536d952de` | local script review | `bash -n`; dry-run with placeholder CSV; `git diff --check` | blocked / pass | Guarded script defaults to dry-run and destructive mode requires `JORDI_APPROVED_DX2=1`; placeholder candidates fail closed. |
| 2026-07-10 | DX-6 public repo provisioner audit | `76141afd0f9191a036d86159c0da5ee9f5c4122b` | local tests | `git diff --check`; `npm test --workspace @zenod/server -- provision.test.ts settingsZd9.test.ts`; `bash scripts/watchdog/watchdog-logic.test.sh` | blocked / audit pass | Public repo deletion is unsafe until `/api/provision`, `ZENOD_AWAIT_PROVISION`, suite provisioning, and cloud provisioners are replaced. |
| 2026-07-10 | DX-7 final sweep runbook | `1a7de0b` | runbook validation | `git diff --check`; required-section grep; ASCII check; read-only Dokploy `project.all` | blocked / runbook pass | Final acceptance cannot run while current Dokploy state still has 2.x rows. |
| 2026-07-10 | DX-6C cloud provisioner audit | `775daa7dbd7ba02b384d347d775be157388afed3` | `zenod-ai/cloud` local tests | `git diff --check`; ASCII/secret scans; `node --check` scripts; webhook typecheck/build; console build; `node --test scripts/provision-callisthenes.test.mjs` | blocked / audit pass | Cloud still has live Stripe-triggered 2.x provisioners and no `/api/tenants` caller; #745 created. |
| 2026-07-10 | GitHub issue board and draft PRs | `zenod-ai/zenod`, `zenod-ai/cloud` | GitHub issues/PRs | `gh issue create`; `gh pr create --draft`; `gh issue list --label epic:3.7` | pass | Issues #714, #722, #728, #729, #730, #731, #732, #741, #745; PRs #746, #747, #748, #749, cloud #58. |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Jordi called for a lane to turn off the Epic 2.x per-user fleet; parent D13. Early wins (DX-1/DX-2) are dispatchable immediately; live-tenant waves gate on migrations.
Next: mint DX-1/DX-2 and dispatch.
Risks: removing an instance whose tenant was NOT correctly migrated (mitigated by per-tenant verification + snapshots); Dokploy record-only phantoms confusing inventory; the workers-can't-shell-VPS constraint.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/final-container-map-deck.html`
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md`

### 2026-07-10 - Epic Worker - Board minted and parallel agents dispatched

Context: Jordi bound this task as Epic 3.7 delivery manager and asked for GitHub issues plus parallel agents to drain the epic. The issue board now covers DX-1 through DX-7. Four non-destructive tracks are dispatched in parallel: DX-1 inventory, DX-2 snapshot-first runbook, DX-6 provisioner artifact audit, and DX-7 final sweep/restore runbook. DX-3, DX-4, and DX-5 remain blocked on their unit migration cutovers and live-retirement approvals.
Next: wait for worker handoffs, reconcile their artifacts into this spine, and keep destructive execution behind the named Human Gates.
Risks: initial public probes returned HTTP 200 for all known visible per-tenant endpoints, so early wins are not dead-by-health; classification must distinguish test/duplicate/unknown from live-paying before any removal. Snapshot archive target is still undecided.
Assignment identity: Epic 3.7 delivery manager (Codex task `019f4933-a958-79b3-8e16-21841be40c53`)
Branch / latest commit: `main` / `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Last verified: 2026-07-10 01:30 CEST
Links:

- #714 DX-1 inventory: Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`)
- #722 DX-2 early wins: Descartes (`019f493b-5ec9-73c1-bd3a-450ab687796c`)
- #731 DX-6 artifact cleanup: Faraday (`019f493b-5f51-7352-9bf4-9b4ee36888ea`)
- #732 DX-7 final tester: Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`)

### 2026-07-10 - DX-1 Inventory Worker - Authoritative inventory artifact ready

Context: DX-1 joined the local sanitized Dokploy/Docker/volume/stat snapshots with a read-only watchdog env check and public endpoint probes. The repo artifact lists every Dokploy row in project `zenod`, distinguishes running containers from record-only/duplicate rows, maps mounted volumes and orphan-volume candidates, and classifies visible 2.x candidates.
Next: steward reviews the `unknown` rows with Jordi; DX-2 can plan snapshot-first cleanup for `duplicate` and `test` rows only. No live-paying or unknown row should be retired without the named human gate.
Risks: the source Dokploy snapshot still contains at least one embedded credential in a git URL, so raw source rows must stay out of repo artifacts; `callisthenes.zenod.dev` is claimed by both the canonical Callisthenes row and `zenod-cloud-test`, so DNS/control-plane ownership needs steward review before cleanup.
Assignment identity: Epic 3.7 DX-1 inventory worker
Branch / latest commit: `codex/epic37-dx1-inventory` / working tree from `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Last verified: 2026-07-10 02:10 CEST
Links:

- `docs/EPIC-3.7-DX1-INVENTORY.md`
- https://github.com/zenod-ai/zenod/issues/714

### 2026-07-10 - Ticket Workers - DX-2, DX-6, and DX-7 packages ready but gated

Context: DX-2 produced a snapshot-first early-wins runbook, candidate CSV, and fail-closed execution script. DX-6 produced a public repo provisioner audit proving production-code deletion is not safe yet because `ZENOD_AWAIT_PROVISION`, `/api/provision`, suite-agent provisioning, and related tests are still live. DX-7 produced the final sweep and restore-drill runbook, but the live fleet is not final.
Next: implement/dispatch #745 once the tenants API contract is available; get Jordi's snapshot archive target and approved candidate rows for DX-2; keep DX-3/#728, DX-4/#729, and DX-5/#730 blocked on unit cutovers.
Risks: executing DX-2 before exact candidate approval can remove data; deleting provisioner code before cloud/unit cutovers can break checkout/provisioning.
Assignment identity: Epic 3.7 delivery manager reconciliation
Branch / latest commits: #722 `fee2d6c7d5be02a256c2eb84af48ded536d952de`; #731 `76141afd0f9191a036d86159c0da5ee9f5c4122b`; #732 `1a7de0b`
Last verified: 2026-07-10 02:20 CEST
Links:

- https://github.com/zenod-ai/zenod/issues/722
- https://github.com/zenod-ai/zenod/issues/731
- https://github.com/zenod-ai/zenod/issues/732
- https://github.com/zenod-ai/zenod/issues/741

### 2026-07-10 - DX-6C Cloud Audit - Replacement path required

Context: Franklin audited `zenod-ai/cloud` and found live Stripe-triggered 2.x provisioners for Zenod, Callisthenes, and Ring. The cloud still creates Dokploy compose records, per-tenant domains, and cloud-fed watchdog targets; no `/api/tenants` caller exists yet. This makes destructive DX-6 cleanup unsafe until #745 replaces checkout provisioning.
Next: keep #741 blocked as audit complete; use #745 for the cloud `/api/tenants` replacement when unit endpoints are ready. Review cloud PR #58.
Risks: removing `ZENOD_AUTO_PROVISION` or unit scripts before #745 would break paid checkout; keeping them forever keeps minting new 2.x rows.
Assignment identity: Epic 3.7 DX-6C cloud provisioner audit worker
Branch / latest commit: `zenod-ai/cloud` `codex/epic37-dx6-cloud-audit` / `775daa7dbd7ba02b384d347d775be157388afed3`
Last verified: 2026-07-10 02:50 CEST
Links:

- https://github.com/zenod-ai/zenod/issues/741
- https://github.com/zenod-ai/zenod/issues/745
- https://github.com/zenod-ai/cloud/pull/58

## Open Questions

- Where do volume snapshots archive to (VPS-local archive dir vs object storage vs a git-LFS-style repo)? Owner: Jordi. Needed by: DX-2.
- DX-1 found one live-paying row (`zenod-jordi-f2c7a6`), 13 test rows, 4 failed duplicate rows, 2 ambiguous running 2.x rows (`callisthenes-jordicallifresh33087-muhmxp`, active `ring-jordiring-fkegkz`), and several non-tenant unknown/control rows. Owner: Jordi/steward. Needed by: DX-2 approval.
- Cloud audit #741 found live Stripe-triggered 2.x provisioners and no `/api/tenants` caller; #745 must implement the replacement path before DX-6 can delete provisioners. Owner: future cloud worker/steward. Needed by: DX-6.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Z-MT-6 completion must notify this spine to unblock DX-3. | this spine | Epic 3.2 worker | proposed |
| 2026-07-10 | `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | CA-MT-6 completion must notify this spine to unblock DX-4. | this spine | Epic 3.3 worker | proposed |
| 2026-07-10 | `docs/EPIC-3.5-EPAMINON-MULTITENANT.md` | E-MT-7 completion must notify this spine to unblock DX-5. | this spine | Epic 3.5 worker | proposed |

## Appendix

- 2.x per-tenant anatomy to unwind: Dokploy app, container, `/data` volume, subdomain + TLS, minted token, watchdog entry, gateway key.
- Known quirk: Dokploy sometimes "created the compose record but did not materialize the container" — inventory must reconcile API records against `docker ps -a`.
