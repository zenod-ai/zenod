import type { UsageCall, UsageTimelineQuery } from "./usageStore.js";

/**
 * Deterministic read of the LLM-usage ledger (`/data/usage.sqlite`) as an
 * operation-labelled timeline. This is the "check the logs" primitive that used
 * to require SSH + `docker logs` on the VPS: the app container mounts `/data`,
 * so exposing it through the Console MCP gateway lets any instance (a fan-out
 * worker in its throwaway sandbox, or the Console chat) read what actually ran
 * without host access. It reads the durable ledger, which survives container
 * recreate — unlike stdout, which every deploy wipes. See docs/SESSION-LOG-FORENSICS.md.
 */

export type SessionLogReader = (query: UsageTimelineQuery) => UsageCall[];

export interface SessionLogToolArgs {
  windowMinutes?: unknown;
  operation?: unknown;
  model?: unknown;
  limit?: unknown;
}

export function sessionLogQueryFromToolArgs(args: SessionLogToolArgs): UsageTimelineQuery & { windowMinutes: number } {
  const windowMinutes = typeof args.windowMinutes === "number" && Number.isFinite(args.windowMinutes) ? args.windowMinutes : 120;
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : undefined;
  return {
    sinceMs: Date.now() - windowMinutes * 60 * 1000,
    windowMinutes,
    ...(typeof args.operation === "string" && args.operation ? { operation: args.operation } : {}),
    ...(typeof args.model === "string" && args.model ? { model: args.model } : {}),
    ...(limit ? { limit } : {}),
  };
}

function usd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 5 : 4)}`;
}

// C-25 · W2-3 (#570) — credit-headroom warning. The usage ledger records spend, not a
// balance, so headroom is projected from the recent BURN RATE against a CONFIGURED daily
// budget: extrapolate the window's spend to a full day and warn when it reaches
// `warnFraction` of the budget. Ledger-driven + configurable, honest about being a
// projection (a precise balance needs an OpenRouter/Anthropic balance feed we don't have).
// #507's honest out_of_credits pause stays as the last line; this is the early warning.
export interface CreditHeadroom {
  level: "ok" | "warn" | "unconfigured";
  windowSpendUsd: number;
  projectedDailyUsd: number;
  budgetUsdPerDay: number | null;
  fractionOfBudget: number | null;
  message: string;
}

export function creditHeadroomDecision(opts: {
  windowSpendUsd: number;
  windowMinutes: number;
  budgetUsdPerDay: number | null;
  warnFraction?: number;
}): CreditHeadroom {
  const warnFraction = opts.warnFraction && opts.warnFraction > 0 ? opts.warnFraction : 0.8;
  const hours = Math.max(opts.windowMinutes, 1) / 60;
  const projectedDailyUsd = (opts.windowSpendUsd / hours) * 24;
  if (opts.budgetUsdPerDay === null || !(opts.budgetUsdPerDay > 0)) {
    return {
      level: "unconfigured",
      windowSpendUsd: opts.windowSpendUsd,
      projectedDailyUsd,
      budgetUsdPerDay: null,
      fractionOfBudget: null,
      message: "Credit headroom not configured (set ZENOD_CREDIT_BUDGET_USD_PER_DAY to enable the C-25 warning).",
    };
  }
  const fractionOfBudget = projectedDailyUsd / opts.budgetUsdPerDay;
  const level = fractionOfBudget >= warnFraction ? "warn" : "ok";
  const message =
    level === "warn"
      ? `Credit burn is high: at the last ${Math.round(opts.windowMinutes)}m rate you'd spend ${usd(projectedDailyUsd)}/day — ${Math.round(fractionOfBudget * 100)}% of the ${usd(opts.budgetUsdPerDay)}/day budget. Top up or throttle before it hits out_of_credits.`
      : `Credit burn OK: projected ${usd(projectedDailyUsd)}/day (${Math.round(fractionOfBudget * 100)}% of budget).`;
  return { level, windowSpendUsd: opts.windowSpendUsd, projectedDailyUsd, budgetUsdPerDay: opts.budgetUsdPerDay, fractionOfBudget, message };
}

export function formatSessionLog(calls: UsageCall[], windowMinutes: number): string {
  if (calls.length === 0) {
    return `No LLM-usage ledger rows matched the last ${windowMinutes}m. Either nothing ran in that window, or the filter excluded everything. (docker stdout is not read here — the durable ledger is.)`;
  }
  const totalCost = calls.reduce((sum, c) => sum + c.costUsd, 0);
  const totalIn = calls.reduce((sum, c) => sum + c.inputTokens + c.cachedInputTokens + c.cacheCreationInputTokens, 0);
  const totalOut = calls.reduce((sum, c) => sum + c.outputTokens, 0);
  const header = `${calls.length} LLM call(s) in the last ${windowMinutes}m — ${usd(totalCost)}, ${totalIn} in / ${totalOut} out tokens. Newest first:`;
  const lines = calls.map((c) => {
    const at = new Date(c.ts).toISOString();
    const cached = c.cachedInputTokens ? ` cached=${c.cachedInputTokens}` : "";
    const created = c.cacheCreationInputTokens ? ` cacheWrite=${c.cacheCreationInputTokens}` : "";
    const outcome = c.status === "failed" ? ` — failed:${c.errorCode ?? "unknown"}` : "";
    return `[${at}] ${c.operation} — ${c.provider}/${c.model} — in=${c.inputTokens}${cached}${created} out=${c.outputTokens} — ${usd(c.costUsd)}${outcome}`;
  });
  return [header, ...lines].join("\n");
}
