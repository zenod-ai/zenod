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
Last reconciled commit: `fa49f5c`
Planner: Epic 3.0 planner
Worker: Epic 3.7 delivery manager + dispatched ticket workers
Tester: DX-7 final tester + DX-8A independent acceptance reviewer dispatched

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Decommission scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | Epic 3.7 delivery manager (`019f4933-a958-79b3-8e16-21841be40c53`) | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
| Ticket worker | Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`), Descartes (`019f493b-5ec9-73c1-bd3a-450ab687796c`), Faraday (`019f493b-5f51-7352-9bf4-9b4ee36888ea`), Franklin (`019f4943-96fe-78b0-89fb-f17df5738be7`), Galileo (`019f4950-33d0-7cb2-b779-1b447e381fab`), Ptolemy (`019f497f-29d7-7d73-bb60-582e94da0c6f`) | #714, #722, #731, #741, #745, #756 | Execute assigned issue branches. | PR/patch, commit, evidence, blocker, next action. |
| Tester | Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`), Heisenberg (`019f4950-3452-7863-b296-fe04c2cb2ecf`), Hypatia (`019f497f-2a30-7eb0-a156-c2ea3075573b`) | #732; DX-1/DX-2 safety review; #756 acceptance review | Validate runbooks, execution-package readiness, and checkout-topology fail-closed behavior. | Commit, environment, pass/fail, risk. |

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

- [x] DX-1 inventory: authoritative list of ALL 2.x-era containers/apps on the VPS (Dokploy API + `docker ps -a`), each classified: live-paying / test / dead / unknown, with owner tenant, unit, volume, subdomain, watchdog entry.
- [x] DX-2 early wins executed: all dead/test instances stopped, snapshotted, removed (containers, volumes archived, DNS records, Dokploy apps); reclaimed RAM/records measured and recorded.
- [ ] DX-3..n retirement waves: per migrated unit (after 3.2/3.3/3.5 cutovers), all its per-user instances retired with per-tenant verification: data present in the multi-tenant instance, old tokened URL answers on the shared hostname, snapshot archived, then container+volume+subdomain+watchdog entry removed.
- [ ] Provisioner artifacts retired: the 2.x Dokploy provisioning scripts, watchdog registration path (ZD-10), and per-tenant DNS minting removed from the control plane, with tombstone notes in the code.
- [ ] Final sweep: `docker ps -a` and Dokploy app list show ONLY the canonical fleet (`docs/final-container-map-deck.html` slide 1); watchdog list is the ~6 static checks; zero orphan volumes without an archived snapshot.
- [x] Rollback proven once: one retired instance restored from its snapshot as a drill, documented as a runbook.

## Non-Goals

