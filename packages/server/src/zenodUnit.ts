import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HttpBindings } from "@hono/node-server";
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
import type { ChatTestAuditStore, ChatTurnInterceptor } from "./testHarness.js";
import { createCustomerLayer, type CustomerLayerOptions } from "./customerLayer.js";
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
      settingFallbacks: sharedGithubSettingFallbacks(this.sharedGithubApp),
    });
    runtime.settings.set("artifact_archive_provider", "local");
    runtime.settings.set(
      "artifact_archive_local_dir",
      tenantStorage.dir("media"),
    );
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
    },
    (input) => editGithubIssue(settings, input),
    (input) => createGithubIssue(settings, input),
    agent.name,
    undefined,
    undefined,
    undefined,
    (input) => runtime.whatsappStore.recentTranscript(input),
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
  "get_recent_conversation_transcript",
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
  const runtimes = new ZenodRuntimePool(env, sharedGithubApp, agent, options.appOptionsForTenant);
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
      "memory-channel": MEMORY_CHANNEL_MCP_TOOLS,
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
      runtimeForAccount: (account) => (account.tenant_id ? runtimes.get(account.tenant_id) : null),
      sharedGithubApp,
    },
    {
      ...options.customer,
      env,
      tenantStore,
      product: options.customerProduct ?? options.customer?.product,
    },
  );
  const app = new Hono<{ Bindings: HttpBindings }>();
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
      return unit.app.fetch(new Request(c.req.raw, { headers }), c.env);
    }
    return unit.app.fetch(c.req.raw, c.env);
  });
  return {
    ...unit,
    app,
    runtimes,
    storage,
    tenantStore,
    customerAccounts: customer.accounts,
    customerTokenVault: customer.tokenVault,
    async close() {
      const failures: unknown[] = [];
      for (
        const result of await Promise.allSettled([
          Promise.resolve().then(() => options.customerAdmin?.close?.()),
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
