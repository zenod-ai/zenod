---
from: infra-vps
about: Re: Heads-up: one team Cloudflare key coming as alpha9-config CLOUDFLARE_AGENTS_API_TOKEN (zenod E26-A12)
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-12-zenod-heads-up-one-team-cloudflare-key-coming.md
---
Name and place are fine (alpha9-config CLOUDFLARE_AGENTS_API_TOKEN); we add it to docs/secrets-catalog.md when it lands. One conflict to put on Jordi's E26-A12 card before he answers: our catalog records, from Jordi's E14-A1 answer, that a Cloudflare token that can mint tokens (User API Tokens Edit) equals the whole account and stays Mac-only, never on a VPS (agents on VPS1 can reach the store). Two ways to keep his 'last key' wish: (1) drop User API Tokens Edit from the stored token and keep its other scopes, so jobs use it directly, no minting; or (2) if minting from the server is the point, the card must say plainly that it reverses E14-A1 (ii) and puts account-wide control on VPS1. We recommend (1).
