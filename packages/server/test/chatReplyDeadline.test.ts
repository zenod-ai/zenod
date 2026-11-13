import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CHAT_REPLY_DEADLINE_MS, CHAT_STILL_WORKING_TEXT, createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

// T7-F7: a 125 s answer on POST /api/chat let the edge (Cloudflare, 100 s) show its own timeout page.
describe("T7-F7 POST /api/chat reply deadline", () => {
  beforeAll(() => vi.stubEnv("ZENOD_API_TOKEN", "t7-f7-local-token"));
  afterAll(() => vi.unstubAllEnvs());

  async function withApp(handleTasking: () => Promise<unknown>, check: (app: ReturnType<typeof createApp>, headers: Record<string, string>) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "t7-f7-"));
    const runtime = new Runtime(dir);
    try {
      runtime.getEngine = (async () => ({ handleTasking })) as unknown as Runtime["getEngine"];
      const app = createApp(runtime, { chatReplyDeadlineMs: 50 });
      await check(app, { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" });
    } finally { runtime.close(); await rm(dir, { recursive: true, force: true }); }
  }

  it("answers under the edge timeout", () => {
    expect(CHAT_REPLY_DEADLINE_MS).toBeLessThan(100_000);
  });

  it("a slow answer gets a clear still-working reply instead of hanging past the edge", async () => {
    let finish!: (reply: unknown) => void;
    await withApp(() => new Promise((resolve) => { finish = resolve; }), async (app, headers) => {
      const response = await app.request("/api/chat", { method: "POST", headers, body: JSON.stringify({ message: "What is the T7 rehearsal test word?" }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ text: CHAT_STILL_WORKING_TEXT, sources: [], actions: [], pending: true });
      finish({ text: "late", sources: [], actions: [] });
    });
  });

  it("a normal answer is returned as before", async () => {
    await withApp(async () => ({ text: "The word is heron.", sources: [], actions: [] }), async (app, headers) => {
      const response = await app.request("/api/chat", { method: "POST", headers, body: JSON.stringify({ message: "test word?" }) });
      expect(await response.json()).toEqual({ text: "The word is heron.", sources: [], actions: [] });
    });
  });

  it("a late failure is logged, not left unhandled", async () => {
    let fail!: (error: Error) => void;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await withApp(() => new Promise((_, reject) => { fail = reject; }), async (app, headers) => {
      const response = await app.request("/api/chat", { method: "POST", headers, body: JSON.stringify({ message: "q" }) });
      expect((await response.json()).pending).toBe(true);
      fail(new Error("boom"));
      await new Promise((r) => setTimeout(r, 0));
      expect(logged).toHaveBeenCalledWith("[chat] late reply failed:", expect.any(Error));
    });
    logged.mockRestore();
  });
});
