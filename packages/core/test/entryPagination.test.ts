import { describe, expect, it } from "vitest";
import { paginateMemoryEntries } from "../src/engine/entryPagination.js";
import { memoryTimestamp, selectMemoryEntries } from "../src/engine/evidence.js";
import type { MemoryEntry } from "../src/types.js";

const entries: MemoryEntry[] = Array.from({ length: 657 }, (_, i) => ({
  evidenceRef: `Log/2026-01-01.md#^e-${i.toString(16).padStart(6, "0")}`,
  path: "Log/2026-01-01.md", anchor: `e-${i.toString(16).padStart(6, "0")}`, title: "Synthetic title",
  content: i % 2 ? "ORCHID amber" : "ORCHARD violet", source: "mcp", verbatim: true,
  capturedAt: i % 3 === 0 ? "2026-01-01T10:00:00+02:00" : i % 3 === 1 ? "2026-01-01T08:00:00Z" : "2026-01-01T08:00:00",
  provider: "google_drive", url: "https://drive.google.com/drive/synthetic", sourceId: String(i),
}));

describe("entry pagination", () => {
  it.each(["oldest", "newest"] as const)("normalizes equal timestamps and traverses every tie in %s order", order => {
    const refs: string[] = []; let cursor: string | undefined;
    do {
      const page = paginateMemoryEntries([...entries].reverse(), { order, limit: 17 }, "tenant-a", cursor);
      refs.push(...page.entries.map(e => e.evidenceRef)); cursor = page.nextCursor ?? undefined;
      expect(page.matchedEntries).toBe(657);
    } while (cursor);
    expect(refs).toEqual((order === "oldest" ? entries : [...entries].reverse()).map(e => e.evidenceRef));
    expect(new Set(refs).size).toBe(657);
  });
  it("uses inclusive instants, UTC legacy values, AND text terms and exact source identities", () => {
    expect(memoryTimestamp("2026-01-01T08:00:00")).toBe(memoryTimestamp("2026-01-01T10:00:00+02:00"));
    const selected = selectMemoryEntries(entries, { capturedAfter: "2026-01-01T08:00:00Z", capturedBefore: "2026-01-01T08:00:00Z", query: "ORCHID AMBER", sourceId: "1" });
    expect(selected.map(e => e.sourceId)).toEqual(["1"]);
    expect(selectMemoryEntries(entries, { capturedAfter: "2026-01-01T08:00:00.001Z" })).toEqual([]);
    for (const invalid of ["bad", "2026-02-30", "2026-01-01T24:00:00Z", "September 1, 2026"]) expect(() => selectMemoryEntries(entries, { capturedAfter: invalid })).toThrow("Invalid capture");
    expect(() => selectMemoryEntries(entries, { capturedAfter: "2026-02-01", capturedBefore: "2026-01-01" })).toThrow("must not exceed");
  });
  it("binds cursors to the complete snapshot, query, tenant and authenticated position", () => {
    const { nextCursor } = paginateMemoryEntries(entries, { limit: 2 }, "tenant-a");
    const token = nextCursor!;
    expect(() => paginateMemoryEntries(entries, {}, "tenant-b", token)).toThrow("Invalid entry cursor");
    expect(() => paginateMemoryEntries(entries, { query: "amber" }, "tenant-a", token)).toThrow("Invalid entry cursor");
    const [payload, signature] = token.split(".");
    const forged = JSON.parse(Buffer.from(payload!, "base64url").toString()); forged.after[1] = entries[500]!.evidenceRef;
    expect(() => paginateMemoryEntries(entries, {}, "tenant-a", `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`)).toThrow("Invalid entry cursor");
    expect(() => paginateMemoryEntries(entries.slice(1), {}, "tenant-a", token)).toThrow("snapshot changed");
    expect(() => paginateMemoryEntries(entries.map((e,i) => i === 500 ? {...e, content: "new content"} : e), {}, "tenant-a", token)).toThrow("snapshot changed");
    for (const cursor of ["bad", "e30.a", ".", "x".repeat(2049)]) expect(() => paginateMemoryEntries(entries, {}, "tenant-a", cursor)).toThrow("Invalid entry cursor");
  });
});
