# Ring — EXTRACTION MAP (file-level, grounded in real code)

Maps today's fused-Console code onto the Ring's responsibilities. **No code moved yet** — the
physical split is STAGED behind the RD-4 trigger. This is the map the eventual `git filter-repo`
follows. Verdicts: **whole** (moves intact to ring-core/phylax), **split** (deterministic parts move,
brain-coupled parts become seam calls), **stay** (belongs to a guy/unit, not the Ring).

Key structural fact grounding everything below: today the gateways call
`engine.handleTasking(...)` / `engine.describeImage(...)` / `engine.store(...)` **in-process**
(`whatsappGateway.ts:818,1090,1108,1144`, `telegramGateway.ts:316,320,346`, `app.ts:1837,2071`).
The brain (`zenod` package, `packages/core/src/engine/engine.ts`) is fused into the same process.
**The extraction = turn each of those in-process engine calls into a seam MCP call to the council
guy (default route) or a named guy, and split the deterministic half into ring-core.**

---

## 1 · Channel gateways → **phylax** box

| File | Responsibility | Verdict | Notes / cross-imports to sever |
|---|---|---|---|
| `packages/server/src/whatsappGateway.ts` (1272 LOC) | Baileys socket, pairing, inbound event → transcribe → reply | **SPLIT** | Baileys socket + pairing + `send`/media-download stay in **phylax**. The `engine.handleTasking`/`describeImage` calls (`:818,:1090,:1108,:1144`) become ring-core → guy **seam calls**. The transcribe/archive/reply-relay orchestration moves to **ring-core**. `import type { BrainEngine, StoreResult } from "zenod"` (`:14`) is THE cross-import to sever. |
| `packages/server/src/telegramGateway.ts` (573) | Telegram Bot API long-poll, inbound → reply | **SPLIT** | Same shape: socket/poll → phylax; `engine.handleTasking`/`describeImage` (`:316,:320,:346`) → seam calls; `import type { BrainEngine } from "zenod"` (`:3`) severed. |
| `packages/server/src/whatsappConfig.ts` | JID normalize, allow-list, phone mask | **whole** | Pure helpers; phylax + ring-core both use. No brain import. |
| `packages/server/src/telegramConfig.ts` | Telegram id normalize, allow-list | **whole** | Same. |

## 2 · The mailbox → **ring-core**

| File | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/whatsappStore.ts` (839) | SQLite ledger of inbound/outbound WhatsApp events + media + receipts + follow-ups | **whole → generalize** | This IS today's mailbox, but WhatsApp-specific. Moves to ring-core and generalizes to `(channel, chat_id)` provenance so Telegram + web share it. No brain import — clean move. |
| `packages/server/src/conversationTranscript.ts` (117) | Transcript reader interface + tool args (provenance, receipts, follow-ups) | **whole** | Pure types + reader shape; backs ring-core's `get_conversation`. No brain import. |
| `packages/server/src/sessionLog.ts` | Session ledger | **whole** | Diagnostic ledger; moves with the mailbox. |

## 3 · The router → **ring-core** (NEW deterministic core; today it's the fused engine)

| Where it lives today | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/meshGateway.ts` (772) | Publishes suite agents' tools, forwards calls to peers by name; `guardBacklogWrite`; `ask_brain`/`store_memory` tool defs | **SPLIT** | The **peer catalog + name-addressed forwarding** (`buildMeshGatewayServer`, `callPeerTool`) is the router's outbound-edge machinery → moves to ring-core. It currently routes MCP clients, not chat turns; ring-core adds the fast-path `@name` + enum-classifier over the SAME peer set. The tool DEFINITIONS for guys (`ask_brain` etc.) are the seam surface, kept. |
| `packages/server/src/peerClient.ts` | `callPeerTool`, `PeerConfig` | **whole** | The outbound seam client — how ring-core calls guys. Clean move. |
| `packages/server/src/backlogRouter.ts` | (semantic backlog routing to Archus) | **stay** | Guy-side (Archus) semantic routing, not the Ring's cheap router. |
| `packages/core/src/engine/engine.ts` `handleTasking`/`chat`/`store` | Today's de-facto "router+brain" — one in-process entry the gateways call | **stay (→ W-B)** | This is the COUNCIL GUY. The Ring must NOT contain it. Every gateway call into it becomes a seam dispatch. This is the single biggest cross-import to cut. |
| `packages/core/src/taskingPolicy.ts`, `toolKinds.ts` | tasking action reconciliation, tool-kind tags | **stay (→ W-B)** | Brain-side; the Ring only relays verbatim. |
| (router log + misroute counter) | — | **NEW in ring-core** | Does not exist today; the enum-classifier + decision log is net-new deterministic code per RD-5. |

## 4 · Attention rules → **ring-core** (absorbs today's headless Phylax)

