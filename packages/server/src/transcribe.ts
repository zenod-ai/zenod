import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Audio transcription. Two engines:
 *
 * 1. Groq cloud STT (whisper-large-v3-turbo) — used when GROQ_API_KEY is set.
 *    ~200x realtime, so an hour of audio takes seconds instead of pinning the
 *    server's CPUs for half an hour. Audio is compressed to 16 kHz mono FLAC
 *    (what Groq resamples to anyway) to stay under the 25 MB free-tier upload
 *    cap; anything still larger is split into segments and stitched back.
 *
 * 2. Local whisper.cpp — the default and the fallback when Groq is missing,
 *    rate-limited, or down. No cloud, no API key, no per-minute cost: the same
 *    ffmpeg → 16 kHz mono WAV → whisper-cli flow as our standalone
 *    local_whisper service, run in-process. The model is downloaded once to
 *    the persistent /data volume so it survives redeploys.
 *
 * All knobs are env-overridable for self-hosters on smaller boxes:
 *   GROQ_API_KEY           (unset: local-only)
 *   ZENOD_GROQ_STT_MODEL   (default: whisper-large-v3-turbo)
 *   ZENOD_WHISPER_BINARY   (default: whisper-cli, on PATH in the image)
 *   ZENOD_WHISPER_MODEL    (default: large-v3-turbo)
 *   ZENOD_WHISPER_MODEL_DIR(default: /data/models)
 *   ZENOD_WHISPER_LANGUAGE (default: auto — detects the spoken language per file)
 *   ZENOD_WHISPER_THREADS  (default: 4)
 */

export interface TranscriptionEnvelope {
  success: boolean;
  transcript?: string;
  provider?: string;
  error?: string;
}

/** Selectable transcription quality — speed vs accuracy, with download size. */
export interface WhisperModelInfo {
  id: string;
  label: string;
  note: string;
  sizeMb: number;
}

export const WHISPER_MODELS: WhisperModelInfo[] = [
  { id: "base", label: "Base", note: "Fastest, lowest accuracy.", sizeMb: 142 },
  { id: "small", label: "Small", note: "Fast, solid multilingual — best speed/quality tradeoff.", sizeMb: 466 },
  { id: "medium", label: "Medium", note: "More accurate, noticeably slower.", sizeMb: 1530 },
  { id: "large-v3-turbo", label: "Large v3 Turbo", note: "Top accuracy, fast for its size; heavy on a small server.", sizeMb: 1560 },
  { id: "large-v3", label: "Large v3", note: "Max accuracy, slowest.", sizeMb: 3100 },
];

export const DEFAULT_WHISPER_MODEL = process.env.ZENOD_WHISPER_MODEL ?? "large-v3-turbo";

export function isValidWhisperModel(model: string): boolean {
  return WHISPER_MODELS.some((m) => m.id === model);
}

export function resolveWhisperModel(model: string | null | undefined = DEFAULT_WHISPER_MODEL): string {
  return model && isValidWhisperModel(model) ? model : "large-v3-turbo";
}

const WHISPER_BINARY = process.env.ZENOD_WHISPER_BINARY ?? "whisper-cli";
const MODEL_DIR = process.env.ZENOD_WHISPER_MODEL_DIR ?? "/data/models";
const LANGUAGE = process.env.ZENOD_WHISPER_LANGUAGE ?? "auto";
const THREADS = process.env.ZENOD_WHISPER_THREADS ?? "4";
const GROQ_STT_MODEL = process.env.ZENOD_GROQ_STT_MODEL ?? "whisper-large-v3-turbo";
const GROQ_STT_URL = process.env.ZENOD_GROQ_BASE_URL
  ? `${process.env.ZENOD_GROQ_BASE_URL.replace(/\/$/, "")}/audio/transcriptions`
  : "https://api.groq.com/openai/v1/audio/transcriptions";
// Groq's free tier rejects uploads over 25 MB; stay safely under it whether
// they count decimal or binary megabytes (multipart overhead included).
const GROQ_MAX_UPLOAD_BYTES = 23_000_000;
// Segment length for Groq uploads. We chunk by time even when the compressed
// file is below the upload cap: long single requests can hit endpoint timeouts,
// and chunking gives the UI meaningful progress.
const GROQ_SEGMENT_SECONDS = "900";
const GROQ_MAX_RETRY_ATTEMPTS = 3;
const GROQ_MAX_RETRY_AFTER_SECONDS = 180;
// Canonical ggml model host — same source local_whisper's download script uses.
const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
}

function modelPath(model: string): string {
  return join(MODEL_DIR, `ggml-${model}.bin`);
}

// Per-model download state, keyed by model id — switching quality downloads a
// different ggml file; both live on the volume. The UI polls this so the
// (one-time, per-model) fetch shows as setup progress, not a first-ingest stall.
interface ModelState {
  download: Promise<void> | null;
  downloading: boolean;
  progress: number; // 0–100 of the download
  error: string | null;
}
const modelStates = new Map<string, ModelState>();

