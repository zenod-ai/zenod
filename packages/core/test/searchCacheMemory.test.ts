import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { normalizedText } from "../src/ops/search.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

// E24-M3 round 2: the search text cache kept slices of whole file reads, so each filing pinned
// megabytes of old vault text and Zenod ran out of heap after about ten filings in a row.
describe("search text cache memory (E24-M3)", () => {
  it("does not keep the big text a cached line was cut from", () => {
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let file = 0; file < 20; file += 1) {
      // A 4 MB "file" built fresh each time; only one short line of it is cached.
      const big = `${String(file).padStart(4, "0")} ${"word ".repeat(800_000)}`;
      const line = big.slice(0, 40);
      expect(normalizedText(line)).toBe(normalizedText(line));
    }
    gc();
    const grownMb = (process.memoryUsage().heapUsed - before) / 1048576;
    // Pinned parents would hold about 80 MB here; flat copies hold a few kilobytes.
    expect(grownMb).toBeLessThan(20);
  });

  it("still returns the normalized text, from the cache and fresh", () => {
    expect(normalizedText("  Hello,   WORLD  ")).toBe(normalizedText("  Hello,   WORLD  "));
    expect(normalizedText("  Hello,   WORLD  ")).not.toMatch(/\s{2,}/);
  });
});
