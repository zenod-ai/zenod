# #1320: production scenarios using existing tenant/MCP lifecycle

One selected frozen scenario/trial runs per separately approved disposable pair, using the existing fixture memories and chat/interrupted_filing action types. Other35 outcomes remain UNRUN in that receipt; root consolidates unique row keys across the fixed36 ledger. This is executable test preparation, not production acceptance. No model judge, fixture/expected-answer changes, provisioning API, reset engine or product patch. Root provisions and operates after exact release review. Existing B05 fault injection remains isolated; no production kill/CAS is provided.

## Existing seams reused

- Same production service, existing control-plane `POST /api/tenants`, tenant settings API, MCP SDK StreamableHTTP transport, `chat_with_zenod` with durable idempotency, `get_task_result`, `get_memory`.
- Existing deployed SqliteTenantStore `setTenantStatus(id, 'deleted')` for exact new-tenant revocation, not database row deletion. Protected read-only SQLite snapshots and queue drain follow the earlier private isolated lifecycle. A timestamp/hash mismatch prevents cleanup.
- GitHub API numeric repository identity + creation timestamp + private flag before archiving ONLY the newly created synthetic repo. No repository deletion, reset, force-push, owner tenant changes, model experiment or shared-key mutation.
- Bearers only arrive through stdin and remain lexical memory. No provider key is needed by this runner; parent installs the authorized existing key into ONLY the new test tenant before invoking. Do not pipe secrets through shell tracing or place them in arguments/env/files.

## Root preparation (one pair, lazy)

1. Create one **new** private synthetic repository named `m2-...` using existing GitHub tooling. Record its returned numeric `id`, exact owner/name and `created_at`. Refuse collision/reuse. Materialize unchanged fixture locally:

   `node scripts/zmr-pipeline-eval/production/seed.mjs /private/new-empty-seed`

   This creates a new directory only (refuses existing), with byte-identical seedPages, Index and config from the isolated harness. Use ordinary Git commands to publish these files to the NEW repo's main; record commit. Do not use branch-only isolation: deployed Runtime.getRepo ignores vault_branch.
2. Existing control-plane POST `/api/tenants` with new `tenantId:m2-...`, synthetic name, active status and short `expiresAt`. Record actual returned identity and exact created_at/token hash using read-only deployed store inspection. An existing row is not eligible. Keep the returned bearer in protected memory/pipe. No billing/account/phone/Drive setup needed or allowed in this memory-only test.
3. Configure that new tenant with existing `/api/settings` and `/api/vault/repository`: exact approved model fields and authorized provider/GitHub credentials. Then verify `/api/vault` clone identity and lint. The model key is not globally modified. Do not connect Drive/phone/peers. Record empty tenant jobs/state, exclusive use, schema hash and module hashes. Fresh tenant/repo per further trial; do not reset this one.
4. Assemble private0600 manifest in private0700 directory, with returned object IDs rather than guessed cleanup IDs. Fields below. Place reviewed runner alongside its unchanged basics fixture/rubric and source imports inside exact container. No rebuild required.

## Manifest / execution

Required public manifest fields:

```
version: 1
origin: https://cloud.zenod.dev
key: B01:1                         # B01..B12, trial1..3
candidateSha: <exact40hex>
imageDigest: sha256:<64hex>
observedRelease: {sourceSha, imageDigest, checkedAt:<epoch ms within5min>}
tenant: {id:<returned m2-id>, createdAt:<exactSQLiteinteger>, tokenHash:<sha256>}
repo: {id:<returned numericID>, owner, name:<m2-name>, private:true, createdAt:<GitHubcreated_at>}
fixtureSha256: <exact bytes of basics/fixture.json>
rubricSha256: <exact bytes of basics/rubric.json>
seedCommit: <actual published seed SHA>
models: {model_classify, model_classify_reasoning_effort, model_ask, [model_ask_reasoning_effort], [model_classify_provider_order]}
runtimeRoot: /app
dataDir: /data
receiptPath: /private/new-receipt.json
moduleHashes: <sha256 map of the five required compiled files in operator.mjs>
tenantSchemaSha256: <hash JSON.stringify rows SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name>
exclusiveWindow: <manager custody receipt ID>
exclusiveUntil: <epochms>
noOtherTargetRequests: true
maxToolCalls: 40                   # hard tool limit; five minimum
maxExposureUsd: <parent-approved amount>
reservedTurnExposureUsd: <conservative reviewed allowance per store/chat (including background filing)>
costBoundRationale: <known turn/round/token/provider prices and automatic retry bounds>
```

**Deployed-snapshot binding.** A cell is graded only if its `candidateSha`/`imageDigest`/`observedRelease` and its `models` all match the deployed snapshot. Capture `models` from the live owner settings with `modelSnapshot()` in `snapshot.mjs` (the `model_*` keys actually set) and configure the disposable tenant to the same values; `operator.mjs` fails closed when any manifest model differs from the tenant's settings, so a cell can never silently run a different model configuration than production. Unset keys are omitted, not defaulted.

The parent must approve the conservative reservation before dispatch; it is **not** a server-side hard dollar limit or provider-request counter. Existing tenant tool quota cannot establish a token/dollar cap. This runner reserves before each frozen store/chat action (including the duplicate store request), stops if their summed reservations exceed maxExposureUsd, bounds40 MCP calls/12 polls per job and operator window, and never retries a chat after a timeout. It does not obtain private provider usage or report zeros: actual cost and provider request count remain null until root reconciles real usage evidence; reservation remains. Keep all runs in the parent aggregate ledger; a new manifest is not a budget reset. No dedicated provider key or key-management workflow is required.

