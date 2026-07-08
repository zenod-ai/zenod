# Ring Nucleus — EXTRACTION MAP (file-level, grounded in real code)

Maps today's fused-Console code onto the nucleus's **four** responsibilities. **No code moved yet.**
This is a strict SUBSET of [../ring/EXTRACTION-MAP.md](../ring/EXTRACTION-MAP.md) — the SAME real
files, but the nucleus takes only the mailbox / provenance / verbatim-relay / one-row-route parts.
It takes **no classifier, no keyring, no attention-rules module, no council**. Verdicts: **whole**
(moves intact), **split** (only the nucleus part moves; the rest stays for 2.7), **stay** (belongs
to a guy/unit or to the 2.7 ring, not the nucleus).

Key structural fact grounding everything below (verified in this worktree): today
`whatsappGateway.ts` calls `engine.handleTasking(...)` **in-process** at `:818`, `:1108`, `:1144`
and `engine.describeImage(...)` at `:1099`, with `import type { BrainEngine, StoreResult } from
"zenod"` at `:14`. The brain (`packages/core/src/engine/engine.ts`) is fused into the same process.
**The nucleus extraction = turn each in-process `engine.handleTasking` call into ONE seam MCP call
to Herald (`ask_brain`), and split out only the mailbox + provenance + verbatim relay + one-row
route.**

---

## 1 · Channel gateway → **phylax** box (nucleus subset)

| File | Responsibility | Verdict | Notes / cross-imports to sever |
|---|---|---|---|
| `packages/server/src/whatsappGateway.ts` (1272 LOC) | Baileys socket, pairing/QR, inbound event → reply | **SPLIT** | Baileys socket + pairing/QR + `send`/media-download stay in **phylax**. The `engine.handleTasking` calls (`:818,:1108,:1144`) become the single nucleus-core → Herald **seam call**. The reply-relay orchestration moves to **nucleus-core**. `import type { BrainEngine, StoreResult } from "zenod"` (`:14`) is THE cross-import to sever. **Telegram is NOT in the nucleus** — `telegramGateway.ts` stays for 2.7. |
| `packages/server/src/whatsappConfig.ts` (47) | JID normalize, allow-list, phone mask | **whole** | Pure helpers; phylax + nucleus-core both use. No brain import. |

## 2 · The mailbox + provenance → **nucleus-core** (responsibilities 1 & 2)

| File | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/whatsappStore.ts` (839) | SQLite ledger of inbound/outbound events + media + receipts | **whole → generalize** | This IS the durable mailbox. Moves to nucleus-core and generalizes to `(channel, chat_id)` provenance. Backs H-1's "restart mid-conversation resumes" test. No brain import — clean move. |
| `packages/server/src/conversationTranscript.ts` (117) | Transcript reader interface + tool args (provenance, receipts) | **whole** | Pure types + reader shape; backs nucleus-core's `get_conversation`. No brain import. |

## 3 · The route + verbatim relay → **nucleus-core** (responsibilities 3 & 4)

| Where it lives today | Responsibility | Verdict | Notes |
|---|---|---|---|
| `packages/server/src/peerClient.ts` (140) | `callPeerTool` (`:102`), `PeerConfig` (`:25`) — the outbound seam client | **whole** | How nucleus-core calls Herald's `ask_brain`. Clean move. In the nucleus there is exactly ONE `PeerConfig` (Herald). |
| `packages/server/src/meshGateway.ts` (772) | Publishes peers' tools, forwards calls by name (`buildMeshGatewayServer` `:662`, `callPeerTool` `:766`) | **SPLIT (forwarding half only)** | Only the **verbatim forwarding** edge — dispatch a call to a peer and relay its bytes back untouched — moves to nucleus-core. The nucleus takes NO peer catalog, NO `@name` addressing, NO `guardBacklogWrite`: the "routing table" is a static const `* → Herald`, so `callPeerTool` is always aimed at the one Herald peer. |
| (one-row routing table `* → Herald`) | — | **NEW in nucleus-core** | A static const, ~one line. Replaces the entire enum-classifier the full ring specs. No LLM, no misroute counter. |
| `packages/core/src/engine/engine.ts` `handleTasking` | Today's in-process "router+brain" the gateway calls | **stay (→ Herald)** | This is the guy brain. The nucleus must NOT contain it. Every `engine.handleTasking` call site becomes the single seam dispatch to Herald. THE cross-import to cut. |

---

## What the FULL ring takes that the nucleus does NOT (explicitly out of scope)

These rows appear in [../ring/EXTRACTION-MAP.md](../ring/EXTRACTION-MAP.md) and are **2.7 only** —
the nucleus deliberately omits every one:

- **Classifier / router intelligence** — the full ring adds an enum-constrained small-LLM
  classifier + `@name` fast-path + decision log + misroute counter over the `meshGateway` peer set
  (ring EXTRACTION-MAP §3). The nucleus replaces all of it with the static `* → Herald` row.
- **Attention rules** — `notifierTools.ts`, `notificationBus.ts`, `notificationStore.ts`, and the
  headless-Phylax `deliver_to_principal` decision (ring EXTRACTION-MAP §4). The nucleus has **no
  attention module**: it always relays, never withholds or proactively withholds.
- **Media / STT pipeline** — `voiceArchive.ts`, `channelAudio.ts`, `transcribe.ts`,
  `transcriptStore.ts` (ring EXTRACTION-MAP §5). The nucleus stores/relays media refs but does not
  transcribe.
- **Keyring / OAuth / token-issuance UI** — `oauth.ts`, `oauthStore.ts`, `auth.ts` (partial),
  `settings.ts` keyring split, `apps/web/dist` frontend, and the `/api/peers` / `/api/settings`
  admin routes in `app.ts` (ring EXTRACTION-MAP §6). The nucleus has a per-unit bearer for the
  Phylax↔nucleus-core edge and the one Herald token, and **no keyring UI**.
- **Council guy + multi-guy peer catalog** — the nucleus routes to exactly one guy.
- **Telegram + web channels** — `telegramGateway.ts`, `telegramConfig.ts`, web chat. Nucleus is
  WhatsApp-only for Move 0.

## Cross-imports the nucleus must sever to build standalone

1. `whatsappGateway.ts:14` → `import type { BrainEngine, StoreResult } from "zenod"`; call sites
   `engine.handleTasking` (`:818,:1108,:1144`), `engine.describeImage` (`:1099`). **The** blocker —
   each becomes the single nucleus-core → Herald seam call.
2. `meshGateway.ts` → `engine`/`ConsoleChatRunner` binding + `guardBacklogWrite` — keep only the
   verbatim peer-forwarding path; drop the catalog/guard (nucleus has one static target).

## Net-new code the nucleus needs (does not exist today)
- The static one-row routing table `* → Herald` (~one line; replaces the fused `handleTasking`
  routing entirely).
- Generalizing `whatsappStore` from WhatsApp-only to `(channel, chat_id)` provenance (nucleus uses
  only the WhatsApp channel, but the schema generalizes so 2.7 adds Telegram/web without migration).
