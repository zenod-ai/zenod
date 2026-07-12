# Phylax P-S5 completion audit — 2026-07-12

Audited live URL: `https://phylax.zenod.dev`  
Running image: `ghcr.io/zenod-ai/zenod:sha-f6cc22c`  
Runtime health SHA: `f6cc22ccc3b7210a5e8afceb9f619ac76a73c734`

This audit treats missing live evidence as incomplete. Automated coverage is recorded separately and does not replace an explicitly required real-account journey.

| SHIP | State | Authoritative evidence |
|---|---|---|
| 1. Logged-out landing | PASS | `05-clean-landing-logged-out.png`; live root HTTP 200; landing shows WhatsApp + Telegram, Get started, Pricing, and GitHub sign-in with no public token field. |
| 2. Three-price TEST pricing | PASS | Landing screenshot shows Self-hosted Free, Monthly €5, Yearly €50. Live environment has `STRIPE_MODE=test` and both paid price bindings. |
| 3. GitHub sign-in | PASS | Real `AlfaBlok` session reached the tenant dashboard. Live OAuth redirect returns to the Phylax callback. |
| 4. Subscribe → tenant row → dashboard | PASS | Durable account record is keyed by a `cs_test_` checkout session, has an active subscription, and binds `github-63050995`; the local tenant row is active on the monthly plan. |
| 5. Hardcoded admin + fresh QR | PASS | `01-fresh-whatsapp-qr.png` and `04-admin-connected.png`; linked number ends `0219`. Live signed-session probe: `AlfaBlok` page/API 200; a signed `someone-else` page/API 404; logged-out admin 404. Session remains connected after exact-SHA redeploy. |
| 6. Inbound keyword verification | PASS | `02-phone-verification-and-pre-wire-routing.png` and `03-tenant-verified-settings.png`; durable tenant setting is verified for sender `34618217703`. Current tests prove friendly `NN-animal` lowercase generation and case-insensitive matching. |
| 7. Tenant settings | PARTIAL | Ring downstream, local transcription, WhatsApp notifications, tenant MCP endpoint/token, and verified number are configured. `telegramBinding` is null and Telegram notifications are off because no live bot is configured. |
| 8. Real WhatsApp text pipe | PASS | `10-clean-text-pipe-whatsapp-web.png`; one inbound audit row, Ring correlation `test_482a1b7c2eca4a7489797013f083723b`, one outbound reply. |
| 9. Real WhatsApp voice pipe | PASS | `12-voice-transcription-pipe-live.png`; message `3EB08DF39E67F9B2227E5F` reached `replied`, Ring received sender + transcript + authenticated artifact reference with `whisper.cpp large-v3-turbo`, and WhatsApp received `voice pipe passed`. |
| 10. MCP server delivery | PARTIAL | WhatsApp `send_message` returned structured provider receipt `3EB0A5D62BF7283727DC42:sent`. Telegram equivalent is not exercised. |
| 11. Two-tenant live isolation | INCOMPLETE | Automated store/chassis tests prove route, secret, settings, and token isolation. Live deployment has only one tenant row and one verified sender; no second real sender exists. |
| 12. Test package | NOT READY | Cannot truthfully issue while SHIP 7/10 Telegram and SHIP 11 live isolation remain incomplete. |

## Runtime probes

- Root: 200
- App: 200
- Unauthenticated MCP: 401
- Logged-out admin: 404
- Signed non-admin admin page/API: 404/404
- Signed `AlfaBlok` admin page/API: 200/200
- WhatsApp state after redeploy: connected, linked number ending `0219`, no last error
- Focused Phylax tests: 27 passed
- Full repository test command: passed

## Remaining exact inputs

1. A Telegram bot token and the Telegram identity/handle to bind and exercise.
2. A second WhatsApp sender identity for a second tenant's real isolation lap. The paired transport number cannot substitute for a distinct inbound tenant sender.
