import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeFocusedPage } from "../src/engine/meaningNotes.js";
import { moveRollupLines, planReportLines, planRollupLines } from "../src/engine/reportLines.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";
import { outsideOpsRollup } from "../src/vault/captureOrigin.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import type { BrainLlm, ComposePageInput } from "../src/llm/types.js";

/** E12-S29: the person's own lines never sit under an `## Ops rollup` heading. */
const ROLLUP = "## Ops rollup\n\nAgent ops reports (Watcher reads, console decisions), one line per day; the evidence stays in the Log.\n\n- 2026-11-01 ops (1): [[2026-11-01#^e-b00001]]\n";

describe("E12-S29 additions land above the Ops rollup", () => {
  it("puts an addition above a rollup section that ends the page, and keeps the section unchanged", () => {
    const page = `# Garden\n\n- Old line.\n\n${ROLLUP}`;
    const next = outsideOpsRollup(page, head => `${head}\n- New line.\n`);
    expect(next).toBe(`# Garden\n\n- Old line.\n\n- New line.\n\n${ROLLUP}`);
  });

  it("appends as before when there is no rollup, or another section follows it", () => {
    expect(outsideOpsRollup("# Garden\n", head => `${head}- New.\n`)).toBe("# Garden\n- New.\n");
    const later = `# Garden\n\n${ROLLUP}\n## Notes\n\n- Kept.\n`;
    expect(outsideOpsRollup(later, head => `${head}- New.\n`)).toBe(`${later}- New.\n`);
  });

  it("files a new section of a page above its rollup, never under it", async () => {
    const fm = { title: "Garden", type: "area", tags: [], created: "2026-10-01", updated: "2026-10-01", summary: "The garden." };
    const citation = "[[2026-11-02#^e-a00002]]";
    const current = serializeNote(fm, `# Garden\n\n- Old line.\n\n${ROLLUP}`);
    const input: ComposePageInput = { currentContent: current, path: "Areas/Garden.md", template: "", evidenceEntry: "Plant the beans in May.", citation,
      classification: { confidence: 1, tags: [], summary: "Beans", pages: [{ path: "Areas/Garden.md", title: "Garden", action: "update" }] }, tagVocabulary: [], today: "2026-11-02", requiredType: "area", linkHints: [] };
    const llm = { composePage: async () => serializeNote(fm, `## Beans\n\nPlant the beans in May ${citation}.\n`) } as unknown as BrainLlm;
    const body = parseNote(await composeFocusedPage(llm, input)).body;
    expect(body.indexOf("Plant the beans")).toBeLessThan(body.indexOf("## Ops rollup"));
    expect(body.endsWith(ROLLUP)).toBe(true);
  });
});

const LOG = [
  "# 2026-11-01", "",
  "## 09:00 Voice note about the garden  ^e-a00001", "- source: whatsapp", "", "> Tomato beds need compost before planting.", "",
  "## 17:04 agent_team E46-S9 report  ^e-b00001", "- source: mcp", "", "> agent_team E46-S9 report: first proof, the note was placed as idea I-10; dispatched and merged.", "",
].join("\n");
const HEAD = ["---", "title: Garden", "type: note", "tags: []", "created: 2026-10-01", "updated: 2026-11-01", "summary: The garden.", "---", "", "# Garden", "", "- Old line [[2026-11-01#^e-a00001]].", ""].join("\n");
// Topic filing appended these after the rollup section, so they sit under its heading.
const PAGE = `${HEAD}\n${ROLLUP}\n- Tomato beds need compost [[2026-11-01#^e-a00001]].\n[[Notes/Soil|Soil]]\n- Second proof, idea I-11 dispatched [[2026-11-01#^e-b00001]].\n- 2026-11-02 ops (1): [[2026-11-01#^e-b00001]]\n`;

describe("E12-S29 the person's lines under a rollup heading", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-e12s29-"));
    for (const [path, content] of [["Log/2026-11-01.md", LOG], ["Notes/Garden.md", PAGE]] as const) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("lists his lines, not the intro, the rollup lines or an agent report line, and writes nothing", async () => {
    expect(await planRollupLines(dir)).toEqual([{ page: "Notes/Garden.md", lines: [
      { line: 20, text: "- Tomato beds need compost [[2026-11-01#^e-a00001]]." },
      { line: 21, text: "[[Notes/Soil|Soil]]" },
    ] }]);
    expect(await readFile(join(dir, "Notes/Garden.md"), "utf8")).toBe(PAGE);
  });

  it("moves them above the heading, text and order unchanged, rollup lines in place, and can be reverted", async () => {
    const writes = new TrackedWrites(dir);
    expect(await moveRollupLines(dir, await planRollupLines(dir), writes)).toEqual(["Notes/Garden.md"]);
    const page = await readFile(join(dir, "Notes/Garden.md"), "utf8");
    expect(page).toBe(`${HEAD}\n- Tomato beds need compost [[2026-11-01#^e-a00001]].\n[[Notes/Soil|Soil]]\n\n${ROLLUP}\n- Second proof, idea I-11 dispatched [[2026-11-01#^e-b00001]].\n- 2026-11-02 ops (1): [[2026-11-01#^e-b00001]]\n`);
    expect(await planRollupLines(dir)).toEqual([]);
    // The agent report line stays for the report-line move.
    expect((await planReportLines(dir)).lines.map(line => line.text)).toEqual(["- Second proof, idea I-11 dispatched [[2026-11-01#^e-b00001]]."]);
    await writes.revert();
    expect(await readFile(join(dir, "Notes/Garden.md"), "utf8")).toBe(PAGE);
  });
});
