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
import { ABOUT_ZENOD, answerFromMemory, isAboutZenod, isSensitiveMemory, memoryKeepContent, parseMemoryKeep, streamAnswerFromMemory, VOICE_NOTE_MAX_BYTES } from "../src/memoryChat.js";
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

type FastAnswer = NonNullable<BrainEngine["answerFromMemories"]>;

function fakeEngine(label: string, options: { ask?: (question: string) => Promise<Answer>; fast?: FastAnswer } = {}): FakeEngine {
  const hits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => hit(`Notes/${label} ${n}.md`, 10 - n, n === 1 ? { matchPercent: 100 } : {}));
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
    ...(options.fast ? { answerFromMemories: options.fast } : {}),
    store: async (input: unknown) => { engine.storeCalls.push(input); throw new Error("store must not be called synchronously"); },
    get: async (path: string) => {
      if (!path.startsWith(`Notes/${label}`)) throw new Error("ENOENT");
      return { path, frontmatter: {}, body: `# ${label}\nbody of ${path}`, url: `https://github.com/o/r/blob/main/${path}`, provider: "github" as const };
    },
  };
  return engine as unknown as FakeEngine;
}

describe("answerFromMemory cited memories keep their percentage (E12-S3c)", () => {
  it("shows a cited memory that ranked below the top 5 in the list with its own percentage", async () => {
    const engine = fakeEngine("beta", {
      ask: async () => ({ text: "From [[Notes/beta 8]].", sources: [{ path: "Notes/beta 8.md", title: "beta 8", url: "https://github.com/o/r/blob/main/Notes/beta%208.md", provider: "github" }] }) as unknown as Answer,
    });
    const more = [...(await engine.search("x"))].slice(0, 6);
    for (const n of [7, 8, 9]) more.push(hit(`Notes/beta ${n}.md`, 3 - n / 10, { matchPercent: 60 - n }));
    engine.searchTimed = async () => ({ hits: more, tier: "index" as const, ms: 2 });
    const result = await answerFromMemory(engine, "beta plans");
    expect(result.memories.map((memory) => memory.path)).toEqual([1, 2, 3, 4, 5, 8].map((n) => `Notes/beta ${n}.md`));
    expect(result.memories[5]).toMatchObject({ cited: true, rank: 8, matchPercent: 44 }); // its own percentage, kept below the hit above
    expect(result.alsoCited).toEqual([]);
  });
});

