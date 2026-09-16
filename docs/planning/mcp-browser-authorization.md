# MCP browser authorization

Requested by Jordi on 2026-09-16: a shared MCP URL and normal browser sign-in/consent, with no manual tenant token. Jordi will perform the Grok Bot acceptance and relay the experience.

Implemented on `codex/mcp-browser-auth`, from `e2fabb4`:

- Hosted consent authenticates the existing customer browser session and resolves its active workspace. Signed-in users see the requesting app, account, workspace, and Allow/Deny.
- Signed-out users go through existing GitHub sign-in and return to the exact pending consent request. The return path is restricted to the local consent route, signed, and bound to a browser cookie.
- Consent is one-use, expires after ten minutes, and binds account, workspace, origin, and authorization parameters. The account's active entitlement and credential binding are checked again when approving.
- Hosted account endpoints and the Connect / MCP screen publish the shared `/mcp` URL. Advanced bearer-token setup remains available; existing token-bearing endpoints continue to work.
- Discovery and authorization bypass the SPA fallback. The consent page's CSP permits the registered callback origin so browser form redirects can complete.
- Hosted OAuth requests pass through the same current entitlement, capability, and usage controls as direct credentials.

The default published hostname remains `cloud.zenod.dev`; this source change does not alter DNS, Cloudflare rules, or reverse-proxy routing for `zenod.dev`. The reported “Cursor” name is client-supplied registration metadata; this change displays the supplied name and does not silently replace it with “Grok”.

Validation: the first browser-auth implementation passed 12 focused integration tests, including an actual MCP SDK connection, before the user requested that further testing be left to them. Subsequent callback CSP, shared-route fallback, and existing-grant entitlement refinements were compiled but not rerun through tests. The final chassis/server/web production builds pass. No live deployment or Grok acceptance has occurred.

Human acceptance after deployment: reopen the Zenod connector in Grok Bot, using the shared MCP URL. With an existing Zenod browser session, expect account/workspace consent and Allow; with no session, expect sign-in followed by the same consent. After approval, Grok should finish connecting. Relay the requesting app name, displayed workspace, redirect outcome, and any error without sharing credentials.

Deployment remains subject to the repository's production gate: prepare the exact immutable image, current target and rollback image, configuration delta, and backup evidence before requesting the final production approval. Keep public signup, billing, channel sessions, and unrelated services unchanged.
