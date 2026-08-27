import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChassisStorage,
  createSqliteOAuthStore,
  createSqliteTenantStore,
  createUnit,
  hashToken,
  type TenantProvisioningStore,
  type UnitContext,
} from "@zenod/mcp-chassis";
import { VERSION } from "zenod/version";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { PHYLAX_AGENT } from "./agent.js";
import {
  captureMemoryAuthorityId,
  isCaptureMemoryTool,
} from "./captureMemoryAuthority.js";
import { readCustomerSession } from "./customerSession.js";
import {
  HostedChannelMutationAuditStore,
  mountPhylaxHostedChannelRoutes,
} from "./hostedChannels.js";
import {
  createPhylaxArtifactCapabilityUrl,
  phylaxArtifactCapabilitySecret,
  verifyPhylaxArtifactCapability,
} from "./phylaxArtifactCapability.js";
import { openRouterTranscriptionModels } from "./openrouterModels.js";
import { callPeerTool, discoverPeerTools } from "./peerClient.js";
import { probePhylaxTranscriptionProvider } from "./phylaxTranscriptionProbe.js";
import { RingCaptureTicketProducer } from "./ringCaptureTicketProducer.js";
import {
  DEFAULT_OPENROUTER_STT_MODEL,
  GROQ_STT_MODEL,
  isValidWhisperModel,
  OPENAI_STT_MODEL,
  prepareModel,
  transcribeAudio,
  WHISPER_MODELS,
  type TranscribeOptions,
} from "./transcribe.js";
import {
  PhylaxChannelError,
  PhylaxChannelsOrgan,
  phylaxWhatsAppPaths,
  registerPhylaxChannelTools,
  type PhylaxPortedChannel,
} from "./phylaxChannels.js";
import { mountPhylaxAdminChannelRoutes, PhylaxPortedRuntime } from "./phylaxPortedRuntime.js";
import {
  effectivePhylaxTurnBindings,
  defaultPhylaxTurnBindings,
  PhylaxTenantSettingsStore,
} from "./phylaxTenantSettings.js";
import {
  assertCustomerDownstreamMutationAllowed,
  bindPhylaxInstanceIdentity,
  resolvePhylaxInstanceConfig,
  type PhylaxInstanceConfig,
} from "./phylaxInstance.js";
import {
  createPhylaxCustomerLayer,
} from "./phylaxCustomerLayer.js";
import type { CustomerLayerOptions } from "./customerLayer.js";
import { mountStaticSurfaces } from "./staticSurfaces.js";

export const PHYLAX_ADMIN_GITHUB_LOGIN = "alfablok";
export const PHYLAX_DEFAULT_LOCAL_WHISPER_MODEL = "base";
export const PHYLAX_DEFAULT_RING_TICKET_URL = "https://ring.zenod.dev/mcp";
export const PHYLAX_DEFAULT_ASSISTANT_URL = "https://ring.zenod.dev/mcp";
export const ZENOD_WHATSAPP_VERIFICATION_REPLY =
  "Your WhatsApp number is verified. Return to Zenod to finish setup.";
export const ZENOD_TELEGRAM_VERIFICATION_REPLY =
  "Your Telegram identity is verified. Return to Zenod to finish setup.";
const PHYLAX_TRANSPORT_RESTART_AFTER_MS = 60_000;

type AppContext = Context<{ Bindings: HttpBindings }>;

function resolvedPhylaxGitSha(env: NodeJS.ProcessEnv): string {
  const configured = env.GIT_SHA?.trim();
  if (configured && configured !== "unknown") return configured;
  try {
    const baked = readFileSync("/app/.gitsha", "utf8").trim();
    if (baked) return baked;
  } catch {
    // Local/test execution has no baked source SHA.
  }
  return configured || "unknown";
}

export interface CreatePhylaxUnitOptions {
  dataDir?: string;
  /** Reuse one storage owner while preserving the existing Phylax volume layout. */
  storage?: ChassisStorage;
  webDist?: string;
  siteDist?: string;
  tenantStore?: TenantProvisioningStore;
  customer?: CustomerLayerOptions;
  env?: NodeJS.ProcessEnv;
  /** Test/product extension seam; receives only the Phylax MCP context. */
  registerAdditionalTools?: (server: McpServer, context: UnitContext) => void;
  instance?: PhylaxInstanceConfig;
}

