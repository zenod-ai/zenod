import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Local audio transcription with whisper.cpp — no cloud, no API key, no
 * per-minute cost. The same ffmpeg → 16 kHz mono WAV → whisper-cli flow as
 * our standalone local_whisper service, run in-process (we already shell out
 * to ffmpeg). The model is downloaded once to the persistent /data volume so
 * it survives redeploys and never bloats the image.
 *
 * All knobs are env-overridable for self-hosters on smaller boxes:
 *   ZENOD_WHISPER_BINARY   (default: whisper-cli, on PATH in the image)
 *   ZENOD_WHISPER_MODEL    (default: large-v3-turbo)
 *   ZENOD_WHISPER_MODEL_DIR(default: /data/models)
 *   ZENOD_WHISPER_LANGUAGE (default: auto — detects es/ca/en per note)
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
  { id: "base", label: "Base", note: "Fastest. Rough on Catalan/Spanish.", sizeMb: 142 },
  { id: "small", label: "Small", note: "Fast, good multilingual — best speed/quality tradeoff.", sizeMb: 466 },
  { id: "medium", label: "Medium", note: "More accurate, noticeably slower.", sizeMb: 1530 },
  { id: "large-v3-turbo", label: "Large v3 Turbo", note: "Top accuracy, fast for its size; heavy on a small VPS.", sizeMb: 1560 },
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

function run(command: string, args: string[], onStderrLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
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

/**
 * Transcribe an audio buffer locally. ffmpeg normalizes to the 16 kHz mono
 * WAV whisper.cpp expects (any size — it's local, no upload cap), then
 * whisper-cli writes a .txt we read back.
 */
export async function transcribeAudio(
  data: Buffer,
  filename: string,
  options: { model?: string; onProgress?: (percent: number) => void } | ((percent: number) => void) = {},
): Promise<TranscriptionEnvelope> {
  const modelName = resolveWhisperModel(typeof options === "function" ? DEFAULT_WHISPER_MODEL : options.model);
  const onProgress = typeof options === "function" ? options : options.onProgress;
  if ((process.env.NODE_ENV === "test" || process.env.VITEST) && process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT) {
    onProgress?.(100);
    return {
      success: true,
      transcript: process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT,
      provider: `whisper.cpp ${modelName}`,
    };
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
    await run("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    await run(
      WHISPER_BINARY,
      ["-m", model, "-f", wav, "-l", LANGUAGE, "-t", THREADS, "-pp", "-otxt", "-of", outBase],
      onProgress
        ? (line) => {
            const pct = parseWhisperProgress(line);
            if (pct !== null) onProgress(pct);
          }
        : undefined,
    );
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
