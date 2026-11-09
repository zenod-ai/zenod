import { afterEach, expect, it, vi } from "vitest";
import { createBrainLlm, LlmAllowanceExceededError, type LlmUsageReport } from "../src/llm/aisdk.js";
import { withBackgroundRoute } from "../src/llm/backgroundRoute.js";
import { deepseekCostUsd, isDeepseekPeak } from "../src/llm/deepseek.js";
import type { BrainLlm } from "../src/llm/types.js";

// EPIC-14 S10 round 4: hosted background work on DeepSeek's own API. Every call is stubbed; zero spend.
const classified = { passageReviews: [], topics: [{ topic: "Synthetic", facts: [], evidenceQuotes: ["Synthetic proposition."], evidenceAssignments: [], confidence: 1, disposition: "evidence_only", pages: [], summary: "Synthetic", question: null }], disposition: "evidence_only", confidence: 1, summary: "Synthetic", tags: [], pages: [], question: null };
const classifyInput = { content: "Synthetic proposition.", context: "", pageIndex: [], hints: [], tagVocabulary: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function deepseekTransport(usage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 100, total_tokens: 1100 }) {
  const requests: Array<{ url: string; body: any; auth: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url: String(url), body, auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({ id: "offline", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(classified) }, finish_reason: "stop" }], usage }), { headers: { "content-type": "application/json" } });
  }));
  return requests;
}

it("prices DeepSeek calls at the published rate, double in peak hours", () => {
  // Saturday 2026-11-07 08:00 UTC is off-peak; Monday 2026-11-09 08:00 UTC is peak.
  expect(isDeepseekPeak(Date.UTC(2026, 10, 7, 8))).toBe(false);
  expect(isDeepseekPeak(Date.UTC(2026, 10, 9, 8))).toBe(true);
  expect(isDeepseekPeak(Date.UTC(2026, 10, 9, 5))).toBe(false);
  const offPeak = deepseekCostUsd({ model: "deepseek-flash", hitTokens: 1_000_000, missTokens: 1_000_000, outputTokens: 1_000_000, at: Date.UTC(2026, 10, 7, 8) });
  expect(offPeak).toBeCloseTo(0.003 + 0.15 + 0.6, 9);
  expect(deepseekCostUsd({ model: "deepseek-flash", hitTokens: 1_000_000, missTokens: 1_000_000, outputTokens: 1_000_000, at: Date.UTC(2026, 10, 9, 8) })).toBeCloseTo(offPeak * 2, 9);
  expect(deepseekCostUsd({ model: "deepseek-v4-pro", hitTokens: 0, missTokens: 1_000_000, outputTokens: 0, at: Date.UTC(2026, 10, 7, 8) })).toBeCloseTo(0.66, 9);
});

it("sends filing to api.deepseek.com with the tenant as user_id, thinking off for effort none, and records the priced usage", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const requests = deepseekTransport();
  const reports: LlmUsageReport[] = [];
  const llm = createBrainLlm({ provider: "deepseek", apiKey: "offline-unused", user: "tenant-1", organizerReasoningEffort: "none", onUsage: (report) => reports.push(report) });
  await llm.classify(classifyInput);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe("https://api.deepseek.com/chat/completions");
  expect(requests[0]!.auth).toBe("Bearer offline-unused");
  expect(requests[0]!.body.model).toBe("deepseek-flash");
  expect(requests[0]!.body.user_id).toBe("tenant-1");
  expect(requests[0]!.body.thinking).toEqual({ type: "disabled" });
  expect(requests[0]!.body).not.toHaveProperty("reasoning_effort");
  // DeepSeek takes json_object only; the schema travels in the system prompt (S11: json_schema was refused in production).
  expect(requests[0]!.body.response_format).toEqual({ type: "json_object" });
  const system = requests[0]!.body.messages.find((message: { role: string }) => message.role === "system");
  expect(system.content).toMatch(/Reply with one json object only[\s\S]*"topics"/);
  expect(reports).toHaveLength(1);
  expect(reports[0]!.provider).toBe("deepseek");
  expect(reports[0]!.operation).toBe("classify");
  expect(reports[0]!.providerCostUsd).toBeCloseTo((800 * 0.003 + 200 * 0.15 + 100 * 0.6) / 1_000_000, 12);
});

