import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { LlmUsageReport } from "zenod";
import { openZenodSqlite } from "./sqlite.js";

/**
 * The call button (EPIC-14 S8): the "library hotline". The user talks with OpenAI's realtime voice
 * model straight from the browser (WebRTC); Zenod only (1) mints a 1-minute client key for one call,
 * under the caps, so the real key never reaches the browser, (2) answers the voice's two tools (ask
 * Zenod's answer engine, pass a job to the memory desk), (3) meters the cost from the API's own usage
 * numbers into the tenant's usage ledger, where it counts against the AI allowance, and (4) keeps the
 * transcript only when the user presses Keep (then it is filed like any Keep).
 *
 * Copied and cut down from Epic Team's desk call (agent_team console/server/src/voice/voice.ts and
 * prices.ts, E42-S5) per the approved plan (E14-P1): no run-time calls across the seam (root L-7).
 * Zenod has its own key, OPENAI_REALTIME_KEY (secret zenod-mt/OPENAI_REALTIME_KEY); while it is
 * absent the button says calls are not switched on yet. The WhatsApp and Telegram paths are untouched
 * (root L-6). Types only from "zenod": this file is bundled into Phylax.
 */

/** The env name the server reads; the secret store keeps it as zenod-mt/OPENAI_REALTIME_KEY. */
export const CALL_KEY_ENV = "OPENAI_REALTIME_KEY";
// Not OPENAI_API_KEY: Zenod reads that name for transcription and model settings, which must not move onto the call key.
export const CALL_KEY_SECRET = "zenod-mt/OPENAI_REALTIME_KEY";
/** Where the client key is minted; a test or a local check points it at a stub. */
export const CALL_BASE_ENV = "OPENAI_REALTIME_BASE_URL";
export const OPENAI_BASE_URL = "https://api.openai.com";
export const CALL_MODEL = "gpt-realtime-2.1-mini";
export const CALL_VOICE = "marin";
export const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
/** The client key lives this long: enough to open the call, useless after. */
export const KEY_TTL_S = 60;
/** One call lasts at most this long; the voice warns a minute before. */
export const CALL_MAX_S = 10 * 60;
export const CALL_WARN_S = 9 * 60;
/** A call ends by itself after this long with nobody speaking. */
export const QUIET_HANGUP_S = 60;
/** Hard caps, in US$: one call, and all of one account's calls in a UTC month (inside the AI allowance). */
export const CALL_CAP_USD = 0.5;
export const MONTH_CAP_USD = 1;
/**
 * All of Zenod's calls together stop at this much a UTC month (E14-A3: Zenod shares the team's OpenAI
 * key, agent-team-console's, which carries Jordi's $10 call credit; this keeps Zenod's share bounded
 * in Zenod's own meter, apart from the console's).
 */
export const PLATFORM_MONTH_CAP_USD = 10;
/** The app name Zenod's calls are logged under, so its spend on the shared key shows apart. */
export const CALL_APP = "zenod";
/** Below this much left in the month no new call starts (a short call costs about this). */
export const MIN_LEFT_USD = 0.05;
/** A call whose page sent no heartbeat for this long is over (tab closed, phone locked). */
export const LOST_AFTER_MS = 3 * 60_000;
/** At most this much of the user's question or job goes to a tool. */
export const TOOL_TEXT_MAX = 600;
/** The voice reads at most this much of an answer. */
export const SPOKEN_ANSWER_MAX = 900;
export const TRANSCRIPT_LINES_MAX = 400;

/**
 * Realtime prices in US$ per 1M tokens (developers.openai.com/api/docs/pricing, checked 2026-11-01
 * for agent_team prices.ts). Cached input is billed apart; the usage totals include it.
 */
