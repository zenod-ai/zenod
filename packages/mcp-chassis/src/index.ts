import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ChassisStorage, type ChassisStorageOptions, type TenantStorage } from "./storage.js";

export type TenantStatus = "active" | "suspended" | "deleted";

export interface TenantContext {
  id: string;
  name?: string;
  plan?: string;
}

export interface UnitContext {
  unitName: string;
  tenant: TenantContext | null;
  /** Tenant-bound storage handles. Unit tools must not accept tenant ids from client payloads. */
  storage: TenantStorage | null;
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

export interface ProvisionTenantInput {
  tenant?: Partial<TenantContext>;
  tenantId?: string;
  name?: string;
  plan?: string;
  token?: string;
  status?: TenantStatus;
  expiresAt?: Date | string | number | null;
}

export interface ProvisionTenantResult {
  token: string;
  record: TenantTokenRecord;
}

export interface TenantProvisioningStore extends TenantTokenStore {
  provisionTenant(input?: ProvisionTenantInput): Promise<ProvisionTenantResult> | ProvisionTenantResult;
  rotateTenantToken(tenantId: string): Promise<ProvisionTenantResult | null> | ProvisionTenantResult | null;
  setTenantStatus(
    tenantId: string,
    status: TenantStatus,
  ): Promise<TenantTokenRecord | null> | TenantTokenRecord | null;
}

export interface MemoryTenantStore extends TenantProvisioningStore {
  put(input: MemoryTenantInput): TenantTokenRecord;
  provisionTenant(input?: ProvisionTenantInput): ProvisionTenantResult;
  rotateTenantToken(tenantId: string): ProvisionTenantResult | null;
  setTenantStatus(tenantId: string, status: TenantStatus): TenantTokenRecord | null;
  snapshot(): TenantTokenRecord[];
}

export interface TenantAuthOptions {
  store: TenantTokenStore;
  realm?: string;
}

export interface ControlPlaneOptions {
  store?: TenantProvisioningStore;
  token?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface SingleTenantOptions {
  store?: MemoryTenantStore;
  token?: string | null;
  tokenEnvVar?: string;
  env?: NodeJS.ProcessEnv;
  tenant?: Partial<TenantContext>;
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
  /** Optional control-plane tenant provisioning API. */
  controlPlane?: ControlPlaneOptions;
  /** Optional same-image self-host seed tenant. */
  singleTenant?: SingleTenantOptions;
  /** Tenant storage seam. Defaults to DATA_DIR or /data and is only materialized after tenant resolution. */
  storage?: ChassisStorage | ChassisStorageOptions;
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

export function generateTenantToken(): string {
  return `zenod_${randomBytes(24).toString("hex")}`;
}

export function createMemoryTenantStore(records: MemoryTenantInput[] = []): MemoryTenantStore {
  const byHash = new Map<string, string>();
  const byTenant = new Map<string, TenantTokenRecord>();

  const store: MemoryTenantStore = {
    put(input) {
      const tokenHash = hashToken(input.token);
      const existing = byTenant.get(input.tenant.id);
      if (existing) byHash.delete(existing.tokenHash);
      const record: TenantTokenRecord = {
        tokenHash,
        tenant: { ...input.tenant },
        status: input.status ?? "active",
        expiresAt: input.expiresAt ?? null,
      };
      byHash.set(tokenHash, record.tenant.id);
      byTenant.set(record.tenant.id, record);
      return cloneTenantRecord(record);
    },

    resolveTokenHash(tokenHash) {
      const tenantId = byHash.get(tokenHash);
      const record = tenantId ? byTenant.get(tenantId) : null;
      return record ? cloneTenantRecord(record) : null;
    },

    provisionTenant(input = {}) {
      const tenant = normalizeProvisionTenant(input, byTenant.size + 1);
      const token = input.token?.trim() || generateTenantToken();
      const record = store.put({
        token,
        tenant,
        status: input.status ?? "active",
        expiresAt: input.expiresAt ?? null,
      });
      return { token, record };
    },

    rotateTenantToken(tenantId) {
      const id = tenantId.trim();
      const existing = id ? byTenant.get(id) : null;
      if (!existing) return null;
      return store.provisionTenant({
        tenant: existing.tenant,
        status: "active",
        expiresAt: existing.expiresAt ?? null,
      });
    },

    setTenantStatus(tenantId, status) {
      const id = tenantId.trim();
      const existing = id ? byTenant.get(id) : null;
      if (!existing) return null;
      const record: TenantTokenRecord = { ...existing, tenant: { ...existing.tenant }, status };
      byTenant.set(id, record);
      return cloneTenantRecord(record);
    },

    snapshot() {
      return Array.from(byTenant.values()).map(cloneTenantRecord);
    },
  };

  for (const record of records) store.put(record);
  return store;
}

function normalizeProvisionTenant(input: ProvisionTenantInput, ordinal: number): TenantContext {
  const tenant = input.tenant ?? {};
  const id = (input.tenantId ?? tenant.id ?? `tenant-${ordinal}`).trim();
  if (!id) throw new Error("tenant id must be non-empty");
  return {
    id,
    ...(input.name ?? tenant.name ? { name: input.name ?? tenant.name } : {}),
    ...(input.plan ?? tenant.plan ? { plan: input.plan ?? tenant.plan } : {}),
  };
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

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function controlPlaneToken(options: ControlPlaneOptions): string | null {
  const token = options.token ?? options.env?.CONTROL_PLANE_TOKEN ?? process.env.CONTROL_PLANE_TOKEN ?? null;
  const trimmed = token?.trim();
  return trimmed || null;
}

function requireControlPlane(options: ControlPlaneOptions): UnitAuthMiddleware {
  return async (c, next) => {
    const expected = controlPlaneToken(options);
    const token = bearerToken(c);

    if (expected && token && timingSafeStringEqual(token, expected)) {
      await next();
      return;
    }

    c.header("WWW-Authenticate", wwwAuthenticate("mcp-chassis-control-plane"));
    return c.json({ error: "unauthorized" }, 401);
  };
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

export function seedSingleTenantFromEnv(
  store: MemoryTenantStore,
  options: SingleTenantOptions & { unitName?: string } = {},
): TenantTokenRecord | null {
  const env = options.env ?? process.env;
  const tokenEnvVar = options.tokenEnvVar ?? `${(options.unitName ?? "ZENOD").toUpperCase()}_API_TOKEN`;
  const token = options.token ?? env[tokenEnvVar] ?? env.ZENOD_API_TOKEN ?? null;
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return store.provisionTenant({
    tenant: { id: "self-host", name: "Self-host", plan: "self-host", ...options.tenant },
    token: trimmed,
  }).record;
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

function storageFromOptions(storage: CreateUnitOptions["storage"]): ChassisStorage {
  return storage instanceof ChassisStorage ? storage : new ChassisStorage(storage);
}

export function createUnit(options: CreateUnitOptions): UnitApp {
  const name = options.name.trim();
  if (!name) throw new Error("createUnit requires a non-empty name");

  const version = options.version?.trim() || "0.0.0";
  const app = new Hono<UnitHonoEnv>();
  const auth = options.tenantAuth ? requireTenantAuth(options.tenantAuth) : noopAuth();
  const storage = storageFromOptions(options.storage);
  const defaultProvisioningStore = isTenantProvisioningStore(options.tenantAuth?.store)
    ? options.tenantAuth.store
    : null;
  const provisioningStore = options.controlPlane?.store ?? defaultProvisioningStore;

  if (options.singleTenant) {
    const store = options.singleTenant.store ?? (isMemoryTenantStore(provisioningStore) ? provisioningStore : null);
    if (store) seedSingleTenantFromEnv(store, { ...options.singleTenant, unitName: name.toUpperCase() });
  }

  app.get("/healthz", (c) => c.json({ status: "ok", name, version }));

  if (options.controlPlane && provisioningStore) {
    const controlPlaneAuth = requireControlPlane(options.controlPlane);

    app.post("/api/tenants", controlPlaneAuth, async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const result = await provisioningStore.provisionTenant(parseProvisionTenantBody(body));
      return c.json(toProvisionTenantResponse(result), 201);
    });

    app.patch("/api/tenants/:tenantId", controlPlaneAuth, async (c) => {
      const status = parseTenantStatus(await c.req.json().catch(() => ({})));
      if (!status || status === "deleted") return c.json({ error: "invalid status" }, 400);
      const record = await provisioningStore.setTenantStatus(c.req.param("tenantId") ?? "", status);
      if (!record) return c.json({ error: "tenant not found" }, 404);
      return c.json({ tenant: record.tenant, status: record.status ?? "active" });
    });

    app.post("/api/tenants/:tenantId/token/rotate", controlPlaneAuth, async (c) => {
      const result = await provisioningStore.rotateTenantToken(c.req.param("tenantId") ?? "");
      if (!result) return c.json({ error: "tenant not found" }, 404);
      return c.json(toProvisionTenantResponse(result));
    });

    app.delete("/api/tenants/:tenantId", controlPlaneAuth, async (c) => {
      const record = await provisioningStore.setTenantStatus(c.req.param("tenantId") ?? "", "deleted");
      if (!record) return c.json({ error: "tenant not found" }, 404);
      return c.json({ tenant: record.tenant, status: "deleted" });
    });
  }

  const handleMcp = async (c: Context<UnitHonoEnv>) => {
    const { incoming, outgoing } = nodeBindings(c);
    const server = new McpServer({ name, version });
    const tenant = c.get("tenant") ?? null;
    await options.tools?.(server, {
      unitName: name,
      tenant,
      storage: tenant ? storage.forTenant(tenant) : null,
    });

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
function isTenantProvisioningStore(store: TenantTokenStore | undefined): store is TenantProvisioningStore {
  return Boolean(
    store &&
      "provisionTenant" in store &&
      "rotateTenantToken" in store &&
      "setTenantStatus" in store,
  );
}

function isMemoryTenantStore(store: TenantProvisioningStore | null): store is MemoryTenantStore {
  return Boolean(store && "put" in store && "snapshot" in store);
}

function parseProvisionTenantBody(body: unknown): ProvisionTenantInput {
  if (!body || typeof body !== "object") return {};
  const input = body as Record<string, unknown>;
  const tenantInput = input.tenant && typeof input.tenant === "object" ? (input.tenant as Record<string, unknown>) : {};
  return {
    tenantId: stringOrUndefined(input.tenantId) ?? stringOrUndefined(input.id) ?? stringOrUndefined(tenantInput.id),
    name: stringOrUndefined(input.name) ?? stringOrUndefined(tenantInput.name),
    plan: stringOrUndefined(input.plan) ?? stringOrUndefined(tenantInput.plan),
  };
}

function parseTenantStatus(body: unknown): TenantStatus | null {
  if (!body || typeof body !== "object") return null;
  const status = (body as Record<string, unknown>).status;
  return status === "active" || status === "suspended" || status === "deleted" ? status : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toProvisionTenantResponse(result: ProvisionTenantResult): {
  tenant: TenantContext;
  status: TenantStatus;
  token: string;
} {
  return {
    tenant: result.record.tenant,
    status: result.record.status ?? "active",
    token: result.token,
  };
}

export * from "./conduct.js";
export { ChassisStorage, TenantVault, openSqlite } from "./storage.js";
export type { ChassisStorageOptions, TenantStorage, UnitTenant } from "./storage.js";
