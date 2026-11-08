import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine, Hit } from "zenod";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { memoryAppPath, rankHits, rankMemories } from "../src/rankedMemory.js";
import { Runtime } from "../src/runtime.js";

// EPIC-12 E12-S3a: ranked retrieval, the top memories with a match percentage and links.
const hit = (path: string, score: number, extra: Partial<Hit> = {}): Hit => ({
  path, snippet: `about ${path}`, score, url: `https://github.com/o/r/blob/main/${encodeURI(path)}`, provider: "github", ...extra,
});

const engineWith = (hits: Hit[], timed = true) => ({
  search: async () => hits,
  ...(timed ? { searchTimed: async () => ({ hits, tier: "index" as const, ms: 3 }) } : {}),
}) as unknown as BrainEngine;

describe("ranked memory (E12-S3a)", () => {
  it("builds the in-app path from the vault path, encoded", () => {
    expect(memoryAppPath("Projects/Boat repair/2023 Porto quotes.md")).toBe("/#memory?path=Projects%2FBoat%20repair%2F2023%20Porto%20quotes.md");
    expect(memoryAppPath("Log/2026-10-31.md#^e-c64e3b")).toBe("/#memory?path=Log%2F2026-10-31.md%23%5Ee-c64e3b");
  });

  it("ranks, keeps index percentages and fills the rest", () => {
    const ranked = rankHits([hit("A.md", 10, { matchPercent: 100 }), hit("B.md", 6, { matchPercent: 64 }), hit("C.md", 5)]);
    expect(ranked.map((item) => [item.rank, item.matchPercent])).toEqual([[1, 100], [2, 64], [3, 50]]);
  });

  it("returns the top 5 with percentage, vault url, app path, title and tree path", async () => {
    const hits = [
      hit("Projects/Garden shed.md", 12, { matchPercent: 100, title: "Garden shed", treePath: "Working memory › Home › Garden shed", indexKind: "page" }),
      hit("Log/2026-11-01.md#^e-abc123", 8, { matchPercent: 71, title: "Voice note", indexKind: "log" }),
      ...[6, 5, 4, 3, 2].map((score, i) => hit(`Notes/N${i}.md`, score)),
    ];
    const result = await rankMemories(engineWith(hits), "garden shed");
    expect(result).toMatchObject({ query: "garden shed", tier: "index" });
    expect(result.ms).toBeLessThan(1000);
    expect(result.results).toHaveLength(5);
    expect(result.results[0]).toEqual({
      rank: 1, path: "Projects/Garden shed.md", title: "Garden shed", snippet: "about Projects/Garden shed.md", matchPercent: 100,
      url: "https://github.com/o/r/blob/main/Projects/Garden%20shed.md", provider: "github",
      appPath: "/#memory?path=Projects%2FGarden%20shed.md", treePath: "Working memory › Home › Garden shed", kind: "page",
    });
    expect(result.results[1]).toMatchObject({ title: "Voice note", kind: "log", matchPercent: 71 });
    expect(result.results[2]).toMatchObject({ title: "N0", kind: "note", treePath: "" });
    expect(result.results.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
    expect((await rankMemories(engineWith(hits), "x", 99)).results).toHaveLength(7);
    expect((await rankMemories(engineWith(hits), "x", Number.NaN)).results).toHaveLength(5);
    expect((await rankMemories(engineWith(hits, false), "x", 2)).tier).toBe("scan");
  });
});

describe("console memory search route (E12-S3a)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-console-search-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });

  it("serves GET /api/console/memory-search only from the signed-in customer's own vault", async () => {
    const runtimes = new Map<string, Runtime>();
    for (const [tenant, label] of [["tenant-a", "alpha"], ["tenant-b", "beta"]] as const) {
      const runtime = new Runtime(join(dir, tenant), undefined, { tenantId: tenant, seedFromEnv: false });
      vi.spyOn(runtime, "getEngine").mockImplementation(async () => engineWith([1, 2, 3, 4, 5, 6].map((n) => hit(`Notes/${label} ${n}.md`, 10 - n))));
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
    const get = async (query: string, user?: CustomerPrincipal) =>
      layer.app.request(`/api/console/memory-search${query}`, user ? { headers: { cookie: await cookieFor(user) } } : {});
    try {
      expect((await get("?q=notes")).status).toBe(401);
      expect((await get("?q=%20", ada)).status).toBe(400);
      expect((await get("?q=notes", principal("eve"))).status).toBe(404);
      const response = await get("?q=notes", ada);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toHaveLength(5);
      expect(body.results[0]).toMatchObject({ rank: 1, path: "Notes/alpha 1.md", matchPercent: 100, appPath: "/#memory?path=Notes%2Falpha%201.md" });
      expect(JSON.stringify(body)).not.toContain("beta");
      expect((await (await get("?q=notes&limit=3", bob)).json()).results.map((item: { path: string }) => item.path)).toEqual(["Notes/beta 1.md", "Notes/beta 2.md", "Notes/beta 3.md"]);
    } finally {
      tenants.close();
      for (const runtime of runtimes.values()) await runtime.close();
    }
  });
});
