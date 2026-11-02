import { expect, it } from "vitest";
import { DIGESTION_OPERATIONS, UsageStore, operationsOf, usageCategory } from "../src/usageStore.js";

// EPIC-9 E9-5c: the ledger splits filing a capture from the memory-keeper's digestion, so the $0.05
// weekly digestion cap reads digestion spend only and filing cost is visible on its own.
it("splits filing, digestion and answers in the usage ledger; the cap reads digestion only", () => {
  const store = new UsageStore(":memory:");
  try {
    const row = (operation: string, cost: number) => store.record({ operation: operation as never, provider: "openrouter", model: "openai/gpt-5.6-luna",
      inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: cost }, 1_000);
    row("classify", 0.001);
    row("compose", 0.002);
    row("digest", 0.004);
    row("answer", 0.008);
    expect(usageCategory("classify")).toBe("filing");
    expect(usageCategory("compose")).toBe("filing");
    expect(usageCategory("digest")).toBe("digestion");
    expect(usageCategory("something-new")).toBe("other");
    expect(DIGESTION_OPERATIONS).toEqual(["digest"]);
    expect(operationsOf("filing").sort()).toEqual(["classify", "compose"]);

    const byCategory = Object.fromEntries(store.summary(0).byCategory.map((b) => [b.key, b]));
    expect(byCategory.filing!.calls).toBe(2);
    expect(byCategory.digestion!.calls).toBe(1);
    expect(byCategory.answers!.calls).toBe(1);
    expect(store.spendSince(0, DIGESTION_OPERATIONS)).toBeCloseTo(0.004, 9);
    expect(store.spendSince(0, operationsOf("filing"))).toBeCloseTo(0.003, 9);
    expect(store.spendSince(0)).toBeCloseTo(0.015, 9);
    expect(store.spendSince(0, [])).toBe(0);
  } finally {
    store.close();
  }
});
