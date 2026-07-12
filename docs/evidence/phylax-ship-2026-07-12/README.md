# Phylax live P-S5 evidence — 2026-07-12

Live deployment: `https://phylax.zenod.dev`  
Image commit: `f6cc22c`

## Clean WhatsApp text pipe

- Verified sender: `34618217703`
- Route: WhatsApp → Phylax tenant lookup → tenant Ring MCP face → WhatsApp
- Ring correlation: `test_482a1b7c2eca4a7489797013f083723b`
- Reply: `Phylax clean text pipe passed.`
- Tool events: `0`

## Voice transcription pipe

- WhatsApp message: `3EB08DF39E67F9B2227E5F`
- Media: one 35-second `ptt` message
- Local transcript: `Oh. Felix voice transcription test, please reply with the words voice pipe passed. Do not use tools. Do not use tools.`
- Transcription source: `whisper.cpp large-v3-turbo`
- Ring correlation: `test_f5d6380186374597a7814e3224f47cff`
- Ring received the tenant sender, transcript, and an authenticated Phylax artifact reference.
- Reply: `voice pipe passed`
- Tool events: `0`
- The Phylax container remained stable throughout serialized local transcription.

## MCP server delivery receipt

- External tool: `send_message`
- Channel: `whatsapp`
- Provider message ID: `3EB0A5D62BF7283727DC42`
- Status: `sent`
- The structured response contained both `receipts` and `evidence`; this was not a silent acknowledgement.

## Screenshots

- `10-clean-text-pipe-whatsapp-web.png`
- `11-clean-text-pipe-focused.png`
- `12-voice-transcription-pipe-live.png`

Telegram delivery and second-tenant/different-sender isolation remain open SHIP gates and are not represented as passing here.
