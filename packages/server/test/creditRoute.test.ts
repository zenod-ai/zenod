import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { creditRouteFor, creditRouteFromEnv } from "../src/creditRoute.js";
import { Runtime } from "../src/runtime.js";
import { estimateCostUsd } from "../src/usageStore.js";

// EPIC-14 S41 round 2: named accounts run on alpha9's Anthropic credit; credit spend has its own cap
// and never uses up the paid monthly allowance.

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runtime(options: { credit: boolean; tenantId?: string; capUsd?: string }): Runtime {
  const dir = mkdtempSync(join(tmpdir(), "zenod-credit-"));
  dirs.push(dir);
  const route = creditRouteFromEnv({ ZENOD_CREDIT_ANTHROPIC_API_KEY: "sk-ant-test", ZENOD_CREDIT_TENANTS: "tenant-a", ZENOD_CREDIT_MONTHLY_USD: options.capUsd ?? "1" } as NodeJS.ProcessEnv);
  return new Runtime(dir, undefined, {
    seedFromEnv: false,
    tenantId: options.tenantId ?? "tenant-a",
    platformLlm: { apiKey: "sk-or-v1-platform" },
    tenantMonthlyAllowanceUsd: 3,
    ...(options.credit ? { creditRoute: route } : {}),
  });
}

function spend(rt: Runtime, provider: string, usd: number, feature?: "personas" | "calls" | "desk"): void {
  rt.usageStore.record(
    { operation: "answer", provider, model: "m", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: usd },
    NOW,
    feature,
  );
}

describe("credit route config", () => {
  it("is off without a key or without named accounts", () => {
    expect(creditRouteFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(creditRouteFromEnv({ ZENOD_CREDIT_ANTHROPIC_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("defaults to Claude Haiku 5.5 and a 10 dollar cap, for the named accounts only", () => {
    const route = creditRouteFromEnv({ ZENOD_CREDIT_ANTHROPIC_API_KEY: "k", ZENOD_CREDIT_TENANTS: " a , b " } as NodeJS.ProcessEnv)!;
    expect(route.model).toBe("claude-haiku-5-5");
    expect(route.askModel).toBe("claude-haiku-5-5");
    expect(route.monthlyUsd).toBe(10);
    expect(creditRouteFor(route, "a")).toBe(route);
    expect(creditRouteFor(route, "c")).toBeNull();
    const all = creditRouteFromEnv({ ZENOD_CREDIT_ANTHROPIC_API_KEY: "k", ZENOD_CREDIT_TENANTS: "all" } as NodeJS.ProcessEnv)!;
    expect(creditRouteFor(all, "anyone")).toBe(all);
  });

  it("prices Claude Haiku 5.5 at its own rate", () => {
    const usd = estimateCostUsd({ operation: "answer", provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, cacheCreationInputTokens: 0 });
    expect(usd).toBeCloseTo(0.6, 6);
  });
});

describe("credit route limits", () => {
  it("lets helpers run on the credit when the paid allowance is down to its reserve", () => {
    const paid = runtime({ credit: false });
    spend(paid, "openrouter", 2.52);
    expect(paid.featureBlock("personas", NOW)).not.toBeNull();

    const credit = runtime({ credit: true });
    spend(credit, "openrouter", 2.52);
    expect(credit.featureBlock("personas", NOW)).toBeNull();
    expect(credit.featureBlock("chat", NOW)).toBeNull();
    expect(credit.featureBlock("desk", NOW)).toBeNull();
    // Calls stay on the paid allowance and its reserve.
    expect(credit.featureBlock("calls", NOW)).not.toBeNull();
  });

  it("keeps credit spend out of the paid allowance and stops at the credit cap", () => {
    const credit = runtime({ credit: true });
    spend(credit, "anthropic", 0.5);
    expect(credit.aiAllowanceStatus(NOW)!.spendUsd).toBe(0);
    expect(credit.creditStatus(NOW)).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", spendUsd: 0.5, capUsd: 1 });
    expect(credit.featureBlock("chat", NOW)).toBeNull();
    // E7-S1 round 2: the paid route's limits on credit spend: helpers pause at the 50 cent reserve,
    // answers at the cap, filing carries on to the cap plus the 2 dollar filing overdraft.
    expect(credit.featureBlock("personas", NOW)?.reason).toBe("allowance");
    spend(credit, "anthropic", 0.6);
    expect(credit.featureBlock("chat", NOW)).not.toBeNull();
    expect(credit.featureBlock("filing", NOW)).toBeNull();
    spend(credit, "anthropic", 2);
    expect(credit.featureBlock("filing", NOW)).not.toBeNull();
  });

  it("restates the tester limits on Anthropic: helpers and desk keep their own monthly share", () => {
    const credit = runtime({ credit: true, capUsd: "3" });
    spend(credit, "anthropic", 1, "personas");
    expect(credit.featureBlock("personas", NOW)?.reason).toBe("share");
    expect(credit.featureBlock("chat", NOW)).toBeNull();
    expect(credit.featureBlock("desk", NOW)).toBeNull();
    // Paid speech to text does not use up the Anthropic cap, and Anthropic spend does not use up the paid allowance.
    spend(credit, "openrouter", 2.9);
    expect(credit.featureBlock("chat", NOW)).toBeNull();
    expect(credit.aiAllowanceStatus(NOW)!.spendUsd).toBeCloseTo(2.9, 6);
  });

  it("changes nothing for an account not named", () => {
    const other = runtime({ credit: true, tenantId: "tenant-b" });
    expect(other.creditStatus(NOW)).toBeNull();
    spend(other, "anthropic", 2.9);
    expect(other.aiAllowanceStatus(NOW)!.spendUsd).toBeCloseTo(2.9, 6);
    return expect(other.creditProbe()).resolves.toBeNull();
  });
});
