import { describe, expect, it } from "vitest";
import { IngestStore } from "../src/ingestStore.js";

describe("IngestStore.staleActive (M-5)", () => {
  it("returns only active jobs older than the threshold, oldest first", () => {
    let now = 1_000_000;
    const store = new IngestStore(":memory:", () => now);
    const old = store.enqueue("drive-old", "Old.m4a", [], now);
    now += 5000;
    const recent = store.enqueue("drive-recent", "Recent.m4a", [], now);

    const threshold = 10 * 60 * 1000;
    now += threshold + 60_000; // both are now older than the threshold
    expect(store.staleActive(now, threshold).map((j) => j.id)).toEqual([old.id, recent.id]);

    // Only the truly-old one is stale relative to a later "now" placed between them.
    const between = old.createdAt + threshold + 1;
    expect(store.staleActive(between, threshold).map((j) => j.id)).toEqual([old.id]);
  });

  it("excludes terminal jobs even if old", () => {
    let now = 1_000_000;
    const store = new IngestStore(":memory:", () => now);
    const job = store.enqueue("drive-1", "Done.m4a", [], now);
    store.update(job.id, { status: "done", evidenceRef: "Log/x.md#^e-1", pages: [], commitSha: "abc" }, now);
    now += 20 * 60 * 1000;
    expect(store.staleActive(now, 10 * 60 * 1000)).toEqual([]);
  });
});
