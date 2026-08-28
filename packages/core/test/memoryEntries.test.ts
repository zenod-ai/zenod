import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEvidence, getEvidenceEntry, searchEvidenceEntries } from "../src/engine/evidence.js";

describe("immutable memory entry retrieval", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function vault(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "zenod-memory-entries-"));
    created.push(path);
    return path;
  }

  it("filters and orders generic entries by typed provenance", async () => {
    const path = await vault();
    const older = await appendEvidence(
      path,
      "First voice transcript",
      "whatsapp",
      true,
      new Date("2026-08-01T10:00:00Z"),
      {
        contentType: "voice_note",
        capturedAt: "2026-08-01T09:59:40.000Z",
        sourceId: "wamid.first",
      },
    );
    const newer = await appendEvidence(
      path,
      "Second voice transcript",
      "whatsapp",
      true,
      new Date("2026-08-01T11:00:00Z"),
      {
        contentType: "voice_note",
        capturedAt: "2026-08-01T10:59:40.000Z",
        sourceId: "wamid.second",
      },
    );
    await appendEvidence(path, "Ordinary MCP memory", "mcp", false, new Date("2026-08-01T12:00:00Z"), {
      contentType: "text",
      capturedAt: "2026-08-01T12:00:00.000Z",
    });

    const entries = await searchEvidenceEntries(path, {
      source: "whatsapp",
      contentType: "voice_note",
      order: "newest",
      limit: 10,
    });

    expect(entries.map((entry) => entry.evidenceRef)).toEqual([
      `${newer.logPath}#^${newer.anchor}`,
      `${older.logPath}#^${older.anchor}`,
    ]);
    expect(entries[0]).toMatchObject({
      content: "Second voice transcript",
      capturedAt: "2026-08-01T10:59:40.000Z",
      sourceId: "wamid.second",
      source: "whatsapp",
      contentType: "voice_note",
    });

    const exact = await searchEvidenceEntries(path, { sourceId: "wamid.first" });
    expect(exact.map((entry) => entry.evidenceRef)).toEqual([`${older.logPath}#^${older.anchor}`]);
  });

  it("reads one exact anchored entry without exposing its daily-log neighbors", async () => {
    const path = await vault();
    const target = await appendEvidence(path, "Target transcript", "whatsapp", true, new Date("2026-08-01T10:00:00Z"), {
      contentType: "voice_note",
    });
    await appendEvidence(path, "Unrelated neighbor", "mcp", false, new Date("2026-08-01T10:01:00Z"));

    const entry = await getEvidenceEntry(path, `${target.logPath}#^${target.anchor}`);

    expect(entry.content).toBe("Target transcript");
    expect(entry.content.includes("Unrelated neighbor")).toBe(false);
  });
});
