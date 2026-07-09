# EPIC 3.3 · Callisthenes Multi-Tenant — conformance by contract, first proof

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md`
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
| Planner | Epic 3.0 planner | Callisthenes conformance scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | unassigned | This spine | Delivery lead: make Callisthenes SEAM-SPEC vNext conformant. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md`
Active steward: unassigned (Epic 3.0 planner until epic worker bound)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.1-MCP-CHASSIS.md` — SEAM-SPEC vNext source.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — prior product spine.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Callisthenes conformance intent, acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Make Callisthenes the first multi-tenant unit and the proof of the pattern — in Python, by contract, no rewrite. It already derives tenant identity from the request bearer; add the tenants table, `/api/tenants` provisioning, tenant-keyed throttle/draft-guard/ledger, and a tenant-scoped connect UI, so one container holds every user's outbound keys and pacing. Stateless key-custody makes it the easiest conversion; landing it first de-risks 3.2 and 3.5.

## Definition Of Done

- [ ] Tenants table in `auth/token_store.py`: `tenant_id = sha256(bearer)` lookup; unknown bearer 401; no caller-asserted tenant anywhere (the #645 rule).
- [ ] `POST /api/tenants` + rotate/suspend, guarded by `CONTROL_PLANE_TOKEN`; Stripe webhook path verified end to end on `cloud-test`.
- [ ] Throttle (per-hour send cap), draft guard, and usage ledger keyed by tenant; one tenant's cap never starves another.
- [ ] X OAuth2 PKCE credentials stored per tenant; `/connect` flow binds keys to the requesting tenant only.
- [ ] Two-tenant smoke test: two tokens, two X accounts, cross-tenant send/read provably fails, per-tenant permalink receipts.
- [ ] Self-host parity: same image, env-seeded single tenant, connect UI included.
- [ ] `calli.zenod.dev` (single hostname) serves all tenants; per-tenant instances retired.

## Non-Goals

- Rewriting to Node/chassis code; conformance is by SEAM-SPEC vNext contract.
- New channels (Reddit/email expansion stays in Epic 2.4 scope).
- Changing the upstream `xmcp` pin beyond what conformance patches require.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: SEAM-SPEC vNext draft (3.1 C-8) reviewed; then dispatch CA-MT-1. May start before full chassis lands — only the contract is needed.
Blockers: SEAM-SPEC vNext not yet written.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed, sequenced backlog. | Dispatched or named blocker. |
| Epic worker | Conformant Callisthenes per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove tenant isolation of keys, throttle, ledger. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-3.1-MCP-CHASSIS.md` (C-8 SEAM-SPEC vNext) | The contract to satisfy. | Always |
| 2 | `units/callisthenes/callisthenes_server.py` | Server bootstrap + middleware seam. | Worker |
| 3 | `units/callisthenes/auth/token_store.py`, `auth/oauth2_pkce.py` | Where tenants table and per-tenant keys land. | Worker |
| 4 | `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` | Product rules (drafts-never-send, throttle, receipts). | Always |

## Architecture And Context

Callisthenes: Python 3.12, FastMCP via upstream `xmcp` (pinned commit + 2 patches), Streamable HTTP `/mcp` port 8000, SQLite `callisthenes-auth.sqlite` on `/data`. It already reads the bearer from request headers as tenant identity — the suite-wide pattern originated here. Work is additive: tenants table + provisioning endpoints; key rows, throttle counters, draft store, and ledger gain a `tenant_id` column; connect UI reads the session's tenant. `/data` stays one volume (rows tenant-keyed rather than path-prefixed, since state is already SQLite).

Ticket sketch: CA-MT-1 tenants table + 401 hardening; CA-MT-2 provisioning API + env single-tenant boot; CA-MT-3 tenant-key throttle/draft-guard/ledger; CA-MT-4 per-tenant OAuth custody + connect UI scoping; CA-MT-5 two-tenant smoke + self-host parity; CA-MT-6 hostname cutover.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Callisthenes goes first among unit migrations. | Stateless key-custody = cleanest multi-tenant case; proves the pattern cheaply. | parent 3.0 sequencing |
| 2026-07-10 | Rows tenant-keyed, not path-prefixed. | State is already a single SQLite DB; a column beats a directory tree. | `auth/token_store.py` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | CA-MT-1 tenants table + bearer lookup | draft | SEAM-SPEC draft | - | `f1edc8c` | Two bearers → two tenants; unknown → 401. | - | 2026-07-10 00:19 CEST | Mint after C-8 draft. |
| draft | Ticket worker | unassigned | CA-MT-2 provisioning API + single-tenant boot | draft | CA-MT-1 | - | `f1edc8c` | Stripe-test webhook provisions a tenant end to end. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | CA-MT-3 tenant-keyed throttle/guard/ledger | draft | CA-MT-1 | - | `f1edc8c` | Caps and receipts isolate per tenant under load. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | CA-MT-4 per-tenant OAuth custody + connect UI | draft | CA-MT-1 | - | `f1edc8c` | PKCE keys bind to requesting tenant only. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Tester | unassigned | CA-MT-5 two-tenant smoke + self-host parity | draft | CA-MT-2..4 | - | `f1edc8c` | Cross-tenant send fails; self-host run passes. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | CA-MT-6 hostname cutover, retire instances | draft | CA-MT-5 | - | `f1edc8c` | One hostname, one watchdog check, old instances gone. | - | 2026-07-10 00:19 CEST | Mint issue. |

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
| Outbound-credential custody change | Jordi | CA-MT-4 alters where X keys live | Approve per-tenant custody scheme | Test-account implementation |
| Live cutover | Jordi | CA-MT-6 | Approve window + rollback | Test-env cutover rehearsal |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Review SEAM-SPEC vNext draft as soon as 3.1 C-8 exists; this epic can start on the contract alone.
- Mint CA-MT issues.

## Worker Queue

- None until dispatch.

## Tester Queue

- Prepare two X test accounts for CA-MT-5.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Child of Epic 3.0; first unit migration and pattern proof. Its bearer-is-tenant auth design is adopted suite-wide.
Next: SEAM-SPEC draft review, then CA-MT-1.
Risks: upstream `xmcp` pin drift; throttle fairness under multi-tenant load.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`

## Open Questions

- Does `services/x-mcp/` (older non-unit copy) get deleted in this epic? Owner: Jordi. Needed by: CA-MT-6.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` | Record conformance scope delegated to this epic; deployment model superseded on CA-MT-6. | this spine | Epic 2.4 steward | proposed |

## Appendix

- Upstream pin: `xdevplatform/xmcp` @ `63d3436`, patches `headless-oauth1.patch`, `relax-response-required.patch`.
