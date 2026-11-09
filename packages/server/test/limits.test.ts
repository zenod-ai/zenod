import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmAllowanceExceededError, type BrainEngine, type LlmUsageReport } from "zenod";

import {
  DEFAULT_LIMITS,
  featureDecision,
  featureForOperation,
  limitsFromEnv,
  usageView,
  withFeature,
  type UsageFeature,
} from "../src/limits.js";
import { Runtime } from "../src/runtime.js";
import { TaskJobQueue, featureForJob } from "../src/taskJobQueue.js";
import { TaskJobStore } from "../src/taskJobStore.js";
import { UsageStore, readFeatureSpend } from "../src/usageStore.js";

// EPIC-14 S10: one limits model for the AI allowance. Filing never stops at it, chat answers stop at
// it, personas, desk jobs and calls stop at their own share or once only the reserve is left.

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const RESETS = "2026-12-01T00:00:00.000Z";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "zenod-limits-"));
  dirs.push(dir);
  return dir;
};

function report(operation: string, usd: number): LlmUsageReport {
  return {
    operation, provider: "openrouter", model: "m", inputTokens: 1, outputTokens: 1,
    cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: usd,
  } as LlmUsageReport;
}

const decide = (feature: UsageFeature, totalUsd: number, featureUsd = 0, allowanceUsd: number | null = 3) =>
  featureDecision(feature, { totalUsd, featureUsd, allowanceUsd, resetsAt: RESETS }, DEFAULT_LIMITS);

describe("limits config", () => {
  it("has the caps the earlier steps set, in one place", () => {
    expect(DEFAULT_LIMITS).toMatchObject({
      personas: { monthUsd: 1 },
      desk: { jobsPerDay: 20 },
      calls: { monthUsd: 1, callUsd: 0.5, callMaxMinutes: 10, allAccountsMonthUsd: 10 },
    });
  });

  it("takes valid overrides from ZENOD_LIMITS_JSON and ignores bad ones", () => {
    const limits = limitsFromEnv({ ZENOD_LIMITS_JSON: JSON.stringify({ reserveUsd: 1, personas: { monthUsd: 0.5 }, calls: { callUsd: -2 } }) } as NodeJS.ProcessEnv);
    expect(limits.reserveUsd).toBe(1);
    expect(limits.personas.monthUsd).toBe(0.5);
    expect(limits.calls.callUsd).toBe(DEFAULT_LIMITS.calls.callUsd);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(limitsFromEnv({ ZENOD_LIMITS_JSON: "{nope" } as NodeJS.ProcessEnv)).toEqual(DEFAULT_LIMITS);
    } finally {
      warn.mockRestore();
    }
  });

  it("counts each engine operation and job kind as one feature", () => {
    expect(featureForOperation("call")).toBe("calls");
    expect(featureForOperation("answer")).toBe("chat");
    expect(featureForOperation("classify")).toBe("filing");
    expect(featureForOperation("transcribe")).toBe("filing");
    expect(featureForJob("store")).toBe("filing");
    expect(featureForJob("media_ingest")).toBe("filing");
    expect(featureForJob("chat")).toBe("chat");
    expect(featureForJob("desk_job")).toBe("desk");
  });
});

describe("near and at the cap, per feature", () => {
  it("filing never stops at the allowance, only far past it", () => {
    expect(decide("filing", 2.5).state).toBe("near");
    expect(decide("filing", 3.2).state).toBe("near");
    expect(decide("filing", 5.99).state).toBe("near");
    const stopped = decide("filing", 6);
    expect(stopped).toMatchObject({ state: "paused", reason: "allowance" });
    expect(stopped.message).toContain("kept as you sent them");
  });

  it("chat answers stop at the allowance and say what you send is kept", () => {
    expect(decide("chat", 1).state).toBe("ok");
    expect(decide("chat", 2.5).state).toBe("near");
    const stopped = decide("chat", 3);
    expect(stopped).toMatchObject({ state: "paused", reason: "allowance" });
    expect(stopped.message).toContain("still kept");
  });

  it("personas, the desk and calls pause once only the reserve is left", () => {
    for (const feature of ["personas", "desk", "calls"] as const) {
      expect(decide(feature, 2.4).state).not.toBe("paused");
      expect(decide(feature, 2.5)).toMatchObject({ state: "paused", reason: "allowance" });
    }
    expect(decide("calls", 2.5).message).toContain("Calls are paused");
  });

  it("each pauses at its own share, allowance or not", () => {
    expect(decide("personas", 1, 1)).toMatchObject({ state: "paused", reason: "share" });
    expect(decide("desk", 0.5, 0.5)).toMatchObject({ state: "paused", reason: "share" });
    expect(decide("calls", 1, 1, null)).toMatchObject({ state: "paused", reason: "share" });
    expect(decide("calls", 1, 1, null).message).toContain("$1.00");
    expect(decide("desk", 0.42, 0.42, null).state).toBe("near");
    expect(decide("chat", 50, 50, null).state).toBe("ok");
  });

  it("the usage view adds up the features and shows where each stops", () => {
    const view = usageView({ byFeature: { filing: 1.2, chat: 0.3, personas: 0.1 }, allowanceUsd: 3, resetsAt: RESETS }, DEFAULT_LIMITS);
    expect(view).toMatchObject({ allowanceUsd: 3, percentageUsed: 53, reserveUsd: 0.5 });
    expect(view.spentUsd).toBeCloseTo(1.6);
    const byId = Object.fromEntries(view.features.map((feature) => [feature.id, feature]));
    expect(byId.filing).toMatchObject({ spentUsd: 1.2, shareUsd: null, stopsAtUsd: 6, state: "ok" });
    expect(byId.chat).toMatchObject({ stopsAtUsd: 3 });
    expect(byId.personas).toMatchObject({ shareUsd: 1, stopsAtUsd: 2.5 });
    expect(byId.calls!.costs).toMatch(/cents a minute/);
  });
});

