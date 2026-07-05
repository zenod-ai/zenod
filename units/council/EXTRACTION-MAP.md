# The council guy — EXTRACTION MAP (ticket W-B)

File-level map of the brain **as it exists today**, grounded in real code (paths relative to repo
root). Verdict per file: **MOVE** (whole → council unit), **SPLIT** (part moves, part stays),
**STAY** (belongs to the ring or Zenod, not the guy). RD-2 name OPEN (`<COUNCIL_NAME>`). RD-4 split
STAGED — nothing physically moved this iteration; this is the blueprint the eventual
`git filter-repo` follows.

## The brain today

The council guy runs as the fused **`console`** agent: one root image, `AGENT=console`
(`packages/server/src/agent.ts` → `CONSOLE_AGENT`, vaultless). Its intelligence is the engine in
`packages/core` driven by the server shell in `packages/server`. The channel adapters
(WhatsApp/Telegram) are fused into the SAME server `Runtime` object — that fusion is the coupling to
cut.

## Core brain files

| File | Verdict | Notes |
|---|---|---|
| `packages/core/src/engine/engine.ts` (`createEngine` → `BrainEngine`, `handleTasking`, `chat`) | **MOVE** | THE brain loop. Import-clean of adapters (grep for `whatsappGateway`/`Baileys`/`makeWASocket` = 0 hits). `whatsapp`/`telegram` appear only as `Surface` **string** discriminants for provenance/`origin:` labels (lines ~66, ~519, ~781, ~787), not adapter calls. Takes `llm` + `peerTools` **injected** — already the right shape. Moves whole into the council unit. |
| `packages/core/src/taskingPolicy.ts` | **MOVE** | Reply-grounding / `reconcileTaskingReply` / peer-mutation guard / approval-token logic — pure brain honesty layer, no adapter imports. Moves whole. |
| `packages/core/src/replyGate.ts` | **MOVE** | Reply gate the engine applies (`applyReplyGate`, imported by engine.ts:48). Brain-side. |
| `packages/core/src/approvalTokens.ts` | **MOVE** | Standing-draft/approval token store used by taskingPolicy + engine (engine.ts:49). Brain-side. |
| `packages/core/src/engine/evidence.ts` | **STAY (shared lib)** | Evidence/receipt helpers — used by the vault (Zenod) too. Belongs in the published shared lib, imported by both, not owned by the council guy. |
| `packages/core/src/vault/*`, `packages/core/src/ops/*`, `packages/core/src/git/*` | **STAY (Zenod)** | Vault scan/lint/search/get + WriteQueue + VaultRepo. The council guy is **vaultless**; these are Zenod's. Today `engine.ts` imports them directly (lines 28–36) — that is the biggest coupling to cut: those become **seam calls to Zenod** (see §Couplings). |
| `packages/core/src/llm/*` (`types.ts`, `aisdk.ts`) | **SPLIT** | `PeerTools`/`BrainLlm`/`Classification` types + the AI-SDK driver: brain-side, MOVE. But `Surface`/`TaskingSurface` (`packages/core/src/types.ts`) is shared vocabulary → shared lib. |

## Server-shell brain files

| File | Verdict | Notes |
|---|---|---|
| `packages/server/src/agent.ts` | **SPLIT** | `AgentDefinition` + `resolveAgent` are the shared shell. `CONSOLE_AGENT` is the council guy's identity — a **new `COUNCIL_AGENT`** (vaultless, peer-tools-only zenod/archus/epaminon, turn-preamble) must be added here; **name blocked on RD-2**. `ZENOD_AGENT`/`ARCHUS_AGENT`/etc. STAY with their own units. |
| `packages/server/src/mcp.ts` | **SPLIT** | Hosts BOTH Zenod's memory tools (`search_memory`/`get_memory`/`store_memory`/`get_task_result` — STAY with Zenod) AND the brain door `ask_brain`/`task_brain` (mcp.ts:695/715, calls `engine.handleTasking`, mcp.ts:734) — that door MOVES and is renamed `chat_with_<COUNCIL_NAME>` (LONG-primary per SEAM-SURFACE.md). The `epaminon.*` tool declarations here are dispatch surface → see runtime.ts. |
| `packages/server/src/runtime.ts` | **SPLIT — the fusion point** | The `Runtime` class instantiates `createEngine` (line 381) **and** `new WhatsAppGateway`/`new WhatsAppStore`/`new TelegramGateway` (lines 211–225) in the SAME object, and builds `peerTools` + console-journey tools (lines 364–365, `buildPeerTools`:603, `buildConsoleJourneyTools`:684) + the Epaminon dispatch (`queueExecution`:1571, `runEphemeralTask`:1789, `POST /api/exec/enqueue`:1646). The brain-construction + peer-tools + dispatch half MOVES; the gateway-construction half STAYS in the ring. Cutting this class in two is the core W-B work. |
| `packages/server/src/peerClient.ts` (`callPeer`, `callPeerTool`, `callPeerWithArgs`, `PeerConfig`) | **MOVE (or shared lib)** | The MCP client the guy uses to reach Zenod/Archus/Epaminon over the seam. Pure `@modelcontextprotocol` client, no adapter deps. MOVE with the guy (candidate for shared lib since every guy needs it). |
| `packages/server/src/{createIssueRunJourney,ephemeralJourney,parallelIssueJourney,oneOffExecution,journeyStore,journeyContracts,journeyMonitor,journeyAuthorityReconciler}.ts` | **MOVE** | The console-journey machinery = the council guy's durable async-dispatch bookkeeping (create-and-run, run-ephemeral). These implement the guy→Epaminon dispatch he owns. MOVE with the guy. |
| `packages/server/src/executionLane.ts`, `executionQueue.ts`, `executionStore.ts`, `executionDeliverable.ts`, `executionIngestSweep.ts`, `executionTranscript.ts` | **STAY (Epaminon)** | The execution QUEUE is the state authority of the **executor** (Epaminon), not the council guy (runtime.ts:186 comment: "Null on every other agent"). The council guy only **dispatches** into it over the seam; he does not own it. STAY with Epaminon. |
| `packages/server/src/{whatsappGateway,whatsappStore,whatsappConfig,telegramGateway,telegramConfig,channelAudio,voiceArchive,transcribe,conversationTranscript,transcriptStore,sessionLog}.ts` | **STAY (ring / Phylax)** | All channel/adapter/media code. **No council-guy image may contain any of these** (acceptance criterion). They belong to W-A (ring-core + Phylax). |
| `packages/server/src/{app,main,auth,index,runtime}.ts` shell wiring | **SPLIT** | The generic HTTP/MCP shell (`app.ts`, `main.ts`, `auth.ts`) is shared scaffold every unit reuses; the council-specific wiring inside `runtime.ts` moves (above). |

