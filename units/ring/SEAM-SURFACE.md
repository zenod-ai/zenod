# Ring — SEAM surface

The exact MCP tools ring-core and phylax **expose** and **consume**, plus the receipt shape for
each. Conforms to [../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md) v1: pure MCP over streamable
HTTP; every mutating tool returns an ID/URL/SHA or errors loudly; long tools return `{ticket_id}`
and a completion event carries the same id; per-unit bearer auth; structured `{code,message}`
errors. Shapes below are the TARGET contract (blueprint) — see EXTRACTION-MAP.md for what backs
each today.

Legend: **fast/mutating** returns a handle; **fast/read** returns data or explicit empty;
**long** returns `{ticket_id}` + later event.

---

## A · phylax exposes (channel gateway → ring-core & keyring UI call these)

### `send_to_user(channel, chat_id, text, reply_to_mailbox_id?)` — fast/mutating
Outbound relay. Delivers text verbatim to the named gate. Ring-core calls this for every reply and
every proactive send.
- **Receipt:** `{ evidence: [{ kind: "message_sent", channel, chat_id, sent_message_id, at }] }`.
  A delivery that returns no `sent_message_id` is a silent ack → nonconformant.
- **Errors:** `unauthorized`, `not_found` (unknown chat), `unavailable` (socket down / 428).

### `get_media(media_id)` — fast/read
Returns bytes (or a short-lived URL) for a media ref a prior `message_received` announced.
- **Receipt:** `{ media_id, mime_type, file_name, bytes_b64 | url, size }` or explicit
  `{ code: "not_found" }`.

### `pairing_status()` / serves QR screen — fast/read
Phylax owns its own pairing/QR web screen (session state in its volume); the keyring UI links to it.
- **Receipt:** `{ channel, state: "disconnected"|"pairing"|"connected"|"error", linked_number|null }`.

## B · phylax consumes (calls INTO ring-core)

### `ring_core.message_received(...)` — see C. Inbound is a Phylax → ring-core MCP call.

---

## C · ring-core exposes

### `message_received(channel, chat_id, contact_id?, text? , media_id?, media_meta?)` — fast/mutating
THE inbound door. An adapter (Phylax or web) hands the Ring one turn. Ring-core writes it to the
mailbox with provenance and returns **immediately** — it does NOT block on routing or a guy's turn.
- **Receipt (accepted):** `{ evidence: [{ kind: "mailbox_entry_created", mailbox_id, channel,
  chat_id, at }] }`. The reply, if any, arrives later as a separate `send_to_user` call — never on
  this call's return.
- This is the receipt-immediately half of RD-1's call shape. Media path: ring-core pulls bytes via
  `phylax.get_media`, archives raw to Drive FIRST, transcribes (pluggable STT), then routes on the
  transcript.
- **Errors:** `unauthorized`, `invalid_input` (no text and no media).

### `get_conversation(channel?, chat_id?, since?, limit?)` — fast/read
Reads the mailbox transcript with provenance/receipts (backs today's conversation-transcript tool).
- **Receipt:** `{ entries: [...] }` or explicit `{ entries: [] }`.

### Keyring / admin surface (served to the web UI; per RD-1 keyring responsibilities)
- `oauth_start(provider)` — fast/mutating → `{ evidence: [{ kind: "oauth_started", provider,
  authorize_url }] }`. Begins the world-key OAuth flow; tokens land in the vault, never the UI.
- `issue_unit_token(unit)` / `rotate_unit_token(unit)` / `revoke_unit_token(unit)` — fast/mutating
  → `{ evidence: [{ kind: "token_issued"|"token_rotated"|"token_revoked", unit, token_id, at }] }`.
- `set_unit_enabled(unit, enabled)` — fast/mutating → `{ evidence: [{ kind: "unit_enabled" |
  "unit_disabled", unit, at }] }`. **Disable must make that unit's token refuse calls loudly**
  (SEAM-SPEC item 13), not silently 200.

## D · ring-core consumes (the router's outbound edges — pure lookup + dispatch)

The router (fast-path `@name` → enum-constrained classifier) picks ONE of these gates. It picks a
gate; it never alters the payload. Every decision is logged (chosen route + input digest) + a
misroute counter.

### council guy (default route) — `ask_brain(message)` — **long**
Anything not explicitly named routes here. The council guy holds the wire's semantics; the Ring
relays its answer VERBATIM, attributed (`"Mentor: …"`).
- **Dispatch receipt:** `{ ticket_id }` (accepted). **Completion event:** carries the same
  `ticket_id` + the guy's verbatim reply text (+ any evidence handles the guy returned).
- Relay path structurally contains **no** text-generation call — the reply is the guy's bytes.

### named guy — `@name` fast-path → that guy's `ask_brain` — long (same shape as above).

### Zenod memory verbs — `store_memory(...)` (long, → job id polled via `get_task_result`) /
`search_memory`, `get_memory` (fast/read). Router recognizes memory-verbs as a distinct route.

### `phylax.send_to_user`, `phylax.get_media` — outbound + media (see A). Reply exits via
**provenance lookup**: same channel/chat_id the mailbox entry carries — same gate in, same gate out.

### Attention rules (committed file, in-process to ring-core, NOT an MCP call)
On an inbound entry or a raised event, deterministic rules decide whether/when/how to surface it
(absorbs today's headless Phylax `deliver_to_principal` decision). A "deliver now" outcome becomes a
`phylax.send_to_user` call to the channel the rules name. No LLM in the relay/attention path.

---

## Conformance notes (against SEAM-SPEC checklist)
- Items 3–5 (receipts): every mutating tool above returns an evidence handle; reads return data or
  explicit empty. ✔ by contract.
- Items 6–8 (tickets): `ask_brain` / `store_memory` are long tools → `{ticket_id}` + event +
  `get_task_result` poll. ✔
- Items 9–11 (dispatch): ring→guy is a typed async dispatch carrying `origin_ticket_id`; depth ≤1
  enforced downstream (the guy may dispatch one further, no more). ✔
- Items 12–14 (auth): per-unit bearer; disable revokes + refuses; ring-core holds unit tokens only,
  never world keys (those are in the vault, pulled at request time by the one authorized unit). ✔
- Item 16 (stranger): surface names no zenod-internal type. ✔
