import type { UsageSummary } from "./usageStore.js";

// Balance thresholds are transplanted from zenod-ai/cloud services/webhook/src/usage.ts @ 6bdb318.

export type BalanceState = "ok" | "warn" | "blocked";

export interface GatewayKeyUsage {
  name: string;
  slug: string | null;
  hash: string | null;
  limit: number | null;
  usage: number | null;
  limit_remaining: number | null;
  disabled: boolean;
  limit_reset: "monthly" | null;
  include_byok_in_limit: boolean | null;
  reset_at: string | null;
}

export type CustomerUsageState = "normal" | "warn" | "paused" | "unavailable";

export interface CustomerUsageProjection {
  percentageUsed: number | null;
  state: CustomerUsageState;
  resetsAt: string | null;
}

export function balanceState(input: { limit: number | null; limit_remaining: number | null }): BalanceState {
  if (input.limit_remaining !== null && input.limit_remaining <= 0) return "blocked";
  if (input.limit !== null && input.limit_remaining !== null && input.limit > 0 && input.limit_remaining / input.limit <= 0.15) {
    return "warn";
  }
  return "ok";
}

export async function listGatewayKeys(provisioningKey: string): Promise<GatewayKeyUsage[]> {
  const response = await fetch("https://openrouter.ai/api/v1/keys", {
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
      const reportedRemaining = typeof row.limit_remaining === "number" ? row.limit_remaining : null;
      return {
        name,
        slug: name.slice("zenod-tenant:".length) || null,
        hash: typeof row.hash === "string" ? row.hash : null,
        limit,
        usage,
        limit_remaining: limit !== null && usage !== null ? Math.max(0, limit - usage) : reportedRemaining,
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
        balance = {
          limitUsd: gateway.limit,
          usageUsd: gateway.usage,
          remainingUsd: gateway.limit_remaining,
          state: balanceState(gateway),
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

function nextMonthlyReset(now: number): string {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

export function projectCustomerUsage(
  gateway: GatewayKeyUsage | null,
  warnPercent = 80,
  now = Date.now(),
): CustomerUsageProjection {
  const resetsAt = gateway?.reset_at ?? (gateway?.limit_reset === "monthly" ? nextMonthlyReset(now) : null);
  if (!gateway || gateway.limit === null || gateway.usage === null || gateway.limit <= 0) {
    return { percentageUsed: null, state: "unavailable", resetsAt };
  }
  const percentageUsed = Math.min(100, Math.max(0, Math.round(gateway.usage / gateway.limit * 100)));
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
