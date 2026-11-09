import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { backgroundRouteFromEnv } from "../src/backgroundRoute.js";
import { Runtime } from "../src/runtime.js";

// EPIC-14 S10 round 4: a hosted tenant's persona run on the DeepSeek route, with OpenRouter as the
// fall back. Every call is a stub; zero spend.

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runtime(env: NodeJS.ProcessEnv): Runtime {
  const dir = mkdtempSync(join(tmpdir(), "zenod-bg-route-"));
  dirs.push(dir);
  return new Runtime(dir, undefined, {
    seedFromEnv: false,
    tenantId: "tenant-a",
    platformLlm: { apiKey: "offline-openrouter" },
    tenantMonthlyAllowanceUsd: 3,
    backgroundRoute: backgroundRouteFromEnv(env),
  });
}

function sse(text: string, usage: Record<string, number>): Response {
  const chunks = [
    { id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
  ];
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function transport(deepseekStatus: number) {
  const hosts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: RequestInit) => {
    const href = String(url);
    hosts.push(new URL(href).host);
    const body = JSON.parse(String(init.body));
    if (href.startsWith("https://api.deepseek.com/")) {
      expect(body.user_id).toBe("tenant-a");
      if (deepseekStatus !== 200) return new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: deepseekStatus, headers: { "content-type": "application/json" } });
      return sse("from deepseek", { prompt_tokens: 1000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1000, completion_tokens: 100, total_tokens: 1100 });
    }
    return sse("from openrouter", { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, cost: 0.002 });
  }));
  return hosts;
}

it("without the key a persona run stays on OpenRouter exactly as before", async () => {
  const hosts = transport(200);
  const result = await runtime({}).personaModel().complete({ system: "s", prompt: "p" });
  expect(result.text).toBe("from openrouter");
  expect(hosts).toEqual(["openrouter.ai"]);
});

it("with the key a persona run goes to DeepSeek and is logged under deepseek and personas", async () => {
  const hosts = transport(200);
  const rt = runtime({ DEEPSEEK_API_KEY: "offline-deepseek" });
  const result = await rt.personaModel().complete({ system: "s", prompt: "p" });
  expect(result.text).toBe("from deepseek");
  expect(hosts).toEqual(["api.deepseek.com"]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const providers = rt.usageStore.summary(0).byProvider.map((bucket) => bucket.key);
  expect(providers).toEqual(["deepseek"]);
});

it("when DeepSeek refuses (no balance) the same persona run is answered by OpenRouter", async () => {
  const hosts = transport(402);
  const result = await runtime({ DEEPSEEK_API_KEY: "offline-deepseek" }).personaModel().complete({ system: "s", prompt: "p" });
  expect(result.text).toBe("from openrouter");
  expect(hosts[0]).toBe("api.deepseek.com");
  expect(hosts.at(-1)).toBe("openrouter.ai");
});

it("a persona job set to openrouter stays there while the key exists", async () => {
  const hosts = transport(200);
  const result = await runtime({ DEEPSEEK_API_KEY: "offline-deepseek", ZENOD_BACKGROUND_ROUTE: "personas=openrouter" }).personaModel().complete({ system: "s", prompt: "p" });
  expect(result.text).toBe("from openrouter");
  expect(hosts).toEqual(["openrouter.ai"]);
});
