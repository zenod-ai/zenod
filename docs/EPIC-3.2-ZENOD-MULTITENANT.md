# EPIC 3.2 · Zenod Multi-Tenant — one container, all wiki brains

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.2-ZENOD-MULTITENANT.md`
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
| Planner | Epic 3.0 planner | Zenod migration scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | unassigned | This spine | Delivery lead: migrate Zenod onto the chassis. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.2-ZENOD-MULTITENANT.md`
Active steward: unassigned (Epic 3.0 planner until epic worker bound)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.1-MCP-CHASSIS.md` — dependency.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` — prior Zenod product spine (deployment sections superseded on acceptance).

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Zenod multi-tenant migration intent, acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Run every hosted Zenod tenant from ONE container on the chassis. Tenant-prefix all state — the SQLite set, the markdown vault git clone, transcripts, media artifacts — under `/data/<tenant>/…` via chassis storage handles. Keep the ZD-8 tokened MCP URL unchanged for clients. Ship the Zenod settings UI (repo connection, ingest config, usage) as chassis UI panels, so the self-hosted image is the full product with one tenant. Migrate existing per-user containers with a scripted, reversible data move.

## Definition Of Done

- [ ] Zenod boots via `createUnit` on the chassis; `AGENT=zenod` path retired.
- [ ] All state tenant-prefixed: `zenod.sqlite`, `ingest.sqlite`, `usage.sqlite`, `vault/` clone, `transcripts/`, media store under `/data/<tenant>/`.
- [ ] Per-tenant repo token custody in the chassis vault; only Zenod code may read it (Law 6).
- [ ] Two-tenant smoke test passes: two vaults, cross-tenant ingest/read provably fails, per-tenant commit receipts intact.
- [ ] Self-host parity: public image, env token, single tenant, UI included; restore-from-repo runbook (Z-5) re-verified.
- [ ] Existing hosted tenants migrated by script from per-user volumes to tenant prefixes, with rollback documented.
- [ ] `zenod.zenod.dev` serves all tenants; per-tenant subdomains retired after migration window.

## Non-Goals

- Changing Zenod's tool surface, ingest/digest behavior, or media pipeline semantics.
- Multi-region or horizontal scaling of the Zenod container.
- Suite composition (proved in 3.0 with the machine-tenant seam).

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: wait for 3.1 chassis API freeze; then dispatch Z-MT-1.
Blockers: depends on Epic 3.1.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed, sequenced backlog. | Dispatched or named blocker. |
| Epic worker | Zenod on chassis per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove tenancy isolation and migration safety. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-3.1-MCP-CHASSIS.md` | The scaffold this migration targets. | Always |
| 2 | `packages/server/src/runtime.ts` | Current storage construction to re-point at tenant handles. | Worker |
| 3 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Product facts, ZD decisions, tokened URL. | Always |
| 4 | `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md` | Self-host/restore contract to preserve. | Tester |

## Architecture And Context

Zenod is the stateful unit: per-tenant git vault clone plus ~9 SQLite files currently constructed once per container in `runtime.ts`. Under the chassis, construction moves to per-tenant lazy init behind `storage.dir(tenant)`/`storage.db(tenant, name)`. The MCP tool surface (`buildMcpServer`) is unchanged; it receives tenant-scoped handles from context instead of globals. Migration: for each existing tenant container, stop, copy volume into `/data/<tenant>/` of the multi-tenant instance, insert tenant row with the SAME token hash (URL continuity), verify, then retire the old container and subdomain.

Ticket sketch: Z-MT-1 runtime storage → tenant handles; Z-MT-2 vault/repo custody via chassis vault; Z-MT-3 UI panels; Z-MT-4 migration script + rollback; Z-MT-5 two-tenant smoke + self-host parity; Z-MT-6 DNS/proxy cutover and old-instance retirement.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Preserve existing tenant tokens across migration. | Client URLs (ZD-8) must not change; token hash is the tenant key. | `docs/MCP-CHASSIS-SPEC.md` |
| 2026-07-10 | Lazy per-tenant storage init. | Avoid boot-time scan of all tenants; first request creates handles. | parent D1 |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | Z-MT-1 tenant-scoped storage in runtime | draft | 3.1 C-4 | - | `f1edc8c` | All DB/paths resolved via chassis handles. | - | 2026-07-10 00:19 CEST | Mint after chassis freeze. |
| draft | Ticket worker | unassigned | Z-MT-2 repo-token custody in vault | draft | Z-MT-1 | - | `f1edc8c` | Repo token per tenant, vault-read only by Zenod. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | Z-MT-3 Zenod settings-UI panels | draft | 3.1 C-6 | - | `f1edc8c` | Tenant sees repo/ingest/usage panels only for itself. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | Z-MT-4 migration script + rollback | draft | Z-MT-1 | - | `f1edc8c` | Dry-run on copied volume passes checksums. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Tester | unassigned | Z-MT-5 two-tenant smoke + self-host parity | draft | Z-MT-1..3 | - | `f1edc8c` | Isolation proven; Z-5 runbook passes on public image. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | Z-MT-6 cutover + retire per-user instances | draft | Z-MT-4,5 | - | `f1edc8c` | Old containers/subdomains removed; watchdog = 1 check. | - | 2026-07-10 00:19 CEST | Mint issue. |

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
| Live tenant migration | Jordi | Z-MT-6 cutover | Approve window, order, rollback plan per tenant | Test-env migration rehearsal |
| Subdomain retirement | Jordi | After all tenants verified on shared hostname | Approve DNS deletion | Keeping legacy records as redirects |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Mint Z-MT issues once 3.1 freezes the chassis API.
- Inventory current live tenants and volumes for Z-MT-4.

## Worker Queue

- None until dispatch.

## Tester Queue

- Extend the shared two-tenant smoke test with vault/commit-receipt checks.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.2-ZENOD-MULTITENANT.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Child of Epic 3.0. Zenod is the stateful, hardest migration; scheduled after Callisthenes proves the pattern.
Next: chassis freeze, then Z-MT-1.
Risks: data migration of live paying tenants; git vault path assumptions buried in ingest/media code.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`

## Open Questions

- Do any ingest/media code paths hardcode `/data` roots outside `runtime.ts`? Owner: Epic worker. Needed by: Z-MT-1.
- Per-tenant gateway (LLM) keys: chassis vault or keep the standalone keyring? Owner: Jordi. Needed by: Z-MT-2.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Mark Z-1/ZD-6/ZD-10 deployment model superseded by this epic once Z-MT-6 lands. | this spine | Epic 2.3 steward | proposed |

## Appendix

- Current SQLite set (from `runtime.ts`): zenod, oauth, whatsapp, ingest, tasks, execution, journeys, usage, notifications.
