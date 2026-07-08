# The Ring Nucleus — the first installment of 2.7

Owner: EPIC 2.6 lane **H-1** ([../../docs/EPIC-2.6-HERALD-MOVE-0.md](../../docs/EPIC-2.6-HERALD-MOVE-0.md)).
Status of THIS folder: **scaffold / blueprint** — no code moved. This documents the MINIMUM real
ring that ships inside Herald Move 0, and maps it file-by-file onto the SAME code the full 2.7 ring
blueprint ([../ring/EXTRACTION-MAP.md](../ring/EXTRACTION-MAP.md)) cites — a strict subset, never a
fork. See [EXTRACTION-MAP.md](EXTRACTION-MAP.md).

## What the nucleus is

The nucleus is the REAL ring at minimum size (converged design, EPIC-2.6 "do not relitigate"): a
Phylax channel gateway + a tiny deterministic core with **exactly four responsibilities**:

1. **Durable mailbox** — every inbound/outbound turn written to a `(channel, chat_id)` ledger that
   survives restart (mid-conversation resume is an H-1 acceptance test).
2. **Provenance on every entry** — each mailbox entry carries where it came from (channel, chat_id,
   contact, timestamp) so a reply exits the SAME gate it entered.
3. **Verbatim attributed relay** — a guy's answer is delivered as its own bytes, prefixed with
   attribution (`"Herald: …"`). The relay path structurally contains **no** text-generation call.
4. **One-row routing table `* → Herald`** — a static const, not a decision. Every turn goes to
   Herald. This **replaces the classifier entirely** for Move 0.

Per RD-1 it deploys as one small compose of two boxes:

| Box | Kind | Job |
|---|---|---|
| **nucleus-core** | deterministic core | mailbox (serialize per chat, provenance on every entry) · **static one-row route `* → Herald`** (no classifier) · verbatim attributed relay · nothing else |
| **phylax** | channel gateway (own container, own volume) | wraps Baileys (WhatsApp) + QR/pairing screen; **zero intelligence**; session state in its own volume. Exposes `send_to_user`, `get_media`. Inbound = `message_received(...)` MCP call into nucleus-core, receipted immediately. |

## EXPLICITLY OUT OF SCOPE (this is the whole point of H-1)

The following are the **2.7 full ring** ([../ring/](../ring/)) — NOT the nucleus. Any of them
appearing in this unit is scope failure (EPIC-2.6 line 24):

- **Keyring UI** — user auth screens, OAuth start, per-unit MCP token issue/rotate/revoke,
  unit enable/disable. → 2.7.
- **LLM classifier / enum-constrained router** — the whole routing table is one static row here.
  There is NO small-LLM classifier, no `@name` fast-path, no misroute counter. → 2.7.
- **Attention rules** — the committed-file "whether/when/how an event reaches the principal"
  module (today's headless Phylax logic). The nucleus always relays; it never withholds. → 2.7.
- **Council guy** — the multi-guy default brain. The nucleus routes to exactly ONE guy (Herald),
  hard-wired. → 2.7.
- **Media/STT pipeline, Telegram, web channel, generalized multi-guy peer catalog** — 2.7.

The nucleus grows INTO the full ring additively: the static route becomes the classifier, the
single Herald target becomes the peer set, keyring/attention/council are added as rooms. **Shared
lineage, never a fork** (EPIC-2.6 line 33).

## Call shape

- **Inbound:** Phylax calls nucleus-core's `message_received` → gets a **receipt immediately**
  (mailbox ID). Herald never holds the wire.
- **Route:** the static table maps `*` → Herald. nucleus-core dispatches to Herald's `ask_brain`.
- **Reply:** a separate nucleus-core → phylax `send_to_user(channel, chat_id, text)` call. Outbound
  is a **provenance lookup** (same gate in, same gate out), and the text is Herald's verbatim bytes
  with attribution.

The seam runs INSIDE the compose too: Phylax↔nucleus-core is pure MCP, per W-D SEAM-SPEC.

## Files in this folder

- [SEAM-SURFACE.md](SEAM-SURFACE.md) — the four MCP tools + receipt shapes (nucleus subset of the
  ring surface).
- [EXTRACTION-MAP.md](EXTRACTION-MAP.md) — file-level map of today's code → the four nucleus
  responsibilities, marking what the full ring takes that the nucleus does NOT.
- [docker-compose.nucleus.yml](docker-compose.nucleus.yml) — the two-box compose (phylax +
  nucleus-core), stub.

## Honest status

Blueprint. nucleus-core does not yet exist as a box; today `whatsappGateway.ts` calls
`engine.handleTasking()` **in-process** (the brain is fused in). The nucleus extraction turns that
in-process call into a seam call to exactly Herald, and keeps only the mailbox + provenance +
verbatim relay + one-row route. It deliberately leaves the classifier, keyring, attention rules and
council out — those are 2.7, and this folder is their first installment, not a competing design.
