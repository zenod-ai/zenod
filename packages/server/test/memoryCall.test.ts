import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmUsageReport } from "zenod";
import {
  CALL_CAP_USD,
  CALL_KEY_ENV,
  CALL_MAX_S,
  CallMeter,
  CallStore,
  callKey,
  PLATFORM_MONTH_CAP_USD,
  platformMeter,
  costOf,
  createMemoryCall,
  MONTH_CAP_USD,
  NOT_SWITCHED_ON,
  openAiMinter,
  sessionConfig,
  spokenAnswer,
  tokensOfResponse,
  transcriptMemory,
  type CallTenant,
  type Minter,
} from "../src/memoryCall.js";
import { registerMemoryCallRoutes } from "../src/memoryCallRoutes.js";
import { estimateCostUsd } from "../src/usageStore.js";

// A recorded Realtime `response.done` usage (shape from gpt-realtime-2.1-mini, agent_team E42-S12).
const RESPONSE_USAGE = {
  total_tokens: 2210,
  input_tokens: 1900,
  output_tokens: 310,
  input_token_details: { text_tokens: 1500, audio_tokens: 400, cached_tokens: 1024, cached_tokens_details: { text_tokens: 1024, audio_tokens: 0 } },
  output_token_details: { text_tokens: 60, audio_tokens: 250 },
};
const TRANSCRIPTION_USAGE = { type: "tokens", input_tokens: 120, output_tokens: 18 };

let dir: string;
let clock: Date;
let store: CallStore;
let recorded: LlmUsageReport[];
let kept: string[];
let jobs: string[];
let block: { message: string } | null;

const tenant = (over: Partial<CallTenant> = {}): CallTenant => ({
  allowanceBlock: () => block,
  answer: async (question) =>
    question.includes("plumber")
      ? { answered: true, answer: "Ana the plumber fixed the **boiler** on 6 October [1]. See [[Areas/Boiler.md]].", sources: ["Boiler", "House"] }
      : { answered: false, answer: "No memory matches this question yet.", sources: [] },
  deskJob: (job) => {
    jobs.push(job);
    return { id: "inbox-1", title: "Split Boat repair and Cabin decision" };
  },
  keep: (content) => {
    kept.push(content);
    return { id: `job-${kept.length}` };
  },
  record: (report) => recorded.push(report),
  ...over,
});

