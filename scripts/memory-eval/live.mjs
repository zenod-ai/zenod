// E15-Q3: the live tier of the memory test suite. Real model calls on DeepSeek's own API, the same
// client production builds for its background route (createBrainLlm, provider "deepseek"), so filing
// and answers are judged by a real model instead of the stand-in (organiser.mjs).
//
// Three guards keep it cheap:
//   cache        every call is stored by a hash of what was sent; a rerun on unchanged input replays
//                the stored reply and costs nothing. Random parts (anchors, dates, clock times, page revisions)
//                are replaced by placeholders before hashing and swapped back on replay.
//   run cap      no new call starts once this run's spend plus what is in flight could pass the cap.
//   month cap    the same against everything the live tier spent this calendar month (ledger file).
// A refused call throws LiveCapError: the test it belongs to counts as not run, never as passed.
//
// The cache holds what was sent and returned, so it lives beside the person's private set (VPS3 only).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class LiveCapError extends Error {
  constructor(message) { super(message); this.name = "LiveCapError"; }
}

/** Upper bound for one call not yet priced, so parallel calls cannot jointly pass a cap. */
const RESERVE_USD = 0.01;

const PATTERNS = [
  [/\be-[0-9a-f]{6}\b/g, "A"],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "T"],
  [/\b\d{4}-\d{2}-\d{2}\b/g, "D"],
  [/\/tmp\/zenod-memory-[\w-]+/g, "P"],
  // The answer prompt carries "today, now HH:MM UTC" and the weekday: a rerun minutes or days later is the same question.
  [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "H"],
  [/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g, "W"],
  // Page revisions are content hashes: a page an earlier note of this run wrote to gets a new one each run.
  [/\b[0-9a-f]{64}\b/g, "R"],
];

/**
 * Replace run-specific tokens by numbered placeholders, one per occurrence, so two values that happen to
 * be equal in one run (the clock time and a time in a memory) do not change the numbering in the next.
 * With `known` (a reply), only values already seen in what was sent are replaced, by their first
 * placeholder; anything else stays literal.
 */
export function normalise(text, tokens = [], known = false) {
  let out = text;
  for (const [re, tag] of PATTERNS) {
    out = out.replace(re, (m) => {
      if (known) { const i = tokens.indexOf(m); return i < 0 ? m : `\u27e6${tokens.tags[i]}${i}\u27e7`; }
      tokens.push(m);
      (tokens.tags ??= []).push(tag);
      return `\u27e6${tag}${tokens.length - 1}\u27e7`;
    });
  }
  return { text: out, tokens };
}

export function restore(text, tokens) {
  return text.replace(/⟦[ATDPHWR](\d+)⟧/g, (m, i) => tokens[Number(i)] ?? m);
}

const stable = (value) => JSON.stringify(value, (_, v) => (typeof v === "function" || v instanceof Uint8Array ? undefined : v));

function monthSpent(ledger, now = new Date()) {
  if (!existsSync(ledger)) return 0;
  const month = now.toISOString().slice(0, 7);
  return readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => String(r.at).startsWith(month)).reduce((s, r) => s + (Number(r.usd) || 0), 0);
}

/**
 * Wrap a real BrainLlm with the cache and caps. `make(onUsage)` builds the real client; it is only
 * called when a call misses the cache.
 */
