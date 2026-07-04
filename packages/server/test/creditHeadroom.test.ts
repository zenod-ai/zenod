import { describe, expect, it } from "vitest";
import { creditHeadroomDecision } from "../src/sessionLog.js";

// C-25 · W2-3 (#570) — credit-headroom warning (burn-rate projection vs configured budget).
describe("creditHeadroomDecision (C-25)", () => {
  it("is unconfigured when no budget is set (never a false alarm)", () => {
    const d = creditHeadroomDecision({ windowSpendUsd: 5, windowMinutes: 60, budgetUsdPerDay: null });
    expect(d.level).toBe("unconfigured");
    expect(d.projectedDailyUsd).toBeCloseTo(120, 5); // $5/h → $120/day
  });

  it("stays ok when projected daily burn is below the warn fraction", () => {
    // $2 in 60m → $48/day; budget $240/day → 20% → ok.
    const d = creditHeadroomDecision({ windowSpendUsd: 2, windowMinutes: 60, budgetUsdPerDay: 240 });
    expect(d.level).toBe("ok");
    expect(Math.round(d.fractionOfBudget! * 100)).toBe(20);
  });

  it("warns when projected daily burn reaches 80% of budget", () => {
    // $5 in 60m → $120/day; budget $144/day → ~83% ≥ 80% → warn.
    const d = creditHeadroomDecision({ windowSpendUsd: 5, windowMinutes: 60, budgetUsdPerDay: 144 });
    expect(d.level).toBe("warn");
    expect(d.message).toContain("/day");
    expect(d.message.toLowerCase()).toContain("top up");
  });

  it("respects a custom warn fraction", () => {
    // 50% of budget; default 0.8 → ok, but warnFraction 0.4 → warn.
    const args = { windowSpendUsd: 5, windowMinutes: 60, budgetUsdPerDay: 240 } as const;
    expect(creditHeadroomDecision(args).level).toBe("ok");
    expect(creditHeadroomDecision({ ...args, warnFraction: 0.4 }).level).toBe("warn");
  });

  it("extrapolates short windows correctly (10m → daily)", () => {
    // $1 in 10m → $6/h → $144/day.
    const d = creditHeadroomDecision({ windowSpendUsd: 1, windowMinutes: 10, budgetUsdPerDay: 200 });
    expect(d.projectedDailyUsd).toBeCloseTo(144, 4);
  });
});