const mint: Minter = async () => ({ value: "ek_stub_client_secret", expires_at: 1_900_000_000, session: { id: "sess_stub" } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zenod-call-"));
  clock = new Date("2026-11-08T21:00:00Z");
  store = new CallStore(join(dir, "calls.sqlite"), () => clock);
  recorded = [];
  kept = [];
  jobs = [];
  block = null;
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the call button without Zenod's own key", () => {
  it("says calls are not switched on yet and refuses to start", async () => {
    const call = createMemoryCall({ store, tenant: tenant(), key: undefined });
    expect(call.state()).toMatchObject({ available: false, code: "not_switched_on", message: NOT_SWITCHED_ON });
    await expect(call.start()).rejects.toMatchObject({ status: 503, code: "not_switched_on" });
  });

  it("reads only its own env name, never another app's OpenAI key", () => {
    expect(CALL_KEY_ENV).toBe("OPENAI_REALTIME_KEY");
    expect(callKey({ OPENAI_API_KEY: "sk-other-app" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(callKey({ OPENAI_REALTIME_KEY: "  " } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(callKey({ OPENAI_REALTIME_KEY: "sk-zenod" } as NodeJS.ProcessEnv)).toBe("sk-zenod");
  });
});

describe("a stubbed call end to end", () => {
  it("mints a 1-minute key with the hotline's tools, answers both tools, meters usage into the ledger, and keeps only on Keep", async () => {
    const call = createMemoryCall({ store, tenant: tenant(), key: "sk-zenod", mint });
    expect(call.state()).toMatchObject({ available: true, month: { spentUsd: 0, capUsd: MONTH_CAP_USD }, active: null });

    const started = await call.start();
    expect(started.clientSecret).toBe("ek_stub_client_secret");
    expect(started.model).toBe("gpt-realtime-2.1-mini");
    expect(started.greeting).toMatch(/library line/);
    const id = started.call.id;
    await expect(call.start()).rejects.toMatchObject({ code: "one_call" });

    // The voice asks the answer engine: plain spoken words, citations and links stripped.
    const asked = await call.tool(id, "ask_memory", { question: "What did the plumber fix?" });
    expect(asked.output).toEqual({ answered: true, answer: "Ana the plumber fixed the boiler on 6 October. See Boiler.", from: ["Boiler", "House"] });
    const none = await call.tool(id, "ask_memory", { question: "What is my cat called?" });
    expect(none.output).toMatchObject({ answered: false });

    // A spoken job goes to the memory desk and returns at once.
    const job = await call.tool(id, "desk_job", { job: "Split Boat repair and the cabin decision into two topics" });
    expect(job.output).toMatchObject({ started: true, title: "Split Boat repair and Cabin decision" });
    expect(jobs).toEqual(["Split Boat repair and the cabin decision into two topics"]);

    // Usage: each event once, priced from the API's numbers, recorded on the tenant's ledger.
    clock = new Date(clock.getTime() + 45_000);
    const u1 = call.usage(id, { eventId: "evt_1", kind: "response", usage: RESPONSE_USAGE });
    const again = call.usage(id, { eventId: "evt_1", kind: "response", usage: RESPONSE_USAGE });
    call.usage(id, { eventId: "evt_2", kind: "transcription", usage: TRANSCRIPTION_USAGE });
    const expected = costOf("gpt-realtime-2.1-mini", tokensOfResponse(RESPONSE_USAGE));
    expect(u1.call.costUsd).toBeCloseTo(expected, 6);
    expect(again.call.costUsd).toBeCloseTo(expected, 6);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ operation: "call", provider: "openai", model: "gpt-realtime-2.1-mini" });
    expect(recorded[1]).toMatchObject({ operation: "call", model: "gpt-4o-mini-transcribe" });
    // The ledger prices a call row from its own estimate (it counts against the AI allowance).
    expect(estimateCostUsd(recorded[0]!)).toBeCloseTo(expected, 6);
    expect(recorded.reduce((s, r) => s + estimateCostUsd(r), 0)).toBeCloseTo(call.state().month.spentUsd, 6);

    // Hang up: the transcript is stored, nothing is kept yet.
    const ended = call.end(id, {
      reason: "bye",
      transcript: [
        { who: "zenod", text: "Hi, this is your Zenod library line. What would you like to know?" },
        { who: "you", text: "What did the plumber fix?" },
        { who: "tool", text: "Asked your memory" },
        { who: "zenod", text: "Ana fixed the boiler on 6 October." },
      ],
    });
    expect(ended.call).toMatchObject({ endReason: "bye", asks: 2, jobs: 1, hasTranscript: true, keptJobId: null });
    expect(kept).toEqual([]);

    const kept1 = call.keep(id);
    const kept2 = call.keep(id);
    expect(kept1.jobId).toBe("job-1");
    expect(kept2.jobId).toBe("job-1");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain("Call with my Zenod library line, 2026-11-08 21:00 UTC");
    expect(kept[0]).toContain("Me: What did the plumber fix?");
    expect(kept[0]).not.toContain("Asked your memory");
  });

  it("rejects tools after the hang-up and unknown tools", async () => {
    const call = createMemoryCall({ store, tenant: tenant(), key: "sk-zenod", mint });
    const { call: c } = await call.start();
    await expect(call.tool(c.id, "rm_rf", {})).rejects.toMatchObject({ code: "unknown_tool" });
    call.end(c.id, { reason: "hangup" });
    await expect(call.tool(c.id, "ask_memory", { question: "x" })).rejects.toMatchObject({ code: "call_ended" });
    expect(() => call.keep(c.id)).toThrow(/Nothing you said/);
  });
});

describe("the caps", () => {
  const big = (audioOut: number) => ({ input_token_details: { text_tokens: 0, audio_tokens: 0 }, output_token_details: { text_tokens: 0, audio_tokens: audioOut } });

  it("stops a call at its per-call cap and at ten minutes", async () => {
    const call = createMemoryCall({ store, tenant: tenant(), key: "sk-zenod", mint });
    const { call: c } = await call.start();
    // 25k audio-out tokens at $20/M = $0.50: the per-call cap.
    expect(call.usage(c.id, { eventId: "e1", kind: "response", usage: big(24_000) }).stop).toBeUndefined();
    expect(call.usage(c.id, { eventId: "e2", kind: "response", usage: big(1_000) }).stop).toBe("call_cap");
    expect(CALL_CAP_USD).toBe(0.5);
    call.end(c.id, { reason: "call_cap" });
    const { call: d } = await call.start();
    clock = new Date(clock.getTime() + CALL_MAX_S * 1000);
    expect(call.beat(d.id).stop).toBe("call_limit");
  });

  it("refuses a new call once the month's calls reach the cap, and when the AI allowance is used up", async () => {
    const call = createMemoryCall({ store, tenant: tenant(), key: "sk-zenod", mint });
    for (let i = 0; i < 2; i++) {
      const { call: c } = await call.start();
      call.usage(c.id, { eventId: "e", kind: "response", usage: big(24_000) });
      call.end(c.id, { reason: "hangup" });
    }
    expect(call.state()).toMatchObject({ available: false, code: "month_cap" });
    await expect(call.start()).rejects.toMatchObject({ status: 429, code: "month_cap" });
    // Next month opens again.
    clock = new Date("2026-12-01T00:00:01Z");
    expect(call.state().available).toBe(true);
    block = { message: "Your AI allowance for this month is used up." };
    expect(call.state()).toMatchObject({ available: false, code: "ai_allowance_exhausted" });
  });

  it("closes a call whose page went quiet as lost, so the next one can start", async () => {
    const call = createMemoryCall({ store, tenant: tenant(), key: "sk-zenod", mint });
    const { call: c } = await call.start();
    clock = new Date(clock.getTime() + 4 * 60_000);
    const next = await call.start();
    expect(next.call.id).not.toBe(c.id);
    expect(store.view(store.row(c.id)!).endReason).toBe("lost");
  });
});

describe("Zenod's own meter across accounts (E14-A3: the shared key)", () => {
  it("logs each call's cost under app zenod and stops all calls at $10 a month", async () => {
    const meter = new CallMeter(join(dir, "call-meter.sqlite"), () => clock);
    // Another app's row in the same meter never counts against Zenod's stop.
    meter.set("console_1", "alpha9", "2026-11-08T10:00:00.000Z", 50, "agent-team-console");
    const call = createMemoryCall({ store, tenant: tenant(), key: "sk-zenod", mint, platform: platformMeter(meter, "tenant-a"), tenantId: "tenant-a" });
    const { call: c } = await call.start();
    call.usage(c.id, { eventId: "e1", kind: "response", usage: RESPONSE_USAGE });
    call.end(c.id, { reason: "bye" });
    const cost = store.view(store.row(c.id)!).costUsd;
    expect(meter.month()).toEqual([
      { app: "agent-team-console", tenantId: "alpha9", calls: 1, costUsd: 50 },
      { app: "zenod", tenantId: "tenant-a", calls: 1, costUsd: cost },
    ]);
    expect(meter.monthUsd()).toBeCloseTo(cost, 6);

    // Other accounts' calls reach the platform's month stop: no new call for anyone, a live one hangs up.
    const { call: d } = await call.start();
    meter.set("call_other", "tenant-b", "2026-11-08T11:00:00.000Z", PLATFORM_MONTH_CAP_USD);
    expect(call.beat(d.id).stop).toBe("platform_cap");
    call.end(d.id, { reason: "platform_cap" });
    expect(call.state()).toMatchObject({ available: false, code: "platform_cap" });
    await expect(call.start()).rejects.toMatchObject({ code: "platform_cap" });
    meter.close();
  });
});

describe("minting the client key", () => {
  it("posts the session to OpenAI's client-secret endpoint with Zenod's key", async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ value: "ek_1", expires_at: 1 }), { status: 200 }));
    const minted = await openAiMinter("sk-zenod", "http://127.0.0.1:9/", fetchStub as unknown as typeof fetch)(sessionConfig());
    expect(minted.value).toBe("ek_1");
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9/v1/realtime/client_secrets");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-zenod");
    const sent = JSON.parse(String(init.body));
    expect(sent.expires_after.seconds).toBe(60);
    expect(sent.session.tools.map((t: { name: string }) => t.name)).toEqual(["ask_memory", "desk_job", "hang_up"]);
  });

  it("says plainly when the account has no credit", async () => {
    const fetchStub = async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "no credit" } }), { status: 429 });
    await expect(openAiMinter("sk", "http://x", fetchStub as unknown as typeof fetch)(sessionConfig())).rejects.toMatchObject({ code: "no_credit" });
  });
});

