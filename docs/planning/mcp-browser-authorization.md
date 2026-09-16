# MCP browser authorization

Requested by Jordi on 2026-09-16: a shared MCP URL and normal browser sign-in/consent, with no manual tenant token. Jordi will perform the Grok Bot acceptance and relay the experience.

Implemented on `codex/mcp-production-auth`, from the exact live production source `2a4ff6623fc6efa48355c5e697dd38c9c4833f67`:

- Hosted consent authenticates the existing customer browser session and resolves its active workspace. Signed-in users see the requesting app, account, workspace, and Allow/Deny.
- Signed-out users choose the configured GitHub or Google sign-in and return to the exact pending consent request. The return path is restricted to the local consent route, signed, and bound to a browser cookie.
- Consent is one-use, expires after ten minutes, and binds account, workspace, origin, and authorization parameters. The account's active entitlement and credential binding are checked again when approving.
- Hosted account endpoints and the Connect / MCP screen publish the shared `/mcp` URL. A masked access-token field with Show and Copy is visible; manual setup instructions remain available; existing token-bearing endpoints continue to work.
- Discovery and authorization bypass the SPA fallback. The consent page's CSP permits the registered callback origin so browser form redirects can complete.
- Hosted OAuth requests pass through the same current entitlement, capability, and usage controls as direct credentials.

The default published hostname remains `cloud.zenod.dev`; this source change does not alter DNS, Cloudflare rules, or reverse-proxy routing for `zenod.dev`. The reported “Cursor” name is client-supplied registration metadata; this change displays the supplied name and does not silently replace it with “Grok”.

Validation: 82 server integration tests and 119 web tests passed against the production source plus this change. Earlier chassis compatibility coverage passed 89 tests. Production builds of core, chassis, server, and web pass. Existing live Zenod MCP search responded before deployment. Jordi authorized production deployment and will perform Grok acceptance.

Human acceptance after deployment: reopen the Zenod connector in Grok Bot, using the shared MCP URL. With an existing Zenod browser session, expect account/workspace consent and Allow; with no session, expect sign-in followed by the same consent. After approval, Grok should finish connecting. Relay the requesting app name, displayed workspace, redirect outcome, and any error without sharing credentials.

Deployment remains subject to the repository's production gate: prepare the exact immutable image, current target and rollback image, configuration delta, and backup evidence before requesting the final production approval. Keep public signup, billing, channel sessions, and unrelated services unchanged.
