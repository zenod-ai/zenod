import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { SqliteStateStore } from "zenod";

import { projectLedgerUsage } from "../src/customerMetering.js";
import { Runtime } from "../src/runtime.js";
import { Settings, platformLlmFromEnv, tenantMonthlyAllowanceFromEnv } from "../src/settings.js";
import { UsageStore } from "../src/usageStore.js";

const PLATFORM_KEY = "sk-or-v1-platform-secret-value";
const platform = { apiKey: PLATFORM_KEY, user: "tenant-a", models: { model_ask: "host/ask-model" } } as const;

function hosted(state: SqliteStateStore): Settings {
  return new Settings(state, undefined, {}, undefined, undefined, undefined, undefined, undefined, platform);
}

describe("platform OpenRouter key (D30)", () => {
  it("is off without the env var, and standalone settings are unchanged", () => {
    expect(platformLlmFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(platformLlmFromEnv({ ZENOD_PLATFORM_OPENROUTER_KEY: "  " } as NodeJS.ProcessEnv)).toBeNull();
    const s = new Settings(new SqliteStateStore(":memory:"));
    s.set("provider", "anthropic");
    s.set("anthropic_api_key", "sk-ant-own");
    expect(s.platformLlmActive()).toBe(false);
    expect(s.provider()).toBe("anthropic");
    expect(s.activeApiKey()).toBe("sk-ant-own");
    expect(s.openrouterUser()).toBeUndefined();
  });

  it("is authoritative over a stored tenant key and provider, which stay in place", () => {
    const state = new SqliteStateStore(":memory:");
    const own = new Settings(state);
    own.set("provider", "anthropic");
    own.set("anthropic_api_key", "sk-ant-own");
    own.set("openrouter_api_key", "sk-or-tenant-own");
    const s = hosted(state);
    expect(s.provider()).toBe("openrouter");
    expect(s.activeApiKey()).toBe(PLATFORM_KEY);
    expect(s.openrouterApiKey()).toBe(PLATFORM_KEY);
    expect(s.openrouterUser()).toBe("tenant-a");
    // Reversible: the same store read without the platform key sees the tenant's own settings again.
    expect(own.provider()).toBe("anthropic");
    expect(own.activeApiKey()).toBe("sk-ant-own");
  });

  it("never reveals the platform key through settings reads", () => {
    const s = hosted(new SqliteStateStore(":memory:"));
    const dump = JSON.stringify({ masked: s.masked(), openrouter: s.get("openrouter_api_key") });
    expect(dump).not.toContain(PLATFORM_KEY);
    expect(dump).not.toContain(PLATFORM_KEY.slice(-6));
    expect(s.get("openrouter_api_key")).toBeNull();
  });

  it("model allowlist: tenant model/routing overrides are ignored, host-configured models apply", () => {
    const s = hosted(new SqliteStateStore(":memory:"));
    s.set("model_ask", "evil/expensive-model");
    s.set("model_classify", "evil/other");
    s.set("model_vision", "evil/vision");
    s.set("llm_base_url", "https://attacker.example/v1");
    expect(s.get("model_ask")).toBe("host/ask-model");
    expect(s.get("model_classify")).toBeNull();
    expect(s.get("model_vision")).toBeNull();
    expect(s.llmBaseUrl()).toBeUndefined();
  });

  it("host models come from the existing ZENOD_MODEL_* env vars", () => {
    const p = platformLlmFromEnv({
      ZENOD_PLATFORM_OPENROUTER_KEY: "k",
      ZENOD_MODEL_ASK: "a/b",
      ZENOD_MODEL_CLASSIFY: "c/d",
    } as NodeJS.ProcessEnv);
    expect(p?.models).toEqual({ model_ask: "a/b", model_classify: "c/d" });
  });

  it("long transcription follows the platform key", () => {
    expect(hosted(new SqliteStateStore(":memory:")).longTranscriptionProvider()).toBe("openrouter");
  });
});

describe("per-tenant metering and shadow allowance", () => {
  it("parses the allowance env: unset or invalid means no check", () => {
    expect(tenantMonthlyAllowanceFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(tenantMonthlyAllowanceFromEnv({ ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "abc" } as NodeJS.ProcessEnv)).toBeNull();
    expect(tenantMonthlyAllowanceFromEnv({ ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "-1" } as NodeJS.ProcessEnv)).toBeNull();
    expect(tenantMonthlyAllowanceFromEnv({ ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "5" } as NodeJS.ProcessEnv)).toBe(5);
  });

  it("spendSince prefers the gateway cost and ignores failed attempts", () => {
    const u = new UsageStore(":memory:");
    try {
      const base = {
        operation: "answer" as const,
        provider: "openrouter" as const,
        model: "deepseek/deepseek-chat",
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
      u.record({ ...base, providerCostUsd: 0.5 });
      u.record({ ...base, providerCostUsd: 0.25 });
      u.record({ ...base, status: "failed", providerCostUsd: 9 });
      expect(u.spendSince(0)).toBeCloseTo(0.75, 9);
      expect(u.spendSince(Date.now() + 60_000)).toBe(0);
    } finally {
      u.close();
    }
  });

  it("ledger usage projection never pauses (shadow) and warns near the allowance", () => {
    expect(projectLedgerUsage(1, null)).toMatchObject({ state: "normal", percentageUsed: null, monthSpendUsd: 1 });
    expect(projectLedgerUsage(null, 5).state).toBe("normal");
    expect(projectLedgerUsage(1, 5)).toMatchObject({ state: "normal", percentageUsed: 20 });
    expect(projectLedgerUsage(4.5, 5)).toMatchObject({ state: "warn", percentageUsed: 90 });
    expect(projectLedgerUsage(50, 5)).toMatchObject({ state: "warn", percentageUsed: 100 });
  });
});

describe("Runtime.checkTenantAllowance", () => {
  it("logs llm.allowance.exceeded at most once per hour and never throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-allowance-"));
    const runtime = new Runtime(dir, undefined, {
      seedFromEnv: false,
      tenantId: "tenant-a",
      platformLlm: { apiKey: PLATFORM_KEY },
      tenantMonthlyAllowanceUsd: 1,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exceeded = () => warn.mock.calls.filter((c) => String(c[0]).includes("llm.allowance.exceeded"));
    try {
      const now = Date.now();
      runtime.checkTenantAllowance(now);
      expect(exceeded()).toHaveLength(0);
      runtime.usageStore.record(
        {
          operation: "answer",
          provider: "openrouter",
          model: "m",
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          providerCostUsd: 2,
        },
        now,
      );
      runtime.checkTenantAllowance(now + 61_000);
      runtime.checkTenantAllowance(now + 62_000);
      expect(exceeded()).toHaveLength(1);
      expect(String(exceeded()[0]![0])).toContain("tenant=tenant-a");
      expect(String(exceeded()[0]![0])).not.toContain(PLATFORM_KEY);
      runtime.checkTenantAllowance(now + 61_000 + 3_600_001);
      expect(exceeded()).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });
});