## Couplings that MUST be cut (file:symbol)

### A. Brain → channel/adapter code (must become zero — cut entirely)
- `packages/server/src/runtime.ts` → `import { WhatsAppGateway } from "./whatsappGateway.js"` (line 73),
  `WhatsAppStore` (line 74), `TelegramGateway` (line 75), `normalizeWhatsAppIdentifier` (line 77).
  The `Runtime` ctor builds `this.whatsapp` / `this.whatsappStore` / `this.telegram` (lines 211–225)
  in the same object as `createEngine`. **Cut:** split `Runtime` so the council build never constructs
  or imports a gateway. The engine itself is already clean — the fusion is only in this server class.
- `packages/server/src/runtime.ts` → `(surface, text) => surface === "telegram" ? this.telegram.notifyOwner(text) : this.whatsapp.notifyOwner(text)` (line 279): a notify callback wired straight into the gateways. In the split, "notify the user" becomes a seam call **up to the ring** (`send_to_user`), never a direct gateway call from the guy.

### B. Brain → Zenod internals (must become seam calls to Zenod)
- `packages/core/src/engine/engine.ts` imports Zenod-owned modules directly instead of over the seam:
  - `../vault/config.js:loadBrainConfig`, `../vault/immutability.js:checkEvidenceImmutability`,
    `../vault/lint.js:lintVault`, `../vault/pages.js:scanVault`, `../vault/github.js:githubUrl`,
    `../vault/files.js` (lines 28–39)
  - `../ops/get.js:getNote`, `../ops/search.js:searchVault` (lines 33–34)
  - `../git/queue.js:WriteQueue`, `../git/vaultRepo.js:VaultRepo` (lines 35–36)
  - **Cut:** the council guy is vaultless — every one of these becomes a `callPeer(zenod, …)` seam
    call (`search_memory`/`get_memory`/`store_memory`), NOT an in-process import. This is the memory
    verbs "go through Zenod over the seam" acceptance criterion made concrete. (The vault-owning
    half of the engine stays with Zenod; the council guy keeps only `handleTasking`/`chat` + peer
    tools.)
- `packages/server/src/mcp.ts` co-locates Zenod's memory tools with the brain door in one server
  (`createMcpServer`) — the split gives Zenod its own MCP server and the council guy his own; the
  brain door consumes Zenod's over the seam.

### C. Dispatch seam gaps (SEAM-SPEC items 10–11 not yet real)
- `packages/server/src/runtime.ts:queueExecution` (line 1571) and the `POST /api/exec/enqueue` body
  (line 1646) send `{ target, title, context, repo }` — **no `origin_ticket_id`, no `depth`**. Grep
  of `packages/server/src` for `origin_ticket_id`/`originTicketId`/`depth` = **0 hits**. To conform
  to RD-3 (depth ≤1, origin propagation) the enqueue payload + Epaminon's `/api/exec/enqueue`
  receiver must gain both fields, and the council door's completion event must thread them. **This is
  a coupling/gap ticket, flagged for W-D/planner — not a rename.**

## One-line honesty

Blueprint only: the brain files are import-clean enough that the engine itself moves whole, but the
real work — unfused in this iteration — is splitting `Runtime` away from the channel gateways,
turning `engine.ts`'s direct `vault/`/`ops/`/`git/` imports into Zenod seam calls, and adding the
missing `origin_ticket_id`/`depth` dispatch fields; none of that code was moved (RD-4 staged).
