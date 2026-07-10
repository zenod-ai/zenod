# EPIC 3.1 · MCP Chassis — extract the write-once scaffold

Status: release-candidate; joint pilot proof and human gates pending
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.1-MCP-CHASSIS.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Steward since: 2026-07-10 01:32 CEST
Last reconciled commit: `3062022938bb3dd26427fd820d174f29022fd7d1`
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

- [x] `packages/mcp-chassis` exists with: stateless Streamable HTTP `/mcp`, bearer→tenant resolution (`sha256(bearer)` lookup + tokened-URL form + OAuth mapping), durable tenants table, `POST/DELETE /api/tenants` + token rotation guarded by `CONTROL_PLANE_TOKEN`, `storage.db(tenant)`/`storage.dir(tenant)` handles, encrypted per-tenant vault custody, per-tenant usage metering + quota middleware, `/healthz`, and credential-safe pino logs carrying `tenant_id` + `request_id`.
- [x] Settings-UI shell: token/session login, durable per-tenant settings/key metadata/usage pages, unit-defined authenticated product routes, and unit panel selection. Unit routes take precedence over placeholders while anonymous SPA root/assets remain public.
- [x] Single-tenant mode: env-seeded token auto-creates one tenant at boot; identical image and UI (self-host contract).
- [x] A demo unit (`units/demo` or test harness) runs on the chassis with the three-tenant smoke test passing: cross-tenant access fails, per-tenant ledgers isolate.
- [x] SEAM-SPEC vNext written (`docs/SEAM-SPEC-VNEXT.md`) covering transport, auth, tenancy, provisioning, storage, health, env, container, DNS, deploy, D16 skill-manifest, and D18 transcription rows.
- [x] Chassis README documents `createUnit` and the migration recipe for an existing agent.
- [x] OAuth kit (D9): OAuth server for MCP-client sign-in (lifted oauthStore/`.well-known`/consent, tenant-mapped) AND a generic OAuth client framework — a unit declares `providers: [githubApp, googleDrive, xPkce, …]` and gets start/callback routes with per-tenant state binding and vault custody; no unit writes an OAuth dance again.
- [ ] Billing module (D10): Stripe webhook receiver (`/api/billing/webhook`, signature-verified) that inserts/suspends tenant rows + checkout success/cancel pages; enabled by env; provable with Stripe CLI test events end to end. Deterministic implementation passes; live Stripe CLI evidence remains #764.
- [x] Conduct kit (parent D12): `createUnit` structurally enforces evidence or loud structured errors for mutations, declared ticket/poll semantics for long tools, safe-to-mutate unknown classification, `origin_ticket_id` propagation, and `depth <= 1` across modern, legacy, and updated MCP registrations. Unexpected handler errors are redacted.
- [x] D16 unit skill manifest: `createUnit({ skill })` publishes the tenant-neutral versioned card at `/.well-known/atomic-unit-skill.json`; undeclared sensitive fields are stripped and unconfigured units return deterministic 404.
- [x] D18 shared transcription kit: canonical media/pre-transcribed schemas, authenticated provenance, one-provider-call maximum, explicit Ring usage attribution, per-tenant vault custody, graceful failure, and bounded inline media are exported by the chassis.
- [x] Standing directives as data (parent D12e): a seam tool to install/update per-unit operating directives (council- or user-authored); the unit re-reads them each turn (turn-preamble) and the UI renders the active set.
- [x] Rules UI components (parent D12f): "Operating Rules" panel (SEAM conformance status + active directives + conduct receipts), MCP config settings component, skill settings component — shipped in the chassis shell for every unit.
- [x] Three-tenant browser E2E (Autonomous Validation Protocol below) passes on the demo unit, executed by the worker via browser automation with screenshots in evidence — no human in the loop.

## Non-Goals

- Migrating any real unit (that is 3.2–3.6).
- Physical repo split; chassis is a workspace package.
- Suite/combined dashboard; only the machine-tenant seam (`/api/tenants` + agent tokens) is provided.

## Current State

