import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HttpBindings } from "@hono/node-server";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  ChassisStorage,
  createSqliteOAuthStore,
  createSqliteTenantStore,
  createUnit,
  hashToken,
  type ControlPlaneOptions,
  type TenantProvisioningStore,
  type UnitHonoEnv,
  type UnitContext,
} from "@zenod/mcp-chassis";
import {
  VERSION,
  createGithubIssue,
  editGithubIssue,
} from "zenod";
import { ZENOD_AGENT, type AgentDefinition } from "./agent.js";
import { createApp, resolvedGitSha, type AppOptions } from "./app.js";
import { ChassisCredentialVault } from "./credentialVault.js";
import { buildDriveTools } from "./driveTools.js";
import { driveClientFromSettings } from "./drive.js";
import { buildMcpServer } from "./mcp.js";
import { Runtime } from "./runtime.js";
import type {
  GoogleDriveOAuthAuthority,
  SettingKey,
} from "./settings.js";
import type { TelegramManagedInbound } from "./telegramGateway.js";
import type { ChatTestAuditStore, ChatTurnInterceptor } from "./testHarness.js";
import { createCustomerLayer, type CustomerLayerOptions } from "./customerLayer.js";
import type {
  ManagedAiAdmissionJob,
  ManagedAiAdmissionNoticeKind,
  ManagedAiAdmissionInput,
  ManagedAiRawKind,
  ManagedAiTerminalReceipt,
} from "./customerManagedAiAdmission.js";
import { ManagedAiDownstreamOutbox } from "./customerManagedAiOutbox.js";
import type { CustomerProductConfig } from "./customerBilling.js";
import { readCustomerSession } from "./customerSession.js";
import {
  hostedChannelsConfigured,
  mountHostedChannelsCustomerRoutes,
} from "./hostedChannels.js";
import {
  loadZenodPhylaxConfig,
  ZenodPhylaxAdapter,
} from "./zenodPhylax.js";
import { mountStaticSurfaces } from "./staticSurfaces.js";
import { loadSharedGithubApp, sharedGithubSettingFallbacks, type SharedGithubApp } from "./sharedGithubApp.js";
import { walletFleetAllowlist } from "./walletUrl.js";
import {
  ZENOD_PUBLISHED_SKILL,
  ZENOD_SKILL_BUNDLE_PATH,
  zenodSkillBundle,
} from "./zenodSkill.js";

export const MEMORY_CHANNEL_MCP_TOOLS = Object.freeze([
  "ask_brain",
  "chat_with_zenod",
  "get_task_result",
  "ingest_memory",
  "search_memory",
  "store_memory",
] as const);

export class ZenodRuntimePool {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly apps = new Map<string, ReturnType<typeof createApp>>();

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly sharedGithubApp: SharedGithubApp | null = null,
    private readonly agent: AgentDefinition = ZENOD_AGENT,
    private readonly appOptionsForTenant?: (tenantId: string, runtime: Runtime) => Pick<AppOptions, "chatInterceptor">,
    private readonly managedTelegramInbound?: (tenantId: string, input: TelegramManagedInbound) => Promise<void>,
    private readonly hostedCustomerTenant?: (tenantId: string) => boolean,
    private readonly googleDriveOAuthAuthorityForTenant?: (
      tenantId: string,
    ) => GoogleDriveOAuthAuthority,
  ) {}

  forContext(context: UnitContext): Runtime {
    if (!context.tenant || !context.storage) {
      throw new Error("Zenod requires an authenticated chassis tenant context");
    }
    return this.forTenantStorage(context.tenant.id, context.storage);
  }

  /** Host-owned wake paths may resume a tenant without an active HTTP request. */
  forTenantStorage(tenantId: string, tenantStorage: NonNullable<UnitContext["storage"]>): Runtime {
    const existing = this.runtimes.get(tenantId);
    if (existing) {
      if (existing.dataDir !== tenantStorage.rootDir) {
        throw new Error("chassis tenant storage root changed during process lifetime");
      }
      return existing;
    }
    const runtime = new Runtime(tenantStorage.rootDir, this.agent, {
      seedFromEnv: false,
      tenantId,
      credentialVault: new ChassisCredentialVault(tenantStorage, {
        legacyMasterKey: this.env.ZENOD_CREDENTIAL_MASTER_KEY,
      }),
      settingFallbacks: {
        ...sharedGithubSettingFallbacks(this.sharedGithubApp),
      },
      ...(this.googleDriveOAuthAuthorityForTenant
        ? {
            googleDriveOAuthAuthority: () =>
              this.googleDriveOAuthAuthorityForTenant!(tenantId),
          }
        : {}),
      ...(this.managedTelegramInbound
        ? { managedTelegramInbound: (input) => this.managedTelegramInbound!(tenantId, input) }
        : {}),
      ...(this.hostedCustomerTenant
        ? { managedTelegramInboundEnabled: () => this.hostedCustomerTenant!(tenantId) }
        : {}),
    });
    if (runtime.settings.get("artifact_archive_provider") === null) {
      runtime.settings.set(
        "artifact_archive_provider",
        this.env.NODE_ENV === "production" ? "drive" : "local",
      );
    }
    if (runtime.settings.get("artifact_archive_local_dir") === null) {
      runtime.settings.set("artifact_archive_local_dir", tenantStorage.dir("media"));
    }
    this.runtimes.set(tenantId, runtime);
    return runtime;
  }

  get(tenantId: string): Runtime | null {
    return this.runtimes.get(tenantId) ?? null;
  }

  appForContext(context: UnitContext): ReturnType<typeof createApp> {
    if (!context.tenant) {
      throw new Error("Zenod requires an authenticated chassis tenant context");
    }
    const existing = this.apps.get(context.tenant.id);
    if (existing) return existing;
    const runtime = this.forContext(context);
    const app = createApp(runtime, {
      agent: this.agent,
      trustedChassisAuth: true,
      walletFleetAllowlist: walletFleetAllowlist(this.env),
      ...this.appOptionsForTenant?.(context.tenant.id, runtime),
    });
    this.apps.set(context.tenant.id, app);
    return app;
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.close()));
    this.apps.clear();
    this.runtimes.clear();
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, "Tenant runtime shutdown failed");
  }
}

