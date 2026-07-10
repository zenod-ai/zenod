import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type TenantStatus = "active" | "suspended" | "deleted";

export interface TenantContext {
  id: string;
  name?: string;
  plan?: string;
}

export interface UnitContext {
  unitName: string;
  tenant: TenantContext | null;
}

type UnitHonoEnv = {
  Bindings: HttpBindings;
  Variables: {
    tenant: TenantContext | null;
  };
};

export interface TenantTokenRecord {
  tokenHash: string;
  tenant: TenantContext;
  status?: TenantStatus;
  expiresAt?: Date | string | number | null;
}

export interface TenantTokenStore {
  resolveTokenHash(tokenHash: string): Promise<TenantTokenRecord | null> | TenantTokenRecord | null;
}

export interface MemoryTenantInput {
  token: string;
  tenant: TenantContext;
  status?: TenantStatus;
  expiresAt?: Date | string | number | null;
}

export interface MemoryTenantStore extends TenantTokenStore {
  put(input: MemoryTenantInput): TenantTokenRecord;
  snapshot(): TenantTokenRecord[];
}

export interface TenantAuthOptions {
  store: TenantTokenStore;
  realm?: string;
}

export type UnitAuthMiddleware = (c: Context<UnitHonoEnv>, next: Next) => Promise<Response | void>;

export type UnitToolRegistrar = (server: McpServer, context: UnitContext) => void | Promise<void>;

export interface CreateUnitOptions {
  /** Machine name used in health responses and as the MCP server id. */
  name: string;
  /** Semantic version reported by health and MCP initialize. */
  version?: string;
  /** Register this unit's MCP tools on each stateless request server. */
  tools?: UnitToolRegistrar;
  /** Optional tenant auth. When set, every MCP request resolves a tenant first. */
  tenantAuth?: TenantAuthOptions;
}

export interface UnitApp {
  app: Hono<UnitHonoEnv>;
  name: string;
  version: string;
}

function noopAuth(): UnitAuthMiddleware {
  return async (_c, next) => {
    await next();
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createMemoryTenantStore(records: MemoryTenantInput[] = []): MemoryTenantStore {
  const byHash = new Map<string, TenantTokenRecord>();

  const store: MemoryTenantStore = {
    put(input) {
      const tokenHash = hashToken(input.token);
      const record: TenantTokenRecord = {
        tokenHash,
        tenant: { ...input.tenant },
        status: input.status ?? "active",
        expiresAt: input.expiresAt ?? null,
      };
      byHash.set(tokenHash, record);
      return cloneTenantRecord(record);
    },

    resolveTokenHash(tokenHash) {
      const record = byHash.get(tokenHash);
      return record ? cloneTenantRecord(record) : null;
    },

    snapshot() {
      return Array.from(byHash.values()).map(cloneTenantRecord);
    },
  };

  for (const record of records) store.put(record);
  return store;
}

function cloneTenantRecord(record: TenantTokenRecord): TenantTokenRecord {
  return {
    tokenHash: record.tokenHash,
    tenant: { ...record.tenant },
    status: record.status,
    expiresAt: record.expiresAt ?? null,
  };
}

function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function pathToken(c: Context): string | null {
  const token = c.req.param("token");
  return token && token.trim().length > 0 ? token.trim() : null;
}

function presentedToken(c: Context): string | null {
  return bearerToken(c) ?? pathToken(c);
}

function isActive(record: TenantTokenRecord, now = Date.now()): boolean {
  if ((record.status ?? "active") !== "active") return false;
  if (record.expiresAt === null || record.expiresAt === undefined) return true;
  const expiresAt = record.expiresAt instanceof Date ? record.expiresAt.getTime() : new Date(record.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function wwwAuthenticate(realm: string): string {
  const escaped = realm.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `Bearer realm="${escaped}", error="invalid_token"`;
}

export function requireTenantAuth(options: TenantAuthOptions): UnitAuthMiddleware {
  const realm = options.realm?.trim() || "mcp-chassis";
  return async (c, next) => {
    const token = presentedToken(c);
    const record = token ? await options.store.resolveTokenHash(hashToken(token)) : null;

    if (record && isActive(record)) {
      c.set("tenant", { ...record.tenant });
      await next();
      return;
    }

    c.header("WWW-Authenticate", wwwAuthenticate(realm));
    return c.json({ error: "unauthorized" }, 401);
  };
}

async function requestBody(c: Context): Promise<unknown> {
  if (c.req.method !== "POST") return undefined;
  return c.req.json().catch(() => undefined);
}

function nodeBindings(c: Context<UnitHonoEnv>): {
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
  const app = new Hono<UnitHonoEnv>();
  const auth = options.tenantAuth ? requireTenantAuth(options.tenantAuth) : noopAuth();

  app.get("/healthz", (c) => c.json({ status: "ok", name, version }));

  const handleMcp = async (c: Context<UnitHonoEnv>) => {
    const { incoming, outgoing } = nodeBindings(c);
    const server = new McpServer({ name, version });
    await options.tools?.(server, { unitName: name, tenant: c.get("tenant") ?? null });

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
  };

  app.all("/mcp", auth, handleMcp);
  app.all("/mcp/:token", auth, handleMcp);

  return { app, name, version };
}
export * from "./conduct.js";
