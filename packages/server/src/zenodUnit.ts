import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import {
  ChassisStorage,
  createSqliteTenantStore,
  createUnit,
  hashToken,
  type ControlPlaneOptions,
  type TenantProvisioningStore,
  type UnitContext,
} from "@zenod/mcp-chassis";
import {
  VERSION,
  createGithubIssue,
  editGithubIssue,
} from "zenod";
import { ZENOD_AGENT } from "./agent.js";
import { createApp } from "./app.js";
import { ChassisCredentialVault } from "./credentialVault.js";
import { buildDriveTools } from "./driveTools.js";
import { driveClientFromSettings } from "./drive.js";
import { buildMcpServer } from "./mcp.js";
import { Runtime } from "./runtime.js";
import type { ChatTestAuditStore } from "./testHarness.js";
import { createCustomerLayer, type CustomerLayerOptions } from "./customerLayer.js";
import { readCustomerSession } from "./customerSession.js";
import { mountStaticSurfaces } from "./staticSurfaces.js";

export class ZenodRuntimePool {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly apps = new Map<string, ReturnType<typeof createApp>>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  forContext(context: UnitContext): Runtime {
    if (!context.tenant || !context.storage) {
      throw new Error("Zenod requires an authenticated chassis tenant context");
    }
    const tenantId = context.tenant.id;
    const existing = this.runtimes.get(tenantId);
    if (existing) {
      if (existing.dataDir !== context.storage.rootDir) {
        throw new Error("chassis tenant storage root changed during process lifetime");
      }
      return existing;
    }
    const runtime = new Runtime(context.storage.rootDir, ZENOD_AGENT, {
      seedFromEnv: false,
      tenantId,
      credentialVault: new ChassisCredentialVault(context.storage, {
        legacyMasterKey: this.env.ZENOD_CREDENTIAL_MASTER_KEY,
      }),
    });
    runtime.settings.set("artifact_archive_provider", "local");
    runtime.settings.set(
      "artifact_archive_local_dir",
      context.storage.dir("media"),
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
    const app = createApp(this.forContext(context), {
      agent: ZENOD_AGENT,
      trustedChassisAuth: true,
    });
    this.apps.set(context.tenant.id, app);
    return app;
  }

  close(): void {
    for (const runtime of this.runtimes.values()) runtime.close();
    this.apps.clear();
    this.runtimes.clear();
  }
}

function registerZenodTools(
  server: McpServer,
  runtime: Runtime,
): void {
  const { settings } = runtime;
  const chatTestAudit = runtime.state as unknown as ChatTestAuditStore;
  buildMcpServer(
    () => runtime.getEngine(),
    () => buildDriveTools(settings, runtime.ingestQueue),
    () => runtime.cleanSlate(),
    (input) => chatTestAudit.recordChatTestRun(input),
    {
      enqueue: (kind, input) => runtime.taskJobQueue.enqueue(kind, input),
      get: (id) => runtime.taskJobQueue.get(id),
    },
    (input) => editGithubIssue(settings, input),
    (input) => createGithubIssue(settings, input),
    ZENOD_AGENT.name,
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
  );
}

export interface CreateZenodUnitOptions {
  dataDir?: string;
  webDist?: string;
  siteDist?: string;
  tenantStore?: TenantProvisioningStore;
  controlPlane?: Omit<ControlPlaneOptions, "store">;
  customer?: CustomerLayerOptions;
  env?: NodeJS.ProcessEnv;
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

export function createZenodUnit(options: CreateZenodUnitOptions) {
  const env = options.env ?? process.env;
  const storage = new ChassisStorage({
    dataDir: options.dataDir,
    vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY,
  });
  const tenantStore =
    options.tenantStore ??
    createSqliteTenantStore({
      dataDir: storage.dataDir,
      busyTimeoutMs: 30_000,
    });
  const runtimes = new ZenodRuntimePool(env);
  const unit = createUnit({
    name: "zenod",
    version: VERSION,
    conduct: { toolKinds: { read: ZENOD_READ_TOOLS } },
    tenantAuth: { store: tenantStore },
    controlPlane: {
      ...options.controlPlane,
      store: tenantStore,
      env,
    },
    singleTenant: {
      store: tenantStore,
      tokenEnvVar: "ZENOD_API_TOKEN",
      env,
      tenant: {
        id: env.ZENOD_TENANT_ID?.trim() || "self-host",
        name: env.ZENOD_TENANT_NAME?.trim() || "Self-hosted Zenod",
        plan: "self-hosted",
      },
    },
    storage,
    metering: { dataDir: storage.dataDir },
    ui: {
      ...(options.webDist ? { webDist: options.webDist } : {}),
      displayName: ZENOD_AGENT.displayName,
      tagline: ZENOD_AGENT.tagline,
      panels: [
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
      registerZenodTools(server, runtimes.forContext(context));
    },
    routes(routes) {
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
    },
    { ...options.customer, env, tenantStore },
  );
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.route("/", customer.app);
  mountStaticSurfaces(app, { webDist: options.webDist, siteDist: options.siteDist });
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
    close() {
      runtimes.close();
      if ("close" in tenantStore && typeof tenantStore.close === "function") {
        tenantStore.close();
      }
    },
  };
}
