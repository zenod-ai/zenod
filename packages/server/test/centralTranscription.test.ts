import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CENTRAL_STT_DEFAULT_URL,
  CENTRAL_STT_TIMEOUT_MS,
  centralSttConfig,
  centralSttModelFor,
  resetCentralSttCooldown,
} from "../src/centralTranscription.js";
import { transcribeAudio } from "../src/transcribe.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const CENTRAL = "http://central.test:18946/v1/audio/transcriptions";
const OPENAI = "https://api.openai.com/v1/audio/transcriptions";

describe("EPIC-20 A7: central transcription settings", () => {
  it("is off in tests unless a URL is set, and off with ZENOD_CENTRAL_STT=0", () => {
    expect(centralSttConfig({ VITEST: "1" })).toBeNull();
    expect(centralSttConfig({ NODE_ENV: "test" })).toBeNull();
    expect(centralSttConfig({ ZENOD_CENTRAL_STT_URL: CENTRAL, ZENOD_CENTRAL_STT: "0" })).toBeNull();
  });

  it("defaults to the vps3 service over the tailnet with the 60 s fallback and the zenod caller", () => {
    expect(CENTRAL_STT_TIMEOUT_MS).toBe(60_000);
    expect(centralSttConfig({})).toMatchObject({
      url: CENTRAL_STT_DEFAULT_URL,
      timeoutMs: 60_000,
      caller: "zenod",
      model: null,
    });
    expect(CENTRAL_STT_DEFAULT_URL).toBe("http://vps3.taild81fbb.ts.net:18946/v1/audio/transcriptions");
  });

  it("uses turbo for short notes, small for longer ones, and skips what could not finish in 60 s", () => {
    const cfg = centralSttConfig({})!;
    expect(centralSttModelFor(8, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(45, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(46, cfg)).toBe("small");
    expect(centralSttModelFor(120, cfg)).toBe("small");
    expect(centralSttModelFor(121, cfg)).toBeNull();
    expect(centralSttModelFor(null, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(900, { ...cfg, model: "small" })).toBe("small");
  });
});

describe.skipIf(!hasFfmpeg)("EPIC-20 A7: transcribeAudio tries the central service first", () => {
  let dir: string;
  const saved = { ...process.env };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "central-stt-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    resetCentralSttCooldown();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...saved };
  });

  const tone = (seconds: number) => {
    const wav = join(dir, `tone-${seconds}.wav`);
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, wav]);
    return readFileSync(wav);
  };
  const paid = { openaiApiKey: "sk-paid", openaiModel: "gpt-4o-mini-transcribe", allowLocalFallback: false } as const;
  const alarms = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[ops-alert] transcribe"));

  it("success: the note is written out by the central service, the paid provider is never called, no alarm", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const calls: Array<{ url: string; headers: Headers; model: string; language: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        model: String(body.get("model")),
        language: body.get("language") as string | null,
      });
      return new Response(JSON.stringify({ text: " hola desde el servicio central " }), { status: 200 });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transcribeAudio(tone(3), "voice.ogg", paid);
    expect(result).toMatchObject({ success: true, transcript: "hola desde el servicio central", provider: "central faster-whisper large-v3-turbo" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: CENTRAL, model: "large-v3-turbo", language: null });
    expect(calls[0]!.headers.get("x-caller")).toBe("zenod");
    expect(alarms(warn)).toEqual([]);
  });

  it("slow: no answer within the timeout falls back to the paid provider and writes one alarm", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    process.env.ZENOD_CENTRAL_STT_TIMEOUT_MS = "150"; // the shipped default is 60 000 ms (asserted above)
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url) === CENTRAL) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        });
      }
      return Promise.resolve(new Response("hola desde el proveedor de pago", { status: 200 }));
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const started = Date.now();
    const result = await transcribeAudio(tone(3), "voice.ogg", paid);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    expect(result).toMatchObject({ success: true, transcript: "hola desde el proveedor de pago", provider: "openai gpt-4o-mini-transcribe" });
    expect(urls).toEqual([CENTRAL, OPENAI]);
    expect(alarms(warn)).toEqual(["[ops-alert] transcribe central_fallback reason=timeout model=large-v3-turbo secs=3"]);
  });

  it.each([
    ["unreachable", () => Promise.reject(new TypeError("fetch failed")), "network", ""],
    ["a 503", () => Promise.resolve(new Response("busy", { status: 503 })), "http_5xx", " status=503"],
    ["an empty text", () => Promise.resolve(new Response(JSON.stringify({ text: "  " }), { status: 200 })), "empty", ""],
    ["not JSON", () => Promise.resolve(new Response("<html>", { status: 200 })), "bad_reply", ""],
  ])("down (%s): falls back at once and writes one alarm", async (_name, central, reason, status) => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request) => {
      urls.push(String(url));
      return String(url) === CENTRAL ? central() : Promise.resolve(new Response("hola desde el proveedor de pago", { status: 200 }));
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = Date.now();
    const result = await transcribeAudio(tone(3), "voice.ogg", paid);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ success: true, provider: "openai gpt-4o-mini-transcribe" });
    expect(urls).toEqual([CENTRAL, OPENAI]);
    expect(alarms(warn)).toEqual([`[ops-alert] transcribe central_fallback reason=${reason} model=large-v3-turbo${status} secs=3`]);
  });

  it("after a failure the next notes skip the service for the cooldown, still with one alarm each, and it recovers", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    let centralUp = false;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url) !== CENTRAL) return Promise.resolve(new Response("hola proveedor", { status: 200 }));
      return centralUp
        ? Promise.resolve(new Response(JSON.stringify({ text: "hola central" }), { status: 200 }))
        : Promise.reject(new TypeError("fetch failed"));
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await transcribeAudio(tone(3), "voice.ogg", paid);
    await transcribeAudio(tone(3), "voice.ogg", paid);
    expect(urls).toEqual([CENTRAL, OPENAI, OPENAI]); // the second note did not try the service
    expect(alarms(warn).map((line) => line.split(" ")[3])).toEqual(["reason=network", "reason=cooldown"]);
    resetCentralSttCooldown();
    centralUp = true;
    expect(await transcribeAudio(tone(3), "voice.ogg", paid)).toMatchObject({ provider: "central faster-whisper large-v3-turbo" });
  });

  it("alarm: the line holds fixed words and numbers only, and a note is not lost when the paid provider is also down", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transcribeAudio(tone(3), "secret-name.ogg", paid);
    // Both failed: the caller still gets an honest failure to retry from, not a silent loss.
    expect(result.success).toBe(false);
    const lines = alarms(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[ops-alert\] transcribe central_fallback( [a-z]+=[A-Za-z0-9_.:/-]+)+$/);
    expect(lines[0]).not.toContain("secret-name");
  });

  it("a note too long to finish in 60 s goes straight to the paid provider without waiting or an alarm", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("hola nota larga", { status: 200 });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transcribeAudio(tone(150), "voice.ogg", paid);
    expect(result).toMatchObject({ success: true, provider: "openai gpt-4o-mini-transcribe" });
    expect(urls).toEqual([OPENAI]);
    expect(alarms(warn)).toEqual([]);
  }, 30_000);

  it("a 100 s note uses the small model on the central service", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      models.push(String((init?.body as FormData).get("model")));
      return new Response(JSON.stringify({ text: "hola nota de cien segundos" }), { status: 200 });
    }));
    const result = await transcribeAudio(tone(100), "voice.ogg", paid);
    expect(result).toMatchObject({ success: true, provider: "central faster-whisper small" });
    expect(models).toEqual(["small"]);
  }, 30_000);

  it("a cancelled note writes no alarm", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        controller.abort();
      })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transcribeAudio(tone(3), "voice.ogg", { ...paid, signal: controller.signal });
    expect(result.success).toBe(false);
    expect(alarms(warn)).toEqual([]);
  });

  it("is not called when ZENOD_CENTRAL_STT=0", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    process.env.ZENOD_CENTRAL_STT = "0";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("hola", { status: 200 });
    }));
    await transcribeAudio(tone(3), "voice.ogg", paid);
    expect(urls).toEqual([OPENAI]);
  });
});
