import { DEEPSEEK_BASE_URL } from "zenod";

/**
 * Hosted background route (EPIC-14 S10 round 4). Background jobs — filing, desk work, persona
 * runs and, once it ships, nightly self-reflection — can run on DeepSeek's own API with a prepaid
 * balance, while chat answers and calls stay on OpenRouter, which also catches any background
 * call DeepSeek fails. Inactive until the host env carries DEEPSEEK_API_KEY (the per-app secret
 * zenod-mt/DEEPSEEK_API_KEY): without it nothing changes.
 *
 * Why DeepSeek's own API and not the OpenCode Go plan: OpenCode's terms (effective 2026-11-08)
 * allow its services only "for your own internal use, and not on behalf of or for the benefit of
 * any third party", and Go "is designed for OpenCode and other coding agents". Hosted customers
 * are third parties; DeepSeek's platform terms allow serving "internal and external end users".
 * Evidence: docs/evidence/e14-s10-go-2026-11-09.md.
 *
 * Env (host, never tenant settings):
 *   DEEPSEEK_API_KEY                   the key; absent = route off
 *   ZENOD_BACKGROUND_ROUTE             per job: "filing=deepseek,desk=deepseek,personas=deepseek,reflection=deepseek"
 *                                      (the default when the key exists); a job set to "openrouter" stays there;
 *                                      "off" turns the whole route off while keeping the key
 *   ZENOD_BACKGROUND_MODEL             default "deepseek-flash" (DeepSeek V4.1 Flash)
 *   ZENOD_BACKGROUND_LOW_BALANCE_USD   health reads "low" at or under this balance; default 5
 */
export type BackgroundJob = "filing" | "desk" | "personas" | "reflection";
export const BACKGROUND_JOBS: readonly BackgroundJob[] = ["filing", "desk", "personas", "reflection"];
export type BackgroundProvider = "deepseek" | "openrouter";

export interface BackgroundRoute {
  apiKey: string;
  model: string;
  jobs: Record<BackgroundJob, BackgroundProvider>;
  lowBalanceUsd: number;
}

/** The route from host env; null when the key is absent or the route is "off". */
export function backgroundRouteFromEnv(env: NodeJS.ProcessEnv): BackgroundRoute | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  const raw = env.ZENOD_BACKGROUND_ROUTE?.trim().toLowerCase() ?? "";
  if (raw === "off") return null;
  const jobs = Object.fromEntries(BACKGROUND_JOBS.map((job) => [job, "deepseek"])) as Record<BackgroundJob, BackgroundProvider>;
  for (const part of raw.split(",")) {
    const [job, provider] = part.split("=").map((value) => value.trim());
    if ((BACKGROUND_JOBS as readonly string[]).includes(job ?? "") && (provider === "deepseek" || provider === "openrouter")) {
      jobs[job as BackgroundJob] = provider;
    }
  }
  const low = Number(env.ZENOD_BACKGROUND_LOW_BALANCE_USD);
  return {
    apiKey,
    model: env.ZENOD_BACKGROUND_MODEL?.trim() || "deepseek-flash",
    jobs,
    lowBalanceUsd: Number.isFinite(low) && low >= 0 && env.ZENOD_BACKGROUND_LOW_BALANCE_USD?.trim() ? low : 5,
  };
}

/** What /api/health shows about the route: never the key, only its state. */
export interface BackgroundHealth {
  provider: "deepseek" | "off";
  jobs?: Record<BackgroundJob, BackgroundProvider>;
  /** ok: balance above the alert line · low: at or under it · empty: DeepSeek refuses calls · unknown: not read yet or unreadable. */
  state: "ok" | "low" | "empty" | "unknown" | "off";
  balanceUsd?: number | null;
  checkedAt?: string | null;
}

/** DeepSeek's GET /user/balance, reduced to USD and whether calls are served. */
export async function readDeepseekBalance(apiKey: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<{ available: boolean; balanceUsd: number | null }> {
  const response = await fetchImpl(`${DEEPSEEK_BASE_URL}/user/balance`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`deepseek balance http ${response.status}`);
  const body = await response.json() as { is_available?: unknown; balance_infos?: Array<{ currency?: unknown; total_balance?: unknown }> };
  const usd = body.balance_infos?.find((info) => info.currency === "USD");
  const balance = usd ? Number(usd.total_balance) : NaN;
  return { available: body.is_available !== false, balanceUsd: Number.isFinite(balance) ? balance : null };
}

/**
 * Reads the DeepSeek balance every interval and keeps the state /api/health reports. A change
 * into low or empty logs one `[background] ALERT` line (and back to ok one recovery line), so the
 * health check and the logs both carry the alert without repeating it every interval.
 */
export class BackgroundBalanceMonitor {
  private health: BackgroundHealth;
  /** The last state an alert or recovery line was logged for; an unreadable check never resets it. */
  private alerted: "ok" | "low" | "empty" = "ok";
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly route: BackgroundRoute,
    private readonly options: { fetch?: typeof globalThis.fetch; intervalMs?: number; now?: () => number; log?: (line: string) => void } = {},
  ) {
    this.health = { provider: "deepseek", jobs: route.jobs, state: "unknown", balanceUsd: null, checkedAt: null };
  }

  status(): BackgroundHealth {
    return { ...this.health };
  }

  async check(): Promise<BackgroundHealth> {
    const log = this.options.log ?? ((line: string) => console.warn(line));
    let state: BackgroundHealth["state"];
    let balanceUsd: number | null = null;
    try {
      const read = await readDeepseekBalance(this.route.apiKey, this.options.fetch);
      balanceUsd = read.balanceUsd;
      state = !read.available || (balanceUsd !== null && balanceUsd <= 0) ? "empty"
        : balanceUsd !== null && balanceUsd <= this.route.lowBalanceUsd ? "low"
        : balanceUsd === null ? "unknown" : "ok";
    } catch {
      state = "unknown";
    }
    this.health = { provider: "deepseek", jobs: this.route.jobs, state, balanceUsd, checkedAt: new Date((this.options.now ?? Date.now)()).toISOString() };
    if ((state === "low" || state === "empty") && state !== this.alerted) {
      log(`[background] ALERT deepseek balance ${state}: $${balanceUsd ?? "?"} left (alert at $${this.route.lowBalanceUsd}); background work falls back to OpenRouter when it runs out`);
      this.alerted = state;
    } else if (state === "ok" && this.alerted !== "ok") {
      log(`[background] deepseek balance ok again: $${balanceUsd}`);
      this.alerted = "ok";
    }
    return this.status();
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 15 * 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

let processMonitor: BackgroundBalanceMonitor | null = null;

/** Start the one process-wide monitor for this route (idempotent). */
export function startBackgroundBalanceMonitor(route: BackgroundRoute | null): void {
  if (!route || processMonitor) return;
  processMonitor = new BackgroundBalanceMonitor(route);
  processMonitor.start();
}

/** The route's state for /api/health. */
export function backgroundHealth(): BackgroundHealth {
  return processMonitor ? processMonitor.status() : { provider: "off", state: "off" };
}
