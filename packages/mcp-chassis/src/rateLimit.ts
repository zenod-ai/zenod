/** In-memory per-key token bucket. No I/O: safe to run before any database work. */
export interface RateLimitOptions {
  /** Sustained requests per second. 0 or less disables limiting. */
  rps: number;
  /** Bucket capacity (max burst). */
  burst: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds (>= 1) the caller should wait before retrying; 0 when allowed. */
  retryAfterSeconds: number;
}

export const DEFAULT_MCP_RATE_LIMIT: RateLimitOptions = { rps: 10, burst: 30 };

const SWEEP_THRESHOLD = 10_000;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly options: RateLimitOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.options.rps > 0 && this.options.burst >= 1;
  }

  take(key: string): RateLimitDecision {
    if (!this.enabled) return { allowed: true, retryAfterSeconds: 0 };
    const { rps, burst } = this.options;
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: burst, at: now };
    bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * rps);
    bucket.at = now;
    // Re-insert so Map iteration order is least-recently-touched first.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > SWEEP_THRESHOLD) this.sweep(now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / rps)) };
  }

  /** Drop fully refilled buckets (equivalent to absent), then hard-cap against key churn. */
  private sweep(now: number): void {
    const { rps, burst } = this.options;
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + ((now - bucket.at) / 1000) * rps < burst) break;
      this.buckets.delete(key);
    }
    while (this.buckets.size > SWEEP_THRESHOLD * 2) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

export function rateLimitFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    rps: num(env.MCP_RATE_LIMIT_RPS, DEFAULT_MCP_RATE_LIMIT.rps),
    burst: num(env.MCP_RATE_LIMIT_BURST, DEFAULT_MCP_RATE_LIMIT.burst),
  };
}
