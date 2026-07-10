# EPIC 3.2 · Zenod Multi-Tenant — one container, all wiki brains

Status: active
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.2-ZENOD-MULTITENANT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Steward since: 2026-07-10 01:32 CEST
Last reconciled commit: `fe4e6552d7b5257185324f025dba69bb5fbe8a98`
Planner: Epic 3.0 planner
Worker: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Tester: steward takeover / Codex task `019f4933-5245-7651-9018-9ae342f587ac` on #736

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Zenod migration scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | Codex task `019f4933-5245-7651-9018-9ae342f587ac` | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
| Ticket worker | See Issue Ledger | One bound GitHub issue and branch | Execute one issue branch; do not edit this spine or `packages/mcp-chassis/**`. | PR, commit, evidence, blocker, next action in issue. |
| Tester | Steward takeover / `019f4933-5245-7651-9018-9ae342f587ac` | #736 joint 3.1/3.2 proof | Validate exact commits; report chassis friction as Proposed Cross-Spine Updates. | Commit, environment, pass/fail, risk in #736. |

## Write Scope

Bound spine: `docs/EPIC-3.2-ZENOD-MULTITENANT.md`
Active steward: Codex task `019f4933-5245-7651-9018-9ae342f587ac`

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

- [x] Zenod boots via `createUnit` on the chassis; the Zenod entry path no longer boots the legacy standalone app.
- [x] All Zenod product state is tenant-prefixed: `zenod.sqlite`, `ingest.sqlite`, `usage.sqlite`, vault, transcripts, media, and the remaining runtime databases under `/data/<tenant>/`.
- [x] Per-tenant repo token custody uses the chassis vault adapter; only tenant-bound Zenod runtime code materializes it (Law 6).
- [ ] Three-tenant browser E2E (Autonomous Validation Protocol below) passes: three provisioned tenants, each logging into the UI sees only its repo/ingest/usage, cross-tenant reads provably fail, per-tenant commit receipts intact — executed autonomously with screenshots in evidence.
- [x] Zenod UI panels (Repo, Ingest, Usage) are served from the unit container per the UI Surface section.
- [ ] Self-host parity: public image, env token, single tenant, UI included; restore-from-repo runbook (Z-5) re-verified.
- [ ] Existing hosted tenants migrated by script from per-user volumes to tenant prefixes, with rollback documented.
- [ ] `zenod.zenod.dev` serves all tenants; per-tenant subdomains retired after migration window.

## Non-Goals

- Changing Zenod's tool surface, ingest/digest behavior, or media pipeline semantics, except for the binding parent D18 one-ingest-tool contract recorded below.
- Multi-region or horizontal scaling of the Zenod container.
- Suite composition (proved in 3.0 with the machine-tenant seam).

## Current State

Phase: human-ready pilot validation; external and production gates remain
Last verified: 2026-07-10 04:54 CEST
Integration target: main
Fresh base commit: `98ce0eafd5087044d73473c569c8faecae70d019`
Integration branch / head: `codex/epic-3.2-live-pilot` / `fe4e6552d7b5257185324f025dba69bb5fbe8a98`
Worktree: `/Users/jordi/Documents/GitHub/wt-736-live`
Next action: open the final integration PR, provide a test LLM key plus three disposable writable repositories for full commit-receipt proof, then request Jordi's live-migration gate only after that proof passes.
Blockers: full-mode per-tenant commit receipts require a test LLM key; Stripe test-event proof lacks Stripe test authentication; live migration and subdomain retirement remain at the named Jordi gates.

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
| 1 | `docs/final-container-map-deck.html` | CANONICAL target picture (parent D11): the zenod box — MCP, console UI, GitHub App + Drive OAuth via chassis kit, Stripe webhook, transcription + file backup/archive duties. | Always |
| 2 | `packages/server/src/runtime.ts` | Current storage construction to re-point at tenant handles. | Worker |
| 3 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Product facts, ZD decisions, tokened URL. | Always |
| 4 | `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md` | Self-host/restore contract to preserve. | Tester |

## Architecture And Context

Zenod is the stateful unit: per-tenant git vault clone plus ~9 SQLite files currently constructed once per container in `runtime.ts`. Under the chassis, construction moves to per-tenant lazy init behind `storage.dir(tenant)`/`storage.db(tenant, name)`. The MCP tool surface (`buildMcpServer`) is unchanged; it receives tenant-scoped handles from context instead of globals. Migration: for each existing tenant container, stop, copy volume into `/data/<tenant>/` of the multi-tenant instance, insert tenant row with the SAME token hash (URL continuity), verify, then retire the old container and subdomain.

