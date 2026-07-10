# EPIC 3.1 · MCP Chassis — extract the write-once scaffold

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.1-MCP-CHASSIS.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Steward since: 2026-07-10 01:32 CEST
Last reconciled commit: `151ec44b750f06c04bc12d36229afa392f28ebd7`
Planner: Epic 3.0 planner
Worker: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Chassis scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | Codex task `019f4932-d428-7021-806a-0003ca946fc6` | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.1-MCP-CHASSIS.md`
Active steward: Codex task `019f4932-d428-7021-806a-0003ca946fc6`

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
- [ ] A demo unit (`units/demo` or test harness) runs on the chassis with the three-tenant smoke test passing: cross-tenant access fails, per-tenant ledgers isolate.
- [ ] SEAM-SPEC vNext written (`docs/SEAM-SPEC-VNEXT.md`) covering transport, auth, tenancy, provisioning, storage, health, env, container, DNS, deploy rows.
- [ ] Chassis README documents `createUnit` and the migration recipe for an existing agent.
- [ ] OAuth kit (D9): OAuth server for MCP-client sign-in (lifted oauthStore/`.well-known`/consent, tenant-mapped) AND a generic OAuth client framework — a unit declares `providers: [githubApp, googleDrive, xPkce, …]` and gets start/callback routes with per-tenant state binding and vault custody; no unit writes an OAuth dance again.
- [ ] Billing module (D10): Stripe webhook receiver (`/api/billing/webhook`, signature-verified) that inserts/suspends tenant rows + checkout success/cancel pages; enabled by env; provable with Stripe CLI test events end to end.
- [ ] Conduct kit (parent D12): receipt discipline as middleware — mutating tools must return `evidence[]` handles or structured errors (never silent acks); long tools return `ticket_id` + completion events + poll tool; reply-gate and `toolKinds` read/mutate classification lifted from `packages/core`; `origin_ticket_id` + `depth ≤ 1` propagation implemented (closing the SEAM items 10–11 gap flagged in `units/council/SEAM-SURFACE.md`).
- [ ] Standing directives as data (parent D12e): a seam tool to install/update per-unit operating directives (council- or user-authored); the unit re-reads them each turn (turn-preamble) and the UI renders the active set.
- [ ] Rules UI components (parent D12f): "Operating Rules" panel (SEAM conformance status + active directives + conduct receipts), MCP config settings component, skill settings component — shipped in the chassis shell for every unit.
- [ ] Three-tenant browser E2E (Autonomous Validation Protocol below) passes on the demo unit, executed by the worker via browser automation with screenshots in evidence — no human in the loop.

## Non-Goals

- Migrating any real unit (that is 3.2–3.6).
- Physical repo split; chassis is a workspace package.
- Suite/combined dashboard; only the machine-tenant seam (`/api/tenants` + agent tokens) is provided.

## Current State

Phase: execution
Last verified: 2026-07-10 02:46 CEST
Integration target: main
Fresh base commit: `151ec44b750f06c04bc12d36229afa392f28ebd7`
Next action: integrate fresh-main C-6/C-9/C-10 branches, resume C-12 in `/Users/jordi/Documents/GitHub/wt-727`, then dispatch C-7 browser E2E from a new main worktree.
Blockers: none.

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
| 1 | `docs/final-container-map-deck.html` | CANONICAL target picture (D11): containers, OAuth, billing. | Always |
| 2 | `packages/server/src/app.ts` | Transport + `/mcp` handler to extract. | Worker |
| 3 | `packages/server/src/auth.ts` | `requireMcpAuth` to upgrade with tenant lookup. | Worker |
| 4 | `packages/server/src/agent.ts`, `runtime.ts` | `AGENTS` map and storage construction to generalize. | Worker |
| 5 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Parent decisions D1–D5. | Always |

## Architecture And Context

Pilot rule (parent D6): the chassis is proven against ONE real character — Zenod (Epic 3.2) — before other units consume it. The C-7 demo unit exists for fast iteration, but "stable and proven" means the Zenod pilot's three-tenant browser E2E passes; only then is the chassis API frozen and Phase 2 (3.3/3.5/3.6) unleashed. Expect 3.1 and 3.2 to co-develop, with pilot feedback shaping the freeze.

3.1/3.2 co-development rule: Epic 3.1 owns `packages/mcp-chassis` and SEAM-SPEC vNext. Epic 3.2 may prove the chassis with Zenod and report friction through its own Proposed Cross-Spine Updates or GitHub issues, but it must not patch `packages/mcp-chassis` directly unless stewardship is explicitly transferred here. Joint proof is 3.1 demo E2E plus 3.2 Zenod pilot E2E against the same chassis API.

Conduct kit sources (parent D12) — extract, don't rewrite: `docs/SEAM-SPEC.md` v1 is the binding wire/receipt contract (SEAM-SPEC vNext in C-8 EXTENDS it with tenancy/billing/OAuth rows; it never weakens the receipt laws). The receipt engine exists: `packages/server/src/outboundReceipt.ts` (verified-or-failed shapes, receipt strings never composed freehand), `filingReceipt.ts`, `storageReceipt.ts`, `packages/core/src/taskingPolicy.ts` (deterministic receipts + correction banners), `replyGate.ts` (action turns deliver only tool receipts), `toolKinds.ts` (read/mutate registry, unknown fails safe to mutate). Persona/operating rules per agent live in `packages/server/src/agent.ts` (`AgentDefinition`); the chassis lifts the rules that repeat across every persona into middleware and keeps personas for what is genuinely unit-specific. Known gap to close in C-11: `origin_ticket_id`/`depth` (SEAM items 10–11) are documented in `units/council/SEAM-SURFACE.md` but absent from code. The Epaminon↔Archus etiquette (`docs/EPAMINON-ARCHUS-PROTOCOL.md`: transitions-only, structured-not-conversational, idempotent id-keyed, one-blocker-one-ask) becomes the chassis's inter-unit dispatch conventions.

Extraction, not invention. `packages/server` already provides stateless `StreamableHTTPServerTransport` per request, `requireMcpAuth` (static bearer, OAuth, session cookie), settings with token minting (`zenod_<48hex>`), SQLite-on-`/data` construction in `runtime.ts`, and an admin web UI on the same Hono app. The chassis lifts these behind a stable API and adds: tenants table, tenant resolution in auth, tenant-prefixed storage handles (`/data/<tenant>/…`), provisioning endpoints, and tenant-scoped UI shell. `resolveAgent`/`AGENTS` becomes `createUnit`. Storage behind a seam so D4 (SQLite → PGlite/Postgres) is swappable without touching units.

Ticket sketch: C-1 package scaffold + transport lift; C-2 tenants table + auth tenant resolution; C-3 provisioning API + single-tenant boot; C-4 storage/vault handles; C-5 metering + quota; C-6 UI shell; C-7 demo unit + three-tenant browser E2E; C-8 SEAM-SPEC vNext doc.

### UI Surface (PORT the existing console — D7; do not design a new shell)

The chassis UI shell IS the existing `apps/web` React console + the Hono serving/session code in `packages/server`, re-homed into the chassis with tenant-scoping added. The console, its SetupWizard, Login, Settings tabs, and the `/api/*` contract already exist and work — the chassis work is:

- Lift SPA hosting (`ZENOD_WEB_DIST` static serving + SPA fallback) and session auth (login, `zenod_session` cookie, `/api/auth/status` with `needsSetup`) into the chassis.
- Make the session TENANT-scoped: login binds the session to one tenant (token login for hosted; existing password login maps to the single tenant in self-host); every `/api/*` handler receives tenant context; tenant A's session can never render tenant B data.
- Keep the existing `/api/auth/hosted-entry` signed-ticket bridge (control plane → tenant-scoped session → SPA).
- Add the only genuinely new pieces: `/api/tenants` admin endpoints (control-plane token) and a token view/rotate surface (extend the existing `/api/token`, `/api/token/regenerate`).
- Provide `createUnit({ ui })` as: which existing tabs/panels of `apps/web` this unit shows (the conditional-tab mechanism already exists — formalize it), plus the unit's `/api/*` route subset.

Explicitly NOT in scope: redesigning pages, new component library, server-rendered rewrite. The earlier open question (React vs server-rendered) is answered by D7: keep `apps/web` React.

### Container And Deploy

- One image (`zenod-ai/mcp-chassis-demo` for C-7), port 8080, `VOLUME /data`, `restart: unless-stopped`, `/healthz`.
- Env contract: `PORT`, `DATA_DIR=/data`, `CONTROL_PLANE_TOKEN`, `<UNIT>_API_TOKEN` (single-tenant seed), DB target per D4.
- One Dokploy application; deploy = rebuild that app. No per-tenant anything in the deploy layer.

### Autonomous Validation Protocol (three-tenant browser E2E — the definition of "done, tested by me")

The epic worker validates WITHOUT human help, using browser automation (Playwright or equivalent) against a locally running container:

1. Boot the demo unit container fresh (empty `/data`).
2. Provision tenants T1, T2, T3 via `POST /api/tenants` with `CONTROL_PLANE_TOKEN` (record the three raw tokens).
3. For each tenant: MCP `initialize` + one tool call over `/mcp/<token>`; assert per-tenant result.
4. For each tenant: browser-login to the UI with its token; assert Overview shows THAT tenant's name/usage only; assert `/keys` and `/settings` are empty of other tenants' data.
5. Negative: T1's token must 401 on nothing, but a mutated/unknown token must 401; T1's session must never render T2 data (attempt direct URL access); MCP call with T1 token must not read T2 rows (verified via ledger counts).
6. Rotate T2's token via UI; old token must die, new must work.
7. Single-tenant mode: boot with env seed token only; same UI works with one implicit tenant.
8. Record commands, screenshots, and results in Validation Evidence with the exact commit.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Extract from `packages/server` rather than greenfield. | The transport/auth/storage code is proven in production. | Code survey in parent appendix |
| 2026-07-10 | Tokens stored as hashes only; raw token shown once at mint. | Standard credential hygiene; matches #645 tenant-from-bearer rule. | `docs/MCP-CHASSIS-SPEC.md` |
| 2026-07-10 | Branch isolation law: every ticket's first Git action is `git worktree add ../wt-<issue> -b <branch> main`; work stays there. The shared clone remains pinned to `main`, receives fast-forward pulls only, and is never switched. | Parallel workers previously shared long-lived stacked worktrees; fresh-main isolation makes integration state observable and prevents one worker from hijacking another's checkout. | Jordi priority shift; issues #715-#727 worktree records |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#715](https://github.com/zenod-ai/zenod/issues/715) | Ticket worker | Steward takeover | C-1 scaffold `packages/mcp-chassis`, lift transport | done | D4 resolved | PR [#740](https://github.com/zenod-ai/zenod/pull/740) | `de1effe` | Demo boots, `/mcp` answers initialize. | Merged `4fb93c9`; CI passed. | 2026-07-10 02:25 CEST | None. |
| [#716](https://github.com/zenod-ai/zenod/issues/716) | Ticket worker | Steward fresh-main replay | C-2 tenants table + bearer→tenant auth | done | C-1 | PR [#743](https://github.com/zenod-ai/zenod/pull/743) / `/Users/jordi/Documents/GitHub/wt-716` | `e80596a` | Two tokens resolve to two tenants; unknown token 401. | Merged `d1f566a`; 16 tests; both CI checks passed. | 2026-07-10 02:33 CEST | None. |
| [#717](https://github.com/zenod-ai/zenod/issues/717) | Ticket worker | Steward fresh-main replay | C-3 provisioning API + single-tenant env boot | done | C-2 | PR [#750](https://github.com/zenod-ai/zenod/pull/750) / `/Users/jordi/Documents/GitHub/wt-717` | `d1f566a` | `POST /api/tenants` mints; env token seeds tenant 1. | Merged `6025f47`; 20 tests; both CI checks passed. | 2026-07-10 02:37 CEST | None. |
| [#718](https://github.com/zenod-ai/zenod/issues/718) | Ticket worker | Steward fresh-main replay | C-4 tenant-scoped storage + vault handles | done | C-3 | PR [#744](https://github.com/zenod-ai/zenod/pull/744) / `/Users/jordi/Documents/GitHub/wt-718` | `6025f47` | `/data/<tenant>/` layout; vault rows tenant-keyed. | Merged `7e93740`; 24 tests; both CI checks passed. | 2026-07-10 02:41 CEST | None. |
| [#719](https://github.com/zenod-ai/zenod/issues/719) | Ticket worker | Steward fresh-main replay | C-5 metering + quota middleware | done | C-4 | PR [#751](https://github.com/zenod-ai/zenod/pull/751) / `/Users/jordi/Documents/GitHub/wt-719` | `7e93740` | Per-tenant usage rows; block-at-zero works. | Merged `151ec44`; 29 tests; both CI checks passed. | 2026-07-10 02:44 CEST | None. |
| [#720](https://github.com/zenod-ai/zenod/issues/720) | Ticket worker | Pascal `019f497d-0610-7061-abc0-23e7104c5b8c` | C-6 tenant-scoped settings-UI shell | running | C-5 | PR [#752](https://github.com/zenod-ai/zenod/pull/752) / `/Users/jordi/Documents/GitHub/wt-720` | `151ec44` | Login with token shows only that tenant's pages. | Fresh-main replay dispatched. | 2026-07-10 02:45 CEST | Validate and hand off PR; steward integrates first. |
| [#721](https://github.com/zenod-ai/zenod/issues/721) | Tester | unassigned | C-7 demo unit + three-tenant browser E2E | queued | C-1..C-6 | planned `/Users/jordi/Documents/GitHub/wt-721` | `151ec44` | Cross-tenant access provably fails; self-host parity run. | Awaiting integrated C-6/C-9/C-10/C-12 surface. | 2026-07-10 02:46 CEST | Dispatch browser tester from fresh main after C-12. |
| [#723](https://github.com/zenod-ai/zenod/issues/723) | Ticket worker | Schrodinger / steward | C-8 SEAM-SPEC vNext document | done | C-2 final auth review | PR [#739](https://github.com/zenod-ai/zenod/pull/739) | `de1effe` | Contract table complete; Callisthenes gap list included. | Merged `df0ae3b`; CI passed. | 2026-07-10 02:26 CEST | Reconcile D16/D18 additions before API freeze. |
| [#724](https://github.com/zenod-ai/zenod/issues/724) | Ticket worker | Kuhn `019f497d-06a3-73f2-b3bb-e5268d4df761` | C-9 OAuth kit | running | C-2 | PR [#754](https://github.com/zenod-ai/zenod/pull/754) / `/Users/jordi/Documents/GitHub/wt-724` | `151ec44` | Per-tenant OAuth round-trip; MCP-client sign-in maps to tenant. | Fresh-main replay dispatched. | 2026-07-10 02:45 CEST | Validate and hand off; integrate after C-6. |
| [#725](https://github.com/zenod-ai/zenod/issues/725) | Ticket worker | Dalton `019f497d-074a-7401-aa54-35f60459d642` | C-10 billing module | running | C-3 | PR [#753](https://github.com/zenod-ai/zenod/pull/753) / `/Users/jordi/Documents/GitHub/wt-725` | `151ec44` | Signed webhook provisions/suspends tenant; bad signature rejected. | Fresh-main replay dispatched. | 2026-07-10 02:45 CEST | Validate and hand off; integrate after C-9. |
| [#726](https://github.com/zenod-ai/zenod/issues/726) | Ticket worker | Steward fresh-main replay | C-11 conduct kit | done | C-1 | PR [#742](https://github.com/zenod-ai/zenod/pull/742) / `/Users/jordi/Documents/GitHub/wt-726` | `df0ae3b` | Silent-ack mutation rejected; ticket origin/depth enforced. | Merged `e80596a`; 13 tests; both CI checks passed. | 2026-07-10 02:29 CEST | None. |
| [#727](https://github.com/zenod-ai/zenod/issues/727) | Ticket worker | Rawls `019f4960-9b88-7cd3-b7b0-388a4cab5a09` | C-12 directives + rules UI | queued | C-6, C-11, C-9 | planned `/Users/jordi/Documents/GitHub/wt-727` | next integrated main | Directive appears in turn preamble and per-tenant Operating Rules UI. | Old-worktree patch inventoried; worker paused under isolation law. | 2026-07-10 02:24 CEST | Resume after C-6/C-9/C-10; first action creates fresh worktree. |

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
| D4 database choice | Jordi | Before C-1 | Resolved 2026-07-10: SQLite/WAL per unit behind storage seam | None; implementation may continue |
| Chassis API freeze | Jordi | Before 3.2/3.3 consume it | Approve `createUnit` + SEAM-SPEC vNext surface | Internal refactors |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Keep dependency order tight: C-1 → C-2 → C-3/C-4 → C-5/C-6/C-9/C-10 → C-7/C-12.
- Reconcile C-8 SEAM-SPEC vNext after C-2 proves the exact tenant-auth surface.

## Worker Queue

- Running in fresh worktrees from `151ec44`: #720 C-6 (Pascal), #724 C-9 (Kuhn), #725 C-10 (Dalton).
- Queued: #727 C-12 (Rawls), after C-6/C-9/C-10 integrate.
- Complete on `main`: #715, #716, #717, #718, #719, #723, #726.

## Tester Queue

- Queued: #721 three-tenant browser E2E + single-tenant parity, dispatch from fresh `main` after C-12 so the final surface is tested.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `8e12eba` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.1-MCP-CHASSIS.md` | pass | local |
| 2026-07-10 | C-1 transport scaffold | `2d22583` | `/Users/jordi/Documents/GitHub/zenod-epic31-c1-chassis-transport` | `npm run build -w @zenod/mcp-chassis`; `npm run test -w @zenod/mcp-chassis`; `git diff --check` | pass | #715 |
| 2026-07-10 | C-8 SEAM-SPEC vNext | `97992d6` | `/Users/jordi/Documents/GitHub/zenod-epic31-c8-seam-spec-vnext` | required-term scan; `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.1-MCP-CHASSIS.md`; `git diff --check` | pass | #723 |
| 2026-07-10 | C-11 conduct kit | `f7f48cc` | `/Users/jordi/Documents/GitHub/zenod-epic31-c11-conduct-kit` | `npm run test -w @zenod/mcp-chassis`; `npm run typecheck -w @zenod/mcp-chassis`; `npm run build -w @zenod/mcp-chassis` | pass after rebase onto #715, 13 tests | #726 / PR #742 |
| 2026-07-10 | C-2 tenant auth | `6c4829b` | `/Users/jordi/Documents/GitHub/zenod-epic31-c2-tenant-auth` | `npm run typecheck -w @zenod/mcp-chassis`; `npm run test -w @zenod/mcp-chassis`; `npm run build -w @zenod/mcp-chassis`; `git diff --check -- packages/mcp-chassis` | pass, 5 tests | #716 / PR #743 |
| 2026-07-10 | C-3 provisioning/single-tenant boot | `e6cab43` | `/Users/jordi/Documents/GitHub/zenod-epic31-c3-provisioning` | `npm run test -w @zenod/mcp-chassis`; `npm run typecheck -w @zenod/mcp-chassis`; `npm run build -w @zenod/mcp-chassis`; GitHub Actions CI | pass, 9 tests; GitHub CI passed | #717 / PR #750 |
| 2026-07-10 | C-4 storage/vault | `9e4c34a` | `/Users/jordi/Documents/GitHub/zenod-epic31-c4-storage-vault` | `npm run test -w @zenod/mcp-chassis`; `npm run typecheck -w @zenod/mcp-chassis`; `npm run build -w @zenod/mcp-chassis`; `git diff --check` | pass after rebase onto #717, 13 tests; GitHub CI in progress | #718 / PR #744 |
| 2026-07-10 | Integrated C-1/C-8/C-11/C-2/C-3/C-4/C-5 merge train | `151ec44b750f06c04bc12d36229afa392f28ebd7` | `/Users/jordi/Documents/GitHub/wt-epic31-merge-train` | `npm run test -w @zenod/mcp-chassis`; `npm run typecheck -w @zenod/mcp-chassis`; `npm run build -w @zenod/mcp-chassis` | pass, 29 tests; every replayed PR had two successful CI checks | PRs #740, #739, #742, #743, #750, #744, #751 |

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

### 2026-07-10 - Epic worker - Delivery management started

Context: Jordi bound Codex task `019f4932-d428-7021-806a-0003ca946fc6` as active 3.1 delivery manager and asked for GitHub issues plus parallel agents to drain the epic.
Next: integrate first batch outputs (#715, #723, #726), then dispatch C-2/C-3/C-4 as soon as the chassis scaffold can carry tenant/auth/storage work.
Risks: this repo already has pre-existing Epic 3.x spine edits on branch `codex/epic-3.2-zenod-multitenant`; keep 3.1 steward edits narrow and do not revert sibling changes.
Assignment identity: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Branch / latest commit: `codex/epic-3.2-zenod-multitenant` / `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Last verified: 2026-07-10 01:32 CEST
Links:

- #715 C-1 transport scaffold
- #723 C-8 SEAM-SPEC vNext
- #726 C-11 conduct kit

### 2026-07-10 - Epic worker - Fresh-main merge train landed

Context: Priority shifted to integration. PRs #740, #739, #742, #743, #750, #744, and #751 were replayed as needed onto successive fresh `main` commits and merged in the requested dependency order. The shared clone stayed on `main`; issue work happened in `/Users/jordi/Documents/GitHub/wt-<issue>` worktrees.
Next: integrate C-6/C-9/C-10 from fresh-main worker handoffs, resume C-12 in `wt-727`, then dispatch C-7 browser E2E from fresh `main` and pair its proof with the 3.2 Zenod pilot evidence.
Risks: C-6/C-9/C-10 share chassis export/config surfaces and must be integrated serially even though their replay work runs in parallel. Epic 3.2 must report chassis friction rather than edit `packages/mcp-chassis`.
Assignment identity: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Branch / latest commit: `main` / `151ec44b750f06c04bc12d36229afa392f28ebd7`
Last verified: 2026-07-10 02:46 CEST
Links:

- PRs #740, #739, #742, #743, #750, #744, #751
- Issues #720, #724, #725 dispatched from `151ec44`

## Open Questions

- Does the OAuth flow (Claude.ai sign-in) map to tenants 1:1 or can one OAuth user hold several tenants? Owner: Epic worker. Needed by: C-2.
- ~~UI shell stack: reuse `apps/web` (React) or server-rendered Hono pages?~~ Resolved by D7 (2026-07-10): reuse `apps/web`.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Record chassis API freeze date once C-1..C-8 land. | this spine | Epic 3.0 planner | proposed |
| 2026-07-10 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Update stale Z-MT-5 / tester-queue wording from two-tenant smoke to three-tenant browser E2E, and record that 3.2 reports chassis friction to 3.1 instead of editing `packages/mcp-chassis` directly. | 3.0 D6/D8, this spine co-development rule, 3.2 Definition of Done already says three tenants | Epic 3.2 steward | proposed |

## Appendix

- Existing token format `zenod_<48hex>` (`packages/server/src/settings.ts`); keep for continuity.
- `node:sqlite` `DatabaseSync` wrapper: `packages/core/src/state/sqlite.ts`.
