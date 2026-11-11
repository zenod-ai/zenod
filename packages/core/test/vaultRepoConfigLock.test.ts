import { describe, expect, it } from "vitest";
import { retryConfigLock } from "../src/git/vaultRepo.js";

// EPIC-21 V7: a store_memory job failed with "could not lock config file .git/config: File exists" when two git
// calls rewrote .git/config at once; config writes are idempotent, so they retry briefly.
describe("retryConfigLock", () => {
  it("retries a config lock race and then succeeds", async () => {
    let calls = 0;
    const result = await retryConfigLock(async () => {
      calls += 1;
      if (calls < 3) throw new Error("error: could not lock config file .git/config: File exists");
      return "ok";
    }, 5, 1);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry other errors and gives up after its attempts", async () => {
    let calls = 0;
    await expect(retryConfigLock(async () => { calls += 1; throw new Error("fatal: not a git repository"); }, 5, 1)).rejects.toThrow("not a git repository");
    expect(calls).toBe(1);
    calls = 0;
    await expect(retryConfigLock(async () => { calls += 1; throw new Error("could not lock config file"); }, 3, 1)).rejects.toThrow("could not lock");
    expect(calls).toBe(3);
  });
});
