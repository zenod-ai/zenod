import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HttpBindings } from "@hono/node-server";
import {
  serveStatic,
  type ServeStaticOptions,
} from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Logger } from "pino";
import {
  isBillingEnabled,
  registerBillingRoutes,
  type BillingOptions,
} from "./billing.js";
import type { OAuthKitOptions } from "./oauth.js";
import {
  installOAuthRoutes,
  oauthWwwAuthenticate,
  publicBaseUrl,
  resolveOAuthKit,
} from "./oauth.js";
import {
  createChassisLogger,
  createRequestLogContext,
  safeRequestPath,
  type ChassisLoggingOptions,
} from "./logging.js";
import {
  MemoryOperatingRulesStore,
  type OperatingRulesStore,
  type TurnPreamble,
} from "./rules.js";
import {
  ChassisStorage,
  type ChassisStorageOptions,
  type TenantStorage,
} from "./storage.js";
import {
  ChassisUsageStore,
  type ChassisUsageStoreOptions,
  type TenantUsageMeter,
} from "./usage.js";
import { SqliteTenantSettingsStore } from "./settings.js";
import {
  assertRegisteredToolResult,
  ConductContractError,
  conductErrorResult,
  isStructuredConductErrorResult,
  registeredToolConductProfile,
  type ConductPayload,
  type ConductOptions,
  type McpLikeToolResult,
  type RegisteredToolConductProfile,
} from "./conduct.js";
export type { BillingOptions } from "./billing.js";
export type { ChassisLoggingOptions } from "./logging.js";
export {
  defaultTenantSettingsValues,
  SqliteTenantSettingsStore,
  TENANT_SECRET_SETTING_KEYS,
  TENANT_SETTING_KEYS,
  type TenantKeyMetadata,
  type TenantSecretSettingKey,
  type TenantSettingKey,
  type TenantSettingsSnapshot,
  type TenantSettingsValues,
} from "./settings.js";
export {
  createSqliteTenantStore,
  SqliteTenantStore,
  type ImportTenantTokenHashInput,
  type SqliteTenantStoreOptions,
} from "./sqliteTenantStore.js";

export type TenantStatus = "active" | "suspended" | "deleted";

export interface TenantContext {
  id: string;
  name?: string;
  plan?: string;
  quota?: number | null;
}

export interface UnitContext {
  unitName: string;
  tenant: TenantContext | null;
  /** Request-scoped pino logger carrying request_id and explicit tenant_id. */
  logger: Logger;
  requestId: string;
  /** Tenant-bound storage handles. Unit tools must not accept tenant ids from client payloads. */
  storage: TenantStorage | null;
  /** Tenant-bound usage meter. Unit tools must never query usage for a client-supplied tenant id. */
  usage: TenantUsageMeter | null;
  /** Freshly read active operating directives for this MCP turn. */
  operatingRules: TurnPreamble | null;
}

export interface TenantUnitContext extends UnitContext {
  tenant: TenantContext;
  storage: TenantStorage;
}

export type UnitHonoEnv = {
  Bindings: HttpBindings;
  Variables: {
    tenant: TenantContext | null;
    unitContext: TenantUnitContext;
    requestId: string;
  };
};

export interface TenantTokenRecord {
  tokenHash: string;
  tenant: TenantContext;
  status?: TenantStatus;
  expiresAt?: Date | string | number | null;
}

export interface TenantTokenStore {
  resolveTokenHash(
    tokenHash: string,
  ): Promise<TenantTokenRecord | null> | TenantTokenRecord | null;
}

export interface TenantOAuthAccessToken {
  tenant: TenantContext;
  clientId: string;
  clientName: string;
  scope: string;
  expiresAt: number;
}

export interface TenantOAuthAccessTokenStore {
  resolveOAuthAccessToken(
    accessToken: string,
  ): Promise<TenantOAuthAccessToken | null> | TenantOAuthAccessToken | null;
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
  quota?: number | null;
  token?: string;
  status?: TenantStatus;
  expiresAt?: Date | string | number | null;
}

export interface ProvisionTenantResult {
  token: string;
  record: TenantTokenRecord;
}

export interface TenantProvisioningStore extends TenantTokenStore {
  provisionTenant(
    input?: ProvisionTenantInput,
  ): Promise<ProvisionTenantResult> | ProvisionTenantResult;
  rotateTenantToken(
    tenantId: string,
  ): Promise<ProvisionTenantResult | null> | ProvisionTenantResult | null;
  setTenantStatus(
    tenantId: string,
    status: TenantStatus,
  ): Promise<TenantTokenRecord | null> | TenantTokenRecord | null;
}

export interface MemoryTenantStore extends TenantProvisioningStore {
  put(input: MemoryTenantInput): TenantTokenRecord;
  provisionTenant(input?: ProvisionTenantInput): ProvisionTenantResult;
  rotateTenantToken(tenantId: string): ProvisionTenantResult | null;
  setTenantStatus(
    tenantId: string,
    status: TenantStatus,
  ): TenantTokenRecord | null;
  snapshot(): TenantTokenRecord[];
}

export interface TenantAuthOptions {
  store: TenantTokenStore;
  oauth?: TenantOAuthAccessTokenStore;
  oauthChallenge?: boolean;
  realm?: string;
}

