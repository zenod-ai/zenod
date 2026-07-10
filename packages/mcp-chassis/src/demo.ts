import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { z } from "zod";
import {
  createMemoryTenantStore,
  createUnit,
  type UnitContext,
} from "./index.js";

export const DEMO_CONTROL_TOKEN = "demo-control-token";

function requireTenantContext(
  context: UnitContext,
): asserts context is UnitContext & {
  tenant: NonNullable<UnitContext["tenant"]>;
  storage: NonNullable<UnitContext["storage"]>;
} {
  if (!context.tenant || !context.storage) {
    throw new Error("demo marker tools require an authenticated tenant");
  }
}

function registerDemoTools(
  server: Parameters<NonNullable<Parameters<typeof createUnit>[0]["tools"]>>[0],
  context: UnitContext,
): void {
  server.registerTool(
    "set_tenant_marker",
    {
      title: "Set tenant marker",
      description:
        "Store a marker in the authenticated tenant's isolated vault.",
      inputSchema: { marker: z.string().trim().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ marker }) => {
      requireTenantContext(context);
      const vault = context.storage.vault("demo.sqlite");
      try {
        vault.set("marker", marker);
      } finally {
        vault.close();
      }
      context.usage?.record({ kind: "demo.marker.write" });
      return {
        content: [
          { type: "text", text: `Stored marker for ${context.tenant.id}` },
        ],
        structuredContent: {
          tenant: context.tenant,
          marker,
          evidence: [
            { kind: "tenant_marker", id: `${context.tenant.id}:marker` },
          ],
        },
      };
    },
  );

  server.registerTool(
    "get_tenant_marker",
    {
      title: "Get tenant marker",
      description: "Read only the authenticated tenant's isolated marker.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      requireTenantContext(context);
      const vault = context.storage.vault("demo.sqlite");
      let marker: string | null;
      try {
        marker = vault.get("marker");
      } finally {
        vault.close();
      }
      return {
        content: [{ type: "text", text: marker ?? "No marker stored" }],
        structuredContent: { tenant: context.tenant, marker },
      };
    },
  );
}

export function createDemoUnit(env: NodeJS.ProcessEnv = process.env) {
  const tenants = createMemoryTenantStore();
  const dataDir = resolve(env.DATA_DIR?.trim() || ".data/mcp-chassis-demo");
  const webDist = env.ZENOD_WEB_DIST?.trim()
    ? resolve(env.ZENOD_WEB_DIST)
    : resolve(import.meta.dirname, "../../../apps/web/dist");
  const unit = createUnit({
    name: "mcp-chassis-demo",
    version: "3.1.0",
    conduct: {
      toolKinds: {
        read: ["get_tenant_marker"],
        mutate: ["set_tenant_marker"],
      },
    },
    tenantAuth: { store: tenants },
    controlPlane: {
      store: tenants,
      token: env.CONTROL_PLANE_TOKEN?.trim() || DEMO_CONTROL_TOKEN,
      env,
    },
    singleTenant: {
      store: tenants,
      tokenEnvVar: "DEMO_API_TOKEN",
      env,
      tenant: {
        id: env.DEMO_TENANT_ID?.trim() || "self-host",
        name: env.DEMO_TENANT_NAME?.trim() || "Self-hosted Demo",
        plan: "self-hosted",
      },
    },
    storage: {
      dataDir,
      ...(env.CHASSIS_VAULT_MASTER_KEY?.trim()
        ? { vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY }
        : {}),
    },
    metering: { dataDir },
    ui: {
      webDist,
      displayName: "MCP Chassis Demo",
      tagline: "Tenant isolation proof",
      panels: ["rules", "mcp", "skills", "keys", "connections"],
      sessionSecret:
        env.DEMO_SESSION_SECRET?.trim() || "local-demo-session-secret",
    },
    skill: {
      id: "mcp-chassis-demo",
      name: "MCP Chassis Demo",
      version: "3.1.0",
      purpose: "Prove tenant-isolated MCP chassis behavior.",
      whenToRoute: [
        "Use for tenant marker isolation and chassis integration checks.",
      ],
      tools: ["set_tenant_marker", "get_tenant_marker"],
      etiquette: [
        "Resolve tenant identity only from the authenticated request.",
      ],
      receiptExpectations: ["mutations return evidence[]"],
    },
    tools: registerDemoTools,
  });
  return { ...unit, tenants, dataDir };
}

export function startDemo(env: NodeJS.ProcessEnv = process.env): ServerType {
  const port = Number.parseInt(env.PORT ?? "8080", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  const unit = createDemoUnit(env);
  return serve(
    { fetch: unit.app.fetch, hostname: "127.0.0.1", port },
    (address) => {
      console.log(
        `MCP chassis demo listening on http://127.0.0.1:${address.port}`,
      );
    },
  );
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) startDemo();
