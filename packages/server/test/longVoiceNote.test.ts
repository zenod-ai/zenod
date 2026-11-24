import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MAX_VOICE_NOTE_SECONDS,
  centralSttConfig,
  maxVoiceNoteWords,
  resetCentralSttCooldown,
  transcribeLongWithCentral,
  voiceJobDeadlineForMs,
  type TranscriptPartCache,
} from "../src/centralTranscription.js";
import { transcribeAudio, transcriptPartCache } from "../src/transcribe.js";

// EPIC-24 M38: a WhatsApp voice note of any length lands as one joined transcript, cut into ~5 min parts, and a stop in the
// middle (a deploy) keeps the parts already done.

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const CENTRAL = "http://central.test:18946/v1/audio/transcriptions";
const OPENROUTER = "https://openrouter.ai/api/v1/audio/transcriptions";
const HOUR = 60 * 60;

function memoryCache(): TranscriptPartCache & { kept: Map<string, string>; cleared: number } {
  const kept = new Map<string, string>();
  const cache = {
    kept,
    cleared: 0,
    get: async (index: number, count: number) => kept.get(`${count}/${index}`) ?? null,
    put: async (index: number, count: number, text: string) => void kept.set(`${count}/${index}`, text),
    clear: async () => {
      kept.clear();
      cache.cleared += 1;
    },
  };
  return cache;
}

describe("EPIC-24 M38: no 2 hour cap", () => {
  it("transcribes notes up to 12 hours, said in plain words", () => {
    expect(MAX_VOICE_NOTE_SECONDS).toBe(12 * HOUR);
    expect(maxVoiceNoteWords()).toBe("12 hours");
    expect(maxVoiceNoteWords(HOUR)).toBe("1 hour");
  });

  it("gives a long note a job deadline in step with its length, never less than the configured one", () => {
    const twoHours = 2 * HOUR * 1000;
    expect(voiceJobDeadlineForMs(twoHours, null)).toBe(twoHours);
    expect(voiceJobDeadlineForMs(twoHours, 60)).toBe(twoHours);
    // the 23 Nov note: 7086 s; twice the central job's own limit (120 s + 0.6 s per second)
    expect(voiceJobDeadlineForMs(twoHours, 7086)).toBe(2 * Math.round(120_000 + 0.6 * 7086 * 1000));
    expect(voiceJobDeadlineForMs(twoHours, 6 * HOUR)).toBeGreaterThan(7 * HOUR * 1000);
  });
});

