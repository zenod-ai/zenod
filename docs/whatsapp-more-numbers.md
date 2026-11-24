# More WhatsApp numbers on one Zenod account (EPIC-20 A9)

One account can hold extra WhatsApp numbers beside the default Zenod number. Each extra number is its own linked-device session in Phylax. agent_team asked for this so each EpicTeam desk answers Jordi on its own number (E60-A2, E60-S18).

```
phone (desk SIM) --QR--> Phylax session wa_<id> --inbound--> Zenod --webhook note.to_number--> agent_team router
agent_team --notify {from}--> Phylax session wa_<id> --> Jordi's WhatsApp
```

## Calls (Phylax MCP, `https://phylax.zenod.dev/mcp/<account token>`)

| Tool | Input | Returns |
|---|---|---|
| `pair_whatsapp_number` | `label?`, `sessionId?` (restart pairing for that number) | `number: {sessionId, label, state, number, qr, lastError}` |
| `whatsapp_numbers` | none | `numbers: [...]`: the default number (`isDefault: true`, `sessionId: null`), then each extra one |
| `unpair_whatsapp_number` | `sessionId` | logs that number out and deletes its session |
| `notify` | `text`, `imageBase64?`, `imageMimeType?`, **`from?`** | receipts; each WhatsApp receipt carries `from` (the number it went out from) |
| `send_message` | `channel`, `recipient`, `text`, **`from?`** | receipt with `from` |

- `qr` is the raw WhatsApp pairing payload, there while `state` is `pairing`. Render it as a QR code and scan it on the phone that holds the number: WhatsApp > Linked devices > Link a device. A QR lasts about a minute; call `pair_whatsapp_number` again with the same `sessionId` for a fresh one.
- `from` is the extra number (`+34600000002`, any common format) or its `sessionId`. Leave it out and nothing changes: the default Zenod number sends. A `from` the account does not own, or one not connected now, is an `invalid_input` error and nothing is sent. With `from`, `notify` goes to the account's verified WhatsApp only.
- `whatsapp_numbers` is also on the notify-only service profile. Pairing and unpairing are only on the account's own connection.
- At most 4 extra numbers per account.

## Webhook (`voice_note.captured`)

`note.to_number`: the account's WhatsApp number the note was sent TO (`+<digits>`), on every voice note and reply-word text that came by WhatsApp; `null` for notes that came another way. Route on it.

## Rules

- An extra number answers only senders of the account that paired it. Anyone else's message is kept in Phylax's store as `denied_extra_number`, with no read tick and no reply.
- Zenod's own replies to a note (the save receipt) go out from the number the note came in on.
- Sessions live in `<phylax data>/whatsapp/sessions/<sessionId>/`; the default number's `session/` is untouched. Paired sessions reconnect at boot.
- Off switch: `PHYLAX_WHATSAPP_EXTRA_NUMBERS=0` on Phylax (then redeploy).

## Not proven until a real SIM is paired

Tests use fake WhatsApp sockets. They prove the QR comes back for a new session, its state is stored apart, a scan makes it a connected number, inbound on it carries `to_number`, and the send goes out on the socket that `from` picks. Only a real paired phone proves that WhatsApp accepts the second linked session, that the post-scan restart reconnects, and that messages are delivered from that number.
