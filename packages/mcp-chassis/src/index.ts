import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface UnitContext {
  unitName: string;
}

export type UnitAuthMiddleware = (c: Context<{ Bindings: HttpBindings }>, next: Next) => Promise<Response | void>;

export type UnitToolRegistrar = (server: McpServer, context: UnitContext) => void | Promise<void>;

export interface CreateUnitOptions {
  /** Machine name used in health responses and as the MCP server id. */
  name: string;
  /** Semantic version reported by health and MCP initialize. */
  version?: string;
  /** Register this unit's MCP tools on each stateless request server. */
  tools?: UnitToolRegistrar;
  /** Optional auth middleware. C-2 replaces this with tenant auth. */
  auth?: UnitAuthMiddleware;
}

export interface UnitApp {
  app: Hono<{ Bindings: HttpBindings }>;
  name: string;
  version: string;
}

function noopAuth(): UnitAuthMiddleware {
  return async (_c, next) => {
    await next();
  };
}

async function requestBody(c: Context): Promise<unknown> {
  if (c.req.method !== "POST") return undefined;
  return c.req.json().catch(() => undefined);
}

function nodeBindings(c: Context<{ Bindings: HttpBindings }>): {
  incoming: IncomingMessage;
  outgoing: ServerResponse;
} {
  const { incoming, outgoing } = c.env;
  if (!incoming || !outgoing) {
    throw new Error("MCP chassis requires @hono/node-server HttpBindings");
  }
  return { incoming, outgoing };
}

export function createUnit(options: CreateUnitOptions): UnitApp {
  const name = options.name.trim();
  if (!name) throw new Error("createUnit requires a non-empty name");

  const version = options.version?.trim() || "0.0.0";
  const app = new Hono<{ Bindings: HttpBindings }>();
  const auth = options.auth ?? noopAuth();

  app.get("/healthz", (c) => c.json({ status: "ok", name, version }));

  app.all("/mcp", auth, async (c) => {
    const { incoming, outgoing } = nodeBindings(c);
    const server = new McpServer({ name, version });
    await options.tools?.(server, { unitName: name });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(incoming, outgoing, await requestBody(c));
    return RESPONSE_ALREADY_SENT;
  });

  return { app, name, version };
}
export * from "./conduct.js";
