# @zenod/mcp-chassis

Reusable scaffold for Zenod-family MCP units.

```ts
import { createMemoryTenantStore, createUnit } from "@zenod/mcp-chassis";

const unit = createUnit({
  name: "demo",
  version: "0.0.1",
  tenantAuth: {
    store: createMemoryTenantStore([
      { token: "raw-token-shown-once", tenant: { id: "tenant_1" } },
    ]),
  },
  ui: {
    webDist: process.env.ZENOD_WEB_DIST,
    displayName: "Demo",
    tagline: "Demo unit settings",
    panels: ["keys", "connections", "costs"],
  },
  tools(server) {
    server.tool("ping", "Return pong", {}, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
  },
});

export default unit.app;
```

The chassis serves stateless Streamable HTTP at `/mcp` and `/mcp/<token>`.
When `tenantAuth` is configured, raw bearer tokens are SHA-256 hashed before
lookup, only hashes are stored in the tenant table, and `tools` receives the
resolved `context.tenant` for the request. Unknown, disabled, expired, or
mutated tokens return `401` with `WWW-Authenticate`.

`ui` reuses the existing React console build. Token login issues a signed,
tenant-scoped session cookie; `/api/overview`, `/api/keys`, `/api/settings`,
`/api/token`, and `/api/connections` resolve the tenant from that session or a
bearer token and never accept a client-supplied tenant id. `panels` selects which
existing console tabs the unit exposes.

Storage, metering, billing, and conduct middleware are delivered by the
following Epic 3.1 tickets.

## OAuth kit

`createUnit({ oauth })` can enable both chassis-owned OAuth surfaces:

- `oauth.server: true` installs the MCP-client sign-in server routes:
  `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
  `/oauth/register`, `/oauth/authorize`, and `/oauth/token`. Consent authenticates
  with a tenant token, so issued MCP access tokens resolve back to that tenant.
- `oauth.providers` declares outbound/world OAuth providers. The chassis installs
  `/api/oauth/providers/<id>/start` and `/api/oauth/providers/<id>/callback`.
  Start is tenant-authenticated, state is bound to that tenant, callback rejects
  tenant/state mismatches, and exchanged tokens are stored in the tenant vault
  under `oauth:<id>` by default.

Unit tests use a deterministic fake provider, so no external credentials are
needed to prove the framework.