export class LiveModel {
  constructor({ make, model, dir, runCapUsd, monthCapUsd, runId }) {
    this.model = model;
    this.dir = dir;
    this.cacheDir = join(dir, "cache");
    this.ledger = join(dir, "spend.jsonl");
    this.runCapUsd = runCapUsd;
    this.monthCapUsd = monthCapUsd;
    this.runId = runId;
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    this.monthBefore = monthSpent(this.ledger);
    this.spentUsd = 0;
    this.inflight = 0;
    this.replayedMs = 0;
    this.calls = { live: 0, cached: 0, refused: 0, failed: 0 };
    this.byMethod = {};
    this.failures = {};
    this.lastAnswerPrompt = null;
    this.lastAnswerTokens = null;
    this.lastAnswerText = null;
    this.real = null;
    this.make = make;
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target || typeof prop !== "string") return Reflect.get(target, prop, receiver);
        // Only what the real client has, so optional seams (reconcile, streamMemoryChat) look the same to the engine.
        if (typeof target.client()[prop] !== "function") return undefined;
        return (...args) => target.call(prop, args);
      },
    });
  }

  client() {
    if (!this.real) {
      this.real = this.make((report) => {
        // Reports can land after the call returns (stream usage is read from a copy), so spend is
        // counted here, as each report arrives, and written to the month ledger at once.
        const usd = Number(report.providerCostUsd ?? report.estimatedCostUsd ?? 0) || 0;
        if (usd <= 0) return;
        this.spentUsd += usd;
        appendFileSync(this.ledger, `${JSON.stringify({ at: new Date().toISOString(), run: this.runId, model: report.model ?? null, usd })}\n`, { mode: 0o600 });
      });
    }
    return this.real;
  }

  checkCaps() {
    const reserve = (this.inflight + 1) * RESERVE_USD;
    if (this.spentUsd + reserve > this.runCapUsd) throw new LiveCapError(`live run cap $${this.runCapUsd} reached ($${this.spentUsd.toFixed(4)} spent)`);
    if (this.monthBefore + this.spentUsd + reserve > this.monthCapUsd) throw new LiveCapError(`live month cap $${this.monthCapUsd} reached ($${(this.monthBefore + this.spentUsd).toFixed(4)} this month)`);
  }

  async call(method, args) {
    const onText = method === "streamMemoryChat" && typeof args[1] === "function" ? args[1] : null;
    if (method === "streamMemoryChat") {
      this.lastAnswerPrompt = String(args[0]?.prompt ?? "");
      this.lastAnswerTokens = Math.round((String(args[0]?.system ?? "").length + this.lastAnswerPrompt.length) / 4);
      this.lastAnswerText = null;
    }
    const { text: keyText, tokens } = normalise(`${this.model}\n${method}\n${stable(args)}`);
    const key = createHash("sha256").update(keyText).digest("hex");
    const file = join(this.cacheDir, `${key}.json`);
    const stat = (this.byMethod[method] ??= { live: 0, cached: 0 });
    if (existsSync(file)) {
      const hit = JSON.parse(readFileSync(file, "utf8"));
      const out = hit.out === undefined ? undefined : JSON.parse(restore(hit.out, tokens));
      this.calls.cached += 1; stat.cached += 1;
      this.replayedMs += hit.ms ?? 0;
      if (onText && typeof out === "string") onText(out);
      if (method === "streamMemoryChat") this.lastAnswerText = typeof out === "string" ? out : null;
      return out;
    }
    try { this.checkCaps(); } catch (e) { this.calls.refused += 1; throw e; }
    const real = this.client();
    if (typeof real[method] !== "function") throw new Error(`live model has no ${method}`);
    this.inflight += 1;
    const started = performance.now();
    let out;
    try {
      out = await real[method](...args);
    } catch (e) {
      this.calls.failed += 1;
      const why = failureKind(e);
      this.failures[`${method}: ${why}`] = (this.failures[`${method}: ${why}`] ?? 0) + 1;
      throw e;
    } finally {
      this.inflight -= 1;
    }
    const ms = Math.round(performance.now() - started);
    this.calls.live += 1; stat.live += 1;
    if (method === "streamMemoryChat") this.lastAnswerText = typeof out === "string" ? out : null;
    const stored = out === undefined ? undefined : normalise(JSON.stringify(out), tokens, true).text;
    writeFileSync(file, JSON.stringify({ method, model: this.model, at: new Date().toISOString(), ms, out: stored }), { mode: 0o600 });
    return out;
  }

  /** Model time replayed from the cache since the last call, so a cached rerun reports the first run's timings. */
  takeReplayedMs() { const ms = this.replayedMs; this.replayedMs = 0; return ms; }

  summary() {
    return { model: this.model, calls: this.calls, byMethod: this.byMethod, failures: this.failures, spentUsd: Math.round(this.spentUsd * 1e5) / 1e5,
      runCapUsd: this.runCapUsd, monthCapUsd: this.monthCapUsd, monthSpentUsd: Math.round((this.monthBefore + this.spentUsd) * 1e5) / 1e5 };
  }
}

/** Why a live call failed, in a few words: error name, HTTP status and the start of the message (never a body). */
export function failureKind(e) {
  const name = e?.name ?? "Error";
  const status = e?.statusCode ?? e?.status ?? e?.cause?.statusCode;
  const msg = String(e?.message ?? e ?? "").replace(/\s+/g, " ").slice(0, 60);
  const cause = e?.cause ? ` (${e.cause.name ?? "Error"}: ${String(e.cause.message ?? "").replace(/\s+/g, " ").slice(0, 60)})` : "";
  return `${name}${status ? ` ${status}` : ""}: ${msg}${cause}`;
}

/** The DeepSeek client production builds for background work (packages/server/src/runtime.ts backgroundLlm). */
export function deepseekLive(core, { apiKey, model, baseUrl, reasoning, dir, runCapUsd, monthCapUsd, runId }) {
  return new LiveModel({
    model, dir, runCapUsd, monthCapUsd, runId,
    make: (onUsage) => core.createBrainLlm({
      provider: "deepseek", apiKey, askModel: model, chatModel: model, classifyModel: model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(reasoning ? { organizerReasoningEffort: reasoning, askReasoningEffort: reasoning } : {}),
      user: "memory-eval", onUsage,
    }),
  });
}

/**
 * E7-S3 iteration 3: Claude through staging. Production files on Claude Haiku and answers on Claude
 * Sonnet; the Anthropic key is per-app and stays inside zenod-staging (Jordi 2026-11-12: no new or copied
 * key). Each call goes to staging's POST /api/credit/eval-call as its test tenant, which runs it on
 * staging's Anthropic credit route (filing model for classify, composePage and reconcile, answer model
 * for streamMemoryChat) under that account's own monthly cap, and returns the result and its price.
 * Only the staging tenant's token is needed here, read from a 0600 file, never the model key.
 */
export function stagingClient({ url, token, fetchImpl = fetch, timeoutMs = 120_000 }, onUsage) {
  const call = async (method, args) => {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/api/credit/eval-call`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      const e = new Error(`staging ${method}: ${body.name ?? ""} ${body.error ?? res.statusText}`.trim().slice(0, 200));
      e.name = body.name ?? "StagingError";
      e.statusCode = body.status ?? res.status;
      throw e;
    }
    onUsage({ providerCostUsd: body.costUsd, model: body.model, inputTokens: body.inputTokens, outputTokens: body.outputTokens });
    return body.out;
  };
  return {
    classify: (input) => call("classify", [input]),
    composePage: (input) => call("composePage", [input]),
    reconcile: (input) => call("reconcile", [input]),
    streamMemoryChat: async (input, onText) => { const out = await call("streamMemoryChat", [{ system: input.system, prompt: input.prompt }]); if (typeof out === "string") onText?.(out); return out; },
  };
}

export function stagingLive({ url, token, model, dir, runCapUsd, monthCapUsd, runId, fetchImpl }) {
  return new LiveModel({ model, dir, runCapUsd, monthCapUsd, runId, make: (onUsage) => stagingClient({ url, token, fetchImpl }, onUsage) });
}