function registerZenodTools(
  server: McpServer,
  runtime: Runtime,
  agent: AgentDefinition = ZENOD_AGENT,
  chatInterceptor?: ChatTurnInterceptor,
): void {
  const { settings } = runtime;
  const chatTestAudit = runtime.state as unknown as ChatTestAuditStore;
  buildMcpServer(
    () => runtime.getEngine(),
    settings.googleDriveOAuthAuthority().mode === "hosted-managed"
      ? undefined
      : () => buildDriveTools(settings, runtime.ingestQueue),
    () => runtime.cleanSlate(),
    (input) => chatTestAudit.recordChatTestRun(input),
    {
      enqueue: (kind, input, idempotencyKey) => runtime.taskJobQueue.enqueue(kind, input, idempotencyKey),
      get: (id) => runtime.taskJobQueue.get(id),
      recent: (limit) => runtime.taskJobQueue.recent(limit),
      admit: (kind, input) => runtime.taskJobQueue.admit(kind, input),
      hostedArchiveOnlyDrive: settings.googleDriveOAuthAuthority().mode === "hosted-managed",
    },
    (input) => editGithubIssue(settings, input),
    (input) => createGithubIssue(settings, input),
    agent.name,
    undefined,
    undefined,
    undefined,
    // Conversation transport audit belongs to the Console/Phylax operational
    // surface. It is deliberately not part of Zenod's memory API.
    undefined,
    undefined,
    undefined,
    (query) => runtime.usageStore.timeline(query),
    settings.get("instance_name") ?? "",
    {
      async enqueueAudio({ bytesRef, filename, hints, contentHint, sourceHint }) {
        const client = driveClientFromSettings(settings);
        if (!client) {
          throw new Error("Google Drive evidence archive is not connected");
        }
        const file = await client.getFile(bytesRef);
        const filingHints = [
          ...(hints ?? []),
          ...(contentHint ? [`content hint: ${contentHint}`] : []),
          ...(sourceHint ? [`source: ${sourceHint}`] : []),
        ];
        return runtime.ingestQueue.enqueue(
          bytesRef,
          filename ?? file.name,
          filingHints,
        );
      },
      get: (id) => runtime.ingestStore.get(id),
    },
    server,
    chatInterceptor,
  );
}

export interface CreateZenodUnitOptions {
  dataDir?: string;
  /** Reuse one storage owner when a composed unit must build adapters first. */
  storage?: ChassisStorage;
  webDist?: string;
  siteDist?: string;
  tenantStore?: TenantProvisioningStore;
  controlPlane?: Omit<ControlPlaneOptions, "store">;
  customer?: CustomerLayerOptions;
  env?: NodeJS.ProcessEnv;
  /** Internal port seam used by units that duplicate Zenod's proven chassis. */
  agent?: AgentDefinition;
  unitName?: string;
  tokenEnvVar?: string;
  defaultTenantName?: string;
  panels?: string[];
  customerProduct?: CustomerProductConfig;
  /** Register unit-specific tools on the same instrumented MCP server. */
  registerAdditionalTools?: (server: McpServer, context: UnitContext, runtime: Runtime) => void;
  /** Mount authenticated unit-specific API routes before the shared /api proxy. */
  mountAdditionalRoutes?: (
    routes: Hono<UnitHonoEnv>,
    runtimes: ZenodRuntimePool,
  ) => void;
  /** Bind tenant-aware hooks into the duplicated chat application. */
  appOptionsForTenant?: (tenantId: string, runtime: Runtime) => Pick<AppOptions, "chatInterceptor">;
  additionalReadTools?: readonly string[];
  /** Host-internal memory-context tools allowed on this unit's scoped channel token. */
  additionalMemoryChannelTools?: readonly string[];
  /** Unit-owned least-privilege MCP credential profiles. */
  additionalToolProfiles?: Readonly<Record<string, readonly string[]>>;
  customerAdmin?: {
    githubLogin: string;
    mountRoutes?: (app: Hono<{ Bindings: HttpBindings }>) => void;
    close?: () => void | Promise<void>;
  };
}

export const ZENOD_READ_TOOLS = [
  "ask_brain",
  "get_ingest_result",
  "get_memory",
  "get_task_result",
  "list_drive_files",
  "read_llm_timeline",
  "search_memory",
] as const;

export const ZENOD_LONG_TOOLS = {
  chat_with_zenod: { pollTool: "get_task_result", allowSynchronousResult: true },
  store_memory: { pollTool: "get_task_result" },
  ingest_memory: { pollTool: "get_task_result" },
  task_brain: { pollTool: "get_task_result" },
  run_task: { pollTool: "get_task_result" },
} as const;

const HOSTED_INTERNAL_CONTROL_PREFIXES = [
  "/api/agent/",
  "/api/ring",
  "/api/phylax",
  "/api/team",
  "/api/peers",
  "/api/provision",
  "/api/tenants",
  "/api/exec",
  "/api/executions",
  "/api/executor",
  "/api/journeys",
  "/api/journey-steps",
  "/api/tasks",
  "/internal",
] as const;

const HOSTED_CUSTOMER_HTTP_OPERATIONS = new Set([
  "GET /api/agent",
  "GET /api/auth/status",
  "GET /api/overview",
  "GET /api/settings",
  "PUT /api/settings",
  "GET /api/drive/status",
  "GET /api/drive/oauth/start",
  "GET /api/drive/oauth/callback",
  "POST /api/drive/disconnect",
  "GET /api/github/app/status",
  "GET /api/github/app/start",
  "GET /api/github/repos",
  "POST /api/github/app/disconnect",
  "GET /api/vault",
  "POST /api/vault/sync",
  "POST /api/vault/reclone",
  "GET /api/vault/lint",
  "PUT /api/vault/repository",
  "POST /api/store",
  "POST /api/ask",
  "POST /api/chat",
  "POST /api/chat/stream",
  "POST /api/chat/voice/transcribe",
  "GET /api/chat/history",
  "DELETE /api/chat",
  "GET /api/search",
  "GET /api/note",
  "GET /api/ingest/jobs",
  "GET /api/token",
  "POST /api/token/regenerate",
  "GET /api/connections",
  "POST /api/connections/revoke",
  "GET /api/channels",
  "POST /api/channels/whatsapp/challenge",
  "POST /api/channels/whatsapp/test",
  "POST /api/channels/whatsapp/disconnect",
  "POST /api/channels/telegram/connect",
  "POST /api/channels/telegram/test",
  "POST /api/channels/telegram/disconnect",
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/mcp",
  "GET /.well-known/oauth-authorization-server",
  "GET /.well-known/oauth-authorization-server/mcp",
  "POST /oauth/register",
  "GET /oauth/authorize",
  "POST /oauth/authorize/decision",
  "POST /oauth/token",
]);

function hostedCustomerHttpAllowed(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const operation = `${normalizedMethod} ${path}`;
  if (HOSTED_CUSTOMER_HTTP_OPERATIONS.has(operation)) return true;
  if ((normalizedMethod === "GET" || normalizedMethod === "POST" || normalizedMethod === "DELETE") &&
      (path === "/mcp" || path.startsWith("/mcp/"))) return true;
  return normalizedMethod === "POST" && /^\/api\/ingest\/jobs\/[^/]+\/(retry|cancel)$/.test(path);
}