export interface ControlPlaneOptions {
  store?: TenantProvisioningStore;
  token?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface SingleTenantOptions {
  store?: TenantProvisioningStore;
  token?: string | null;
  tokenEnvVar?: string;
  env?: NodeJS.ProcessEnv;
  tenant?: Partial<TenantContext>;
}

export type UnitUiPanel =
  | "chat"
  | "team"
  | "vault"
  | "keys"
  | "transcription"
  | "connections"
  | "costs"
  | "rules"
  | "mcp"
  | "skills"
  | "test"
  | string;

export interface UnitUiOptions {
  /** Directory with the built React console (apps/web/dist). */
  webDist?: string;
  /** Human-facing title returned from /api/agent. */
  displayName?: string;
  /** Human-facing subtitle returned from /api/agent. */
  tagline?: string;
  /** Existing console panels this unit wants visible. */
  panels?: UnitUiPanel[];
  /** Signing secret for tenant-scoped session cookies. Generated at boot if omitted. */
  sessionSecret?: string;
  /** Session cookie name. Defaults to zenod_session for console compatibility. */
  sessionCookieName?: string;
}

export const ATOMIC_UNIT_SKILL_MANIFEST_PATH =
  "/.well-known/atomic-unit-skill.json";
export const ATOMIC_UNIT_SKILL_SCHEMA_VERSION = "1.0" as const;

/** Deployment metadata used to publish a tenant-neutral D16 skill card. */
export interface UnitSkillManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  purpose: string;
  whenToRoute: string[];
  tools: string[];
  etiquette: string[];
  receiptExpectations: string[];
  /** Optional same-origin public bundle imported by capable hosts on connection. */
  bundleUrl?: string;
}

export interface PublishedUnitSkillManifest extends UnitSkillManifest {
  schemaVersion: typeof ATOMIC_UNIT_SKILL_SCHEMA_VERSION;
  unit: {
    name: string;
    version: string;
  };
  bundle?: {
    format: "zenod-agent-skill-bundle-v1";
    url: string;
  };
}

export interface OperatingRulesOptions {
  store?: OperatingRulesStore;
}

export type UnitAuthMiddleware = (
  c: Context<UnitHonoEnv>,
  next: Next,
) => Promise<Response | void>;

export type UnitToolRegistrar = (
  server: McpServer,
  context: UnitContext,
) => void | Promise<void>;

/** Register tenant-authenticated HTTP routes before the optional SPA fallback. */
export type UnitRouteRegistrar = (routes: Hono<UnitHonoEnv>) => void;