describe("every cited memory shows a percentage, recent notes show their link state (E12-S3c round 2)", () => {
  it("scores a cited memory the ranked list never reached and places it by its percentage", async () => {
    const engine = fakeEngine("gamma");
    const asked: string[][] = [];
    engine.matchPercentsFor = async (_question, paths) => {
      asked.push([...paths]);
      return { "Log/2026-11-01.md#^e-gamma": 72 };
    };
    const result = await answerFromMemory(engine, "gamma plans");
    expect(asked).toEqual([["Log/2026-11-01.md#^e-gamma"]]);
    expect(result.alsoCited).toEqual([]);
    const cited = result.memories.find((memory) => memory.path === "Log/2026-11-01.md#^e-gamma");
    expect(cited).toMatchObject({ cited: true, matchPercent: 72, kind: "log" });
    const percents = result.memories.map((memory) => memory.matchPercent);
    expect(percents).toEqual([...percents].sort((a, b) => b - a));
  });

  it("adds the voice-note link count when the list shows a note ranked by time", async () => {
    const engine = fakeEngine("delta");
    const note = hit("Log/2026-11-08.md#^e-5c0e11", 0, { matchPercent: 100, relation: "note", unlinked: true, indexKind: "log", title: "Latest note" });
    engine.searchTimed = async () => ({ hits: [note], tier: "index" as const, ms: 1 });
    engine.memoryNoteLinks = async () => ({ voiceNotes: 45, unlinked: 12, partial: 3, unlinkedPaths: [] });
    const result = await answerFromMemory(engine, "what was in my last vn?");
    expect(result.memories[0]).toMatchObject({ relation: "note", unlinked: true, matchPercent: 100 });
    expect(result.noteLinks).toEqual({ voiceNotes: 45, unlinked: 12 });
    const plain = await answerFromMemory(fakeEngine("delta"), "delta plans");
    expect(plain.noteLinks).toBeUndefined();
  });
});

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

  it("fast path (E12-S1b): memories first, the prose streamed, then the checked answer marking only cited memories", async () => {
    const events: string[] = [];
    const seen: Array<{ n: number; path: string }> = [];
    const engine = fakeEngine("alpha", {
      fast: async (_question, memories, onText) => {
        seen.push(...memories);
        events.push("model");
        onText?.("Alpha is in note two [2]");
        onText?.(" and seven [7].");
        return { checked: true, reason: null, text: "Alpha is in note two [2] and seven [7].", cited: [2, 7] };
      },
    });
    const result = await streamAnswerFromMemory(engine, "alpha", {
      onMemories: (memories) => events.push(`memories:${memories.length}:${memories.filter((memory) => memory.cited).length}`),
      onText: (text) => events.push(`text:${text}`),
    });
    expect(events).toEqual(["memories:5:0", "model", "text:Alpha is in note two [2]", "text: and seven [7]."]);
    expect(seen.map((memory) => memory.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]); // the five shown plus up to 11 more (E12-S1b round 2)
    expect(result).toMatchObject({ answered: true, answer: "Alpha is in note two [2] and seven [7].", checkedBy: "quoted" });
    // The top 5, plus the cited memory that ranked 7th with its own percentage (E12-S3c).
    expect(result.memories.map((memory) => [memory.rank, memory.cited])).toEqual([[1, false], [2, true], [3, false], [4, false], [5, false], [7, true]]);
    expect(result.alsoCited).toEqual([]);
    expect(engine.askCalls).toHaveLength(0);
    expect(engine.storeCalls).toHaveLength(0);
  });

  it("fast path: an answer that fails the check is never shown, nor one the notes do not support", async () => {
    const unchecked = fakeEngine("alpha", { fast: async () => ({ checked: false, reason: "citation_not_found", text: "Made up [1].", cited: [] }) });
    const failed = await answerFromMemory(unchecked, "alpha");
    expect(failed).toMatchObject({ answered: false, answer: expect.stringContaining("No confident answer"), alsoCited: [] });
    expect(failed.answer).not.toContain("Made up");
    expect(failed.memories).toHaveLength(5);
    expect(failed.memories.every((memory) => !memory.cited)).toBe(true);

    const none = fakeEngine("alpha", { fast: async () => ({ checked: false, reason: "no_answer", text: "", cited: [] }) });
    expect(await answerFromMemory(none, "alpha")).toMatchObject({ answered: false, answer: expect.stringContaining("found no note that answers this directly") });
    expect(none.askCalls).toHaveLength(0);
  });

  it("fast path: a cited note the engine read beside the ranked list is shown, with its own percentage (E12-S1b round 2)", async () => {
    const note = "Log/2026-11-05.md#^e-aaaaa1";
    const engine = fakeEngine("alpha", {
      fast: async () => ({
        checked: true, reason: null, text: "You said Mexico City first [10].", cited: [10],
        context: [{ n: 1, path: "Notes/alpha 1.md", title: "alpha 1", url: "u1", provider: "github" as const },
          { n: 10, path: note, title: "Your voice note", url: "https://github.com/o/r/blob/main/Log/2026-11-05.md", provider: "github" as const }],
      }),
    });
    const percents = vi.fn(async () => ({ [note]: 64 }));
    engine.matchPercentsFor = percents;
    const result = await answerFromMemory(engine, "which cities?");
    expect(percents).toHaveBeenCalledWith("which cities?", [note]);
    expect(result.memories.find((memory) => memory.path === note)).toMatchObject({
      cited: true, matchPercent: 64, title: "Your voice note", kind: "log", url: "https://github.com/o/r/blob/main/Log/2026-11-05.md", appPath: expect.stringContaining("Log%2F2026-11-05.md"),
    });
    // Not cited, not shown: an unchecked answer adds nothing.
    const quiet = fakeEngine("alpha", { fast: async () => ({ checked: false, reason: "citation_not_found", text: "x [10].", cited: [], context: [{ n: 10, path: note, title: "n", url: "", provider: "github" as const }] }) });
    expect((await answerFromMemory(quiet, "which cities?")).memories.some((memory) => memory.path === note)).toBe(false);
  });

  it("fast path: no memory found means no model call", async () => {
    const fast = vi.fn();
    const engine = fakeEngine("alpha", { fast });
    engine.searchTimed = async () => ({ hits: [], tier: "index" as const, ms: 1 });
    expect(await answerFromMemory(engine, "nothing")).toMatchObject({ answered: false, memories: [], answer: "No memory matches this question yet." });
    expect(fast).not.toHaveBeenCalled();
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

describe("the app chat: questions about Zenod, a relevance floor, sensitive notes (E15-S1)", () => {
  const weak = (pairs: Array<[string, number, string?]>) =>
    pairs.map(([path, percent, treePath], i) => hit(path, 10 - i, { matchPercent: percent, ...(treePath ? { treePath } : {}) }));

  it("answers a question about Zenod itself with its own description, no memories and no model call", async () => {
    const fast = vi.fn();
    const engine = fakeEngine("alpha", { fast });
    const search = vi.fn(engine.searchTimed!);
    engine.searchTimed = search;
    const shown: unknown[] = [];
    const result = await streamAnswerFromMemory(engine, "Who are you?", { onMemories: (m) => shown.push(m), appChat: true });
    expect(result).toMatchObject({ answered: true, answer: ABOUT_ZENOD, memories: [], alsoCited: [], about: "zenod" });
    expect(shown).toEqual([[]]);
    expect(fast).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    // WhatsApp, Telegram and calls leave appChat off: their answers are unchanged.
    expect((await answerFromMemory(engine, "Who are you?")).about).toBeUndefined();
  });

  it("knows a question about Zenod from a question that only mentions it", () => {
    for (const q of ["who are you?", "Who are you", "what are you?", "What can you do?", "Zenod, what can you do for me?", "what is zenod?", "How do I add a memory?",
      "how do I use you?", "how does this work?", "¿Quién eres?", "qué puedes hacer"]) expect(isAboutZenod(q), q).toBe(true);
    for (const q of ["who are you meeting on Friday?", "what did I say about Zenod pricing?", "how do I make sourdough?", "what can you tell me about the Airbnb plan?",
      "how do I hedge the VIX trade?", "what were my top five topics last week?"]) expect(isAboutZenod(q), q).toBe(false);
  });

  it("shows no memory under the floor, and points at none when nothing is left", async () => {
    const engine = fakeEngine("alpha", { fast: async () => ({ checked: false, reason: "no_answer", text: "", cited: [] }) });
    engine.searchTimed = async () => ({ hits: weak([["Notes/a.md", 40], ["Notes/b.md", 15], ["Notes/c.md", 14], ["Notes/d.md", 9]]), tier: "index" as const, ms: 1 });
    const result = await answerFromMemory(engine, "the plumber", { appChat: true });
    expect(result.memories.map((m) => m.path)).toEqual(["Notes/a.md", "Notes/b.md"]);
    engine.searchTimed = async () => ({ hits: weak([["Notes/c.md", 14], ["Notes/d.md", 9]]), tier: "index" as const, ms: 1 });
    const none = await answerFromMemory(engine, "the plumber", { appChat: true });
    expect(none).toMatchObject({ answered: false, memories: [] });
    expect(none.answer).not.toContain("below");
    // Off the app chat, the list is as before.
    expect((await answerFromMemory(engine, "the plumber")).memories).toHaveLength(2);
  });

  it("never shows a family, health or money note on a weak match, unless the checked answer cites it", async () => {
    const hits = weak([["Notes/Product decks.md", 25, "Working memory › Zenod"], ["Areas/Family matters.md", 24, "Long-term memory › Family"],
      ["Notes/Blood test.md", 23, "Long-term memory › Health"], ["Notes/Roadmap.md", 22]]);
    const engine = fakeEngine("alpha", { fast: async () => ({ checked: false, reason: "no_answer", text: "", cited: [] }) });
    engine.searchTimed = async () => ({ hits, tier: "index" as const, ms: 1 });
    expect((await answerFromMemory(engine, "decks", { appChat: true })).memories.map((m) => m.path)).toEqual(["Notes/Product decks.md", "Notes/Roadmap.md"]);
    const strong = weak([["Areas/Family matters.md", 80, "Long-term memory › Family"]]);
    engine.searchTimed = async () => ({ hits: strong, tier: "index" as const, ms: 1 });
    expect((await answerFromMemory(engine, "family", { appChat: true })).memories).toHaveLength(1);
    const cites = fakeEngine("alpha", { fast: async () => ({ checked: true, reason: null, text: "Yes [2].", cited: [2] }) });
    cites.searchTimed = async () => ({ hits, tier: "index" as const, ms: 1 });
    expect((await answerFromMemory(cites, "decks", { appChat: true })).memories.find((m) => m.path === "Areas/Family matters.md")).toMatchObject({ cited: true });
  });

  it("tells sensitive notes by title, path and branch, not by their text", () => {
    expect(isSensitiveMemory({ title: "Family Estrangement", path: "Areas/x.md", treePath: "" })).toBe(true);
    expect(isSensitiveMemory({ title: "x", path: "Notes/x.md", treePath: "Working memory › Alpha9 Tax and AEAT" })).toBe(true);
    expect(isSensitiveMemory({ title: "Product and campaign decks", path: "Notes/Product and campaign decks.md", treePath: "Working memory › Zenod" })).toBe(false);
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
    return { runtimes, engines, ada, bob, eve: principal("eve"), call, cookieFor, layer, close };
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

  it("streams the chat as NDJSON: memories, text, then the answer, for the signed-in customer only (E12-S1b)", async () => {
    const t = await setup();
    try {
      expect((await t.call("POST", "/api/console/memory-chat/stream", undefined, { question: "notes" })).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-chat/stream", t.ada, { question: " " })).status).toBe(400);
      expect((await t.call("POST", "/api/console/memory-chat/stream", t.eve, { question: "notes" })).status).toBe(404);
      const engine = t.engines.get("tenant-a")!;
      engine.answerFromMemories = async (_q, _memories, onText) => {
        onText?.("From alpha one [1].");
        return { checked: true, reason: null, text: "From alpha one [1].", cited: [1] };
      };
      const response = await t.call("POST", "/api/console/memory-chat/stream", t.ada, { question: "notes" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
      expect(lines.map((line) => line.type)).toEqual(["memories", "text", "answer"]);
      expect(lines[0].memories).toHaveLength(5);
      expect(lines[1].text).toBe("From alpha one [1].");
      expect(lines[2].answer).toMatchObject({ answered: true, checkedBy: "quoted" });
      expect(lines[2].answer.memories[0]).toMatchObject({ path: "Notes/alpha 1.md", cited: true });
      expect(JSON.stringify(lines)).not.toContain("beta");
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it("stream: the allowance stops before any model call, and a cap hit mid-answer ends the stream with its reason", async () => {
    const t = await setup({ allowance: 1 });
    try {
      t.runtimes.get("tenant-a")!.usageStore.record({
        operation: "answer", provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1,
        cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 1.5,
      });
      const fast = vi.fn();
      t.engines.get("tenant-a")!.answerFromMemories = fast;
      const blocked = await t.call("POST", "/api/console/memory-chat/stream", t.ada, { question: "notes" });
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ code: "ai_allowance_exhausted" });
      expect(fast).not.toHaveBeenCalled();

      const resetsAt = "2026-12-01T00:00:00.000Z";
      t.engines.get("tenant-b")!.answerFromMemories = async () => { throw new LlmAllowanceExceededError(aiAllowanceExhaustedMessage(resetsAt), resetsAt); };
      const midway = await t.call("POST", "/api/console/memory-chat/stream", t.bob, { question: "notes" });
      const lines = (await midway.text()).trim().split("\n").map((line) => JSON.parse(line));
      expect(lines.map((line) => line.type)).toEqual(["memories", "error"]);
      expect(lines[1]).toMatchObject({ status: 429, code: "ai_allowance_exhausted", resetsAt });
      // The slot is released after a failed stream: the next question is answered.
      t.engines.get("tenant-b")!.answerFromMemories = async () => ({ checked: false, reason: "no_answer", text: "", cited: [] });
      for (let i = 0; i < 3; i++) {
        const next = await t.call("POST", "/api/console/memory-chat/stream", t.bob, { question: "notes" });
        expect(next.status).toBe(200);
        expect(await next.text()).toContain('"type":"answer"');
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
      // EPIC-14 S10: answers stop at the allowance, keeping does not; the question's words are kept too.
      const keep = await t.call("POST", "/api/console/memory-keep", t.ada, { content: "keep me" });
      expect(keep.status).toBe(202);
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(2);

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

  it("shows each customer only their own month's spend by feature, against the allowance (E14-S10)", async () => {
    const t = await setup({ allowance: 3 });
    try {
      const a = t.runtimes.get("tenant-a")!;
      a.usageStore.record({ operation: "classify", provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 0.9 });
      a.usageStore.record({ operation: "answer", provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 0.06 }, Date.now(), "personas");
      expect((await t.call("GET", "/api/console/usage")).status).toBe(401);
      const mine = await (await t.call("GET", "/api/console/usage", t.ada)).json() as { allowanceUsd: number; percentageUsed: number; features: Array<{ id: string; spentUsd: number; costs: string; atCap: string }> };
      expect(mine).toMatchObject({ allowanceUsd: 3, percentageUsed: 32 });
      expect(mine.features.map((feature) => feature.id)).toEqual(["filing", "chat", "personas", "desk", "calls"]);
      expect(mine.features.find((feature) => feature.id === "filing")).toMatchObject({ spentUsd: 0.9, atCap: expect.stringContaining("Never stops") });
      expect(mine.features.find((feature) => feature.id === "personas")!.spentUsd).toBeCloseTo(0.06);
      const bobs = await (await t.call("GET", "/api/console/usage", t.bob)).json() as { features: Array<{ spentUsd: number }> };
      expect(bobs.features.every((feature) => feature.spentUsd === 0)).toBe(true);
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

  // EPIC-16 E16-B1: the one Send button.
  const sendLines = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

  it("one Send: a statement is kept in the sender's own tenant, a question is answered and kept nowhere (E16-B1)", async () => {
    const t = await setup();
    try {
      expect((await t.call("POST", "/api/console/memory-send/stream", undefined, { message: "x" })).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: " " })).status).toBe(400);
      expect((await t.call("POST", "/api/console/memory-send/stream", t.eve, { message: "x" })).status).toBe(404);

      // No model route on this engine: the plain rules decide.
      const told = await sendLines(await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "Remember the gate code is 4411." }));
      expect(told.map((line) => line.type)).toEqual(["route", "kept", "done"]);
      expect(told[0].route).toMatchObject({ action: "keep", keep: "the gate code is 4411.", question: null, by: "rules" });
      expect(told[1].receipt).toMatchObject({ channel: "app" });
      const captures = t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50);
      expect(captures).toHaveLength(1);
      expect(t.runtimes.get("tenant-b")!.taskJobStore.recentCaptures(50)).toHaveLength(0);
      expect((await t.call("GET", `/api/console/memory-keep/${told[1].receipt.id}`, t.ada)).status).toBe(200);
      expect((await t.call("GET", `/api/console/memory-keep/${told[1].receipt.id}`, t.bob)).status).toBe(404);
      expect(t.engines.get("tenant-a")!.askCalls).toHaveLength(0);

      const asked = await sendLines(await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "Who fixes the boiler?" }));
      expect(asked.map((line) => line.type)).toEqual(["route", "memories", "answer", "done"]);
      expect(asked[0].route).toMatchObject({ action: "answer", keep: null, question: "Who fixes the boiler?" });
      expect(asked[2].answer.answer).toContain("alpha");
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("one Send: a mixed message keeps only the told part and answers the question; the model's route is guarded (E16-B1)", async () => {
    const t = await setup();
    try {
      const engine = t.engines.get("tenant-a")!;
      const enqueue = vi.spyOn(t.runtimes.get("tenant-a")!.taskJobQueue, "enqueue");
      engine.routeSend = async (message) => {
        const { parseSendRoute } = await import("zenod");
        // The model tries to keep the question too: the guard keeps only what was told.
        return parseSendRoute('{"keep": "Ana\'s new phone is 699 120 334. What did I say about her birthday?", "ask": "What did I say about her birthday?"}', message)!;
      };
      const lines = await sendLines(await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "Ana's new phone is 699 120 334. What did I say about her birthday?" }));
      expect(lines.map((line) => line.type)).toEqual(["route", "kept", "memories", "answer", "done"]);
      expect(lines[0].route).toMatchObject({ action: "both", keep: "Ana's new phone is 699 120 334.", question: "What did I say about her birthday?", by: "model" });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0]![1]).toEqual({ content: "Ana's new phone is 699 120 334.", source: "web" });
      expect(engine.askCalls).toEqual(["What did I say about her birthday?"]);

      // A failing model route falls back to the rules; a cap hit stops the send with its reason.
      engine.routeSend = async () => { throw new Error("model down"); };
      const fallback = await sendLines(await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "Where is the spare key?" }));
      expect(fallback[0].route).toMatchObject({ action: "answer", by: "rules" });
      const resetsAt = "2026-12-01T00:00:00.000Z";
      engine.routeSend = async () => { throw new LlmAllowanceExceededError(aiAllowanceExhaustedMessage(resetsAt), resetsAt); };
      const capped = await sendLines(await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "The shed is green." }));
      expect(capped.map((line) => line.type)).toEqual(["error"]);
      expect(capped[0]).toMatchObject({ status: 429, code: "ai_allowance_exhausted" });
      expect(enqueue).toHaveBeenCalledTimes(1);
    } finally {
      await t.close();
    }
  });

  it("one Send stops at the AI allowance before deciding anything (E16-B1)", async () => {
    const t = await setup({ allowance: 1 });
    try {
      t.runtimes.get("tenant-a")!.usageStore.record({
        operation: "answer", provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1,
        cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 1.5,
      });
      const route = vi.fn();
      t.engines.get("tenant-a")!.routeSend = route;
      const blocked = await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "The shed is green." });
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ message: expect.stringContaining("still kept") });
      expect(route).not.toHaveBeenCalled();
      // EPIC-14 S10: nothing is decided, but the words are kept as a note.
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("sends a recorded voice note into the tenant's media seam once, and shows its receipt only to them (E14-S1)", async () => {
    const t = await setup();
    try {
      const audio = Buffer.from("OggS fake opus voice note bytes");
      const send = async (user: CustomerPrincipal | undefined, body: Buffer, type = "audio/webm;codecs=opus", seconds = "4.20") =>
        t.layer.app.request("/api/console/voice-note", {
          method: "POST",
          headers: { ...(user ? { cookie: await t.cookieFor(user) } : {}), "content-type": type, "x-seconds": seconds },
          body,
        });
      expect((await send(undefined, audio)).status).toBe(401);
      expect((await send(t.ada, audio, "text/plain")).status).toBe(415);
      expect((await send(t.ada, Buffer.alloc(0))).status).toBe(400);
      expect((await send(t.ada, Buffer.alloc(VOICE_NOTE_MAX_BYTES + 1))).status).toBe(413);
      expect((await send(t.eve, audio)).status).toBe(404);

      const enqueue = vi.spyOn(t.runtimes.get("tenant-a")!.taskJobQueue, "enqueue");
      const sent = await send(t.ada, audio);
      expect(sent.status).toBe(202);
      const receipt = await sent.json();
      expect(receipt).toMatchObject({ channel: "app", kind: "voice", channelLabel: "Zenod app" });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0]![0]).toBe("media_ingest");
      expect(enqueue.mock.calls[0]![1]).toMatchObject({
        mediaType: "audio",
        contentType: "voice_note",
        bytesRef: `data:audio/webm;base64,${audio.toString("base64")}`,
        filename: expect.stringMatching(/^zenod-app-voice-note-.+\.webm$/),
        sourceHint: "Zenod app voice note",
        source: "web",
        audioDurationSeconds: 4.2,
      });
      expect(enqueue.mock.calls[0]![2]).toMatch(/^tenant-a:web-voice:[0-9a-f]{32}$/);

      // iPhone Safari records AAC in mp4.
      const iphone = await (await send(t.ada, Buffer.from("ftypM4A fake aac"), "audio/mp4")).json();
      expect(enqueue.mock.calls[1]![1]).toMatchObject({ filename: expect.stringMatching(/\.m4a$/) });

      // A retried upload files it once.
      const again = await (await send(t.ada, audio)).json();
      expect(again.id).toBe(receipt.id);
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(2);
      expect(t.runtimes.get("tenant-b")!.taskJobStore.recentCaptures(50)).toHaveLength(0);

      expect((await t.call("GET", `/api/console/voice-note/${iphone.id}`, t.ada)).status).toBe(200);
      expect((await t.call("GET", `/api/console/voice-note/${receipt.id}`, t.bob)).status).toBe(404);
      expect((await t.call("GET", `/api/console/voice-note/${receipt.id}`)).status).toBe(401);
      // A Keep's id is not a voice note.
      const kept = await (await t.call("POST", "/api/console/memory-keep", t.ada, { content: "typed" })).json();
      expect((await t.call("GET", `/api/console/voice-note/${kept.id}`, t.ada)).status).toBe(404);
    } finally {
      await t.close();
    }
  });

  it("still takes a voice note at the AI allowance: capture is always kept (E14-S1, E14-S10)", async () => {
    const t = await setup({ allowance: 0.01 });
    try {
      t.runtimes.get("tenant-a")!.usageStore.record({
        operation: "answer", provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1,
        cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 1,
      });
      const blocked = await t.layer.app.request("/api/console/voice-note", {
        method: "POST",
        headers: { cookie: await t.cookieFor(t.ada), "content-type": "audio/webm" },
        body: Buffer.from("audio"),
      });
      expect(blocked.status).toBe(202);
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(50)).toHaveLength(1);
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