export function hostedCapabilityViolation(
  method: string,
  path: string,
): "raw_usage" | "managed_settings" | "internal_controls" | "customer_capability" | null {
  const normalizedMethod = method.toUpperCase();
  if (hostedCustomerHttpAllowed(normalizedMethod, path)) return null;
  if (path === "/api/usage" || path.startsWith("/api/usage/")) return "raw_usage";
  if (path === "/api/keys" || path.startsWith("/api/transcription/") || path.startsWith("/api/executor/")) {
    return "managed_settings";
  }
  if (HOSTED_INTERNAL_CONTROL_PREFIXES.some((prefix) =>
    path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  )) {
    return "internal_controls";
  }
  return "customer_capability";
}

const HOSTED_CUSTOMER_SETTING_KEYS = new Set<string>([
  "instance_name",
  "vault_repo",
  "vault_branch",
  "artifact_archive_provider",
  "google_oauth_client_id",
  "google_oauth_client_secret",
  "telegram_enabled",
  "telegram_allowed_users",
  "telegram_accept_all",
  "telegram_rich",
] satisfies readonly SettingKey[]);

// Must stay aligned with the Hosted edition profile in the customer portal.
// These are product sections, not the chassis settings-panel capabilities.
const HOSTED_CUSTOMER_PANELS = Object.freeze([
  "overview",
  "connect",
  "channels",
  "vault",
  "usage",
  "account",
] as const);

export const HOSTED_DRIVE_STATUS_PUBLIC_KEYS = Object.freeze([
  "configured",
  "oauthAvailable",
  "oauthClientConfigured",
  "accountEmail",
  "folderId",
  "archiveConfigured",
  "archiveReason",
] as const);

function projectHostedDriveStatus(
  body: Record<string, unknown>,
  oauthAvailable: boolean,
): Record<(typeof HOSTED_DRIVE_STATUS_PUBLIC_KEYS)[number], unknown> {
  const oauthClientConfigured = body.oauthClientConfigured === true;
  const configured = body.configured === true && body.authMode === "oauth";
  const folderId = typeof body.folderId === "string" && body.folderId.trim()
    ? body.folderId
    : null;
  const archiveConfigured = configured && body.archiveConfigured === true;
  const accountEmail = configured && typeof body.oauthEmail === "string"
    ? body.oauthEmail
    : null;
  const archiveReason = archiveConfigured
    ? null
    : !oauthAvailable
      ? "Google Drive connection is unavailable."
      : !oauthClientConfigured
        ? "Add this tenant's Google OAuth client ID and client secret to connect Google Drive."
      : !configured
        ? "Connect Google Drive to enable archive/export copies."
        : !folderId
          ? "Reconnect Google Drive so Zenod can prepare its managed archive folder."
          : "Google Drive archiving is not ready.";
  return {
    configured,
    oauthAvailable,
    oauthClientConfigured,
    accountEmail,
    folderId,
    archiveConfigured,
    archiveReason,
  };
}

