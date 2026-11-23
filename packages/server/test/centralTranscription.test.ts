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
  centralSttPlanFor,
  chooseSegmentCuts,
  longNoteEstimateMinutes,
  longNoteNotice,
  transcribeLongWithCentral,
  networkCauseCode,
  probeCentralStt,
  resetCentralSttCooldown,
  transcribeWithCentral,
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

  it("uses turbo for short notes and small for longer ones, and sends what is over 90 s as a long job", () => {
    const cfg = centralSttConfig({})!;
    expect(centralSttModelFor(8, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(30, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(45, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(46, cfg)).toBe("small");
    expect(centralSttModelFor(90, cfg)).toBe("small");
    expect(centralSttModelFor(91, cfg)).toBe("small");
    expect(centralSttModelFor(null, cfg)).toBe("large-v3-turbo");
    expect(centralSttModelFor(900, { ...cfg, model: "small" })).toBe("small");
  });
});

describe("EPIC-24 M36: a long note is a long job on the central service", () => {
  const cfg = centralSttConfig({})!;

  it("scales the time limit with the audio: 120 s plus 0.6 s per second, on the small model", () => {
    expect(centralSttPlanFor(90, cfg)).toMatchObject({ long: false, model: "small", deadlineMs: 60_000 });
    expect(centralSttPlanFor(91, cfg)).toMatchObject({ long: true, model: "small", deadlineMs: 120_000 + 54_600 });
    expect(centralSttPlanFor(600, cfg)).toMatchObject({ long: true, model: "small", deadlineMs: 120_000 + 360_000 });
    expect(centralSttPlanFor(7086, cfg)).toMatchObject({ long: true, deadlineMs: Math.round(120_000 + 0.6 * 7086 * 1000) });
    expect(centralSttPlanFor(null, cfg).long).toBe(false);
    expect(centralSttPlanFor(1200, { ...cfg, model: "base" }).model).toBe("base");
  });

  it("tells the owner about how long to wait, in whole minutes and at least one", () => {
    expect(longNoteEstimateMinutes(181)).toBe(1);
    expect(longNoteEstimateMinutes(600)).toBe(3);
    expect(longNoteEstimateMinutes(3600)).toBe(18);
    expect(longNoteEstimateMinutes(7086)).toBe(36);
    expect(longNoteNotice(600)).toBe("Long voice note, transcribing it, about 3 min. I will reply here once it is saved. Send “cancel transcription” to stop it.");
  });

  it("cuts at the middle of the pause nearest each 5 minutes, at 5 minutes without a pause, and keeps the last part under 6", () => {
    const pauses = [{ start: 290, end: 296 }, { start: 560, end: 564 }, { start: 900, end: 902 }];
    expect(chooseSegmentCuts([], 250, 300)).toEqual([]);
    expect(chooseSegmentCuts([], 359, 300)).toEqual([]);
    expect(chooseSegmentCuts([], 361, 300)).toEqual([300]);
    expect(chooseSegmentCuts(pauses, 1000, 300)).toEqual([293, 562, 901]);
    // a pause too far from the 5 minute mark (more than 45 s) is not used
    expect(chooseSegmentCuts([{ start: 200, end: 204 }], 650, 300)).toEqual([300]);
    const cuts = chooseSegmentCuts([], 7086, 300);
    expect(cuts).toHaveLength(23);
    expect(7086 - cuts[cuts.length - 1]!).toBeLessThan(360);
  });

  const call = (over: Partial<Parameters<typeof transcribeLongWithCentral>[1]> = {}) => ({
    data: Buffer.from("audio"),
    filename: "voice.ogg",
    model: "small",
    language: "auto",
    durationSeconds: 650,
    deadlineMs: 600_000,
    split: async () => [1, 2, 3].map((n) => ({ data: Buffer.from(`part${n}`), filename: `seg000${n}.mp3` })),
    ...over,
  });
  const quick = { ...cfg, retryDelayMs: 0 };

  it("sends the parts one after another and joins their words in order", async () => {
    const seen: string[] = [];
    const progress: number[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      seen.push(`${(form.get("file") as File).name}:${form.get("model")}`);
      return new Response(JSON.stringify({ text: `words ${seen.length}` }), { status: 200 });
    }) as unknown as typeof fetch;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transcribeLongWithCentral(quick, call({ fetchImpl, onProgress: (p) => progress.push(p) }));
    expect(result).toMatchObject({ success: true, transcript: "words 1 words 2 words 3", provider: "central faster-whisper small" });
    expect(seen).toEqual(["seg0001.mp3:small", "seg0002.mp3:small", "seg0003.mp3:small"]);
    expect(progress).toEqual([33, 67, 100]);
    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      "[transcribe] central long job: 650s audio, 3 part(s) on small, up to 600s",
      "[transcribe] central long job done: 650s audio in 0s, 3 part(s)",
    ]);
    log.mockRestore();
  });

  it("a note up to 6 minutes is one request and is not cut", async () => {
    const split = vi.fn(async () => []);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "one request" }), { status: 200 })) as unknown as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transcribeLongWithCentral(quick, call({ durationSeconds: 300, split, fetchImpl }));
    expect(result).toMatchObject({ success: true, transcript: "one request" });
    expect(split).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a part that finds the service restarting is tried once more, and a second failure ends the job", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let n = 0;
    const flaky = vi.fn(async () => {
      n += 1;
      return n === 2 ? new Response("restarting", { status: 503 }) : new Response(JSON.stringify({ text: `part ${n}` }), { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await transcribeLongWithCentral(quick, call({ fetchImpl: flaky }));
    expect(ok).toMatchObject({ success: true, transcript: "part 1 part 3 part 4" });
    const down = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const failed = await transcribeLongWithCentral(quick, call({ fetchImpl: down }));
    expect(failed).toMatchObject({ success: false, provider: "central", providerCode: "http_5xx" });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("a request the service refuses (4xx) is not retried", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const refuse = vi.fn(async () => new Response("no", { status: 400 })) as unknown as typeof fetch;
    const result = await transcribeLongWithCentral(quick, call({ fetchImpl: refuse }));
    expect(result).toMatchObject({ success: false, providerCode: "http_4xx" });
    expect(refuse).toHaveBeenCalledTimes(1);
  });

  it("a silent part adds no words, and a note that is silent throughout fails as empty", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return new Response(JSON.stringify({ text: n === 2 ? "" : `part ${n}` }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await transcribeLongWithCentral(quick, call({ fetchImpl }))).toMatchObject({ success: true, transcript: "part 1 part 3" });
    const silent = vi.fn(async () => new Response(JSON.stringify({ text: "" }), { status: 200 })) as unknown as typeof fetch;
    expect(await transcribeLongWithCentral(quick, call({ fetchImpl: silent }))).toMatchObject({ success: false, providerCode: "empty" });
  });

  it("stops with a timeout when the note's time limit is used up", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const slow = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    })) as unknown as typeof fetch;
    const result = await transcribeLongWithCentral({ ...quick, partTimeoutMs: 30 }, call({ fetchImpl: slow, deadlineMs: 70 }));
    expect(result).toMatchObject({ success: false, providerCode: "timeout" });
  });

  it("a split that fails, or a cancelled note, comes back as a failed envelope and never throws", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const broken = await transcribeLongWithCentral(quick, call({ split: async () => { throw new Error("ffmpeg is not installed in this image"); } }));
    expect(broken).toMatchObject({ success: false, providerCode: "split_failed" });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await transcribeLongWithCentral(quick, call({ signal: controller.signal, split: async () => { throw new Error("aborted"); } }));
    expect(cancelled).toMatchObject({ success: false, providerCode: "network" });
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
    ["unreachable", () => Promise.reject(new TypeError("fetch failed")), "network cause=other", ""],
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

  const longTone = (seconds: number) => {
    const wav = join(dir, `long-tone-${seconds}.wav`);
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ar", "8000", wav]);
    return readFileSync(wav);
  };

  it("EPIC-24 M36: a 7 minute note is cut and written out by the central service in parts; the paid provider is never called, no alarm", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const calls: Array<{ url: string; model: string; bytes: number }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      calls.push({ url: String(url), model: String(form.get("model")), bytes: (form.get("file") as File).size });
      return new Response(JSON.stringify({ text: `parte ${calls.length}` }), { status: 200 });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transcribeAudio(longTone(420), "voice.ogg", paid);
    expect(result).toMatchObject({ success: true, transcript: "parte 1 parte 2", provider: "central faster-whisper small" });
    expect(calls.map((c) => c.url)).toEqual([CENTRAL, CENTRAL]);
    expect(calls.map((c) => c.model)).toEqual(["small", "small"]);
    expect(calls[0]!.bytes).toBeGreaterThan(100_000);
    expect(alarms(warn)).toEqual([]);
    expect(log.mock.calls.map(([line]) => String(line)).filter((l) => l.includes("central skipped"))).toEqual([]);
  }, 60_000);

  it("EPIC-24 M36: when the service is down for a long note the paid provider answers after one alarm, as before", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    process.env.ZENOD_CENTRAL_STT_RETRY_DELAY_MS = "0";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url) === CENTRAL
        ? new Response("down", { status: 503 })
        : new Response(JSON.stringify({ text: "nota larga" }), { status: 200 });
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transcribeAudio(longTone(420), "voice.ogg", paid);
    expect(result).toMatchObject({ success: true, provider: "openai gpt-4o-mini-transcribe" });
    expect(urls.filter((u) => u === CENTRAL)).toHaveLength(2);
    expect(urls.filter((u) => u === OPENAI).length).toBeGreaterThan(0);
    expect(alarms(warn)).toHaveLength(1);
    expect(alarms(warn)[0]).toContain("reason=http_5xx");
  }, 60_000);

  it("a 60 s note uses the small model on the central service", async () => {
    process.env.ZENOD_CENTRAL_STT_URL = CENTRAL;
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      models.push(String((init?.body as FormData).get("model")));
      return new Response(JSON.stringify({ text: "hola nota de un minuto" }), { status: 200 });
    }));
    const result = await transcribeAudio(tone(60), "voice.ogg", paid);
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

