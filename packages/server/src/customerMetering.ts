import type { UsageSummary } from "./usageStore.js";

// Balance thresholds are transplanted from zenod-ai/cloud services/webhook/src/usage.ts @ 6bdb318.

export type BalanceState = "ok" | "warn" | "blocked";

export interface GatewayKeyUsage {
  name: string;
  slug: string | null;
  limit: number | null;
  usage: number | null;
  limit_remaining: number | null;
  disabled: boolean;
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
        limit,
        usage,
        limit_remaining: limit !== null && usage !== null ? Math.max(0, limit - usage) : reportedRemaining,
        disabled: Boolean(row.disabled),
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