export const PRICES_CHECKED = "2026-11-01";
export const PRICES: Record<string, { textIn: number; textCachedIn: number; textOut: number; audioIn: number; audioCachedIn: number; audioOut: number }> = {
  "gpt-realtime-2.1-mini": { textIn: 0.6, textCachedIn: 0.06, textOut: 2.4, audioIn: 10, audioCachedIn: 0.3, audioOut: 20 },
  "gpt-realtime-2.1": { textIn: 4, textCachedIn: 0.4, textOut: 24, audioIn: 32, audioCachedIn: 0.4, audioOut: 64 },
};
export const TRANSCRIBE_PRICES = { in: 1.25, out: 5 };

export interface Tokens {
  textIn: number;
  textCachedIn: number;
  audioIn: number;
  audioCachedIn: number;
  textOut: number;
  audioOut: number;
  trIn: number;
  trOut: number;
}
export const zeroTokens = (): Tokens => ({ textIn: 0, textCachedIn: 0, audioIn: 0, audioCachedIn: 0, textOut: 0, audioOut: 0, trIn: 0, trOut: 0 });

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The `usage` of a Realtime `response.done` event, as token counts (uncached input apart from cached). */
export function tokensOfResponse(usage: unknown): Tokens {
  const u = (usage ?? {}) as Record<string, any>;
  const inD = u.input_token_details ?? {};
  const outD = u.output_token_details ?? {};
  const cachedD = inD.cached_tokens_details ?? {};
  const cachedText = n(cachedD.text_tokens);
  const cachedAudio = n(cachedD.audio_tokens);
  const cachedOther = cachedText + cachedAudio === 0 ? n(inD.cached_tokens) : 0;
  const t = zeroTokens();
  t.textCachedIn = cachedText + cachedOther;
  t.audioCachedIn = cachedAudio;
  t.textIn = Math.max(0, n(inD.text_tokens) - t.textCachedIn);
  t.audioIn = Math.max(0, n(inD.audio_tokens) - cachedAudio);
  t.textOut = n(outD.text_tokens);
  t.audioOut = n(outD.audio_tokens);
  if (!u.input_token_details && n(u.input_tokens)) t.textIn = n(u.input_tokens);
  if (!u.output_token_details && n(u.output_tokens)) t.textOut = n(u.output_tokens);
  return t;
}

/** The `usage` of an input transcription event (type `tokens`). */
export function tokensOfTranscription(usage: unknown): Tokens {
  const u = (usage ?? {}) as Record<string, any>;
  const t = zeroTokens();
  t.trIn = n(u.input_tokens);
  t.trOut = n(u.output_tokens);
  return t;
}

/** US$ for these tokens (six decimals). A model missing from the table is priced as the bigger one. */
export function costOf(model: string, t: Tokens): number {
  const p = PRICES[model] ?? PRICES["gpt-realtime-2.1"]!;
  const usd =
    (t.textIn * p.textIn + t.textCachedIn * p.textCachedIn + t.audioIn * p.audioIn + t.audioCachedIn * p.audioCachedIn +
      t.textOut * p.textOut + t.audioOut * p.audioOut + t.trIn * TRANSCRIBE_PRICES.in + t.trOut * TRANSCRIBE_PRICES.out) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

export class CallError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CallError";
  }
}

export const NOT_SWITCHED_ON = "Calls are not switched on yet.";

/** The voice's instructions: a librarian on the phone, short and warm, who never makes things up. */
export const CALL_INSTRUCTIONS = [
  "# Style: the most important rules on this call",
  "- Short but warm: usually one short sentence, friendly and natural, like a good librarian on the phone.",
  "- Answer in the language the caller speaks.",
  "- Never describe how you talk and never repeat back what they said: just talk.",
  "",
  "You are Zenod's library hotline: the caller's own memory (their notes, voice notes and topics) on the phone. You are not the memory and you know nothing about it yourself.",
  "- For anything about their memory (what they noted, who, when, how much, what is in a topic) call ask_memory with their question in their words. Say one short line while it looks ('Let me look.'), then tell them its answer at once, simply, in one to three short sentences. If it found no checked answer, say so plainly; never guess and never fill in from your own knowledge.",
  "- For a job on the memory (split, join, move, rename or relink topics, or 'this is filed wrong') call desk_job with the job in their words. Say once that the memory desk has it and that the result shows in their inbox, where they can undo it. Do not wait for it.",
  "- You do not save anything they say. If they want something kept, tell them: after the call they can keep the call's transcript as a memory with Keep.",
  "- When they are done (bye, that's all, thanks), say a short goodbye and call hang_up.",
  'When the line opens, the app has you say this greeting, once: "Hi, this is your Zenod library line. What would you like to know?"',
].join("\n");
export const CALL_GREETING = "Hi, this is your Zenod library line. What would you like to know?";

