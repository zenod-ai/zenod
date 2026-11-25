import type { LlmUsageReport } from "zenod";

import type { TranscriptPartCache } from "./centralTranscription.js";
import type { TranscriptionEnvelope } from "./transcribe.js";

/**
 * EPIC-20 A10 (Jordi, WhatsApp voice note 24 Nov 2026 20:37Z: "can we use 11labs for the transcription by default
 * for all transcription across the board? I think for 11labs we definitely can share across our customers"):
 * ElevenLabs speech-to-text is the first provider for every tenant when the one shared key ELEVENLABS_API_KEY is set
 * (zenod-mt and Phylax read the same env). Unset, nothing here runs and the cascade is exactly today's.
 *
 * A note up to about 6 minutes is one call. A longer note is cut into the same ~5 minute parts as the central long job
 * (EPIC-24 M36/M38 splitter), each part kept on the data volume once written, so a deploy mid-note costs one part. A
 * part ElevenLabs fails (4xx, 5xx, network, empty) goes down today's chain for that part only; the other parts stay
 * ElevenLabs'. Every ElevenLabs call is one `llm_usage` row (provider `elevenlabs`, estimated cost per audio minute),
 * so the tenant's usage ledger and spend cap see it.
 *
 * Env: ELEVENLABS_API_KEY (unset: off) · ZENOD_ELEVENLABS_STT=0 (off switch with the key kept) ·
 * ZENOD_ELEVENLABS_STT_MODEL (default scribe_v1) · ZENOD_ELEVENLABS_STT_URL · ZENOD_ELEVENLABS_STT_TIMEOUT_MS.
 */
export const ELEVENLABS_STT_DEFAULT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const ELEVENLABS_STT_DEFAULT_MODEL = "scribe_v1";
/** Base time limit per call; a part adds half a second per second of audio on top. */
export const ELEVENLABS_STT_BASE_TIMEOUT_MS = 120_000;
/** USD per audio hour, ElevenLabs' published API rate for Scribe; used only as the ledger's estimate. */
export const ELEVENLABS_STT_USD_PER_HOUR = 0.4;

export interface ElevenLabsSttConfig {
  apiKey: string;
  url: string;
  model: string;
  baseTimeoutMs: number;
}

export function elevenLabsSttConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsSttConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey || env.ZENOD_ELEVENLABS_STT === "0") return null;
  const timeout = Number(env.ZENOD_ELEVENLABS_STT_TIMEOUT_MS);
  return {
    apiKey,
    url: env.ZENOD_ELEVENLABS_STT_URL?.trim() || ELEVENLABS_STT_DEFAULT_URL,
    model: env.ZENOD_ELEVENLABS_STT_MODEL?.trim() || ELEVENLABS_STT_DEFAULT_MODEL,
    baseTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : ELEVENLABS_STT_BASE_TIMEOUT_MS,
  };
}

/** One boot line per container (names only, never the key): `[elevenlabs-stt] on model=…` or `[elevenlabs-stt] off`. */
export function logElevenLabsSttState(env: NodeJS.ProcessEnv = process.env): void {
  const cfg = elevenLabsSttConfig(env);
  console.log(cfg ? `[elevenlabs-stt] on model=${cfg.model}` : "[elevenlabs-stt] off (no ELEVENLABS_API_KEY)");
}

export function estimateElevenLabsUsd(seconds: number | null): number {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return (seconds / 3600) * ELEVENLABS_STT_USD_PER_HOUR;
}

const CREDIT_CODES = new Set(["quota_exceeded", "insufficient_credits", "payment_required", "subscription_inactive"]);
const AUTH_CODES = new Set(["invalid_api_key", "missing_permissions", "unauthorized", "needs_authorization"]);

