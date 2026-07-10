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
Last reconciled commit: final freeze target `main@b5ad8ececc7b09425eaac6bd9255e2b667af46f4`; candidate code head before this steward reconciliation `f3f505f517e49f695171973d3ae180163ee57029`
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
- [x] Per-tenant repo token custody in the encrypted chassis vault; only tenant-bound Zenod code may materialize it (Law 6).
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

Phase: code-ready; blocked at the non-production full-evidence human gate
Last verified: 2026-07-10 07:31 CEST
Integration target: `main`; one final rebase onto freeze target `main@b5ad8ececc7b09425eaac6bd9255e2b667af46f4` follows this steward commit, after which docs-only main movement will not invalidate evidence
Candidate line: `/Users/jordi/Documents/GitHub/wt-736-definitive`, branch `codex/epic-3.2-definitive-pilot`, code head `f3f505f517e49f695171973d3ae180163ee57029` before this steward-only spine reconciliation
Current proof: all prior 3.1/#789, #792, runtime-image, commit/digest binding, D18, and 96-path custody findings are closed in code. Rebased code head `f3f505f517e49f695171973d3ae180163ee57029` passed CI 29071507518 and publish/smoke 29071773126 with immutable index `sha256:475c1020158d914688f49e4097598503d5969c78d9f81694fe37417b6e2a8bea`; final `b5ad8ec` freeze identity is pending this steward commit/rebase and one exact-head refresh.
Next action: obtain the two explicit full-mode approvals, then execute fresh hosted T1/T2/T3 Repo/Ingest/Usage and marker/commit negatives, self-host parity, migration plan/apply/verify/idempotency/rollback, Z-5 restore, browser captures, and recursive custody receipts. Only an accepted #736 package may supply #738 Gate-2 input.
Blockers: Jordi must approve disposable marker/schema pushes to `AlfaBlok/test_evals`, `AlfaBlok/react_test1`, and `AlfaBlok/zenod-cloud-test-vault-4ptjqj`, and mint/provide one capped non-production OpenRouter key (recommended $1) through a secret channel. Production migration, DNS, Dokploy, archive, cleanup, Gate 2, and retirement remain unauthorized. The Epic 3.7 candidate digest `33c792c909a3c039d447bed8b597735380208f67f3e72b925913d0f5ee10dd40` has no apply path.

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
| 2026-07-10 | Hosted/self-host units use one stable, unique-per-unit external 32-byte `CHASSIS_VAULT_MASTER_KEY`; missing or wrong keys fail closed and key rotation is out of scope. | Chassis custody must survive restart/restore without placing the master key under `/data`. | #789, #794, #796 |
| 2026-07-10 | Existing `zenod-secret:v1:*` handles are preserved while standalone `credential_entries` are imported through the encrypted chassis `TenantVault`; cleanup is resumable and rollback is refused after hosted conversion. | Rewriting settings handles across databases is not atomic; exact-handle import gives deterministic restart and recovery behavior. | #792, `17b4f0f` on the rebased candidate line |
| 2026-07-10 | A publish is not evidence until the final runtime image boots and verifies its OCI revision plus authenticated product-health SHA before push. | Build-stage success allowed a runtime image that omitted the chassis workspace package. | #797, publish run 29071254538 on the pre-rebase equivalent line |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#734](https://github.com/zenod-ai/zenod/issues/734) | Ticket worker | Epic worker | Z-MT-1 tenant runtime storage and token routing | needs review | full #736 acceptance | draft PR #791; `053c558` and follow-ups on the rebased line | `b5ad8ec` freeze target | All DB/paths tenant rooted through chassis handles; token/API/session isolation; WAL/busy timeout; D18 provided transcript bypass is zero STT and absent transcript is one STT call. | Code-ready; exact pre-rebase closure passed CI and 581 server tests; current branch is conflict-free on tip main. | 2026-07-10 07:31 CEST | Accept with the fresh full #736 package. |
| [#735](https://github.com/zenod-ai/zenod/issues/735) | Ticket worker | Epic worker | Z-MT-2 repo/provider custody | needs review | full #736 custody acceptance | draft PR #791; `2a8239d` through `e3b8f91` | `b5ad8ec` freeze target | Credentials are handle-only in product settings, encrypted by the chassis vault, tenant-bound, restart-safe, and absent raw from DB/WAL/SHM. | #789 merged; #792 integrated; live WAL-backed 96-path zero-match fixtures and injected-secret negatives pass. | 2026-07-10 07:31 CEST | Run approved real-credential full custody scan. |
| [#733](https://github.com/zenod-ai/zenod/issues/733) | Ticket worker | Epic worker | Z-MT-3 tenant-scoped UI panels | needs review | full #736 browser acceptance | draft PR #791; `73211a7` | `b5ad8ec` freeze target | Tenant sees only its Repo/Ingest/Usage surfaces and D18 receipt branch. | Web build/test pass; retained browser checkpoint is informative but not final full evidence. | 2026-07-10 07:31 CEST | Capture fresh Repo/Ingest/Usage panels for all three approved tenants. |
| [#737](https://github.com/zenod-ai/zenod/issues/737) | Ticket worker | Epic worker | Z-MT-4 reversible full-state migration | needs review | approved #736 migration rehearsal | draft PR #791; `df1b14f`, `7370302`, `5122dd1`, `17b4f0f` | `b5ad8ec` freeze target | Dry-run/apply/verify/idempotency/rollback, same-token continuity, real standalone credential conversion, secure cleanup, and Z-5 recovery. | Migration and credential-conversion suites pass; no live tenant mutation performed. | 2026-07-10 07:31 CEST | Execute the full synthetic lifecycle and Z-5 restore on the immutable candidate. |
| [#792](https://github.com/zenod-ai/zenod/issues/792) | Ticket worker | Epic worker | Z-MT-7 standalone credential custody migration | needs review | full #736 migration/custody acceptance | isolated `/Users/jordi/Documents/GitHub/wt-792`; transplanted as `17b4f0f` | `b5ad8ec` freeze target | Preserve exact handles while importing through encrypted `TenantVault`; fail closed; resumable scrub; secure key/table/WAL cleanup. | Build/typecheck and security review pass; current implementation is on #791. | 2026-07-10 07:31 CEST | Prove apply/restart/rollback/Z-5 with the approved full run. |
| [#797](https://github.com/zenod-ai/zenod/issues/797) | Ticket worker | Epic worker | Z-MT-5 runtime image packaging gate | needs review | exact frozen image refresh | draft PR #791; `1946f9d` plus `f3f505f` proof hardening | `b5ad8ec` freeze target | Runtime contains chassis package; pre-push OCI revision, boot, anonymous SPA/assets, protected API, and authenticated health SHA all pass. | `f3f505f` image index `sha256:475c1020...` passed publish run 29071773126; final freeze digest pending. | 2026-07-10 07:31 CEST | Republish final frozen head, then retain its digest. |
| [#736](https://github.com/zenod-ai/zenod/issues/736) | Tester | Epic worker / browser tester | Z-MT-5 definitive joint proof | blocked with required input | two Jordi full-mode approvals | draft PR #791; `/Users/jordi/Documents/GitHub/wt-736-definitive` | `b5ad8ec` freeze target | Fresh T1/T2/T3 commit/marker/browser isolation, self-host parity, migration/restore, D18, and exact custody receipts. | Code-readiness closure passed; external full mode has not run. | 2026-07-10 07:31 CEST | After both approvals, run the complete immutable-image evidence package. |
| [#738](https://github.com/zenod-ai/zenod/issues/738) | Ticket worker | Epic worker; Epic 3.7 independent tester | Z-MT-6 cutover and retirement | blocked at gates | accepted #736 plus separate production approvals | runbook on draft PR #791 | `b5ad8ec` freeze target | Accepted Gate-2 input, reversible approved cutover, watchdog, and separately approved retirement. | Candidate digest `33c792c...` recorded with no apply path; no Gate 1/Gate 2 or retirement authorization. | 2026-07-10 07:31 CEST | Keep withheld until #736 passes; then request the separate production decisions. |

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
| Full real commit-receipt proof | Jordi | #789 merged and deterministic #736 rerun is green | Two explicit approvals: allow disposable marker/schema pushes to `AlfaBlok/test_evals`, `AlfaBlok/react_test1`, and `AlfaBlok/zenod-cloud-test-vault-4ptjqj`; mint/provide one capped non-production OpenRouter key (recommended $1) through a secret channel | Contract mode and deterministic tests; no production infrastructure mutation |
| Epic 3.7 Gate-2 retirement input | Jordi | #736 passes after #789 | Approve candidate digest `33c792c909a3c039d447bed8b597735380208f67f3e72b925913d0f5ee10dd40`, window, archive verification, and rollback plan | Independent 3.7 testing with no apply path |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Keep #791 rebased on current `main` and preserve the no-`packages/mcp-chassis/**` boundary.
- Obtain the two narrow non-production approvals; do not infer them from the broader delivery mandate.
- Hold #738 Gate-2 input and every live migration/DNS/Dokploy/archive/cleanup/retirement mutation until #736 passes and the later production gates are separately approved.

## Worker Queue

- Needs review on #791: #733, #734, #735, #737, #792, #797.
- Blocked with exact input: #736 on the two non-production approvals; #738 on accepted #736 plus separate production approvals.

## Tester Queue

- #736: execute the definitive immutable-image three-tenant browser/MCP/restart/migration/restore/custody proof immediately after the two named approvals.

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
| 2026-07-10 | Three-tenant browser and parity | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | in-app Chromium 1280x720; hosted/self-host/migrated | login, reload, Vault/Transcription/Costs, T3 URL spoof | checkpoint pass; acceptance fail | JPEG evidence retained as `.jpg`; clones fail, Ingest not captured, Usage empty, no commit/marker receipts |
| 2026-07-10 | Encrypted world-key custody | `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67` | fresh hosted tenant; byte scan | set synthetic GitHub credential, scan tenant DB/WAL bytes | fail / release blocker | raw world credential in `vault.sqlite-wal`; bearer scan clean; #789 anchored to #780 |
| 2026-07-10 | Chassis encrypted custody dependency | main `3062022938bb3dd26427fd820d174f29022fd7d1` | Epic 3.1 PR #794 / #796 | 82 chassis tests, migration/fail-closed contract, CI | pass / dependency closed | #789 closed; external stable 32-byte key contract reconciled |
| 2026-07-10 | Standalone credential continuity | rebased candidate `17b4f0f` | isolated #792 worktree and #791 | build/typecheck, migration/security suites, restart and cleanup cases | pass / code ready | #792 implementation and independent security review |
| 2026-07-10 | Definitive code-readiness closure | pre-rebase equivalent `e3a264b0479bff082d435f825f9e9a36f87b7294` | local Node 22 + GitHub CI | root build/typecheck/test, 228 script tests, 15 focused proof tests, independent audit | pass / not full acceptance | CI 29071143424; exact 96-path custody receipts; missing-path and injected-secret negatives |
| 2026-07-10 | Immutable runtime image | pre-rebase equivalent `e3a264b0479bff082d435f825f9e9a36f87b7294` | GHCR publish workflow | pre-push OCI revision, boot, `/healthz`, tenant-auth product health, anonymous root/assets, protected API | pass / superseded by rebase | run 29071254538; index `sha256:98e3ae1b4a3b9d8b7bbd47624379a9d1fd70cd98f2fe80c5b1d5017e02546683` |
| 2026-07-10 | Current-main freeze preparation | candidate code head `f3f505f517e49f695171973d3ae180163ee57029` | `/Users/jordi/Documents/GitHub/wt-736-definitive` | verified CI/image on `d3137a5`; prepare one final rebase onto `main@b5ad8ec` | pass / exact frozen identity refresh pending | intervening main changes are Epic 3.7 documentation PRs #798 and #799 only |

## Handoff Journal

### 2026-07-10 - Epic worker - Code readiness closed; full evidence approval gate reached

Context: #789 is merged in chassis custody, #792 is integrated in Zenod-owned code, #797 prevents broken runtime publication, and independent audit closed the prior identity/custody P1/P2 findings. Candidate `f3f505f` on the `d3137a5` base passed CI and immutable-image smoke. Epic 3.7 then froze main at `b5ad8ececc7b09425eaac6bd9255e2b667af46f4` after one additional docs-only PR #799; this steward reconciliation precedes the single final rebase/freeze requested by 3.7. The accepted code closure includes 228 script tests and 15 focused proof tests over 32 live WAL-backed databases and 96 required DB/WAL/SHM paths.
Next: refresh CI and the immutable image for the exact reconciled head. After Jordi explicitly approves the three named disposable repository writes and one capped non-production OpenRouter key, execute all fresh full-mode, browser, self-host, migration/idempotency/rollback, Z-5 restore, and custody evidence. Keep #738 and every production action withheld until accepted proof and separate approvals.
Risks: external full mode has not executed; retained `2d8509e` browser artifacts are checkpoint evidence only. No real repository marker, nonempty Usage, full self-host commit, or full restore package may be claimed yet.
Assignment identity: Codex task `019f4933-5245-7651-9018-9ae342f587ac`
Branch / latest code commit: `codex/epic-3.2-definitive-pilot` / `f3f505f517e49f695171973d3ae180163ee57029` before this steward-only reconciliation
Last verified: 2026-07-10 07:31 CEST
Links: #733, #734, #735, #736, #737, #738, #789, #792, #797, draft PR #791

### 2026-07-10 - Epic worker - Definitive pilot blocked on encrypted chassis vault

Context: the new issue worktree `/Users/jordi/Documents/GitHub/wt-736-definitive` replayed the complete 3.2 product series onto reconciled main `476e026`, whose executable chassis is `ba533b3`. Product commit `2d8509e` passed the full build/typecheck and automated suite, three-tenant bearer/session/MCP/rotation proof, hosted/self-host restart, reversible unchanged-token migration, D18 zero-double-STT checks, and browser reload/isolation evidence. The final custody scan found a raw synthetic GitHub credential in the chassis-owned `vault.sqlite-wal` while all bearer scans remained clean.
Next: Epic 3.1 owns #789 as a Proposed Cross-Spine Update anchored to #780. After its exact merged main SHA is returned, rebase this worktree and repeat the entire proof from fresh data. If green, post exact accepted evidence to #736 and provide the recorded Epic 3.7 candidate digest to #738 as Gate-2 input.
Risks: encrypted world-key custody is not met until #789 lands; current standalone credential handles are not proven readable after file-copy migration until #792 lands; the retained run is contract mode only and lacks commit/marker, Ingest/Usage, full self-host, full migration/rollback, immutable image, and Z-5 restore evidence. Full mode needs the two named Jordi approvals. No production migration, DNS, Dokploy, archive, or retirement action is authorized.
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

- No unresolved code-design question blocks #736. The only immediate inputs are the two explicit non-production approvals listed in Human Gates.
- Production tenant order, migration window, rollback checkpoint, archive verification, DNS changes, and retirement remain later Jordi decisions owned by #738.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Mark Z-1/ZD-6/ZD-10 deployment model superseded by this epic once Z-MT-6 lands. | this spine | Epic 2.3 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Reconcile C-4 with pilot evidence: the Zenod SQLite set needs a canonical WAL + 30s busy-timeout contract and tenant media paths, while tenant identity must come from verified token/session context rather than request data. | #734 and #736; merged chassis line | Epic 3.1 steward | resolved via #780/#796 |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Reconcile C-6 with the pilot session shape: tenant id is carried in a tenant-secret-signed session and the root front controller fails closed for unbound product APIs. | #733/#734; merged chassis line | Epic 3.1 steward | resolved via #780/#796 |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Add a pre-SPA authenticated custom-route extension to `createUnit` that supplies tenant-bound context, plus a durable chassis-owned tenant provisioning store with restart persistence and same-token migration continuity. | [#768](https://github.com/zenod-ai/zenod/issues/768), #769, #771 | Epic 3.1 steward | resolved in `145e6f3` and later main |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | Encrypt generic tenant-vault values at rest with a stable external per-unit key and recoverable legacy migration. | #789 anchored to #780 | Epic 3.1 steward | resolved by PR #794 and reconciled by #796 |

## Appendix

- Current SQLite set (from `runtime.ts`): zenod, oauth, whatsapp, ingest, tasks, execution, journeys, usage, notifications.
