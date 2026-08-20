# Phylax P-S5 Telegram bind and delivery receipt — 2026-07-12

Live deployment: `https://phylax.zenod.dev`  
Running image and health SHA: `5dcc773e0627aa08e42e3ba52b93ef33891eeb1a`

## Dedicated bot decision

Two valid Dioptra bots were found first, but both are actively long-polling in the existing Dioptra service. Jordi then supplied the dedicated `@zenod_bot` credential and explicitly required the Dioptra and Lambda admin bots to remain unchanged. Phylax uses only `@zenod_bot`; the existing Dioptra container and both of its polling loops remain running and were not modified.

Phylax's service-level configuration now has:

- the dedicated valid `@zenod_bot` token (`hasToken: true`), never written to this evidence;
- allowed owner entries for `alfablok` and its existing numeric Telegram user/chat ID;
- its own connected long-polling gateway (`enabled: true`, `state: connected`, `botUsername: zenod_bot`).

## Tenant UI binding

The tenant dashboard's Telegram field is bound to `alfablok`. The binding was saved through `PUT /api/phylax/settings`, the same endpoint used by the dashboard's **Save settings** action. The bot token remains an admin/service credential; tenants enter only their own Telegram handle in the UI.

P-S5 found and fixed a real port seam: the tenant UI stores a friendly handle, while Telegram `sendMessage` requires a numeric `chat_id`. PR #921 preserves the handle in tenant settings and resolves it only when the ported provider allowlist supplies exactly one numeric owner. Ambiguous multi-owner configurations continue to fail closed.

## Live MCP delivery receipt

An external tenant MCP client called:

- tool: `send_message`
- channel: `telegram`
- recipient: `alfablok`
- text: `Phylax Telegram MCP receipt pass.`

The live structured result was:

- status: `ok`
- provider message ID: `129`
- provider status: `sent`
- receipt text: `telegram:129:sent`
- sent at: `2026-07-12T18:27:21.142Z`

This closes the SHIP 7 Telegram binding and the Telegram half of SHIP 10 with the dedicated bot and a provider receipt. A phone screenshot/arrival confirmation is still requested for the final visual package. SHIP 11 still requires a second tenant with a different verified WhatsApp sender.
