import { describe, expect, it } from "vitest";
import { rateLimitFromEnv, TokenBucketLimiter } from "./rateLimit.js";

describe("TokenBucketLimiter", () => {
  it("allows a burst, then refills at rps", () => {
    let now = 0;
    const l = new TokenBucketLimiter({ rps: 10, burst: 30 }, () => now);
    for (let i = 0; i < 30; i++) expect(l.take("t").allowed).toBe(true);
    const denied = l.take("t");
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now += 100; // one token
    expect(l.take("t").allowed).toBe(true);
    expect(l.take("t").allowed).toBe(false);
  });

  it("isolates keys and is disabled at rps 0", () => {
    const l = new TokenBucketLimiter({ rps: 1, burst: 1 }, () => 0);
    expect(l.take("a").allowed).toBe(true);
    expect(l.take("a").allowed).toBe(false);
    expect(l.take("b").allowed).toBe(true);
    expect(new TokenBucketLimiter({ rps: 0, burst: 0 }).take("x").allowed).toBe(true);
  });

  it("a connector reconnect loop (init+notify+list every 2s) is never limited by defaults", () => {
    let now = 0;
    const l = new TokenBucketLimiter(rateLimitFromEnv({}), () => now);
    for (let i = 0; i < 1000; i++) {
      now += 2000;
      for (let j = 0; j < 3; j++) expect(l.take("t").allowed).toBe(true);
    }
  });

  it("reads env overrides and ignores garbage", () => {
    expect(rateLimitFromEnv({ MCP_RATE_LIMIT_RPS: "5", MCP_RATE_LIMIT_BURST: "9" })).toEqual({ rps: 5, burst: 9 });
    expect(rateLimitFromEnv({ MCP_RATE_LIMIT_RPS: "abc" })).toEqual({ rps: 10, burst: 30 });
  });
});
