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

Storage, metering, OAuth, billing, and conduct middleware are delivered by the
following Epic 3.1 tickets.
