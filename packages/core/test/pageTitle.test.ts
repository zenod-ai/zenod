import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAGE_TITLE_MAX_BYTES, PAGE_TITLE_MAX_CHARS, pageTitle, writeProvisionalLeaf } from "../src/engine/treePlacement.js";
import { buildTreeIndex } from "../src/vault/tree.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { seedTreeFiles } from "../src/vault/treeSeed.js";

/** E14-S42: a new page keeps its whole name; it is never cut at eight words or 60 letters. */
const fits = (title: string) => Array.from(title).length <= PAGE_TITLE_MAX_CHARS && Buffer.byteLength(title, "utf8") <= PAGE_TITLE_MAX_BYTES;

describe("pageTitle", () => {
  it("keeps a long topic whole (the name the old filer cut to 'Jordi asked whether the assistant can see a')", () => {
    const topic = "Jordi asked whether the assistant can see a session running in the Zenod repo";
    expect(pageTitle(topic)).toBe(topic);
  });

  it("keeps a title of exactly the limit whole, and one letter over is shortened between words", () => {
    const at = `${"word ".repeat(23)}abcd`; // 23 * 5 + 4 = 119
    const exact = `${at}e`;
    expect(Array.from(exact).length).toBe(PAGE_TITLE_MAX_CHARS);
    expect(pageTitle(exact)).toBe(exact);
    const over = `${exact}f`;
    expect(pageTitle(over)).toBe("word ".repeat(23).trim());
  });

  it("never cuts mid-word and drops a dangling small word", () => {
    const line = "Planning the long garden project with raised beds along the fence and a greenhouse for the winter tomatoes and the peppers grown from seed";
    const title = pageTitle(line);
    expect(fits(title)).toBe(true);
    expect(line.startsWith(title)).toBe(true);
    expect(line.charAt(title.length)).toBe(" ");
    expect(title.split(" ").at(-1)).not.toMatch(/^(a|the|and|for|from)$/i);
  });

  it("prefers the end of a clause when a long line has one", () => {
    const line = "The roof over the workshop leaks again after every storm this autumn, so the carpenter should come before the winter rains start and the tools rust";
    expect(pageTitle(line)).toBe("The roof over the workshop leaks again after every storm this autumn");
  });

  it("keeps unicode whole and within the file-name bytes", () => {
    expect(pageTitle("Ideas para la cañería — José y Zoë, año 2026")).toBe("Ideas para la cañería — José y Zoë, año 2026");
    const cjk = "記憶の整理 ".repeat(40).trim();
    const title = pageTitle(cjk);
    expect(fits(title)).toBe(true);
    expect(cjk.startsWith(title)).toBe(true);
    expect(title.endsWith("記憶の整理")).toBe(true);
    const emoji = "🌱".repeat(130);
    const sprout = pageTitle(emoji);
    expect(fits(sprout)).toBe(true);
    expect(Array.from(sprout).every(ch => ch === "🌱")).toBe(true);
  });

  it("keeps the old safety: first line only, no path or link characters, a fallback name", () => {
    expect(pageTitle("Boat: repair/quote [Vigo]?\nsecond line")).toBe("Boat repair quote Vigo");
    expect(pageTitle("  \n")).toBe("Unsorted capture");
  });
});

describe("writeProvisionalLeaf names the new page with its whole title", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "page-title-"));
    for (const file of [
      { path: ".brain/config.yml", content: "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n" },
      { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n" },
      ...seedTreeFiles([{ name: "Zenod", kind: "working", path: "Projects/Zenod.md", summary: "Building Zenod, the memory assistant." }], "2026-11-01"),
    ]) {
      await mkdir(dirname(join(dir, file.path)), { recursive: true });
      await writeFile(join(dir, file.path), file.content);
    }
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("files 'Jordi asked whether the assistant can see a session running in the Zenod repo' under that whole name", async () => {
    const title = "Jordi asked whether the assistant can see a session running in the Zenod repo";
    const index = await buildTreeIndex(dir);
    const leaf = await writeProvisionalLeaf(dir, index, {
      title, content: "Can you see a session that we have right now going on on the Zenod repo?",
      evidenceRef: "Log/2026-11-11.md#^e-270106", reason: "nothing fitted", today: "2026-11-11",
    }, undefined, { fallback: { path: "Projects/Zenod.md", score: 1, weak: false } });
    expect(leaf?.path).toBe(`Notes/${title}.md`);
    const raw = await readFile(join(dir, leaf!.path), "utf8");
    expect(parseNote(raw).frontmatter?.title).toBe(title);
    expect(raw).toContain(`# ${title}\n`);
  });
});
