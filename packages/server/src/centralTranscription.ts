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
 */
export const CENTRAL_STT_TURBO_MAX_SECONDS = 30;
export const CENTRAL_STT_SMALL_MAX_SECONDS = 90;

export interface CentralSttConfig {
  url: string;
  timeoutMs: number;
  turboMaxSeconds: number;
  smallMaxSeconds: number;
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

/**
 * The model for a note of this length, or null when it would not finish inside the timeout (the note then goes
 * straight to the paid provider instead of waiting 60 s for nothing). An unknown length tries turbo.
 */
export function centralSttModelFor(durationSeconds: number | null | undefined, cfg: CentralSttConfig): string | null {
  if (cfg.model) return cfg.model;
  if (durationSeconds === null || durationSeconds === undefined) return CENTRAL_STT_TURBO_MODEL;
  if (durationSeconds <= cfg.turboMaxSeconds) return CENTRAL_STT_TURBO_MODEL;
  if (durationSeconds <= cfg.smallMaxSeconds) return CENTRAL_STT_SMALL_MODEL;
  return null;
}

export type CentralSttFailureWord = "cooldown" | "timeout" | "network" | "http_4xx" | "http_5xx" | "empty" | "bad_reply";

function failure(reason: CentralSttFailureWord, error: string, httpStatus?: number): TranscriptionEnvelope {
  return {
    success: false,
    provider: "central",
    error,
    failureReason: reason === "timeout" ? "timeout" : reason === "network" ? "network_error" : "provider_unavailable",
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    providerCode: reason,
  };
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
    return failure("network", `central transcription unreachable: ${(err as Error).name}`);
  }
}

/** The result of a note that skipped the service because of the cooldown (still one alarm line, it pays again). */
export function centralCooldownResult(): TranscriptionEnvelope {
  return failure("cooldown", "central transcription is cooling down after a failure");
}

/** The one alarm line per fallback (kind `transcribe`), counted by the health page. */
export function centralFallbackAlarm(result: TranscriptionEnvelope, model: string, durationSeconds: number | null | undefined): void {
  opsAlert("transcribe", "central_fallback", {
    reason: result.providerCode ?? "error",
    model,
    ...(result.httpStatus !== undefined ? { status: result.httpStatus } : {}),
    ...(durationSeconds ? { secs: Math.round(durationSeconds) } : {}),
  });
}