export const CALL_TOOLS = [
  {
    type: "function" as const,
    name: "ask_memory",
    description: "Ask Zenod's answer engine a question about the caller's memory. Returns a checked answer from their own notes, or says there is none.",
    parameters: { type: "object", properties: { question: { type: "string", description: "The caller's question, in their words." } }, required: ["question"] },
  },
  {
    type: "function" as const,
    name: "desk_job",
    description: "Pass a job on the memory (split, join, move, rename, relink topics) to the memory desk. Returns at once; the result shows in the inbox, undoable.",
    parameters: { type: "object", properties: { job: { type: "string", description: "The job, in the caller's words." } }, required: ["job"] },
  },
  {
    type: "function" as const,
    name: "hang_up",
    description: "End the call after saying goodbye, when the caller is done.",
    parameters: { type: "object", properties: {} },
  },
];

/** The session the client key is minted for (model, voice, instructions, tools, transcription for captions). */
export function sessionConfig(model = CALL_MODEL) {
  return {
    expires_after: { anchor: "created_at", seconds: KEY_TTL_S },
    session: {
      type: "realtime",
      model,
      instructions: CALL_INSTRUCTIONS,
      output_modalities: ["audio"],
      max_output_tokens: 1200,
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL },
          noise_reduction: { type: "near_field" },
          turn_detection: { type: "server_vad", silence_duration_ms: 600, create_response: true, interrupt_response: true },
        },
        output: { voice: CALL_VOICE },
      },
      tools: CALL_TOOLS,
      tool_choice: "auto",
    },
  };
}

export type MintedKey = { value: string; expires_at: number; session?: { id?: string } };
export type Minter = (body: ReturnType<typeof sessionConfig>) => Promise<MintedKey>;

/** The key from the environment, or undefined: absent means calls are not switched on. */
export function callKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[CALL_KEY_ENV]?.trim() || undefined;
}

/** OpenAI's client-secret endpoint with Zenod's own key (never another app's). */
export function openAiMinter(key: string, baseUrl: string = OPENAI_BASE_URL, f: typeof fetch = fetch): Minter {
  return async (body) => {
    const r = await f(`${baseUrl.replace(/\/+$/, "")}/v1/realtime/client_secrets`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok || typeof j?.value !== "string") {
      const quota = r.status === 429 || /insufficient_quota|credit/i.test(String(j?.error?.code ?? j?.error?.message ?? ""));
      throw new CallError(502, quota ? "no_credit" : "openai_refused", quota
        ? "The call service has no credit left, so the call could not start. Nothing was charged."
        : "The call service did not open a line just now. Try again in a moment.");
    }
    return j as MintedKey;
  };
}

export interface CallRecord {
  id: string;
  startedAt: string;
  lastBeatAt: string;
  endedAt: string | null;
  endReason: string | null;
  model: string;
  seconds: number;
  costUsd: number;
  asks: number;
  jobs: number;
  hasTranscript: boolean;
  keptJobId: string | null;
}

export interface TranscriptLine {
  who: "you" | "zenod" | "tool";
  text: string;
  at?: string;
}

