# EPIC 3.1 · MCP Chassis — extract the write-once scaffold

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.1-MCP-CHASSIS.md`
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
| Planner | Epic 3.0 planner | Chassis scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | unassigned | This spine | Delivery lead: build the chassis package through the issue loop. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.1-MCP-CHASSIS.md`
Active steward: unassigned (Epic 3.0 planner until epic worker bound)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.2-ZENOD-MULTITENANT.md` … `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` — consumer siblings.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Chassis intent, scope, acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Create `packages/mcp-chassis` (`@zenod/mcp-chassis`): the reusable scaffold every Node unit boots from, extracted from the proven code in `packages/server` and upgraded with first-class tenancy. A unit becomes `createUnit({ name, tools, ui? })`. The chassis owns transport, tenant auth, the tenants table and provisioning API, tenant-scoped storage and vault handles, metering, health, logging, and the tenant-scoped settings-UI shell. Also publish SEAM-SPEC vNext, the language-agnostic contract that non-Node units (Callisthenes) satisfy.

## Definition Of Done

- [ ] `packages/mcp-chassis` exists with: stateless Streamable HTTP `/mcp`, bearer→tenant resolution (`sha256(bearer)` lookup + tokened-URL form + OAuth mapping), tenants table, `POST/DELETE /api/tenants` + token rotation guarded by `CONTROL_PLANE_TOKEN`, `storage.db(tenant)`/`storage.dir(tenant)` handles, per-tenant vault, per-tenant usage metering + quota middleware, `/healthz`, pino logs carrying `tenant_id`.
- [ ] Settings-UI shell: token/session login, per-tenant settings/keys/usage pages, unit plugs in its own panels.
- [ ] Single-tenant mode: env-seeded token auto-creates one tenant at boot; identical image and UI (self-host contract).
- [ ] A demo unit (`units/demo` or test harness) runs on the chassis with the two-tenant smoke test passing: cross-tenant access fails, per-tenant ledgers isolate.
- [ ] SEAM-SPEC vNext written (`docs/SEAM-SPEC-VNEXT.md`) covering transport, auth, tenancy, provisioning, storage, health, env, container, DNS, deploy rows.
- [ ] Chassis README documents `createUnit` and the migration recipe for an existing agent.

## Non-Goals

- Migrating any real unit (that is 3.2–3.6).
- Physical repo split; chassis is a workspace package.
- Suite/combined dashboard; only the machine-tenant seam (`/api/tenants` + agent tokens) is provided.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: confirm D4 (DB) in parent spine, then dispatch epic worker to ticket C-1.
Blockers: parent D4 pending.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed, sequenced backlog. | Dispatched or named blocker. |
| Epic worker | Chassis delivered per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove tenancy isolation and self-host parity. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/MCP-CHASSIS-SPEC.md` | What the chassis owns; the contract. | Always |
| 2 | `packages/server/src/app.ts` | Transport + `/mcp` handler to extract. | Worker |
| 3 | `packages/server/src/auth.ts` | `requireMcpAuth` to upgrade with tenant lookup. | Worker |
| 4 | `packages/server/src/agent.ts`, `runtime.ts` | `AGENTS` map and storage construction to generalize. | Worker |
| 5 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Parent decisions D1–D5. | Always |

## Architecture And Context

Extraction, not invention. `packages/server` already provides stateless `StreamableHTTPServerTransport` per request, `requireMcpAuth` (static bearer, OAuth, session cookie), settings with token minting (`zenod_<48hex>`), SQLite-on-`/data` construction in `runtime.ts`, and an admin web UI on the same Hono app. The chassis lifts these behind a stable API and adds: tenants table, tenant resolution in auth, tenant-prefixed storage handles (`/data/<tenant>/…`), provisioning endpoints, and tenant-scoped UI shell. `resolveAgent`/`AGENTS` becomes `createUnit`. Storage behind a seam so D4 (SQLite → PGlite/Postgres) is swappable without touching units.

Ticket sketch: C-1 package scaffold + transport lift; C-2 tenants table + auth tenant resolution; C-3 provisioning API + single-tenant boot; C-4 storage/vault handles; C-5 metering + quota; C-6 UI shell; C-7 demo unit + two-tenant smoke test; C-8 SEAM-SPEC vNext doc.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Extract from `packages/server` rather than greenfield. | The transport/auth/storage code is proven in production. | Code survey in parent appendix |
| 2026-07-10 | Tokens stored as hashes only; raw token shown once at mint. | Standard credential hygiene; matches #645 tenant-from-bearer rule. | `docs/MCP-CHASSIS-SPEC.md` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | C-1 scaffold `packages/mcp-chassis`, lift transport | draft | D4 | - | `f1edc8c` | Demo boots, `/mcp` answers initialize. | - | 2026-07-10 00:19 CEST | Mint issue after D4. |
| draft | Ticket worker | unassigned | C-2 tenants table + bearer→tenant auth | draft | C-1 | - | `f1edc8c` | Two tokens resolve to two tenants; unknown token 401. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | C-3 provisioning API + single-tenant env boot | draft | C-2 | - | `f1edc8c` | `POST /api/tenants` mints; env token seeds tenant 1. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | C-4 tenant-scoped storage + vault handles | draft | C-2 | - | `f1edc8c` | `/data/<tenant>/` layout; vault rows tenant-keyed. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | C-5 metering + quota middleware | draft | C-4 | - | `f1edc8c` | Per-tenant usage rows; block-at-zero works. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | C-6 tenant-scoped settings-UI shell | draft | C-3 | - | `f1edc8c` | Login with token shows only that tenant's pages. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Tester | unassigned | C-7 demo unit + two-tenant smoke test | draft | C-1..C-6 | - | `f1edc8c` | Cross-tenant access provably fails; self-host parity run. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | C-8 SEAM-SPEC vNext document | draft | C-2 | - | `f1edc8c` | Contract table complete; Callisthenes gap list included. | - | 2026-07-10 00:19 CEST | Mint issue. |

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
| D4 database choice | Jordi | Before C-1 | SQLite now vs PGlite vs Postgres | Spec/ticket drafting |
| Chassis API freeze | Jordi | Before 3.2/3.3 consume it | Approve `createUnit` + SEAM-SPEC vNext surface | Internal refactors |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Mint GitHub issues C-1…C-8 after D4.
- Decide whether the UI shell reuses `apps/web` components or stays chassis-local.

## Worker Queue

- None until dispatch.

## Tester Queue

- Draft the two-tenant smoke test script (shared with all 3.x epics).

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.1-MCP-CHASSIS.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Child of Epic 3.0; critical path for 3.2–3.6. Extraction targets identified in code survey.
Next: D4 decision, then dispatch C-1.
Risks: over-abstracting; keep the chassis API the smallest thing 3.2/3.3 need.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`

## Open Questions

- Does the OAuth flow (Claude.ai sign-in) map to tenants 1:1 or can one OAuth user hold several tenants? Owner: Epic worker. Needed by: C-2.
- UI shell stack: reuse `apps/web` (React) or server-rendered Hono pages? Owner: Jordi. Needed by: C-6.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Record chassis API freeze date once C-1..C-8 land. | this spine | Epic 3.0 planner | proposed |

## Appendix

- Existing token format `zenod_<48hex>` (`packages/server/src/settings.ts`); keep for continuity.
- `node:sqlite` `DatabaseSync` wrapper: `packages/core/src/state/sqlite.ts`.
