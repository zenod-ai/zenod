import type { UsageSummary } from "./usageStore.js";

// Balance thresholds are transplanted from zenod-ai/cloud services/webhook/src/usage.ts @ 6bdb318.

export type BalanceState = "ok" | "warn" | "blocked";

export interface GatewayKeyUsage {
  name: string;
  slug: string | null;
  hash: string | null;
  limit: number | null;
  /** Lifetime provider usage. Operator evidence only; never use for a resetting customer cap. */
  usage: number | null;
  usage_monthly: number | null;
  byok_usage_monthly: number | null;
  limit_remaining: number | null;
  disabled: boolean;
  limit_reset: "monthly" | null;
  include_byok_in_limit: boolean | null;
  reset_at: string | null;
}

export type CustomerUsageState = "normal" | "warn" | "paused" | "setting_up" | "unavailable";

export interface CustomerUsageProjection {
  /** UTC month-to-date spend from the tenant's own ledger (platform-key mode only). */
  monthSpendUsd?: number | null;
  /** The tenant's monthly AI allowance in USD (platform-key mode); null = no cap set. */
  allowanceUsd?: number | null;
  /** Per-meter breakdown for the console card: AI processing and WhatsApp messages/voice. */
  breakdown?: CustomerUsageBreakdown;
  percentageUsed: number | null;
  state: CustomerUsageState;
  resetsAt: string | null;
}

export interface CustomerUsageBreakdown {
  ai: { spendUsd: number | null; allowanceUsd: number | null; percentageUsed: number | null; paused: boolean };
  channel: { usedUnits: number; allowanceUnits: number; percentageUsed: number; paused: boolean } | null;
}

export function balanceState(input: { limit: number | null; limit_remaining: number | null }): BalanceState {
  if (input.limit_remaining !== null && input.limit_remaining <= 0) return "blocked";
  if (input.limit !== null && input.limit_remaining !== null && input.limit > 0 && input.limit_remaining / input.limit <= 0.15) {
    return "warn";
  }
  return "ok";
}

export async function listGatewayKeys(provisioningKey: string): Promise<GatewayKeyUsage[]> {
  const response = await fetch("https://openrouter.ai/api/v1/keys?include_disabled=true", {
    headers: { Authorization: `Bearer ${provisioningKey}` },
  });
  if (!response.ok) throw new Error(`OpenRouter keys list failed (${response.status})`);
  const payload = (await response.json()) as { data?: unknown[] };
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && typeof (row as Record<string, unknown>).name === "string" &&
        String((row as Record<string, unknown>).name).startsWith("zenod-tenant:"),
    )
    .map((row) => {
      const name = String(row.name);
      const limit = typeof row.limit === "number" ? row.limit : null;
      const usage = typeof row.usage === "number" ? row.usage : null;
      const usageMonthly = typeof row.usage_monthly === "number" ? row.usage_monthly : null;
      const byokUsageMonthly = typeof row.byok_usage_monthly === "number" ? row.byok_usage_monthly : null;
      const reportedRemaining = typeof row.limit_remaining === "number" ? row.limit_remaining : null;
      const includedMonthlyUsage = usageMonthly === null
        ? null
        : usageMonthly + (row.include_byok_in_limit === true ? (byokUsageMonthly ?? 0) : 0);
      return {
        name,
        slug: name.slice("zenod-tenant:".length) || null,
        hash: typeof row.hash === "string" ? row.hash : null,
        limit,
        usage,
        usage_monthly: usageMonthly,
        byok_usage_monthly: byokUsageMonthly,
        limit_remaining:
          reportedRemaining ??
          (limit !== null && includedMonthlyUsage !== null ? Math.max(0, limit - includedMonthlyUsage) : null),
        disabled: Boolean(row.disabled),
        limit_reset: row.limit_reset === "monthly" ? "monthly" : null,
        include_byok_in_limit:
          typeof row.include_byok_in_limit === "boolean" ? row.include_byok_in_limit : null,
        reset_at: typeof row.reset_at === "string" ? row.reset_at : null,
      };
    });
}

export async function gatewayKeyForSlug(provisioningKey: string, slug: string): Promise<GatewayKeyUsage | null> {
  return (await listGatewayKeys(provisioningKey)).find((key) => key.slug === slug) ?? null;
}

export async function customerMetering(
  summary: UsageSummary,
  provisioningKey: string | undefined,
  tenantSlug: string | null,
): Promise<{
  balance: { limitUsd: number | null; usageUsd: number | null; remainingUsd: number | null; state: BalanceState } | null;
  ledger: { calls: number; tokens: number; costUsd: number };
}> {
  let balance: { limitUsd: number | null; usageUsd: number | null; remainingUsd: number | null; state: BalanceState } | null = null;
  if (provisioningKey && tenantSlug) {
    try {
      const gateway = await gatewayKeyForSlug(provisioningKey, tenantSlug);
      if (gateway) {
        const operatorRemaining = gateway.limit_remaining ??
          (gateway.limit !== null && gateway.usage !== null ? Math.max(0, gateway.limit - gateway.usage) : null);
        balance = {
          limitUsd: gateway.limit,
          usageUsd: gateway.usage,
          remainingUsd: operatorRemaining,
          state: balanceState({ limit: gateway.limit, limit_remaining: operatorRemaining }),
        };
      }
    } catch {
      // Gateway truth is unavailable; do not fabricate a balance from local spend.
    }
  }
  return {
    balance,
    ledger: {
      calls: summary.calls,
      tokens:
        summary.inputTokens +
        summary.outputTokens +
        summary.cachedInputTokens +
        summary.cacheCreationInputTokens,
      costUsd: summary.costUsd,
    },
  };
}

