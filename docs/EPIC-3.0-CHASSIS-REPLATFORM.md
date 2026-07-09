# EPIC 3.0 · Chassis Replatform — one multi-tenant container per unit, written once

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.0-CHASSIS-REPLATFORM.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Epic 3.0 planner (Jordi + bound agent task)
Steward since: 2026-07-10 00:19 CEST
Last reconciled commit: `f1edc8c`
Planner: Jordi + bound agent
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Foundation/root scope | Reads this spine for rollups; routes decisions. | Root state reconciled. |
| Planner | Epic 3.0 planner | Replatform scope 3.0–3.6 | Shape acceptance, sequence child epics, maintain this ledger; no implementation by default. | Executable ledger, decisions, dispatch state. |
| Epic worker | unassigned | Child epic delivery (3.1 first) | Delivery lead inside accepted child scope; steward the child spine. | Child spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch; structured issue handoff. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, residual risk. |

## Write Scope

Bound spine: `docs/EPIC-3.0-CHASSIS-REPLATFORM.md`
Active steward: Epic 3.0 planner (Jordi + bound agent task)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-0-FOUNDATION-SPINE.md` — root/meta spine.
- `docs/EPIC-3.1-MCP-CHASSIS.md` … `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` — child execution spines.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md`, `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md`, `docs/EPIC-2.5-ATOMIC-UNITS.md`, `docs/EPIC-2.9-EPAMINON-MOVE-0.md` — superseded-in-part deployment assumptions.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Replatform intent, sequence, cross-unit acceptance, decisions |
| Child spine (3.1–3.6) | That unit's implementation state, ledger, local decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent / Epic 0 spine | Project direction, spine relationships |

## Mission

Replace Law-7 instance-per-user hosting with the chassis model: every unit is one always-on multi-tenant container built from one shared scaffold (`@zenod/mcp-chassis` for Node; SEAM-SPEC vNext contract for any stack), serving all tenants' MCP endpoints AND that unit's human settings UI from the same app. A new customer is a tenant row, never a deploy. Self-hosted is the identical image with a tenant count of one, including the UI. Suites (Herald, Council) compose units as machine tenants holding agent→unit tokens — units never embed suite logic. Full architecture: `docs/MCP-CHASSIS-SPEC.md` and `docs/mcp-hosting-options-deck.html`.

## Definition Of Done

- [ ] 3.1 chassis exists: transport, tenant auth, tenants table + `/api/tenants`, tenant-scoped storage, vault, metering, settings-UI shell — extracted, tested, documented.
- [ ] 3.2–3.6 each unit runs as ONE multi-tenant container conforming to SEAM-SPEC vNext, with ≥2 tenants exercised in hosted mode and single-tenant self-host verified from the public image.
- [ ] Stripe webhook provisions via `POST /api/tenants` end to end; the Dokploy per-tenant provisioner, per-tenant DNS minting, and watchdog registration API are deleted.
- [ ] Each unit serves its settings UI from the unit container; `zenod-ai/cloud` no longer hosts per-unit settings.
- [ ] A suite-composition proof: one machine tenant provisioned into two units, configured from an external UI via agent→unit tokens.
- [ ] Cross-spine updates recorded and adopted by 2.3/2.4/2.5/2.9 stewards (Law 7 amendment in 2.5).

## Non-Goals

