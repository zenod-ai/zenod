import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryIndex, type BrainEngine } from "zenod";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { Runtime } from "../src/runtime.js";

// EPIC-12 E12-S2: the console memory graph. Each tenant sees its own graph only, from its own
// tier-0 index; the route needs a session and never runs a model.
const page = (title: string, body: string, parent?: string) =>
  `---\ntitle: ${title}\ntype: note\n${parent ? `parent: "${parent}"\n` : ""}---\n\n# ${title}\n\n${body}\n`;

describe("console memory graph route (E12-S2)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-console-graph-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });

  async function setup() {
    const runtimes = new Map<string, Runtime>();
    const indexes: MemoryIndex[] = [];
    const vaults: Record<string, Record<string, string>> = {
      "tenant-a": {
        "Tree.md": "## Working memory\n\n- Garden | working | [[Areas/Garden]] | The garden and the shed.\n",
        "Areas/Garden.md": page("Garden", "A level-1 node in the [[Tree]]. Boards for the [[Shed]].", "[[Tree]]"),
        "Notes/Shed.md": page("Shed", "Cedar shed, see [[Garden]].", "[[Areas/Garden]]"),
      },
      "tenant-b": {
        "Notes/Boat.md": page("Boat", "Porto yard, see [[Engine]]."),
        "Notes/Engine.md": page("Engine", "Four thousand euros."),
      },
    };
    for (const [tenant, files] of Object.entries(vaults)) {
      const vault = join(dir, tenant, "vault");
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(vault, path)), { recursive: true });
        await writeFile(join(vault, path), content);
      }
      const index = MemoryIndex.open({ path: join(dir, tenant, "memory-index.sqlite"), vaultPath: vault, tenantId: tenant });
      indexes.push(index);
      const engine = {
        memoryGraph: vi.fn(async (request: { center?: string | null; limit?: number } = {}) => {
          const view = await index.graph(request);
          if (!view) throw Object.assign(new Error("note not found"), { name: "NoteNotFoundError" });
          return view;
        }),
        ask: vi.fn(),
      } as unknown as BrainEngine;
      const runtime = new Runtime(join(dir, tenant), undefined, { tenantId: tenant, seedFromEnv: false });
      vi.spyOn(runtime, "getEngine").mockImplementation(async () => engine);
      runtimes.set(tenant, runtime);
    }
    const tenants = createSqliteTenantStore({ dataDir: dir });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test", CUSTOMER_APP_URL: "https://cloud.zenod.dev", ACCOUNT_STATE_SECRET: "test-state-secret",
      STRIPE_SECRET_KEY: "sk_test_not-used", STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_MODE: "test", PRICE_MONTHLY: "price_monthly", PRICE_YEARLY: "price_yearly",
    };
    const layer = createCustomerLayer(
      { dataDir: dir, runtimeForAccount: (account: CustomerAccount) => (account.tenant_id ? runtimes.get(account.tenant_id) ?? null : null) },
      { env, stripe: {} as CustomerStripeClient, tenantStore: tenants },
    );
    const principal = (subject: string): CustomerPrincipal => ({
      user_id: customerUserId("google", subject), provider: "google", provider_subject: subject, display_name: subject,
      avatar_url: null, email: `${subject}@example.test`, email_verified: true, github_id: null, github_login: null,
    });
    const cookieFor = async (user: CustomerPrincipal) => {
      const issuer = new Hono();
      issuer.get("/", (c) => { issueCustomerSession(c, user, env); return c.text("ok"); });
      return (await issuer.request("/")).headers.get("set-cookie")!;
    };
    const ada = principal("ada");
    const bob = principal("bob");
    layer.accounts.upsert("cs_ada", { account_id: "user-ada", user_id: ada.user_id, tier: "monthly", tenant_id: "tenant-a", subscription_status: "active" });
    layer.accounts.upsert("cs_bob", { account_id: "user-bob", user_id: bob.user_id, tier: "monthly", tenant_id: "tenant-b", subscription_status: "active" });
    const get = async (path: string, user?: CustomerPrincipal) =>
      layer.app.request(path, { headers: user ? { cookie: await cookieFor(user) } : {} });
    const close = async () => {
      for (const index of indexes) index.close();
      tenants.close();
      for (const runtime of runtimes.values()) await runtime.close();
    };
    return { ada, bob, eve: principal("eve"), get, close };
  }

  it("needs a session and an account, and serves each tenant only its own graph", async () => {
    const t = await setup();
    try {
      expect((await t.get("/api/console/memory-graph")).status).toBe(401);
      expect((await t.get("/api/console/memory-graph", t.eve)).status).toBe(404);

      const overview = await (await t.get("/api/console/memory-graph", t.ada)).json();
      expect(overview).toMatchObject({ status: "ready", center: "Tree.md", total: { nodes: 3 } });
      expect(overview.nodes.map((node: { title: string }) => node.title)).toEqual(expect.arrayContaining(["Your memory", "Garden", "Shed"]));
      expect(JSON.stringify(overview)).not.toMatch(/Boat|Engine/);

      const shed = await (await t.get(`/api/console/memory-graph?path=${encodeURIComponent("Notes/Shed.md")}`, t.ada)).json();
      expect(shed.center).toBe("Notes/Shed.md");
      expect(shed.nodes.find((node: { path: string }) => node.path === "Areas/Garden.md")).toMatchObject({ relation: "parent" });
      expect(shed.edges).toContainEqual({ from: "Areas/Garden.md", to: "Notes/Shed.md", kind: "tree" });

      const boat = await (await t.get("/api/console/memory-graph?path=Boat", t.bob)).json();
      expect(boat.edges).toEqual([{ from: "Notes/Boat.md", to: "Notes/Engine.md", kind: "link" }]);
      expect(JSON.stringify(boat)).not.toMatch(/Garden|Shed/);
      // Another tenant's page is simply not in your graph.
      expect((await t.get("/api/console/memory-graph?path=Garden", t.bob)).status).toBe(404);
      expect((await t.get(`/api/console/memory-graph?path=${"x".repeat(600)}`, t.ada)).status).toBe(400);
    } finally {
      await t.close();
    }
  });
});