export function nextUtcMonthlyReset(now: number): string {
  const current = new Date(now);
  return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
}

function resetDateLabel(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** What a capped user is told (WhatsApp reply, MCP tool error, console) when their AI allowance is used up. */
export function aiAllowanceExhaustedMessage(resetsAt: string | null): string {
  const reset = resetDateLabel(resetsAt);
  return "⚠️ You have used this month's AI allowance on your Zenod plan, so I can't process this message. "
    + "It was not saved. "
    + (reset ? `Your allowance resets on ${reset}; please send it again then.` : "Please send it again once your allowance resets.");
}

/** Media variant: the original is archived (no AI needed), but not transcribed, read or filed. */
export function aiAllowanceArchivedMediaMessage(resetsAt: string | null): string {
  const reset = resetDateLabel(resetsAt);
  return "⚠️ You have used this month's AI allowance on your Zenod plan. "
    + "I archived the original file, but did not read or file it into your memory. "
    + (reset ? `Your allowance resets on ${reset}.` : "Filing resumes once your allowance resets.");
}

export function projectCustomerUsage(
  gateway: GatewayKeyUsage | null,
  warnPercent = 80,
  now = Date.now(),
): CustomerUsageProjection {
  // OpenRouter's monthly usage window resets at a UTC midnight boundary and its
  // management response does not currently include a reset timestamp. Prefer a
  // future explicit timestamp, otherwise derive the next UTC month boundary from
  // the authoritative `limit_reset=monthly` policy (never from key creation time).
  const resetsAt = gateway?.reset_at ??
    (gateway?.limit_reset === "monthly" ? nextUtcMonthlyReset(now) : null);
  if (!gateway || gateway.limit === null || gateway.limit <= 0) {
    return { percentageUsed: null, state: "unavailable", resetsAt };
  }
  const monthlyUsed =
    gateway.limit_remaining !== null
      ? gateway.limit - gateway.limit_remaining
      : gateway.usage_monthly !== null
        ? gateway.usage_monthly +
          (gateway.include_byok_in_limit ? (gateway.byok_usage_monthly ?? 0) : 0)
        : null;
  if (monthlyUsed === null) {
    return {
      percentageUsed: null,
      state: gateway.disabled ? "paused" : "unavailable",
      resetsAt,
    };
  }
  const percentageUsed = Math.min(100, Math.max(0, Math.round(monthlyUsed / gateway.limit * 100)));
  const state: CustomerUsageState =
    gateway.disabled || percentageUsed >= 100 ? "paused" : percentageUsed >= warnPercent ? "warn" : "normal";
  return { percentageUsed, state, resetsAt };
}

export async function customerUsageProjection(
  provisioningKey: string | undefined,
  tenantSlug: string | null,
): Promise<CustomerUsageProjection> {
  if (!provisioningKey || !tenantSlug) return projectCustomerUsage(null);
  try {
    return projectCustomerUsage(await gatewayKeyForSlug(provisioningKey, tenantSlug));
  } catch {
    // Hosted customer responses fail closed instead of projecting the local estimate as provider truth.
    return projectCustomerUsage(null);
  }
}

/**
 * Platform-key (D30) usage projection: this tenant's UTC month-to-date ledger spend against its AI allowance.
 * With the allowance enforced, reaching it reports "paused" (AI work stops until the reset); in shadow mode it
 * only warns. Unset allowance or an unreadable ledger = 0%, state normal, so hosted admission is never gated
 * on a missing figure.
 */
export function projectLedgerUsage(
  spendUsd: number | null,
  allowanceUsd: number | null,
  warnPercent = 80,
  now = Date.now(),
  enforced = false,
): CustomerUsageProjection {
  const resetsAt = nextUtcMonthlyReset(now);
  // A missing figure fails open: the combined Zenod+Phylax projection and hosted admission treat a null
  // percentage as "unavailable" and queue paid requests, so report 0% when there is nothing to compare.
  if (spendUsd === null) return { percentageUsed: 0, state: "normal", resetsAt, monthSpendUsd: null, allowanceUsd };
  if (allowanceUsd === null || allowanceUsd <= 0) {
    return { percentageUsed: 0, state: "normal", resetsAt, monthSpendUsd: spendUsd, allowanceUsd: null };
  }
  const percentageUsed = Math.min(100, Math.max(0, Math.round(spendUsd / allowanceUsd * 100)));
  const state: CustomerUsageState = enforced && spendUsd >= allowanceUsd
    ? "paused"
    : percentageUsed >= warnPercent ? "warn" : "normal";
  return { percentageUsed, state, resetsAt, monthSpendUsd: spendUsd, allowanceUsd };
}