- Building the combined/suite dashboard product (Herald UI is Epic 4-HERALD scope; here we only prove the machine-tenant seam).
- Physical repo split (RD-4 stays staged; chassis is a monorepo package).
- Kubernetes, Cloudflare Workers, or any platform move; the VPS + Dokploy (one app per unit) remains the deploy target.
- Rewriting Callisthenes to Node; it conforms by contract in Python.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: Jordi reviews architecture decisions D1–D5 below; then dispatch Epic worker to 3.1.
Blockers: DB choice (D4) unconfirmed. (Numbering resolved 2026-07-10: Herald moved to Epic 4 — `docs/EPIC-4-HERALD.md`; this replatform family owns Epic 3.)

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic 0 worker | Keep replatform coherent with the project picture. | Rollups current or human decision required. |
| Planner | Make 3.1–3.6 executable and sequenced. | Backlog ready/dispatched or named blocker. |
| Epic worker | Deliver a child epic through the issue loop. | Ready for human test, tester handoff, or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked with required input. |
| Tester | Prove pass/fail. | Acceptance passed, evidenced failure, or planner decision required. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/MCP-CHASSIS-SPEC.md` | The architecture this epic implements. | Always |
| 2 | `docs/mcp-hosting-options-deck.html` | Why option B; the target picture. | Always |
| 3 | `docs/EPIC-3.1-MCP-CHASSIS.md` | The critical-path child epic. | Planner, Epic worker |
| 4 | `packages/server/src/app.ts`, `auth.ts`, `agent.ts` | The existing code the chassis is extracted from. | Worker |
| 5 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | The laws being amended. | Planner |

## Architecture And Context

The unit anatomy ("cookie cutter"), decided 2026-07-10:

- One unit = one container = one app. The same HTTP app serves `/mcp` (Streamable HTTP, stateless, bearer→tenant) and `/` (tenant-scoped settings UI: login with token, see your keys/usage/config). `packages/server` already serves both surfaces today; the chassis formalizes it.
- Tenancy: `tenant_id = lookup(sha256(bearer))`; every read/write tenant-scoped; no client-supplied tenant args. Tokened URL `/mcp/<token>` (ZD-8) preserved.
- Self-host = same image, one tenant seeded from env token, UI included. No divergence, no separate codebase.
- Suites compose via machine tenants: buying Herald provisions a tenant in each composed unit; Herald's own UI holds those agent→unit tokens (Law 6 plane c) and configures units through their APIs. Units stay suite-agnostic. One Zenod container ever.
- Control plane (`zenod-ai/cloud`) shrinks to checkout + Stripe webhook → `POST /api/tenants` per purchased unit.
- DevOps: ~6 Dokploy applications total (proxy, zenod, callisthenes, ring+phylax, epaminon-api, db). One hostname per unit. Watchdog = 5 static `/healthz` checks.
- Isolation exceptions: Epaminon per-job sandboxes (ephemeral), Phylax per phone number.

Child spine map:

| Child | Scope | Depends on |
|---|---|---|
| 3.1 `EPIC-3.1-MCP-CHASSIS.md` | Extract chassis package + settings-UI shell + tenants/provisioning | — |
| 3.2 `EPIC-3.2-ZENOD-MULTITENANT.md` | Zenod on chassis, tenant-prefixed storage | 3.1 |
| 3.3 `EPIC-3.3-CALLISTHENES-MULTITENANT.md` | Python conformance by contract | 3.1 (contract only) |
| 3.4 `EPIC-3.4-RING-MULTITENANT.md` | Ring on chassis when real agent lands | 3.1 |
| 3.5 `EPIC-3.5-EPAMINON-MULTITENANT.md` | Multi-tenant API + per-job sandboxes | 3.1 |
| 3.6 `EPIC-3.6-PHYLAX-MULTITENANT.md` | De-per-user Phylax; whitelist as config | 3.1 (light) |

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | D1: Option B — one multi-tenant container per unit on the VPS. | Container-per-user capped at ~100 users, M-redeploys, provisioner flakiness; multi-tenant is less machinery. | `docs/mcp-hosting-options-deck.html` |
| 2026-07-10 | D2: Unit container serves its own settings UI alongside `/mcp`. | Self-host keeps full product; kills the cloud-repo settings split; matches existing `packages/server` shape. | `packages/server/src/app.ts` |
| 2026-07-10 | D3: Suites compose as machine tenants with agent→unit tokens; units stay suite-agnostic. | Preserves modularity; Law 6 plane c already models it; one container per unit ever. | `docs/MCP-CHASSIS-SPEC.md` |
| 2026-07-10 | D4 (pending Jordi): chassis storage seam abstracts DB; start `node:sqlite` on `/data`, evaluate PGlite/Postgres behind the same seam. | Zero new infra now; row-level security later if wanted. Jordi floated PG — confirm target. | `docs/MCP-CHASSIS-SPEC.md` open question 1 |
| 2026-07-10 | D5: Callisthenes conforms by SEAM-SPEC contract in Python; no rewrite. | It wraps upstream xmcp; its bearer-is-tenant design is the suite-wide pattern. | Epic 2.4, `units/callisthenes/` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Planner | Epic 3.0 planner | Confirm D4 (DB) | draft | - | - | `f1edc8c` | Decisions recorded here; children unblocked. | Numbering resolved (Herald→Epic 4) 2026-07-10. | 2026-07-10 00:19 CEST | Jordi decides D4. |
| draft | Epic worker | unassigned | Deliver Epic 3.1 chassis | draft | D4 | - | `f1edc8c` | 3.1 Definition of Done met. | - | 2026-07-10 00:19 CEST | Dispatch after D4. |
| draft | Planner | Epic 3.0 planner | Record cross-spine amendments in 2.3/2.4/2.5/2.9 | draft | D1–D3 accepted | - | `f1edc8c` | Proposed updates adopted or rejected by target stewards. | Proposals listed below. | 2026-07-10 00:19 CEST | Route via Epic 0. |

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
| Architecture acceptance | Jordi | D1–D5 adoption; Law 7 amendment | Approve decisions and numbering | Spine drafting, chassis design notes |
| Production cutover | Jordi | Replacing live per-tenant containers with multi-tenant units | Approve migration window and rollback plan | Hosted-test-env validation |
| Data migration | Jordi | Moving existing tenant `/data` volumes into tenant-prefixed layout | Approve per-tenant migration script run | Dry-run on copies |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Get Jordi's call on D4 (SQLite now vs PGlite/Postgres now). Numbering resolved: Herald → Epic 4 (`EPIC-4-HERALD.md`); this family owns Epic 3.
- Create GitHub issues for the draft ledger rows.
- Sequence: 3.1 → 3.3 (first proof, easiest) → 3.2 → 3.5 → 3.6 → 3.4.

## Worker Queue

- None until 3.1 dispatch.

## Tester Queue

- Define the two-tenant smoke test reused by every child epic (two tokens, cross-tenant read attempt must fail, per-tenant ledger counts).

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Replatform spine family created

Context: Jordi chose Option B and asked for standardized scaffolding ("write once, use multiply") plus a landed answer on UI placement, self-hosting, and suite composition. Code survey showed 4 of 5 units already share one Node image selected by `AGENT` env; chassis is an extraction, not a greenfield build.
Next: Jordi confirms D4 and numbering; dispatch 3.1.
Risks: numbering collision with Epic 3 Herald; live-tenant data migration; Callisthenes upstream pin may drift during conformance work.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`
- `docs/mcp-hosting-options-deck.html`

