import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SPIKE prototype: SQLite-backed sliding-window limiter for FAILED auth attempts.
 * Standalone (not wired into any route). Its method names mirror the in-memory
 * `FailedAttemptLimiter` proposed in PR #1373 so that limiter can swap to it.
 * Default OFF: enabled only with MCP_AUTH_RATE_LIMIT_STORE=sqlite.
 */

export interface FailureRule {
  max: number;
  windowMs: number;
}

export type FailureScope = "ip" | "token" | "global";

export const DEFAULT_FAILURE_RULES: Record<FailureScope, FailureRule> = {
  ip: { max: 10, windowMs: 5 * 60_000 },
  token: { max: 5, windowMs: 5 * 60_000 },
  global: { max: 300, windowMs: 5 * 60_000 },
};

/** Short non-reversible fingerprint; raw token text must never reach keys or logs. */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12);
}

/** Limiter keys for one request. `token` is hashed here and never stored raw. */
export function failureKeys(input: { ip?: string; token?: string | null }): string[] {
  const keys = ["global"];
  if (input.ip) keys.push(`ip:${input.ip.slice(0, 64)}`);
  if (input.token) keys.push(`tok:${tokenFingerprint(input.token)}`);
  return keys;
}

function scopeOf(key: string): FailureScope {
  return key.startsWith("ip:") ? "ip" : key.startsWith("tok:") ? "token" : "global";
}

export class SqliteFailureLimiter {
  private readonly db: DatabaseSync;
  private lastSweep = 0;

  constructor(
    path: string,
    private readonly rules: Record<FailureScope, FailureRule> = DEFAULT_FAILURE_RULES,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout = 2000;");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_failures (key TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS auth_failures_key_at ON auth_failures (key, at);
    `);
  }

  private recent(key: string, now: number): number[] {
    const { windowMs } = this.rules[scopeOf(key)];
    return this.db
      .prepare("SELECT at FROM auth_failures WHERE key = ? AND at > ? ORDER BY at ASC")
      .all(key, now - windowMs)
      .map((row) => Number((row as { at: number }).at));
  }

  /** Seconds until `key` may try again (0 when not blocked). */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const { max, windowMs } = this.rules[scopeOf(key)];
    const recent = this.recent(key, now);
    if (recent.length < max) return 0;
    return Math.max(1, Math.ceil((recent[recent.length - max]! + windowMs - now) / 1000));
  }

  isBlocked(key: string, now = Date.now()): boolean {
    return this.retryAfterSeconds(key, now) > 0;
  }

  /** Blocked when ANY key is over its rule; returns the longest Retry-After. */
  check(keys: string[], now = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
    const retryAfterSeconds = Math.max(0, ...keys.map((key) => this.retryAfterSeconds(key, now)));
    return { blocked: retryAfterSeconds > 0, retryAfterSeconds };
  }

  /** Records a failure per key. Keys already at their cap are skipped so rows stay bounded. */
  recordFailure(keys: string | string[], now = Date.now()): void {
    const insert = this.db.prepare("INSERT INTO auth_failures (key, at) VALUES (?, ?)");
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.recent(key, now).length < this.rules[scopeOf(key)].max) insert.run(key, now);
    }
    this.sweep(now);
  }

  /** Deletes rows older than the longest window; throttled to once a minute unless forced. */
  sweep(now = Date.now(), force = false): number {
    if (!force && now - this.lastSweep < 60_000) return 0;
    this.lastSweep = now;
    const longest = Math.max(...Object.values(this.rules).map((rule) => rule.windowMs));
    return Number(this.db.prepare("DELETE FROM auth_failures WHERE at <= ?").run(now - longest).changes);
  }

  close(): void {
    this.db.close();
  }
}

/** Returns null (feature off) unless MCP_AUTH_RATE_LIMIT_STORE=sqlite. */
export function createSqliteFailureLimiterFromEnv(
  env: Record<string, string | undefined>,
  dataDir: string,
): SqliteFailureLimiter | null {
  if (env.MCP_AUTH_RATE_LIMIT_STORE?.trim().toLowerCase() !== "sqlite") return null;
  return new SqliteFailureLimiter(join(dataDir, "auth-rate-limit.sqlite"));
}