export interface CreateUnitOptions {
  /** Machine name used in health responses and as the MCP server id. */
  name: string;
  /** Semantic version reported by health and MCP initialize. */
  version?: string;
  /** Register this unit's MCP tools on each stateless request server. */
  tools?: UnitToolRegistrar;
  /** Register unit product APIs on an automatically tenant-authenticated sub-router. */
  routes?: UnitRouteRegistrar;
  /** Optional tenant auth. When set, every MCP request resolves a tenant first. */
  tenantAuth?: TenantAuthOptions;
  /** Structured request/tool logging. Defaults to pino at LOG_LEVEL or info. */
  logging?: ChassisLoggingOptions;
  /** Optional control-plane tenant provisioning API. */
  controlPlane?: ControlPlaneOptions;
  /** Optional same-image self-host seed tenant. */
  singleTenant?: SingleTenantOptions;
  /** Tenant storage seam. Defaults to DATA_DIR or /data and is only materialized after tenant resolution. */
  storage?: ChassisStorage | ChassisStorageOptions;
  /** Tenant usage ledger and quota checks. Defaults on when a storage/data dir is configured. */
  metering?: ChassisUsageStore | ChassisUsageStoreOptions | false;
  /** Optional tenant-scoped settings UI shell. */
  ui?: UnitUiOptions;
  /** OAuth server for MCP-client sign-in and OAuth client providers for world connections. */
  oauth?: OAuthKitOptions;
  /** Optional unit-local billing webhook and checkout return handlers. */
  billing?: BillingOptions;
  /** Tenant-scoped standing directives and conduct receipt feed. */
  operatingRules?: OperatingRulesOptions;
  /** Unit-published skill card rendered by the chassis skill settings panel. */
  skill?: UnitSkillManifest;
  /** Tenant-installed skill cards rendered by the chassis skill settings panel. */
  skills?: UnitSkillManifest[];
  /** Always-on receipt/ticket enforcement declarations for this unit's tools. */
  conduct?: ConductOptions;
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

export function createMemoryTenantStore(
  records: MemoryTenantInput[] = [],
): MemoryTenantStore {
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
      const record: TenantTokenRecord = {
        ...existing,
        tenant: { ...existing.tenant },
        status,
      };
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

function normalizeProvisionTenant(
  input: ProvisionTenantInput,
  ordinal: number,
): TenantContext {
  const tenant = input.tenant ?? {};
  const id = (input.tenantId ?? tenant.id ?? `tenant-${ordinal}`).trim();
  if (!id) throw new Error("tenant id must be non-empty");
  return {
    id,
    ...((input.name ?? tenant.name) ? { name: input.name ?? tenant.name } : {}),
    ...((input.plan ?? tenant.plan) ? { plan: input.plan ?? tenant.plan } : {}),
    ...(input.quota !== undefined || tenant.quota !== undefined
      ? { quota: input.quota ?? tenant.quota ?? null }
      : {}),
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
  const expiresAt =
    record.expiresAt instanceof Date
      ? record.expiresAt.getTime()
      : new Date(record.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function wwwAuthenticate(realm: string): string {
  const escaped = realm.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `Bearer realm="${escaped}", error="invalid_token"`;
}

function unauthorized(
  c: Context,
  realm: string,
  oauthChallenge: boolean,
): Response {
  c.header(
    "WWW-Authenticate",
    oauthChallenge
      ? oauthWwwAuthenticate(publicBaseUrl(c))
      : wwwAuthenticate(realm),
  );
  return c.json({ error: "unauthorized" }, 401);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function controlPlaneToken(options: ControlPlaneOptions): string | null {
  const token =
    options.token ??
    options.env?.CONTROL_PLANE_TOKEN ??
    process.env.CONTROL_PLANE_TOKEN ??
    null;
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

export function requireTenantAuth(
  options: TenantAuthOptions,
): UnitAuthMiddleware {
  const realm = options.realm?.trim() || "mcp-chassis";
  return async (c, next) => {
    const tenant = await resolveAuthenticatedTenant(c, options);
    if (tenant) {
      c.set("tenant", tenant);
      await next();
      return;
    }

    return unauthorized(c, realm, options.oauthChallenge === true);
  };
}

async function resolveAuthenticatedTenant(
  c: Context<UnitHonoEnv>,
  options: TenantAuthOptions,
): Promise<TenantContext | null> {
  const token = presentedToken(c);
  const record = token
    ? await options.store.resolveTokenHash(hashToken(token))
    : null;
  if (record && isActive(record)) return { ...record.tenant };

  const bearer = bearerToken(c);
  const oauthToken =
    bearer && options.oauth
      ? await options.oauth.resolveOAuthAccessToken(bearer)
      : null;
  return oauthToken && oauthToken.expiresAt > Date.now()
    ? { ...oauthToken.tenant }
    : null;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_UI_PANELS: UnitUiPanel[] = [
  "chat",
  "rules",
  "mcp",
  "skills",
  "keys",
  "connections",
  "costs",
];

interface UiSessionPayload {
  expires: number;
  tenant: TenantContext;
}

function encodeSessionPayload(payload: UiSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSessionPayload(encoded: string): UiSessionPayload | null {
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<UiSessionPayload>;
    if (
      !value ||
      typeof value.expires !== "number" ||
      !value.tenant ||
      typeof value.tenant.id !== "string"
    ) {
      return null;
    }
    if (!value.tenant.id.trim()) return null;
    return {
      expires: value.expires,
      tenant: {
        id: value.tenant.id,
        ...(typeof value.tenant.name === "string"
          ? { name: value.tenant.name }
          : {}),
        ...(typeof value.tenant.plan === "string"
          ? { plan: value.tenant.plan }
          : {}),
        ...(typeof value.tenant.quota === "number" || value.tenant.quota === null
          ? { quota: value.tenant.quota }
          : {}),
      },
    };
  } catch {
    return null;
  }
}

function issueTenantSession(
  c: Context,
  ui: RequiredUiOptions,
  tenant: TenantContext,
  now = Date.now(),
): void {
  const payload = encodeSessionPayload({
    expires: now + SESSION_TTL_MS,
    tenant,
  });
  const token = `${payload}.${sign(ui.sessionSecret, payload)}`;
  setCookie(c, ui.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

function clearTenantSession(c: Context, ui: RequiredUiOptions): void {
  deleteCookie(c, ui.sessionCookieName, { path: "/" });
}

function resolveTenantSession(
  c: Context,
  ui: RequiredUiOptions,
  now = Date.now(),
): TenantContext | null {
  const cookie = getCookie(c, ui.sessionCookieName);
  if (!cookie) return null;
  const [payload, mac] = cookie.split(".");
  if (!payload || !mac) return null;
  const expected = sign(ui.sessionSecret, payload);
  if (!timingSafeStringEqual(mac, expected)) return null;
  const decoded = decodeSessionPayload(payload);
  if (!decoded || decoded.expires < now) return null;
  return decoded.tenant;
}

async function resolveTenantToken(
  store: TenantTokenStore,
  token: string | null,
): Promise<TenantTokenRecord | null> {
  if (!token) return null;
  const record = await store.resolveTokenHash(hashToken(token));
  return record && isActive(record) ? record : null;
}

type RequiredUiOptions = Required<
  Pick<UnitUiOptions, "sessionSecret" | "sessionCookieName">
> &
  Omit<UnitUiOptions, "sessionSecret" | "sessionCookieName">;

function normalizeUiOptions(
  name: string,
  ui: UnitUiOptions,
): RequiredUiOptions {
  return {
    ...ui,
    displayName: ui.displayName?.trim() || displayNameFromId(name),
    tagline: ui.tagline?.trim() || "MCP unit settings",
    panels: ui.panels?.length ? [...ui.panels] : [...DEFAULT_UI_PANELS],
    sessionSecret: ui.sessionSecret?.trim() || randomBytes(32).toString("hex"),
    sessionCookieName: ui.sessionCookieName?.trim() || "zenod_session",
  };
}

function displayNameFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function seedSingleTenantFromEnv(
  store: TenantProvisioningStore,
  options: SingleTenantOptions & { unitName?: string } = {},
): TenantTokenRecord | null {
  const env = options.env ?? process.env;
  const tokenEnvVar =
    options.tokenEnvVar ??
    `${(options.unitName ?? "ZENOD").toUpperCase()}_API_TOKEN`;
  const token =
    options.token ?? env[tokenEnvVar] ?? env.ZENOD_API_TOKEN ?? null;
  const trimmed = token?.trim();
  if (!trimmed) return null;
  const result = store.provisionTenant({
    tenant: {
      id: "self-host",
      name: "Self-host",
      plan: "self-host",
      ...options.tenant,
    },
    token: trimmed,
  });
  if (typeof (result as Promise<ProvisionTenantResult>).then === "function") {
    throw new Error("singleTenant provisioning store must be synchronous at boot");
  }
  return (result as ProvisionTenantResult).record;
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

function storageFromOptions(
  storage: CreateUnitOptions["storage"],
): ChassisStorage {
  return storage instanceof ChassisStorage
    ? storage
    : new ChassisStorage(storage);
}

function lazyUsageStore(
  metering: CreateUnitOptions["metering"],
  storage: ChassisStorage,
  enabledByDefault: boolean,
): () => ChassisUsageStore | null {
  if (metering === false) return () => null;
  if (metering instanceof ChassisUsageStore) return () => metering;
  if (metering === undefined && !enabledByDefault) return () => null;
  let store: ChassisUsageStore | null = null;
  return () => {
    store ??= new ChassisUsageStore({
      dataDir: storage.dataDir,
      ...(metering ?? {}),
    });
    return store;
  };
}

function quotaExceededResponse(
  c: Context<UnitHonoEnv>,
  decision: ReturnType<TenantUsageMeter["checkQuota"]>,
): Response {
  return c.json(
    {
      error: "quota_exceeded",
      quota: decision.quota,
      used: decision.used,
      requested: decision.requested,
      remaining: decision.remaining,
    },
    429,
  );
}

function responseStatus(c: Context<UnitHonoEnv>): number {
  return c.env?.outgoing?.statusCode ?? c.res.status;
}

const INSTALL_DIRECTIVE_SCHEMA = {
  id: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
};

async function installOperatingRulesTools(
  server: McpServer,
  tenant: TenantContext | null,
  store: OperatingRulesStore,
): Promise<void> {
  if (!tenant) return;
  server.registerTool(
    "install_operating_directive",
    {
      title: "Install operating directive",
      description:
        "Install or update an active tenant-scoped operating directive. The unit re-reads active directives at the start of each MCP turn.",
      inputSchema: INSTALL_DIRECTIVE_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, text, source, active }) => {
      const directive = await store.upsertDirective(tenant, {
        ...(id ? { id } : {}),
        text,
        ...(source ? { source } : {}),
        ...(active !== undefined ? { active } : {}),
      });
      const turnPreamble = await store.turnPreamble(tenant);
      const receipt = await store.appendConductReceipt(tenant, {
        kind: "operating_directive.install",
        status: "ok",
        summary: `Installed operating directive ${directive.id}`,
        evidence: [{ kind: "operating_directive", id: directive.id }],
      });
      return {
        content: [
          {
            type: "text",
            text: `Installed operating directive ${directive.id}`,
          },
        ],
        structuredContent: {
          tenant,
          directive,
          turnPreamble,
          receipt,
          evidence: [{ kind: "operating_directive", id: directive.id }],
        },
      };
    },
  );
}

function normalizeSkillText(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new Error(`createUnit skill.${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`createUnit skill.${field} must not be empty`);
  return normalized;
}

function normalizeSkillList(values: unknown, field: string): string[] {
  if (!Array.isArray(values) || !values.length)
    throw new Error(`createUnit skill.${field} must contain at least one item`);
  return values.map((value, index) =>
    normalizeSkillText(value, `${field}[${index}]`),
  );
}

function normalizeSkillManifest(skill: UnitSkillManifest): UnitSkillManifest {
  return {
    id: normalizeSkillText(skill.id, "id"),
    name: normalizeSkillText(skill.name, "name"),
    ...(skill.version?.trim() ? { version: skill.version.trim() } : {}),
    ...(skill.description?.trim()
      ? { description: skill.description.trim() }
      : {}),
    purpose: normalizeSkillText(skill.purpose, "purpose"),
    whenToRoute: normalizeSkillList(skill.whenToRoute, "whenToRoute"),
    tools: normalizeSkillList(skill.tools, "tools"),
    etiquette: normalizeSkillList(skill.etiquette, "etiquette"),
    receiptExpectations: normalizeSkillList(
      skill.receiptExpectations,
      "receiptExpectations",
    ),
    ...(skill.bundleUrl?.trim()
      ? { bundleUrl: normalizeSkillText(skill.bundleUrl, "bundleUrl") }
      : {}),
  };
}

function publishSkillManifest(
  skill: UnitSkillManifest,
  unit: { name: string; version: string },
): PublishedUnitSkillManifest {
  const normalized = normalizeSkillManifest(skill);
  const { bundleUrl, ...published } = normalized;
  return {
    schemaVersion: ATOMIC_UNIT_SKILL_SCHEMA_VERSION,
    ...published,
    unit: { ...unit },
    ...(bundleUrl
      ? { bundle: { format: "zenod-agent-skill-bundle-v1", url: bundleUrl } }
      : {}),
  };
}

type RuntimeToolCallback = (...args: unknown[]) => unknown;

interface RuntimeToolAnnotations {
  readOnlyHint?: boolean;
}

interface RuntimeToolConfig {
  annotations?: RuntimeToolAnnotations;
  [key: string]: unknown;
}

interface RuntimeToolUpdate {
  annotations?: RuntimeToolAnnotations;
  callback?: RuntimeToolCallback;
  [key: string]: unknown;
}

interface RuntimeRegisteredTool {
  update(updates: RuntimeToolUpdate): void;
  remove(): void;
}

interface RuntimeMcpServer {
  registerTool(
    name: string,
    config: RuntimeToolConfig,
    callback: RuntimeToolCallback,
  ): RuntimeRegisteredTool;
  tool(name: string, ...args: unknown[]): RuntimeRegisteredTool;
}

interface RuntimeTaskRegistration {
  registerToolTask(
    name: string,
    config: unknown,
    handler: unknown,
  ): RuntimeRegisteredTool;
}

interface ConductRegistration {
  name: string;
  profile: RegisteredToolConductProfile;
  active: boolean;
}

function normalizedConductToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mcpErrorResult(result: unknown): unknown {
  if (!isStructuredConductErrorResult(result)) return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return { ...result, isError: true };
}

function legacyReadOnlyHint(args: readonly unknown[]): boolean | undefined {
  for (const value of args) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const hint = (value as RuntimeToolAnnotations).readOnlyHint;
    if (typeof hint === "boolean") return hint;
  }
  return undefined;
}

/**
 * Intercept both SDK registration APIs before a unit registrar sees the server.
 * The callback wrapper remains attached when RegisteredTool.update replaces a handler.
 */
function installConductToolRegistration(
  server: McpServer,
  options: ConductOptions = {},
): () => void {
  const runtime = server as unknown as RuntimeMcpServer;
  const taskRegistration = server.experimental
    .tasks as unknown as RuntimeTaskRegistration;
  const registerTool = runtime.registerTool.bind(runtime);
  const legacyTool = runtime.tool.bind(runtime);
  const registrations: ConductRegistration[] = [];

  const wrapCallback = (
    registration: ConductRegistration,
    callback: RuntimeToolCallback,
  ): RuntimeToolCallback =>
    async (...args: unknown[]) => {
      const input = args.length > 1 ? args[0] : undefined;
      try {
        const result = await callback(...args);
        assertRegisteredToolResult(
          registration.name,
          input,
          result as ConductPayload | McpLikeToolResult,
          registration.profile,
        );
        return mcpErrorResult(result);
      } catch (error) {
        return conductErrorResult(error);
      }
    };

  const instrumentRegisteredTool = (
    registered: RuntimeRegisteredTool,
    registration: ConductRegistration,
  ): RuntimeRegisteredTool => {
    const update = registered.update.bind(registered);
    const remove = registered.remove.bind(registered);
    registered.update = (updates) => {
      if (updates.annotations) {
        registration.profile = registeredToolConductProfile(
          registration.name,
          updates.annotations.readOnlyHint,
          options,
        );
      }
      const next = { ...updates };
      if (updates.callback)
        next.callback = wrapCallback(registration, updates.callback);
      update(next);
    };
    registered.remove = () => {
      registration.active = false;
      remove();
    };
    return registered;
  };

  runtime.registerTool = (name, config, callback) => {
    const registration: ConductRegistration = {
      name,
      profile: registeredToolConductProfile(
        name,
        config.annotations?.readOnlyHint,
        options,
      ),
      active: true,
    };
    const registered = registerTool(
      name,
      config,
      wrapCallback(registration, callback),
    );
    registrations.push(registration);
    return instrumentRegisteredTool(registered, registration);
  };

  runtime.tool = (name, ...args) => {
    const callback = args.at(-1);
    if (typeof callback !== "function")
      throw new Error(`Tool ${name} requires a callback`);
    const registration: ConductRegistration = {
      name,
      profile: registeredToolConductProfile(
        name,
        legacyReadOnlyHint(args.slice(0, -1)),
        options,
      ),
      active: true,
    };
    const guarded = [...args];
    guarded[guarded.length - 1] = wrapCallback(
      registration,
      callback as RuntimeToolCallback,
    );
    const registered = legacyTool(name, ...guarded);
    registrations.push(registration);
    return instrumentRegisteredTool(registered, registration);
  };

  taskRegistration.registerToolTask = (name) => {
    throw new ConductContractError(
      "unsupported_task_registration",
      `Experimental task tool "${name}" bypasses the SEAM ticket contract; use registerTool with conduct.longTools instead.`,
    );
  };

  return () => {
    for (const registration of registrations) {
      if (!registration.active || !registration.profile.longTool) continue;
      const pollName = registration.profile.longTool.pollTool;
      const poll = registrations.find(
        (candidate) =>
          candidate.active &&
          normalizedConductToolName(candidate.name) ===
            normalizedConductToolName(pollName),
      );
      if (!poll) {
        throw new ConductContractError(
          "missing_poll_tool",
          `Long-running tool "${registration.name}" requires registered poll tool "${pollName}".`,
        );
      }
      if (poll.profile.kind !== "read") {
        throw new ConductContractError(
          "poll_tool_not_read_only",
          `Poll tool "${poll.name}" must be declared read-only.`,
        );
      }
    }
  };
}

export function createUnit(options: CreateUnitOptions): UnitApp {
  const name = options.name.trim();
  if (!name) throw new Error("createUnit requires a non-empty name");

  const version = options.version?.trim() || "0.0.0";
  const app = new Hono<UnitHonoEnv>();
  const logger = createChassisLogger(name, options.logging);
  const oauth = resolveOAuthKit(options.oauth);
  if (oauth && !options.tenantAuth)
    throw new Error(
      "OAuth routes require tenantAuth so grants can bind to tenants",
    );
  const auth = options.tenantAuth
    ? requireTenantAuth({
        ...options.tenantAuth,
        ...(oauth?.serverEnabled
          ? { oauth: oauth.store, oauthChallenge: true }
          : {}),
      })
    : noopAuth();
  const storage = storageFromOptions(options.storage);
  const getUsageStore = lazyUsageStore(
    options.metering,
    storage,
    options.storage !== undefined || Boolean(process.env.DATA_DIR?.trim()),
  );
  const operatingRules =
    options.operatingRules?.store ?? new MemoryOperatingRulesStore();
  const unitSkill = options.skill
    ? publishSkillManifest(options.skill, { name, version })
    : null;
  const installedSkills = (options.skills ?? []).map(normalizeSkillManifest);
  const ui = options.ui ? normalizeUiOptions(name, options.ui) : null;
  const tenantSettings = new SqliteTenantSettingsStore();
  const defaultProvisioningStore = isTenantProvisioningStore(
    options.tenantAuth?.store,
  )
    ? options.tenantAuth.store
    : null;
  const provisioningStore =
    options.controlPlane?.store ?? defaultProvisioningStore;

  const tenantContext = async (
    c: Context<UnitHonoEnv>,
    tenant: TenantContext,
  ): Promise<TenantUnitContext> => {
    const requestId = c.get("requestId");
    return {
      unitName: name,
      tenant,
      ...createRequestLogContext(logger, tenant.id, requestId),
      storage: storage.forTenant(tenant),
      usage: getUsageStore()?.forTenant(tenant) ?? null,
      operatingRules: await operatingRules.turnPreamble(tenant),
    };
  };

  if (options.singleTenant) {
    const store = options.singleTenant.store ?? provisioningStore;
    if (store)
      seedSingleTenantFromEnv(store, {
        ...options.singleTenant,
        unitName: name.toUpperCase(),
      });
  }

  app.use("*", async (c, next) => {
    const startedAt = performance.now();
    const requestId = randomBytes(16).toString("hex");
    let logged = false;
    let thrown: unknown;
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    const outgoing = c.env?.outgoing;
    if (outgoing && !outgoing.headersSent) {
      outgoing.setHeader("X-Request-Id", requestId);
    }
    const writeLifecycleLog = () => {
      if (logged) return;
      logged = true;
      const error = thrown ?? c.error;
      const requestLogger = createRequestLogContext(
        logger,
        c.get("tenant")?.id ?? null,
        requestId,
      ).logger;
      const details = {
        event: error ? "http.request.failed" : "http.request.completed",
        http: {
          method: c.req.method,
          path: safeRequestPath(c.req.url),
          status_code: responseStatus(c),
        },
        duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      };
      if (error)
        requestLogger.error({ ...details, err: error }, "request failed");
      else requestLogger.info(details, "request completed");
    };
    outgoing?.once("finish", writeLifecycleLog);
    outgoing?.once("close", writeLifecycleLog);
    try {
      await next();
      if (!outgoing) writeLifecycleLog();
    } catch (err) {
      thrown = err;
      if (!outgoing) writeLifecycleLog();
      throw err;
    }
  });

  app.get("/healthz", (c) => c.json({ status: "ok", name, version }));
  app.get(ATOMIC_UNIT_SKILL_MANIFEST_PATH, (c) =>
    unitSkill
      ? c.json(unitSkill)
      : c.json({ error: "skill manifest not configured" }, 404),
  );

  let uiProductRoutes: Hono<UnitHonoEnv> | null = null;
  if (ui) {
    if (!options.tenantAuth?.store) {
      throw new Error(
        "createUnit({ ui }) requires tenantAuth.store so sessions can bind to a tenant",
      );
    }

    const tenantStore = options.tenantAuth.store;
    const requireUiTenant: UnitAuthMiddleware = async (c, next) => {
      const bearerRecord = await resolveTenantToken(
        tenantStore,
        bearerToken(c),
      );
      const tenant = bearerRecord?.tenant ?? resolveTenantSession(c, ui);
      if (tenant) {
        c.set("tenant", { ...tenant });
        await next();
        return;
      }
      return c.json({ error: "unauthorized" }, 401);
    };

    app.get("/api/agent", (c) =>
      c.json({
        name,
        displayName: ui.displayName,
        tagline: ui.tagline,
        panels: ui.panels,
        vaultless: !ui.panels?.includes("vault"),
        hostedMode: null,
      }),
    );

    app.get("/api/auth/status", (c) => {
      const tenant = resolveTenantSession(c, ui);
      if (tenant) c.set("tenant", tenant);
      return c.json({
        needsSetup: false,
        configured: true,
        hostedMode: null,
        tenant,
        authenticated: tenant !== null,
      });
    });

    app.post("/api/auth/login", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const token = loginTokenFromBody(body);
      const record = await resolveTenantToken(tenantStore, token);
      if (!record) return c.json({ error: "unauthorized" }, 401);
      c.set("tenant", { ...record.tenant });
      issueTenantSession(c, ui, record.tenant);
      return c.json({ ok: true, tenant: record.tenant });
    });

    app.post("/api/auth/logout", (c) => {
      const tenant = resolveTenantSession(c, ui);
      if (tenant) c.set("tenant", tenant);
      clearTenantSession(c, ui);
      return c.json({ ok: true });
    });

    const productRoutes = new Hono<UnitHonoEnv>();
    uiProductRoutes = productRoutes;
    productRoutes.get("/api/overview", requireUiTenant, (c) => {
      const tenant = c.get("tenant");
      const usage = tenant
        ? (getUsageStore()?.forTenant(tenant).summary() ?? null)
        : null;
      return c.json({
        tenant,
        unit: { name, version },
        panels: ui.panels,
        usage,
      });
    });

    productRoutes.get("/api/operating-rules", requireUiTenant, async (c) => {
      const tenant = c.get("tenant");
      if (!tenant) return c.json({ error: "unauthorized" }, 401);
      return c.json(await operatingRules.snapshot(tenant));
    });

    productRoutes.get("/api/mcp-config", requireUiTenant, (c) =>
      c.json({
        tenant: c.get("tenant"),
        unit: { name, version },
        endpoint: "/mcp",
        tokenedEndpoint: "/mcp/<token>",
        auth: {
          bearer: true,
          tokenedUrl: true,
          oauth: Boolean(oauth?.serverEnabled),
        },
        routes: [
          "/mcp",
          "/mcp/<token>",
          ...(oauth?.serverEnabled
            ? [
                "/.well-known/oauth-protected-resource",
                "/.well-known/oauth-authorization-server",
                "/oauth/authorize",
                "/oauth/token",
              ]
            : []),
        ],
      }),
    );

    productRoutes.get("/api/skills", requireUiTenant, (c) =>
      c.json({
        tenant: c.get("tenant"),
        unit: { name, version },
        published: unitSkill,
        installed: installedSkills,
      }),
    );

    productRoutes.get("/api/keys", requireUiTenant, (c) => {
      const tenant = c.get("tenant");
      if (!tenant) return c.json({ error: "unauthorized" }, 401);
      return c.json({
        tenant,
        keys: tenantSettings.keyMetadata(storage.forTenant(tenant)),
      });
    });

    productRoutes.get("/api/settings", requireUiTenant, (c) => {
      const tenant = c.get("tenant");
      if (!tenant) return c.json({ error: "unauthorized" }, 401);
      return c.json({
        tenant,
        ...tenantSettings.snapshot(storage.forTenant(tenant)),
      });
    });

    productRoutes.put("/api/settings", requireUiTenant, async (c) => {
      const tenant = c.get("tenant");
      if (!tenant) return c.json({ error: "unauthorized" }, 401);
      const body = await c.req.json().catch(() => null);
      try {
        return c.json({
          tenant,
          ...tenantSettings.update(storage.forTenant(tenant), body),
        });
      } catch (error) {
        if (error instanceof TypeError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    });

    productRoutes.get("/api/token", requireUiTenant, (c) =>
      c.json({
        tenant: c.get("tenant"),
        token: "",
        mcpPath: "/mcp",
      }),
    );

    productRoutes.post("/api/token/regenerate", requireUiTenant, async (c) => {
      const tenant = c.get("tenant");
      const provisioning = isTenantProvisioningStore(tenantStore)
        ? tenantStore
        : provisioningStore;
      if (!tenant || !provisioning)
        return c.json({ error: "token rotation unavailable" }, 409);
      const result = await provisioning.rotateTenantToken(tenant.id);
      if (!result) return c.json({ error: "tenant not found" }, 404);
      issueTenantSession(c, ui, result.record.tenant);
      return c.json({
        tenant: result.record.tenant,
        token: result.token,
        mcpPath: "/mcp",
      });
    });

    productRoutes.get("/api/connections", requireUiTenant, (c) =>
      c.json({
        tenant: c.get("tenant"),
        token: "",
        mcpPath: "/mcp",
        clients: [],
        grants: [],
      }),
    );

    productRoutes.post("/api/connections/revoke", requireUiTenant, (c) =>
      c.json({ ok: true, tenant: c.get("tenant") }),
    );
  }

  if (oauth && options.tenantAuth) {
    installOAuthRoutes(app, {
      kit: oauth,
      tenantStore: options.tenantAuth.store,
      storage,
      tenantAuth: auth,
    });
  }

  if (options.controlPlane && provisioningStore) {
    const controlPlaneAuth = requireControlPlane(options.controlPlane);

    app.post("/api/tenants", controlPlaneAuth, async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const result = await provisioningStore.provisionTenant(
        parseProvisionTenantBody(body),
      );
      return c.json(toProvisionTenantResponse(result), 201);
    });

    app.patch("/api/tenants/:tenantId", controlPlaneAuth, async (c) => {
      const status = parseTenantStatus(await c.req.json().catch(() => ({})));
      if (!status || status === "deleted")
        return c.json({ error: "invalid status" }, 400);
      const record = await provisioningStore.setTenantStatus(
        c.req.param("tenantId") ?? "",
        status,
      );
      if (!record) return c.json({ error: "tenant not found" }, 404);
      return c.json({
        tenant: record.tenant,
        status: record.status ?? "active",
      });
    });

    app.post(
      "/api/tenants/:tenantId/token/rotate",
      controlPlaneAuth,
      async (c) => {
        const result = await provisioningStore.rotateTenantToken(
          c.req.param("tenantId") ?? "",
        );
        if (!result) return c.json({ error: "tenant not found" }, 404);
        return c.json(toProvisionTenantResponse(result));
      },
    );

    app.delete("/api/tenants/:tenantId", controlPlaneAuth, async (c) => {
      const record = await provisioningStore.setTenantStatus(
        c.req.param("tenantId") ?? "",
        "deleted",
      );
      if (!record) return c.json({ error: "tenant not found" }, 404);
      return c.json({ tenant: record.tenant, status: "deleted" });
    });
  }

  const billingStore = options.billing?.store ?? provisioningStore;
  if (options.billing && billingStore && isBillingEnabled(options.billing)) {
    registerBillingRoutes(app, {
      ...options.billing,
      store: billingStore,
      unitName: name,
    });
  }

  const handleMcp = async (c: Context<UnitHonoEnv>) => {
    const { incoming, outgoing } = nodeBindings(c);
    const server = new McpServer({ name, version });
    const assertConductRegistrations = installConductToolRegistration(
      server,
      options.conduct,
    );
    const tenant = c.get("tenant") ?? null;
    const usage = tenant ? (getUsageStore()?.forTenant(tenant) ?? null) : null;
    if (tenant && usage) {
      const decision = usage.checkQuota(tenant.quota, 1);
      if (!decision.allowed) return quotaExceededResponse(c, decision);
      usage.record({ kind: "mcp.request", units: 1 });
    }
    const turnPreamble = tenant
      ? await operatingRules.turnPreamble(tenant)
      : null;
    await installOperatingRulesTools(server, tenant, operatingRules);
    await options.tools?.(server, {
      unitName: name,
      tenant,
      ...createRequestLogContext(
        logger,
        tenant?.id ?? null,
        c.get("requestId"),
      ),
      storage: tenant ? storage.forTenant(tenant) : null,
      usage,
      operatingRules: turnPreamble,
    });
    assertConductRegistrations();

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

  if (options.routes) {
    const tenantAuth = options.tenantAuth;
    if (!tenantAuth) {
      throw new Error("createUnit({ routes }) requires tenantAuth");
    }
    const routeApp = new Hono<UnitHonoEnv>();
    const routeAuth: UnitAuthMiddleware = async (c, next) => {
      if (c.get("unitContext")) {
        await next();
        return;
      }
      const tenant =
        (await resolveAuthenticatedTenant(c, {
          ...tenantAuth,
          ...(oauth?.serverEnabled
            ? { oauth: oauth.store, oauthChallenge: true }
            : {}),
        })) ?? (ui ? resolveTenantSession(c, ui) : null);
      if (!tenant) {
        return unauthorized(
          c,
          tenantAuth.realm?.trim() || "mcp-chassis",
          Boolean(oauth?.serverEnabled || tenantAuth.oauthChallenge),
        );
      }
      c.set("tenant", tenant);
      const context = await tenantContext(c, tenant);
      if (context.usage) {
        const decision = context.usage.checkQuota(tenant.quota, 1);
        if (!decision.allowed) return quotaExceededResponse(c, decision);
        context.usage.record({ kind: "api.request", units: 1 });
      }
      c.set("unitContext", context);
      await next();
    };
    options.routes(routeApp);
    const protectedRouteApp = new Hono<UnitHonoEnv>();
    const protectedPaths = new Set<string>();
    for (const route of routeApp.routes) {
      const key = `${route.method}\0${route.path}`;
      if (!protectedPaths.has(key)) {
        protectedRouteApp.on(route.method, route.path, routeAuth);
        protectedPaths.add(key);
      }
      protectedRouteApp.on(route.method, route.path, route.handler);
    }
    app.route("/", protectedRouteApp);
  }

  if (uiProductRoutes) app.route("/", uiProductRoutes);

  if (ui?.webDist) {
    const root = ui.webDist;
    const noCache: Pick<ServeStaticOptions, "onFound"> = {
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      },
    };
    app.use("/*", serveStatic({ root, ...noCache }));
    app.get("*", serveStatic({ root, path: "index.html", ...noCache }));
  }

  return { app, name, version };
}
function isTenantProvisioningStore(
  store: TenantTokenStore | undefined,
): store is TenantProvisioningStore {
  return Boolean(
    store &&
    "provisionTenant" in store &&
    "rotateTenantToken" in store &&
    "setTenantStatus" in store,
  );
}

function parseProvisionTenantBody(body: unknown): ProvisionTenantInput {
  if (!body || typeof body !== "object") return {};
  const input = body as Record<string, unknown>;
  const tenantInput =
    input.tenant && typeof input.tenant === "object"
      ? (input.tenant as Record<string, unknown>)
      : {};
  return {
    tenantId:
      stringOrUndefined(input.tenantId) ??
      stringOrUndefined(input.id) ??
      stringOrUndefined(tenantInput.id),
    name: stringOrUndefined(input.name) ?? stringOrUndefined(tenantInput.name),
    plan: stringOrUndefined(input.plan) ?? stringOrUndefined(tenantInput.plan),
    quota:
      numberOrNullOrUndefined(input.quota) ??
      numberOrNullOrUndefined(tenantInput.quota),
  };
}

function parseTenantStatus(body: unknown): TenantStatus | null {
  if (!body || typeof body !== "object") return null;
  const status = (body as Record<string, unknown>).status;
  return status === "active" || status === "suspended" || status === "deleted"
    ? status
    : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrNullOrUndefined(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function loginTokenFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  return (
    stringOrUndefined(input.token) ?? stringOrUndefined(input.password) ?? null
  );
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
export { ChassisStorage, openSqlite } from "./storage.js";
export { ChassisUsageStore, TenantUsageMeter } from "./usage.js";
export type {
  ChassisStorageOptions,
  TenantStorage,
  TenantValueCipher,
  TenantVault,
  UnitTenant,
} from "./storage.js";
export type {
  ChassisUsageStoreOptions,
  QuotaDecision,
  TenantUsageSummary,
  UsageBucket,
  UsageEvent,
  UsageQuery,
  UsageRecordInput,
} from "./usage.js";
export * from "./rules.js";
export * from "./transcription.js";
export { MemoryOAuthStore } from "./oauth.js";
export type {
  OAuthKitOptions,
  OAuthProvider,
  OAuthStore,
  OAuthTokenSet,
} from "./oauth.js";
