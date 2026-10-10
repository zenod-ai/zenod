import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteFailureLimiter,
  createSqliteFailureLimiterFromEnv,
  failureKeys,
  tokenFingerprint,
} from "../src/authFailureLimiter.js";

const FAKE_TOKEN = "zmt_FAKE_TEST_VALUE_not_a_real_token";
const rules = {
  ip: { max: 3, windowMs: 1000 },
  token: { max: 2, windowMs: 1000 },
  global: { max: 5, windowMs: 1000 },
};

let limiter: SqliteFailureLimiter | null = null;
afterEach(() => {
  limiter?.close();
  limiter = null;
});

describe("SqliteFailureLimiter", () => {
  it("blocks an IP after max failures and reports Retry-After", () => {
    limiter = new SqliteFailureLimiter(":memory:", rules);
    const keys = failureKeys({ ip: "203.0.113.7" });
    for (let i = 0; i < 3; i++) limiter.recordFailure(keys, 10_000 + i);
    const result = limiter.check(keys, 10_500);
    expect(result.blocked).toBe(true);
    expect(result.retryAfterSeconds).toBe(1);
    expect(limiter.check(failureKeys({ ip: "203.0.113.8" }), 10_500).blocked).toBe(false);
  });

  it("slides: failures expire after the window", () => {
    limiter = new SqliteFailureLimiter(":memory:", rules);
    const keys = failureKeys({ ip: "203.0.113.7" });
    for (let i = 0; i < 3; i++) limiter.recordFailure(keys, 10_000);
    expect(limiter.check(keys, 10_999).blocked).toBe(true);
    expect(limiter.check(keys, 11_001).blocked).toBe(false);
  });

  it("limits the same bad token across different IPs, keyed by hash only", () => {
    limiter = new SqliteFailureLimiter(":memory:", rules);
    limiter.recordFailure(failureKeys({ ip: "198.51.100.1", token: FAKE_TOKEN }), 5000);
    limiter.recordFailure(failureKeys({ ip: "198.51.100.2", token: FAKE_TOKEN }), 5001);
    expect(limiter.check(failureKeys({ ip: "198.51.100.3", token: FAKE_TOKEN }), 5002).blocked).toBe(true);
    expect(failureKeys({ token: FAKE_TOKEN }).join()).not.toContain(FAKE_TOKEN);
    expect(tokenFingerprint(FAKE_TOKEN)).toHaveLength(12);
  });

  it("global key is alert-only: reports a trip but never blocks", () => {
    limiter = new SqliteFailureLimiter(":memory:", rules);
    for (let i = 0; i < 5; i++) limiter.recordFailure(failureKeys({ ip: `192.0.2.${i}` }), 7000);
    const result = limiter.check(failureKeys({ ip: "192.0.2.99" }), 7001);
    expect(result.globalTripped).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.retryAfterSeconds).toBe(0);
    expect(limiter.isBlocked("global", 7001)).toBe(false);
  });

  it("keeps rows bounded and sweeps expired rows", () => {
    limiter = new SqliteFailureLimiter(":memory:", rules);
    const keys = failureKeys({ ip: "203.0.113.7" });
    for (let i = 0; i < 50; i++) limiter.recordFailure(keys, 1000);
    // ip capped at 3 rows + global capped at 5 rows, regardless of attempt volume.
    expect(limiter.sweep(1500, true)).toBe(0);
    expect(limiter.sweep(2500, true)).toBe(8);
  });

  it("persists across instances (restart / second replica on the same file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-limit-"));
    try {
      const env = { MCP_AUTH_RATE_LIMIT_STORE: "sqlite" };
      const first = createSqliteFailureLimiterFromEnv(env, dir)!;
      const keys = failureKeys({ ip: "203.0.113.9" });
      const now = Date.now();
      for (let i = 0; i < 10; i++) first.recordFailure(keys, now);
      first.close();
      limiter = createSqliteFailureLimiterFromEnv(env, dir)!;
      expect(limiter.check(keys, now + 1).blocked).toBe(true);
    } finally {
      limiter?.close();
      limiter = null;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is off by default", () => {
    expect(createSqliteFailureLimiterFromEnv({}, tmpdir())).toBeNull();
    expect(createSqliteFailureLimiterFromEnv({ MCP_AUTH_RATE_LIMIT_STORE: "memory" }, tmpdir())).toBeNull();
  });
});
