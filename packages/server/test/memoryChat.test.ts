import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_PROTOCOL_FAILURE_TEXT, LlmAllowanceExceededError, type Answer, type BrainEngine, type Hit } from "zenod";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { aiAllowanceExhaustedMessage } from "../src/customerMetering.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { answerFromMemory, memoryKeepContent, parseMemoryKeep } from "../src/memoryChat.js";
import { Runtime } from "../src/runtime.js";

// EPIC-12 E12-S1: the web app's chat with your memory. Asking answers from your own vault and
// saves nothing; only Keep files something.
const hit = (path: string, score: number, extra: Partial<Hit> = {}): Hit => ({
  path, snippet: `about ${path}`, score, url: `https://github.com/o/r/blob/main/${encodeURI(path)}`, provider: "github", ...extra,
});

interface FakeEngine extends BrainEngine {
  askCalls: string[];
  storeCalls: unknown[];
}

function fakeEngine(label: string, options: { ask?: (question: string) => Promise<Answer> } = {}): FakeEngine {
  const hits = [1, 2, 3, 4, 5, 6].map((n) => hit(`Notes/${label} ${n}.md`, 10 - n, n === 1 ? { matchPercent: 100 } : {}));
  const engine = {
    askCalls: [] as string[],
    storeCalls: [] as unknown[],
    search: async () => hits,
    searchTimed: async () => ({ hits, tier: "index" as const, ms: 2 }),
    ask: async (question: string) => {
      engine.askCalls.push(question);
      if (options.ask) return options.ask(question);
      return {
        text: `From your ${label} notes [[Notes/${label} 2]].`,
        sources: [
          { path: `Notes/${label} 2.md#^e-1`, url: `https://github.com/o/r/blob/main/Notes/${label}%202.md`, provider: "github" },
          { path: `Log/2026-11-01.md#^e-${label}`, url: "https://github.com/o/r/blob/main/Log/2026-11-01.md", provider: "github" },
        ],
      } satisfies Answer;
    },
    store: async (input: unknown) => { engine.storeCalls.push(input); throw new Error("store must not be called synchronously"); },
    get: async (path: string) => {
      if (!path.startsWith(`Notes/${label}`)) throw new Error("ENOENT");
      return { path, frontmatter: {}, body: `# ${label}\nbody of ${path}`, url: `https://github.com/o/r/blob/main/${path}`, provider: "github" as const };
    },
  };
  return engine as unknown as FakeEngine;
}

describe("answerFromMemory (E12-S1)", () => {
  it("answers with the top 5 ranked memories, marks the cited ones and lists other citations once", async () => {
    const engine = fakeEngine("alpha");
    const result = await answerFromMemory(engine, "alpha plans");
    expect(result.answer).toContain("alpha notes");
    expect(result.answered).toBe(true);
    expect(result.memories).toHaveLength(5);
    expect(result.memories[0]).toMatchObject({ rank: 1, path: "Notes/alpha 1.md", matchPercent: 100, cited: false, appPath: "/#memory?path=Notes%2Falpha%201.md" });
    expect(result.memories[1]).toMatchObject({ rank: 2, path: "Notes/alpha 2.md", cited: true });
    expect(result.memories.every((memory) => memory.url.startsWith("https://github.com/") && memory.matchPercent >= 1)).toBe(true);
    expect(result.alsoCited).toEqual([
      { path: "Log/2026-11-01.md", title: "2026-11-01", url: "https://github.com/o/r/blob/main/Log/2026-11-01.md", appPath: "/#memory?path=Log%2F2026-11-01.md" },
    ]);
    expect(engine.storeCalls).toHaveLength(0);
  });

  it("asks again once after a protocol slip, and marks a non-answer so it cannot be kept", async () => {
    const slip = { text: ANSWER_PROTOCOL_FAILURE_TEXT, sources: [] };
    const recovered = fakeEngine("alpha", { ask: vi.fn().mockResolvedValueOnce(slip).mockResolvedValueOnce({ text: "Ana fixes it.", sources: [] }) });
    const ok = await answerFromMemory(recovered, "boiler");
    expect(ok).toMatchObject({ answered: true, answer: "Ana fixes it." });
    expect(recovered.askCalls).toHaveLength(2);

    const stuck = fakeEngine("alpha", { ask: async () => slip });
    const failed = await answerFromMemory(stuck, "boiler");
    expect(failed.answered).toBe(false);
    expect(failed.answer).toContain("could not put a checked answer together");
    expect(failed.memories).toHaveLength(5);
    expect(stuck.askCalls).toHaveLength(2);

    const unverified = fakeEngine("alpha", { ask: async () => ({ text: "I couldn't verify an answer from source text read for this question.", sources: [] }) });
    const none = await answerFromMemory(unverified, "boiler");
    expect(none).toMatchObject({ answered: false, answer: expect.stringContaining("found no note that answers this directly") });
    expect(unverified.askCalls).toHaveLength(1);
  });

  it("files an answer with its question and a note as typed", () => {
    expect(parseMemoryKeep({ content: "  " })).toBeNull();
    expect(parseMemoryKeep({ kind: "answer", question: "q", answer: "" })).toBeNull();
    expect(parseMemoryKeep({ content: "x".repeat(8_001) })).toBeNull();
    expect(memoryKeepContent(parseMemoryKeep({ content: " The plumber is Ana. " })!)).toBe("The plumber is Ana.");
    expect(memoryKeepContent(parseMemoryKeep({ kind: "answer", question: "Who fixes the boiler?", answer: "Ana." })!))
      .toBe("Who fixes the boiler?\n\nAna.\n\n(Answer kept from a chat in the Zenod app.)");
  });
});

