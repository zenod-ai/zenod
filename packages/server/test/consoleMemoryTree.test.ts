import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryTreeOutline, steerTreeRoot } from "zenod";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import { ConsoleMemoryTreeCache } from "../src/consoleMemoryTree.js";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { NotConfiguredError, Runtime } from "../src/runtime.js";

/** A two-root vault whose every title carries the tenant label, so a leak is visible. */
function vaultFiles(label: string): Record<string, string> {
  return {
    "Tree.md": `## Working memory\n\n- ${label} project | working | [[Projects/${label} project]] | Ongoing ${label} work.\n\n## Long-term memory\n\n- ${label} archive | long-term | [[Areas/${label} archive]] | ${label} history.\n`,
    [`Projects/${label} project.md`]: `---\ntitle: ${label} project\nparent: "[[Tree]]"\nmemory: working\n---\nSecret ${label} body.\n`,
    [`Areas/${label} archive.md`]: `---\ntitle: ${label} archive\nparent: "[[Tree]]"\nmemory: long-term\n---\nx\n`,
    [`Notes/${label} capture.md`]: `---\ntitle: ${label} capture\nparent: "[[${label} project]]"\n---\nSaid [[2026-11-01#^e-abcdef]].\n`,
  };
}

async function writeVault(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

describe("console memory tree (EPIC-9 E9-2e)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-console-tree-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves GET /api/console/memory-tree only from the signed-in customer's own vault", async () => {
    const runtimes = new Map<string, Runtime>();
    const reads = new Map<string, number>();
    for (const [tenant, label] of [["tenant-a", "alpha"], ["tenant-b", "beta"], ["tenant-c", null]] as const) {
      const vault = join(dir, `${tenant}-vault`);
      await mkdir(vault, { recursive: true });
      if (label) await writeVault(vault, vaultFiles(label));
      const runtime = new Runtime(join(dir, tenant), undefined, { tenantId: tenant, seedFromEnv: false });
      vi.spyOn(runtime, "memoryTreeOutline").mockImplementation(async () => {
        reads.set(tenant, (reads.get(tenant) ?? 0) + 1);
        return memoryTreeOutline(vault);
      });
      runtimes.set(tenant, runtime);
    }
    const tenants = createSqliteTenantStore({ dataDir: dir });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      CUSTOMER_APP_URL: "https://cloud.zenod.dev",
      ACCOUNT_STATE_SECRET: "test-state-secret",
      STRIPE_SECRET_KEY: "sk_test_not-used",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_MODE: "test",
      PRICE_MONTHLY: "price_monthly",
      PRICE_YEARLY: "price_yearly",
    };
    const layer = createCustomerLayer(
      {
        dataDir: dir,
        runtimeForAccount: (account: CustomerAccount) => (account.tenant_id ? runtimes.get(account.tenant_id) ?? null : null),
      },
      { env, stripe: {} as CustomerStripeClient, tenantStore: tenants },
    );
    const principal = (subject: string): CustomerPrincipal => ({
      user_id: customerUserId("google", subject),
      provider: "google",
      provider_subject: subject,
      display_name: subject,
      avatar_url: null,
      email: `${subject}@example.test`,
      email_verified: true,
      github_id: null,
      github_login: null,
    });
    const cookieFor = async (user: CustomerPrincipal) => {
      const issuer = new Hono();
      issuer.get("/", (c) => {
        issueCustomerSession(c, user, env);
        return c.text("ok");
      });
      return (await issuer.request("/")).headers.get("set-cookie")!;
    };
    const ada = principal("ada");
    const bob = principal("bob");
    const cyd = principal("cyd");
    layer.accounts.upsert("cs_ada", { account_id: "user-ada", user_id: ada.user_id, tier: "monthly", tenant_id: "tenant-a", subscription_status: "active" });
    layer.accounts.upsert("cs_bob", { account_id: "user-bob", user_id: bob.user_id, tier: "monthly", tenant_id: "tenant-b", subscription_status: "active" });
    layer.accounts.upsert("cs_cyd", { account_id: "user-cyd", user_id: cyd.user_id, tier: "monthly", tenant_id: "tenant-c", subscription_status: "active" });
    const get = async (user?: CustomerPrincipal) =>
      layer.app.request("/api/console/memory-tree", user ? { headers: { cookie: await cookieFor(user) } } : {});
    try {
      expect((await get()).status).toBe(401);

      const adaResponse = await get(ada);
      expect(adaResponse.status).toBe(200);
      const adaBody = await adaResponse.json();
      expect(adaBody.status).toBe("ready");
      expect(adaBody.tree.groups.map((group: { title: string; pages: number }) => [group.title, group.pages])).toEqual([
        ["Working memory", 2],
        ["Long-term memory", 1],
      ]);
      expect(adaBody.tree.groups[0].children[0]).toMatchObject({ title: "alpha project", pages: 2, latest: { date: "2026-11-01", title: "alpha capture" } });
      const adaText = JSON.stringify(adaBody);
      expect(adaText).not.toContain("beta");
      expect(adaText).not.toContain("Secret");

      const bobText = JSON.stringify(await (await get(bob)).json());
      expect(bobText).toContain("beta project");
      expect(bobText).not.toContain("alpha");

      // A vault without Tree.md is an empty state, not an error.
      const cydResponse = await get(cyd);
      expect(cydResponse.status).toBe(200);
      expect(await cydResponse.json()).toEqual({ status: "empty", tree: null });

      expect((await get(principal("eve"))).status).toBe(404);

      // Cached per tenant: a second read inside the window does not hit the vault again.
      await get(ada);
      expect(reads.get("tenant-a")).toBe(1);
    } finally {
      tenants.close();
      for (const runtime of runtimes.values()) await runtime.close();
    }
  });

  it("caches per tenant for the TTL, never caches failures, and treats an unconfigured vault as empty", async () => {
    let now = 0;
    const cache = new ConsoleMemoryTreeCache(60_000, () => now);
    const tree = { groups: [], roots: 0, placed: 0, unplaced: 0 };
    const ok = { memoryTreeOutline: vi.fn(async () => tree) };
    await cache.get("t1", ok);
    await cache.get("t1", ok);
    expect(ok.memoryTreeOutline).toHaveBeenCalledTimes(1);
    now = 60_001;
    await cache.get("t1", ok);
    expect(ok.memoryTreeOutline).toHaveBeenCalledTimes(2);
    await cache.get("t2", ok);
    expect(ok.memoryTreeOutline).toHaveBeenCalledTimes(3);

    const flaky = { memoryTreeOutline: vi.fn().mockRejectedValueOnce(new Error("drive 500")).mockResolvedValueOnce(tree) };
    await expect(cache.get("t3", flaky)).rejects.toThrow("drive 500");
    await expect(cache.get("t3", flaky)).resolves.toEqual({ status: "ready", tree });

    const unconfigured = { memoryTreeOutline: vi.fn(async () => { throw new NotConfiguredError(); }) };
    await expect(cache.get("t4", unconfigured)).resolves.toEqual({ status: "empty", tree: null });
  });

  it("pins and renames a root of the signed-in customer's own tree only (E9-5b)", async () => {
    const runtimes = new Map<string, Runtime>();
    const vaults = new Map<string, string>();
    for (const [tenant, label] of [["tenant-a", "alpha"], ["tenant-b", "beta"]] as const) {
      const vault = join(dir, `${tenant}-vault`);
      await mkdir(vault, { recursive: true });
      await writeVault(vault, vaultFiles(label));
      vaults.set(tenant, vault);
      const runtime = new Runtime(join(dir, tenant), undefined, { tenantId: tenant, seedFromEnv: false });
      vi.spyOn(runtime, "memoryTreeOutline").mockImplementation(async () => memoryTreeOutline(vault));
      // The engine path (write lock, lint, commit) is covered in core; here the vault is written directly.
      vi.spyOn(runtime, "steerMemoryTree").mockImplementation(async (input) => steerTreeRoot(vault, { ...input, today: "2026-11-02" }, {
        write: async (path: string, content: string) => writeFile(join(vault, path), content),
      } as never));
      runtimes.set(tenant, runtime);
    }
    const tenants = createSqliteTenantStore({ dataDir: dir });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      CUSTOMER_APP_URL: "https://cloud.zenod.dev",
      ACCOUNT_STATE_SECRET: "test-state-secret",
      STRIPE_SECRET_KEY: "sk_test_not-used",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_MODE: "test",
      PRICE_MONTHLY: "price_monthly",
      PRICE_YEARLY: "price_yearly",
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
      issuer.get("/", (c) => {
        issueCustomerSession(c, user, env);
        return c.text("ok");
      });
      return (await issuer.request("/")).headers.get("set-cookie")!;
    };
    const ada = principal("ada");
    const bob = principal("bob");
    layer.accounts.upsert("cs_ada", { account_id: "user-ada", user_id: ada.user_id, tier: "monthly", tenant_id: "tenant-a", subscription_status: "active" });
    layer.accounts.upsert("cs_bob", { account_id: "user-bob", user_id: bob.user_id, tier: "monthly", tenant_id: "tenant-b", subscription_status: "active" });
    const post = async (body: unknown, user?: CustomerPrincipal, origin = "https://cloud.zenod.dev") => layer.app.request("/api/console/memory-tree/steer", {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(user ? { cookie: await cookieFor(user) } : {}) },
      body: JSON.stringify(body),
    });
    const get = async (user: CustomerPrincipal) => (await layer.app.request("/api/console/memory-tree", { headers: { cookie: await cookieFor(user) } })).json();
    const treeOf = (tenant: string) => readFile(join(vaults.get(tenant)!, "Tree.md"), "utf8");
    try {
      const bobBefore = await treeOf("tenant-b");
      expect((await post({ action: "pin", root: "Projects/alpha project.md" }, ada, "https://evil.example")).status).toBe(403);
      expect((await post({ action: "pin", root: "Projects/alpha project.md" })).status).toBe(401);
      expect((await post({ action: "fly", root: "x" }, ada)).status).toBe(400);

      // Warm the cache, pin, and the next read shows the pin.
      expect((await get(ada)).tree.groups[0].children[0].pinned).toBeUndefined();
      const pinned = await post({ action: "pin", root: "Projects/alpha project.md" }, ada);
      expect(pinned.status).toBe(200);
      expect(await pinned.json()).toMatchObject({ ok: true, changed: true, note: "K-1", root: { name: "alpha project", path: "Projects/alpha project.md" } });
      expect((await get(ada)).tree.groups[0].children[0]).toMatchObject({ title: "alpha project", pinned: true, nameLocked: true });
      expect(await treeOf("tenant-a")).toContain("- K-1 | alpha project | pinned |");

      // Rename: the new name is in Tree.md and in a Keeper note; a bad or taken name is refused.
      const renamed = await post({ action: "rename", root: "Areas/alpha archive.md", name: "Alpha history" }, ada);
      expect(renamed.status).toBe(200);
      expect((await get(ada)).tree.groups[1].children[0]).toMatchObject({ title: "Alpha history", nameLocked: true });
      expect((await post({ action: "rename", root: "Areas/alpha archive.md", name: "alpha PROJECT" }, ada)).status).toBe(409);
      const invalid = await post({ action: "rename", root: "Areas/alpha archive.md", name: "a | b" }, ada);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: "invalid_name" });

      // Tenant isolation: Ada cannot reach Bob's roots, and Bob's vault never changed.
      const cross = await post({ action: "pin", root: "Projects/beta project.md" }, ada);
      expect(cross.status).toBe(404);
      expect(JSON.stringify(await cross.json())).not.toContain("beta");
      expect(await treeOf("tenant-b")).toBe(bobBefore);
      expect(JSON.stringify(await get(bob))).not.toContain("pinned");
    } finally {
      tenants.close();
      for (const runtime of runtimes.values()) await runtime.close();
    }
  });
});
