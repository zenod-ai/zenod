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

Provisioning, storage, metering, UI, OAuth, billing, and conduct middleware are
delivered by the following Epic 3.1 tickets.