function stateFor(model: string): ModelState {
  let s = modelStates.get(model);
  if (!s) {
    s = { download: null, downloading: false, progress: 0, error: null };
    modelStates.set(model, s);
  }
  return s;
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

/** Ensure the ggml model is present on the volume, downloading it once. */
async function ensureModel(model: string): Promise<string> {
  const dest = modelPath(model);
  if (await fileExists(dest)) return dest;
  const s = stateFor(model);
  if (!s.download) {
    s.downloading = true;
    s.progress = 0;
    s.error = null;
    s.download = downloadModel(model, dest)
      .then(() => {
        s.downloading = false;
        s.progress = 100;
      })
      .catch((err) => {
        s.downloading = false;
        s.error = (err as Error).message;
        s.download = null; // let a later attempt retry
        throw err;
      });
  }
  await s.download;
  return dest;
}

/**
 * Kick off the model download outside any chat turn — call on boot, on Drive
 * connect, and when the quality is changed, so the fetch to the /data volume
 * happens during setup rather than surprising the first ingest. Fire-and-forget.
 */
export async function prepareModel(model = DEFAULT_WHISPER_MODEL): Promise<void> {
  // Never auto-download in fake/test mode (vitest sets VITEST).
  if (process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT || process.env.VITEST) return;
  const modelName = resolveWhisperModel(model);
  try {
    await ensureModel(modelName);
  } catch {
    // already recorded in state and logged; a later ingest retries
  }
}

export interface TranscriptionStatus {
  model: string;
  ready: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
}

export async function transcriptionStatus(model = DEFAULT_WHISPER_MODEL): Promise<TranscriptionStatus> {
  const modelName = resolveWhisperModel(model);
  const ready = await fileExists(modelPath(modelName));
  const s = stateFor(modelName);
  return { model: modelName, ready, downloading: s.downloading, progress: s.progress, error: s.error };
}

async function downloadModel(model: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const url = `${MODEL_BASE_URL}/ggml-${model}.bin`;
  console.log(`[whisper] downloading model ${model} from ${url}…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`model download failed (${response.status}) from ${url}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  const s = stateFor(model);
  let received = 0;
  const track = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (total > 0) s.progress = Math.min(99, Math.round((received / total) * 100));
      controller.enqueue(chunk);
    },
  });
  // Download to a temp name, then atomic rename, so a crash mid-download
  // never leaves a truncated model that whisper would choke on.
  const tmp = `${dest}.part`;
  const tracked = response.body.pipeThrough(track);
  await pipeline(Readable.fromWeb(tracked as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
  await rename(tmp, dest);
  console.log(`[whisper] model ${model} ready at ${dest}`);
}

function run(
  command: string,
  args: string[],
  opts: { onStderrLine?: (line: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const { onStderrLine, signal } = opts;
  return new Promise((resolve, reject) => {
    // The signal option makes Node kill the child (SIGTERM) on abort — that's
    // how a Cancel from the UI stops a long whisper run mid-file.
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], ...(signal ? { signal } : {}) });
    let stderr = "";
    let lineBuf = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (!onStderrLine) return;
      lineBuf += text;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        onStderrLine(lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
      }
    });
    child.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${command} is not installed in this image`)
          : err,
      ),
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}): ${stderr.slice(-400)}`)),
    );
  });
}

/** whisper-cli with --print-progress emits "... progress = N%" on stderr. */
function parseWhisperProgress(line: string): number | null {
  const m = /progress\s*=\s*(\d+)\s*%/.exec(line);
  return m ? Number(m[1]) : null;
}

/** POST one audio file to Groq's OpenAI-compatible transcription endpoint. */
class GroqTranscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
  }
}

function parseRetryAfterSeconds(response: Response, body: string): number | null {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  const match = /try again in\s+(\d+)s/i.exec(body);
  return match ? Number(match[1]) : null;
}

async function groqTranscribeFile(path: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([await readFile(path)]), "audio.flac");
  form.append("model", GROQ_STT_MODEL);
  form.append("response_format", "text");
  if (LANGUAGE !== "auto") form.append("language", LANGUAGE);
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(GROQ_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 400);
    throw new GroqTranscriptionError(
      `groq transcription failed (${response.status}): ${body}`,
      response.status,
      parseRetryAfterSeconds(response, body),
    );
  }
  return (await response.text()).trim();
}

async function groqTranscribeFileWithRetry(path: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await groqTranscribeFile(path, apiKey, signal);
    } catch (err) {
      if (!(err instanceof GroqTranscriptionError) || err.status !== 429) throw err;
      const retryAfter = err.retryAfterSeconds;
      if (
        retryAfter === null ||
        retryAfter > GROQ_MAX_RETRY_AFTER_SECONDS ||
        attempt >= GROQ_MAX_RETRY_ATTEMPTS
      ) {
        throw err;
      }
      console.warn(`[transcribe] groq rate limited; retrying in ${retryAfter}s`);
      await sleep((retryAfter + 1) * 1000, undefined, { signal });
    }
  }
}

