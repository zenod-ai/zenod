# @zenod/mcp-chassis

Reusable scaffold for Zenod-family MCP units.

```ts
import { createUnit } from "@zenod/mcp-chassis";

const unit = createUnit({
  name: "demo",
  version: "0.0.1",
  tools(server) {
    server.tool("ping", "Return pong", {}, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
  },
});

export default unit.app;
```

This first slice lifts the stateless Streamable HTTP transport shape from
`packages/server`: each `/mcp` request receives a fresh MCP server and fresh
transport, with JSON responses enabled. Tenant auth, provisioning, storage,
metering, UI, OAuth, billing, and conduct middleware are delivered by the
following Epic 3.1 tickets.