- The migrations themselves (3.2/3.3/3.5 own moving data; this epic only retires what they've replaced).
- Retiring Phylax (it is part of the canonical fleet) or the marketing/cloud services.
- Deleting snapshots/archives (retention is a later, deliberate decision by Jordi).

## Current State

Phase: DX-2 complete; migration-gated dependency execution
Last verified: 2026-07-10 04:29 CEST
Integration target: main
Fresh base commit: `eb8caafa2b3bfb4e9108a9c5ad913c982fc237ea`
Next action: unit owners deploy and configure the missing Callisthenes and Ring `/api/tenants` endpoints, then cloud-test proves one Stripe TEST checkout per unit. Keep #728/#729/#730 blocked until 3.2/3.3/3.5 cutovers.
Blockers: DX-8 cannot enable `tenants_api` until Zenod, Callisthenes, and Ring expose deployed HTTPS `/api/tenants` endpoints with control-plane tokens; the last recorded live probe found Zenod auth-gated at HTTP 401 but Callisthenes and Ring absent at HTTP 404. Live retirement waves remain blocked by 3.2/3.3/3.5 cutovers and per-wave Jordi approval. DX-2 has no remaining execution blocker.

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
| 2026-07-10 | A Ring unit checkout provisions exactly one Ring tenant; suite fan-out is a separate product/topology path. | Epic 3.0 defines independently sold units and separately composed suites; the Ring wallet wires enabled downstream units rather than redefining Ring as a suite alias. | Epic 3.0 D3/D10; final container map; Epic 3.4; independent review `019f4979-83ea-71e2-add3-e61f1011fbd6` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#714](https://github.com/zenod-ai/zenod/issues/714) | Ticket worker | Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`) | DX-1 full 2.x fleet inventory + classification | done | - | [PR #746](https://github.com/zenod-ai/zenod/pull/746) merged as `69bee3a` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | Every 2.x app/container listed and classified; record-only vs running distinguished. | 34 Dokploy rows classified and bound to opaque IDs; running vs record-only/duplicate rows, volumes, domains, watchdog entries, and unknown/live/test classes recorded. Issue closed `status:complete`. | 2026-07-10 02:38 CEST | Complete; DX-2 revalidates the exact candidate subset against live state. |
| [#722](https://github.com/zenod-ai/zenod/issues/722) | Ticket worker + tester | Descartes + steward + Sartre (`019f49c9-abcb-72e2-a0f3-f58e3c794bcc`) | DX-2 early wins: retire confirmed dead/test instances | done | - | [PR #749](https://github.com/zenod-ai/zenod/pull/749) merged as `cd9c21f` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All dead/test instances snapshotted + removed; reclaimed resources recorded. | Jordi approved the exact digest and dated archive. Alpha9 retired 13 test stacks plus 4 duplicate records after 45 checksummed volume archives and a successful restore drill. Sartre caught host-only watchdog cleanup being overwritten; the source registrations were cleared, then natural cloud sync and watchdog cycles preserved zero retired tokens. Full independent re-test passed. | 2026-07-10 04:24 CEST | Complete and closed; mirror the archive off-host when a destination is selected. |
| [#728](https://github.com/zenod-ai/zenod/issues/728) | Ticket worker | blocked | DX-3 Zenod retirement wave | blocked | 3.2 Z-MT-6 + #714 | `codex/epic37-dx3-zenod-wave` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All per-user Zenods retired with per-tenant verification. | Issue minted. | 2026-07-10 01:30 CEST | Wait for Zenod cutover; prepare wave checklist if spare capacity opens. |
| [#729](https://github.com/zenod-ai/zenod/issues/729) | Ticket worker | blocked | DX-4 Callisthenes retirement wave | blocked | 3.3 CA-MT-6 + #714 | `codex/epic37-dx4-callisthenes-wave` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All per-user Callisthenes retired with per-tenant verification. | Issue minted. | 2026-07-10 01:30 CEST | Wait for Callisthenes cutover; prepare wave checklist if spare capacity opens. |
| [#730](https://github.com/zenod-ai/zenod/issues/730) | Ticket worker | blocked | DX-5 Epaminon retirement wave | blocked | 3.5 E-MT-7 + #714 | `codex/epic37-dx5-epaminon-wave` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | All per-user Epaminons retired; AWAIT_PROVISION fleet gone. | Issue minted. | 2026-07-10 01:30 CEST | Wait for Epaminon cutover. |
| [#731](https://github.com/zenod-ai/zenod/issues/731) | Ticket worker | Faraday + steward | DX-6 retire provisioner, watchdog registration, DNS minting | blocked / replacement merged off | DX-3..5 + #745 enablement | [PR #747](https://github.com/zenod-ai/zenod/pull/747) merged as `430c385`; [cloud PR #59](https://github.com/zenod-ai/cloud/pull/59) merged as `09ca15d` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | 2.x provisioning code paths removed with tombstones. | Audits and fail-closed shared-unit client are on both main branches; production mode remains unchanged and legacy removal is still unsafe. | 2026-07-10 02:38 CEST | Deliver/enable unit endpoints; destructive cleanup waits for checkout evidence and retirement waves. |
| [#741](https://github.com/zenod-ai/zenod/issues/741) | Ticket worker | Franklin (`019f4943-96fe-78b0-89fb-f17df5738be7`) | DX-6C cloud provisioner, DNS, and watchdog minting audit | done | - | [cloud PR #58](https://github.com/zenod-ai/cloud/pull/58) merged as `f21f3f7` | cloud `4300ec34e0a59c4f3689fb789eae460c6d7354d0` | Cloud Dokploy app/domain/watchdog provisioning paths audited and cleanup plan split into now-safe vs gated. | Audit is on cloud main; issue closed `status:complete`. Replacement and removal remain tracked by #745/#731. | 2026-07-10 02:38 CEST | Complete. |
| [#745](https://github.com/zenod-ai/zenod/issues/745) | Ticket worker | Galileo (`019f4950-33d0-7cb2-b779-1b447e381fab`) | DX-8 cloud `/api/tenants` checkout replacement | blocked / code merged off | deployed Zenod + Callisthenes + Ring endpoints | [cloud PR #59](https://github.com/zenod-ai/cloud/pull/59) merged as `09ca15d` | cloud `4300ec34e0a59c4f3689fb789eae460c6d7354d0` | Stripe checkout provisions unit tenant rows instead of Dokploy compose/domain records. | Fail-closed client is on cloud main; merged-main webhook typecheck/build, 13 tests, and console build pass. Default production behavior is unchanged. | 2026-07-10 02:38 CEST | Enable on cloud-test only after all three endpoints/tokens exist, then run one Stripe TEST checkout per unit. |
| [#756](https://github.com/zenod-ai/zenod/issues/756) | Ticket worker + tester | Ptolemy (`019f497f-29d7-7d73-bb60-582e94da0c6f`) + Hypatia (`019f497f-2a30-7eb0-a156-c2ea3075573b`) | DX-8A separate checkout product identity from unit provisioning | done | cloud #59 | [cloud PR #60](https://github.com/zenod-ai/cloud/pull/60) merged as `039e2cd` | cloud `09ca15d` | Unit checkout metadata separates product, provisioning kind, and unit; unsupported suite/unknown kinds fail before any tenant API call or executable recovery task; Ring remains singular. | Initial commit failed signed webhook acceptance; fix `28bbd3f` validates before queue admission. Independent re-test passed exact invalid-suite/malformed cases, valid Ring, historical compatibility, metadata propagation, and production-off scope. Fresh merged-main clean installs, 18 tests, typecheck, and both builds pass. Issue closed `status:complete`. | 2026-07-10 03:08 CEST | Complete; #745 remains endpoint/deployment gated. |
| [#773](https://github.com/zenod-ai/zenod/issues/773) | Ticket worker | Maxwell (`019f49d3-6894-7c21-889f-7defdb69d089`) | DX-2B durable cloud watchdog deregistration CLI | done | #722 finding; informs #731 | [cloud PR #61](https://github.com/zenod-ai/cloud/pull/61) merged as `3e80e7b` | cloud `039e2cd3dcc075c366240cf3b3ed62521074834d` | Guarded dry-run/apply CLI atomically clears exact retired `tenant_slug` registrations with backup, preservation tests, and secret-safe output. | CLI, 9 focused tests, and source-sync runbook merged. Steward reran 12 script tests, 18 webhook tests, typecheck, build, syntax, and diff checks. Issue closed `status:complete`; no production apply occurred from the PR. | 2026-07-10 04:29 CEST | Complete; use the CLI under the named production human gate in later waves. |
| [#732](https://github.com/zenod-ai/zenod/issues/732) | Tester | Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`) | DX-7 final sweep + restore drill + runbook | blocked / runbook merged | DX-3..6 for final pass | [PR #748](https://github.com/zenod-ai/zenod/pull/748) merged as `e97c259` | `8e12ebab64140f227f9c19d5a72e5d191de8d251` | Fleet matches canonical slide; one snapshot restored as drill; runbook merged. | Runbook is on main and DX-2 proved one checksummed archive restore on Alpha9. The final canonical-fleet sweep remains blocked until live waves and provisioner cleanup complete. | 2026-07-10 04:10 CEST | Execute final sweep after DX-3..6 complete. |

## Branch And Integration

- Default integration branch: `main`
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees for filesystem isolation.
- Dispatch record: branch, worktree if used, base commit, integration target, owner, and latest verified time.
- Review gate: implementation complete, PR open, and required automated checks passing.
- Testing gate: exact commit available in a named test surface; acceptance validation in progress.
- Done gate: acceptance passed, evidence linked, residual risk recorded, and spine reconciled.
- Integration rule: merge small reviewed work after required checks pass so new agents bootstrap from the freshest validated base.
- If not merged, the issue ledger must show branch/PR, blocker, owner, latest commit, and next action.
- Integrated 2026-07-10: Zenod PRs #746 (`69bee3a`), #747 (`430c385`), #748 (`e97c259`), #749 (`cd9c21f`), #755 (`fa49f5c`); cloud PRs #58 (`f21f3f7`), #59 (`09ca15d`), #60 (`039e2cd`), #61 (`3e80e7b`).

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Any removal touching a live-paying tenant's instance | Jordi | DX-3..5 wave execution | Approve the wave's tenant list + window + rollback plan | Inventory, snapshots, dead/test removals |
| DX-2 test/duplicate retirement batch | Jordi | Before `DRY_RUN=0` | Satisfied 2026-07-10: digest `e0e81e0f2546d86034fc79bafb4e7c13abf383830cf9926241f8c7dc67e41c3f`, archive `/srv/zenod-archives/epic37/dx2/20260710/`, approval receipt in #722 | Complete |
| Cloud-test shared-unit provisioning enablement | Jordi | Before setting `TENANT_PROVISIONING_MODE=tenants_api` | Confirm all three unit endpoints/tokens are configured and approve three Stripe TEST checkouts | Merge/review fail-closed code while mode remains off |
| VPS-level script execution | Jordi | Any step Dokploy API cannot perform | Run the exact reviewed script/command provided in the issue | API-reachable steps |
| Archive retention policy | Jordi | After DX-7 | Decide snapshot retention/deletion | Nothing blocked; archives kept meanwhile |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Coordinate wave timing with 3.2/3.3/3.5 epic workers via Proposed Cross-Spine Updates.
- Keep cloud `tenants_api` disabled until the three endpoint and Stripe test gates pass.

## Worker Queue

- Dalton (`019f493b-5e40-7bd2-b3d5-98c1d6f8aeb9`) completed #714.
- Descartes (`019f493b-5ec9-73c1-bd3a-450ab687796c`) completed #722; Sartre independently accepted the live result.
- Faraday (`019f493b-5f51-7352-9bf4-9b4ee36888ea`) owns #731.
- Franklin (`019f4943-96fe-78b0-89fb-f17df5738be7`) completed #741.
- Galileo (`019f4950-33d0-7cb2-b779-1b447e381fab`) completed the code slice of #745; endpoint enablement remains blocked.
- Ptolemy (`019f497f-29d7-7d73-bb60-582e94da0c6f`) completed #756, merged through cloud PR #60.
- Maxwell (`019f49d3-6894-7c21-889f-7defdb69d089`) completed #773, merged through cloud PR #61.

## Tester Queue

- Lovelace (`019f493b-5fe8-77e1-85d3-df536f8f2059`) owns #732.
- Hypatia (`019f497f-2a30-7eb0-a156-c2ea3075573b`) independently rejected #756's first commit and passed the corrected exact commit `28bbd3f`.
- Sartre (`019f49c9-abcb-72e2-a0f3-f58e3c794bcc`) independently failed DX-2's first postflight because cloud sync regenerated retired watchdog entries, then passed the source-aware fix after natural sync and watchdog cycles.

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
| 2026-07-10 | DX-1 identifier correction | `dd403d3` | local artifact against sanitized Dokploy source | strict spine validation; identifier map count; `git diff --check`; GitHub CI | pass / ready for review | 34 source rows = 34 table rows = 34 opaque IDs; PR #746 ready for review. |
| 2026-07-10 | DX-2 hardened execution package | `976131d` | local + Alpha9 live read-only | guard/rollback tests; `bash -n`; two Alpha9 dry-runs; deliberate live-paying ID cross-wire; wildcard DNS probe; volume byte/free-space checks | pass / human gate | 17 rows reconciled; 253 mutations printed and zero executed; cross-wire rejected before Phase 1; automatic pre-delete rollback tested. |
| 2026-07-10 | DX-2 approved retirement execution | package `cd9c21f`; runtime main `468095d` | Alpha9 VPS `hetzner_vps_1` | exact-hash live dry-run; snapshot/checksum; restore drill; guarded removal; source deregistration; natural cloud-sync/watchdog cycles; independent full re-test | pass | Approval receipt: #722 comment `4931281736`. Evidence: `/srv/zenod-archives/epic37/dx2/20260710/evidence-20260710T020112Z/`. Retired 13 test stacks + 4 duplicate records; 45/45 archives verify; 43 containers, 45 volumes, 17 Dokploy/domain records, 2 watchdog checks, and about 940.43 MiB running memory reclaimed. Sartre caught and rejected regenerated watchdog entries; the source-aware fix passed natural sync at 04:23:05 CEST and watchdog at 04:24:08 CEST. All 16 retired routes return 404; retained shared Ring route and three excluded live/ambiguous stacks return 200. Issue closed `status:complete`. |
| 2026-07-10 | DX-2B durable source deregistration | cloud `8b5f31e`; merged main `3e80e7b` | isolated cloud worktree + GitHub PR #61 | 9 focused CLI tests; 12 script tests; 18 webhook tests; webhook typecheck/build; Node syntax; `git diff --check`; steward code review | pass | Dry-run-by-default exact-slug CLI snapshots the store, atomically clears only matched `tenant_slug` fields, fails closed on malformed/missing/ambiguous/concurrent input, and documents source-sync/natural-cycle verification. No production apply occurred. Issue #773 closed complete. |
| 2026-07-10 | DX-8 cloud shared-unit client | cloud `60114da` | `zenod-ai/cloud` local | webhook typecheck/build; 13 tests/5 suites; console build; health smoke; compose config; `git diff --check`; independent contract review | pass / endpoint gate | C3 contract matched; no fallback after API failure; production default unchanged; PR #59. |
| 2026-07-10 | GitHub issue board and draft PRs | `zenod-ai/zenod`, `zenod-ai/cloud` | GitHub issues/PRs | `gh issue create`; `gh pr create --draft`; `gh issue list --label epic:3.7` | pass | Issues #714, #722, #728, #729, #730, #731, #732, #741, #745; PRs #746, #747, #748, #749, cloud #58. |
| 2026-07-10 | Merged integration | Zenod `6025f47`; cloud `09ca15d` | clean worktrees from both `origin/main` refs | strict spine validation; DX-2 guard/rollback tests; webhook `npm ci`, typecheck, 13 tests, build; console `npm ci`, build; `git diff --check` | pass | All six non-destructive PRs merged; C3 provisioning also reached Zenod main; #714 and #741 closed complete; main CI/publish observed separately. |
| 2026-07-10 | Post-integration spine | Zenod `fa49f5c` | clean detached `origin/main` | strict spine validation; `bash -n` DX-2 script; DX-2 guard/rollback tests; `git diff --check`; PR #755 CI | pass | PR #755 merged; authoritative delivery ledger is on main. |
| 2026-07-10 | Unit tenant API live readiness | public HTTPS, unauthenticated GET only | `z2.zenod.dev`, `callisthenes.zenod.dev`, `ring.zenod.dev` | `curl --max-time 15 --connect-timeout 5 -sS -o /dev/null -w 'HTTP %{http_code}' https://<unit>/api/tenants` | blocked / partial | Zenod HTTP 401 proves an auth-gated route is deployed; Callisthenes HTTP 404 and Ring HTTP 404 prove those routes are not deployed. No POST, token, secret, or mutation used. |
| 2026-07-10 | Ring checkout topology review | cloud `09ca15d`; Epic 3.0/3.4 and final map | read-only independent agent review | trace product/unit decisions, cloud checkout metadata, endpoint selection, and tests | pass / follow-up | Ring is a standalone unit and correctly calls one Ring endpoint. #756 owns fail-closed separation of product identity from unit topology before suite SKUs exist. |
| 2026-07-10 | DX-8A initial checkout topology patch | cloud `1e3538f` | isolated cloud worktree + signed local webhook acceptance | webhook typecheck/16 tests/build; console build; diff check; independent end-to-end queue probe | fail / fixed | Unit API parser and Ring call count passed, but recovery queue accepted suite as Ring and malformed modern metadata as Zenod. PR #60 was held; no production change occurred. |
| 2026-07-10 | DX-8A corrected checkout topology patch | cloud `28bbd3f`; merged main `039e2cd` | isolated branch plus fresh detached cloud main | steward typecheck/18 tests/webhook build/console build; independent signed webhook suite/malformed/valid/legacy probes; fresh `npm ci`; diff check | pass | Invalid modern sessions create failed evidence with no executable queue entry or API call; Ring calls only Ring; historical sessions remain compatible; session/subscription metadata match; zero npm vulnerabilities; production mode remains off. PR #60 merged and #756 closed complete. |

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

### 2026-07-10 - Delivery Manager - Safety fix loop and DX-8 implementation complete

Context: independent DX-1/DX-2 safety review found six defects. The steward corrected the 34-row inventory and added all Dokploy IDs, then hardened DX-2 through exact live identifier reconciliation, digest-bound approval, durable manifests/checksums, snapshot/restore-before-delete, automatic pre-delete rollback, watchdog before/after evidence, endpoint expectations, and resource measurements. A second Alpha9 dry-run reconciled all 17 rows with zero mutations. Galileo implemented the fail-closed cloud `/api/tenants` replacement and an independent observer matched it to C3.
Next: Jordi approves the DX-2 digest/archive target. Unit owners deliver the three deployed endpoints so cloud-test can enable PR #59 and run Stripe TEST checkouts.
Risks: no destructive command has run; current 2.x rows still exist. Enabling `tenants_api` before all unit endpoints/tokens exist fails startup by design. Legacy cleanup remains unsafe until endpoint enablement and retirement waves complete.
Assignment identity: Epic 3.7 delivery manager reconciliation
Branch / latest commits: DX-1 `dd403d3`; DX-2 `976131d`; cloud DX-8 `60114da`
Last verified: 2026-07-10 02:27 CEST
Links:

- https://github.com/zenod-ai/zenod/pull/746
- https://github.com/zenod-ai/zenod/pull/749
- https://github.com/zenod-ai/cloud/pull/59

### 2026-07-10 - Delivery Manager - Completed artifacts integrated

Context: all six completed non-destructive PRs were merged in dependency order. Zenod main now contains the spine/inventory, public provisioner audit, final-sweep/restore runbook, and guarded DX-2 package. Cloud main contains the control-plane audit and fail-closed shared-unit provisioning client. Clean merged-main worktrees passed the strict spine validator, DX-2 guard/rollback tests, webhook typecheck/build and 13 tests, and console build.
Next: obtain Jordi's digest/archive approval for DX-2. In parallel, unit owners deliver the three deployed `/api/tenants` endpoints before cloud-test enablement.
Risks: merges do not authorize execution. No production mode, secret, container, volume, domain, DNS, or watchdog state was changed.
Assignment identity: Epic 3.7 delivery manager integration
Branch / latest commits: Zenod main `6025f47`; cloud main `09ca15d`
Last verified: 2026-07-10 02:38 CEST
Links:

- https://github.com/zenod-ai/zenod/pull/746
- https://github.com/zenod-ai/zenod/pull/747
- https://github.com/zenod-ai/zenod/pull/748
- https://github.com/zenod-ai/zenod/pull/749
- https://github.com/zenod-ai/cloud/pull/58
- https://github.com/zenod-ai/cloud/pull/59

### 2026-07-10 - Delivery Manager - Live readiness and checkout-topology review

Context: PR #755 merged the reconciled Epic 3.7 spine and merged-main validation passed again. Read-only public probes found the Zenod tenant API deployed and auth-gated at HTTP 401, while Callisthenes and Ring returned HTTP 404. An independent architecture review confirmed that a Ring unit checkout correctly provisions one Ring tenant; suite products are a separate composition path. #756 separated product identity from unit topology. Independent signed webhook testing rejected its first commit because the recovery queue still aliased invalid metadata; the fix loop moved validation before queue admission, passed re-test, and merged through cloud PR #60.
Next: keep `TENANT_PROVISIONING_MODE` off until all three HTTPS endpoints and tokens exist, then use cloud-test for one Stripe TEST checkout per unit. Jordi separately approves the DX-2 digest and archive target before any removal.
Risks: Callisthenes and Ring endpoint deployments are hard blockers for checkout testing. No production or destructive state changed; legacy cleanup still waits for endpoint enablement and retirement waves.
Assignment identity: Epic 3.7 delivery manager integration
Branch / latest commits: Zenod main `fa49f5c`; cloud main `039e2cd`
Last verified: 2026-07-10 03:08 CEST
Links:

- https://github.com/zenod-ai/zenod/pull/755
- https://github.com/zenod-ai/zenod/issues/756
- https://github.com/zenod-ai/cloud/pull/60

### 2026-07-10 - Delivery Manager - DX-2 approved early-wins retirement complete

Context: Jordi approved the exact 17-row digest and dated Alpha9 archive target. The guard suite and a fresh 253-action live dry-run passed before execution. The guarded batch archived and checksummed 45 volumes, restored the first archive into a temporary volume before deletion, then retired 13 test stacks and 4 failed duplicate records. Sartre failed the first postflight because the five-minute cloud sync regenerated two retired checks from production account registrations. The source store was snapshotted and only those two retired `tenant_slug` values were atomically cleared; explicit sync/watchdog runs and the next natural cloud sync preserved zero retired tokens. #773 owns a permanent guarded CLI and regression coverage.
Next: #722 and #773 are closed complete. Keep the archive; select an off-host mirror destination without blocking DX-2. Continue endpoint deployment and migration-gated DX-3..6 work; later waves use the merged guarded deregistration CLI.
Risks: raw root-only evidence contains historical compose environment values and must remain mode-restricted; do not publish or attach raw manifests. The live-paying Zenod and two ambiguous active stacks were excluded and independently rechecked at Dokploy/public HTTP 200.
Assignment identity: Epic 3.7 delivery manager DX-2 execution
Runtime package / base: `cd9c21f` / Zenod main `468095d`
Last verified: 2026-07-10 04:24 CEST
Evidence: `/srv/zenod-archives/epic37/dx2/20260710/evidence-20260710T020112Z/`; 45/45 checksums pass; zero candidate records, containers, volumes, or watchdog tokens remain after natural source sync and watchdog cycles; 16 retired routes return 404 and the shared retained Ring route returns 200. Independent acceptance: #722 comment `4931408431`.
Links:

- https://github.com/zenod-ai/zenod/issues/722#issuecomment-4931281736
- https://github.com/zenod-ai/zenod/issues/722#issuecomment-4931408431
- https://github.com/zenod-ai/zenod/pull/749
- https://github.com/zenod-ai/zenod/issues/773
- https://github.com/zenod-ai/cloud/pull/61

## Open Questions

- Choose an off-host mirror destination for the completed DX-2 archive at `/srv/zenod-archives/epic37/dx2/20260710/`. This is defense in depth and does not block DX-2 completion; raw root-only manifests contain historical environment values and must not be published. Owner: Jordi/steward. Needed by: archive durability follow-up.
- DX-1 found one live-paying row (`zenod-jordi-f2c7a6`) and two ambiguous active rows (`callisthenes-jordicallifresh33087-muhmxp`, `ring-jordiring-fkegkz`). The DX-2 batch excludes all three; only the failed duplicate record sharing the Ring hostname is included with `still-routed` postcondition. Owner: Jordi/steward. Needed by: later waves, not DX-2 test-row approval.
- Cloud main `3e80e7b` includes #745's fail-closed client, #756's product/topology queue hardening, and #773's guarded watchdog deregistration CLI; generic C3 provisioning is on Zenod main. The 2026-07-10 public probe still found Zenod `/api/tenants` deployed and auth-gated at HTTP 401, while Callisthenes and Ring returned HTTP 404. Control-plane token configuration was not inspected or changed. Owner: Epic 3.3/Ring unit workers plus cloud operator. Needed by: DX-8 enablement and DX-6 cleanup.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Z-MT-6 completion must notify this spine to unblock DX-3. | this spine | Epic 3.2 worker | proposed |
| 2026-07-10 | `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | CA-MT-6 completion must notify this spine to unblock DX-4. | this spine | Epic 3.3 worker | proposed |
| 2026-07-10 | `docs/EPIC-3.5-EPAMINON-MULTITENANT.md` | E-MT-7 completion must notify this spine to unblock DX-5. | this spine | Epic 3.5 worker | proposed |
| 2026-07-10 | `docs/EPIC-3.4-RING-MULTITENANT.md` | Deploy the Ring HTTPS `/api/tenants` route and notify this spine; preserve Ring-as-unit semantics while suite composition remains separate. | public HTTP 404 probe; independent architecture review | Epic 3.4 worker | proposed |

## Appendix

- 2.x per-tenant anatomy to unwind: Dokploy app, container, `/data` volume, subdomain + TLS, minted token, watchdog entry, gateway key.
- Known quirk: Dokploy sometimes "created the compose record but did not materialize the container" — inventory must reconcile API records against `docker ps -a`.
