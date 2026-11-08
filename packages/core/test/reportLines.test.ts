import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveReportLines, MOVED_REPORT_LINES_PATH, planReportLines } from "../src/engine/reportLines.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";

/** E12-S8 fix 4: agent-report lines on the person's pages are listed (dry run) and moved only on request, reversibly. */
const LOG = [
  "# 2026-11-01", "",
  "## 09:00 Voice note about the garden  ^e-a00001", "- source: whatsapp", "", "> Tomato beds need compost before planting.", "",
  "## 17:04 agent_team E46-S9 report  ^e-b00001", "- source: mcp", "", "> agent_team E46-S9 report: first proof, the note was placed as idea I-10; dispatched and merged.", "",
].join("\n");
const PAGE = [
  "---", "title: Garden", "type: note", "tags: []", "created: 2026-10-01", "updated: 2026-11-01", "summary: The garden.", "---", "",
  "# Garden", "",
  "- Tomato beds need compost before planting [[2026-11-01#^e-a00001]].",
  "- First proof: the note was placed as idea I-10 [[2026-11-01#^e-b00001]].",
  "- Both, mixed [[2026-11-01#^e-a00001]] [[2026-11-01#^e-b00001]].", "",
  "## Ops rollup", "", "- 2026-11-01 ops (1): [[2026-11-01#^e-b00001]]", "",
].join("\n");

describe("E12-S8 report lines on the person's pages", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-e12s8-report-"));
    for (const [path, content] of [["Log/2026-11-01.md", LOG], ["Notes/Garden.md", PAGE]] as const) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("lists only lines whose every citation is an agent report, outside the ops rollup, and writes nothing", async () => {
    const plan = await planReportLines(dir);
    expect(plan).toMatchObject({ pagesScanned: 1, citedLines: 3 });
    expect(plan.lines).toEqual([{ page: "Notes/Garden.md", line: 13, text: "- First proof: the note was placed as idea I-10 [[2026-11-01#^e-b00001]].", citations: ["2026-11-01#^e-b00001"] }]);
    expect(await readFile(join(dir, "Notes/Garden.md"), "utf8")).toBe(PAGE);
  });

  it("moves them byte for byte with their page and line, and can be reverted", async () => {
    const writes = new TrackedWrites(dir);
    const written = await moveReportLines(dir, await planReportLines(dir), "2026-11-08", writes);
    expect(written.sort()).toEqual([MOVED_REPORT_LINES_PATH, "Notes/Garden.md"].sort());
    const page = await readFile(join(dir, "Notes/Garden.md"), "utf8");
    expect(page).not.toContain("idea I-10");
    expect(page).toContain("Tomato beds need compost");
    expect(page).toContain("- 2026-11-01 ops (1)");
    const archive = await readFile(join(dir, MOVED_REPORT_LINES_PATH), "utf8");
    expect(archive).toContain("## 2026-11-08 from [[Notes/Garden]] line 13\n\n- First proof: the note was placed as idea I-10 [[2026-11-01#^e-b00001]].\n");
    await writes.revert();
    expect(await readFile(join(dir, "Notes/Garden.md"), "utf8")).toBe(PAGE);
  });
});

describe("E12-S15 report lines under the Ops rollup heading", () => {
  let dir: string;
  // Topic filing appended these after the rollup section, so they sit under its heading.
  const UNDER = `${PAGE}- Garden plan: rows two and three get the tomatoes [[2026-11-01#^e-a00001]].\n- Second proof, idea I-11 dispatched [[2026-11-01#^e-b00001]].\n`;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-e12s15-report-"));
    for (const [path, content] of [["Log/2026-11-01.md", LOG], ["Notes/Garden.md", UNDER]] as const) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("lists a report line there, keeps the dated rollup line and the person's own line", async () => {
    const plan = await planReportLines(dir);
    expect(plan.lines.map(line => line.line)).toEqual([13, 20]);
    expect(plan.lines[1]!.text).toBe("- Second proof, idea I-11 dispatched [[2026-11-01#^e-b00001]].");
    await moveReportLines(dir, plan, "2026-11-08");
    const page = await readFile(join(dir, "Notes/Garden.md"), "utf8");
    expect(page).toContain("## Ops rollup\n\n- 2026-11-01 ops (1): [[2026-11-01#^e-b00001]]");
    expect(page).toContain("- Garden plan: rows two and three get the tomatoes");
    expect(page).not.toContain("idea I-11");
  });
});