describe("usage ledger by feature", () => {
  it("tags each call by its explicit feature, its context, else its operation", () => {
    const store = new UsageStore(join(tempDir(), "usage.sqlite"));
    try {
      store.record(report("classify", 0.1), NOW);
      store.record(report("answer", 0.02), NOW);
      store.record(report("answer", 0.05), NOW, "personas");
      withFeature("desk", () => store.record(report("compose", 0.004), NOW));
      store.record(report("call", 0.01), NOW);
      store.record(report("classify", 9), NOW - 40 * 86_400_000);
      const spend = store.spendByFeatureSince(Date.UTC(2026, 10, 1));
      expect(spend.filing).toBeCloseTo(0.1);
      expect(spend.chat).toBeCloseTo(0.02);
      expect(spend.personas).toBeCloseTo(0.05);
      expect(spend.desk).toBeCloseTo(0.004);
      expect(spend.calls).toBeCloseTo(0.01);
    } finally {
      store.close();
    }
  });

  it("reads a tenant's file for the admin view, also one from before the feature column", () => {
    const dir = tempDir();
    const path = join(dir, "usage.sqlite");
    const store = new UsageStore(path);
    store.record(report("call", 0.2), NOW);
    store.close();
    expect(readFeatureSpend(path, 0)).toMatchObject({ calls: 0.2, filing: 0 });

    const legacy = join(dir, "legacy.sqlite");
    const db = new DatabaseSync(legacy);
    db.exec("CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, ts INTEGER, operation TEXT, provider TEXT, model TEXT, cost_usd REAL)");
    db.prepare("INSERT INTO llm_usage (ts, operation, provider, model, cost_usd) VALUES (?, 'answer', 'p', 'm', 0.3)").run(NOW);
    db.close();
    expect(readFeatureSpend(legacy, 0)).toMatchObject({ chat: 0.3 });
    expect(readFeatureSpend(join(dir, "missing.sqlite"), 0)).toBeNull();
  });
});

describe("the runtime applies the limits model", () => {
  function hosted(): Runtime {
    return new Runtime(tempDir(), undefined, {
      seedFromEnv: false,
      tenantId: "tenant-a",
      platformLlm: { apiKey: "sk-or-v1-test" },
      tenantMonthlyAllowanceUsd: 3,
    });
  }

  it("stops each feature at its own point as the month fills up", () => {
    const runtime = hosted();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      runtime.usageStore.record(report("classify", 2.6), NOW);
      expect(runtime.featureBlock("personas", NOW)).toMatchObject({ reason: "allowance", message: expect.stringContaining("Helpers are paused") });
      expect(runtime.featureBlock("calls", NOW)).not.toBeNull();
      expect(runtime.featureBlock("desk", NOW)).not.toBeNull();
      expect(runtime.featureBlock("chat", NOW)).toBeNull();
      expect(runtime.featureBlock("filing", NOW)).toBeNull();

      runtime.usageStore.record(report("classify", 0.6), NOW);
      const later = NOW + 61_000;
      expect(runtime.featureBlock("chat", later)).not.toBeNull();
      expect(runtime.featureBlock("filing", later)).toBeNull();
      // A filing's model call goes on past the allowance; an answer's does not.
      expect(() => withFeature("filing", () => runtime.checkTenantAllowance(later))).not.toThrow();
      expect(() => runtime.checkTenantAllowance(later)).toThrow(LlmAllowanceExceededError);

      runtime.usageStore.record(report("classify", 3), NOW);
      const muchLater = later + 61_000;
      expect(runtime.featureBlock("filing", muchLater)).not.toBeNull();
      expect(() => withFeature("filing", () => runtime.checkTenantAllowance(muchLater))).toThrow(LlmAllowanceExceededError);
    } finally {
      warn.mockRestore();
    }
  });

  it("stops the desk at its own share while the allowance has room", () => {
    const runtime = hosted();
    runtime.usageStore.record(report("compose", 0.5), NOW, "desk");
    expect(runtime.featureBlock("desk", NOW)).toMatchObject({ reason: "share", message: expect.stringContaining("$0.50") });
    expect(runtime.featureBlock("personas", NOW)).toBeNull();
    expect(runtime.monthSpendByFeature(NOW).desk).toBeCloseTo(0.5);
  });
});

describe("the job queue keeps filing", () => {
  it("runs a store even while every feature is stopped", async () => {
    const dir = tempDir();
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const engineStore = vi.fn(async () => ({ evidenceRef: "Log/2026-11-15.md#^a", pagesTouched: [], filing: "inbox" }));
    const queue = new TaskJobQueue(store, async () => ({ store: engineStore } as unknown as BrainEngine), undefined, undefined, () => ({ message: "stopped", resetsAt: RESETS }));
    const quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    try {
      queue.enqueue("store", { content: "the shed is green", source: "web" });
      for (let i = 0; i < 200 && engineStore.mock.calls.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(engineStore).toHaveBeenCalledTimes(1);
    } finally {
      quiet.forEach((spy) => spy.mockRestore());
      await queue.close();
    }
  });
});
