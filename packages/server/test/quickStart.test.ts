import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteOAuthStore, createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { setHelpersBuilding } from "../src/personaRunner.js";
import {
  assistantLabel,
  markQuickStart,
  quickStartView,
  toolFoundSomething,
  type QuickStartFacts,
} from "../src/quickStart.js";
import { Runtime } from "../src/runtime.js";
import { TaskJobStore } from "../src/taskJobStore.js";

const T0 = Date.parse("2026-11-11T10:00:00Z");
const none: QuickStartFacts = { whatsappAt: null, keepAt: null, assistant: null, helper: null, helpersOpen: true };

describe("tester quick start (EPIC-26 S15)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-quick-start-"));
  });

  afterEach(async () => {
    setHelpersBuilding(() => false);
    await rm(dir, { recursive: true, force: true });
  });

  it("starts at 0 of 5 and ticks each step from the facts, for good", () => {
    expect(quickStartView(dir, none)).toMatchObject({ score: 0, total: 5, complete: false, hidden: false });
    const half = quickStartView(dir, { ...none, whatsappAt: T0, keepAt: T0 + 1 });
    expect(half.score).toBe(2);
    expect(half.steps.filter((step) => step.done).map((step) => step.id)).toEqual(["whatsapp", "keep"]);
    // Facts gone later (pruned jobs, a helper switched off) keep their tick.
    expect(quickStartView(dir, none).score).toBe(2);
    markQuickStart(dir, "found");
    const all = quickStartView(dir, { ...none, assistant: { name: "Claude", at: T0 }, helper: { name: "Weekly recap" } });
    expect(all).toMatchObject({ score: 5, total: 5, complete: true, assistantName: "Claude", helperName: "Weekly recap" });
  });

  it("counts four while helpers are still building, and five once they open", () => {
    const building = quickStartView(dir, { ...none, whatsappAt: T0, keepAt: T0, assistant: { name: null, at: T0 }, helpersOpen: false });
    markQuickStart(dir, "found");
    const done = quickStartView(dir, { ...none, helpersOpen: false });
    expect(building).toMatchObject({ total: 4, score: 3 });
    expect(done).toMatchObject({ total: 4, score: 4, complete: true });
    expect(quickStartView(dir, none)).toMatchObject({ total: 5, score: 4, complete: false });
  });

  it("knows a found memory from a read tool's result, and names the assistant", () => {
    expect(toolFoundSomething("search_memory", { structuredContent: { hits: [{}], entries: [] } })).toBe(true);
    expect(toolFoundSomething("search_memory", { structuredContent: { hits: [], entries: [] } })).toBe(false);
    expect(toolFoundSomething("ask_brain", { structuredContent: { sources: [{ path: "a.md" }] } })).toBe(true);
    expect(toolFoundSomething("get_memory", { isError: true, structuredContent: { path: "a.md" } })).toBe(false);
    expect(toolFoundSomething("store_memory", { structuredContent: { hits: [{}] } })).toBe(false);
    expect(assistantLabel("claude-ai")).toBe("Claude");
    expect(assistantLabel("Codex CLI")).toBe("Codex");
    expect(assistantLabel("MCP client")).toBeNull();
  });

  it("finds the first WhatsApp capture and the first filed one in the tenant's own jobs", () => {
    const store = new TaskJobStore(join(dir, "tasks.sqlite"), "tenant-a");
    const other = new TaskJobStore(join(dir, "tasks.sqlite"), "tenant-b");
    try {
      expect(store.firstCaptureAt({ channel: "whatsapp" })).toBeNull();
      other.enqueue("store", { content: "theirs", source: "whatsapp" }, "tenant-b:whatsapp:1", T0 - 5);
      store.enqueue("store", { content: "probe", source: "selftest" }, undefined, T0 - 3);
      const app = store.enqueue("store", { content: "from the app", source: "web" }, undefined, T0);
      store.enqueue("store", { content: "hi", source: "whatsapp" }, "tenant-a:whatsapp:2", T0 + 5);
      expect(store.firstCaptureAt({ channel: "whatsapp" })).toBe(T0 + 5);
      expect(store.firstCaptureAt({ done: true })).toBeNull();
      store.update(app.id, { status: "done" });
      expect(store.firstCaptureAt({ done: true })).toBe(T0);
    } finally {
      store.close();
      other.close();
    }
  });

  it("finds the first OAuth sign-in to one tenant", () => {
    const oauth = createSqliteOAuthStore({ dataDir: dir });
    try {
      oauth.createToken({ accessToken: "a", refreshToken: "r", clientId: "c", clientName: "claude-ai", resource: "x", scope: "mcp", tenant: { id: "tenant-a" } as never, expiresAt: T0 + 1e6, createdAt: T0 });
      oauth.createToken({ accessToken: "b", refreshToken: "s", clientId: "d", clientName: "codex", resource: "x", scope: "mcp", tenant: { id: "tenant-b" } as never, expiresAt: T0 + 1e6, createdAt: T0 - 9 });
      expect(oauth.firstSignInForTenant("tenant-a")).toEqual({ clientName: "claude-ai", createdAt: T0 });
      expect(oauth.firstSignInForTenant("tenant-z")).toBeNull();
    } finally {
      oauth.close();
    }
  });

  it("serves the card for the signed-in tenant only, ticks from real state, and hides", async () => {
    setHelpersBuilding(() => false);
    const runtime = new Runtime(join(dir, "tenant-a"), undefined, { tenantId: "tenant-a", seedFromEnv: false });
    const tenants = createSqliteTenantStore({ dataDir: dir });
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", CUSTOMER_APP_URL: "https://cloud.zenod.dev", ACCOUNT_STATE_SECRET: "test-state-secret" };
    let signedIn: { clientName: string; at: number } | null = null;
    const layer = createCustomerLayer(
      { dataDir: dir, runtimeForAccount: (account: CustomerAccount) => (account.tenant_id === "tenant-a" ? runtime : null) },
      { env, stripe: {} as CustomerStripeClient, tenantStore: tenants, quickStartAssistantSignIn: (tenantId) => (tenantId === "tenant-a" ? signedIn : null) },
    );
    const ada: CustomerPrincipal = {
      user_id: customerUserId("google", "ada"), provider: "google", provider_subject: "ada", display_name: "ada", avatar_url: null,
      email: "ada@example.test", email_verified: true, github_id: null, github_login: null,
    };
    layer.accounts.upsert("cs_ada", { account_id: "user-ada", user_id: ada.user_id, tier: "monthly", tenant_id: "tenant-a", subscription_status: "active" });
    const issuer = new Hono();
    issuer.get("/", (c) => {
      issueCustomerSession(c, ada, env);
      return c.text("ok");
    });
    const cookie = (await issuer.request("/")).headers.get("set-cookie")!;
    const read = async () => (await layer.app.request("/api/console/quick-start", { headers: { cookie } })).json() as Promise<Record<string, unknown>>;
    try {
      expect((await layer.app.request("/api/console/quick-start")).status).toBe(401);
      expect(await read()).toMatchObject({ score: 0, total: 5 });

      const job = runtime.taskJobStore.enqueue("store", { content: "Ana's book: Piranesi", source: "whatsapp" }, "tenant-a:whatsapp:m1", T0);
      runtime.taskJobStore.update(job.id, { status: "done" });
      signedIn = { clientName: "claude-ai", at: T0 + 10 };
      const switched = await layer.app.request("/api/console/personas/weekly-recap", {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }),
      });
      expect(switched.status).toBe(200);
      const view = await read();
      expect(view).toMatchObject({ score: 4, total: 5, assistantName: "Claude", helperName: "Weekly recap" });
      expect((view.steps as Array<{ id: string; done: boolean }>).find((step) => step.id === "found")?.done).toBe(false);

      const hide = await layer.app.request("/api/console/quick-start/hide", {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ hidden: true }),
      });
      expect(hide.status).toBe(200);
      expect(await read()).toMatchObject({ hidden: true });
    } finally {
      tenants.close();
      runtime.close();
    }
  });
});