/** Compose the shipped customer unit with the ported channels organ. */
export function createPhylaxUnit(options: CreatePhylaxUnitOptions = {}) {
  const env = options.env ?? process.env;
  const configuredInstance = options.instance;
  const instance = configuredInstance ?? resolvePhylaxInstanceConfig(env);
  const dataDir = options.dataDir ?? options.storage?.dataDir ?? env.ZENOD_DATA_DIR ?? "./data";
  bindPhylaxInstanceIdentity(dataDir, instance);
  const configuredRestartAfter = Number(
    env.PHYLAX_TRANSPORT_RESTART_AFTER_MS ?? PHYLAX_TRANSPORT_RESTART_AFTER_MS,
  );
  const transportRestartAfterMs = Number.isFinite(configuredRestartAfter)
    ? Math.max(1_000, Math.min(configuredRestartAfter, 900_000))
    : PHYLAX_TRANSPORT_RESTART_AFTER_MS;
  const storage = options.storage ?? new ChassisStorage({
    dataDir,
    vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY,
  });
  const tenantStore = options.tenantStore ?? createSqliteTenantStore({
    dataDir: storage.dataDir,
    busyTimeoutMs: 30_000,
  });
  const tenantSettings = new PhylaxTenantSettingsStore(storage.dataDir, storage, {
    assistantUrl: env.PHYLAX_ASSISTANT_URL?.trim() || PHYLAX_DEFAULT_ASSISTANT_URL,
    ringTicketUrl: env.PHYLAX_RING_TICKET_URL?.trim() || PHYLAX_DEFAULT_RING_TICKET_URL,
  });
  const hostedChannelAudit = new HostedChannelMutationAuditStore(storage.dataDir);
  const artifactCapabilitySecret = phylaxArtifactCapabilitySecret(env);
  const captureJournalPath = join(storage.dataDir, "phylax-capture-jobs.sqlite");
  const captureTickets = new RingCaptureTicketProducer(
    join(storage.dataDir, "ring-capture-ticket-outbox.sqlite"),
    async (ticket) => {
      const credentials = tenantSettings.ringTicketCredentials(ticket.tenantId);
      if (!credentials) return "pending";
      const result = await callPeerTool(
        {
          name: `phylax-ring-${ticket.tenantId}`,
          url: credentials.url,
          token: credentials.token,
          wallet: false,
        },
        "record_capture_ticket",
        {
          surface: ticket.surface,
          conversationKey: ticket.conversationKey,
          providerMessageId: ticket.providerMessageId,
          jobId: ticket.jobId,
          memoryAuthorityId: ticket.memoryAuthorityId,
          captureTool: ticket.captureTool,
        },
      );
      const structured = result.structuredContent;
      if (!structured || typeof structured !== "object" || Array.isArray(structured)) return "pending";
      const status = (structured as Record<string, unknown>).status;
      return status === "recorded" || status === "duplicate" ? status : "pending";
    },
  );
  const organ = createTenantOrgan(
    storage.dataDir,
    tenantSettings,
    captureTickets,
    env,
    artifactCapabilitySecret,
    instance,
  );
  const runtime = new PhylaxPortedRuntime(storage.dataDir, organ, env, {
    verifyInbound({ channel, sender, username, text }) {
      const verified =
        channel === "whatsapp"
          ? tenantSettings.verifyInboundReceipt(sender, text)
          : tenantSettings.verifyTelegramInbound(sender, text, username);
      if (verified && !verified.replayed) {
        hostedChannelAudit.recordVerification(
          channel,
          verified.settings.tenantId,
          sender,
          tenantSettings.bindingRevision(verified.settings.tenantId, channel),
        );
      }
      return verified
        ? channel === "whatsapp"
          ? ZENOD_WHATSAPP_VERIFICATION_REPLY
          : ZENOD_TELEGRAM_VERIFICATION_REPLY
        : null;
    },
    observeCaptureJob(ticket) {
      captureTickets.observeJob(ticket, ticket.terminal);
    },
    wakeCaptureTickets() {
      captureTickets.recoverFromCaptureJournal(captureJournalPath);
    },
  });
  const bootLocalModel = env.PHYLAX_LOCAL_WHISPER_MODEL?.trim();
  if (env.PHYLAX_PREWARM_LOCAL_MODEL !== "0") {
    void prepareModel(
      bootLocalModel && isValidWhisperModel(bootLocalModel)
        ? bootLocalModel
        : PHYLAX_DEFAULT_LOCAL_WHISPER_MODEL,
    );
  }

  const base = createUnit({
    name: "phylax",
    version: VERSION,
    conduct: {
      toolKinds: { read: ["channel_status", "get_recent_conversation_transcript"] },
    },
    tenantAuth: { store: tenantStore },
    oauth: {
      server: true,
      store: createSqliteOAuthStore({ dataDir: storage.dataDir }),
    },
    singleTenant: {
      store: tenantStore,
      tokenEnvVar: "PHYLAX_API_TOKEN",
      env,
      tenant: {
        id: env.PHYLAX_TENANT_ID?.trim() || "self-host",
        name: env.PHYLAX_TENANT_NAME?.trim() || "Self-hosted Phylax",
        plan: "self-hosted",
      },
    },
    storage,
    metering: { dataDir: storage.dataDir },
    ui: {
      displayName: PHYLAX_AGENT.displayName,
      tagline: PHYLAX_AGENT.tagline,
      panels: ["mcp", "transcription", "connections"],
    },
    tools(server, context) {
      registerTenantChannelTools(server, context, runtime, tenantSettings);
      options.registerAdditionalTools?.(server, context);
    },
  });
  const customer = createPhylaxCustomerLayer(
    { dataDir: storage.dataDir },
    { ...options.customer, env, tenantStore },
  );
  captureTickets.recoverFromCaptureJournal(
    captureJournalPath,
  );
  captureTickets.resume();
  void runtime.start().catch((error) => console.error("phylax channels failed to start:", error));

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
    if (
      (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/") || c.req.path.startsWith("/checkout/"))
      && !c.res.headers.has("cache-control")
    ) {
      c.header("Cache-Control", "no-store");
    }
    if (env.NODE_ENV === "production") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });
  app.get("/api/health", (c) => {
    const now = Date.now();
    const whatsapp = runtime.whatsapp.status();
    const worker = runtime.workerHealth();
    const receivePathObservableDegradation =
      whatsapp.receivePath.status !== "ready" && whatsapp.receivePath.status !== "disabled";
    const outageForMs = whatsapp.receivePath.outageSince === null
      ? 0
      : Math.max(0, now - whatsapp.receivePath.outageSince);
    const transportRestartRequired =
      whatsapp.receivePath.restartable && outageForMs >= transportRestartAfterMs;
    const workerRestartRequired = worker.status === "degraded";
    const restartRequired = transportRestartRequired || workerRestartRequired;
    const degraded = receivePathObservableDegradation || workerRestartRequired;
    return c.json({
      status: restartRequired ? "unhealthy" : degraded ? "degraded" : "ok",
      name: PHYLAX_AGENT.name,
      version: VERSION,
      sha: resolvedPhylaxGitSha(env),
      instance: {
        id: instance.instanceId,
        mode: instance.mode,
        downstreamAdapter: instance.downstreamAdapter,
        customerConfigurableDownstream: instance.customerConfigurableDownstream,
        commercialOwner: instance.commercialOwner,
        serviceNumberId: instance.serviceNumberId,
        adminOrigin: instance.adminOrigin,
        runtime: "phylax",
      },
      worker,
      restart: {
        required: restartRequired,
        reason: workerRestartRequired
          ? "event-loop-heartbeat-stale"
          : transportRestartRequired
            ? "transport-outage-sustained"
            : null,
        transportRestartAfterMs,
        outageForMs,
      },
      channels: {
        whatsapp: {
          providerMode: whatsapp.providerMode,
          state: whatsapp.state,
          receivePath: whatsapp.receivePath,
          scope: "transport-lifecycle-only",
        },
      },
    }, restartRequired ? 503 : 200);
  });
  mountPhylaxHostedChannelRoutes(app, {
    env,
    settings: tenantSettings,
    runtime,
    audit: hostedChannelAudit,
  });
  app.get("/api/phylax/settings", (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    c.header("cache-control", "private, no-store");
    const account = customer.accounts.list().find((candidate) => candidate.tenant_id === tenantId);
    const token = account ? customer.tokenVault.get(account.account_id) : null;
    return c.json({
      settings: tenantSettings.view(tenantId),
      phylaxNumber: runtime.whatsapp.status().linkedNumber,
      mcp: token
        ? {
            url: `${(env.CUSTOMER_APP_URL || "https://phylax.zenod.dev").replace(/\/$/, "")}/mcp/${token}`,
            token,
          }
        : null,
    });
  });
  app.get("/api/phylax/transcription/options", async (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    c.header("cache-control", "private, no-store");
    const catalog = await openRouterTranscriptionModels(
      Number.POSITIVE_INFINITY,
      { forceRefresh: c.req.query("refresh") === "1" },
    );
    return c.json({
      defaults: {
        local: PHYLAX_DEFAULT_LOCAL_WHISPER_MODEL,
        groq: GROQ_STT_MODEL,
        openai: OPENAI_STT_MODEL,
        openrouter: DEFAULT_OPENROUTER_STT_MODEL,
      },
      localModels: WHISPER_MODELS,
      openrouterModels: catalog.models,
      openrouterCatalog: {
        cached: catalog.cached,
        fallback: catalog.fallback,
      },
    });
  });
  app.post("/api/phylax/downstream/tools", async (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    c.header("cache-control", "private, no-store");
    const credentials = tenantSettings.downstreamCredentials(tenantId);
    if (!credentials) {
      return c.json({
        error: "Save this tenant's memory-scoped MCP URL and token before discovering tools.",
      }, 409);
    }
    const discovery = await discoverPeerTools({
      name: "phylax-memory-downstream",
      url: credentials.url,
      token: credentials.token,
    });
    if (discovery.tools !== "ready") {
      return c.json({
        error: discovery.transport === "connected"
          ? "Authenticated downstream tools/list failed. Check the memory-scoped token and tool schemas."
          : "Could not connect to the tenant's downstream MCP. Check its URL, memory-scoped token, and availability.",
      }, 502);
    }
    return c.json({
      tools: discovery.specs.map((tool) => ({
        name: tool.mcp,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: "object" },
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      })),
    });
  });
  app.put("/api/phylax/settings", async (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    try {
      const body = parsePhylaxSettingsUpdate(await c.req.json<unknown>());
      assertCustomerDownstreamMutationAllowed(instance, body as Record<string, unknown>);
      const normalized = normalizePhylaxTranscriptionUpdate(tenantSettings, tenantId, body);
      const settings = tenantSettings.update(tenantId, normalized);
      runtime.retryPendingVoiceCaptures(tenantId);
      return c.json({ settings });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid settings" }, 400);
    }
  });
  app.post("/api/phylax/transcription/check", async (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    try {
      const body = parsePhylaxTranscriptionCheck(await c.req.json<unknown>());
      const current = tenantSettings.transcriptionConfig(tenantId);
      const provider = body.provider ?? current.provider;
      const configured = tenantSettings.transcriptionConfig(tenantId, provider);
      const model = body.model?.trim()
        || (provider === current.provider ? current.model : null)
        || defaultPhylaxTranscriptionModel(provider);
      const key = body.key === undefined || body.key === null ? configured.key : body.key.trim() || null;
      const configurationError = phylaxTranscriptionConfigurationError({ provider, model, key });
      if (configurationError) return c.json({ ok: false, provider, model, message: configurationError });
      const openRouterCatalog = provider === "openrouter"
        ? await openRouterTranscriptionModels()
        : undefined;
      return c.json(await probePhylaxTranscriptionProvider({
        provider,
        model,
        key,
        env,
        openRouterCatalog,
      }));
    } catch (error) {
      return c.json(
        { ok: false, message: error instanceof Error ? error.message : "could not check transcription provider" },
        400,
      );
    }
  });
  app.delete("/api/phylax/transcription/key", async (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    try {
      const body = parsePhylaxTranscriptionKeyRemoval(await c.req.json<unknown>());
      return c.json({
        settings: tenantSettings.clearTranscriptionKey(tenantId, body.provider),
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "could not remove provider key" },
        400,
      );
    }
  });
  app.post("/api/phylax/phone-registration", async (c) => {
    const tenantId = activeTenantId(c, customer, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req
      .json<{ phoneNumber?: string; numberId?: string }>()
      .catch((): { phoneNumber?: string; numberId?: string } => ({}));
    try {
      const registration = tenantSettings.registerPhone(tenantId, body.phoneNumber ?? "", body.numberId);
      return c.json({
        ...registration,
        phylaxNumber: runtime.whatsapp.status().linkedNumber,
        instruction: `WhatsApp ${registration.keyword} to ${runtime.whatsapp.status().linkedNumber ?? "the Phylax number"}`,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid phone number" }, 400);
    }
  });
  app.get("/artifacts/:tenantId/:file", async (c) => {
    const tenantId = c.req.param("tenantId");
    const file = c.req.param("file");
    if (
      !file
      || basename(file) !== file
      || file === "."
      || file === ".."
      || !verifyPhylaxArtifactCapability({
        secret: artifactCapabilitySecret,
        tenantId,
        file,
        expires: c.req.query("expires"),
        signature: c.req.query("signature"),
      })
    ) {
      return c.json({ error: "not found" }, 404);
    }
    const path = join(phylaxWhatsAppPaths(storage.dataDir).artifacts, tenantId, file);
    try {
      const bytes = await readFile(path);
      const extension = file.split(".").pop()?.toLowerCase();
      const contentType = extension === "ogg" ? "audio/ogg"
        : extension === "mp3" ? "audio/mpeg"
        : extension === "wav" ? "audio/wav"
        : extension === "png" ? "image/png"
        : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
        : extension === "webp" ? "image/webp"
        : extension === "gif" ? "image/gif"
        : "application/octet-stream";
      return c.body(bytes, 200, { "content-type": contentType, "cache-control": "private, no-store" });
    } catch {
      return c.json({ error: "not found" }, 404);
    }
  });

  const adminOnly: MiddlewareHandler<{ Bindings: HttpBindings }> = async (c, next) => {
    const session = readCustomerSession(c, env);
    if (!session || session.login.toLowerCase() !== PHYLAX_ADMIN_GITHUB_LOGIN.toLowerCase()) {
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
  mountPhylaxAdminChannelRoutes(app, runtime);
  if (options.webDist) {
    app.get("/admin", serveStatic({
      root: options.webDist,
      path: "index.html",
      onFound: (_path, c) => c.header("Cache-Control", "no-cache, no-store, must-revalidate"),
    }));
  }

  app.route("/", customer.app);
  // Product APIs are always resolved before SPA fallbacks. This makes the
  // absence of Zenod memory/Drive/application routes an observable 404.
  app.all("/api/*", (c) => forwardPhylaxUnitRequest(c, base, customer, tenantStore, env));
  mountStaticSurfaces(app, {
    webDist: options.webDist,
    siteDist: options.siteDist,
    publicSiteHost: "phylax.zenod.dev",
  });
  app.all("*", (c) => forwardPhylaxUnitRequest(c, base, customer, tenantStore, env));

  return {
    ...base,
    app,
    storage,
    tenantStore,
    customerAccounts: customer.accounts,
    customerTokenVault: customer.tokenVault,
    phylaxRuntime: runtime,
    phylaxTenantSettings: tenantSettings,
    phylaxInstance: instance,
    hostedChannelAudit,
    ringCaptureTickets: captureTickets,
    async close() {
      const failures: unknown[] = [];
      for (const result of await Promise.allSettled([
        runtime.close(),
        captureTickets.close(),
        Promise.resolve().then(() => customer.close()),
      ])) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      hostedChannelAudit.close();
      if ("close" in tenantStore && typeof tenantStore.close === "function") {
        try {
          tenantStore.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, "Phylax unit shutdown failed");
    },
  };
}

type PhylaxSettingsUpdate = Parameters<PhylaxTenantSettingsStore["update"]>[1];

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`${key} must be a string`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

export function parsePhylaxSettingsUpdate(value: unknown): PhylaxSettingsUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("settings body must be an object");
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "downstreamUrl",
    "downstreamToken",
    "assistantUrl",
    "assistantToken",
    "ringTicketUrl",
    "ringTicketToken",
    "transcriptionEnabled",
    "transcriptionProvider",
    "transcriptionModel",
    "transcriptionKey",
    "voiceDefault",
    "turnBindings",
    "telegramBinding",
    "telegramLegacyBinding",
    "notificationPrefs",
  ]);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unsupported setting: ${unknown}`);
  const provider = record.transcriptionProvider;
  if (
    provider !== undefined &&
    (typeof provider !== "string" || !["local", "groq", "openai", "openrouter"].includes(provider))
  ) throw new Error("invalid transcription provider");
  const voiceDefault = record.voiceDefault;
  if (
    voiceDefault !== undefined
    && (typeof voiceDefault !== "string" || !["capture", "assistant"].includes(voiceDefault))
  ) throw new Error("invalid voiceDefault");
  if (
    record.turnBindings !== undefined
    && (!record.turnBindings || typeof record.turnBindings !== "object" || Array.isArray(record.turnBindings))
  ) throw new Error("turnBindings must be an object");
  let notificationPrefs: { whatsapp?: boolean; telegram?: boolean } | undefined;
  if (record.notificationPrefs !== undefined) {
    if (!record.notificationPrefs || typeof record.notificationPrefs !== "object" || Array.isArray(record.notificationPrefs)) {
      throw new Error("notificationPrefs must be an object");
    }
    const prefs = record.notificationPrefs as Record<string, unknown>;
    const unknownPref = Object.keys(prefs).find((key) => key !== "whatsapp" && key !== "telegram");
    if (unknownPref) throw new Error(`unsupported notification preference: ${unknownPref}`);
    notificationPrefs = {
      ...(prefs.whatsapp !== undefined ? { whatsapp: optionalBoolean(prefs, "whatsapp") } : {}),
      ...(prefs.telegram !== undefined ? { telegram: optionalBoolean(prefs, "telegram") } : {}),
    };
  }
  return {
    ...(record.downstreamUrl !== undefined ? { downstreamUrl: optionalString(record, "downstreamUrl", 4_096) } : {}),
    ...(record.downstreamToken !== undefined ? { downstreamToken: optionalString(record, "downstreamToken", 8_192) } : {}),
    ...(record.assistantUrl !== undefined ? { assistantUrl: optionalString(record, "assistantUrl", 4_096) } : {}),
    ...(record.assistantToken !== undefined ? { assistantToken: optionalString(record, "assistantToken", 8_192) } : {}),
    ...(record.ringTicketUrl !== undefined ? { ringTicketUrl: optionalString(record, "ringTicketUrl", 4_096) } : {}),
    ...(record.ringTicketToken !== undefined ? { ringTicketToken: optionalString(record, "ringTicketToken", 8_192) } : {}),
    ...(record.transcriptionEnabled !== undefined
      ? { transcriptionEnabled: optionalBoolean(record, "transcriptionEnabled") }
      : {}),
    ...(provider !== undefined ? { transcriptionProvider: provider as PhylaxSettingsUpdate["transcriptionProvider"] } : {}),
    ...(record.transcriptionModel !== undefined
      ? { transcriptionModel: optionalString(record, "transcriptionModel", 256) }
      : {}),
    ...(record.transcriptionKey !== undefined
      ? { transcriptionKey: optionalString(record, "transcriptionKey", 8_192) }
      : {}),
    ...(voiceDefault !== undefined
      ? { voiceDefault: voiceDefault as PhylaxSettingsUpdate["voiceDefault"] }
      : {}),
    ...(record.turnBindings !== undefined
      ? { turnBindings: record.turnBindings as PhylaxSettingsUpdate["turnBindings"] }
      : {}),
    ...(record.telegramBinding !== undefined ? { telegramBinding: optionalString(record, "telegramBinding", 256) } : {}),
    ...(record.telegramLegacyBinding !== undefined
      ? { telegramLegacyBinding: optionalString(record, "telegramLegacyBinding", 256) }
      : {}),
    ...(notificationPrefs ? { notificationPrefs } : {}),
  };
}

export function parsePhylaxTranscriptionCheck(value: unknown): {
  provider?: "local" | "groq" | "openai" | "openrouter";
  model?: string | null;
  key?: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("check body must be an object");
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !["provider", "model", "key"].includes(key));
  if (unknown) throw new Error(`unsupported check field: ${unknown}`);
  const provider = record.provider;
  if (
    provider !== undefined &&
    (typeof provider !== "string" || !["local", "groq", "openai", "openrouter"].includes(provider))
  ) throw new Error("invalid transcription provider");
  return {
    ...(provider !== undefined ? { provider: provider as "local" | "groq" | "openai" | "openrouter" } : {}),
    ...(record.model !== undefined ? { model: optionalString(record, "model", 256) } : {}),
    ...(record.key !== undefined ? { key: optionalString(record, "key", 8_192) } : {}),
  };
}

export function parsePhylaxTranscriptionKeyRemoval(value: unknown): {
  provider: "groq" | "openai" | "openrouter";
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("key removal body must be an object");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => key !== "provider");
  if (unknown) throw new Error(`unsupported key removal field: ${unknown}`);
  if (!["groq", "openai", "openrouter"].includes(String(record.provider))) {
    throw new Error("invalid transcription provider");
  }
  return {
    provider: record.provider as "groq" | "openai" | "openrouter",
  };
}

export function defaultPhylaxTranscriptionModel(
  provider: "local" | "groq" | "openai" | "openrouter",
): string | null {
  if (provider === "local") return PHYLAX_DEFAULT_LOCAL_WHISPER_MODEL;
  if (provider === "groq") return GROQ_STT_MODEL;
  if (provider === "openai") return OPENAI_STT_MODEL;
  return DEFAULT_OPENROUTER_STT_MODEL;
}

export function normalizePhylaxTranscriptionUpdate(
  settings: PhylaxTenantSettingsStore,
  tenantId: string,
  input: PhylaxSettingsUpdate,
): PhylaxSettingsUpdate {
  const current = settings.transcriptionConfig(tenantId);
  const provider = input.transcriptionProvider ?? current.provider;
  const providerConfig = settings.transcriptionConfig(tenantId, provider);
  const providerChanged = provider !== current.provider;
  const model = input.transcriptionModel !== undefined
    ? input.transcriptionModel?.trim() || defaultPhylaxTranscriptionModel(provider)
    : providerChanged
      ? defaultPhylaxTranscriptionModel(provider)
      : current.model ?? defaultPhylaxTranscriptionModel(provider);
  const canonicalModel =
    provider === "groq" || provider === "openai"
      ? defaultPhylaxTranscriptionModel(provider)
      : model;
  const key = input.transcriptionKey !== undefined && input.transcriptionKey !== null
    ? input.transcriptionKey.trim() || null
    : providerConfig.key;
  const enabled = input.transcriptionEnabled ?? current.enabled;
  if (enabled) {
    const configurationError = phylaxTranscriptionConfigurationError({
      provider,
      model: canonicalModel,
      key,
    });
    if (configurationError) throw new Error(configurationError);
  }
  return {
    ...input,
    ...(providerChanged ||
    input.transcriptionModel !== undefined ||
    provider === "groq" ||
    provider === "openai"
      ? { transcriptionModel: canonicalModel }
      : {}),
  };
}

function createTenantOrgan(
  dataDir: string,
  tenantSettings: PhylaxTenantSettingsStore,
  captureTickets: RingCaptureTicketProducer,
  env: NodeJS.ProcessEnv,
  artifactCapabilitySecret: string,
  instance: PhylaxInstanceConfig,
): PhylaxChannelsOrgan {
  const configuredDeadline = Number(env.PHYLAX_TRANSCRIPTION_DEADLINE_MS ?? 60_000);
  const configuredVoiceJobDeadline = Number(
    env.PHYLAX_VOICE_JOB_DEADLINE_MS
      ?? 2 * 60 * 60_000,
  );
  return new PhylaxChannelsOrgan({
    dataDir,
    transcriptionDeadlineMs: configuredDeadline,
    voiceJobDeadlineMs: configuredVoiceJobDeadline,
    routes: {
      resolve: (channel, sender) => resolvePhylaxRuntimeRoute(
        instance,
        tenantSettings,
        channel,
        sender,
      ),
      reportDownstreamCredentialStatus: (tenantId, credentialRevision, status) =>
        tenantSettings.reportDownstreamCredentialStatus(tenantId, credentialRevision, status),
    },
    async callDownstream(call) {
      const result = await callPeerTool(
        {
          name: `phylax-memory-${call.route.tenantId}`,
          url: call.route.downstreamUrl,
          token: call.route.downstreamToken,
          wallet: false,
        },
        call.tool,
        call.arguments,
      );
      if (isCaptureMemoryTool(call.tool) && !result.isError) {
        const structured = result.structuredContent;
        if (structured && typeof structured === "object" && !Array.isArray(structured)) {
          const candidate = structured as Record<string, unknown>;
          const jobId = candidate.ticket_id ?? candidate.jobId;
          if (typeof jobId === "string" && jobId.trim()) {
            captureTickets.bindMemoryJob({
              tenantId: call.route.tenantId,
              jobId: jobId.trim(),
              memoryAuthorityId: captureMemoryAuthorityId({
                url: call.route.downstreamUrl,
                token: call.route.downstreamToken,
              }),
              captureTool: call.tool,
            });
          }
        }
      }
      return result;
    },
    transcriber: {
      async transcribe(input) {
        const transcription = tenantSettings.transcriptionConfig(input.tenantId);
        if (!transcription.enabled) {
          return { transcription_failed: { code: "disabled", message: "tenant transcription is disabled" } };
        }
        const configurationError = phylaxTranscriptionConfigurationError(transcription);
        if (configurationError) {
          return {
            transcription_failed: {
              code: "not_configured",
              message: configurationError,
            },
          };
        }
        const result = await transcribeAudio(
          Buffer.from(input.bytes),
          input.fileName ?? "voice.ogg",
          phylaxTranscriptionOptions(transcription, env, input.signal),
        );
        if (!result.success || !result.transcript?.trim()) {
          return {
            ...(result.provider ? { transcription_source: result.provider } : {}),
            ...(result.timing ? { transcription_timing: result.timing } : {}),
            transcription_failed: {
              code: input.signal.aborted ? "timeout" : result.noSpeech ? "no_speech" : "unavailable",
              message: result.error ?? "transcription failed",
            },
          };
        }
        return {
          text_transcript: result.transcript.trim(),
          ...(result.provider ? { transcription_source: result.provider } : {}),
          ...(result.timing ? { transcription_timing: result.timing } : {}),
        };
      },
    },
    artifactUrl(tenantId, artifactId) {
      return createPhylaxArtifactCapabilityUrl({
        baseUrl: env.CUSTOMER_APP_URL || "https://phylax.zenod.dev",
        secret: artifactCapabilitySecret,
        tenantId,
        file: artifactId,
        expiresAt: Date.now() + 24 * 60 * 60 * 1_000,
      });
    },
  });
}

/**
 * Data-plane adapter authority for one deployment island.
 *
 * Persisted destinations/credentials remain tenant-specific for rolling
 * compatibility. Product-bound modes never inherit persisted tool bindings:
 * Zenod uses its frozen adapter and PM fails closed until #1111 defines one.
 */
export function resolvePhylaxRuntimeRoute(
  instance: PhylaxInstanceConfig,
  tenantSettings: PhylaxTenantSettingsStore,
  channel: "whatsapp" | "telegram",
  sender: string,
) {
  const route = tenantSettings.resolve(channel, sender);
  if (!route) return null;
  if (instance.mode === "pm") return null;
  return {
    ...route,
    turnBindings: instance.mode === "zenod"
      ? defaultPhylaxTurnBindings()
      : effectivePhylaxTurnBindings(tenantSettings.get(route.tenantId)),
  };
}
export function phylaxTranscriptionConfigurationError(transcription: {
  provider: "local" | "groq" | "openai" | "openrouter";
  model?: string | null;
  key: string | null;
}): string | null {
  if (transcription.provider !== "local" && !transcription.key) {
    return `${transcription.provider} transcription requires a tenant-configured provider key`;
  }
  if (transcription.provider === "local" && transcription.model?.trim() && !isValidWhisperModel(transcription.model.trim())) {
    return `unsupported local transcription model: ${transcription.model.trim()}`;
  }
  return null;
}

export function phylaxTranscriptionOptions(
  transcription: {
    provider: "local" | "groq" | "openai" | "openrouter";
    model: string | null;
    key: string | null;
  },
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Exclude<TranscribeOptions, (percent: number) => void> {
  const requestedLocalModel = transcription.provider === "local" ? transcription.model?.trim() : null;
  const configuredLocalModel = env.PHYLAX_LOCAL_WHISPER_MODEL?.trim();
  const localModel = requestedLocalModel && isValidWhisperModel(requestedLocalModel)
    ? requestedLocalModel
    : configuredLocalModel && isValidWhisperModel(configuredLocalModel)
      ? configuredLocalModel
      : PHYLAX_DEFAULT_LOCAL_WHISPER_MODEL;
  const key = transcription.key ?? "";
  return {
    model: localModel,
    groqApiKey: transcription.provider === "groq" ? key : "",
    openaiApiKey: transcription.provider === "openai" ? key : "",
    openrouterApiKey: transcription.provider === "openrouter" ? key : "",
    ...(transcription.provider === "groq" ? { longTranscriptionProvider: "groq" as const } : {}),
    ...(transcription.provider === "openai" ? { longTranscriptionProvider: "openai" as const } : {}),
    ...(transcription.provider === "openrouter"
      ? { openrouterModel: transcription.model ?? undefined, longTranscriptionProvider: "openrouter" as const }
      : {}),
    allowLocalFallback: transcription.provider === "local",
    signal,
    includeTiming: true,
  };
}

function activeTenantId(
  c: AppContext,
  customer: ReturnType<typeof createPhylaxCustomerLayer>,
  env: NodeJS.ProcessEnv,
): string | null {
  const session = readCustomerSession(c, env);
  if (!session) return null;
  return customer.accounts.resolveActiveTenantForUser(session.github_id)?.tenant_id ?? null;
}

async function forwardPhylaxUnitRequest(
  c: AppContext,
  unit: ReturnType<typeof createUnit>,
  customer: ReturnType<typeof createPhylaxCustomerLayer>,
  tenantStore: TenantProvisioningStore,
  env: NodeJS.ProcessEnv,
): Promise<Response> {
  const session = readCustomerSession(c, env);
  if (!session) return unit.app.fetch(c.req.raw, c.env);
  if (
    c.req.path === "/mcp"
    || c.req.path.startsWith("/mcp/")
    || c.req.path === "/internal"
    || c.req.path.startsWith("/internal/")
    || c.req.path === "/api/tenants"
    || c.req.path.startsWith("/api/tenants/")
  ) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!c.req.path.startsWith("/api/")) {
    return unit.app.fetch(c.req.raw, c.env);
  }
  const account = customer.accounts.resolveActiveTenantForUser(session.github_id);
  const token = account ? customer.tokenVault.get(account.account_id) : null;
  const record = token ? await tenantStore.resolveTokenHash(hashToken(token)) : null;
  if (
    !account?.tenant_id
    || !token
    || !record
    || record.tenant.id !== account.tenant_id
    || (record.status ?? "active") !== "active"
  ) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const headers = new Headers(c.req.raw.headers);
  headers.delete("cookie");
  headers.set("authorization", `Bearer ${token}`);
  return unit.app.fetch(new Request(c.req.raw, { headers }), c.env);
}

function registerTenantChannelTools(
  server: McpServer,
  context: UnitContext,
  runtime: PhylaxPortedRuntime,
  settings: PhylaxTenantSettingsStore,
): void {
  const tenantId = context.tenant?.id;
  if (!tenantId) throw new Error("Phylax channel tools require a tenant");
  const delivery = runtime.delivery();
  const send = async (channel: PhylaxPortedChannel, recipient: string, text: string) => {
    if (!settings.ownsRecipient(tenantId, channel, recipient)) {
      throw new PhylaxChannelError("delivery_error", "That recipient is not connected to this Zenod account.");
    }
    return delivery.send(channel, recipient, text);
  };
  registerPhylaxChannelTools(server, {
    send,
    async notify(text) {
      const tenant = settings.get(tenantId);
      const requests: Array<Promise<Awaited<ReturnType<typeof send>>>> = [];
      if (tenant.notificationPrefs.whatsapp && tenant.verified && tenant.phoneNumber) {
        requests.push(send("whatsapp", tenant.phoneNumber, text));
      }
      if (tenant.notificationPrefs.telegram && tenant.telegramBinding) {
        requests.push(send("telegram", tenant.telegramBinding, text));
      }
      return Promise.all(requests);
    },
    status() {
      return {
        settings: settings.view(tenantId),
        providers: delivery.status(),
      };
    },
    readConversationTranscript(query) {
      return runtime.whatsappStore.recentTranscript({ ...query, tenantId });
    },
  });
}
