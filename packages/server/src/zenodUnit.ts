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
    private readonly managedTelegramTenant?: (tenantId: string) => boolean,
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
      ...(this.managedTelegramInbound
        ? { managedTelegramInbound: (input) => this.managedTelegramInbound!(tenantId, input) }
        : {}),
      ...(this.managedTelegramTenant
        ? { managedTelegramInboundEnabled: () => this.managedTelegramTenant!(tenantId) }
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
    () => buildDriveTools(settings, runtime.ingestQueue),
    () => runtime.cleanSlate(),
    (input) => chatTestAudit.recordChatTestRun(input),
    {
      enqueue: (kind, input, idempotencyKey) => runtime.taskJobQueue.enqueue(kind, input, idempotencyKey),
      get: (id) => runtime.taskJobQueue.get(id),
      recent: (limit) => runtime.taskJobQueue.recent(limit),
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
  store_memory: { pollTool: "get_task_result" },
  ingest_memory: { pollTool: "get_task_result" },
  task_brain: { pollTool: "get_task_result" },
  run_task: { pollTool: "get_task_result" },
} as const;

const HOSTED_MANAGED_SETTINGS_MUTATIONS = new Set([
  "POST /api/settings/test-llm",
  "PUT /api/executor/settings",
  "POST /api/team/enable",
  "PUT /api/phylax/config",
  "PUT /api/whatsapp/settings",
  "POST /api/whatsapp/pair",
  "POST /api/whatsapp/disconnect",
  "POST /api/whatsapp/reset-session",
  "POST /api/token/regenerate",
]);

const HOSTED_MANAGED_SETTINGS_READS = new Set([
  "GET /api/executor/settings",
  "GET /api/transcription/status",
  "GET /api/transcription/models",
  "GET /api/transcription/openrouter-models",
]);

const HOSTED_INTERNAL_CONTROL_PREFIXES = [
  "/api/ring",
  "/api/phylax",
  "/api/team",
  "/api/peers",
  "/internal",
] as const;

const HOSTED_MANAGED_SETTING_KEYS = new Set([
  "provider",
  "anthropic_api_key",
  "openai_api_key",
  "openrouter_api_key",
  "groq_api_key",
  "model_ask",
  "model_classify",
  "model_vision",
  "model_max_steps",
  "openai_long_transcription",
  "long_transcription_provider",
  "openrouter_transcription_model",
  "whisper_model",
]);

export function hostedCapabilityViolation(
  method: string,
  path: string,
): "raw_usage" | "managed_settings" | "internal_controls" | null {
  const normalizedMethod = method.toUpperCase();
  if (path === "/api/usage" || path.startsWith("/api/usage/")) return "raw_usage";
  if (HOSTED_INTERNAL_CONTROL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return "internal_controls";
  }
  const operation = `${normalizedMethod} ${path}`;
  return HOSTED_MANAGED_SETTINGS_MUTATIONS.has(operation) || HOSTED_MANAGED_SETTINGS_READS.has(operation)
    ? "managed_settings"
    : null;
}

const HOSTED_CUSTOMER_SETTING_KEYS = new Set([
  "instance_name",
  "vault_repo",
  "vault_branch",
  "google_drive_folder_id",
  "artifact_archive_provider",
  "artifact_archive_drive_folder_id",
  "telegram_enabled",
  "telegram_allowed_users",
  "telegram_accept_all",
  "telegram_rich",
]);

async function projectHostedCustomerResponse(path: string, response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  if (!["/api/settings", "/api/overview", "/api/drive/status", "/api/auth/status"].includes(path)) {
    return response;
  }
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return response;
  let projected: Record<string, unknown>;
  if (path === "/api/settings") {
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
    const { transcriptionProvider: _transcriptionProvider, ...safeDriveStatus } = body;
    projected = safeDriveStatus;
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return Object.keys(body).some((key) => HOSTED_MANAGED_SETTING_KEYS.has(key));
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
const MANAGED_AI_MCP_TOOLS = new Set([
  "ask_brain",
  "chat_with_zenod",
  "ingest_memory",
  "run_task",
  "store_memory",
  "task_brain",
]);

function managedAiMcpEnvelope(raw: Uint8Array): {
  paid: boolean;
  id: string | null;
  kind: ManagedAiRawKind;
  tool: string | null;
} {
  try {
    const payload = JSON.parse(Buffer.from(raw).toString("utf8")) as {
      id?: unknown;
      method?: unknown;
      params?: { name?: unknown; arguments?: Record<string, unknown> };
    };
    const args = payload.params?.arguments;
    const mime = typeof args?.mimeType === "string" ? args.mimeType : "";
    return {
      paid: payload.method === "tools/call" &&
        typeof payload.params?.name === "string" &&
        MANAGED_AI_MCP_TOOLS.has(payload.params.name),
      id: typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id) : null,
      kind: mime.startsWith("audio/") ? "audio" : mime.startsWith("image/") ? "image" : "text",
      tool: typeof payload.params?.name === "string" ? payload.params.name : null,
    };
  } catch {
    return { paid: false, id: null, kind: "text", tool: null };
  }
}

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
  const sharedGithubApp = loadSharedGithubApp(storage.dataDir, env);
  let managedTelegramAdmission: ((tenantId: string, input: TelegramManagedInbound) => Promise<void>) | null = null;
  let isHostedTelegramTenant: (tenantId: string) => boolean = () => false;
  const runtimes = new ZenodRuntimePool(
    env,
    sharedGithubApp,
    agent,
    options.appOptionsForTenant,
    async (tenantId, input) => {
      if (!managedTelegramAdmission) throw new Error("Hosted Telegram admission is not initialized");
      await managedTelegramAdmission(tenantId, input);
    },
    (tenantId) => isHostedTelegramTenant(tenantId),
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
    },
  );
  const managedAiOutbox = new ManagedAiDownstreamOutbox(join(storage.dataDir, "managed-ai-downstream.sqlite"));
  isHostedTelegramTenant = (tenantId) => customer.accounts.resolveForTenantId(tenantId) !== null;
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
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; connect-src 'self'; form-action 'self' https://checkout.stripe.com";
    c.header(
      "Content-Security-Policy",
      env.NODE_ENV === "production" ? `${contentSecurityPolicy}; upgrade-insecure-requests` : contentSecurityPolicy,
    );
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/") || c.req.path.startsWith("/checkout/")) {
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
    app.use("/api/whatsapp/*", adminOnly);
    app.use("/api/telegram/*", adminOnly);
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
      const mcp = isMcp ? managedAiMcpEnvelope(raw) : { paid: false, id: null, kind: "text" as const, tool: null };
      const profiledMcpAllowed = !directRecord?.profile ||
        (directRecord.profile === "memory-channel" && mcp.tool !== null &&
          (MEMORY_CHANNEL_MCP_TOOLS as readonly string[]).includes(mcp.tool));
      const paid = (isMcp ? mcp.paid && profiledMcpAllowed : MANAGED_AI_HTTP_PATHS.has(c.req.path));
      if (paid) {
        const requestUrl = new URL(c.req.url);
        const storedPath = `${isMcp ? "/mcp" : requestUrl.pathname}${requestUrl.search}`;
        const input: ManagedAiAdmissionInput = {
          tenantId: admissionAccount!.tenant_id!,
          idempotencyKey: admissionIdempotencyKey(c.req.raw, admissionAccount!.tenant_id!, mcp.id, raw),
          kind: managedAiRawKind(storedPath, c.req.header("content-type") ?? null, mcp.kind, raw),
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
    return hostedAccount && c.req.method === "GET"
      ? projectHostedCustomerResponse(c.req.path, response)
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
    resumeManagedAiAdmissions,
    async close() {
      const failures: unknown[] = [];
      for (
        const result of await Promise.allSettled([
          Promise.resolve().then(() => options.customerAdmin?.close?.()),
          Promise.resolve().then(() => {
            if (admissionResumeTimer) clearInterval(admissionResumeTimer);
          }),
          Promise.resolve().then(() => customer.close()),
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