/**
 * Transcribe via Groq. ffmpeg compresses to 16 kHz mono FLAC first (lossless
 * at the sample rate Groq resamples to, ~4x smaller than WAV), then splits
 * into fixed-length segments transcribed in order. Short 429 rate limits are
 * retried; other failures throw so the caller can fall back to local whisper.
 */
async function transcribeWithGroq(
  data: Buffer,
  filename: string,
  apiKey: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<TranscriptionEnvelope> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-groq-"));
  const input = join(dir, `in${extname(filename) || ".m4a"}`);
  const flac = join(dir, "audio.flac");
  try {
    await writeFile(input, data);
    await run("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-map", "0:a:0", "-c:a", "flac", flac], { signal });
    await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        flac,
        "-f",
        "segment",
        "-segment_time",
        GROQ_SEGMENT_SECONDS,
        "-reset_timestamps",
        "1",
        "-c:a",
        "flac",
        join(dir, "seg%04d.flac"),
      ],
      { signal },
    );
    const parts = (await readdir(dir)).filter((f) => f.startsWith("seg")).sort().map((f) => join(dir, f));
    if (parts.length === 0) throw new Error("segmenting audio produced no chunks");
    for (const part of parts) {
      const { size } = await stat(part);
      if (size > GROQ_MAX_UPLOAD_BYTES) {
        throw new Error(`groq segment exceeds upload cap (${Math.round(size / 1_000_000)} MB)`);
      }
    }
    const texts: string[] = [];
    for (const [i, part] of parts.entries()) {
      texts.push(await groqTranscribeFileWithRetry(part, apiKey, signal));
      onProgress?.(Math.round(((i + 1) / parts.length) * 100));
    }
    const transcript = texts.join(" ").trim();
    if (!transcript) throw new Error("groq transcription returned empty text");
    return { success: true, transcript, provider: `groq ${GROQ_STT_MODEL}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Transcribe an audio buffer locally. ffmpeg normalizes to the 16 kHz mono
 * WAV whisper.cpp expects (any size — it's local, no upload cap), then
 * whisper-cli writes a .txt we read back.
 */
export async function transcribeAudio(
  data: Buffer,
  filename: string,
  options:
    | { model?: string; groqApiKey?: string | null; onProgress?: (percent: number) => void; signal?: AbortSignal }
    | ((percent: number) => void) = {},
): Promise<TranscriptionEnvelope> {
  const modelName = resolveWhisperModel(typeof options === "function" ? DEFAULT_WHISPER_MODEL : options.model);
  const onProgress = typeof options === "function" ? options : options.onProgress;
  const signal = typeof options === "function" ? undefined : options.signal;
  // The durable setting (UI-pasted, env-seeded on first boot) wins; the raw
  // env var keeps standalone/test use working without a settings store.
  const groqApiKey = (typeof options === "function" ? undefined : options.groqApiKey) ?? process.env.GROQ_API_KEY;
  if ((process.env.NODE_ENV === "test" || process.env.VITEST) && process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT) {
    onProgress?.(100);
    return {
      success: true,
      transcript: process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT,
      provider: groqApiKey ? `groq ${GROQ_STT_MODEL}` : `whisper.cpp ${modelName}`,
    };
  }

  // Groq first when configured — seconds instead of minutes, and it doesn't
  // pin the server's CPUs. Any failure (rate limit, network, oversized chunk)
  // falls through to local whisper.cpp so transcription still works offline.
  if (groqApiKey) {
    try {
      return await transcribeWithGroq(data, filename, groqApiKey, onProgress, signal);
    } catch (err) {
      if (signal?.aborted) return { success: false, provider: "groq", error: (err as Error).message };
      console.warn(`[transcribe] groq failed, falling back to whisper.cpp: ${(err as Error).message}`);
    }
  }

  let model: string;
  try {
    model = await ensureModel(modelName);
  } catch (err) {
    return { success: false, provider: "whisper.cpp", error: `model unavailable: ${(err as Error).message}` };
  }

  const dir = await mkdtemp(join(tmpdir(), "zenod-whisper-"));
  const input = join(dir, `in${extname(filename) || ".m4a"}`);
  const wav = join(dir, "audio.wav");
  const outBase = join(dir, "out");
  try {
    await writeFile(input, data);
    await run("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { signal });
    await run(WHISPER_BINARY, ["-m", model, "-f", wav, "-l", LANGUAGE, "-t", THREADS, "-pp", "-otxt", "-of", outBase], {
      signal,
      onStderrLine: onProgress
        ? (line) => {
            const pct = parseWhisperProgress(line);
            if (pct !== null) onProgress(pct);
          }
        : undefined,
    });
    const transcript = (await readFile(`${outBase}.txt`, "utf8")).trim();
    if (!transcript) {
      return { success: false, provider: "whisper.cpp", error: "transcription returned empty text" };
    }
    return { success: true, transcript, provider: `whisper.cpp ${modelName}` };
  } catch (err) {
    return { success: false, provider: "whisper.cpp", error: (err as Error).message };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