describe("console memory chat routes (E12-S1)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-console-chat-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });

  async function setup(options: { allowance?: number | null } = {}) {
    const runtimes = new Map<string, Runtime>();
    const engines = new Map<string, FakeEngine>();
    for (const [tenant, label] of [["tenant-a", "alpha"], ["tenant-b", "beta"]] as const) {
      const runtime = new Runtime(join(dir, tenant), undefined, {
        tenantId: tenant,
        seedFromEnv: false,
        platformLlm: { apiKey: "sk-or-v1-test-platform" },
        tenantMonthlyAllowanceUsd: options.allowance ?? 1,
      });
      const engine = fakeEngine(label);
      engines.set(tenant, engine);
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
    const call = async (method: string, path: string, user?: CustomerPrincipal, body?: unknown) =>
      layer.app.request(path, {
        method,
        headers: { ...(user ? { cookie: await cookieFor(user) } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const close = async () => {
      tenants.close();
      for (const runtime of runtimes.values()) await runtime.close();
    };
    return { runtimes, engines, ada, bob, eve: principal("eve"), call, close };
  }

  it("answers only from the signed-in customer's own vault and saves nothing", async () => {
    const t = await setup();
    try {
      expect((await t.call("POST", "/api/console/memory-chat", undefined, { question: "notes" })).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-chat", t.ada, { question: "  " })).status).toBe(400);
      expect((await t.call("POST", "/api/console/memory-chat", t.ada, { question: "x".repeat(2_001) })).status).toBe(400);
      expect((await t.call("POST", "/api/console/memory-chat", t.eve, { question: "notes" })).status).toBe(404);

      const response = await t.call("POST", "/api/console/memory-chat", t.ada, { question: "what are my notes?" });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.question).toBe("what are my notes?");
      expect(body.answer).toContain("alpha");
      expect(body.memories).toHaveLength(5);
      expect(body.memories[0]).toMatchObject({ path: "Notes/alpha 1.md", matchPercent: 100, appPath: "/#memory?path=Notes%2Falpha%201.md" });
      expect(JSON.stringify(body)).not.toContain("beta");
      expect(t.engines.get("tenant-b")!.askCalls).toHaveLength(0);

      const bobBody = await (await t.call("POST", "/api/console/memory-chat", t.bob, { question: "mine" })).json();
      expect(bobBody.memories.map((memory: { path: string }) => memory.path)[0]).toBe("Notes/beta 1.md");
      expect(JSON.stringify(bobBody)).not.toContain("alpha");

      // Asking saved nothing: no store call, no capture job in either tenant.
      for (const tenant of ["tenant-a", "tenant-b"]) {
        expect(t.engines.get(tenant)!.storeCalls).toHaveLength(0);
        expect(t.runtimes.get(tenant)!.taskJobStore.recentCaptures(50)).toHaveLength(0);
      }
    } finally {
      await t.close();
    }
  });

  it("stops at the AI allowance before any model call, and reports a cap hit mid-answer", async () => {
    const t = await setup({ allowance: 1 });
    try {
      // Over the allowance on the tenant's own ledger: no ask, a 429 with the reason.
      t.runtimes.get("tenant-a")!.usageStore.record({
        operation: "answer", provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1,
        cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 1.5,
      });
      const blocked = await t.call("POST", "/api/console/memory-chat", t.ada, { question: "notes" });
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ code: "ai_allowance_exhausted", message: expect.stringContaining("AI allowance") });
      expect(t.engines.get("tenant-a")!.askCalls).toHaveLength(0);
      const keepBlocked = await t.call("POST", "/api/console/memory-keep", t.ada, { content: "keep me" });
      expect(keepBlocked.status).toBe(429);
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(0);

      // Bob's ledger is his own: still under, so he is answered.
      expect((await t.call("POST", "/api/console/memory-chat", t.bob, { question: "notes" })).status).toBe(200);

      // The engine's metered model call throws at the cap mid-answer: same 429, never a 500.
      const resetsAt = "2026-12-01T00:00:00.000Z";
      vi.spyOn(t.engines.get("tenant-b")!, "ask").mockRejectedValueOnce(new LlmAllowanceExceededError(aiAllowanceExhaustedMessage(resetsAt), resetsAt));
      const midway = await t.call("POST", "/api/console/memory-chat", t.bob, { question: "notes" });
      expect(midway.status).toBe(429);
      expect(await midway.json()).toMatchObject({ code: "ai_allowance_exhausted", resetsAt });
    } finally {
      await t.close();
    }
  });

  it("counts chat spend on the tenant's own usage ledger", async () => {
    const t = await setup({ allowance: 5 });
    try {
      const runtime = t.runtimes.get("tenant-a")!;
      // Stand in for the engine's metered model call: every real call records on runtime.usageStore.
      vi.spyOn(t.engines.get("tenant-a")!, "ask").mockImplementation(async () => {
        runtime.checkTenantAllowance();
        runtime.usageStore.record({
          operation: "answer", provider: "openrouter", model: "m", inputTokens: 10, outputTokens: 5,
          cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 0.25,
        });
        return { text: "ok", sources: [] };
      });
      expect((await t.call("POST", "/api/console/memory-chat", t.ada, { question: "notes" })).status).toBe(200);
      expect(runtime.monthToDateSpendUsd()).toBeCloseTo(0.25);
      expect(t.runtimes.get("tenant-b")!.monthToDateSpendUsd()).toBe(0);
    } finally {
      await t.close();
    }
  });

  it("files a Keep once, in the customer's own tenant, and shows its status only to them", async () => {
    const t = await setup();
    try {
      expect((await t.call("POST", "/api/console/memory-keep", undefined, { content: "x" })).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-keep", t.ada, { content: " " })).status).toBe(400);
      const enqueue = vi.spyOn(t.runtimes.get("tenant-a")!.taskJobQueue, "enqueue");
      const kept = await t.call("POST", "/api/console/memory-keep", t.ada, { kind: "answer", question: "Who fixes the boiler?", answer: "Ana." });
      expect(kept.status).toBe(202);
      const receipt = await kept.json();
      expect(receipt).toMatchObject({ channel: "app", channelLabel: "Zenod app" });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0]![0]).toBe("store");
      expect(enqueue.mock.calls[0]![1]).toEqual({ content: "Who fixes the boiler?\n\nAna.\n\n(Answer kept from a chat in the Zenod app.)", source: "web" });
      expect(enqueue.mock.calls[0]![2]).toMatch(/^tenant-a:web-keep:[0-9a-f]{32}$/);

      // A double tap files it once.
      const again = await (await t.call("POST", "/api/console/memory-keep", t.ada, { kind: "answer", question: "Who fixes the boiler?", answer: "Ana." })).json();
      expect(again.id).toBe(receipt.id);
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(1);
      expect(t.runtimes.get("tenant-b")!.taskJobStore.recentCaptures(50)).toHaveLength(0);

      expect((await t.call("GET", `/api/console/memory-keep/${receipt.id}`, t.ada)).status).toBe(200);
      expect((await t.call("GET", `/api/console/memory-keep/${receipt.id}`, t.bob)).status).toBe(404);
      expect((await t.call("GET", `/api/console/memory-keep/${receipt.id}`)).status).toBe(401);
    } finally {
      await t.close();
    }
  });

  it("opens a linked memory from the customer's own vault only", async () => {
    const t = await setup();
    try {
      expect((await t.call("GET", "/api/console/memory-note?path=Notes%2Falpha%201.md")).status).toBe(401);
      for (const bad of ["", "%2Fetc%2Fpasswd.md", "Notes%2F..%2F..%2Fsecret.md", "Notes%2Falpha"]) {
        expect((await t.call("GET", `/api/console/memory-note?path=${bad}`, t.ada)).status).toBe(400);
      }
      const response = await t.call("GET", "/api/console/memory-note?path=Notes%2Falpha%201.md%23%5Ee-1", t.ada);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ path: "Notes/alpha 1.md", body: expect.stringContaining("alpha"), provider: "github" });
      // Ada's path asked of Bob's vault is simply not there.
      expect((await t.call("GET", "/api/console/memory-note?path=Notes%2Falpha%201.md", t.bob)).status).toBe(404);
    } finally {
      await t.close();
    }
  });
});
