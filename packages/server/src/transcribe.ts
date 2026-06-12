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

const WHISPER_BINARY = process.env.ZENOD_WHISPER_BINARY ?? "whisper-cli";
const MODEL_NAME = process.env.ZENOD_WHISPER_MODEL ?? "large-v3-turbo";
const MODEL_DIR = process.env.ZENOD_WHISPER_MODEL_DIR ?? "/data/models";
const LANGUAGE = process.env.ZENOD_WHISPER_LANGUAGE ?? "auto";
const THREADS = process.env.ZENOD_WHISPER_THREADS ?? "4";
// Canonical ggml model host — same source local_whisper's download script uses.
const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
}

function modelPath(): string {
  return join(MODEL_DIR, `ggml-${MODEL_NAME}.bin`);
}

// One in-flight download shared across concurrent ingests, plus status the
// setup UI can poll so the model is fetched at setup, not on the first chat.
let modelDownload: Promise<void> | null = null;
let modelReady = false;
let modelDownloading = false;
let modelError: string | null = null;

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

/** Ensure the ggml model is present on the volume, downloading it once. */
async function ensureModel(): Promise<string> {
  const dest = modelPath();
  if (modelReady) return dest;
  if (await fileExists(dest)) {
    modelReady = true;
    return dest;
  }
  if (!modelDownload) {
    modelDownloading = true;
    modelError = null;
    modelDownload = downloadModel(dest)
      .then(() => {
        modelReady = true;
        modelDownloading = false;
      })
      .catch((err) => {
        modelDownloading = false;
        modelError = (err as Error).message;
        modelDownload = null; // let a later attempt retry
        throw err;
      });
  }
  await modelDownload;
  return dest;
}

/**
 * Kick off the model download outside any chat turn — call on boot and when
 * Drive is connected so the (one-time, ~1.5 GB) fetch to the /data volume
 * happens during setup rather than surprising the first ingest. Fire-and-forget.
 */
export async function prepareModel(): Promise<void> {
  // Never auto-download in fake/test mode (vitest sets VITEST) — a 1.5 GB
  // fetch has no place in a unit run.
  if (process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT || process.env.VITEST) return;
  try {
    await ensureModel();
  } catch {
    // already recorded in modelError and logged; a later ingest retries
  }
}

export interface TranscriptionStatus {
  model: string;
  ready: boolean;
  downloading: boolean;
  error: string | null;
}

export async function transcriptionStatus(): Promise<TranscriptionStatus> {
  const ready = modelReady || (await fileExists(modelPath()));
  if (ready) modelReady = true;
  return { model: MODEL_NAME, ready, downloading: modelDownloading, error: modelError };
}

async function downloadModel(dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const url = `${MODEL_BASE_URL}/ggml-${MODEL_NAME}.bin`;
  console.log(`[whisper] downloading model ${MODEL_NAME} (first run, ~once) from ${url}…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`model download failed (${response.status}) from ${url}`);
  }
  // Download to a temp name, then atomic rename, so a crash mid-download
  // never leaves a truncated model that whisper would choke on.
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
  await rename(tmp, dest);
  console.log(`[whisper] model ready at ${dest}`);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
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

/**
 * Transcribe an audio buffer locally. ffmpeg normalizes to the 16 kHz mono
 * WAV whisper.cpp expects (any size — it's local, no upload cap), then
 * whisper-cli writes a .txt we read back.
 */
export async function transcribeAudio(data: Buffer, filename: string): Promise<TranscriptionEnvelope> {
  if ((process.env.NODE_ENV === "test" || process.env.VITEST) && process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT) {
    return {
      success: true,
      transcript: process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT,
      provider: `whisper.cpp ${MODEL_NAME}`,
    };
  }

  let model: string;
  try {
    model = await ensureModel();
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
    await run(WHISPER_BINARY, ["-m", model, "-f", wav, "-l", LANGUAGE, "-t", THREADS, "-otxt", "-of", outBase]);
    const transcript = (await readFile(`${outBase}.txt`, "utf8")).trim();
    if (!transcript) {
      return { success: false, provider: "whisper.cpp", error: "transcription returned empty text" };
    }
    return { success: true, transcript, provider: `whisper.cpp ${MODEL_NAME}` };
  } catch (err) {
    return { success: false, provider: "whisper.cpp", error: (err as Error).message };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
