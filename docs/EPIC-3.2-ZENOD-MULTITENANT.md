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
Last reconciled commit: blocked pilot checkpoint `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67`
Planner: Epic 3.0 planner
Worker: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Tester: Franklin / agent `019f493d-8bcc-7930-b2d5-92f4a1dab782` on #736

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Zenod migration scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | Codex task `019f4933-5245-7651-9018-9ae342f587ac` | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
| Ticket worker | See Issue Ledger | One bound GitHub issue and branch | Execute one issue branch; do not edit this spine or `packages/mcp-chassis/**`. | PR, commit, evidence, blocker, next action in issue. |
| Tester | Franklin / `019f493d-8bcc-7930-b2d5-92f4a1dab782` | #736 joint 3.1/3.2 proof | Validate exact commits; report chassis friction as Proposed Cross-Spine Updates. | Commit, environment, pass/fail, risk in #736. |

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

- [x] Zenod boots via `createUnit` on the chassis; `AGENT=zenod` path retired.
- [x] All state tenant-prefixed: `zenod.sqlite`, `ingest.sqlite`, `usage.sqlite`, `vault/` clone, `transcripts/`, media store under `/data/<tenant>/`.
- [ ] Per-tenant repo token custody in the chassis vault; only Zenod code may read it (Law 6).
- [ ] Three-tenant browser E2E (Autonomous Validation Protocol below) passes: three provisioned tenants, each logging into the UI sees only its repo/ingest/usage, cross-tenant reads provably fail, per-tenant commit receipts intact — executed autonomously with screenshots in evidence.
- [x] Zenod UI panels (Repo, Ingest, Usage) served from the unit container per the UI Surface section.
- [ ] Self-host parity: public image, env token, single tenant, UI included; restore-from-repo runbook (Z-5) re-verified.
- [ ] Existing hosted tenants migrated by script from per-user volumes to tenant prefixes, with rollback documented.
- [ ] `zenod.zenod.dev` serves all tenants; per-tenant subdomains retired after migration window.

## Non-Goals

- Changing Zenod's tool surface, ingest/digest behavior, or media pipeline semantics, except for the binding parent D18 one-ingest-tool contract recorded below.
- Multi-region or horizontal scaling of the Zenod container.
- Suite composition (proved in 3.0 with the machine-tenant seam).

## Current State

