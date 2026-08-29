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

  it("persists provider-specific revisions and URLs without a GitHub compatibility value", () => {
    const store = new IngestStore(":memory:");
    const job = store.enqueue("drive-1", "Drive note.md");
    const revision = {
      provider: "google_drive" as const,
      id: "drive-txn-1",
      committedAt: "2026-08-29T10:00:00.000Z",
      urls: ["https://drive.google.com/file/d/log-1/view"],
    };
    store.update(job.id, {
      status: "done",
      evidenceRef: "Log/2026-08-29.md#^e-drive",
      pages: ["Projects/Zenod.md"],
      revision,
      urls: revision.urls,
    });

    expect(store.get(job.id)).toMatchObject({
      revision,
      urls: revision.urls,
      commitSha: null,
      githubUrls: [],
    });
  });
});
