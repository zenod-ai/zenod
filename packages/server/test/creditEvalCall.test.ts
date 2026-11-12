// E7-S3 iteration 3: the memory test suite's live tier calls Claude through staging's credit route.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZENOD_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function unit(onCredit = true) {
  const dir = await mkdtemp(join(tmpdir(), "zenod-eval-call-"));
  dirs.push(dir);
  const runtime = new Runtime(dir, ZENOD_AGENT, {
    seedFromEnv: false,
    credentialMasterKey: "33".repeat(32),
    ...(onCredit ? { creditRoute: { apiKey: "k", model: "claude-haiku-5-5", askModel: "claude-sonnet-5-5", tenants: "all" as const, monthlyUsd: 3 } } : {}),
  });
  runtime.settings.setRaw("api_token", "eval-token");
  return { runtime, app: createApp(runtime, { agent: ZENOD_AGENT }) };
}

const post = (app: Awaited<ReturnType<typeof unit>>["app"], body: unknown) =>
  app.request("/api/credit/eval-call", { method: "POST", headers: { authorization: "Bearer eval-token", "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/credit/eval-call", () => {
  it("does not exist unless the host turns it on (production never does)", async () => {
    const { app, runtime } = await unit();
    const spy = vi.spyOn(runtime, "creditEvalCall");
    expect((await post(app, { method: "classify", args: [{}] })).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an unknown method and needs the account's token", async () => {
    vi.stubEnv("ZENOD_EVAL_RELAY", "on");
    const { app } = await unit();
    expect((await post(app, { method: "work", args: [{}] })).status).toBe(400);
    expect((await post(app, { method: "classify" })).status).toBe(400);
    const anon = await app.request("/api/credit/eval-call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "classify", args: [{}] }) });
    expect(anon.status).toBe(401);
  });

  it("runs the call on the credit route and returns its result and price", async () => {
    vi.stubEnv("ZENOD_EVAL_RELAY", "on");
    const { app, runtime } = await unit();
    const spy = vi.spyOn(runtime, "creditEvalCall").mockResolvedValue({ out: "frog", model: "claude-sonnet-5-5", costUsd: 0.02, inputTokens: 9000, outputTokens: 200, ms: 4000 });
    const res = await post(app, { method: "streamMemoryChat", args: [{ system: "s", prompt: "q" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: "anthropic", out: "frog", model: "claude-sonnet-5-5", costUsd: 0.02 });
    expect(spy).toHaveBeenCalledWith("streamMemoryChat", [{ system: "s", prompt: "q" }]);
  });

  it("says 404 for an account that is not on the credit", async () => {
    vi.stubEnv("ZENOD_EVAL_RELAY", "on");
    const { app } = await unit(false);
    expect((await post(app, { method: "classify", args: [{}] })).status).toBe(404);
  });
});