Phase: implementation and autonomous validation
Last verified: 2026-07-10 05:24 CEST
Integration target: main
Fresh base commit: chassis `ba533b3987c13a6e1c3a136bc7bab08beb00abf9`, reconciled main parent `476e02629136e83f124c0dd3a997f9c723631550`
Next action: consume the merged #789 encrypted-vault fix from 3.1, rebase the definitive #736 worktree onto its exact main SHA, then repeat the full automated, browser, restart, migration, and custody proof before Gate-2 input is sent to #738.
Blockers: #789 must make chassis vault world credentials encrypted at rest; live migration, retirement, and the Epic 3.7 candidate digest `33c792c909a3c039d447bed8b597735380208f67f3e72b925913d0f5ee10dd40` remain behind the named Jordi gates. Full real commit receipts additionally require disposable repositories and a test LLM key; Stripe live proof remains a 3.1 credential gate.

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
| 2026-07-10 | Tenant sessions carry a tenant id inside a tenant-secret-signed cookie; the multitenant root fails closed for unbound product APIs. | Browser API calls need a stable tenant context without changing the existing SPA API paths or trusting a client-supplied tenant id. | #734 working tree from `8e12ebab` |
| 2026-07-10 | Shared model binaries may remain outside tenant roots; media artifacts and all mutable product state may not. | Whisper model files are immutable cache, while archive/media receipts are tenant data. | #734 path audit |
| 2026-07-10 | Parent D18 is binding acceptance for Z-MT-1 and Z-MT-3: one ingest tool accepts an optional transcript, bypasses STT when supplied, and reports `transcription: provided \| performed`. | This prevents double transcription by construction while keeping the change narrowly scoped to the parent decision. | #734 and #733 issue comments |
| 2026-07-10 | Z-MT-1 consumes chassis tenant auth and storage rather than reviving the custom `TenantRuntimeManager`. | Main `bac2729` now contains the real chassis; duplicating its token registry/session logic in Zenod would violate the co-development boundary. | #768 |
| 2026-07-10 | Zenod explicitly declares its eight read tools through `createUnit({ conduct: { toolKinds } })`; all unknown tools remain fail-safe mutations. | C-16 no longer treats `readOnlyHint` as authority, so the unit must own and test its read classification. | `2d8509e`, #736 |
| 2026-07-10 | Raw world credentials in the generic chassis vault are a 3.1 defect, not a license for a Zenod-local chassis fork. | The definitive browser scan found plaintext in `vault.sqlite-wal`, conflicting with the parent encrypted-custody law. The co-development boundary requires a Proposed Cross-Spine Update. | #789 anchored to #780 |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#734](https://github.com/zenod-ai/zenod/issues/734) | Ticket worker | Epic worker | Z-MT-1 tenant runtime storage and token routing | needs review | #789 final custody gate | `codex/epic-3.2-definitive-pilot`; `/Users/jordi/Documents/GitHub/wt-736-definitive` | `476e026` with chassis at `ba533b3` | All DB/paths tenant rooted through chassis handles; token/API/session isolation; WAL/busy timeout; D18 provided transcript bypass produces zero STT calls and receipt says `provided`, absent transcript receipt says `performed`. | `2d8509e`: full build/typecheck; 576 server tests; three-tenant bearer/session/restart proof; D18 focused pass. | 2026-07-10 05:24 CEST | Rebase onto merged #789 SHA and rerun. |
| [#735](https://github.com/zenod-ai/zenod/issues/735) | Ticket worker | Epic worker; 3.1 steward owns dependency | Z-MT-2 repo-token custody in vault | blocked | #789 | `codex/epic-3.2-definitive-pilot`; `/Users/jordi/Documents/GitHub/wt-736-definitive` | `476e026` | Repo token per tenant, encrypted at rest, vault-read only by Zenod. | Handle-only `zenod.sqlite` and tenant isolation pass; raw synthetic world credential found in chassis `vault.sqlite-wal`; #789 filed and accepted by 3.1. | 2026-07-10 05:24 CEST | Consume #789; repeat DB/WAL/SHM scans and restart materialization. |
| [#733](https://github.com/zenod-ai/zenod/issues/733) | Ticket worker | Epic worker | Z-MT-3 Zenod settings UI panels | needs review | #789 final proof | `codex/epic-3.2-definitive-pilot`; `/Users/jordi/Documents/GitHub/wt-736-definitive` | `476e026` | Tenant sees repo/ingest/usage panels only for itself; ingest UI uses one contract and renders `transcription: provided \| performed`. | T1/T2/T3 Vault, Transcription, Costs screenshots; reload identity; URL-spoof isolation; web build and test pass. | 2026-07-10 05:24 CEST | Repeat browser proof after #789 rebase. |
| [#737](https://github.com/zenod-ai/zenod/issues/737) | Ticket worker | Epic worker | Z-MT-4 migration script + rollback | needs review | #734 storage contract | `codex/epic-3.2-definitive-pilot`; `/Users/jordi/Documents/GitHub/wt-736-definitive` | `476e026` | Dry-run and rollback on copied volume pass checksums/integrity. | Dry-run/apply/verify receipt pass; unchanged token API/MCP before and after restart; raw bearer scan zero. | 2026-07-10 05:24 CEST | Repeat migration against #789 and keep live mutation behind Jordi gate. |
| [#736](https://github.com/zenod-ai/zenod/issues/736) | Tester | Epic worker / browser tester | Z-MT-5 three-tenant E2E + self-host parity | blocked | #789, full-mode credentials | `codex/epic-3.2-definitive-pilot`; `/Users/jordi/Documents/GitHub/wt-736-definitive` | `476e026` | Three-tenant isolation, receipts, migration, self-host parity. | `2d8509e` checkpoint: every local contract/browser/restart/migration/D18 gate passed except encrypted custody; full real commit receipts unavailable without disposable repos + test LLM key. | 2026-07-10 05:24 CEST | Rebase to merged #789 SHA and run definitive fresh-data proof. |
| [#738](https://github.com/zenod-ai/zenod/issues/738) | Ticket worker | Epic worker; Epic 3.7 independent tester | Z-MT-6 cutover + retire per-user instances | blocked at gates | #737, #736, Jordi gates | `codex/epic-3.2-definitive-pilot`; runbook integrated | `476e026` | Approved cutover verified; legacy retirement reversible. | Epic 3.7 candidate digest `33c792c909a3c039d447bed8b597735380208f67f3e72b925913d0f5ee10dd40` recorded with no apply path; Gate-2 withheld. | 2026-07-10 05:24 CEST | After #736 passes, provide exact Gate-2 input; no retirement without Jordi approval. |

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
| Full real commit-receipt proof | Jordi | #736 contract/browser proof is otherwise green | Provide three disposable writable repositories plus a test-only LLM key through a secret channel | Contract mode, migration, browser isolation, and all deterministic tests |
| Epic 3.7 Gate-2 retirement input | Jordi | #736 passes after #789 | Approve candidate digest `33c792c909a3c039d447bed8b597735380208f67f3e72b925913d0f5ee10dd40`, window, archive verification, and rollback plan | Independent 3.7 testing with no apply path |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Track #789 through the Epic 3.1 steward; accept only a chassis-owned encrypted-vault fix with DB/WAL/SHM byte scans and explicit plaintext compatibility.
- Keep #735/#736 blocked until #789 merges; do not patch the chassis from 3.2.
- Rebase the definitive worktree onto the exact post-#789 main SHA and rerun all fresh-data evidence.
- Hold #738 Gate-2 input and all live mutation until #736 passes and Jordi separately approves digest, window, archive verification, and rollback.

## Worker Queue

- Needs review: #733, #734, #737.
- Blocked: #735 and #736 on #789; #738 on #736 plus Jordi gates.

## Tester Queue

- #736: repeat the definitive three-tenant browser/MCP/restart/migration/custody proof after #789; full marker/commit-receipt mode remains a named credential gate.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.2-ZENOD-MULTITENANT.md` | pending | - |
| 2026-07-10 | Z-MT-1 compile | working tree from `8e12ebab` | local Node 22 | `npm run typecheck -w zenod` and `npm run typecheck -w @zenod/server` | pass | core and server typecheck exit 0 |
| 2026-07-10 | Z-MT-1 regression | working tree from `8e12ebab` | local Vitest | `npm test -w @zenod/server` | pass | 59 files, 558 tests |
| 2026-07-10 | Z-MT-1 real-chassis checkpoint | `51a6e10` from `bac2729` | local Node 22 / Vitest | build `zenod` + `@zenod/mcp-chassis`; server typecheck; `npm test -w @zenod/server` | pass | 61 files, 561 tests; runtime pool tenant roots and WAL/30s focused tests included; draft PR #770 |
| 2026-07-10 | Parent D18 one-ingest contract | `codex/z-mt-1-chassis-reconcile` | local Node 22 / Vitest | focused media/MCP/Ring/store tests plus `npm test -w @zenod/server` | pass | 61 files, 564 tests; supplied transcript: zero STT calls + `provided`; absent transcript: one STT call + `performed`; no second mutating media-ingest tool |
| 2026-07-10 | Final-chassis automated gate | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | `/Users/jordi/Documents/GitHub/wt-736-definitive`; Node 22 | root build/typecheck; chassis/server/core/web/script suites | pass | 71 chassis; 576 server; 304 core + 6 intentional skips; 184 scripts; 1 web; 27 schemas |
| 2026-07-10 | Joint three-tenant contract | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | hosted `:8080`, self-host `:8081`, fresh local data | `node scripts/epic32-joint-proof.mjs --mode contract` plus process restarts | pass | `docs/evidence/epic-3.2-pilot/2d8509e-contract/`; anonymous root/assets, bearer/session isolation, C-16 MCP reads, rotation, WAL, restart, raw bearer scan |
| 2026-07-10 | Migration unchanged-token rehearsal | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | migrated `:8082`, synthetic legacy volume | migration plan/apply/verify; API/MCP before and after restart | pass | `docs/evidence/epic-3.2-pilot/2d8509e-migration/` |
| 2026-07-10 | D18 zero-double-STT | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | local Vitest | focused server media/MCP tests and chassis transcription tests | pass | 29 server tests + 9 chassis tests; provided = zero STT, performed = one STT |
| 2026-07-10 | Three-tenant browser and parity | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | in-app Chromium 1280x720; hosted/self-host/migrated | login, reload, Vault/Transcription/Costs, T3 URL spoof | pass | `docs/evidence/epic-3.2-pilot/2d8509e-browser/` |
| 2026-07-10 | Encrypted world-key custody | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | fresh hosted tenant; byte scan | set synthetic GitHub credential, scan tenant DB/WAL bytes | fail / release blocker | raw world credential in `vault.sqlite-wal`; bearer scan clean; #789 anchored to #780 |

## Handoff Journal

### 2026-07-10 - Epic worker - Definitive pilot blocked on encrypted chassis vault

Context: the new issue worktree `/Users/jordi/Documents/GitHub/wt-736-definitive` replayed the complete 3.2 product series onto reconciled main `476e026`, whose executable chassis is `ba533b3`. Product commit `2d8509e` passed the full build/typecheck and automated suite, three-tenant bearer/session/MCP/rotation proof, hosted/self-host restart, reversible unchanged-token migration, D18 zero-double-STT checks, and browser reload/isolation evidence. The final custody scan found a raw synthetic GitHub credential in the chassis-owned `vault.sqlite-wal` while all bearer scans remained clean.
Next: Epic 3.1 owns #789 as a Proposed Cross-Spine Update anchored to #780. After its exact merged main SHA is returned, rebase this worktree and repeat the entire proof from fresh data. If green, post exact accepted evidence to #736 and provide the recorded Epic 3.7 candidate digest to #738 as Gate-2 input.
Risks: encrypted world-key custody is not met until #789 lands; real commit-receipt/marker mode still needs disposable writable repositories and a test LLM key; no production migration, DNS, archive, or retirement action is authorized.
Assignment identity: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Branch / latest commit: `codex/epic-3.2-definitive-pilot` / `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67`
Last verified: 2026-07-10 05:24 CEST
Links: #733, #734, #735, #736, #737, #738, #789, #780

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

- Do any ingest/media code paths hardcode `/data` roots outside `runtime.ts`? Owner: Epic worker. Needed by: Z-MT-1.
- Per-tenant gateway (LLM) keys: chassis vault or keep the standalone keyring? Owner: Jordi. Needed by: Z-MT-2.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Mark Z-1/ZD-6/ZD-10 deployment model superseded by this epic once Z-MT-6 lands. | this spine | Epic 2.3 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Reconcile C-4 with pilot evidence: the Zenod SQLite set needs a canonical WAL + 30s busy-timeout contract and tenant media paths, while tenant identity must come from verified token/session context rather than request data. | #734 working tree and #736 joint-proof contract | Epic 3.1 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Reconcile C-6 with the pilot session shape: tenant id is carried in a tenant-secret-signed session and the root front controller fails closed for unbound product APIs. | #733/#734 | Epic 3.1 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Add a pre-SPA authenticated custom-route extension to `createUnit` that supplies tenant-bound context, plus a durable chassis-owned tenant provisioning store with restart persistence and same-token migration continuity. | Main `bac2729` API audit and [#768](https://github.com/zenod-ai/zenod/issues/768) | Epic 3.1 steward | proposed; blocking joint proof |

## Appendix

- Current SQLite set (from `runtime.ts`): zenod, oauth, whatsapp, ingest, tasks, execution, journeys, usage, notifications.
