import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

/**
 * Audio transcription for the Drive ingestion flow (docs/ROADMAP.md M1.5):
 * a provider envelope over Whisper-compatible APIs — Groq's
 * whisper-large-v3-turbo when a Groq key is configured, else OpenAI's
 * whisper-1. Files above the API size limit are first downsampled to 16 kHz
 * mono with ffmpeg (~10x smaller), which voice notes tolerate fine.
 */

export interface TranscriptionEnvelope {
  success: boolean;
  transcript?: string;
  provider?: string;
  error?: string;
}

export interface TranscriptionKey {
  provider: "groq" | "openai";
  apiKey: string;
}

const PROVIDERS = {
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
} as const;

/** Both APIs reject uploads above ~25 MB; downsample anything close to it. */
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
}

/** 16 kHz mono 32 kbps mp3 — the Whisper input format, ~10x smaller than a phone voice note. */
async function downsample(data: Buffer, filename: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-audio-"));
  const input = join(dir, `in${extname(filename) || ".m4a"}`);
  const output = join(dir, "out.mp3");
  try {
    await writeFile(input, data);
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-b:a", "32k", output], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      ffmpeg.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      ffmpeg.on("error", (err) =>
        reject(
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? new Error("ffmpeg is not installed on this server — required to shrink audio over 24 MB")
            : err,
        ),
      );
      ffmpeg.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(-300)}`)),
      );
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function transcribeAudio(
  data: Buffer,
  filename: string,
  key: TranscriptionKey | null,
): Promise<TranscriptionEnvelope> {
  if (!key) {
    return {
      success: false,
      error:
        "no transcription key configured — add a Groq API key (free tier works) or an OpenAI API key in settings",
    };
  }
  const { url, model } = PROVIDERS[key.provider];

  try {
    let upload = data;
    let uploadName = filename;
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      upload = await downsample(data, filename);
      uploadName = `${filename}.mp3`;
      if (upload.byteLength > MAX_UPLOAD_BYTES) {
        return { success: false, provider: key.provider, error: "audio is still over 24 MB after downsampling" };
      }
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(upload)]), uploadName);
    form.append("model", model);
    form.append("response_format", "json");

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        success: false,
        provider: key.provider,
        error: `${key.provider} transcription failed (${response.status}): ${detail.slice(0, 200)}`,
      };
    }
    const result = (await response.json()) as { text?: string };
    if (!result.text || result.text.trim() === "") {
      return { success: false, provider: key.provider, error: "transcription returned empty text" };
    }
    return { success: true, transcript: result.text.trim(), provider: key.provider };
  } catch (err) {
    return { success: false, provider: key.provider, error: (err as Error).message };
  }
}