Phase: final joint proof and release gating
Last verified: 2026-07-10 05:59 CEST
Integration target: main
Fresh chassis commit: `3062022938bb3dd26427fd820d174f29022fd7d1` (contained in current `main` `77d8e39143deb4234a6e87237251b9eeeac50b84`)
Next action: Epic 3.2 starts #792 from current `main`, supplies the stable chassis vault key, and reruns the definitive three-tenant browser/self-host/restart byte-scan proof against the chassis merged at `3062022`. The 3.1 steward then reconciles that evidence and requests Jordi's API-freeze decision. C-17 runs when Stripe TEST-account authentication is supplied.
Blockers: API freeze remains gated on the #792 joint 3.1 demo + 3.2 Zenod proof and Jordi's explicit approval. Definition-of-Done billing evidence is separately gated on Stripe TEST-account CLI authentication in #764.

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

3.1/3.2 co-development rule: Epic 3.1 owns `packages/mcp-chassis` and SEAM-SPEC vNext. Epic 3.2 consumes `main` containing chassis merge `3062022` and reports friction through its own Proposed Cross-Spine Updates or GitHub issues; it must not patch `packages/mcp-chassis` directly unless stewardship is explicitly transferred here. Joint proof is 3.1 demo E2E plus the #792 3.2 Zenod pilot E2E against this exact chassis API. Pilot authorization is not an API freeze: Jordi closes the freeze gate only after the joint evidence is reconciled.

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
- Env contract: `PORT`, `DATA_DIR=/data`, `CONTROL_PLANE_TOKEN`, `<UNIT>_API_TOKEN` (single-tenant seed), one stable unique-per-unit 32-byte `CHASSIS_VAULT_MASTER_KEY` outside `/data`, and DB target per D4.
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
| 2026-07-10 | Tenant vaults and chassis secret settings use authenticated encryption under a stable external per-unit master key; no key is generated or stored beside `/data`. Legacy plaintext migration is offline, recoverable, and fences old writers by replacing plaintext value columns. | The 3.2 pilot recovered a synthetic GitHub credential from `vault.sqlite-wal`; masking and path isolation were not encrypted custody. | #789 / PR #794 / merge `3062022` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#715](https://github.com/zenod-ai/zenod/issues/715) | Ticket worker | Steward takeover | C-1 scaffold `packages/mcp-chassis`, lift transport | done | D4 resolved | PR [#740](https://github.com/zenod-ai/zenod/pull/740) | `de1effe` | Demo boots, `/mcp` answers initialize. | Merged `4fb93c9`; CI passed. | 2026-07-10 02:25 CEST | None. |
| [#716](https://github.com/zenod-ai/zenod/issues/716) | Ticket worker | Steward fresh-main replay | C-2 tenants table + bearer→tenant auth | done | C-1 | PR [#743](https://github.com/zenod-ai/zenod/pull/743) / `/Users/jordi/Documents/GitHub/wt-716` | `e80596a` | Two tokens resolve to two tenants; unknown token 401. | Merged `d1f566a`; 16 tests; both CI checks passed. | 2026-07-10 02:33 CEST | None. |
| [#717](https://github.com/zenod-ai/zenod/issues/717) | Ticket worker | Steward fresh-main replay | C-3 provisioning API + single-tenant env boot | done | C-2 | PR [#750](https://github.com/zenod-ai/zenod/pull/750) / `/Users/jordi/Documents/GitHub/wt-717` | `d1f566a` | `POST /api/tenants` mints; env token seeds tenant 1. | Merged `6025f47`; 20 tests; both CI checks passed. | 2026-07-10 02:37 CEST | None. |
| [#718](https://github.com/zenod-ai/zenod/issues/718) | Ticket worker | Steward fresh-main replay | C-4 tenant-scoped storage + vault handles | done | C-3 | PR [#744](https://github.com/zenod-ai/zenod/pull/744) / `/Users/jordi/Documents/GitHub/wt-718` | `6025f47` | `/data/<tenant>/` layout; vault rows tenant-keyed. | Merged `7e93740`; 24 tests; both CI checks passed. | 2026-07-10 02:41 CEST | None. |
| [#719](https://github.com/zenod-ai/zenod/issues/719) | Ticket worker | Steward fresh-main replay | C-5 metering + quota middleware | done | C-4 | PR [#751](https://github.com/zenod-ai/zenod/pull/751) / `/Users/jordi/Documents/GitHub/wt-719` | `7e93740` | Per-tenant usage rows; block-at-zero works. | Merged `151ec44`; 29 tests; both CI checks passed. | 2026-07-10 02:44 CEST | None. |
| [#720](https://github.com/zenod-ai/zenod/issues/720) | Ticket worker | Pascal / steward integration | C-6 tenant-scoped settings-UI shell | done | C-5 | PR [#752](https://github.com/zenod-ai/zenod/pull/752) / `/Users/jordi/Documents/GitHub/wt-720` | `151ec44` | Login with token shows only that tenant's pages. | Merged `00672d3`; 33 chassis tests; web typecheck/build and CI passed. | 2026-07-10 04:00 CEST | None. |
| [#721](https://github.com/zenod-ai/zenod/issues/721) | Tester | Steward takeover | C-7 demo unit + three-tenant browser E2E | done | C-1..C-6 | PR [#760](https://github.com/zenod-ai/zenod/pull/760) / `/Users/jordi/Documents/GitHub/wt-721` | `c53ec32` | Cross-tenant access provably fails; self-host parity run. | Merged `bac2729`; 43 tests; hosted T1/T2/T3, rotation, session isolation, and self-host browser proof captured in `docs/evidence/epic-3.1-c7/`. | 2026-07-10 04:00 CEST | Pair with 3.2 Zenod pilot proof. |
| [#723](https://github.com/zenod-ai/zenod/issues/723) | Ticket worker | Schrodinger / steward | C-8 SEAM-SPEC vNext document | done | C-2 final auth review | PR [#739](https://github.com/zenod-ai/zenod/pull/739) | `de1effe` | Contract table complete; Callisthenes gap list included. | Merged `df0ae3b`; CI passed. | 2026-07-10 02:26 CEST | Reconcile D16/D18 additions before API freeze. |
| [#724](https://github.com/zenod-ai/zenod/issues/724) | Ticket worker | Kuhn / steward integration | C-9 OAuth kit | done | C-2 | PR [#754](https://github.com/zenod-ai/zenod/pull/754) / `/Users/jordi/Documents/GitHub/wt-724` | `00672d3` | Per-tenant OAuth round-trip; MCP-client sign-in maps to tenant. | Merged `54a8eac`; 35 chassis tests; web/chassis typecheck/build and CI passed. | 2026-07-10 04:00 CEST | None. |
| [#725](https://github.com/zenod-ai/zenod/issues/725) | Ticket worker | Dalton / steward integration | C-10 billing module | done | C-3 | PR [#753](https://github.com/zenod-ai/zenod/pull/753) / `/Users/jordi/Documents/GitHub/wt-725` | `54a8eac` | Signed webhook provisions/suspends tenant; bad signature rejected. | Merged `3615231`; deterministic webhook/signature tests and CI passed. External Stripe CLI proof remains #764. | 2026-07-10 04:00 CEST | None; live proof tracked separately. |
| [#726](https://github.com/zenod-ai/zenod/issues/726) | Ticket worker | Steward fresh-main replay | C-11 conduct kit primitives | done | C-1 | PR [#742](https://github.com/zenod-ai/zenod/pull/742) / `/Users/jordi/Documents/GitHub/wt-726` | `df0ae3b` | Conduct result validation and dispatch context primitives exist and are tested. | Merged `e80596a`; 13 tests; both CI checks passed. Structural registration enforcement remains #765. | 2026-07-10 04:00 CEST | None; enforcement tracked separately. |
| [#727](https://github.com/zenod-ai/zenod/issues/727) | Ticket worker | Rawls / steward takeover | C-12 directives + rules UI | done | C-6, C-11, C-9 | PR [#759](https://github.com/zenod-ai/zenod/pull/759) / `/Users/jordi/Documents/GitHub/wt-727` | `3615231` | Directive appears in turn preamble and per-tenant Operating Rules UI. | Merged `c53ec32`; 42 chassis tests; web/chassis typecheck/build and CI passed. | 2026-07-10 04:00 CEST | None. |
| [#761](https://github.com/zenod-ai/zenod/issues/761) | Ticket worker | superseded by #768 steward takeover | C-13 durable SQLite tenant store + restart persistence | done | C-3 | PRs [#769](https://github.com/zenod-ai/zenod/pull/769), [#771](https://github.com/zenod-ai/zenod/pull/771) / `/Users/jordi/Documents/GitHub/wt-768`, `/Users/jordi/Documents/GitHub/wt-768-fix` | `468095d` | Tenant lifecycle and token hashes survive restart; self-host env seed is idempotent. | Fulfilled by #768; merged through `145e6f3`; restart, migration continuity, rotation, and durable self-host seed tests pass. | 2026-07-10 04:13 CEST | None. |
| [#762](https://github.com/zenod-ai/zenod/issues/762) | Ticket worker | Cicero / steward integration | C-14 persist tenant settings + key metadata | done | C-13 | PR [#777](https://github.com/zenod-ai/zenod/pull/777) / `/Users/jordi/Documents/GitHub/wt-762` | `6a3fa5c` | Settings/keys persist and isolate across tenants/restarts. | Merged `90c21c0`; 49 chassis tests plus chassis/web typecheck/build and CI passed. | 2026-07-10 04:36 CEST | None. |
| [#766](https://github.com/zenod-ai/zenod/issues/766) | Ticket worker | Noether / steward integration | C-15 tenant-aware pino logging | done | C-1, #780 | PR [#779](https://github.com/zenod-ai/zenod/pull/779) / `/Users/jordi/Documents/GitHub/wt-766` | `98ce0ea` | Authenticated paths log `tenant_id` + request ID; credentials are redacted. | Merged `1d7f440`; steward repeated 55 tests plus chassis/web typecheck/build; CI passed. | 2026-07-10 04:49 CEST | None. |
| [#765](https://github.com/zenod-ai/zenod/issues/765) | Ticket worker | Mill / steward integration | C-16 structural conduct enforcement | done | C-11, C-20 | PR [#783](https://github.com/zenod-ai/zenod/pull/783) / `/Users/jordi/Documents/GitHub/wt-765` | `2e3ee33` | `createUnit` tool registration structurally enforces conduct laws. | Merged `ba533b3`; steward repeated 71 tests plus chassis/web typecheck/build; CI passed. | 2026-07-10 04:59 CEST | 3.2 declares its read-tool kinds and proves the joint flow. |
| [#764](https://github.com/zenod-ai/zenod/issues/764) | Tester | 3.1 steward; Jordi human gate | C-17 Stripe CLI live webhook proof | blocked | C-10 | worktree deferred until credential gate | `ba533b3` | Test-mode live event proves lifecycle and signature behavior. | Stripe CLI 1.43.7 installed; deterministic signature/lifecycle tests pass; no authenticated TEST account or scoped test key is available. | 2026-07-10 04:30 CEST | Jordi runs `stripe login` for the intended TEST account or supplies a scoped test key through a secret channel. |
| [#763](https://github.com/zenod-ai/zenod/issues/763) | Ticket worker | Descartes / steward integration | C-18 reconcile SEAM vNext D16/D18 | done | C-8 | PR [#774](https://github.com/zenod-ai/zenod/pull/774) / `/Users/jordi/Documents/GitHub/wt-763` | `145e6f3` | Parent decisions are normative before API freeze. | Merged `0a00165`; D16/D18 rows and conformance checks 15-20 added; CI passed. | 2026-07-10 04:32 CEST | None. |
| [#768](https://github.com/zenod-ai/zenod/issues/768) | Ticket worker | 3.1 steward takeover from 3.2 pilot feedback | Pilot friction: authenticated unit routes + durable tenants | done | C-6, C-13 | PRs [#769](https://github.com/zenod-ai/zenod/pull/769), [#771](https://github.com/zenod-ai/zenod/pull/771) / `/Users/jordi/Documents/GitHub/wt-768`, `/Users/jordi/Documents/GitHub/wt-768-fix` | `468095d` | Bearer/session routes isolate and fail closed; unit product routes precede placeholders; tenant store persists/imports/rotates and self-host seeds durably. | Merged through `145e6f3`; 48 chassis tests; chassis/web typecheck/build and both CI runs passed. | 2026-07-10 04:13 CEST | 3.2 resumes pilot from merged `main`. |
| [#776](https://github.com/zenod-ai/zenod/issues/776) | Ticket worker | McClintock / steward integration | C-19 publish D16 atomic-unit skill manifest | done | C-18 | PR [#781](https://github.com/zenod-ai/zenod/pull/781) / `/Users/jordi/Documents/GitHub/wt-776` | `0a00165` | Public well-known card is versioned, tenant-neutral, and deterministic. | Merged `6bdf6e5`; 52 chassis tests, typecheck/build, README smoke, and CI passed. | 2026-07-10 04:39 CEST | None. |
| [#775](https://github.com/zenod-ai/zenod/issues/775) | Ticket worker | Planck / steward integration | C-20 implement D18 shared transcription kit | done | C-18, C-15 | PR [#784](https://github.com/zenod-ai/zenod/pull/784) / `/Users/jordi/Documents/GitHub/wt-775` | `1d7f440` | One-STT, authenticated provenance, tenant custody, attribution, graceful failure, and payload bounds. | Merged `2e3ee33`; steward repeated 64 chassis tests and build/typecheck; CI passed. | 2026-07-10 04:54 CEST | 3.2 consumes the API in its D18 path. |
| [#780](https://github.com/zenod-ai/zenod/issues/780) | Ticket worker / pilot ledger | 3.1 steward | Pilot friction: preserve public SPA while protecting custom routes | done | #768 | PR [#782](https://github.com/zenod-ai/zenod/pull/782) / `/Users/jordi/Documents/GitHub/wt-780` | `90c21c0` | Anonymous root/assets/fallback pass; registered unit routes remain bearer/session protected. | Merged `98ce0ea`; 50 chassis tests plus chassis/web typecheck/build and CI passed; exact SHA handed to 3.2. | 2026-07-10 04:43 CEST | Ownership/ledger anchor for any further 3.2 chassis friction. |
| [#789](https://github.com/zenod-ai/zenod/issues/789) | Ticket worker / security gate | 3.1 steward | Pilot defect: encrypt tenant vault and settings credentials at rest | done | #780 | PR [#794](https://github.com/zenod-ai/zenod/pull/794) / `/Users/jordi/Documents/GitHub/wt-789` | `6f16985` | Raw credentials absent from SQLite DB/WAL/SHM; exact-value isolation/restart pass; wrong or missing key fails closed; legacy migration is explicit and recoverable. | Merged `3062022`; 82 chassis tests, full clean-install workspace gate, two independent no-blocker reviews, and GitHub CI passed. | 2026-07-10 05:59 CEST | 3.2 #792 consumes the stable-key API and repeats the exact synthetic-token root scan. |

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
| Stripe TEST-account proof | Jordi | C-17 live proof | Run `stripe login` for the intended TEST account or provide a scoped test key through a secret channel; no live-mode credential is requested | Joint pilot, spine reconciliation, and all local validation |
| Chassis API freeze | Jordi | After the #792 pilot on chassis merge `3062022` and before 3.3/3.5/3.6 consume it | Approve the pilot-proven `createUnit` + encrypted-custody + SEAM-SPEC vNext surface after reviewing the joint proof and the explicit C-17 evidence state | Epic 3.2 pilot and evidence reconciliation |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Epic 3.2 starts #792 from current `main` containing chassis merge `3062022`; route any further chassis friction to a 3.1 issue without editing `packages/mcp-chassis` in 3.2.
- Run C-17 when the named Stripe TEST-account gate is available.
- Request Jordi's API-freeze decision only after the fresh 3.2 evidence is reconciled; do not equate merged code with a frozen API.

## Worker Queue

- Complete on `main`: #715-#721, #723-#727, #761-#763, #765-#766, #768, #775-#776, #780, and #789; current chassis integration commit `3062022`.
- No implementation lane is queued. Any pilot-discovered chassis defect starts from a new issue worktree and uses #780 as the 3.1 ledger anchor.

## Tester Queue

- 3.1 demo browser E2E complete in #721; 3.2 #792 reruns against chassis merge `3062022` with the stable key and recursive credential byte scan for the joint proof.
- #764 Stripe CLI live proof is blocked only on the named TEST-account credential gate.

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
| 2026-07-10 | Integrated C-6/C-9/C-10/C-12 | `c53ec32` | fresh issue worktrees, then merged `main` | chassis/web tests, typechecks, builds, and GitHub CI per PR | pass; 42 chassis tests at C-12 integration | PRs #752, #754, #753, #759 |
| 2026-07-10 | C-7 hosted three-tenant + self-host parity | `bac2729d4e3d911476f61c466f242b5858550714` | `/Users/jordi/Documents/GitHub/wt-721`; local hosted and self-host demo servers; in-app browser | 43 chassis tests; T1/T2/T3 browser sessions; direct tenant query isolation; T2 token rotation old/new/mutated = 401/200/401; self-host login + MCP initialize; web/chassis typecheck/build; GitHub CI | pass; browser-found hidden-panel regression fixed and retested | `docs/evidence/epic-3.1-c7/`, PR #760, issue #721 |
| 2026-07-10 | Post-merge DoD audit | `bac2729d4e3d911476f61c466f242b5858550714` | `/Users/jordi/Documents/GitHub/wt-epic31-spine-live` | code and contract inspection | six gaps ticketed; pilot usable, API not frozen | #761-#766 |
| 2026-07-10 | 3.2 pilot friction: protected unit routes + durable tenant store | `145e6f307284dd7770b28d6650609b4289bb9d4f` | `/Users/jordi/Documents/GitHub/wt-768` + `/Users/jordi/Documents/GitHub/wt-768-fix`; GitHub CI runs `29063657689`, `29064044683` | 48 chassis tests; bearer/session T1/T2 isolation; anonymous/config fail-closed; unit `/api/settings` precedence over placeholder; SPA ordering; restart persistence; imported-hash same-token continuity; old/new rotation; durable self-host seed close/reopen; chassis/web typecheck/build | pass; both CI runs success | #768 / PRs #769, #771 |
| 2026-07-10 | C-14 durable settings and C-18 contract reconciliation | `90c21c0`, `0a00165` | isolated issue worktrees + GitHub CI | 49 chassis tests; chassis/web typecheck/build; SEAM D16/D18 checks 15-20 | pass | #762/#763; PRs #777/#774 |
| 2026-07-10 | C-19 manifest + #780 pilot SPA/auth fix | `98ce0eafd5087044d73473c569c8faecae70d019` | `/Users/jordi/Documents/GitHub/wt-776`, `/Users/jordi/Documents/GitHub/wt-780`; GitHub CI | 50 chassis tests; anonymous root/assets/fallback; bearer/session protected custom routes; D16 public manifest; chassis/web typecheck/build | pass | #776/#780; PRs #781/#782 |
| 2026-07-10 | C-15 tenant-aware structured logging | `1d7f4407bf5ede1aa366145d7a1f45457f7ad9d6` | `/Users/jordi/Documents/GitHub/wt-766`; steward independent rerun + GitHub CI | 55 chassis tests; request/tenant correlation; path/credential redaction; chassis/web typecheck/build | pass | #766 / PR #779 |
| 2026-07-10 | C-20 D18 shared transcription | `2e3ee33e01da96f699f9b7b4cace7fbbc27979ea` | `/Users/jordi/Documents/GitHub/wt-775`; steward independent rerun + GitHub CI | 64 chassis tests; zero double STT; authenticated provenance; explicit Ring booking; T1/T2 vault isolation; provider failure; encoded/decoded payload limits | pass | #775 / PR #784 |
| 2026-07-10 | Final integrated chassis through C-16 | `ba533b3987c13a6e1c3a136bc7bab08beb00abf9` | `/Users/jordi/Documents/GitHub/wt-765`; steward independent rerun; GitHub CI `29065737476` | 71 chassis tests; chassis/web typecheck/build; modern/legacy/update conduct enforcement; ticket/poll/origin/depth; unexpected-error secret redaction; all prior route/logging/transcription tests | pass | #765 / PR #783 |
| 2026-07-10 | #789 encrypted tenant credential custody | `3062022938bb3dd26427fd820d174f29022fd7d1` | `/Users/jordi/Documents/GitHub/wt-789`; clean `npm ci`; GitHub CI `29067869905` | AES-256-GCM + HKDF tenant/vault/key binding; authenticated key verifier; atomic encrypted secret settings; restart/wrong-key/legacy migration/old-writer fence; recursive DB/WAL/SHM scans; full build; core 304 + 6 skips, chassis 82, server 558, scripts 193, schemas, all typechecks; two independent reviews | pass | #789 / PR #794 |

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

### 2026-07-10 - Epic worker - Pilot base reconciled

Context: C-6, C-9, C-10, C-12, and C-7 were integrated through `bac2729`. The demo passed 43 automated tests plus hosted three-tenant and self-host browser validation. A post-merge audit found six remaining Definition-of-Done/API-freeze gaps and ticketed them as #761-#766 rather than overstating completion.
Next: Epic 3.2 may consume `bac2729` for the Zenod first-application pilot in a fresh worktree while 3.1 drains the hardening tickets. Route all chassis friction back through Proposed Cross-Spine Updates or 3.1 issues.
Risks: The API is intentionally unfrozen during the pilot. Durable tenant/settings persistence, tenant-aware logging, structural conduct enforcement, Stripe CLI proof, and D16/D18 reconciliation remain open.
Assignment identity: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Branch / latest commit: `codex/epic31-spine-live` / `bac2729d4e3d911476f61c466f242b5858550714`
Last verified: 2026-07-10 04:00 CEST
Links:

- PRs #752, #754, #753, #759, #760
- Issues #761, #762, #763, #764, #765, #766

### 2026-07-10 - Epic worker - First pilot friction resolved

Context: Epic 3.2 consumed the agreed `bac2729` chassis without editing it, found the missing authenticated product-route and durable tenant-store seam, and filed #768. The 3.1 steward implemented the protected sub-router and SQLite provisioning store in PR #769. Pilot review then found route-placeholder shadowing and a memory-only self-host seed contract; the steward reopened #768 and fixed both in fresh-main PR #771. The final merge base is `145e6f3`.
Next: Epic 3.2 resumes from `main` at `145e6f3` and uses `createUnit({ routes })` plus `createSqliteTenantStore` in the joint three-tenant proof. Further chassis friction follows the same #768 handoff pattern.
Risks: API remains unfrozen until the full pilot passes and C-14..C-18 close. Unit product routes now precede placeholder APIs and are structurally tenant-authenticated, but 3.2 must still prove its real product handlers use the injected `unitContext` rather than payload tenant ids.
Assignment identity: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Branch / latest commit: `main` / `145e6f307284dd7770b28d6650609b4289bb9d4f`
Last verified: 2026-07-10 04:13 CEST
Links:

- Issue #768
- PR #769
- PR #771
- GitHub CI runs `29063657689`, `29064044683`

### 2026-07-10 - Epic worker - Final chassis merge train landed

Context: Pilot review continued through #780, then the steward serially integrated C-15, C-20, and C-16 on fresh `main` bases. Main at `ba533b3` now contains the public-SPA/protected-route fix, D16 manifest, durable settings/key metadata, tenant-aware structured logging, D18 shared transcription, and structural conduct enforcement. The steward repeated the final 71-test chassis suite plus chassis/web typecheck/build, and GitHub CI passed. The 3.2 steward received the exact SHA and the required joint-proof matrix. No 3.2 lane edited `packages/mcp-chassis`.
Next: Reconcile the 3.2 three-tenant/browser/self-host result against `ba533b3`; if green, request Jordi's API-freeze decision. Execute #764 when Stripe TEST-account authentication is available.
Risks: The API remains explicitly unfrozen until the joint proof and human decision. C-17 has deterministic coverage but lacks external Stripe CLI evidence; this is a named credential gate, not an implementation defect.
Assignment identity: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Branch / latest commit: `main` / `ba533b3987c13a6e1c3a136bc7bab08beb00abf9`
Last verified: 2026-07-10 04:59 CEST
Links:

- #780 / PR #782
- #766 / PR #779
- #775 / PR #784
- #765 / PR #783
- #764 Stripe TEST-account gate

### 2026-07-10 - Epic worker - Encrypted custody blocker merged

Context: The definitive 3.2 pilot found its synthetic GitHub credential in the chassis-owned `vault.sqlite-wal` and filed #789 without editing `packages/mcp-chassis`. The 3.1 steward added authenticated per-tenant vault encryption, transactional encrypted secret settings, stable-key verification, offline recoverable plaintext migration, and old-writer schema fencing. PR #794 merged as `3062022`; local clean-install gates, two independent reviews, and GitHub CI passed.
Next: Epic 3.2 creates #792 from current `main`, configures a stable unique-per-unit key, and reruns hosted/self-host restart acceptance plus a recursive scan for the exact synthetic credential. Reconcile that proof before requesting Jordi's API-freeze decision. Execute #764 when Stripe TEST-account authentication is available.
Risks: Master-key rotation is intentionally unsupported in this version; loss or change of the external key makes encrypted credentials unreadable and fails closed. Existing plaintext data must be backed up and migrated with old processes stopped. The API remains unfrozen until #792 and Jordi's decision.
Assignment identity: Codex task `019f4932-d428-7021-806a-0003ca946fc6`
Branch / latest commit: `main` / `3062022938bb3dd26427fd820d174f29022fd7d1`
Last verified: 2026-07-10 05:59 CEST
Links:

- #789 / PR #794
- #792 3.2 joint proof
- GitHub CI run `29067869905`

## Open Questions

- ~~Does the OAuth flow (Claude.ai sign-in) map to tenants 1:1 or can one OAuth user hold several tenants?~~ Resolved by C-9: each issued OAuth token is bound to exactly one tenant; access to another tenant requires a separately tenant-bound authorization.
- ~~UI shell stack: reuse `apps/web` (React) or server-rendered Hono pages?~~ Resolved by D7 (2026-07-10): reuse `apps/web`.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Record chassis API freeze date once C-1..C-8 land. | this spine | Epic 3.0 planner | proposed |
| 2026-07-10 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Update stale Z-MT-5 / tester-queue wording from two-tenant smoke to three-tenant browser E2E, and record that 3.2 reports chassis friction to 3.1 instead of editing `packages/mcp-chassis` directly. | 3.0 D6/D8, this spine co-development rule, 3.2 Definition of Done already says three tenants | Epic 3.2 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Supersede the interim `145e6f3` pilot base with exact final chassis `ba533b3`; consume authenticated routes, durable stores/settings, D16 manifest, D18 transcription, logging, and explicit conduct tool classification in a new three-tenant live-pilot worktree. | #768/#780, PRs #769/#771/#782/#779/#784/#783, final 71-test gate | Epic 3.2 steward | handed off |

## Appendix

- Existing token format `zenod_<48hex>` (`packages/server/src/settings.ts`); keep for continuity.
- `node:sqlite` `DatabaseSync` wrapper: `packages/core/src/state/sqlite.ts`.