/** ElevenLabs answers errors as `{ "detail": { "status": "quota_exceeded", "message": "…" } }` (or a plain string detail). */
export function parseElevenLabsError(body: string): { code?: string; message?: string } {
  try {
    const json = JSON.parse(body) as { detail?: unknown };
    const detail = json?.detail;
    if (typeof detail === "string") return { message: detail };
    if (detail && typeof detail === "object") {
      const d = detail as Record<string, unknown>;
      return {
        ...(typeof d.status === "string" ? { code: d.status } : {}),
        ...(typeof d.message === "string" ? { message: d.message } : {}),
      };
    }
  } catch {
    // plain text body
  }
  return body.trim() ? { message: body.trim() } : {};
}

function clean(text: string, max = 200): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function elevenLabsFailureFromResponse(status: number, body: string): TranscriptionEnvelope {
  const parsed = parseElevenLabsError(body);
  const code = parsed.code?.toLowerCase();
  const failureReason: TranscriptionEnvelope["failureReason"] =
    status === 402 || (code && CREDIT_CODES.has(code))
      ? "provider_credit_exhausted"
      : status === 401 || status === 403 || (code && AUTH_CODES.has(code))
        ? "provider_auth_failed"
        : status === 429
          ? "provider_rate_limited"
          : "provider_unavailable";
  return {
    success: false,
    provider: "elevenlabs",
    error: `elevenlabs transcription failed (${status}${code ? ` ${code}` : ""}): ${clean(parsed.message ?? "")}`,
    failureReason,
    httpStatus: status,
    ...(code ? { providerCode: code } : {}),
  };
}

