# WhatsApp Connector Notes

Status: v1 in progress, paired through Baileys / WhatsApp Web.

## Shape In The Repo

The WhatsApp code is modular, but not an independent package or standalone
folder yet. It currently lives in the main server and web app:

- `packages/server/src/whatsappGateway.ts` owns the Baileys socket lifecycle,
  QR pairing, reconnect handling, inbound message extraction, allowlist checks,
  agent calls, and outbound WhatsApp replies.
- `packages/server/src/whatsappStore.ts` owns the SQLite audit store for
  contacts, chats, inbound messages, media metadata, and outbound attempts.
- `packages/server/src/whatsappConfig.ts` owns identifier normalization and
  allowlist matching.
- `packages/server/src/app.ts` exposes authenticated `/api/whatsapp/*`
  endpoints.
- `apps/web/src/components/whatsapp-connect.tsx` is the Connections tab card.
- Session credentials are runtime data only, under `/data/whatsapp/session` in
  deployment. They must not be logged, returned by APIs, or committed.

If this grows, the natural next step is to move the first three files into
`packages/server/src/whatsapp/` or split them into a small server package. For
now they are intentionally local to the server because they depend on runtime
settings, the server SQLite data directory, and `BrainEngine`.

## Runtime Flow

1. The admin opens Connections -> WhatsApp and presses Pair/Re-pair.
2. `POST /api/whatsapp/pair` starts a Baileys socket and waits briefly for a
   QR/open/error signal.
3. The UI renders the ephemeral QR. The QR is not persisted.
4. After scan, WhatsApp often emits Baileys disconnect code `515`
   (`restartRequired`). Zenod now treats that as a normal pairing step:
   it waits for Baileys credentials to flush to disk, then starts a replacement
   socket from the saved session.
5. When connected, incoming direct messages are filtered:
   status broadcasts, groups by default, messages from the linked number
   (`fromMe`), unsupported/empty messages, and non-allowlisted senders do not
   call the agent.
6. Allowlisted direct text messages call:
   `engine.chat(message, "whatsapp", { conversationKey: normalizedSender })`
   so each sender gets separate WhatsApp conversation context.
7. The assistant response is sent back via `socket.sendMessage(...)` and
   recorded in `whatsapp_outbound_audit`.

## Current Behavior

- Default posture is closed: only allowlisted senders can trigger replies.
- Group chats are off unless explicitly enabled.
- `Accept every sender` bypasses the allowlist but should be treated as an
  admin-only/self-hosted convenience.
- Voice notes are intended to reuse the local `whisper.cpp` transcription path.
- Images/documents are metadata/caption-first for now; full attachment filing is
  still follow-up work.
- The status card now shows safe diagnostics: last Baileys upsert, last ignored
  reason, last stored inbound status, and masked sender info. This is there to
  distinguish "not received" from "ignored", "denied", "failed", and "replied".

## Important Gotchas

- You cannot test replies by messaging from the linked WhatsApp Business number
  itself. Baileys marks those as `fromMe`, and Zenod ignores them. Test from a
  second WhatsApp account whose number is allowlisted.
- If a message arrives but the card says `denied`, the allowlist does not match
  the sender as WhatsApp reports it.
- If the card says `no WhatsApp messages seen yet`, Baileys has not delivered
  any inbound event to the server.
- If pairing shows `515`, that is not by itself fatal. It is the expected
  restart-required step after QR scan; Zenod should save credentials and
  reconnect.

## Tests

Covered in `packages/server/test/whatsapp.test.ts`:

- identifier normalization and allowlist matching
- status/from-self filtering
- idempotent inbound storage
- allowlisted text -> one agent call -> one outbound send
- denied sender -> no agent call
- `515` pairing restart path
- diagnostics for ignored pre-storage messages

Current verification commands:

```sh
npm run test -w @zenod/server -- whatsapp.test.ts
npm run test -w @zenod/server
npm run build
```