function fakeLlm(name: string, calls: string[], failWith?: unknown): BrainLlm {
  const run = (method: string) => async () => {
    calls.push(`${name}.${method}`);
    if (failWith) throw failWith;
    return method === "composePage" ? "page" : method === "answer" ? { answer: name } : {};
  };
  return {
    classify: run("classify"), composePage: run("composePage"), reconcile: run("reconcile"), describeImage: run("describeImage"),
    answer: run("answer"), work: run("work"), extractBacklog: run("extractBacklog"), streamMemoryChat: run("streamMemoryChat"),
  } as unknown as BrainLlm;
}

it("routes filing and desk work to the background model and keeps answers, chat and images on the primary", async () => {
  const calls: string[] = [];
  const llm = withBackgroundRoute(fakeLlm("openrouter", calls), fakeLlm("deepseek", calls), { filing: true, desk: true });
  await llm.classify(classifyInput as any);
  await llm.composePage({} as any);
  await llm.reconcile!({} as any);
  await llm.extractBacklog({} as any);
  await llm.work({} as any, {} as any);
  await llm.answer({} as any, {} as any);
  await llm.streamMemoryChat!({ system: "", prompt: "" }, () => {});
  await llm.describeImage(new Uint8Array(), "image/png");
  expect(calls).toEqual([
    "deepseek.classify", "deepseek.composePage", "deepseek.reconcile", "deepseek.extractBacklog", "deepseek.work",
    "openrouter.answer", "openrouter.streamMemoryChat", "openrouter.describeImage",
  ]);
});

it("a job set to openrouter stays there", async () => {
  const calls: string[] = [];
  const llm = withBackgroundRoute(fakeLlm("openrouter", calls), fakeLlm("deepseek", calls), { filing: true, desk: false });
  await llm.work({} as any, {} as any);
  await llm.classify(classifyInput as any);
  expect(calls).toEqual(["openrouter.work", "deepseek.classify"]);
});

it("falls back to OpenRouter on any DeepSeek failure, and parks DeepSeek for the cool-down when its balance is gone", async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  let now = 1_000;
  const noBalance = Object.assign(new Error("Insufficient Balance"), { statusCode: 402 });
  const llm = withBackgroundRoute(fakeLlm("openrouter", calls), fakeLlm("deepseek", calls, noBalance), { filing: true, desk: true, now: () => now, onFallback: (event) => events.push(event) });
  await llm.classify(classifyInput as any);
  await llm.classify(classifyInput as any);
  now += 10 * 60_000 + 1;
  await llm.classify(classifyInput as any);
  expect(calls).toEqual(["deepseek.classify", "openrouter.classify", "openrouter.classify", "deepseek.classify", "openrouter.classify"]);
  expect(events).toEqual([{ method: "classify", status: 402, parked: true }, { method: "classify", status: 402, parked: true }]);

  const transient: string[] = [];
  const overloaded = Object.assign(new Error("Server Overloaded"), { statusCode: 503 });
  const retried = withBackgroundRoute(fakeLlm("openrouter", transient), fakeLlm("deepseek", transient, overloaded), { filing: true, desk: true });
  await retried.classify(classifyInput as any);
  await retried.classify(classifyInput as any);
  expect(transient).toEqual(["deepseek.classify", "openrouter.classify", "deepseek.classify", "openrouter.classify"]);
});

it("never falls back past a used-up AI allowance: caps hold on both routes", async () => {
  const calls: string[] = [];
  const llm = withBackgroundRoute(fakeLlm("openrouter", calls), fakeLlm("deepseek", calls, new LlmAllowanceExceededError("used up")), { filing: true, desk: true });
  await expect(llm.classify(classifyInput as any)).rejects.toThrow("used up");
  expect(calls).toEqual(["deepseek.classify"]);
});

