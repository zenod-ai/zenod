# EPIC 3.5 · Epaminon Multi-Tenant — one API, ephemeral job sandboxes

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.5-EPAMINON-MULTITENANT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: unassigned (planner draft by Epic 3.0 planner)
Steward since: 2026-07-10 00:19 CEST
Last reconciled commit: `f1edc8c`
Planner: Epic 3.0 planner
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Epaminon migration scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | unassigned | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.5-EPAMINON-MULTITENANT.md`
Active steward: unassigned (Epic 3.0 planner until epic worker bound)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.1-MCP-CHASSIS.md` — dependency.
- `docs/EPIC-2.9-EPAMINON-MOVE-0.md` — prior product spine.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Epaminon migration intent, acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Split Epaminon into two parts with different lifecycles. The front is a multi-tenant chassis unit: `/mcp` accepts task+effort+context, tenant-scoped queue/status/transcript/evidence, settings UI. The back is the ONLY sanctioned per-something container in the suite: an **ephemeral sandbox per job** — spawned to run the authenticated CLI worker (Codex/Claude-style), persisting transcript and artifacts to the tenant's storage, then destroyed. This replaces the always-on per-user Epaminon and the `ZENOD_AWAIT_PROVISION` idle-until-provisioned model, and it is the honest isolation boundary: arbitrary agent code never runs inside the shared API container.

## Definition Of Done

- [ ] Epaminon API boots via `createUnit`; task submission, status, transcript, artifact retrieval all tenant-scoped.
- [ ] Sandbox runner: per-job container from a pinned worker image; job env carries only that job's credentials and that tenant's scoped tokens; no `CONTROL_PLANE_TOKEN`, no other tenants' secrets.
- [ ] Lifecycle proven: spawn → run → persist transcript/evidence to `/data/<tenant>/jobs/<job>/` → teardown; no orphan containers after crash tests.
- [ ] Concurrency + quota: per-tenant concurrent-job cap and metering via chassis; queue fairness under two-tenant load.
- [ ] `ZENOD_AWAIT_PROVISION` flow removed; provisioning via `/api/tenants`.
- [ ] Three-tenant browser E2E (Autonomous Validation Protocol below) passes: three tenants run jobs to completion watched through the UI, isolation and sandbox containment proven, no orphans after crash tests — executed autonomously with screenshots in evidence.
- [ ] Jobs console UI (Jobs, Job detail, Submit, Limits) served from the api container per the UI Surface section.
- [ ] Self-host parity: same image; single tenant; sandbox spawning works on a plain Docker host.

## Non-Goals

- Owning backlog (Archus), memory (Zenod), or sending (Callisthenes) — unchanged unit boundaries.
- Kubernetes jobs, Fly machines, or remote execution backends (a later option behind the same spawner seam).
- Worker-CLI product behavior changes (what the agent does inside the job).

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: Phase 2 (parent D6) — dispatch after the Zenod pilot gate passes AND the spawner mechanism is decided (Docker socket vs host runner — parent open question 3).
Blockers: pilot gate not yet passed; spawner decision pending (Jordi).

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed, sequenced backlog. | Dispatched or named blocker. |
| Epic worker | Epaminon split per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove tenant isolation of jobs AND sandbox containment. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-3.1-MCP-CHASSIS.md` | The scaffold for the API front. | Always |
| 1 | `docs/final-container-map-deck.html` | CANONICAL target picture (parent D11): the epaminon box — API + ephemeral sandboxes, GitHub OAuth via chassis kit, own Stripe webhook. | Always |
| 2 | `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Current executor facts and task model. | Always |
| 3 | `docker-compose.epaminon.yml` | Current always-on shape being replaced. | Worker |
| 4 | `docs/EPAMINON-ARCHUS-PROTOCOL.md` | Task handoff protocol to preserve. | Worker |

## Architecture And Context

Today Epaminon is the shared Node image with `AGENT=epaminon` (`executor: true, vaultless: true`), always-on per user, idling under `ZENOD_AWAIT_PROVISION` until the Console pushes config. Target: the API front keeps the same MCP task surface (`run_task`, status, transcript — protocol per EPAMINON-ARCHUS) on the chassis; a spawner seam (`spawnJob(tenant, job)`) launches the sandbox. Sandbox spawner options: (a) Docker socket mounted into the API container — simple, but the socket is root-equivalent, must be guarded; (b) tiny host-side runner service consuming a job queue — one more piece, cleaner privilege story. Decision gate below.

Ticket sketch: E-MT-1 API on chassis + tenant-scoped job store; E-MT-2 spawner seam + chosen mechanism; E-MT-3 pinned worker image + job env contract; E-MT-4 lifecycle/orphan-reaping + crash tests; E-MT-5 quotas/metering/fairness; E-MT-6 three-tenant browser E2E + self-host parity; E-MT-7 remove AWAIT_PROVISION and retire per-user instances.

### UI Surface (PORT the existing executor panels from `apps/web` — D7)

Epaminon's UI already exists inside the `apps/web` console: `epaminon-executor-settings.tsx` plus the executor/journey API (`/api/exec/*`, `/api/executions`, `/api/journeys/*`, `/api/tasks/jobs`, `GET/PUT /api/executor/settings`, `/api/agent/repo|github|lane`). Port these onto the chassis shell and tenant-scope them; extend in the same component style where the jobs view is thin. Mapped to product language:

