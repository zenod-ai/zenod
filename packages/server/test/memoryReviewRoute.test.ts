import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { Runtime } from "../src/runtime.js";

// EPIC-12 E12-S27: the person's filings to check, and Right place / Wrong place / Undo on their own
// tree. Each route needs a session and reaches only the signed-in tenant's engine; refusals read plainly.
describe("console memory review routes (E12-S27)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-console-review-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });

  async function setup() {
    const runtimes = new Map<string, Runtime>();
    const engines = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
    for (const tenant of ["tenant-a", "tenant-b"]) {
      const revision = { provider: "github", id: `rev-${tenant}`, committedAt: "2026-11-09T06:00:00Z", urls: [] };
      const engine = {
        placementReview: vi.fn(async () => ({ items: [{ path: `Notes/${tenant}.md`, title: tenant, place: "Working › X", confidence: 23, provisional: true, evidenceRef: null, date: null }],
          total: 1, scored: 1, low: 1, checked: { confirmed: 0, moved: 0 }, recent: [] })),
        correctPlacement: vi.fn(async (input: { page: string; to?: string | null }) => {
          if (input.page === "Notes/Loop.md") throw Object.assign(new Error('"Loop" cannot go under itself'), { name: "DeskChangeError" });
          return { id: "c-123456abcdef", action: input.to ? "move" : "confirm", page: input.page, title: "Seed potatoes", before: "Long-term › Boat", after: "Working › Garden › Seed potatoes", revision };
        }),
        undoPlacementCorrection: vi.fn(async (input: { id: string }) => ({ id: "c-999999abcdef", action: "undo", page: "Notes/Seed potatoes.md", title: "Seed potatoes", before: "Garden", after: "Long-term › Boat", revision, undid: input.id })),
        memoryTreeOutline: vi.fn(async () => null),
      };
      engines.set(tenant, engine);
      const runtime = new Runtime(join(dir, tenant), undefined, { tenantId: tenant, seedFromEnv: false });
      vi.spyOn(runtime, "getEngine").mockImplementation(async () => engine as unknown as BrainEngine);
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
    const call = async (method: "GET" | "POST", path: string, user?: CustomerPrincipal, body?: unknown) =>
      layer.app.request(path, { method, headers: { ...(user ? { cookie: await cookieFor(user) } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const close = async () => {
      tenants.close();
      for (const runtime of runtimes.values()) await runtime.close();
    };
    return { ada, bob, eve: principal("eve"), call, engines, close };
  }

  it("needs a session and an account, and reaches only the signed-in tenant's memory", async () => {
    const t = await setup();
    try {
      expect((await t.call("GET", "/api/console/memory-review")).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-place", undefined, { page: "Notes/A.md" })).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-place/undo", undefined, { id: "c-123456abcdef" })).status).toBe(401);
      expect((await t.call("GET", "/api/console/memory-review", t.eve)).status).toBe(404);

      const review = await (await t.call("GET", "/api/console/memory-review", t.ada)).json();
      expect(review).toMatchObject({ status: "ready", total: 1, low: 1, items: [{ title: "tenant-a", confidence: 23 }] });
      expect(JSON.stringify(review)).not.toContain("tenant-b");

      const moved = await t.call("POST", "/api/console/memory-place", t.bob, { page: "Notes/Seed potatoes.md", to: "Projects/Garden.md" });
      expect(moved.status).toBe(200);
      expect(await moved.json()).toEqual({ id: "c-123456abcdef", action: "move", page: "Notes/Seed potatoes.md", title: "Seed potatoes", before: "Long-term › Boat", after: "Working › Garden › Seed potatoes", revision: "rev-tenant-b" });
      expect(t.engines.get("tenant-b")!.correctPlacement).toHaveBeenCalledWith({ page: "Notes/Seed potatoes.md", to: "Projects/Garden.md" });
      expect(t.engines.get("tenant-a")!.correctPlacement).not.toHaveBeenCalled();

      const confirmed = await (await t.call("POST", "/api/console/memory-place", t.ada, { page: "Notes/A.md" })).json();
      expect(confirmed.action).toBe("confirm");
      expect(t.engines.get("tenant-a")!.correctPlacement).toHaveBeenCalledWith({ page: "Notes/A.md", to: null });

      const undone = await (await t.call("POST", "/api/console/memory-place/undo", t.bob, { id: "c-123456abcdef" })).json();
      expect(undone).toMatchObject({ action: "undo", revision: "rev-tenant-b" });
    } finally {
      await t.close();
    }
  });

  it("turns a refused change into a plain message, and checks its input", async () => {
    const t = await setup();
    try {
      const refused = await t.call("POST", "/api/console/memory-place", t.ada, { page: "Notes/Loop.md", to: "Notes/Below.md" });
      expect(refused.status).toBe(422);
      expect(await refused.json()).toEqual({ error: "not_changed", message: '"Loop" cannot go under itself' });
      expect((await t.call("POST", "/api/console/memory-place", t.ada, {})).status).toBe(400);
      expect((await t.call("POST", "/api/console/memory-place", t.ada, { page: "x".repeat(600) })).status).toBe(400);
      expect((await t.call("POST", "/api/console/memory-place/undo", t.ada, { id: "../../etc" })).status).toBe(400);
    } finally {
      await t.close();
    }
  });
});