describe("EPIC-24 M38: parts already done survive a stop", () => {
  const cfg = { ...centralSttConfig({})!, retryDelayMs: 0 };
  const call = (over: Partial<Parameters<typeof transcribeLongWithCentral>[1]>) => ({
    data: Buffer.from("audio"),
    filename: "voice.ogg",
    model: "small",
    language: "auto",
    durationSeconds: 1200,
    deadlineMs: 3_600_000,
    split: async () => [1, 2, 3, 4].map((n) => ({ data: Buffer.from(`part${n}`), filename: `seg000${n}.mp3` })),
    ...over,
  });

  it("a failed part keeps the parts before it; the next try sends only the rest and joins all of them in order", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const cache = memoryCache();
    const sent: string[] = [];
    let failPart3 = true;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const name = ((init?.body as FormData).get("file") as File).name;
      sent.push(name);
      if (name === "seg0003.mp3" && failPart3) return new Response("bad", { status: 400 });
      return new Response(JSON.stringify({ text: `words of ${name.slice(3, 7)}` }), { status: 200 });
    }) as unknown as typeof fetch;

    const first = await transcribeLongWithCentral(cfg, call({ fetchImpl, partCache: cache }));
    expect(first.success).toBe(false);
    expect([...cache.kept.keys()]).toEqual(["4/0", "4/1"]);

    failPart3 = false;
    sent.length = 0;
    const second = await transcribeLongWithCentral(cfg, call({ fetchImpl, partCache: cache }));
    expect(sent).toEqual(["seg0003.mp3", "seg0004.mp3"]);
    expect(second).toMatchObject({ success: true, transcript: "words of 0001 words of 0002 words of 0003 words of 0004" });
    expect(cache.cleared).toBe(1);
    vi.restoreAllMocks();
  });

  it("keeps parts on disk by the audio's hash and engine, and clears them", async () => {
    const root = mkdtempSync(join(tmpdir(), "stt-parts-"));
    try {
      const cache = transcriptPartCache(Buffer.from("note A"), "central-small", root)!;
      expect(await cache.get(0, 3)).toBeNull();
      await cache.put(0, 3, "first part");
      expect(await cache.get(0, 3)).toBe("first part");
      expect(await transcriptPartCache(Buffer.from("note A"), "central-small", root)!.get(0, 3)).toBe("first part");
      expect(await transcriptPartCache(Buffer.from("note B"), "central-small", root)!.get(0, 3)).toBeNull();
      expect(await transcriptPartCache(Buffer.from("note A"), "whisper-small", root)!.get(0, 3)).toBeNull();
      expect(await cache.get(0, 4)).toBeNull();
      await cache.clear();
      expect(await cache.get(0, 3)).toBeNull();
      expect(transcriptPartCache(Buffer.from("x"), "central-small", null)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasFfmpeg)("EPIC-24 M38: long and large notes through transcribeAudio", () => {
  let dir: string;
  const saved = { ...process.env };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "long-voice-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    resetCentralSttCooldown();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...saved };
  });

  /** A synthetic note: a 289 s tone and a 1 s pause, repeated, as 8 kHz mu-law WAV (written in well under a second). */
  const synthetic = (seconds: number, name: string, codec: string[] = ["-ar", "8000", "-c:a", "pcm_mulaw"]) => {
    const seg = join(dir, "seg-290.wav");
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=289:sample_rate=16000", "-af", "apad=pad_dur=1", "-ac", "1", seg]);
    const out = join(dir, name);
    const r = spawnSync("ffmpeg", ["-y", "-stream_loop", "-1", "-i", seg, "-t", String(seconds), "-ac", "1", ...codec, out]);
    expect(r.status).toBe(0);
    return readFileSync(out);
  };
  const partName = (init?: RequestInit) => {
    const body = init?.body;
    if (body instanceof FormData) return (body.get("file") as File).name;
    return "json";
  };

  it("a note over 2 hours lands as one joined transcript of ~5 min parts, in order", async () => {
    const audio = synthetic(2 * HOUR + 300, "over-2h.wav");
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(CENTRAL);
      const name = partName(init);
      sent.push(name);
      return new Response(JSON.stringify({ text: `[${name.slice(3, 7)}]` }), { status: 200 });
    }));
    const result = await transcribeAudio(audio, "voice.wav", { durationSeconds: 2 * HOUR + 300, allowLocalFallback: false });
    expect(result).toMatchObject({ success: true, provider: "central faster-whisper small" });
    // 7500 s in parts of about 5 min (cut at the pause nearest each 5 min mark): one request per part, joined in order
    const words = (result.transcript ?? "").split(" ");
    expect(sent.length).toBeGreaterThanOrEqual(25);
    expect(sent.length).toBeLessThanOrEqual(27);
    expect(words).toEqual(sent.map((_, i) => `[${String(i).padStart(4, "0")}]`));
  }, 300_000);

  it("a stop midway (a deploy) keeps the parts already done: the next try starts at the next part", async () => {
    const audio = synthetic(1500, "stop.wav");
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    process.env.ZENOD_STT_PART_DIR = join(dir, "parts");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent: string[] = [];
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const name = partName(init);
      sent.push(name);
      // the deploy stops the job while the 3rd part is being written out
      if (sent.length === 3 && !controller.signal.aborted) {
        controller.abort(new Error("deploy"));
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return new Response(JSON.stringify({ text: `[${name.slice(3, 7)}]` }), { status: 200 });
    }));
    const stopped = await transcribeAudio(audio, "voice.wav", { durationSeconds: 1500, signal: controller.signal, allowLocalFallback: false });
    expect(stopped.success).toBe(false);
    expect(sent).toHaveLength(3);

    sent.length = 0;
    const result = await transcribeAudio(audio, "voice.wav", { durationSeconds: 1500, allowLocalFallback: false });
    expect(sent[0]).toBe("seg0002.mp3");
    const total = sent.length + 2;
    expect(result).toMatchObject({ success: true });
    expect((result.transcript ?? "").split(" ")).toEqual(Array.from({ length: total }, (_, i) => `[${String(i).padStart(4, "0")}]`));
    // the note is done: its kept parts are gone
    expect(readdirSync(join(dir, "parts"))).toEqual([]);
  }, 120_000);

  it("a note over 16 MB is sent in parts, each far under every upload cap, and joined into one transcript", async () => {
    // 10 minutes of 16 kHz 16-bit WAV: 19.2 MB, over the old 16 MB forward cap and close to the OpenAI 24 MB upload cap
    const audio = synthetic(600, "big.wav", ["-ar", "16000", "-c:a", "pcm_s16le"]);
    expect(audio.length).toBeGreaterThan(16 * 1024 * 1024);
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const sizes: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sizes.push(((init?.body as FormData).get("file") as File).size);
      return new Response(JSON.stringify({ text: `part ${sizes.length}` }), { status: 200 });
    }));
    const result = await transcribeAudio(audio, "voice.wav", { allowLocalFallback: false });
    expect(result).toMatchObject({ success: true, transcript: "part 1 part 2" });
    expect(sizes).toHaveLength(2);
    for (const size of sizes) expect(size).toBeLessThan(3_000_000);
  }, 120_000);

  it("OpenRouter gets a note over 30 minutes in parts from the start, never as one upload", async () => {
    const audio = synthetic(2400, "or.wav");
    process.env.ZENOD_CENTRAL_STT = "0";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(OPENROUTER);
      bodies.push(String(init?.body).length);
      return new Response(JSON.stringify({ text: `tramo ${bodies.length}` }), { status: 200 });
    }));
    const result = await transcribeAudio(audio, "voice.wav", {
      openrouterApiKey: "sk-or", longTranscriptionProvider: "openrouter", durationSeconds: 2400, allowLocalFallback: false,
    });
    // 40 minutes: 10-minute parts (ffmpeg may leave a short tail part), no one-shot request first, joined in order
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    expect(bodies.length).toBeLessThanOrEqual(5);
    expect(result).toMatchObject({ success: true, transcript: bodies.map((_, i) => `tramo ${i + 1}`).join(" ") });
    // a 10-minute part at 32 kbit/s is about 2.4 MB (3.2 MB as base64); the whole note would be about 13 MB
    for (const size of bodies) expect(size).toBeLessThan(4_000_000);
  }, 120_000);
});