- **Jobs** — tenant's job list from the existing executions/journeys endpoints: status, effort, started/finished, cost.
- **Job detail** — live status, transcript viewer (transcripts already persist per run), artifacts download, cancel.
- **Submit** — manual task submission mirroring the MCP surface (existing exec-lane form as the base).
- **Limits** — concurrent-job cap + quota/balance, CostsTab pattern.

A tenant sees only their jobs, transcripts, artifacts — never another tenant's, never sandbox internals beyond their own transcript.

### Container And Deploy (two lifecycles — be precise)

- **epaminon-api**: ONE always-on multi-tenant container on the chassis, port 8080, hostname `epaminon.zenod.dev`, `VOLUME /data` (`/data/<tenant>/jobs/<job>/`). One Dokploy application. Client URL `https://epaminon.zenod.dev/mcp/<token>`.
- **Job sandboxes**: ephemeral containers from a PINNED worker image, spawned per job by the spawner seam, resource-limited (CPU/RAM/lifetime by effort level), destroyed after evidence persists. NOT Dokploy applications; they are runtime children of the API (mechanism per the spawner gate). Zero always-on cost, zero per-user containers.

### Autonomous Validation Protocol (three-tenant browser E2E)

The epic worker validates WITHOUT human help, via browser automation, against a fresh local api container with a working spawner:

1. Boot fresh; provision T1, T2, T3 via `POST /api/tenants`.
2. Per tenant: submit a job via MCP (`/mcp/<token>`) with a task that writes a per-tenant marker artifact; browser-login and watch it in the Jobs UI through to done.
3. Assert per tenant: transcript + artifact appear under that tenant only; `docker ps` shows the sandbox during the run and NOT after; `/data/<tenant>/jobs/<job>/` holds the evidence.
4. Concurrency/fairness: submit jobs for all three tenants simultaneously with T1 over its cap; assert T1 queues while T2/T3 run.
5. Negative: T1's UI/API cannot list, read, or cancel T2's jobs (direct-URL and API attempts); inspect a running sandbox's env and assert it contains no `CONTROL_PLANE_TOKEN` and no other tenant's credentials; kill the API mid-job and assert no orphan sandbox survives reaping.
6. Self-host parity: env-seeded single tenant on a plain Docker host; submit → run → artifact works identically.
7. Record commands, screenshots, `docker ps` captures, env audits in Validation Evidence with exact commit.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Isolation moves from per-user to per-job. | Real boundary is arbitrary agent code, which exists per job, not per user; idle per-user executors waste RAM. | parent D1, `docs/MCP-CHASSIS-SPEC.md` |
| 2026-07-10 | Job env carries minimum credentials. | Sandbox runs untrusted-ish agent output; blast radius must be one job, one tenant. | Law 6 |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | E-MT-1 API on chassis, tenant job store | draft | 3.1 | - | `f1edc8c` | Jobs CRUD tenant-scoped via chassis handles. | - | 2026-07-10 00:19 CEST | Mint after chassis freeze. |
| draft | Ticket worker | unassigned | E-MT-2 spawner seam + mechanism | draft | spawner gate | - | `f1edc8c` | `spawnJob` launches/tears down a container. | - | 2026-07-10 00:19 CEST | Blocked on Jordi's spawner decision. |
| draft | Ticket worker | unassigned | E-MT-3 worker image + job env contract | draft | E-MT-2 | - | `f1edc8c` | Job env audit: only job-scoped creds present. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | E-MT-4 lifecycle + orphan reaping | draft | E-MT-2 | - | `f1edc8c` | Kill-during-run leaves no orphan; evidence persisted. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | E-MT-5 quotas, metering, fairness | draft | E-MT-1 | - | `f1edc8c` | Per-tenant caps enforced under parallel load. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Tester | unassigned | E-MT-6 two-tenant smoke + self-host parity | draft | E-MT-1..5 | - | `f1edc8c` | Isolation + containment proven; plain-Docker self-host run. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | E-MT-7 remove AWAIT_PROVISION, retire instances | draft | E-MT-6 | - | `f1edc8c` | One `e.zenod.dev` hostname; old flow deleted. | - | 2026-07-10 00:19 CEST | Mint issue. |

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
| Sandbox spawner mechanism | Jordi | Before E-MT-2 | Docker socket in API container vs host-side runner service | E-MT-1 and seam design |
| Worker CLI credentials | Jordi | E-MT-3 defines job env | Approve which authenticated CLI creds jobs receive and how | Test with throwaway creds |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Put the spawner decision in front of Jordi with a one-page comparison.
- Mint E-MT issues after chassis freeze.

## Worker Queue

- None until dispatch.

## Tester Queue

- Design crash/kill test matrix for E-MT-4.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.5-EPAMINON-MULTITENANT.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Child of Epic 3.0. Epaminon carries the suite's only honest per-container isolation need; the split makes that boundary per-job and ephemeral.
Next: spawner decision, chassis freeze, E-MT-1.
Risks: Docker-socket privilege if option (a); orphan containers; job env credential leakage.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`

## Open Questions

- Max sandbox lifetime / effort-level → resource-limit mapping? Owner: Epic worker. Needed by: E-MT-3.
- Do sandboxes need outbound network beyond the LLM gateway and git remotes? Owner: Jordi. Needed by: E-MT-3.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Record API/sandbox split delegated to this epic; AWAIT_PROVISION model superseded on E-MT-7. | this spine | Epic 2.9 steward | proposed |

## Appendix

- Current compose: `docker-compose.epaminon.yml` (`restart: unless-stopped`, `ZENOD_AWAIT_PROVISION=1`).