## Open Questions

- D4 database target: `node:sqlite` now vs PGlite vs Postgres? Owner: Jordi. Needed by: 3.1 dispatch.
- Existing paying tenants on per-user containers: migrate scripted or by hand? Owner: Jordi. Needed by: 3.2 cutover.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Amend Law 7: one container per unit, multi-tenant within; exceptions Epaminon job sandboxes and Phylax per phone number. Unit anatomy includes its own settings UI. | This spine, D1–D3 | Epic 2.5 steward | proposed |
| 2026-07-10 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Retire Z-1 per-tenant Dokploy provisioning, ZD-6 ceiling, ZD-10 watchdog registration; keep ZD-8 tokened URL. | `docs/MCP-CHASSIS-SPEC.md` | Epic 2.3 steward | proposed |
| 2026-07-10 | `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` | Add SEAM-SPEC vNext conformance scope (→ Epic 3.3). | `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | Epic 2.4 steward | proposed |
| 2026-07-10 | `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Split into multi-tenant API + per-job sandboxes (→ Epic 3.5); drop `ZENOD_AWAIT_PROVISION`. | `docs/EPIC-3.5-EPAMINON-MULTITENANT.md` | Epic 2.9 steward | proposed |
| 2026-07-10 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Register 3.0–3.6 in the child-spine map; record Option-B decision. | This spine | Epic 0 steward | proposed |

## Appendix

- Survey of unit codebases (2026-07-10 session): Zenod/Epaminon/Phylax/Ring = one Node 22 image (`packages/server`, MCP SDK 1.29 + Hono, port 8080, `AGENT` env selects persona); Callisthenes = Python 3.12 FastMCP wrapping upstream `xmcp` (port 8000). `units/*/Dockerfile` for Node units are `FROM scratch` placeholders; real build is the repo-root Dockerfile.
