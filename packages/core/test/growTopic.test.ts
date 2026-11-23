import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseTreeNode, isOneOff, TrackedWrites, writeProvisionalLeaf } from "../src/engine/treePlacement.js";
import { buildTreeIndex } from "../src/vault/tree.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * E22-S5 (Jordi vn_8e8b0693, 23 Nov: "growing vertically or spreading horizontally?"): the filer
 * grows the nearest topic before it makes a new leaf. Made-up notes, the same shapes his week had:
 * a housing note under a housing topic, a "The user says …" note that a stray one-note root caught,
 * a one-off acknowledgement, and a note with no topic in reach.
 */
const NODES: SeedNode[] = [
  { name: "Housing", kind: "working", path: "Areas/Housing.md", summary: "Where to live and which house to buy: cities, flats, visits." },
  { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden: seeds, beds and watering." },
  { name: "data environment", kind: "long-term", path: "Notes/The user says there is one data environment.md", summary: "The user says there is one data environment with two frontends." },
];

async function vault(dir: string): Promise<void> {
  for (const file of seedTreeFiles(NODES, "2026-11-01")) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.content);
  }
}

const input = (content: string, anchor: string, title?: string) =>
  ({ content, evidenceRef: `Log/2026-11-23.md#^${anchor}`, reason: "nothing fitted", today: "2026-11-24", ...(title ? { title } : {}) });

describe("E22-S5 the filer grows the nearest topic", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e22s5-")); await vault(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("appends a dated section to the topic within reach instead of a new leaf", async () => {
    const before = await readdir(join(dir, "Notes"));
    const writes = new TrackedWrites(dir);
    const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir),
      input("The flat in Frankfurt near the park is a strong option for the house we want to buy.", "e-aaaaa1"), writes);
    expect(out).toMatchObject({ path: "Areas/Housing.md", grown: true });
    const raw = await readFile(join(dir, "Areas/Housing.md"), "utf8");
    expect(raw).toMatch(/^## 2026-11-23 · The flat in Frankfurt .* \[\[2026-11-23#\^e-aaaaa1\]\]$/m);
    expect(raw).toContain("> The flat in Frankfurt near the park");
    expect(raw).toMatch(/^updated: 2026-11-24$/m);
    expect(await readdir(join(dir, "Notes"))).toEqual(before);
  });

  it("puts a second point of the same note into the same section, never one file per sentence", async () => {
    let index = await buildTreeIndex(dir);
    await writeProvisionalLeaf(dir, index, input("Visit the house in Zurich on Friday, the flat has a garden view.", "e-aaaaa2"));
    index = await buildTreeIndex(dir);
    await writeProvisionalLeaf(dir, index, input("And ask about the house deposit too.", "e-aaaaa2"));
    const raw = await readFile(join(dir, "Areas/Housing.md"), "utf8");
    expect(raw.match(/^## .*\[\[2026-11-23#\^e-aaaaa2\]\]$/gm)).toHaveLength(1);
    expect(raw).toContain("> And ask about the house deposit too.");
  });

  it("never hangs a note on a root that is one note, and 'The user says' names no topic", async () => {
    const index = await buildTreeIndex(dir);
    const choice = await chooseTreeNode(dir, index, "The user says the inbox cards should show their age.");
    expect(choice?.path).not.toBe("Notes/The user says there is one data environment.md");
  });

  it("makes a provisional leaf only when no topic is within reach", async () => {
    const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir),
      input("Quantum orchestra tuning forks resonate oddly.", "e-aaaaa3"));
    expect(out?.grown).toBeUndefined();
    expect(out?.path).toMatch(/^Notes\//);
  });

  it("reads a one-off as Log only, and a real short point as a note", () => {
    expect(isOneOff("And the reply now done.")).toBe(true);
    expect(isOneOff("Amen, it was painful to get here.")).toBe(true);
    expect(isOneOff("Remember the thing about the passport renewal.")).toBe(false);
    expect(isOneOff("The flat in Frankfurt near the park is a strong option for the house we want to buy.")).toBe(false);
  });
});