Ticket sketch: Z-MT-1 runtime storage → tenant handles; Z-MT-2 vault/repo custody via chassis vault; Z-MT-3 UI panels; Z-MT-4 migration script + rollback; Z-MT-5 three-tenant browser E2E + self-host parity; Z-MT-6 DNS/proxy cutover and old-instance retirement.

### UI Surface (PORT the existing `apps/web` console — D7; Zenod is the pilot character, D6)

Zenod's UI already exists: the `apps/web` React console served by the unit's own container. Port it onto the chassis and tenant-scope it; change nothing else. Concretely, the tenant keeps exactly what they have today:

- **SetupWizard** (5 steps: password, Vault repo — GitHub PAT + owner/name + branch, Model key, WhatsApp, done) — per tenant instead of per container.
- **Settings tabs**: Chat, Vault (`VaultTab` + `/api/vault/*` incl. sync/reclone/lint), Keys & models (`KeysTab` + test endpoints), Transcription, Connections (GitHub/Drive/Composio connects), Costs (`CostsTab` + `/api/usage`), Test.
- **Login** and the `/api/auth/hosted-entry` cloud bridge, now issuing tenant-scoped sessions.
- **OAuth via the chassis kit (parent D9)**: GitHub App (vault repo), Google Drive (artifact archive), MCP-client sign-in — Zenod declares providers, the kit runs the flows, callbacks bind to the session tenant, keys land in the vault. Do not keep unit-local OAuth code.
- **Billing (parent D10)**: Zenod's own `/api/billing/webhook` (chassis module) provisions its tenants; verify with Stripe test events during the pilot.

Scope reminder: Zenod's duties include transcription (audio), OCR/vision ingest, and file backup/archive to Drive/git — the tenant-prefixed storage work (Z-MT-1) must cover the media store and transcription paths, not just the vault.

Ingest tool contract (parent D18 — one tool, double-transcription impossible by construction): Zenod exposes ONE media-ingest tool, not an `ingest`/`ingest_and_transcribe` pair a caller could misuse. Signature accepts `{ media: artifact_ref | upload, transcript?: { text, source, version }, … }`. Behavior: transcript present → STT is BYPASSED, the provided transcript is filed, provenance recorded ("transcribed by phylax@vX"); transcript absent → Zenod transcribes with the shared chassis module. The RECEIPT states which branch ran (`transcription: provided | performed`), so any double-transcription would be visible evidence, and tests assert the bypass (ingest with transcript must produce zero STT provider calls).

The porting work is entirely behind the API: every one of these tabs' `/api/*` handlers resolves data through tenant-scoped handles instead of container globals. A tenant logging in sees ONLY their vault, their keys, their ingest history, their costs. Tabs belonging to other characters (Ring control surface, Epaminon executor settings, Phylax channels) are hidden for standalone Zenod tenants via the existing conditional-tab mechanism.

As the D6 pilot, this epic is ALSO the proof that the chassis shell works: pilot feedback flows to 3.1 via Proposed Cross-Spine Updates until the chassis API freezes.

### Container And Deploy

- One image (Zenod on chassis), one container, port 8080, hostname `zenod.zenod.dev` (or chosen host), `VOLUME /data` with layout `/data/<tenant>/{vault,transcripts,media,*.sqlite}`.
- One Dokploy application; deploy = rebuild it; all tenants upgrade together.
- Client URL unchanged: `https://zenod.zenod.dev/mcp/<token>` (ZD-8 preserved; migrated tenants keep their tokens).

### Autonomous Validation Protocol (three-tenant browser E2E)

The epic worker validates WITHOUT human help, via browser automation against a fresh local container:

1. Boot fresh; provision T1, T2, T3 via `POST /api/tenants` (three test git repos prepared, one per tenant).
2. Per tenant: connect its repo through the UI; run one ingest via MCP (`/mcp/<token>`); assert commit receipt lands in THAT tenant's repo only.
3. Per tenant: browser-login; Repo panel shows only its repo, Ingest history only its items, Usage only its counts.
4. Negative: direct-URL attempts from T1's session to T2 resources must fail; MCP search with T1's token must never return T2 vault content (plant a unique marker string in T2's vault and search for it as T1).
5. Self-host parity: boot single-tenant from env token; UI + ingest + commit receipt work identically.
6. Migration rehearsal (Z-MT-4): copy a per-user volume into `/data/<tenant>/`, insert tenant row with same token hash, assert old URL keeps working.
7. Record commands, screenshots, marker-string proofs in Validation Evidence with exact commit.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Preserve existing tenant tokens across migration. | Client URLs (ZD-8) must not change; token hash is the tenant key. | `docs/MCP-CHASSIS-SPEC.md` |
| 2026-07-10 | Lazy per-tenant storage init. | Avoid boot-time scan of all tenants; first request creates handles. | parent D1 |
| 2026-07-10 | Tenant sessions carry a tenant id inside a chassis-signed cookie; product APIs fail closed while the anonymous SPA/login shell remains public. | Browser API calls need stable tenant context without trusting client-supplied tenant ids, and users must be able to reach the login screen. | #734 and chassis #780 / PR #782 |
| 2026-07-10 | Shared model binaries may remain outside tenant roots; media artifacts and all mutable product state may not. | Whisper model files are immutable cache, while archive/media receipts are tenant data. | #734 path audit |
| 2026-07-10 | Parent D18 is binding acceptance for Z-MT-1 and Z-MT-3: one ingest tool accepts an optional transcript, bypasses STT when supplied, and reports `transcription: provided \| performed`. | This prevents double transcription by construction while keeping the change narrowly scoped to the parent decision. | #734 and #733 issue comments |
| 2026-07-10 | Z-MT-1 consumes chassis tenant auth and storage rather than reviving the custom `TenantRuntimeManager`. | Duplicating chassis token registry/session logic in Zenod would violate the co-development boundary. | #768, #769, #771 |
| 2026-07-10 | Migration targets `chassis-tenants.sqlite` and securely removes obsolete standalone auth rows from the copied `zenod.sqlite`. | Same-token URL continuity belongs in the chassis hash registry; keeping the old raw token or session secret at rest would violate custody. | #737 and `fe4e655` migration proof |
| 2026-07-10 | Chassis friction remains 3.1-owned. | The pilot exposed public-SPA route auth scope without taking over `packages/mcp-chassis/**`; 3.1 fixed and merged it. | #780 / PR #782 / `98ce0ea` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#734](https://github.com/zenod-ai/zenod/issues/734) | Ticket worker | Steward integration | Z-MT-1 tenant runtime storage and token routing | ready for review | #768, #780 complete | `codex/epic-3.2-live-pilot`; `/Users/jordi/Documents/GitHub/wt-736-live` | `98ce0ea` | All DB/paths tenant rooted through chassis handles; token/API/session isolation; WAL/busy timeout; D18 receipt branches. | `fe4e655`; 575 server tests; three-tenant contract and browser sessions pass. | 2026-07-10 04:54 CEST | Review final integration PR. |
| [#735](https://github.com/zenod-ai/zenod/issues/735) | Ticket worker | Steward integration | Z-MT-2 repo-token custody in vault | ready for review | #734 | `codex/epic-3.2-live-pilot` | `98ce0ea` | Repo token per tenant, vault-read only by Zenod. | Chassis vault adapter, cross-tenant handle negative, fake-credential browser pilot, raw-token scan pass at `fe4e655`. | 2026-07-10 04:54 CEST | Review final integration PR. |
| [#733](https://github.com/zenod-ai/zenod/issues/733) | Ticket worker | Steward integration | Z-MT-3 Zenod settings UI panels | ready for review | #734 | `codex/epic-3.2-live-pilot` | `98ce0ea` | Tenant sees repo/ingest/usage panels only for itself; ingest UI renders `provided \| performed`. | T1/T2/T3 browser captures plus D18 web test/build at `fe4e655`. | 2026-07-10 04:54 CEST | Review final integration PR. |
| [#737](https://github.com/zenod-ai/zenod/issues/737) | Ticket worker | Steward integration | Z-MT-4 migration script + rollback | validated | #734 storage contract | `codex/epic-3.2-live-pilot` | `98ce0ea` | Dry-run, apply, verify, rollback, same-token continuity, and secret erasure pass. | 11 tests plus live synthetic same-token boot, repo preservation, zero raw-token matches at `fe4e655`. | 2026-07-10 04:54 CEST | Keep live migration behind Jordi gate. |
| [#736](https://github.com/zenod-ai/zenod/issues/736) | Tester | Steward takeover | Z-MT-5 three-tenant E2E + self-host parity | partial pass; external full-mode gate | #734, #735, #733, #737 | `codex/epic-3.2-live-pilot` | `98ce0ea` | Three-tenant isolation, receipts, migration, self-host parity. | Contract/browser/self-host/migration pass at `fe4e655`; full commit receipts need a test LLM key and disposable repos. | 2026-07-10 04:54 CEST | Supply key/repos and run `--mode full`. |
| [#738](https://github.com/zenod-ai/zenod/issues/738) | Ticket worker | Steward integration | Z-MT-6 cutover + retire per-user instances | preparation complete; human-gated | #737, #736, Jordi gates | `codex/epic-3.2-live-pilot` | `98ce0ea` | Approved cutover verified; legacy retirement reversible. | Inventory/runbook tests pass; no production mutation performed. | 2026-07-10 04:54 CEST | Wait for full proof and Jordi approvals. |

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

- Open and review the final Epic 3.2 integration PR from `fe4e655`.
- Obtain a test LLM key and three disposable writable repositories for #736 full mode.
- Keep live migration and subdomain retirement behind the two Jordi gates.
- Continue routing any chassis friction to 3.1; do not patch `packages/mcp-chassis/**`.

## Worker Queue

- Ready for review: #733, #734, #735, #737.
- Human-gated preparation: #738.

## Tester Queue

- #736: contract/browser/self-host/migration pass; run full marker and commit-receipt proof when the test LLM key and repositories are supplied.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `fe4e655` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.2-ZENOD-MULTITENANT.md` | pass | strict validator OK |
| 2026-07-10 | Z-MT-1 compile | working tree from `8e12ebab` | local Node 22 | `npm run typecheck -w zenod` and `npm run typecheck -w @zenod/server` | pass | core and server typecheck exit 0 |
| 2026-07-10 | Z-MT-1 regression | working tree from `8e12ebab` | local Vitest | `npm test -w @zenod/server` | pass | 59 files, 558 tests |
| 2026-07-10 | Z-MT-1 real-chassis checkpoint | `51a6e10` from `bac2729` | local Node 22 / Vitest | build `zenod` + `@zenod/mcp-chassis`; server typecheck; `npm test -w @zenod/server` | pass | 61 files, 561 tests; runtime pool tenant roots and WAL/30s focused tests included; draft PR #770 |
| 2026-07-10 | Parent D18 one-ingest contract | `codex/z-mt-1-chassis-reconcile` | local Node 22 / Vitest | focused media/MCP/Ring/store tests plus `npm test -w @zenod/server` | pass | 61 files, 564 tests; supplied transcript: zero STT calls + `provided`; absent transcript: one STT call + `performed`; no second mutating media-ingest tool |
| 2026-07-10 | Final rebased build and automation | `fe4e655` on `98ce0ea` | local Node 22 | root build; chassis/server/script suites | pass | 53 chassis tests; 63 server files / 575 tests; 25 Epic scripts; no skips |
| 2026-07-10 | Joint three-tenant contract | `fe4e655` | production entrypoint, fresh local data root | `node scripts/epic32-joint-proof.mjs --mode contract` | pass | `docs/evidence/epic-3.2-pilot/fe4e655-contract/summary.json` |
| 2026-07-10 | T1/T2/T3 browser UI and URL-spoof negative | `fe4e655` | Codex in-app Browser, 1280x720 | token login; Vault, Transcription, Costs; T2 query under T3 session | pass | `docs/evidence/epic-3.2-pilot/fe4e655-browser/` |
| 2026-07-10 | Self-host env-token parity and restart | `fe4e655` | production entrypoint on local 8081 | root/static, MCP, settings, token login, browser, process restart | pass | `self-host.png`; restart returned root/settings/login 200 |
| 2026-07-10 | Same-token migration rehearsal | `fe4e655` | synthetic legacy volume and production entrypoint on local 8082 | plan/apply/verify, unchanged MCP token, repo read, raw-byte scan | pass | checksums/SQLite/git/registry pass; zero raw-token files |

## Handoff Journal

### 2026-07-10 - Epic worker - Final-chassis pilot reconciled

Context: `codex/epic-3.2-live-pilot` was rebased in `/Users/jordi/Documents/GitHub/wt-736-live` onto exact `main` `98ce0ea`, including 3.1's #780 route-auth fix. The rebased head `fe4e655` passes builds, 53 chassis tests, 575 server tests, 25 Epic script tests, three-tenant contract proof, real T1/T2/T3 browser sessions, self-host restart, and same-token migration. No 3.2 commit edits `packages/mcp-chassis/**`.
Next: open/review the final PR; supply a test LLM key and three disposable writable repositories for full commit receipts; keep production migration and DNS behind Jordi gates.
Risks: full live GitHub commit receipts and Stripe test events are not yet evidenced; fake browser credentials intentionally show clone failures while proving tenant-specific repo rendering.
Assignment identity: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Branch / latest commit: `codex/epic-3.2-live-pilot` / `fe4e6552d7b5257185324f025dba69bb5fbe8a98`
Last verified: 2026-07-10 04:54 CEST
Links: #733, #734, #735, #736, #737, #738, #780, PR #782, `docs/evidence/epic-3.2-pilot/`

### 2026-07-10 - Epic worker - Z-MT-1 rebased to real chassis contract

Context: `origin/main` is exactly `bac2729` and includes the completed 3.1 demo evidence plus `packages/mcp-chassis`. Z-MT-1 restarted in `/Users/jordi/Documents/GitHub/wt-z-mt-1` on `codex/z-mt-1-chassis-reconcile`; the parked custom tenant manager will not be replayed. D18 acceptance is reconciled into #734/#733.
Next: continue Zenod-owned runtime/path adaptation and consume the #768 authenticated route/durable store seam when the 3.1 steward lands it; then run #736 as the joint proof.
Risks: `createUnit` currently cannot authenticate unit-defined product routes and its only concrete tenant store is in-memory, so hosted restart and the full Zenod UI cannot pass yet.
Assignment identity: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Branch / latest commit: `codex/z-mt-1-chassis-reconcile` / `bac2729d4e3d911476f61c466f242b5858550714`
Last verified: 2026-07-10 03:51 CEST
Links: #734, #733, #736, #768

### 2026-07-10 - Epic worker - Phase 1 issues minted and parallel batch dispatched

Context: #733 through #738 are the executable 3.2 board. The steward retains #734 as the integration critical path; Raman owns web-only #733, Lovelace owns #737 migration tooling, Franklin owns #736 joint proof, and Gibbs owns #738 pre-gate runbook preparation. #735 waits for the tenant context rather than a chassis freeze.
Next: focused tenant proof on #734; review and integrate branch handoffs; send every chassis mismatch to the 3.1 steward through Proposed Cross-Spine Updates.
Risks: root-vs-tenant API fallback, tenant secret custody, and OAuth callback tenant binding remain the highest-risk seams.
Assignment identity: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Branch / latest commit: `codex/epic-3.2-zenod-multitenant` / working tree from `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Last verified: 2026-07-10 01:46 CEST
Links: #733, #734, #735, #736, #737, #738

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

- Full receipt proof inputs: which three disposable repositories and which test LLM key may #736 use? Owner: Jordi. Needed before: merge/go-live declaration.
- Live cutover window and per-tenant order remain a named Jordi gate. Owner: Jordi. Needed before: #738 execution.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Mark Z-1/ZD-6/ZD-10 deployment model superseded by this epic once Z-MT-6 lands. | this spine | Epic 2.3 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Reconcile C-4 with pilot evidence: the Zenod SQLite set needs WAL + 30s busy timeout and tenant media paths, while identity comes from verified token/session context. | #734 and #736 contract | Epic 3.1 steward | accepted in pilot integration |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Reconcile C-6 with the pilot session shape: chassis-signed tenant session, fail-closed product APIs, public login SPA. | #733/#734 and #780 | Epic 3.1 steward | accepted via PR #782 |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Add authenticated custom product routes and a durable chassis-owned tenant store. | [#768](https://github.com/zenod-ai/zenod/issues/768) | Epic 3.1 steward | accepted via PRs #769 and #771 |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Scope custom-route auth to declared route matches so anonymous root/static SPA requests remain public. | [#780](https://github.com/zenod-ai/zenod/issues/780) | Epic 3.1 steward | accepted via PR #782 / `98ce0ea` |

## Appendix

- Current SQLite set (from `runtime.ts`): zenod, oauth, whatsapp, ingest, tasks, execution, journeys, usage, notifications.