interface CallRow {
  id: string;
  started_at: string;
  last_beat_at: string;
  ended_at: string | null;
  end_reason: string | null;
  model: string;
  cost_usd: number;
  metered_usd: number;
  asks: number;
  jobs: number;
  transcript: string | null;
  kept_job_id: string | null;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/** One SQLite file per tenant on the /data volume, beside the inbox: calls and their usage events. */
export class CallStore {
  readonly db: DatabaseSync;
  constructor(path: string, readonly now: () => Date = () => new Date()) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        last_beat_at TEXT NOT NULL,
        ended_at TEXT,
        end_reason TEXT,
        model TEXT NOT NULL,
        session_id TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        metered_usd REAL NOT NULL DEFAULT 0,
        asks INTEGER NOT NULL DEFAULT 0,
        jobs INTEGER NOT NULL DEFAULT 0,
        transcript TEXT,
        kept_job_id TEXT
      );
      CREATE INDEX IF NOT EXISTS calls_started ON calls(started_at);
      CREATE TABLE IF NOT EXISTS call_usage (
        call_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        usage TEXT NOT NULL,
        PRIMARY KEY (call_id, event_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  row(id: string): CallRow | undefined {
    return this.db.prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | undefined;
  }

  view(row: CallRow): CallRecord {
    const end = row.ended_at ? Date.parse(row.ended_at) : this.now().getTime();
    return {
      id: row.id,
      startedAt: row.started_at,
      lastBeatAt: row.last_beat_at,
      endedAt: row.ended_at,
      endReason: row.end_reason,
      model: row.model,
      seconds: Math.max(0, Math.round((end - Date.parse(row.started_at)) / 1000)),
      costUsd: row.cost_usd,
      asks: row.asks,
      jobs: row.jobs,
      hasTranscript: Boolean(row.transcript),
      keptJobId: row.kept_job_id,
    };
  }

  /** The open call, if any; a call whose page went quiet is closed here as lost. */
  active(): CallRow | undefined {
    const open = this.db.prepare("SELECT * FROM calls WHERE ended_at IS NULL ORDER BY started_at DESC").all() as unknown as CallRow[];
    const now = this.now().getTime();
    let live: CallRow | undefined;
    for (const row of open) {
      if (!live && now - Date.parse(row.last_beat_at) < LOST_AFTER_MS) live = row;
      else this.db.prepare("UPDATE calls SET ended_at = ?, end_reason = 'lost' WHERE id = ? AND ended_at IS NULL").run(new Date(Math.min(now, Date.parse(row.last_beat_at) + LOST_AFTER_MS)).toISOString(), row.id);
    }
    return live;
  }

  /** All calls' cost this UTC month. */
  monthUsd(): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM calls WHERE started_at >= ?").get(monthStart(this.now())) as { usd: number };
    return Math.round(row.usd * 1e6) / 1e6;
  }

  insert(id: string, model: string, sessionId: string | null): void {
    const t = this.now().toISOString();
    this.db.prepare("INSERT INTO calls (id, started_at, last_beat_at, model, session_id) VALUES (?, ?, ?, ?, ?)").run(id, t, t, model, sessionId);
  }

  beat(id: string): void {
    this.db.prepare("UPDATE calls SET last_beat_at = ? WHERE id = ? AND ended_at IS NULL").run(this.now().toISOString(), id);
  }

  /** Store one usage event (an event id counts once) and recompute the call's cost; returns the cost added. */
  addUsage(id: string, eventId: string, kind: "response" | "transcription", usage: unknown): { added: boolean; tokens: Tokens; deltaUsd: number } {
    const res = this.db.prepare("INSERT OR IGNORE INTO call_usage (call_id, event_id, kind, at, usage) VALUES (?, ?, ?, ?, ?)").run(id, eventId.slice(0, 120), kind, this.now().toISOString(), JSON.stringify(usage).slice(0, 4000));
    const tokens = kind === "transcription" ? tokensOfTranscription(usage) : tokensOfResponse(usage);
    if (Number(res.changes) === 0) return { added: false, tokens, deltaUsd: 0 };
    const row = this.row(id)!;
    let total = 0;
    for (const u of this.db.prepare("SELECT kind, usage FROM call_usage WHERE call_id = ?").all(id) as { kind: string; usage: string }[]) {
      const raw = JSON.parse(u.usage);
      total += costOf(row.model, u.kind === "transcription" ? tokensOfTranscription(raw) : tokensOfResponse(raw));
    }
    total = Math.round(total * 1e6) / 1e6;
    const deltaUsd = Math.max(0, Math.round((total - row.metered_usd) * 1e6) / 1e6);
    this.db.prepare("UPDATE calls SET cost_usd = ?, metered_usd = ? WHERE id = ?").run(total, total, id);
    return { added: true, tokens, deltaUsd };
  }

  count(id: string, tool: "asks" | "jobs"): void {
    this.db.prepare(`UPDATE calls SET ${tool} = ${tool} + 1 WHERE id = ?`).run(id);
  }

  end(id: string, reason: string, transcript: TranscriptLine[] | null): void {
    this.db.prepare("UPDATE calls SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL").run(this.now().toISOString(), reason.slice(0, 40), id);
    if (transcript?.length) this.db.prepare("UPDATE calls SET transcript = ? WHERE id = ? AND transcript IS NULL").run(JSON.stringify(transcript.slice(0, TRANSCRIPT_LINES_MAX)), id);
  }

  transcript(id: string): TranscriptLine[] {
    const raw = this.row(id)?.transcript;
    if (!raw) return [];
    try {
      const lines = JSON.parse(raw);
      return Array.isArray(lines) ? lines : [];
    } catch {
      return [];
    }
  }

  kept(id: string, jobId: string): void {
    this.db.prepare("UPDATE calls SET kept_job_id = ? WHERE id = ?").run(jobId, id);
  }
}

/**
 * Zenod's own call meter across every account (one SQLite file in the host's data dir): each call's
 * cost under its app and tenant, for the platform's month stop and so Zenod's spend on the shared
 * key is visible apart from the console's.
 */
export class CallMeter {
  readonly db: DatabaseSync;
  constructor(path: string, readonly now: () => Date = () => new Date()) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_costs (
        call_id TEXT PRIMARY KEY,
        app TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS call_costs_started ON call_costs(started_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  set(callId: string, tenantId: string, startedAt: string, costUsd: number, app = CALL_APP): void {
    this.db
      .prepare(`INSERT INTO call_costs (call_id, app, tenant_id, started_at, cost_usd, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(call_id) DO UPDATE SET cost_usd = excluded.cost_usd, updated_at = excluded.updated_at`)
      .run(callId, app, tenantId, startedAt, costUsd, this.now().toISOString());
  }

  /** All calls' cost this UTC month (one app, default Zenod's). */
  monthUsd(app = CALL_APP): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM call_costs WHERE app = ? AND started_at >= ?").get(app, monthStart(this.now())) as { usd: number };
    return Math.round(row.usd * 1e6) / 1e6;
  }

  /** This month per app and per tenant: calls and cost. */
  month(): { app: string; tenantId: string; calls: number; costUsd: number }[] {
    return (this.db
      .prepare("SELECT app, tenant_id AS tenantId, COUNT(*) AS calls, ROUND(SUM(cost_usd), 6) AS costUsd FROM call_costs WHERE started_at >= ? GROUP BY app, tenant_id ORDER BY costUsd DESC")
      .all(monthStart(this.now())) as unknown) as { app: string; tenantId: string; calls: number; costUsd: number }[];
  }
}

const meters = new Map<string, CallMeter>();

export function callMeterFor(dataDir: string): CallMeter {
  let meter = meters.get(dataDir);
  if (!meter) {
    meter = new CallMeter(join(dataDir, "call-meter.sqlite"));
    meters.set(dataDir, meter);
  }
  return meter;
}

/** The platform meter as one tenant's calls see it. */
export interface PlatformMeter {
  record(call: CallRecord): void;
  monthUsd(): number;
}

export function platformMeter(meter: CallMeter, tenantId: string): PlatformMeter {
  return {
    record: (call) => meter.set(call.id, tenantId, call.startedAt, call.costUsd),
    monthUsd: () => meter.monthUsd(),
  };
}

const stores = new Map<string, CallStore>();

export function callsFor(runtime: { readonly dataDir: string }): CallStore {
  let store = stores.get(runtime.dataDir);
  if (!store) {
    store = new CallStore(join(runtime.dataDir, "calls.sqlite"));
    stores.set(runtime.dataDir, store);
  }
  return store;
}

export function closeCallsFor(runtime: { readonly dataDir: string }): void {
  stores.get(runtime.dataDir)?.close();
  stores.delete(runtime.dataDir);
}

/** What the tools need from the tenant (customerLayer wires them to the real engine and desk). */
export interface CallTenant {
  /** The AI allowance's stop, or null while AI work may run. */
  allowanceBlock(): { message: string } | null;
  /** Zenod's checked answer for a question (memoryChat.answerFromMemory). */
  answer(question: string): Promise<{ answered: boolean; answer: string; sources: string[] }>;
  /** Start a memory desk job (memoryDesk.startDeskJob); throws a message when it cannot. */
  deskJob(job: string): { id: string; title: string };
  /** File text as a new memory through the durable store queue (as Keep). */
  keep(content: string): { id: string };
  /** Record a usage row on the tenant's own ledger (counts against the AI allowance). */
  record(report: LlmUsageReport): void;
}

export interface CallLimits {
  callMaxS: number;
  callWarnS: number;
  quietHangupS: number;
  callCapUsd: number;
  monthCapUsd: number;
}
export const LIMITS: CallLimits = { callMaxS: CALL_MAX_S, callWarnS: CALL_WARN_S, quietHangupS: QUIET_HANGUP_S, callCapUsd: CALL_CAP_USD, monthCapUsd: MONTH_CAP_USD };

export interface CallState {
  /** False: the button says why (not switched on, month cap, allowance). */
  available: boolean;
  code?: "not_switched_on" | "month_cap" | "platform_cap" | "ai_allowance_exhausted";
  message?: string;
  limits: CallLimits;
  month: { spentUsd: number; capUsd: number };
  active: CallRecord | null;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Strip citation marks and links so the voice reads plain words. */
export function spokenAnswer(answer: string): string {
  return clip(
    answer
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => t.split("/").pop()!.replace(/\.md$/i, ""))
      .replace(/\[(\d+)\]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`#>]/g, "")
      .replace(/\s+/g, " ")
      .replace(/ ([.,;:!?])/g, "$1")
      .trim(),
    SPOKEN_ANSWER_MAX,
  );
}

/** The kept transcript as a memory: one header line, then who said what. */
export function transcriptMemory(call: CallRecord, lines: TranscriptLine[]): string {
  const when = `${call.startedAt.slice(0, 10)} ${call.startedAt.slice(11, 16)} UTC`;
  const dur = `${Math.floor(call.seconds / 60)} min ${String(call.seconds % 60).padStart(2, "0")} s`;
  const body = lines
    .filter((l) => l.text?.trim() && l.who !== "tool")
    .map((l) => `${l.who === "you" ? "Me" : "Zenod"}: ${l.text.replace(/\s+/g, " ").trim()}`);
  return clip([`Call with my Zenod library line, ${when}, ${dur}.`, "", ...body].join("\n"), 8_000);
}

export function createMemoryCall(deps: { store: CallStore; tenant: CallTenant; key: string | undefined; mint?: Minter; platform?: PlatformMeter; tenantId?: string }) {
  const { store, tenant, platform } = deps;
  const who = `app=${CALL_APP}${deps.tenantId ? ` tenant=${deps.tenantId}` : ""}`;
  const meter = (call: CallRecord) => {
    try {
      platform?.record(call);
    } catch (error) {
      console.warn(`[call] ${who} ${call.id} not metered: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  function refusal(): Pick<CallState, "code" | "message"> | null {
    if (!deps.key || !deps.mint) return { code: "not_switched_on", message: NOT_SWITCHED_ON };
    const block = tenant.allowanceBlock();
    if (block) return { code: "ai_allowance_exhausted", message: block.message };
    if (platform && platform.monthUsd() >= PLATFORM_MONTH_CAP_USD - MIN_LEFT_USD) {
      return { code: "platform_cap", message: "Calls are paused for the rest of this month. They open again on the 1st." };
    }
    if (store.monthUsd() >= MONTH_CAP_USD - MIN_LEFT_USD) {
      return { code: "month_cap", message: `This month's calls have reached their $${MONTH_CAP_USD.toFixed(2)} limit. Calls open again next month.` };
    }
    return null;
  }

  function state(): CallState {
    const no = refusal();
    const active = store.active();
    return {
      available: !no,
      ...(no ?? {}),
      limits: LIMITS,
      month: { spentUsd: store.monthUsd(), capUsd: MONTH_CAP_USD },
      active: active ? store.view(active) : null,
    };
  }

  function must(id: string): CallRecord {
    const row = store.row(id);
    if (!row) throw new CallError(404, "not_found", "no such call");
    return store.view(row);
  }

  /** Why the page must hang up now, or undefined. */
  function stopWhy(call: CallRecord): string | undefined {
    if (call.endedAt) return call.endReason ?? "ended";
    if (call.seconds >= CALL_MAX_S) return "call_limit";
    if (call.costUsd >= CALL_CAP_USD) return "call_cap";
    if (store.monthUsd() >= MONTH_CAP_USD) return "month_cap";
    if (platform && platform.monthUsd() >= PLATFORM_MONTH_CAP_USD) return "platform_cap";
    if (tenant.allowanceBlock()) return "ai_allowance_exhausted";
    return undefined;
  }

  async function start() {
    const no = refusal();
    if (no) throw new CallError(no.code === "not_switched_on" ? 503 : 429, no.code!, no.message!);
    if (store.active()) throw new CallError(409, "one_call", "A call is already on. Hang it up first.");
    const config = sessionConfig();
    const key = await deps.mint!(config);
    if (store.active()) throw new CallError(409, "one_call", "A call is already on. Hang it up first.");
    const id = `call_${randomBytes(4).toString("hex")}`;
    store.insert(id, config.session.model, key.session?.id ?? null);
    meter(must(id));
    console.log(`[call] ${who} ${id} started (${config.session.model})`);
    return {
      call: must(id),
      clientSecret: key.value,
      expiresAt: key.expires_at,
      model: config.session.model,
      limits: LIMITS,
      greeting: CALL_GREETING,
    };
  }

  function beat(id: string) {
    must(id);
    store.beat(id);
    const call = must(id);
    const stop = stopWhy(call);
    return { call, monthUsd: store.monthUsd(), ...(stop ? { stop } : {}) };
  }

  /** The page forwards each `response.done` / transcription usage it receives; an event id counts once. */
  function usage(id: string, ev: { eventId?: unknown; kind?: unknown; usage?: unknown }) {
    const call0 = must(id);
    if (typeof ev.eventId !== "string" || !ev.eventId || (ev.kind !== "response" && ev.kind !== "transcription") || typeof ev.usage !== "object" || ev.usage === null) {
      throw new CallError(400, "invalid", "eventId, kind and usage are required");
    }
    // The last response.done may land just after the hang-up: accepted for a minute after the end.
    if (call0.endedAt && store.now().getTime() - Date.parse(call0.endedAt) > 60_000) throw new CallError(409, "call_ended", "the call has ended");
    const { added, tokens, deltaUsd } = store.addUsage(id, ev.eventId, ev.kind, ev.usage);
    if (added && deltaUsd > 0) {
      try {
        tenant.record({
          operation: "call",
          provider: "openai",
          model: ev.kind === "transcription" ? TRANSCRIBE_MODEL : call0.model,
          inputTokens: tokens.textIn + tokens.audioIn + tokens.trIn,
          outputTokens: tokens.textOut + tokens.audioOut + tokens.trOut,
          cachedInputTokens: tokens.textCachedIn + tokens.audioCachedIn,
          cacheCreationInputTokens: 0,
          estimatedCostUsd: deltaUsd,
        });
      } catch (error) {
        console.warn(`[call] ${id} usage not recorded: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!call0.endedAt) store.beat(id);
    const call = must(id);
    if (added) meter(call);
    const stop = call.endedAt ? undefined : stopWhy(call);
    return { call, monthUsd: store.monthUsd(), ...(stop ? { stop } : {}) };
  }

  /** The voice's tools: the result goes back to the model as the function call's output. */
  async function tool(id: string, name: unknown, args: unknown): Promise<{ output: Record<string, unknown> }> {
    const call = must(id);
    if (call.endedAt) throw new CallError(409, "call_ended", "the call has ended");
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    if (name === "ask_memory") {
      const question = typeof a.question === "string" ? a.question.trim().slice(0, TOOL_TEXT_MAX) : "";
      if (!question) return { output: { error: "Ask the caller what they want to know." } };
      store.count(id, "asks");
      try {
        const found = await tenant.answer(question);
        return {
          output: found.answered
            ? { answered: true, answer: spokenAnswer(found.answer), from: found.sources.slice(0, 3) }
            : { answered: false, note: "No checked answer in their memory for this. Say so plainly; do not guess." },
        };
      } catch (error) {
        const allowance = (error as Error | null)?.name === "LlmAllowanceExceededError";
        if (!allowance) console.warn(`[call] ${id} ask failed: ${error instanceof Error ? error.message : String(error)}`);
        return { output: { error: allowance ? "Their AI allowance for this month is used up, so Zenod cannot look this up now." : "Zenod could not look that up just now. Say so and offer to try again." } };
      }
    }
    if (name === "desk_job") {
      const job = typeof a.job === "string" ? a.job.trim().slice(0, TOOL_TEXT_MAX) : "";
      if (!job) return { output: { error: "Ask the caller what the desk should do." } };
      try {
        const item = tenant.deskJob(job);
        store.count(id, "jobs");
        return { output: { started: true, title: item.title, note: "The memory desk has it. The result shows in their inbox, where they can undo it." } };
      } catch (error) {
        return { output: { started: false, error: error instanceof Error ? error.message : "The memory desk could not take that just now." } };
      }
    }
    if (name === "hang_up") return { output: { ok: true } };
    throw new CallError(400, "unknown_tool", "no such tool");
  }

  function end(id: string, body: { reason?: unknown; transcript?: unknown }) {
    must(id);
    const lines = Array.isArray(body.transcript)
      ? (body.transcript as unknown[])
          .filter((l): l is TranscriptLine => Boolean(l) && typeof (l as TranscriptLine).text === "string" && ["you", "zenod", "tool"].includes((l as TranscriptLine).who))
          .map((l) => ({ who: l.who, text: l.text.slice(0, 2000), ...(typeof l.at === "string" ? { at: l.at.slice(0, 40) } : {}) }))
      : null;
    store.end(id, typeof body.reason === "string" && body.reason ? body.reason : "hangup", lines);
    const call = must(id);
    meter(call);
    console.log(`[call] ${who} ${id} ended: ${call.endReason} after ${call.seconds} s, cost_usd=${call.costUsd.toFixed(4)} model=${call.model}`);
    return { call, monthUsd: store.monthUsd() };
  }

  /** Keep the call's transcript as a memory (only on the user's Keep). Once per call. */
  function keep(id: string) {
    const call = must(id);
    if (!call.endedAt) throw new CallError(409, "call_on", "Hang up first, then keep the call.");
    if (call.keptJobId) return { call, jobId: call.keptJobId };
    const lines = store.transcript(id);
    if (!lines.some((l) => l.who === "you" && l.text.trim())) throw new CallError(400, "empty", "Nothing you said on this call was heard, so there is nothing to keep.");
    const job = tenant.keep(transcriptMemory(call, lines));
    store.kept(id, job.id);
    return { call: must(id), jobId: job.id };
  }

  return { state, start, beat, usage, tool, end, keep };
}