export interface ElevenLabsCall {
  data: Buffer;
  filename: string;
  /** "auto" (or empty) lets ElevenLabs detect the language. */
  language?: string;
  /** Seconds of audio in this call, when known: sets the time limit and the ledger's estimate. */
  seconds?: number | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function mimeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return (
    {
      mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4",
      wav: "audio/wav", webm: "audio/webm", flac: "audio/flac", aac: "audio/aac", amr: "audio/amr",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

/** EPIC-24 M41: the per-call time limit in whole milliseconds (base plus half a second per second of audio). */
export function elevenLabsTimeoutMs(baseTimeoutMs: number, seconds: number | null | undefined): number {
  const extra = Number.isFinite(seconds) ? Math.max(0, seconds as number) * 500 : 0;
  return Math.max(1, Math.ceil(baseTimeoutMs + extra));
}

/** One ElevenLabs speech-to-text call. Never throws: every failure is an envelope with provider `elevenlabs`. */
export async function transcribeWithElevenLabs(cfg: ElevenLabsSttConfig, call: ElevenLabsCall): Promise<TranscriptionEnvelope> {
  // EPIC-24 M41: AbortSignal.timeout takes whole milliseconds only. A probed length is fractional (150.006 s), so
  // `base + seconds * 500` was 195003.25 and threw a RangeError before any request, outside this function's try:
  // every Phylax voice note failed with reason "unknown" and no provider from 25 Nov 14:47Z. Rounded up, and
  // everything that can throw now sits inside the try, so this function keeps its promise never to throw.
  const timeoutMs = elevenLabsTimeoutMs(cfg.baseTimeoutMs, call.seconds);
  let timeout: AbortSignal | undefined;
  try {
    const form = new FormData();
    form.append("file", new Blob([call.data], { type: mimeFor(call.filename) }), call.filename || "audio");
    form.append("model_id", cfg.model);
    // Words only: no "(laughter)" or "(music)" tags in a memory.
    form.append("tag_audio_events", "false");
    if (call.language && call.language !== "auto") form.append("language_code", call.language);
    timeout = AbortSignal.timeout(timeoutMs);
    const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
    const response = await (call.fetchImpl ?? fetch)(cfg.url, {
      method: "POST",
      headers: { "xi-api-key": cfg.apiKey },
      body: form,
      signal,
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) return elevenLabsFailureFromResponse(response.status, body.slice(0, 600));
    let text = "";
    try {
      const json = JSON.parse(body) as { text?: unknown };
      text = typeof json.text === "string" ? json.text.trim() : "";
    } catch {
      return { success: false, provider: "elevenlabs", error: "elevenlabs answered with a body that is not JSON", failureReason: "unknown", providerCode: "bad_reply" };
    }
    if (!text) return { success: false, provider: "elevenlabs", error: "transcription returned empty text", failureReason: "unknown", providerCode: "empty" };
    return { success: true, transcript: text, provider: `elevenlabs ${cfg.model}` };
  } catch (err) {
    if (call.signal?.aborted) return { success: false, provider: "elevenlabs", error: "transcription was cancelled", failureReason: "timeout" };
    if (timeout?.aborted) {
      return { success: false, provider: "elevenlabs", error: `elevenlabs did not answer within ${Math.round(timeoutMs / 1000)} s`, failureReason: "timeout", providerCode: "timeout" };
    }
    const cause = (err as { cause?: { code?: unknown } })?.cause?.code;
    if (!timeout) {
      // Thrown while building the request (step "request"), before anything was sent.
      return {
        success: false,
        provider: "elevenlabs",
        error: `elevenlabs request could not be built: ${clean(`${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`)}`,
        failureReason: "internal_error",
        providerCode: "request_build",
      };
    }
    return {
      success: false,
      provider: "elevenlabs",
      error: `elevenlabs request failed: ${clean((err as Error)?.message ?? String(err))}`,
      failureReason: "network_error",
      providerCode: typeof cause === "string" ? cause : "network",
    };
  }
}

export interface ElevenLabsFirstCall {
  data: Buffer;
  filename: string;
  language?: string;
  /** The note's length; null when it could not be probed (then it goes as one call). */
  durationSeconds: number | null;
  /** Part length (the central long job's, ~5 min); a note up to 1.2 times this is one call. */
  chunkSeconds: number;
  split: (data: Buffer, filename: string, durationSeconds: number, chunkSeconds: number, signal?: AbortSignal) => Promise<Array<{ data: Buffer; filename: string }>>;
  /** Today's chain (central, then the tenant's providers), run on the whole note or on one failed part. */
  fallback: (data: Buffer, filename: string, durationSeconds: number | null) => Promise<TranscriptionEnvelope>;
  partCache?: TranscriptPartCache;
  onUsage?: (report: LlmUsageReport) => void;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function meter(onUsage: ElevenLabsFirstCall["onUsage"], model: string, result: TranscriptionEnvelope, seconds: number | null): void {
  if (!onUsage) return;
  try {
    onUsage({
      operation: "transcribe",
      provider: "elevenlabs",
      model,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      status: result.success ? "succeeded" : "failed",
      errorCode: result.success ? null : result.providerCode ?? result.failureReason ?? "unknown",
      // A refused call is not billed.
      estimatedCostUsd: result.success ? estimateElevenLabsUsd(seconds) : 0,
    });
  } catch (err) {
    console.warn(`[transcribe] could not record elevenlabs usage: ${(err as Error).message}`);
  }
}

function logFailure(result: TranscriptionEnvelope, what: string): void {
  // The health page reads this line (row 19 AI credit): provider name, status and ElevenLabs' code, never the key.
  console.warn(`[transcribe] ${result.error ?? "elevenlabs failed"} (${what}), using the next provider`);
}

/**
 * ElevenLabs first, today's chain behind it. Short note: one call, any failure sends the whole note down the chain.
 * Long note: parts; a failed part goes down the chain on its own; a part the chain also fails ends the note with that
 * failure (parts already written stay on disk for the next try).
 */
export async function transcribeElevenLabsFirst(cfg: ElevenLabsSttConfig, call: ElevenLabsFirstCall): Promise<TranscriptionEnvelope> {
  const { durationSeconds: seconds, signal } = call;
  const one = (data: Buffer, filename: string, partSeconds: number | null) =>
    transcribeWithElevenLabs(cfg, {
      data,
      filename,
      seconds: partSeconds,
      ...(call.language ? { language: call.language } : {}),
      ...(signal ? { signal } : {}),
      ...(call.fetchImpl ? { fetchImpl: call.fetchImpl } : {}),
    });

  if (!seconds || seconds <= call.chunkSeconds * 1.2) {
    const result = await one(call.data, call.filename, seconds);
    meter(call.onUsage, cfg.model, result, seconds);
    if (result.success || signal?.aborted) {
      if (result.success) call.onProgress?.(100);
      return result;
    }
    logFailure(result, seconds ? `${Math.round(seconds)}s note` : "note");
    return call.fallback(call.data, call.filename, seconds);
  }

  let parts: Array<{ data: Buffer; filename: string }>;
  try {
    parts = await call.split(call.data, call.filename, seconds, call.chunkSeconds, signal);
  } catch (err) {
    if (signal?.aborted) return { success: false, provider: "elevenlabs", error: "transcription was cancelled", failureReason: "timeout" };
    console.warn(`[transcribe] could not cut the note into parts for elevenlabs, using the next provider: ${clean((err as Error).message, 120)}`);
    return call.fallback(call.data, call.filename, seconds);
  }
  if (parts.length === 0) return call.fallback(call.data, call.filename, seconds);

  const totalBytes = parts.reduce((sum, p) => sum + p.data.length, 0) || 1;
  const startedAt = Date.now();
  console.log(`[transcribe] elevenlabs long job: ${Math.round(seconds)}s audio, ${parts.length} part(s) on ${cfg.model}`);
  const texts: string[] = [];
  const fellBack: string[] = [];
  let kept = 0;
  for (const [index, part] of parts.entries()) {
    const cached = await call.partCache?.get(index, parts.length).catch(() => null);
    if (cached !== null && cached !== undefined) {
      texts.push(cached);
      kept += 1;
      call.onProgress?.(Math.round(((index + 1) / parts.length) * 100));
      continue;
    }
    // Parts are constant-bitrate MP3, so bytes give each part's share of the note.
    const partSeconds = (seconds * part.data.length) / totalBytes;
    const result = await one(part.data, part.filename, partSeconds);
    meter(call.onUsage, cfg.model, result, partSeconds);
    let text: string | null;
    if (result.success) text = result.transcript ?? "";
    else if (signal?.aborted) return result;
    else if (result.providerCode === "empty") text = "";
    else {
      logFailure(result, `part ${index + 1} of ${parts.length}`);
      const backup = await call.fallback(part.data, part.filename, partSeconds);
      if (backup.success) {
        text = backup.transcript ?? "";
        fellBack.push(String(backup.provider ?? "fallback").split(" ")[0]!);
      } else if (backup.noSpeech || backup.failureReason === "no_speech") text = "";
      else return backup;
    }
    texts.push(text);
    await call.partCache?.put(index, parts.length, text).catch(() => undefined);
    call.onProgress?.(Math.round(((index + 1) / parts.length) * 100));
  }
  const transcript = texts.map((t) => t.trim()).filter(Boolean).join(" ");
  if (!transcript) return { success: false, provider: "elevenlabs", error: "transcription returned empty text", failureReason: "unknown", providerCode: "empty" };
  console.log(
    `[transcribe] elevenlabs long job done: ${Math.round(seconds)}s audio in ${Math.round((Date.now() - startedAt) / 1000)}s, ${parts.length} part(s)` +
      `${kept ? `, ${kept} kept from an earlier try` : ""}${fellBack.length ? `, ${fellBack.length} via ${[...new Set(fellBack)].join("+")}` : ""}`,
  );
  await call.partCache?.clear().catch(() => undefined);
  const provider = fellBack.length
    ? `elevenlabs ${cfg.model} (${fellBack.length} of ${parts.length} parts via ${[...new Set(fellBack)].join("+")})`
    : `elevenlabs ${cfg.model}`;
  return { success: true, transcript, provider };
}
