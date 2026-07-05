# The Ring — the one door

Owner: EPIC 2.5 ticket **W-A** ([../../docs/EPIC-2.5-ATOMIC-UNITS.md](../../docs/EPIC-2.5-ATOMIC-UNITS.md)).
Status of THIS folder: **scaffold / blueprint** — the physical extraction of code out of the fused
Console is STAGED behind the RD-4 split trigger (not yet fired). No fused code has been moved. This
folder documents the target unit and maps it, file-by-file, onto the code that lives today under
`packages/server/src` and `packages/core/src`. See [EXTRACTION-MAP.md](EXTRACTION-MAP.md).

## What the Ring is

The Ring is the single door between a human and the suite. It is **deterministic** — it owns the
channel, serializes conversations, routes (picks a gate, never rewrites the message), relays a guy's
answer **verbatim** with attribution, runs the media pipeline (archive-raw-first, then pluggable
STT), applies attention rules from a committed file, and serves the keyring UI (user auth, OAuth
start, per-unit MCP token issue/rotate/revoke, unit enable/disable). It contains **no brain / guy
logic** — that is the council guy (W-B) and lives behind the seam.

Per RD-1 (CLOSED 2026-07-05) the Ring is the **product**, and it deploys as one small compose of
two boxes:

| Box | Kind | Job |
|---|---|---|
| **ring-core** | deterministic core + web UI | mailbox (serialize per chat, parallel across chats, provenance on every entry) · router (fast-path `@name` → enum-constrained small-LLM classifier; every decision logged; misroute counter) · verbatim relay · media pipeline (pull bytes → archive raw to Drive FIRST → transcribe with pluggable STT → route on transcript) · attention rules from a committed file (absorbs today's headless Phylax logic) · keyring UI · web chat |
| **phylax** | channel gateway (own container, own volume) | wraps Baileys (WhatsApp) + Telegram; **zero intelligence**; serves its own pairing/QR screen; session state in its own volume. Exposes `send_to_user`, `get_media`. Inbound = `message_received(channel, chat_id, text \| media_id)` MCP call into ring-core, receipted immediately. Isolated because Baileys is the flakiest / most ToS-exposed component we run (Epic-2 D-4 BSP swap must not touch the mailbox). |
| **web** | (served by ring-core) | browser chat + keyring UI; same mailbox, `channel = "web"`. |

## Call shape (RD-1 refined)

- **Inbound:** an adapter (Phylax/web) calls ring-core's `message_received` → gets a **receipt
  immediately** (mailbox ID). Slow guys never hold the wire.
- **Reply:** a separate ring-core → adapter `send_to_user(channel, chat_id, text)` call. Outbound is
  a **provenance lookup**, not a decision — a reply exits through the SAME gate/chat it entered.
- **Attention rules** may decide NOT to reply, or to proactively send (events) to the channel the
  rules name. The Ring never composes, summarizes, or acks on a guy's behalf — unclear intent routes
  to the default guy, whose job is to ask.

Seam runs INSIDE the compose too: Phylax↔ring-core is itself pure MCP, per W-D SEAM-SPEC.

## MCP surface (summary — full shapes in [SEAM-SURFACE.md](SEAM-SURFACE.md))

**ring-core exposes** (to adapters, over the internal seam): `message_received`, `get_conversation`
(read), plus the keyring/admin surface used by the web UI.
**ring-core consumes** (calls out): each guy's `ask_brain` (default = council guy) per the router;
Zenod memory verbs; the vault for OAuth/world keys; STT provider; `phylax.send_to_user` /
`phylax.get_media` for outbound + media.
**phylax exposes:** `send_to_user`, `get_media`; **phylax consumes:** ring-core's `message_received`.

## Files in this folder

- [Dockerfile](Dockerfile) — note on reusing the root Dockerfile with a ring entrypoint.
- [docker-compose.ring.yml](docker-compose.ring.yml) — the small compose (ring-core + phylax +
  web), stub.
- [SEAM-SURFACE.md](SEAM-SURFACE.md) — exact MCP tools + receipt shapes (W-D conformant).
- [EXTRACTION-MAP.md](EXTRACTION-MAP.md) — file-level map of today's code → ring responsibilities,
  with move verdicts (whole/split/stay) and the cross-imports into brain/guy logic that must become
  seam calls.

## Honest status

Blueprint. ring-core does not yet exist as a box; today the gateways
(`whatsappGateway.ts`, `telegramGateway.ts`) call `engine.handleTasking()` **in-process** — the
brain is fused in. The extraction turns that in-process call into a seam call to the council guy and
splits the deterministic half (mailbox/router/relay/media/attention/keyring) into ring-core. That
work is staged; this folder is the target and the map.