describe("the routes", () => {
  it("serve the button's state and a call for the resolved tenant only", async () => {
    const app = new Hono();
    let key: string | undefined;
    registerMemoryCallRoutes(app, async (c) => (c.req.header("x-user") ? { store, tenant: tenant() } : { response: c.json({ error: "unauthorized" }, 401) }), {
      key: () => key,
      minter: () => mint,
    });
    const get = (path: string, init?: RequestInit, user = true) => app.request(path, { ...init, headers: { ...(user ? { "x-user": "u" } : {}), "content-type": "application/json" } });

    expect((await get("/api/console/call", undefined, false)).status).toBe(401);
    expect(await (await get("/api/console/call")).json()).toMatchObject({ available: false, code: "not_switched_on" });
    expect((await get("/api/console/call/start", { method: "POST" })).status).toBe(503);

    key = "sk-zenod";
    const start = (await (await get("/api/console/call/start", { method: "POST" })).json()) as { call: { id: string }; clientSecret: string };
    expect(start.clientSecret).toBe("ek_stub_client_secret");
    const id = start.call.id;
    const tool = await get(`/api/console/call/${id}/tool`, { method: "POST", body: JSON.stringify({ name: "ask_memory", arguments: { question: "what did the plumber fix" } }) });
    expect(await tool.json()).toMatchObject({ output: { answered: true } });
    const usage = await get(`/api/console/call/${id}/usage`, { method: "POST", body: JSON.stringify({ eventId: "e1", kind: "response", usage: RESPONSE_USAGE }) });
    expect(((await usage.json()) as { call: { costUsd: number } }).call.costUsd).toBeGreaterThan(0);
    expect((await get(`/api/console/call/${id}/usage`, { method: "POST", body: JSON.stringify({ eventId: "e2" }) })).status).toBe(400);
    await get(`/api/console/call/${id}/end`, { method: "POST", body: JSON.stringify({ reason: "bye", transcript: [{ who: "you", text: "thanks" }] }) });
    const keep = await get(`/api/console/call/${id}/keep`, { method: "POST" });
    expect(keep.status).toBe(202);
    expect((await get(`/api/console/call/nope/beat`, { method: "POST" })).status).toBe(404);
  });
});

describe("words", () => {
  it("reads answers as plain speech and writes the kept memory in the user's voice", () => {
    expect(spokenAnswer("See [[Projects/Cabin decision.md|the cabin]] and [two](https://x) **now** [2]")).toBe("See the cabin and two now");
    const memory = transcriptMemory(
      { id: "call_1", startedAt: "2026-11-08T21:00:00.000Z", lastBeatAt: "", endedAt: "2026-11-08T21:01:05.000Z", endReason: "bye", model: "m", seconds: 65, costUsd: 0.01, asks: 0, jobs: 0, hasTranscript: true, keptJobId: null },
      [{ who: "you", text: "hello" }, { who: "zenod", text: "hi" }],
    );
    expect(memory).toBe("Call with my Zenod library line, 2026-11-08 21:00 UTC, 1 min 05 s.\n\nMe: hello\nZenod: hi");
  });
});
