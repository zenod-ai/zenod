import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmUsageReport } from "zenod";
const countTranscriptWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

// EPIC-24 M13: an OpenRouter answer that stops early (far fewer words per probed minute than
// speech) is re-run in segments and the fuller text kept; a covering answer is not re-run.

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("OpenRouter early stop is caught and re-run in segments", () => {
  let dir: string;
  let audio: Buffer;
  let transcribeAudio: typeof import("../src/transcribe.js").transcribeAudio;
  beforeAll(async () => {
    // 60-second segments keep the clip short; production default is 600 (10 minutes).
    process.env.ZENOD_OPENROUTER_SEGMENT_SECONDS = "60";
    ({ transcribeAudio } = await import("../src/transcribe.js"));
    dir = mkdtempSync(join(tmpdir(), "zenod-coverage-"));
    const ogg = join(dir, "long.ogg");
    // 150 seconds of tone: one-shot plus three 60-second segments.
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=150", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "16k", ogg]);
    audio = readFileSync(ogg);
  }, 60_000);
  afterAll(() => {
    delete process.env.ZENOD_OPENROUTER_SEGMENT_SECONDS;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => vi.unstubAllGlobals());

  const run = (onUsage?: (r: LlmUsageReport) => void) =>
    transcribeAudio(audio, "long.ogg", {
      openrouterApiKey: "sk-or-test",
      openrouterModel: "mistralai/voxtral-mini-transcribe",
      allowLocalFallback: false,
      ...(onUsage ? { onUsage } : {}),
    });

  const reply = (text: string) => new Response(JSON.stringify({ text, usage: { seconds: 1, cost: 0.001 } }), { status: 200 });

  it("keeps the joined segments when the one-shot text stops early", async () => {
    const calls: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { input_audio: { data: string } };
        calls.push(Buffer.from(body.input_audio.data, "base64").length);
        // First call (whole note) stops after 100 words; each segment answers in full.
        return calls.length === 1 ? reply(words(20)) : reply(`part${calls.length - 1} ${words(150)}`);
      }),
    );
    const usage: LlmUsageReport[] = [];
    const result = await run((r) => usage.push(r));
    expect(result.success).toBe(true);
    expect(calls.length).toBe(4);
    // Each segment is smaller than the whole note.
    expect(Math.max(...calls.slice(1))).toBeLessThan(calls[0]!);
    expect(result.transcript).toMatch(/^part1 .* part2 .* part3 /s);
    expect(countTranscriptWords(result.transcript ?? "")).toBe(3 * 151);
    expect(result.provider).toBe("openrouter mistralai/voxtral-mini-transcribe");
    // Every billed call is metered.
    expect(usage.filter((r) => r.status === "succeeded")).toHaveLength(4);
  });

  it("does not re-run a transcript that covers the audio", async () => {
    const fetchMock = vi.fn(async () => reply(words(400)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await run();
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the one-shot text when a segment fails", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++n === 1 ? reply(words(20)) : new Response("{}", { status: 500 }))),
    );
    const result = await run();
    expect(result.success).toBe(true);
    expect(countTranscriptWords(result.transcript ?? "")).toBe(20);
  });
});