Protected stdin JSON has ONLY `{tenantToken, githubToken}`. Existing protected operator plumbing supplies it; never print it. Run inside the exact public container:

```
node /private/reviewed/scripts/zmr-pipeline-eval/production/operator.mjs /private/manifest.json
node /private/reviewed/scripts/zmr-pipeline-eval/production/operator.mjs /private/manifest.json --dispatch
```

Default check-only reads SQLite/GitHub, validates exact seed/lint/ownership, sends no MCP/model calls and makes no configuration mutations. Dispatch refuses an existing receipt. When a durable chat result captured a note, `stored.organization.jobId` is required and drained before raw readback/next turn. Seed memories use store_memory with exact content/contentType/capturedAt, stable sourceId/idempotencyKey and verbatim:true. Fresh conversational recall still uses chat, never ask_brain. It records full receipts and fixed36 rows for existing semantic review templates; RECORDED does not mean PASS. Custody gates verify exact raw inputs, capture/job counts, unique evidence references, published revision and unchanged read-only-case pages; semantic review must still examine filed effects and truthful acknowledgement.

## Cleanup / interruption

Successful or failed test first closes its SDK session and proves local queue drain. Any uncertain transport disables automatic cleanup (timeout is not cancellation). Save remains cleanup_pending, lock retained; root must independently establish remote request termination before recovery. Existing file is never reused to rerun the test. Recovery:

```
node /private/reviewed/scripts/zmr-pipeline-eval/production/operator.mjs /private/manifest.json --dispatch --cleanup-only
```

Root first inspects and removes ONLY this receipt's stale lock after proving prior operator terminated. Recovery uses the identical manifest binding. If its observedRelease timestamp expired, supply `--release-proof /private/fresh-release.json` containing a fresh independently reviewed {sourceSha,imageDigest,checkedAt}; only observation freshness changes. Source/image must still match the original manifest, and actual runtime SHA/module hashes are verified. No target, settings, fixture or budget rebinding is permitted. Partial provisioning can use cleanup-only without a test receipt; only manifest-owned returned objects are eligible, absent objects are tolerated. No chat ever runs in cleanup-only.

Cleanup clears only this new tenant's OpenRouter/GitHub credential settings, sets its status deleted, archives exact repo, verifies bearer401. Tenant state/jobs/audit and archived repository remain retained; deletion of access does not erase data. Cleanup is idempotent for already-deleted tenant/already-archived repo. If a deleted tenant still has either credential setting, cleanup remains pending and explicitly unverified: this helper does not bypass authentication with direct secret-row deletion. No shared credential is revoked. Failed ownership/drain/revocation remains attention; never claim full cleanup.

## Offline checks and limits

`node --test scripts/zmr-pipeline-eval/production/*.test.mjs`

Mocks test operator boundaries, not model semantics or live provisioning. Concrete adapter test uses a temporary actual SQLite DB plus mocked HTTP and checks repeated archive/changed-owner refusal. Existing candidate/library runtime compatibility still requires manager read-only preflight; no successful live run is implied. All12 frozen action sequences have offline dispatcher coverage. Production B05 performs same-key replay and records its interruption proof as ISOLATED_CANDIDATE_REQUIRED / UNMEASURED. Root must link matching isolated fault evidence rather than grade this as full B05 production proof. Full aggregate reporting must use the same36 keys and preserve all earlier failed/unfinished receipts; the existing isolated report cannot magically declare production acceptance from a single receipt.

Known-token echo protection: durable serialization refuses either in-memory credential anywhere in returned data before writing; no raw exception text is printed. Last planned receipt/lock remains recoverable. Missing/noninteger release timestamps fail closed.

Dispatch preflight requires existing settings and jobs SQLite databases; absent databases are not interpreted as an idle runtime. Cleanup-only may inspect an incompletely initialized pair, but reopens any newly appearing database on each check so newly queued work blocks cleanup. Final review-template hashes are produced after outcome latency and cleanup status updates. Seed raw readback must preserve exact source/sourceId/contentType/capturedAt in addition to content/ref; chat capture timestamps are not invented.

## Cost, tokens, time and report

`cell.mjs` snapshots the disposable tenant's durable usage ledger (`/data/<tenant>/usage.sqlite`) into `usage.json`: per-operation calls, input/output/cached tokens and server-computed cost, plus a per-call timeline. The MCP call start/finish from the operator receipt give per-cell timing. Provider-billed cost is not returned on this path; the ledger cost is the server's pricing × tokens.

`expectations.json` is the frozen expected-behaviour checklist (literals, forbidden output, conditions, citation requirement) used as a manual-scoring review aid — not an auto-grader. Keep it stable across prompt/model changes.

Assemble and render:

```
node collect.mjs --cells <run-cells-dir> --meta <meta.json> [--reviews <reviews.json>] --out <run.json>
node report.mjs --runs <baseline.json>,<run.json> --out <report.html> [--title "..."]
```

`reviews.json` carries the manual semantic verdicts keyed by cell (`{"B01:1":{"verdict":"PASS","checks":[...],"rationale":"..."}}`). The report shows expected-vs-actual per cell, the manual score, tokens, time, actual + reserved cost, a per-operation model breakdown and — with two runs — a baseline-vs-current delta table for comparing prompts or models.
