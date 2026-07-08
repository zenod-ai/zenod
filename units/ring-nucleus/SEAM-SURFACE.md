# Ring Nucleus — SEAM surface

The exact MCP tools nucleus-core and phylax **expose** and **consume**. Conforms to
[../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md) v1: pure MCP over streamable HTTP; every mutating
tool returns an ID/URL/SHA or errors loudly; long tools return `{ticket_id}` and a completion event
carries the same id; per-unit bearer auth; structured `{code,message}` errors.

This is the **nucleus subset** of [../ring/SEAM-SURFACE.md](../ring/SEAM-SURFACE.md). Everything the
full ring exposes beyond the four tools below is **OUT of scope** and called out explicitly.

Legend: **fast/mutating** returns a handle; **fast/read** returns data or explicit empty;
**long** returns `{ticket_id}` + later event.

---

## A · phylax exposes (channel gateway → nucleus-core calls these)

### `send_to_user(channel, chat_id, text, reply_to_mailbox_id?)` — fast/mutating
Outbound relay. Delivers text verbatim to the named gate. nucleus-core calls this for every reply.
- **Receipt:** `{ evidence: [{ kind: "message_sent", channel, chat_id, sent_message_id, at }] }`.
  A delivery that returns no `sent_message_id` is a silent ack → nonconformant.
- **Errors:** `unauthorized`, `not_found` (unknown chat), `unavailable` (socket down / 428).

### `get_media(media_id)` — fast/read
Returns bytes (or a short-lived URL) for a media ref a prior `message_received` announced. In the
nucleus this exists for durability (raw bytes are archivable) but there is **no STT pipeline** —
media is stored and relayed as a media ref, not transcribed. Transcription is 2.7.
- **Receipt:** `{ media_id, mime_type, file_name, bytes_b64 | url, size }` or `{ code: "not_found" }`.

### `pairing_status()` / serves QR screen — fast/read
Phylax owns its own pairing/QR web screen (Baileys session state in its volume). H-1 acceptance:
fresh boot → QR pair. There is **no keyring UI** linking to it in the nucleus; the QR screen is
Phylax's own and is reached directly.
- **Receipt:** `{ channel, state: "disconnected"|"pairing"|"connected"|"error", linked_number|null }`.

## B · phylax consumes (calls INTO nucleus-core)

### `nucleus_core.message_received(...)` — see C. Inbound is a Phylax → nucleus-core MCP call.

---

## C · nucleus-core exposes

### `message_received(channel, chat_id, contact_id?, text?, media_id?, media_meta?)` — fast/mutating
THE inbound door. Phylax hands the nucleus one turn. nucleus-core writes it to the mailbox with
**provenance** and returns **immediately** — it does NOT block on Herald's turn.
- **Receipt (accepted):** `{ evidence: [{ kind: "mailbox_entry_created", mailbox_id, channel,
  chat_id, at }] }`. The reply, if any, arrives later as a separate `send_to_user` call.
- **Errors:** `unauthorized`, `invalid_input` (no text and no media).

### `get_conversation(channel?, chat_id?, since?, limit?)` — fast/read
Reads the mailbox transcript with provenance (backs today's conversation-transcript tool). Needed
for the H-1 restart-resume acceptance test.
- **Receipt:** `{ entries: [...] }` or explicit `{ entries: [] }`.

**That is the entire nucleus-core exposed surface.** The full ring additionally exposes the
**keyring/admin surface** (`oauth_start`, `issue_unit_token`, `rotate_unit_token`,
`revoke_unit_token`, `set_unit_enabled`) — **all OUT of scope for the nucleus** (2.7).

## D · nucleus-core consumes (the ONE outbound edge)

There is exactly one route. It is a static const, not a decision.

### Herald (the only route) — `ask_brain(message)` — **long**
The one-row routing table `* → Herald`: **every** inbound turn dispatches here. Herald holds the
semantics; the nucleus relays its answer **VERBATIM, attributed** (`"Herald: …"`). The relay path
structurally contains **no** text-generation call — the reply is Herald's bytes.
- **Dispatch receipt:** `{ ticket_id }` (accepted). **Completion event:** same `ticket_id` +
  Herald's verbatim reply text.

### `phylax.send_to_user`, `phylax.get_media` — outbound + media (see A). Reply exits via
**provenance lookup**: same channel/chat_id the mailbox entry carries — same gate in, same gate out.

**What nucleus-core does NOT consume (all 2.7):** no enum-classifier LLM (the route is static, so
there is no `RING_ROUTER_LLM_KEY`); no `@name` fast-path over a peer set (one target, hard-wired);
no Zenod memory verbs from the nucleus (Herald owns memory, not the ring); no vault/OAuth; no
attention-rules module (the nucleus always relays, never withholds).

---

## Conformance notes (against SEAM-SPEC checklist)
- Items 3–5 (receipts): every mutating tool returns an evidence handle; reads return data or
  explicit empty. ✔ by contract.
- Items 6–8 (tickets): `ask_brain` is the one long tool → `{ticket_id}` + event. ✔
- Items 9–11 (dispatch): nucleus→Herald is a typed async dispatch carrying `origin_ticket_id`. ✔
- Items 12–14 (auth): per-unit bearer (Phylax↔nucleus-core token). The nucleus holds ONE guy token
  (Herald's) and no world keys. The full keyring (issue/rotate/revoke, enable/disable) is 2.7. ✔
- Item 16 (stranger): surface names no zenod-internal type. ✔