it("sends the memory desk agent's calls to the background model, falls back on failure, and keeps them on chat when desk is not routed (S11)", async () => {
  const calls: string[] = [];
  const routed = withBackgroundRoute(fakeLlm("openrouter", calls), fakeLlm("deepseek", calls), { filing: true, desk: true });
  await routed.streamBackgroundChat!({ system: "", prompt: "" }, () => {});
  await routed.streamMemoryChat!({ system: "", prompt: "" }, () => {});
  expect(calls).toEqual(["deepseek.streamMemoryChat", "openrouter.streamMemoryChat"]);

  const kept: string[] = [];
  const off = withBackgroundRoute(fakeLlm("openrouter", kept), fakeLlm("deepseek", kept), { filing: true, desk: false });
  await off.streamBackgroundChat!({ system: "", prompt: "" }, () => {});
  expect(kept).toEqual(["openrouter.streamMemoryChat"]);

  const fell: string[] = [];
  const events: unknown[] = [];
  const noBalance = Object.assign(new Error("Insufficient Balance"), { statusCode: 402 });
  const failing = withBackgroundRoute(fakeLlm("openrouter", fell), fakeLlm("deepseek", fell, noBalance), { filing: true, desk: true, onFallback: (event) => events.push(event) });
  await failing.streamBackgroundChat!({ system: "", prompt: "" }, () => {});
  await failing.streamBackgroundChat!({ system: "", prompt: "" }, () => {});
  expect(fell).toEqual(["deepseek.streamMemoryChat", "openrouter.streamMemoryChat", "openrouter.streamMemoryChat"]);
  expect(events).toEqual([{ method: "streamBackgroundChat", status: 402, parked: true }]);
});

it("records each provider call's wall time with its usage (S11)", async () => {
  deepseekTransport();
  const reports: LlmUsageReport[] = [];
  const llm = createBrainLlm({ provider: "deepseek", apiKey: "offline-unused", onUsage: (report) => reports.push(report) });
  await llm.classify(classifyInput);
  expect(reports).toHaveLength(1);
  expect(typeof reports[0]!.latencyMs).toBe("number");
  expect(reports[0]!.latencyMs).toBeGreaterThanOrEqual(0);
});

it("keeps the provider status when a filing step wraps the DeepSeek error, so the fallback log names it (S11)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "This response_format type is unavailable now", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } })));
  const deepseek = createBrainLlm({ provider: "deepseek", apiKey: "offline-unused" });
  const calls: string[] = [];
  const events: Array<{ method: string; status: number | null; parked: boolean }> = [];
  const llm = withBackgroundRoute(fakeLlm("openrouter", calls), deepseek, { filing: true, desk: true, onFallback: (event) => events.push(event) });
  await llm.classify(classifyInput as any);
  expect(calls).toEqual(["openrouter.classify"]);
  expect(events).toEqual([{ method: "classify", status: 400, parked: false }]);
});

it("puts back null keys DeepSeek's JSON mode leaves out, so a filing reconcile validates (S11)", async () => {
  const replies = [
    // A clarify and an add with every null key omitted, as DeepSeek returned in production.
    { operations: [
      { kind: "clarify", ideaIds: ["idea-1"], sourceIds: ["s1"], sourceQuote: "The yard starts in March." },
      { kind: "add", ideaIds: ["idea-1"], sourceIds: ["c1"], sourceQuote: "-", reason: "same subject" },
    ] },
  ];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "offline", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(replies.shift()) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: { "content-type": "application/json" } });
  }));
  const llm = createBrainLlm({ provider: "deepseek", apiKey: "offline-unused", onUsage: () => {} });
  const operations = await llm.reconcile!({
    path: "Projects/Boat.md", revision: null, contextPartial: false, statements: [],
    sources: [{ id: "s1", text: "The yard starts in March." }] as any,
    addCandidates: [{ id: "c1", text: "The yard starts in March." }] as any,
    ideas: [{ id: "idea-1", topic: "Yard start", sourceIds: ["s1"] }] as any,
  });
  expect(operations).toEqual([
    { kind: "clarify", ideaIds: ["idea-1"], sourceIds: ["s1"], sourceQuote: "The yard starts in March.", targetId: null, correctionQuote: null, factKey: null, reason: null },
    { kind: "add", ideaIds: ["idea-1"], sourceIds: ["c1"], sourceQuote: "-", targetId: null, correctionQuote: null, factKey: null, reason: "same subject" },
  ]);
});

it("fills only keys whose schema allows null, and picks the union branch by its kind (S11)", async () => {
  const { fillMissingNulls } = await import("../src/llm/aisdk.js");
  const schema = { type: "object", properties: { items: { type: "array", items: { anyOf: [
    { type: "object", properties: { kind: { const: "a" }, x: { type: ["string", "null"] }, y: { type: "string" } } },
    { type: "object", properties: { kind: { const: "b" }, z: { anyOf: [{ type: "number" }, { type: "null" }] } } },
  ] } } } };
  expect(fillMissingNulls({ items: [{ kind: "a" }, { kind: "b" }, { kind: "c" }] }, schema)).toEqual({ items: [{ kind: "a", x: null }, { kind: "b", z: null }, { kind: "c" }] });
});
