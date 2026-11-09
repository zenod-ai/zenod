import { expect, it } from "vitest";
import { BackgroundBalanceMonitor, backgroundHealth, backgroundRouteFromEnv } from "../src/backgroundRoute.js";
import { UsageStore } from "../src/usageStore.js";

// EPIC-14 S10 round 4: the DeepSeek background route. Stubs only, zero spend.

it("stays off until the host has DEEPSEEK_API_KEY, so nothing changes without it", () => {
  expect(backgroundRouteFromEnv({})).toBeNull();
  expect(backgroundRouteFromEnv({ DEEPSEEK_API_KEY: "  " })).toBeNull();
  expect(backgroundRouteFromEnv({ ZENOD_BACKGROUND_ROUTE: "filing=deepseek" })).toBeNull();
  expect(backgroundRouteFromEnv({ DEEPSEEK_API_KEY: "k", ZENOD_BACKGROUND_ROUTE: "off" })).toBeNull();
  expect(backgroundHealth()).toEqual({ provider: "off", state: "off" });
});

it("sends every background job to DeepSeek by default and lets a setting keep any job on OpenRouter", () => {
  const all = backgroundRouteFromEnv({ DEEPSEEK_API_KEY: "k" })!;
  expect(all.jobs).toEqual({ filing: "deepseek", desk: "deepseek", personas: "deepseek", reflection: "deepseek" });
  expect(all.model).toBe("deepseek-flash");
  expect(all.lowBalanceUsd).toBe(5);
  const mixed = backgroundRouteFromEnv({ DEEPSEEK_API_KEY: "k", ZENOD_BACKGROUND_ROUTE: "desk=openrouter, personas=OpenRouter, bogus=deepseek, filing=nope", ZENOD_BACKGROUND_MODEL: "deepseek-v4-pro", ZENOD_BACKGROUND_LOW_BALANCE_USD: "2.5" })!;
  expect(mixed.jobs).toEqual({ filing: "deepseek", desk: "openrouter", personas: "openrouter", reflection: "deepseek" });
  expect(mixed.model).toBe("deepseek-v4-pro");
  expect(mixed.lowBalanceUsd).toBe(2.5);
});

function balanceFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const fetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const usd = (total: string, available = true) => ({ body: { is_available: available, balance_infos: [{ currency: "USD", total_balance: total, granted_balance: "0.00", topped_up_balance: total }] } });

it("health reads the DeepSeek balance and alerts once when it gets low or runs out, and once when it recovers", async () => {
  const route = backgroundRouteFromEnv({ DEEPSEEK_API_KEY: "offline-key", ZENOD_BACKGROUND_LOW_BALANCE_USD: "3" })!;
  const { fetch, seen } = balanceFetch([usd("9.50"), usd("2.90"), usd("2.10"), usd("0.00", false), { status: 500 }, usd("12.00")]);
  const lines: string[] = [];
  const monitor = new BackgroundBalanceMonitor(route, { fetch, log: (line) => lines.push(line), now: () => Date.UTC(2026, 10, 9) });
  expect(monitor.status().state).toBe("unknown");
  expect((await monitor.check()).state).toBe("ok");
  expect(monitor.status()).toMatchObject({ provider: "deepseek", balanceUsd: 9.5, checkedAt: "2026-11-09T00:00:00.000Z" });
  expect((await monitor.check()).state).toBe("low");
  expect((await monitor.check()).state).toBe("low");
  expect((await monitor.check()).state).toBe("empty");
  expect((await monitor.check()).state).toBe("unknown");
  expect((await monitor.check()).state).toBe("ok");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(/^\[background\] ALERT deepseek balance low: \$2\.9 left \(alert at \$3\)/);
  expect(lines[1]).toMatch(/ALERT deepseek balance empty/);
  expect(lines[2]).toMatch(/ok again: \$12/);
  expect(seen[0]).toEqual({ url: "https://api.deepseek.com/user/balance", auth: "Bearer offline-key" });
  expect(JSON.stringify(monitor.status())).not.toContain("offline-key");
});

it("logs cost per provider: DeepSeek at its real charge next to OpenRouter's", () => {
  const store = new UsageStore(":memory:");
  try {
    store.record({ operation: "classify", provider: "deepseek", model: "deepseek-flash", inputTokens: 1000, outputTokens: 100, cachedInputTokens: 800, cacheCreationInputTokens: 0, providerCostUsd: 0.0000924 });
    store.record({ operation: "answer", provider: "openrouter", model: "openai/gpt-5.6-luna", inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: 0.0025 });
    const byProvider = Object.fromEntries(store.summary(0).byProvider.map((bucket) => [bucket.key, bucket]));
    expect(byProvider.deepseek!.calls).toBe(1);
    expect(byProvider.deepseek!.costUsd).toBeCloseTo(0.0000924, 12);
    expect(byProvider.openrouter!.costUsd).toBeCloseTo(0.0025, 12);
    // The estimate (no live charge) uses DeepSeek's off-peak cache hit/miss price, not a generic DeepSeek rate.
    const row = store.timeline({ limit: 10 }).find((call) => call.provider === "deepseek")!;
    expect(row.costUsd).toBeCloseTo((800 * 0.003 + 200 * 0.15 + 100 * 0.6) / 1_000_000, 12);
  } finally {
    store.close();
  }
});

it("at the default $5 the health warning turns low when the balance reaches $5 (S11)", async () => {
  const route = backgroundRouteFromEnv({ DEEPSEEK_API_KEY: "offline-key" })!;
  const { fetch } = balanceFetch([usd("10.00"), usd("5.01"), usd("5.00")]);
  const lines: string[] = [];
  const monitor = new BackgroundBalanceMonitor(route, { fetch, log: (line) => lines.push(line), now: () => Date.UTC(2026, 10, 9) });
  expect((await monitor.check())).toMatchObject({ provider: "deepseek", state: "ok", balanceUsd: 10 });
  expect((await monitor.check()).state).toBe("ok");
  expect((await monitor.check())).toMatchObject({ state: "low", balanceUsd: 5 });
  expect(lines).toEqual([expect.stringMatching(/^\[background\] ALERT deepseek balance low: \$5 left \(alert at \$5\)/)]);
});

it("keeps each call's feature and provider wall time on the ledger (S11)", () => {
  const store = new UsageStore(":memory:");
  try {
    store.record({ operation: "classify", provider: "deepseek", model: "deepseek-flash", inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, latencyMs: 1234 });
    store.record({ operation: "answer", provider: "deepseek", model: "deepseek-flash", inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0 }, Date.now(), "desk");
    const [desk, filing] = store.timeline({ limit: 10 });
    expect(filing).toMatchObject({ provider: "deepseek", feature: "filing", latencyMs: 1234 });
    expect(desk).toMatchObject({ feature: "desk", latencyMs: null });
  } finally {
    store.close();
  }
});