describe("EPIC-20 A7: why the central service could not be reached", () => {
  it("names the network cause with fixed words, never a message", async () => {
    const cfg = centralSttConfig({ ZENOD_CENTRAL_STT_URL: CENTRAL })!;
    const refused = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 100.86.141.63:18946"), { code: "ECONNREFUSED" }) });
    const result = await transcribeWithCentral(cfg, {
      data: Buffer.from("x"), filename: "v.ogg", model: "small", language: "auto", fetchImpl: async () => { throw refused; },
    });
    expect(result).toMatchObject({ success: false, providerCode: "network", cause: "ECONNREFUSED" });
    expect(networkCauseCode(new Error("private words in here"))).toBe("other");
    expect(networkCauseCode(Object.assign(new Error("x"), { cause: { code: "ENETUNREACH" } }))).toBe("ENETUNREACH");
  });

  it("the boot probe logs reachable, or unreachable with the cause, and never throws", async () => {
    const cfg = centralSttConfig({ ZENOD_CENTRAL_STT_URL: CENTRAL })!;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls: string[] = [];
    expect(await probeCentralStt(cfg, async (url) => { urls.push(String(url)); return new Response("{}", { status: 200 }); })).toBe(true);
    expect(urls).toEqual(["http://central.test:18946/health"]);
    expect(log).toHaveBeenCalledWith("[central-stt] reachable");
    expect(await probeCentralStt(cfg, async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "EHOSTUNREACH" } }); })).toBe(false);
    expect(warn).toHaveBeenCalledWith("[central-stt] unreachable cause=EHOSTUNREACH");
    expect(await probeCentralStt(null)).toBe(false);
    vi.restoreAllMocks();
  });
});
