/**
 * Anthropic credit route (EPIC-14 S41 round 2, Jordi on E14-A11: "get the anthropic api key wired ...
 * fix anthropic route until it works"). Named accounts run their answers, filing, desk work, helpers
 * and the quick index on alpha9's Anthropic startup credit (Claude Haiku 5.5) instead of the paid
 * OpenRouter and DeepSeek routes. Approved for Zenod's background work in E24-A1; the key is the one
 * alpha9 already holds on the Alpha Analytics organisation (VPS1 store, never printed).
 *
 * Credit calls do not count toward the paid monthly AI allowance; they have their own monthly cap
 * per account. Calls (realtime voice) and speech to text stay on OpenAI and the paid allowance.
 *
 * Env (host, never tenant settings):
 *   ZENOD_CREDIT_ANTHROPIC_API_KEY   the key; absent = route off for everyone
 *   ZENOD_CREDIT_TENANTS             comma-separated tenant ids on the credit, or "all"; empty = nobody
 *   ZENOD_CREDIT_MODEL               default "claude-haiku-5-5"
 *   ZENOD_CREDIT_ASK_MODEL           the answer model; default the credit model
 *   ZENOD_CREDIT_MONTHLY_USD         per-account monthly cap on credit spend; default 10
 */
export interface CreditRoute {
  apiKey: string;
  model: string;
  askModel: string;
  tenants: "all" | ReadonlySet<string>;
  monthlyUsd: number;
}

export const CREDIT_PROVIDER = "anthropic";

/** The route from host env; null when the key is absent or no account is named. */
export function creditRouteFromEnv(env: NodeJS.ProcessEnv): CreditRoute | null {
  const apiKey = env.ZENOD_CREDIT_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const raw = env.ZENOD_CREDIT_TENANTS?.trim() ?? "";
  const tenants = raw.toLowerCase() === "all"
    ? "all" as const
    : new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
  if (tenants !== "all" && tenants.size === 0) return null;
  const model = env.ZENOD_CREDIT_MODEL?.trim() || "claude-haiku-5-5";
  const cap = Number(env.ZENOD_CREDIT_MONTHLY_USD);
  return {
    apiKey,
    model,
    askModel: env.ZENOD_CREDIT_ASK_MODEL?.trim() || model,
    tenants,
    monthlyUsd: env.ZENOD_CREDIT_MONTHLY_USD?.trim() && Number.isFinite(cap) && cap >= 0 ? cap : 10,
  };
}

/** Whether this account runs on the credit. */
export function creditRouteFor(route: CreditRoute | null, tenantId: string): CreditRoute | null {
  if (!route) return null;
  return route.tenants === "all" || route.tenants.has(tenantId) ? route : null;
}

/** The message a paused credit feature shows; the wording matches the paid allowance stop. */
export function creditCapMessage(resetsAt: string): string {
  return `This month's AI allowance for this account is used up. It resets on ${resetsAt.slice(0, 10)}.`;
}
