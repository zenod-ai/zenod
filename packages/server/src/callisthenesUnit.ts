import type { HttpBindings } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { ChassisStorage, createSqliteTenantStore, hashToken, type TenantProvisioningStore } from "@zenod/mcp-chassis";
import { createCallisthenesCustomerLayer, type CallisthenesCustomerLayerOptions } from "./callisthenesCustomerLayer.js";
import { mountStaticSurfaces } from "./staticSurfaces.js";
import { resolvedGitSha } from "./app.js";

export interface CreateCallisthenesUnitOptions {
  dataDir?: string;
  webDist?: string;
  siteDist?: string;
  tenantStore?: TenantProvisioningStore;
  customer?: CallisthenesCustomerLayerOptions;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
}

export function createCallisthenesUnit(options: CreateCallisthenesUnitOptions = {}) {
  const env = options.env ?? process.env;
  const storage = new ChassisStorage({
    dataDir: options.dataDir,
    vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY,
  });
  const tenantStore = options.tenantStore ?? createSqliteTenantStore({ dataDir: storage.dataDir, busyTimeoutMs: 30_000 });
  const engineUrl = (options.customer?.engineUrl || env.CALLISTHENES_ENGINE_URL || "http://calli-engine:8000").replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const customer = createCallisthenesCustomerLayer(
    { dataDir: storage.dataDir },
    { ...options.customer, env, tenantStore, engineUrl },
  );
  const app = new Hono<{ Bindings: HttpBindings }>();

  async function forwardMcp(c: Context<{ Bindings: HttpBindings }>): Promise<Response> {
    const authorization = c.req.header("authorization") ?? "";
    const [scheme, headerToken = ""] = authorization.split(/\s+/, 2);
    const bearer = scheme?.toLowerCase() === "bearer" ? headerToken.trim() : "";
    const pathToken = c.req.path.startsWith("/mcp/")
      ? decodeURIComponent(c.req.path.slice("/mcp/".length).split("/")[0] ?? "")
      : "";
    if (bearer && pathToken && bearer !== pathToken) {
      return c.json({ error: "conflicting tenant credentials" }, 401);
    }
    const token = bearer || pathToken;
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const record = await tenantStore.resolveTokenHash(hashToken(token));
    if (!record || (record.status ?? "active") !== "active") return c.json({ error: "unauthorized" }, 401);

    const headers = new Headers(c.req.raw.headers);
    headers.delete("cookie");
    headers.set("authorization", `Bearer ${token}`);
    const target = new URL(`${engineUrl}/mcp`);
    target.search = new URL(c.req.url).search;
    const response = await fetcher(target, {
      method: c.req.method,
      headers,
      ...(c.req.method === "GET" || c.req.method === "HEAD" ? {} : { body: c.req.raw.body, duplex: "half" }),
    } as RequestInit);
    return new Response(response.body, { status: response.status, headers: response.headers });
  }

  app.get("/healthz", (c) => c.json({ status: "ok", name: "callisthenes", sha: resolvedGitSha() }));
  app.get("/api/health", (c) => c.json({ status: "ok", name: "callisthenes", sha: resolvedGitSha() }));
  app.route("/", customer.app);

  app.all("/mcp", forwardMcp);
  app.all("/mcp/*", forwardMcp);

  mountStaticSurfaces(app, {
    webDist: options.webDist,
    siteDist: options.siteDist,
    publicSiteHost: "calli.zenod.dev",
  });

  return {
    app,
    storage,
    tenantStore,
    customerAccounts: customer.accounts,
    customerTokenVault: customer.tokenVault,
    close() {
      if ("close" in tenantStore && typeof tenantStore.close === "function") tenantStore.close();
    },
  };
}
