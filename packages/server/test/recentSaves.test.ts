import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { recentSaves, type RecentSave } from "../src/recentSaves.js";
import { Runtime } from "../src/runtime.js";
import { TaskJobStore } from "../src/taskJobStore.js";

const T0 = Date.parse("2026-11-01T10:00:00Z");

function storeResult(page: string, url: string, filing = "filed") {
  return {
    evidenceRef: "Log/2026-11-01.md#^e-1",
    pagesTouched: [page],
    pageUrls: [url],
    urls: [url],
    filing,
  };
}

/** One WhatsApp text, one WhatsApp voice note + its filing, plus noise that must not show. */
function seedTenant(store: TaskJobStore, tenant: string, label: string) {
  const text = store.enqueue("store", { content: `${label} text note`, source: "whatsapp" }, `${tenant}:whatsapp:T-${label}`, T0);
  store.update(text.id, { status: "done", result: storeResult(`Notes/${label}.md`, `https://github.com/acme/${label}/blob/main/Notes.md`) as never });
  const enrich = store.enqueue("enrich_memory", { content: "x", source: "whatsapp" }, `enrich:${tenant}:whatsapp:V-${label}`, T0 + 2);
  store.update(enrich.id, { status: "done", result: storeResult(`Inbox/filing-${label}.md`, `https://github.com/acme/${label}/blob/main/Inbox.md`, "inbox") as never });
  const voice = store.enqueue(
    "media_ingest",
    { mediaType: "audio", contentType: "voice_note", providedTranscript: `${label} spoken words`, filename: "a.ogg" },
    `${tenant}:whatsapp:V-${label}`,
    T0 + 1,
  );
  store.update(voice.id, {
    status: "done",
    result: {
      status: "done",
      message: "captured",
      mediaType: "audio",
      source: {},
      rawArtifact: { handle: null, archiveUrl: null },
      extraction: { handle: null, provider: null },
      digest: { evidenceRef: null, pagesTouched: [], revision: null, urls: [], enrichmentJobId: enrich.id },
    },
  });
  store.enqueue("chat", { text: "what did I say?", source: "whatsapp" }, `${tenant}:whatsapp:C-${label}`, T0 + 3);
  store.enqueue("store", { content: "selftest probe", source: "selftest" }, undefined, T0 + 4);
}

describe("recent saves (EPIC-7 T2.5)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-recent-saves-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("projects a tenant's WhatsApp text and voice saves with their Saved reply and vault link", () => {
    const store = new TaskJobStore(join(dir, "tasks.sqlite"), "tenant-a");
    try {
      seedTenant(store, "tenant-a", "alpha");
      const saves = recentSaves(store);
      expect(saves.map((save) => save.channelLabel)).toEqual(["WhatsApp voice", "WhatsApp text"]);
      expect(saves[0]).toMatchObject({
        channel: "whatsapp",
        kind: "voice",
        snippet: "alpha spoken words",
        status: "saved",
        reply: "Saved — filed to Inbox; the filing question is logged in the note.",
        notePath: "Inbox/filing-alpha.md",
        noteUrl: "https://github.com/acme/alpha/blob/main/Inbox.md",
        savedAt: new Date(T0 + 1).toISOString(),
      });
      expect(saves[1]).toMatchObject({
        kind: "text",
        snippet: "alpha text note",
        reply: "Saved.",
        notePath: "Notes/alpha.md",
      });
    } finally {
      store.close();
    }
  });

  it("never shows another tenant's captures, even in a shared task file", () => {
    const path = join(dir, "tasks.sqlite");
    const a = new TaskJobStore(path, "tenant-a");
    const b = new TaskJobStore(path, "tenant-b");
    try {
      seedTenant(a, "tenant-a", "alpha");
      seedTenant(b, "tenant-b", "beta");
      const text = (saves: RecentSave[]) => JSON.stringify(saves);
      expect(text(recentSaves(a))).toContain("alpha");
      expect(text(recentSaves(a))).not.toContain("beta");
      expect(text(recentSaves(b))).toContain("beta");
      expect(text(recentSaves(b))).not.toContain("alpha");
    } finally {
      a.close();
      b.close();
    }
  });

  it("keeps errors, unsafe links and long text out of the projection", () => {
    const store = new TaskJobStore(join(dir, "tasks.sqlite"), "tenant-a");
    try {
      const failed = store.enqueue("store", { content: "boom", source: "mcp" }, undefined, T0);
      store.update(failed.id, { status: "error", error: "provider key sk-secret rejected" });
      const unsafe = store.enqueue("store", { content: "x".repeat(400), source: "mcp" }, undefined, T0 + 1);
      store.update(unsafe.id, { status: "done", result: storeResult("Notes/x.md", "javascript:alert(1)") as never });
      store.enqueue("store", { content: "pending" }, undefined, T0 + 2);

      const [pending, longOne, error] = recentSaves(store);
      expect(pending).toMatchObject({ status: "saving", channelLabel: "AI assistant" });
      expect(longOne.noteUrl).toBeNull();
      expect(longOne.snippet.length).toBeLessThanOrEqual(140);
      expect(error).toMatchObject({ status: "failed", reply: "Not saved." });
      expect(JSON.stringify(error)).not.toContain("sk-secret");
      expect(recentSaves(store, 1)).toHaveLength(1);
      expect(recentSaves(store, 10_000)).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it("serves GET /api/console/recent-saves only for the signed-in customer's tenant", async () => {
    const runtimes = new Map<string, Runtime>();
    for (const tenant of ["tenant-a", "tenant-b"]) {
      const runtime = new Runtime(join(dir, tenant), undefined, { tenantId: tenant, seedFromEnv: false });
      seedTenant(runtime.taskJobStore, tenant, tenant === "tenant-a" ? "alpha" : "beta");
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
    layer.accounts.upsert("cs_ada", { account_id: "user-ada", user_id: ada.user_id, tier: "monthly", tenant_id: "tenant-a", subscription_status: "active" });
    layer.accounts.upsert("cs_bob", { account_id: "user-bob", user_id: bob.user_id, tier: "monthly", tenant_id: "tenant-b", subscription_status: "active" });
    try {
      expect((await layer.app.request("/api/console/recent-saves")).status).toBe(401);

      const adaResponse = await layer.app.request("/api/console/recent-saves", { headers: { cookie: await cookieFor(ada) } });
      expect(adaResponse.status).toBe(200);
      const adaBody = JSON.stringify(await adaResponse.json());
      expect(adaBody).toContain("alpha spoken words");
      expect(adaBody).not.toContain("beta");

      const bobBody = JSON.stringify(await (await layer.app.request("/api/console/recent-saves", { headers: { cookie: await cookieFor(bob) } })).json());
      expect(bobBody).toContain("beta text note");
      expect(bobBody).not.toContain("alpha");

      const stranger = await layer.app.request("/api/console/recent-saves", { headers: { cookie: await cookieFor(principal("eve")) } });
      expect(stranger.status).toBe(404);
    } finally {
      tenants.close();
      for (const runtime of runtimes.values()) runtime.close();
    }
  });
});
