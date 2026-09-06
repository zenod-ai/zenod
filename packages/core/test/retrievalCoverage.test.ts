import { describe, expect, it } from "vitest";
import { RetrievalCoverage } from "../src/engine/retrievalCoverage.js";
import type { EntrySearchResult } from "../src/engine/entryPagination.js";
import type { NotePassage } from "../src/ops/passage.js";

const ref = "Log/2026-01-01.md#^e-000001";
function catalog(snapshot = "frozen", hasMore = false, matchedEntries = 1): EntrySearchResult {
  return { entries: [{ evidenceRef: ref }] as EntrySearchResult["entries"], pagination: {
    hasMore, nextCursor: hasMore ? "cursor" : null, snapshot, matchedEntries, scannedEntries: 657,
    scannedVaultEntries: 657, scannedReceiptJobs: 0, receiptEnrichmentAvailable: false, scope: "all-local-vault-evidence",
  } };
}
function passage(start = 0, end = 100, version = "v1"): NotePassage {
  return { source: { path: "Log/2026-01-01.md", provider: "google_drive", url: "https://drive.google.com/file/d/test/view" },
    readPath: ref, identity: ref, version, part: "body", frontmatterChars: 2, body: "x".repeat(end - start),
    extent: { start, end, sectionStart: 0, sectionEnd: 100, scopeStart: 0, scopeEnd: 100, total: 100, unit: "utf16" },
    truncated: start > 0 || end < 100, omittedBefore: start > 0, nextCursor: end < 100 ? "next" : null };
}

describe("host-owned audit coverage", () => {
  it("does not treat a final tail page as a complete catalog", () => {
    const tracker = new RetrievalCoverage("audit", []);
    tracker.recordSearch({ cursor: "prior-turn" }, catalog("frozen", false, 161));
    tracker.recordRead(passage());
    expect(tracker.result().status).toBe("partial");
    expect(tracker.result().searches[0]!.enumerationComplete).toBe(false);
  });
  it("requires a contiguous current-version read after enumeration; old reads cannot fill new gaps", () => {
    const tracker = new RetrievalCoverage("audit", []);
    tracker.recordRead(passage());
    tracker.recordSearch({}, catalog());
    expect(tracker.result().searches[0]!.unreadEvidenceRefs).toEqual([ref]);
    tracker.recordRead(passage(0, 100));
    expect(tracker.result().status).toBe("complete-bounded-scope");
    tracker.recordRead(passage(50, 100, "v2"));
    expect(tracker.result().status).toBe("partial");
    tracker.recordRead(passage(0, 50, "v2"));
    expect(tracker.result().status).toBe("complete-bounded-scope");
  });
  it("does not use an unversioned bootstrap pin to certify a later enumerated snapshot", () => {
    const tracker = new RetrievalCoverage("audit", [ref]);
    expect(tracker.result().status).toBe("complete-bounded-scope"); // Pinned-only scope.
    tracker.recordSearch({}, catalog("changed-after-pin"));
    expect(tracker.result().status).toBe("partial");
    expect(tracker.result().searches[0]!.unreadEvidenceRefs).toEqual([ref]);
    tracker.recordRead(passage(0, 100, "current"));
    expect(tracker.result().status).toBe("complete-bounded-scope");
  });
  it("discards enumeration on snapshot changes and exposes a fresh restart", () => {
    const tracker = new RetrievalCoverage("audit", []);
    tracker.recordSearch({ capturedBefore: "2026-01-02" }, catalog()); tracker.recordRead(passage());
    tracker.invalidate({ capturedBefore: "2026-01-02" });
    expect(tracker.result().status).toBe("partial");
    expect(tracker.result().continuation).toContainEqual({ tool: "search_entries", input: { capturedBefore: "2026-01-02", exhaustive: true } });
  });
});