| File | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/notifierTools.ts` (119) | `deliver_to_principal` + `read_notification_ledger` — today's headless Phylax decision tools | **SPLIT** | The **decision** ("whether/when an event reaches Jordi") is the attention logic → becomes ring-core's committed-file rules. The delivery bridge (`POST /api/notify`, `/api/notifications/search` over `PHYLAX_CONSOLE_URL`) collapses into a direct in-ring `phylax.send_to_user` call — the Console round-trip disappears. |
| `packages/server/src/notificationBus.ts` (168) | Single `notify(event)` ingress + journal + recipient ownership (R2-T1) | **whole → ring-core** | The one choke point for proactive sends; becomes the attention pipeline's egress. Clean (imports only `notificationStore`). |
| `packages/server/src/notificationStore.ts` (170) | Durable notification journal | **whole** | Moves with the bus. |
| `packages/server/src/meshGateway.ts` `deliver_to_principal` wiring / `docker-compose.phylax.yml` | Headless attention box (`AGENT=phylax`, `deliver_to_principal` wired into a chat brain) | **RETIRE box, MOVE logic** | Per RD-1: today's headless phylax retires as a box; its attention LOGIC lands in ring-core's committed rules file; the Phylax NAME moves to the channel gateway (§1). NOTE: today's headless phylax uses a chat **brain** to decide — the extraction replaces that with **deterministic committed rules** (law 5 / RD-1: the Ring never composes). |
| `packages/server/src/journeyMonitor.ts`, `executionLane.ts` (callers of `notify`) | Emit events INTO the bus | **stay** | Guy/unit-side event producers; they call the seam, not ring internals. |

## 5 · Media / STT pipeline → **ring-core** (archive-raw-first, pluggable STT)

| File | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/voiceArchive.ts` (80) | Archive raw voice/image to Drive; archive filenames | **whole** | Backs "archive raw FIRST" (law 5). Imports `drive.js`/`driveFolders.js`/`settings.js` only. NOTE `agentKeptNote()` inspects a brain `reply.actions[]` — that one helper couples to guy output; drop or move it to the guy side. |
| `packages/server/src/channelAudio.ts` (18) | Thin adapter: settings → `transcribeAudio` | **whole** | Already the pluggable-STT seam. Clean. |
| `packages/server/src/transcribe.ts` (791) | Cloud STT (Groq → OpenRouter), ffmpeg normalize, `NO_SPEECH_MESSAGE`, long-audio provider selection | **whole** | The STT engine; already provider-pluggable (law 5's "pluggable STT" is largely done here). No brain import. |
| `packages/server/src/transcriptStore.ts` | Transcript persistence | **whole** | Moves with the pipeline. |
| `packages/server/src/drive.ts`, `driveFolders.ts` | Drive client + folder resolution (archive target) | **whole** | Ring owns the archive (OAuth at keyring). `driveTools.ts` (the brain-facing Drive tool) → **stay/guy**. |

## 6 · Keyring / OAuth / token issuance UI → **ring-core**

| File | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/oauth.ts` (322) | OAuth authorize/token/register endpoints + consent/login page | **whole** | User→ring auth + system→world OAuth START (law 6a/6b). Clean move. |
| `packages/server/src/oauthStore.ts` (196) | OAuth client/token store | **whole** | Moves with oauth. |
| `packages/server/src/auth.ts` | Bearer validation | **whole** | Per-unit token validation (SEAM-SPEC §4). |
| `packages/server/src/settings.ts` (456) | Settings + **agent-token mint/rotate (`setAgentToken`, `agentTokens`)**, peer config, per-unit repo, enable/disable bookkeeping | **SPLIT** | The **keyring** parts — `api_token`, `agent_tokens` mint/reuse (`:209–230`), peer tokens, provisioning adopt (`:129–160`), enable/disable — are ring-core's keyring. The vault/world-key settings (`github_token`, `google_oauth_client_secret`, `groq_api_key`, etc.) belong in the **vault** (law 6b), pulled at request time — they must leave the UI-masked settings surface. |
| `packages/server/src/app.ts` (2277) `/api/peers`, `/api/settings`, team enable/disable, `/api/whatsapp*`, `/api/telegram*` routes | HTTP surface for keyring UI + gateway control | **SPLIT** | The keyring/channel/routing routes move to ring-core; the guy/execution routes (`/api/exec/*`, brain chat `handleTasking` at `:1837,:2071`) become seam calls to W-B. |
| `apps/web/dist` (served via `ZENOD_WEB_DIST`) | The web chat + keyring UI frontend | **whole → ring-core** | Ring-core serves the web chat + keyring; `channel="web"` in the mailbox. |

---

## Cross-imports that block ring-core from building standalone (sever these first)

These are the `file:symbol` couplings from Ring code into brain/guy logic. Each becomes a **seam
call** (ring-core → council guy / Zenod over MCP), not an in-process import.

1. `whatsappGateway.ts:14` → `import type { BrainEngine, StoreResult } from "zenod"`; call sites
   `engine.handleTasking` (`:818,:1108,:1144`), `engine.describeImage` (`:1099`). **The** blocker.
2. `telegramGateway.ts:3` → `import type { BrainEngine } from "zenod"`; call sites
   `engine.handleTasking` (`:320,:346`), `engine.describeImage` (`:316`).
3. `app.ts:1837` & `app.ts:2071` → `engine.handleTasking({...})` for web chat + mesh chat runner —
   the web-chat door calls the brain in-process; must become a router → guy seam dispatch.
4. `meshGateway.ts` → `engine`/`ConsoleChatRunner` binding (`buildMeshGatewayServer`, `app.ts:2040`)
   + `guardBacklogWrite` — split the peer-forwarding (keep in ring-core) from the brain runner
   (→ W-B).
5. `voiceArchive.ts:agentKeptNote` → inspects a brain `reply.actions[]` shape — the one media-side
   helper coupled to guy output; drop it from ring-core (archive-first is unconditional) or move it
   guy-side.

Plus the world-key leak to fix under law 6b: `settings.ts` currently holds `github_token`,
`google_oauth_client_secret`, `groq_api_key` in the same store as the keyring — these must move to
the vault (pulled at request time by the one authorized unit), not sit on ring-core's settings
surface.

## Net-new code ring-core needs (does not exist today)
- The enum-constrained router classifier + fast-path `@name` + decision log + misroute counter
  (RD-5) — today routing is whatever `handleTasking` does inside the fused brain.
- Generalizing `whatsappStore` from WhatsApp-only to `(channel, chat_id)` provenance across
  WhatsApp/Telegram/web.
- Replacing today's headless-Phylax **chat-brain** attention decision with a **committed-file
  deterministic** rules module.