async function projectHostedCustomerResponse(
  path: string,
  response: Response,
  hostedDriveAllowed: boolean,
  directToken: string | null,
): Promise<Response> {
  if (
    path === "/api/drive/oauth/start" &&
    response.status === 400 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (body?.error === "save the Google OAuth client ID and secret first") {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.set("cache-control", "no-store");
      if (!hostedDriveAllowed) {
        return Response.json({
          error: "google_drive_oauth_unavailable",
          message: "Google Drive connection is unavailable for this tenant.",
          oauthAvailable: false,
        }, { status: 503, headers });
      }
      return Response.json({
        error: "google_drive_oauth_credentials_required",
        message: "Save this tenant's Google OAuth client ID and client secret first.",
        oauthAvailable: false,
      }, { status: 400, headers });
    }
  }
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  if (!["/api/agent", "/api/settings", "/api/overview", "/api/drive/status", "/api/auth/status", "/api/vault", "/api/connections"].includes(path)) {
    return response;
  }
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return response;
  let projected: Record<string, unknown>;
  if (path === "/api/agent") {
    projected = {
      name: body.name,
      displayName: body.displayName,
      tagline: body.tagline,
      panels: HOSTED_CUSTOMER_PANELS,
      vaultless: Boolean(body.vaultless),
      hostedMode: "managed",
    };
  } else if (path === "/api/settings") {
    const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
      ? Object.fromEntries(
          Object.entries(body.settings as Record<string, unknown>)
            .filter(([key]) => HOSTED_CUSTOMER_SETTING_KEYS.has(key)),
        )
      : {};
    projected = { settings, configured: true, hostedManagedAi: true };
  } else if (path === "/api/overview") {
    projected = { ...body, usage: null };
  } else if (path === "/api/drive/status") {
    projected = projectHostedDriveStatus(body, hostedDriveAllowed);
  } else if (path === "/api/vault") {
    projected = {
      repo: body.repo ?? null,
      branch: body.branch ?? "main",
      vaultConfigured: Boolean(body.vaultConfigured),
      configured: Boolean(body.configured),
      cloned: Boolean(body.cloned),
      headSha: body.headSha ?? null,
    };
  } else if (path === "/api/connections") {
    projected = {
      token: directToken ?? "",
      mcpPath: directToken ? `/mcp/${directToken}` : "/mcp",
      clients: [],
      grants: [],
    };
  } else {
    projected = { needsSetup: false, configured: true, hostedMode: "managed" };
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(projected, { status: response.status, headers });
}

async function hostedSettingsBodyViolation(request: Request): Promise<boolean> {
  if (request.method.toUpperCase() !== "PUT" || new URL(request.url).pathname !== "/api/settings") return false;
  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  return Object.entries(body).some(([key, value]) =>
    !HOSTED_CUSTOMER_SETTING_KEYS.has(key) || typeof value !== "string"
  );
}

const MANAGED_AI_HTTP_PATHS = new Set([
  "/api/ask",
  "/api/chat",
  "/api/chat/stream",
  "/api/chat/voice/transcribe",
  "/api/store",
  "/api/test/chat",
  "/api/work",
]);
function hostedSensitiveMcpRead(raw: Uint8Array): boolean {
  try {
    const payload = JSON.parse(Buffer.from(raw).toString("utf8")) as {
      method?: unknown;
      params?: { name?: unknown };
    };
    return payload.method === "tools/call" && payload.params?.name === "read_llm_timeline";
  } catch {
    return false;
  }
}

function managedAiRawKind(
  path: string,
  contentType: string | null,
  mcpKind: ManagedAiRawKind,
  raw: Uint8Array,
): ManagedAiRawKind {
  if (path === "/mcp" || path.startsWith("/mcp/")) return mcpKind;
  if (path.includes("voice") || contentType?.startsWith("audio/") || contentType?.includes("multipart/form-data")) {
    return "audio";
  }
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.includes("json")) {
    const text = Buffer.from(raw).toString("utf8");
    if (/"(?:mimeType|contentType|type)"\s*:\s*"image\//i.test(text)) return "image";
    if (/"(?:mimeType|contentType|type)"\s*:\s*"audio\//i.test(text)) return "audio";
  }
  return "text";
}

function admissionIdempotencyKey(
  request: Request,
  tenantId: string,
  mcpId: string | null,
  raw: Uint8Array,
): string {
  const explicit = request.headers.get("idempotency-key") ?? request.headers.get("x-provider-message-id");
  if (explicit?.trim()) return explicit.trim();
  if (mcpId) {
    return createHash("sha256")
      .update(`${tenantId}\0mcp\0${mcpId}\0`)
      .update(raw)
      .digest("hex");
  }
  return randomUUID();
}

async function terminalReceipt(response: Response): Promise<ManagedAiTerminalReceipt> {
  return {
    state: response.ok ? "completed" : "failed",
    statusCode: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.clone().text(),
    completedAt: new Date().toISOString(),
  };
}

function responseFromReceipt(receipt: ManagedAiTerminalReceipt): Response {
  return new Response(receipt.body, {
    status: receipt.statusCode,
    headers: receipt.contentType ? { "content-type": receipt.contentType } : undefined,
  });
}

export function createZenodUnit(options: CreateZenodUnitOptions) {
  const env = options.env ?? process.env;
  const agent = options.agent ?? ZENOD_AGENT;
  const unitName = options.unitName ?? "zenod";
  const storage = options.storage ?? new ChassisStorage({
    dataDir: options.dataDir,
    vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY,
  });
  const tenantStore =
    options.tenantStore ??
    createSqliteTenantStore({
      dataDir: storage.dataDir,
      busyTimeoutMs: 30_000,
    });
  const zenodPhylax = agent.name === "zenod"
    ? new ZenodPhylaxAdapter(storage.dataDir, loadZenodPhylaxConfig(env))
    : null;
  const sharedGithubApp = loadSharedGithubApp(storage.dataDir, env);
  let managedTelegramAdmission: ((tenantId: string, input: TelegramManagedInbound) => Promise<void>) | null = null;
  let isHostedCustomerTenant: (tenantId: string) => boolean = () => false;
  let googleDriveOAuthAuthorityForTenant: (
    tenantId: string,
  ) => GoogleDriveOAuthAuthority = () => ({ mode: "self-hosted" });
  const runtimes = new ZenodRuntimePool(
    env,
    sharedGithubApp,
    agent,
    options.appOptionsForTenant,
    async (tenantId, input) => {
      if (!managedTelegramAdmission) throw new Error("Hosted Telegram admission is not initialized");
      await managedTelegramAdmission(tenantId, input);
    },
    (tenantId) => isHostedCustomerTenant(tenantId),
    (tenantId) => googleDriveOAuthAuthorityForTenant(tenantId),
  );
  const unit = createUnit({
    name: unitName,
    version: VERSION,
    ...(agent.name === "zenod" ? { skill: ZENOD_PUBLISHED_SKILL } : {}),
    conduct: {
      toolKinds: { read: [...ZENOD_READ_TOOLS, ...(options.additionalReadTools ?? [])] },
      longTools: ZENOD_LONG_TOOLS,
    },
    tenantAuth: { store: tenantStore },
    toolProfiles: {
      "memory-channel": [
        ...MEMORY_CHANNEL_MCP_TOOLS,
        ...(options.additionalMemoryChannelTools ?? []),
      ],
      ...(options.additionalToolProfiles ?? {}),
    },
    // Enable the RFC 7591 dynamic-client-registration authorization server so MCP
    // connectors can self-register (POST /oauth/register) and complete the OAuth
    // handshake. Without it, discovery falls through to the SPA and connectors fall
    // back to POST /register → 404. Persist to SQLite so registrations and refresh
    // tokens survive redeploys (the default in-memory store would strand every
    // connected client on each deploy).
    oauth: {
      server: true,
      store: createSqliteOAuthStore({ dataDir: storage.dataDir }),
    },
    controlPlane: {
      ...options.controlPlane,
      store: tenantStore,
      env,
    },
    singleTenant: {
      store: tenantStore,
      tokenEnvVar: options.tokenEnvVar ?? "ZENOD_API_TOKEN",
      env,
      tenant: {
        id: env.ZENOD_TENANT_ID?.trim() || "self-host",
        name: env.ZENOD_TENANT_NAME?.trim() || options.defaultTenantName || "Self-hosted Zenod",
        plan: "self-hosted",
      },
    },
    storage,
    metering: { dataDir: storage.dataDir },
    ui: {
      ...(options.webDist ? { webDist: options.webDist } : {}),
      displayName: agent.displayName,
      tagline: agent.tagline,
      panels: options.panels ?? [
        "chat",
        "vault",
        "keys",
        "transcription",
        "connections",
        "costs",
        "test",
      ],
    },
    tools(server, context) {
      const runtime = runtimes.forContext(context);
      const chatInterceptor = options.appOptionsForTenant?.(context.tenant!.id, runtime).chatInterceptor;
      registerZenodTools(server, runtime, agent, chatInterceptor);
      options.registerAdditionalTools?.(server, context, runtime);
    },
    routes(routes) {
      options.mountAdditionalRoutes?.(routes, runtimes);
      routes.all("/api/*", async (c, next) => {
        if (
          [
            "/api/overview",
            "/api/operating-rules",
            "/api/mcp-config",
            "/api/skills",
          ].includes(c.req.path)
        ) {
          return next();
        }
        const context = c.get("unitContext");
        return runtimes.appForContext(context).fetch(c.req.raw, c.env);
      });
    },
  });
  const customer = createCustomerLayer(
    {
      dataDir: storage.dataDir,
      runtimeForAccount: (account) =>
        account.tenant_id
          ? runtimes.get(account.tenant_id) ??
            runtimes.forTenantStorage(account.tenant_id, storage.forTenant({ id: account.tenant_id }))
          : null,
      sharedGithubApp,
    },
    {
      ...options.customer,
      env,
      tenantStore,
      product: options.customerProduct ?? options.customer?.product,
      async onEntitlementChanged(account, input) {
        await options.customer?.onEntitlementChanged?.(account, input);
        await zenodPhylax?.setEntitlement(account, input.entitled);
      },
      async projectUsage(account, local) {
        const productLocal = options.customer?.projectUsage
          ? await options.customer.projectUsage(account, local)
          : local;
        return zenodPhylax
          ? zenodPhylax.usageForAccount(account, productLocal)
          : productLocal;
      },
    },
  );
  zenodPhylax?.setDownstreamTokenResolver((accountId) =>
    customer.tokenVault.get(accountId));
  let phylaxRefreshTimer: NodeJS.Timeout | null = null;
  let phylaxRefreshStopped = false;
  let phylaxRefreshRun: Promise<void> | null = null;
  const configuredPhylaxRefreshDelay = Number(env.ZENOD_PHYLAX_LEGACY_REFRESH_RETRY_MS);
  const initialPhylaxRefreshDelayMs = Number.isSafeInteger(configuredPhylaxRefreshDelay) &&
    configuredPhylaxRefreshDelay > 0
    ? configuredPhylaxRefreshDelay
    : 30_000;
  const configuredHealthyPhylaxRefresh = Number(env.ZENOD_PHYLAX_HEALTHY_REFRESH_MS);
  const healthyPhylaxRefreshMs = Number.isSafeInteger(configuredHealthyPhylaxRefresh) &&
    configuredHealthyPhylaxRefresh > 0
    ? configuredHealthyPhylaxRefresh
    : 5 * 60_000;
  let phylaxRefreshDelayMs = initialPhylaxRefreshDelayMs;
  if (zenodPhylax?.config.enabled) {
    const schedulePhylaxRefresh = (delayMs: number) => {
      if (phylaxRefreshStopped || phylaxRefreshTimer) return;
      phylaxRefreshTimer = setTimeout(() => {
        phylaxRefreshTimer = null;
        void runPhylaxRefresh();
      }, delayMs);
      phylaxRefreshTimer.unref?.();
    };
    const runPhylaxRefresh = (): Promise<void> => {
      if (phylaxRefreshRun) return phylaxRefreshRun;
      const run = (async () => {
        const refreshed = await customer.refreshAuthoritativeSubscriptions();
        await zenodPhylax.bootstrapAccounts(customer.accounts.list());
        if (refreshed.failedAccountIds.length > 0) {
          schedulePhylaxRefresh(phylaxRefreshDelayMs);
          phylaxRefreshDelayMs = Math.min(phylaxRefreshDelayMs * 2, 5 * 60_000);
        } else {
          phylaxRefreshDelayMs = initialPhylaxRefreshDelayMs;
          schedulePhylaxRefresh(healthyPhylaxRefreshMs);
        }
      })().catch((error) => {
        console.error("[zenod-phylax] authoritative refresh/bootstrap failed:", error);
        schedulePhylaxRefresh(phylaxRefreshDelayMs);
        phylaxRefreshDelayMs = Math.min(phylaxRefreshDelayMs * 2, 5 * 60_000);
      }).finally(() => {
        if (phylaxRefreshRun === run) phylaxRefreshRun = null;
      });
      phylaxRefreshRun = run;
      return run;
    };
    queueMicrotask(() => {
      void runPhylaxRefresh();
    });
  }
  const managedAiOutbox = new ManagedAiDownstreamOutbox(join(storage.dataDir, "managed-ai-downstream.sqlite"));
  isHostedCustomerTenant = (tenantId) => customer.accounts.resolveForTenantId(tenantId) !== null;
  googleDriveOAuthAuthorityForTenant = (tenantId) => {
    const accounts = customer.accounts.list().filter(
      (candidate) => candidate.tenant_id === tenantId,
    );
    if (accounts.length === 0) return { mode: "self-hosted" };
    if (accounts.length !== 1) {
      return { mode: "hosted-managed", credentials: null };
    }
    const account = accounts[0]!;
    const entitled = account.subscription_status === "active" ||
      account.subscription_status === "past_due";
    const token = customer.tokenVault.get(account.account_id);
    const tenantRecord = token
      ? tenantStore.resolveTokenHash(hashToken(token))
      : null;
    const synchronousRecord = tenantRecord && typeof tenantRecord === "object" &&
      !("then" in tenantRecord)
      ? tenantRecord
      : null;
    const tenantActive = synchronousRecord?.tenant.id === tenantId &&
      (synchronousRecord.status ?? "active") === "active";
    return {
      mode: "hosted-managed",
      credentials: null,
      ...(entitled && tenantActive ? { tenantCredentialsAllowed: true } : {}),
    };
  };
  const dispatchManagedInput = async (input: ManagedAiAdmissionInput): Promise<Response> => {
    const account = customer.accounts.resolveForTenantId(input.tenantId);
    const token = account ? customer.tokenVault.get(account.account_id) : null;
    const record = token ? await tenantStore.resolveTokenHash(hashToken(token)) : null;
    if (
      !account ||
      !token ||
      !record ||
      record.tenant.id !== input.tenantId ||
      (record.status ?? "active") !== "active" ||
      (account.subscription_status !== "active" && account.subscription_status !== "past_due")
    ) {
      return Response.json({ error: "managed Hosted tenant is unavailable" }, { status: 401 });
    }
    if (input.path === "/internal/telegram") {
      const runtime = runtimes.get(input.tenantId) ??
        runtimes.forTenantStorage(input.tenantId, storage.forTenant({ id: input.tenantId }));
      if (!runtime) return Response.json({ error: "managed Hosted tenant runtime is unavailable" }, { status: 503 });
      const telegramInput = JSON.parse(Buffer.from(input.raw).toString("utf8")) as TelegramManagedInbound;
      return Response.json(await runtime.telegram.processManagedInbound(telegramInput));
    }
    const storedUrl = new URL(input.path, "http://zenod.internal");
    const targetPath = storedUrl.pathname === "/mcp"
      ? `/mcp/${encodeURIComponent(token)}${storedUrl.search}`
      : `${storedUrl.pathname}${storedUrl.search}`;
    const headers = new Headers({
      authorization: `Bearer ${token}`,
      "idempotency-key": input.idempotencyKey,
    });
    if (input.contentType) headers.set("content-type", input.contentType);
    if (storedUrl.pathname === "/mcp") headers.set("accept", "application/json, text/event-stream");
    const bodyAllowed = input.method !== "GET" && input.method !== "HEAD";
    return unit.app.fetch(new Request(`http://zenod.internal${targetPath}`, {
      method: input.method,
      headers,
      ...(bodyAllowed ? { body: Buffer.from(input.raw) } : {}),
    }));
  };
  const processManagedInput = async (input: ManagedAiAdmissionInput) => {
    const response = await managedAiOutbox.execute(input, () => dispatchManagedInput(input));
    return { value: response, receipt: await terminalReceipt(response) };
  };
  const managedTelegramNoticeText = (
    job: ManagedAiAdmissionJob,
    kind: ManagedAiAdmissionNoticeKind,
  ): string => {
    if (kind === "paused") {
      return "I saved your message and queued it. I’ll process it when included AI usage is available again. Nothing was lost.";
    }
    if (job.terminalReceipt?.state === "completed") {
      try {
        const body = JSON.parse(job.terminalReceipt.body) as { replyText?: unknown };
        if (typeof body.replyText === "string" && body.replyText.trim()) return body.replyText;
      } catch {
        // A malformed downstream receipt is not customer-safe success truth.
      }
    }
    return "⚠️ I saved your message, but could not finish processing it. Please try again later.";
  };
  const deliverManagedTelegramNotice = async (
    job: ManagedAiAdmissionJob,
    kind: ManagedAiAdmissionNoticeKind,
  ): Promise<void> => {
    const claimed = customer.managedAiAdmissions.claimNotice(job.id, kind);
    if (!claimed) return;
    try {
      const raw = customer.managedAiAdmissions.raw(job.id);
      if (!raw) throw new Error("managed Telegram raw evidence disappeared");
      const telegramInput = JSON.parse(Buffer.from(raw).toString("utf8")) as TelegramManagedInbound;
      const runtime = runtimes.get(job.tenantId) ??
        runtimes.forTenantStorage(job.tenantId, storage.forTenant({ id: job.tenantId }));
      await runtime.telegram.sendManagedNotice(
        telegramInput.chatId,
        managedTelegramNoticeText(claimed, kind),
      );
      customer.managedAiAdmissions.completeNotice(job.id, kind, true);
    } catch (error) {
      customer.managedAiAdmissions.completeNotice(job.id, kind, false);
      console.error(
        `[managed-ai] Telegram ${kind} notice failed for job ${job.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const reconcileManagedTelegramNotices = async (
    jobs: ManagedAiAdmissionJob[] = customer.managedAiAdmissions.noticeCandidates(),
  ): Promise<void> => {
    for (const job of jobs) {
      if (job.pausedNotice?.state === "pending") await deliverManagedTelegramNotice(job, "paused");
      const refreshed = customer.managedAiAdmissions.get(job.id);
      if (refreshed?.terminalNotice?.state === "pending") {
        await deliverManagedTelegramNotice(refreshed, "terminal");
      }
    }
  };
  managedTelegramAdmission = async (tenantId, telegramInput) => {
    const account = customer.accounts.resolveForTenantId(tenantId);
    if (!account?.tenant_id || (account.subscription_status !== "active" && account.subscription_status !== "past_due")) {
      throw new Error("Hosted Telegram tenant is not entitled");
    }
    const raw = new Uint8Array(Buffer.from(JSON.stringify(telegramInput), "utf8"));
    const outcome = await customer.managedAiAdmissions.submit(
      {
        tenantId,
        idempotencyKey: `telegram:${telegramInput.chatId}:${telegramInput.messageId}`,
        kind: telegramInput.kind,
        method: "POST",
        path: "/internal/telegram",
        contentType: "application/json",
        raw,
      },
      await customer.usageForAccount(account),
      processManagedInput,
    );
    await reconcileManagedTelegramNotices([outcome.job]);
  };
  const resumeManagedAiAdmissions = async (): Promise<number> => {
    // Preserve customer-visible ordering: a queued/cap notice is reconciled
    // before the terminal result generated by this resume pass.
    await reconcileManagedTelegramNotices();
    const completed = await customer.managedAiAdmissions.resume(
      async (tenantId) => {
        const account = customer.accounts.resolveForTenantId(tenantId);
        return account
          ? customer.usageForAccount(account)
          : { percentageUsed: null, state: "unavailable", resetsAt: null };
      },
      processManagedInput,
    );
    await reconcileManagedTelegramNotices();
    return completed;
  };
  const admissionResumeRaw = Number(env.ZENOD_MANAGED_AI_ADMISSION_RESUME_INTERVAL_MS);
  const admissionResumeMs = Number.isFinite(admissionResumeRaw) && admissionResumeRaw > 0
    ? admissionResumeRaw
    : 30_000;
  const admissionResumeTimer = env.ZENOD_MANAGED_AI_ENABLED === "1"
    ? setInterval(() => {
        void resumeManagedAiAdmissions().catch((error) => {
          console.error("[managed-ai] admission resume failed:", error);
        });
      }, admissionResumeMs)
    : null;
  admissionResumeTimer?.unref?.();
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "same-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
    const contentSecurityPolicy =
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; connect-src 'self'";
    // Native MCP OAuth clients use RFC 8252 loopback redirects such as
    // http://127.0.0.1:<ephemeral-port>. Applying upgrade-insecure-requests to
    // the consent page or its decision response rewrites that browser-only
    // callback to HTTPS and strands the authorization flow. The authorization
    // form also needs to follow redirects to registered HTTPS or loopback
    // callbacks; the OAuth handler still enforces an exact registered URI.
    // Keep every other production route upgraded and limited to the checkout
    // form target while leaving these two routes OAuth-client compatible.
    const isMcpOAuthBrowserRoute =
      c.req.path === "/oauth/authorize" ||
      c.req.path === "/oauth/authorize/decision";
    const formActionPolicy = isMcpOAuthBrowserRoute
      ? "form-action 'self' https: http://127.0.0.1:* http://[::1]:*"
      : "form-action 'self' https://checkout.stripe.com";
    const routeContentSecurityPolicy = `${contentSecurityPolicy}; ${formActionPolicy}`;
    c.header(
      "Content-Security-Policy",
      env.NODE_ENV === "production" && !isMcpOAuthBrowserRoute
        ? `${routeContentSecurityPolicy}; upgrade-insecure-requests`
        : routeContentSecurityPolicy,
    );
    if (
      c.req.path.startsWith("/api/") ||
      c.req.path.startsWith("/auth/") ||
      c.req.path.startsWith("/checkout/") ||
      c.req.path.startsWith("/oauth/")
    ) {
      c.header("Cache-Control", "no-store");
    }
    if (env.NODE_ENV === "production") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });
  if (agent.name === "zenod") {
    app.get("/.well-known/atomic-unit-skill.json", (c) =>
      unit.app.fetch(c.req.raw, c.env),
    );
    app.get(ZENOD_SKILL_BUNDLE_PATH, (c) =>
      c.json(zenodSkillBundle(), 200, {
        "Content-Type":
          "application/vnd.zenod.agent-skill+json; charset=utf-8",
      }),
    );
  }
  app.get("/api/health", (c) =>
    c.json({ status: "ok", name: agent.name, version: VERSION, sha: resolvedGitSha() }),
  );
  if (
    agent.name === "zenod" &&
    (zenodPhylax?.config.enabled || hostedChannelsConfigured(env))
  ) {
    mountHostedChannelsCustomerRoutes(app, {
      env,
      ...(zenodPhylax?.config.enabled
        ? { transport: { request: (tenant, action) => zenodPhylax.channels(tenant, action) } }
        : {}),
      routeVisible(c) {
        const session = readCustomerSession(c, env);
        return Boolean(
          session && customer.accounts.resolveForUser(session.github_id),
        );
      },
      async resolveTenant(c) {
        const session = readCustomerSession(c, env);
        if (!session) return null;
        const account = customer.accounts.resolveActiveTenantForUser(session.github_id);
        const downstreamToken = account
          ? customer.tokenVault.get(account.account_id)
          : null;
        const record = downstreamToken
          ? await tenantStore.resolveTokenHash(hashToken(downstreamToken))
          : null;
        if (
          !account?.tenant_id ||
          !downstreamToken ||
          !record ||
          record.tenant.id !== account.tenant_id ||
          (record.status ?? "active") !== "active" ||
          (account.subscription_status !== "active" &&
            account.subscription_status !== "past_due")
        ) return null;
        return zenodPhylax?.config.enabled
          ? zenodPhylax.customerTenant(account, downstreamToken)
          : {
              tenantId: account.tenant_id,
              downstreamToken,
              processingPaused:
                (account as { managed_ai_status?: string }).managed_ai_status ===
                "paused",
            };
      },
    });
  } else if (agent.name === "zenod") {
    app.all("/api/channels", (c) => c.json({ error: "not found" }, 404));
    app.all("/api/channels/*", (c) => c.json({ error: "not found" }, 404));
  }
  if (options.customerAdmin) {
    const admin = options.customerAdmin;
    const adminOnly: MiddlewareHandler<{ Bindings: HttpBindings }> = async (c, next) => {
      const session = readCustomerSession(c, env);
      if (!session || session.login.toLowerCase() !== admin.githubLogin.toLowerCase()) {
        return c.req.path.startsWith("/api/")
          ? c.json({ error: "not found" }, 404)
          : c.text("Not Found", 404);
      }
      await next();
    };
    app.use("/admin", adminOnly);
    app.use("/admin/*", adminOnly);
    app.use("/api/admin/*", adminOnly);
    app.use("/api/whatsapp/*", adminOnly);
    app.use("/api/telegram/*", adminOnly);
    app.get("/api/admin/overview", (c) => {
      const accounts = customer.accounts.list()
        .sort((left, right) => right.claimed_at.localeCompare(left.claimed_at));
      const uniqueAccounts = [...new Map(
        accounts.map((account) => [account.account_id, account]),
      ).values()];
      const subscriptions = {
        active: uniqueAccounts.filter((account) => account.subscription_status === "active").length,
        pastDue: uniqueAccounts.filter((account) => account.subscription_status === "past_due").length,
        paused: uniqueAccounts.filter((account) => account.subscription_status === "paused").length,
        canceled: uniqueAccounts.filter((account) => account.subscription_status === "canceled").length,
        pending: uniqueAccounts.filter((account) =>
          account.subscription_status === null || account.subscription_status === "checkout_pending"
        ).length,
      };
      return c.json({
        service: {
          status: "ok",
          name: agent.name,
          version: VERSION,
          sha: resolvedGitSha(),
        },
        signup: { open: env.ZENOD_PUBLIC_PAID_SIGNUP === "1" },
        totals: {
          accounts: uniqueAccounts.length,
          tenantBound: uniqueAccounts.filter((account) => Boolean(account.tenant_id)).length,
          ...subscriptions,
        },
        tenants: uniqueAccounts.map((account) => ({
          accountId: account.account_id,
          githubLogin: account.github_login,
          tenantId: account.tenant_id,
          tier: account.tier,
          subscriptionStatus: account.subscription_status,
          currentPeriodEnd: account.current_period_end,
          managedAiStatus: account.managed_ai_status,
        })),
        generatedAt: new Date().toISOString(),
      });
    });
    admin.mountRoutes?.(app);
    if (options.webDist) {
      app.get("/admin", serveStatic({
        root: options.webDist,
        path: "index.html",
        onFound: (_path, c) => c.header("Cache-Control", "no-cache, no-store, must-revalidate"),
      }));
    }
  }
  app.route("/", customer.app);
  const publicSiteHost = (options.customerProduct ?? options.customer?.product)?.defaultDomain;
  mountStaticSurfaces(app, {
    webDist: options.webDist,
    siteDist: options.siteDist,
    ...(publicSiteHost ? { publicSiteHost: new URL(publicSiteHost).hostname } : {}),
  });
  app.all("*", async (c) => {
    const session = readCustomerSession(c, env);
    const authorization = c.req.header("authorization");
    const directToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;
    const pathToken = c.req.path.startsWith("/mcp/")
      ? decodeURIComponent(c.req.path.slice("/mcp/".length).split("/")[0] ?? "")
      : null;
    const bearerRecord = directToken
      ? await tenantStore.resolveTokenHash(hashToken(directToken))
      : null;
    const pathRecord = pathToken
      ? await tenantStore.resolveTokenHash(hashToken(pathToken))
      : null;
    const credentialMismatch = Boolean(
      bearerRecord && pathRecord && bearerRecord.tenant.id !== pathRecord.tenant.id,
    );
    const directRecord = bearerRecord ?? pathRecord;
    if (c.req.method === "GET" && c.req.path.startsWith("/api/customer-managed-ai/jobs/") && directRecord) {
      const account = customer.accounts.resolveForTenantId(directRecord.tenant.id);
      const id = c.req.path.slice("/api/customer-managed-ai/jobs/".length);
      const job = account?.tenant_id && (directRecord.status ?? "active") === "active"
        ? customer.managedAiAdmissions.getForTenant(id, account.tenant_id)
        : null;
      return job ? c.json({ job }) : c.json({ error: "job not found" }, 404);
    }
    const isCustomerAdmin = Boolean(
      session && options.customerAdmin &&
      session.login.toLowerCase() === options.customerAdmin.githubLogin.toLowerCase(),
    );
    const hostedAccount = !isCustomerAdmin && session
      ? customer.accounts.resolveForUser(session.github_id)
      : directRecord
        ? customer.accounts.resolveForTenantId(directRecord.tenant.id)
        : null;
    const capabilityViolation = hostedAccount
      ? hostedCapabilityViolation(c.req.method, c.req.path)
      : null;
    const managedSettingsBodyViolation = hostedAccount
      ? await hostedSettingsBodyViolation(c.req.raw)
      : false;
    const hostedMcpReadViolation = hostedAccount &&
      c.req.method === "POST" &&
      (c.req.path === "/mcp" || c.req.path.startsWith("/mcp/"))
      ? hostedSensitiveMcpRead(new Uint8Array(await c.req.raw.clone().arrayBuffer()))
      : false;
    if (capabilityViolation || managedSettingsBodyViolation || hostedMcpReadViolation) {
      return c.json({
        error: "forbidden",
        capability: capabilityViolation ?? (hostedMcpReadViolation ? "raw_usage" : "managed_settings"),
      }, 403);
    }
    let downstreamRequest = c.req.raw;
    let admissionAccount = directRecord && !credentialMismatch && (directRecord.status ?? "active") === "active"
      ? customer.accounts.resolveForTenantId(directRecord.tenant.id)
      : null;
    if (session) {
      const forbidden =
        c.req.path === "/api/tenants" ||
        c.req.path.startsWith("/api/tenants/") ||
        c.req.path === "/api/exec" ||
        c.req.path.startsWith("/api/exec/") ||
        c.req.path.startsWith("/api/executions") ||
        c.req.path.startsWith("/api/executor") ||
        c.req.path.startsWith("/api/journeys") ||
        c.req.path.startsWith("/api/journey-steps") ||
        c.req.path.startsWith("/api/tasks") ||
        c.req.path === "/api/lane-secret" ||
        c.req.path.startsWith("/mcp") ||
        c.req.path === "/internal" ||
        c.req.path.startsWith("/internal/");
      if (forbidden) return c.json({ error: "forbidden" }, 403);

      const headers = new Headers(c.req.raw.headers);
      headers.delete("cookie");
      if (c.req.path.startsWith("/api/")) {
        const account = customer.accounts.resolveActiveTenantForUser(session.github_id);
        const token = account ? customer.tokenVault.get(account.account_id) : null;
        const record = token ? await tenantStore.resolveTokenHash(hashToken(token)) : null;
        if (
          !account?.tenant_id ||
          !token ||
          !record ||
          record.tenant.id !== account.tenant_id ||
          (record.status ?? "active") !== "active"
        ) {
          return c.json({ error: "unauthorized" }, 401);
        }
        headers.set("authorization", `Bearer ${token}`);
      }
      downstreamRequest = new Request(c.req.raw, { headers });
      admissionAccount = customer.accounts.resolveActiveTenantForUser(session.github_id);
    }
    const isEntitledHosted = Boolean(
      admissionAccount?.tenant_id &&
      (admissionAccount.subscription_status === "active" || admissionAccount.subscription_status === "past_due"),
    );
    if (isEntitledHosted && !credentialMismatch) {
      const raw = new Uint8Array(await downstreamRequest.clone().arrayBuffer());
      const isMcp = c.req.path === "/mcp" || c.req.path.startsWith("/mcp/");
      // MCP is already a complete authenticated service boundary, and Phylax
      // owns durable channel admission/replay. Never persist and replay the raw
      // MCP HTTP exchange through the hosted web-usage queue: the streamable
      // MCP transport is tied to the original Node request/response bindings.
      // Product HTTP endpoints keep their existing hosted admission policy.
      const paid = !isMcp && MANAGED_AI_HTTP_PATHS.has(c.req.path);
      if (paid) {
        const requestUrl = new URL(c.req.url);
        const storedPath = `${requestUrl.pathname}${requestUrl.search}`;
        const input: ManagedAiAdmissionInput = {
          tenantId: admissionAccount!.tenant_id!,
          idempotencyKey: admissionIdempotencyKey(c.req.raw, admissionAccount!.tenant_id!, null, raw),
          kind: managedAiRawKind(storedPath, c.req.header("content-type") ?? null, "text", raw),
          method: c.req.method,
          path: storedPath,
          contentType: c.req.header("content-type") ?? null,
          raw,
        };
        const outcome = await customer.managedAiAdmissions.submit(
          input,
          await customer.usageForAccount(admissionAccount!),
          processManagedInput,
        );
        if (outcome.state === "processed") return outcome.value;
        if (outcome.state === "replayed" || outcome.state === "failed") {
          return responseFromReceipt(outcome.receipt);
        }
        return c.json({
          state: outcome.state,
          job: {
            id: outcome.job.id,
            status: outcome.job.status,
            kind: outcome.job.kind,
            resetsAt: outcome.job.resetsAt,
          },
          poll: `/api/customer-managed-ai/jobs/${outcome.job.id}`,
        }, 202);
      }
    }
    const response = await unit.app.fetch(downstreamRequest, c.env);
    const hostedDriveAllowed = admissionAccount?.tenant_id
      ? runtimes.get(admissionAccount.tenant_id)?.settings.googleDriveTenantCredentialsAllowed() === true
      : false;
    const canonicalDirectToken = session && hostedAccount
      ? customer.tokenVault.get(hostedAccount.account_id)
      : null;
    return hostedAccount &&
      (c.req.method === "GET" || (c.req.method === "PUT" && c.req.path === "/api/settings"))
      ? projectHostedCustomerResponse(c.req.path, response, hostedDriveAllowed, canonicalDirectToken)
      : response;
  });
  return {
    ...unit,
    app,
    runtimes,
    storage,
    tenantStore,
    customerAccounts: customer.accounts,
    customerTokenVault: customer.tokenVault,
    customerManagedAiAdmissions: customer.managedAiAdmissions,
    zenodPhylax,
    resumeManagedAiAdmissions,
    async close() {
      const failures: unknown[] = [];
      phylaxRefreshStopped = true;
      if (phylaxRefreshTimer) clearTimeout(phylaxRefreshTimer);
      if (phylaxRefreshRun) {
        try {
          await phylaxRefreshRun;
        } catch (error) {
          failures.push(error);
        }
      }
      for (
        const result of await Promise.allSettled([
          Promise.resolve().then(() => options.customerAdmin?.close?.()),
          Promise.resolve().then(() => {
            if (admissionResumeTimer) clearInterval(admissionResumeTimer);
          }),
          Promise.resolve().then(() => customer.close()),
          Promise.resolve().then(() => zenodPhylax?.close()),
          Promise.resolve().then(() => managedAiOutbox.close()),
          runtimes.close(),
        ])
      ) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      if ("close" in tenantStore && typeof tenantStore.close === "function") {
        try {
          tenantStore.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, "Unit shutdown failed");
    },
  };
}
