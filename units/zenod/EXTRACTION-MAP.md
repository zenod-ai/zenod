# Zenod — EXTRACTION-MAP (file-level, grounded in real code)

RD-4 status: **STAGED — split trigger has NOT fired.** This is a blueprint, not a
performed move. No fused code is ripped apart this iteration; the live Console stays
buildable. Below, each file is tagged **MOVE-WHOLE** (Zenod owns it outright),
**SPLIT** (part is Zenod's, part stays with another unit/shared lib), or **STAY**
(belongs to another unit or the shared lib, Zenod only calls it over the seam).

Zenod = the memory owner: ingest/digest, evidence+meaning, citations + the git repo
(vault) behind it, and the ONLY holder of the repo token.

---

## A. Core engine (`packages/core/src`) — the memory brain + git

| File | Verdict | Why |
|---|---|---|
| `engine/engine.ts` | **MOVE-WHOLE** | The librarian pipeline (store/search/get/ask), classify+compose loop, evidence+meaning filing. Zenod's heart. |
| `engine/evidence.ts` | **MOVE-WHOLE** | `appendEvidence`, immutable Log entry construction. |
| `ops/get.ts`, `ops/search.ts` | **MOVE-WHOLE** | Deterministic search + note read over the vault. |
| `vault/*` (config, files, frontmatter, github, immutability, lint, migrate, pages, cleanSlate) | **MOVE-WHOLE** | The vault format + integrity checks + provenance URLs — memory-specific. |
| `git/vaultRepo.ts` | **MOVE-WHOLE** | The git contract (clone/pull/one-commit-per-memory/push-retry). **Sole consumer of the repo token** (via its `token`/`tokenProvider` options). |
| `git/queue.ts` (`WriteQueue`) | **MOVE-WHOLE** | Serialized write lane so concurrent stores land as clean commits. Memory-specific. |
| `state/sqlite.ts` (`SqliteStateStore`) | **SPLIT** | Conversation/state store — a generic base-agent concern used by every unit. Move the shared shape to the **published shared lib**; Zenod consumes it. |
| `llm/aisdk.ts`, `llm/types.ts` | **STAY (shared lib)** | Generic LLM plumbing every guy/unit uses. Zenod depends on the shared lib, not the reverse. |
| `connections/github.ts` (`installationToken`, `installationTokenForRepo`) | **SPLIT** | GitHub App/PAT resolution. Zenod needs the **repo-scoped** resolver for the VAULT repo; Archus/Epaminon need it for backlog/PR repos. The resolver is shared-lib; the *authority to hold the vault token* is Zenod's alone. |
| `backlog.ts` | **STAY (Archus)** | Backlog selection — Archus's domain, not memory. Reads `GITHUB_TOKEN` for backlog, not the vault. |
| `taskingPolicy.ts`, `replyGate.ts`, `approvalTokens.ts`, `toolKinds.ts` | **STAY (shared lib / guy)** | Cross-cutting agent policy; not memory-owned. |
| `index.ts` | **SPLIT** | The `zenod` package barrel. Post-split, memory exports (createEngine, VaultRepo, WriteQueue, searchVault, getNote, vault/*) form Zenod's public lib; the rest re-homes to the shared lib / other units. |

## B. Server (`packages/server/src`) — the ingest/digest + MCP surface

| File | Verdict | Why |
|---|---|---|
| `ingestQueue.ts` | **MOVE-WHOLE** | Background ingest worker: download → transcribe → **file (store)** → archive. The intake pipeline. |
| `ingestStore.ts` | **MOVE-WHOLE** | Ingest job rows/state (survives restart, marks interrupted). |
| `ingestWatchdog.ts` | **MOVE-WHOLE** | Recovers stuck/interrupted ingest jobs. |
| `filingReceipt.ts` | **MOVE-WHOLE** | Formats a `StoreResult` into the filing receipt (evidenceRef/pages/commit). |
| `storageReceipt.ts` | **MOVE-WHOLE** | Storage receipt shaping — the mutating-tool handle. |
| `drive.ts`, `driveFolders.ts`, `driveTools.ts` | **MOVE-WHOLE** | Drive source/archive: raw-archive-first, then ingest. Memory intake. (Drive OAuth is a vault/world key held by the memory unit for archiving — distinct from outbound keys.) |
| `voiceArchive.ts`, `transcribe.ts`, `channelAudio.ts` | **SPLIT** | Transcription: per RD-1 the *media pipeline* (archive-raw-first, pluggable STT) lives in **ring-core**; Zenod ingests the resulting transcript/text. Keep the ingest half; the raw-capture/STT half moves to the ring. |
| `mcp.ts` | **SPLIT** | Registers ALL tools for the fused Console. Zenod owns the handlers for `store_memory`, `search_memory`, `get_memory`, `ask_brain`, `get_task_result` (+ ingest/digest). The backlog/execution/outbound/notifier tool registrations STAY with their units. |
| `mcpToolSchemas.ts` | **SPLIT** | Same partition as `mcp.ts` — memory-tool schemas move, others stay. |
| `taskJobQueue.ts`, `taskJobStore.ts` | **SPLIT** | The async-job queue backing LONG tools. Zenod's LONG tools (store/ask) need it; it is also used by task_brain/run_task. Shared-lib base; each unit wires its own jobs. |
| `runtime.ts` | **SPLIT** | The per-agent runtime. `getRepo()` (lines 296–307) + the vault engine wiring are Zenod's; the backlog/execution/peer wiring belongs to other units. **`getRepo()` is the sole vault-token read site — moves with Zenod.** |
| `settings.ts` | **SPLIT** | Central config map. `vault_repo`, `github_token`, LLM keys, Drive keys → Zenod's config surface; peer/backlog/outbound config → their units. Base `SqliteStateStore` import is shared-lib. |
| `agent.ts` | **SPLIT** | Agent registry. `ZENOD_AGENT` def is Zenod's; the others STAY with their units; `AgentDefinition` shape → shared lib. |
| `app.ts` | **SPLIT** | The HTTP app + all routes. Memory routes (+ `/api/provision`, `/api/health`) form Zenod's server; `/api/settings/test-github`, exec/backlog/notifier routes stay with their units. |
| `whatsappGateway.ts`, `telegramGateway.ts`, `whatsappStore.ts`, `whatsappConfig.ts`, `telegramConfig.ts` | **STAY (Ring/Phylax)** | Channel gateways — the ring's domain (W-A). They only `import type { BrainEngine, StoreResult }` from the `zenod` barrel; no Zenod internals. |
| `backlogRouter.ts`, `executionLane.ts`, `executionQueue.ts`, `executionStore.ts`, `oneOffExecution.ts`, `*Journey*.ts` | **STAY (Archus/Epaminon)** | Backlog + execution — other units. `executionLane.ts` reads `github_token` for **PR/issue** repos, NOT the vault (see §C). |
| `outboundTools.ts`, `outboundReceipt.ts`, `notifierTools.ts`, `notification*.ts`, `meshGateway.ts`, `peerClient.ts`, `pollPeerJob.ts` | **STAY (Callisthenes/Phylax/shared)** | Outbound/notify/mesh — not memory. |
| `main.ts` | **SPLIT** | Boot entrypoint. Reused as-is with `AGENT=zenod` today; post-split Zenod ships its own trimmed `main.ts`. |

---

## C. Cross-import scan (THE acceptance signal)

**Result: CLEAN.** No caller imports Zenod internals. Every consumer of Zenod's memory
brain reaches it through the **`zenod` package barrel** (`packages/core/src/index.ts`),
never a deep path.

- **Deep-path imports of core internals from outside core** (`from "zenod/…"` or a
  relative reach into `packages/core/src`): **NONE FOUND.**
  - `grep -rn 'from "zenod/' packages/server/src` → 0 hits
  - `grep -rn 'core/src|../../core' packages/server/src` → 0 hits
  - `grep -rn 'from "zenod/' apps units` → 0 hits
- **What the server DOES import from the `zenod` barrel** — all public, mostly
  `import type`, file:symbol:
  - `whatsappGateway.ts` : `type BrainEngine, type StoreResult`
  - `telegramGateway.ts` : `type BrainEngine`
  - `ingestQueue.ts` : `type BrainEngine`
  - `ingestStore.ts` : `type BacklogDigestResult`
  - `taskJobQueue.ts` : `type BrainEngine`
  - `taskJobStore.ts` : `type StoreResult, TaskingReply, WorkResult`
  - `filingReceipt.ts` : `type StoreResult`
  - `driveTools.ts` : `type DriveSourceTools`
  - `settings.ts` : `SqliteStateStore`  (value — re-home to shared lib on split)
  - `usageStore.ts` : `type LlmUsageReport`
  - `outboundTools.ts` : `VERSION, type PeerTools`
  - `meshGateway.ts`, `peerClient.ts` : `VERSION`
  - `testHarness.ts` : `conversationId, type BrainEngine, ChatToolEvent, SourceRef, Surface`
  - `mcp.ts` : `VERSION, type BrainEngine, CleanSlateResult, DriveSourceTools, StoreResult, TaskingReply, WorkResult` (+ github-issue types)
  - `runtime.ts` : the barrel bundle + `installationToken, installationTokenForRepo, editGithubIssue, mintExecutionIssue, setExecutionState`
  - `executionLane.ts` : `installationTokenForRepo`
  - `app.ts` : `conversationId, NoteNotFoundError, VERSION, CleanSlateResult` (+ barrel bundle)

  These are barrel imports, not internal reaches — the seam holds. On the physical
  split, the memory subset of the barrel becomes Zenod's lib and the rest re-homes to
  the shared lib; no consumer bypasses the seam today, so the split is a filter-repo,
  not a refactor.

---

## D. The repo token — read sites, and confirming ONLY Zenod should hold it

Two DIFFERENT GitHub authorities share the `github_token` setting today because the
Console is fused; the atomic topology separates them:

1. **The VAULT (memory) repo token — Zenod's alone (law 6b: "only Zenod the repo token").**
   - Read at **`runtime.ts:296-307` → `Runtime.getRepo()`**: reads
     `settings.get("vault_repo")` + `settings.get("github_token")` (or a GitHub App
     installation token via `installationTokenForRepo`) and passes it to
     **`VaultRepo.open`** (`packages/core/src/git/vaultRepo.ts:44` — `token` /
     `tokenProvider` options; embedded in the remote URL at
     `vaultRepo.ts:23 remoteUrlFor`). This is the ONLY path that writes the memory repo.
   - Setting names: `settings.ts:73 vault_repo → VAULT_REPO`, `settings.ts:75
     github_token → GITHUB_TOKEN`.
   - CLI mirror (single-process): `cli.ts:70/78 VAULT_REPO`, `cli.ts:88/185
     GITHUB_TOKEN` → `VaultRepo`. Same authority, dev path.
   - **Confirmed: only Zenod should hold the vault repo token.** `VaultRepo` is the
     sole writer of the memory repo, and `getRepo()` is its sole construction site
     with the token. Post-split, `github_token` (vault) lives in Zenod's config surface
     only; no other unit is provisioned with it.

2. **The BACKLOG / PR repo token — Archus / Epaminon's, NOT Zenod's.** Same env name
   today, different repos and different unit:
   - `executionLane.ts:51-56 githubToken()` — reads `github_token` for **PR/issue**
     repos (execution). Belongs to **Epaminon**.
   - `runtime.ts:876-898 githubTokens()` + `app.ts:1389` (`/api/settings/test-github`)
     — backlog/issue GitHub authority. Belongs to **Archus** (backlog owner).
   - `backlog.ts:64` — reads `GITHUB_TOKEN`/`GH_TOKEN` for backlog selection.
   These do NOT touch the vault; they must NOT receive the vault repo token, and the
   vault path must not receive theirs. The fused single-token overload is exactly what
   the split resolves: one token per authority per unit.

**Acceptance:** cross-import scan clean; Zenod's memory writes flow through one
`VaultRepo` fed by one `getRepo()` token read; the vault repo token is Zenod's alone
and no other unit's write path can reach the vault (they hold different tokens for
different repos). Attempts to write the vault from another path have no credential and
fail loudly — SEAM-SURFACE §"repo-write authority".
