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

/**
 * E7-S1 round 2: what /api/health says about the Anthropic route across every account in this
 * process since it started: calls that worked, calls that failed and the last failure's code. Never
 * an account, a prompt or the key.
 */
const tally = {
  since: new Date().toISOString(),
  calls: 0,
  failed: 0,
  lastOkAt: null as string | null,
  lastFailedAt: null as string | null,
  lastError: null as string | null,
  byModel: {} as Record<string, number>,
};

export function noteCreditCall(report: { status?: "succeeded" | "failed"; errorCode?: string | null; model?: string }, at: number = Date.now()): void {
  const when = new Date(at).toISOString();
  if (report.status === "failed") {
    tally.failed += 1;
    tally.lastFailedAt = when;
    tally.lastError = (report.errorCode ?? "provider_error").slice(0, 60);
    return;
  }
  tally.calls += 1;
  tally.lastOkAt = when;
  if (report.model) tally.byModel[report.model] = (tally.byModel[report.model] ?? 0) + 1;
}

/** ok: the last call worked · failing: the last call failed · idle: no call yet since start. */
export function creditCallHealth(): { state: "ok" | "failing" | "idle"; since: string; calls: number; failed: number; byModel: Record<string, number>; lastOkAt: string | null; lastFailedAt: string | null; lastError: string | null } {
  const state = tally.lastFailedAt && (!tally.lastOkAt || tally.lastFailedAt > tally.lastOkAt) ? "failing" : tally.lastOkAt ? "ok" : "idle";
  return { state, ...tally, byModel: { ...tally.byModel } };
}

/** Test seam: forget the tally. */
export function resetCreditCallHealth(): void {
  Object.assign(tally, { since: new Date().toISOString(), calls: 0, failed: 0, lastOkAt: null, lastFailedAt: null, lastError: null, byModel: {} });
}
