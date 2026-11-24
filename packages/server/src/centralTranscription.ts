import { opsAlert } from "./opsAlert.js";
import type { TranscriptionEnvelope } from "./transcribe.js";

/**
 * EPIC-20 A7 (Jordi, vn_7d8521fb: "a central service that does this, so that we don't need to keep paying
 * OpenAI"): voice notes are transcribed first on the team's central free service on vps3 (faster-whisper behind
 * an OpenAI-shaped `POST /v1/audio/transcriptions`, agent_team E42-S153, reached over the tailnet, header
 * `x-caller: zenod`). The service runs at nice 19 on a shared host, so it can be slow: after CENTRAL_STT_TIMEOUT_MS
 * (60 s) or on any error the caller continues down today's paid cascade, and every fallback writes one
 * `[ops-alert] transcribe central_fallback` line that the health page counts. A note is never lost to it.
 *
 * EPIC-24 M36: a note longer than that 60 s window is no longer sent to the paid provider. It goes to the same service as a
 * long job: cut at pauses into parts of about 5 minutes, sent one after another on the small model, with a time limit that
 * grows with the note (120 s plus 0.6 s per second of audio). Measured on vps3: small takes about 0.2 s per second of audio,
 * and a part of 5 minutes holds the service for about a minute, so other callers' short notes are not starved for an hour.
 *
 * Off switch: ZENOD_CENTRAL_STT=0. Tests never reach the network unless ZENOD_CENTRAL_STT_URL is set.
 */
export const CENTRAL_STT_DEFAULT_URL = "http://vps3.taild81fbb.ts.net:18946/v1/audio/transcriptions";
export const CENTRAL_STT_TIMEOUT_MS = 60_000;
export const CENTRAL_STT_COOLDOWN_MS = 120_000;
export const CENTRAL_STT_TURBO_MODEL = "large-v3-turbo";
export const CENTRAL_STT_SMALL_MODEL = "small";
/**
 * Measured on vps3 at load 12 (22 Nov): turbo takes 27 to 36 s even for a 5 s note and 33 s for a 30 s one; small takes 6 to 9 s
 * for 5 s and 11 to 26 s for 30 s. So turbo is only tried for notes up to 30 s and small up to 90 s; longer ones would not
 * finish in 60 s and go straight to the paid provider.
 * Re-measured 23 Nov on 27 of the team's own recordings (docs/evidence/e20-a7-stt-compare-2026-11-23.md): turbo disagreed with
 * the stored text less than small on 12 of 21 notes (small on 4), 7.7 against 9.0 percent on notes of 30 to 90 s and clearly
 * better on noisy Spanish, and finished a 30 to 90 s note in 43 s (median) and 52 s (longest) at load 17 to 22, so turbo now
 * covers notes up to 45 s (about 33 s of work) and small the rest up to 90 s.
 */
export const CENTRAL_STT_TURBO_MAX_SECONDS = 45;
export const CENTRAL_STT_SMALL_MAX_SECONDS = 90;
/** M36: model, part length, and the time allowed for a long note: base + factor x audio seconds (measured: about 0.2 s per second). */
export const CENTRAL_STT_LONG_MODEL = "small";
export const CENTRAL_STT_CHUNK_SECONDS = 300;
export const CENTRAL_STT_LONG_BASE_MS = 120_000;
export const CENTRAL_STT_LONG_FACTOR = 0.6;
export const CENTRAL_STT_PART_TIMEOUT_MS = 240_000;
export const CENTRAL_STT_PART_RETRY_DELAY_MS = 10_000;
/** M36: what the owner is told: about this many seconds of waiting per second of audio, and the length from which the note counts as long. */
export const LONG_NOTE_ETA_FACTOR = 0.3;
export const LONG_NOTE_NOTICE_SECONDS = 180;
/**
 * EPIC-24 M38: the longest voice note Zenod transcribes. It was 2 hours, and a 1 h 58 min note (23 Nov) came 2 min from
 * being archived untranscribed. Every long note is cut into parts of about 5 minutes, so the length only sets how long the
 * job may run: 12 hours covers any real note (ZENOD_MAX_VOICE_NOTE_SECONDS overrides it).
 */
