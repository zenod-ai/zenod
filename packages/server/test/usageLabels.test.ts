import { describe, expect, it } from "vitest";
import { withFeature } from "../src/limits.js";
import { formatSessionLog } from "../src/sessionLog.js";
import { DEFAULT_USAGE_APP, UsageStore, usageApp } from "../src/usageStore.js";

// E15-Q4: every model call is logged with an app/feature label, and cost adds up per label, so once
// each app has its own key the spend on that key can be checked against this log.
const call = { provider: "openrouter" as const, model: "deepseek/deepseek-chat", inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: 0 };

describe("usage labels (E15-Q4)", () => {
  it("reads the app label from ZENOD_APP_LABEL, else zenod", () => {
    expect(usageApp({})).toBe(DEFAULT_USAGE_APP);
    expect(usageApp({ ZENOD_APP_LABEL: "Zenod-Tests" })).toBe("zenod-tests");
    expect(usageApp({ ZENOD_APP_LABEL: "no spaces allowed" })).toBe(DEFAULT_USAGE_APP);
  });

  it("labels each call by app and feature and sums spend per label", () => {
    const store = new UsageStore(":memory:", { app: "zenod-tests" });
    try {
      store.record({ ...call, operation: "classify", providerCostUsd: 0.02 });
      store.record({ ...call, operation: "compose", providerCostUsd: 0.01 });
      store.record({ ...call, operation: "answer", providerCostUsd: 0.005 });
      store.record({ ...call, operation: "answer", status: "failed", errorCode: "answer_cancelled" });
      withFeature("personas", () => store.record({ ...call, operation: "answer", providerCostUsd: 0.001 }));
      const labels = store.spendByLabelSince(0);
      expect(labels.map((row) => row.label)).toEqual(["zenod-tests/filing", "zenod-tests/chat", "zenod-tests/personas"]);
      expect(labels[0]).toMatchObject({ app: "zenod-tests", feature: "filing", calls: 2, failedCalls: 0 });
      expect(labels[0]!.spendUsd).toBeCloseTo(0.03, 9);
      expect(labels[1]).toMatchObject({ calls: 2, failedCalls: 1 });
      expect(labels[1]!.spendUsd).toBeCloseTo(0.005, 9);
      expect(store.summary(0).byLabel).toEqual(labels);
      const timeline = store.timeline({ limit: 10 });
      expect(timeline.every((row) => row.label.startsWith("zenod-tests/"))).toBe(true);
      expect(formatSessionLog(timeline, 60)).toContain("zenod-tests/chat answer");
    } finally {
      store.close();
    }
  });
});