export const MAX_VOICE_NOTE_SECONDS = positive(process.env.ZENOD_MAX_VOICE_NOTE_SECONDS, 12 * 60 * 60);
/** The same limit in plain words, for replies and Log entries ("12 hours"). */
export function maxVoiceNoteWords(seconds: number = MAX_VOICE_NOTE_SECONDS): string {
  const hours = seconds / 3600;
  return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.round(seconds / 60)} minutes`;
}

/**
 * M38: the safety deadline for one voice job of this length: the configured one, or for a long note (over 90 s) twice the central long
 * job's own limit (so a fallback still has time), whichever is longer. An unknown length keeps the configured deadline.
 */
export function voiceJobDeadlineForMs(configuredMs: number, durationSeconds: number | null | undefined): number {
  if (durationSeconds === null || durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= CENTRAL_STT_SMALL_MAX_SECONDS) {
    return configuredMs;
  }
  return Math.max(configuredMs, 2 * Math.round(CENTRAL_STT_LONG_BASE_MS + CENTRAL_STT_LONG_FACTOR * durationSeconds * 1000));
}

/**
 * M38: transcribed parts of a long note kept on the data volume, keyed by the audio's hash, the model and the part. A stop
 * (a deploy) or a failed later part no longer throws away the parts already done: the next try, or a resend of the same
 * audio, starts at the first part not yet kept. Cleared when the whole note is done.
 */
export interface TranscriptPartCache {
  get(index: number, count: number): Promise<string | null>;
  put(index: number, count: number, text: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CentralSttConfig {
  url: string;
  timeoutMs: number;
  turboMaxSeconds: number;
  smallMaxSeconds: number;
  /** M36: long notes (over smallMaxSeconds) are cut into parts of about this many seconds. */
  chunkSeconds: number;
  longBaseMs: number;
  longFactor: number;
  partTimeoutMs: number;
  retryDelayMs: number;
  /** Model forced for every note (ZENOD_CENTRAL_STT_MODEL); unset = turbo for short notes, small for longer ones. */
  model: string | null;
  caller: string;
  /** After a timeout, a network error or a 5xx, notes skip the service for this long (they would only wait again). */
  cooldownMs: number;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The central route's settings, or null when it is off (or a test without an explicit URL). */
export function centralSttConfig(env: NodeJS.ProcessEnv = process.env): CentralSttConfig | null {
  if (env.ZENOD_CENTRAL_STT === "0") return null;
  const explicit = env.ZENOD_CENTRAL_STT_URL?.trim();
  if (!explicit && (env.NODE_ENV === "test" || env.VITEST)) return null;
  return {
    url: explicit || CENTRAL_STT_DEFAULT_URL,
    timeoutMs: positive(env.ZENOD_CENTRAL_STT_TIMEOUT_MS, CENTRAL_STT_TIMEOUT_MS),
    turboMaxSeconds: positive(env.ZENOD_CENTRAL_STT_TURBO_MAX_SECONDS, CENTRAL_STT_TURBO_MAX_SECONDS),
    smallMaxSeconds: positive(env.ZENOD_CENTRAL_STT_SMALL_MAX_SECONDS, CENTRAL_STT_SMALL_MAX_SECONDS),
    chunkSeconds: positive(env.ZENOD_CENTRAL_STT_CHUNK_SECONDS, CENTRAL_STT_CHUNK_SECONDS),
    longBaseMs: positive(env.ZENOD_CENTRAL_STT_LONG_BASE_MS, CENTRAL_STT_LONG_BASE_MS),
    longFactor: positive(env.ZENOD_CENTRAL_STT_LONG_FACTOR, CENTRAL_STT_LONG_FACTOR),
    partTimeoutMs: positive(env.ZENOD_CENTRAL_STT_PART_TIMEOUT_MS, CENTRAL_STT_PART_TIMEOUT_MS),
    retryDelayMs: env.ZENOD_CENTRAL_STT_RETRY_DELAY_MS === "0" ? 0 : positive(env.ZENOD_CENTRAL_STT_RETRY_DELAY_MS, CENTRAL_STT_PART_RETRY_DELAY_MS),
    model: env.ZENOD_CENTRAL_STT_MODEL?.trim() || null,
    caller: env.ZENOD_CENTRAL_STT_CALLER?.trim() || "zenod",
    cooldownMs: env.ZENOD_CENTRAL_STT_COOLDOWN_MS === "0" ? 0 : positive(env.ZENOD_CENTRAL_STT_COOLDOWN_MS, CENTRAL_STT_COOLDOWN_MS),
  };
}

let downUntil = 0;

/** True while the service is cooling down after a failure that made a note wait. */
export function centralSttCoolingDown(now: number = Date.now()): boolean {
  return now < downUntil;
}

export function resetCentralSttCooldown(): void {
  downUntil = 0;
}

/** A failure a note waited for (or that says the service is down) opens the cooldown; a 4xx or empty text does not. */
export function noteCentralSttResult(cfg: CentralSttConfig, result: TranscriptionEnvelope, now: number = Date.now()): void {
  if (result.success) downUntil = 0;
  else if (["timeout", "network", "http_5xx"].includes(result.providerCode ?? "")) downUntil = now + cfg.cooldownMs;
}

export interface CentralSttPlan {
  model: string;
  /** Longer than the 60 s window: cut into parts and sent one after another with a time limit scaled to its length. */
  long: boolean;
  /** For a long note: the time allowed for all of it. */
  deadlineMs: number;
}

/**
 * How a note of this length is sent: one request on turbo (up to 45 s) or small (up to 90 s) inside the 60 s timeout, or, longer
 * than that (EPIC-24 M36), as a long job on small with a time limit scaled to the audio. An unknown length tries turbo.
 */
export function centralSttPlanFor(durationSeconds: number | null | undefined, cfg: CentralSttConfig): CentralSttPlan {
  const long = durationSeconds !== null && durationSeconds !== undefined && durationSeconds > cfg.smallMaxSeconds;
  if (long) {
    return {
      model: cfg.model ?? CENTRAL_STT_LONG_MODEL,
      long: true,
      deadlineMs: Math.round(cfg.longBaseMs + cfg.longFactor * durationSeconds * 1000),
    };
  }
  if (cfg.model) return { model: cfg.model, long: false, deadlineMs: cfg.timeoutMs };
  if (durationSeconds === null || durationSeconds === undefined || durationSeconds <= cfg.turboMaxSeconds) {
    return { model: CENTRAL_STT_TURBO_MODEL, long: false, deadlineMs: cfg.timeoutMs };
  }
  return { model: CENTRAL_STT_SMALL_MODEL, long: false, deadlineMs: cfg.timeoutMs };
}

/** The model for a note of this length (see centralSttPlanFor). */
export function centralSttModelFor(durationSeconds: number | null | undefined, cfg: CentralSttConfig): string {
  return centralSttPlanFor(durationSeconds, cfg).model;
}

/** M36: the minutes the owner is told a note of this length will take (at least one). */
export function longNoteEstimateMinutes(durationSeconds: number): number {
  return Math.max(1, Math.ceil((durationSeconds * LONG_NOTE_ETA_FACTOR) / 60));
}

/** M36: the one plain reply a long note gets at once; the saved reply follows when it is written out. */
export function longNoteNotice(durationSeconds: number): string {
  return `Long voice note, transcribing it, about ${longNoteEstimateMinutes(durationSeconds)} min. I will reply here once it is saved. Send “cancel transcription” to stop it.`;
}

/**
 * M36: where to cut a long note into parts of about `chunkSeconds`: at the middle of the pause nearest each multiple of
 * the part length (within `windowSeconds`), so a word is not split; the part length itself when there is no pause. The
 * last part is never longer than 1.2 parts. `silences` are ffmpeg silencedetect intervals in seconds.
 */
export function chooseSegmentCuts(
  silences: Array<{ start: number; end: number }>,
  durationSeconds: number,
  chunkSeconds: number,
  windowSeconds = 45,
): number[] {
  const cuts: number[] = [];
  let last = 0;
  while (durationSeconds - last > chunkSeconds * 1.2) {
    const target = last + chunkSeconds;
    let best = target;
    let bestDistance = Infinity;
    for (const gap of silences) {
      const mid = (gap.start + gap.end) / 2;
      const distance = Math.abs(mid - target);
      if (mid > last + chunkSeconds / 2 && distance <= windowSeconds && distance < bestDistance) {
        best = mid;
        bestDistance = distance;
      }
    }
    cuts.push(Math.round(best * 100) / 100);
    last = best;
  }
  return cuts;
}

export type CentralSttFailureWord = "cooldown" | "timeout" | "network" | "http_4xx" | "http_5xx" | "empty" | "bad_reply" | "split_failed";

function failure(reason: CentralSttFailureWord, error: string, httpStatus?: number, cause?: string): TranscriptionEnvelope & { cause?: string } {
  return {
    ...(cause ? { cause } : {}),
    success: false,
    provider: "central",
    error,
    failureReason: reason === "timeout" ? "timeout" : reason === "network" ? "network_error" : "provider_unavailable",
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    providerCode: reason,
  };
}

/** A fixed-word code for why a request never got an answer (ENOTFOUND, ECONNREFUSED, EHOSTUNREACH, ...). */
export function networkCauseCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown; name?: unknown }; name?: unknown } | null;
  const raw = e?.cause?.code ?? e?.code ?? e?.cause?.name ?? e?.name ?? "unknown";
  return /^[A-Z0-9_]{3,40}$/.test(String(raw)) ? String(raw) : "other";
}

export interface CentralSttCall {
  data: Buffer;
  filename: string;
  model: string;
  /** ZENOD_WHISPER_LANGUAGE; "auto" lets the service detect it. */
  language: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** One request to the central service. Never throws: any problem comes back as a failed envelope. */
export async function transcribeWithCentral(cfg: CentralSttConfig, call: CentralSttCall): Promise<TranscriptionEnvelope> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(call.data)]), call.filename || "voice.ogg");
  form.append("model", call.model);
  form.append("response_format", "json");
  if (call.language && call.language !== "auto") form.append("language", call.language);
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  try {
    const response = await (call.fetchImpl ?? fetch)(cfg.url, {
      method: "POST",
      headers: { "x-caller": cfg.caller },
      body: form,
      signal: call.signal ? AbortSignal.any([call.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.text().catch(() => "");
      return failure(response.status >= 500 ? "http_5xx" : "http_4xx", `central transcription answered ${response.status}`, response.status);
    }
    const body = await response.text();
    let text = "";
    try {
      const parsed = JSON.parse(body) as { text?: unknown };
      text = typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      return failure("bad_reply", "central transcription sent a reply that is not JSON");
    }
    text = text.trim();
    if (!text) return failure("empty", "central transcription returned empty text");
    return { success: true, transcript: text, provider: `central faster-whisper ${call.model}` };
  } catch (err) {
    if (call.signal?.aborted) return failure("network", "transcription was cancelled");
    if (timeout.aborted) return failure("timeout", `central transcription did not answer within ${Math.round(cfg.timeoutMs / 1000)} s`);
    const cause = networkCauseCode(err);
    return failure("network", `central transcription unreachable: ${cause}`, undefined, cause);
  }
}

export interface CentralLongCall extends Omit<CentralSttCall, "model" | "filename"> {
  filename: string;
  model: string;
  durationSeconds: number;
  /** The time allowed for the whole note (centralSttPlanFor). */
  deadlineMs: number;
  /** Cuts the note into parts of about `chunkSeconds` (ffmpeg in the server; a fake in tests). */
  split: (data: Buffer, filename: string, durationSeconds: number, chunkSeconds: number, signal?: AbortSignal) => Promise<Array<{ data: Buffer; filename: string }>>;
  onProgress?: (percent: number) => void;
  /** M38: parts already transcribed by an earlier try of the same audio. */
  partCache?: TranscriptPartCache;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * EPIC-24 M36: a note longer than the 60 s window as one long job. Parts are sent one after another (the service takes one
 * at a time, so each is about a minute of its time), each with the smaller of the part timeout and what is left of the
 * note's time limit. A part that finds the service down or restarting is tried once more; a silent part adds no words.
 * Never throws: any problem comes back as a failed envelope and the note continues down the cascade.
 */
export async function transcribeLongWithCentral(cfg: CentralSttConfig, call: CentralLongCall): Promise<TranscriptionEnvelope> {
  const startedAt = Date.now();
  const timeLeft = () => call.deadlineMs - (Date.now() - startedAt);
  let parts: Array<{ data: Buffer; filename: string }>;
  if (call.durationSeconds <= cfg.chunkSeconds * 1.2) {
    parts = [{ data: call.data, filename: call.filename }];
  } else {
    try {
      parts = await call.split(call.data, call.filename, call.durationSeconds, cfg.chunkSeconds, call.signal);
    } catch (err) {
      if (call.signal?.aborted) return failure("network", "transcription was cancelled");
      return failure("split_failed", `could not cut the note into parts: ${(err as Error).message.slice(0, 120)}`);
    }
    if (parts.length === 0) return failure("split_failed", "cutting the note produced no parts");
  }
  console.log(`[transcribe] central long job: ${Math.round(call.durationSeconds)}s audio, ${parts.length} part(s) on ${call.model}, up to ${Math.round(call.deadlineMs / 1000)}s`);
  const texts: string[] = [];
  let kept = 0;
  for (const [index, part] of parts.entries()) {
    const cached = await call.partCache?.get(index, parts.length).catch(() => null);
    if (cached !== null && cached !== undefined) {
      texts.push(cached);
      kept += 1;
      call.onProgress?.(Math.round(((index + 1) / parts.length) * 100));
      continue;
    }
    let result: TranscriptionEnvelope | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const left = timeLeft();
      if (left <= 1_000) {
        return failure("timeout", `central transcription did not finish the note within ${Math.round(call.deadlineMs / 1000)} s`);
      }
      result = await transcribeWithCentral(
        { ...cfg, timeoutMs: Math.min(cfg.partTimeoutMs, left) },
        { data: part.data, filename: part.filename, model: call.model, language: call.language, ...(call.signal ? { signal: call.signal } : {}), ...(call.fetchImpl ? { fetchImpl: call.fetchImpl } : {}) },
      );
      const retryable = !result.success && (result.providerCode === "network" || result.providerCode === "http_5xx") && !call.signal?.aborted;
      if (!retryable) break;
      await wait(cfg.retryDelayMs, call.signal);
    }
    if (!result) return failure("network", "central transcription gave no result");
    if (result.success) texts.push(result.transcript ?? "");
    else if (result.providerCode === "empty") texts.push("");
    else return result;
    await call.partCache?.put(index, parts.length, texts[texts.length - 1]!).catch(() => undefined);
    call.onProgress?.(Math.round(((index + 1) / parts.length) * 100));
  }
  const transcript = texts.map((t) => t.trim()).filter(Boolean).join(" ");
  if (!transcript) return failure("empty", "central transcription returned empty text");
  console.log(`[transcribe] central long job done: ${Math.round(call.durationSeconds)}s audio in ${Math.round((Date.now() - startedAt) / 1000)}s, ${parts.length} part(s)${kept ? `, ${kept} kept from an earlier try` : ""}`);
  await call.partCache?.clear().catch(() => undefined);
  return { success: true, transcript, provider: `central faster-whisper ${call.model}` };
}

/** The result of a note that skipped the service because of the cooldown (still one alarm line, it pays again). */
export function centralCooldownResult(): TranscriptionEnvelope {
  return failure("cooldown", "central transcription is cooling down after a failure");
}

/** The one alarm line per fallback (kind `transcribe`), counted by the health page. */
export function centralFallbackAlarm(result: TranscriptionEnvelope, model: string, durationSeconds: number | null | undefined): void {
  opsAlert("transcribe", "central_fallback", {
    reason: result.providerCode ?? "error",
    cause: (result as { cause?: string }).cause,
    model,
    ...(result.httpStatus !== undefined ? { status: result.httpStatus } : {}),
    ...(durationSeconds ? { secs: Math.round(durationSeconds) } : {}),
  });
}

/**
 * One reachability check at boot (GET /health on the same host), logged as `[central-stt] reachable` or
 * `[central-stt] unreachable cause=<code>`, so each container (zenod-mt, Phylax) says whether it can reach vps3
 * over the tailnet without waiting for a voice note. Never throws.
 */
export async function probeCentralStt(cfg: CentralSttConfig | null = centralSttConfig(), fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!cfg) return false;
  let healthUrl: string;
  try {
    healthUrl = new URL("/health", cfg.url).toString();
  } catch {
    return false;
  }
  try {
    const response = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(5_000) });
    const ok = response.ok;
    console.log(ok ? "[central-stt] reachable" : `[central-stt] unreachable status=${response.status}`);
    return ok;
  } catch (err) {
    console.warn(`[central-stt] unreachable cause=${networkCauseCode(err)}`);
    return false;
  }
}
