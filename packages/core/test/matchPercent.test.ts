import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { idfOf, matchPercent, monotonic, withMatchPercent } from "../src/vault/matchPercent.js";
import { buildMatchTerms, MemoryIndex } from "../src/vault/memoryIndex.js";

// EPIC-12 E12-S3a: ranked retrieval carries a match percentage people can read.
describe("match percentage (E12-S3a)", () => {
  it("blends rarity-weighted coverage and strength vs the best hit, 1..100", () => {
    expect(matchPercent({ score: 10, topScore: 10, coverage: 1 })).toBe(100);
    expect(matchPercent({ score: 5, topScore: 10, coverage: 0.5 })).toBe(50);
    expect(matchPercent({ score: 10, topScore: 10, coverage: 0.5 })).toBe(75);
    expect(matchPercent({ score: 2, topScore: 8 })).toBe(25); // no coverage: strength alone
    expect(matchPercent({ score: 0, topScore: 10, coverage: 0 })).toBe(1); // never 0
    expect(matchPercent({ score: 20, topScore: 10, coverage: 3 })).toBe(100); // clamped
    expect(matchPercent({ score: 1, topScore: 0 })).toBe(1);
    expect(matchPercent({ score: Number.NaN, topScore: 10, coverage: Number.NaN })).toBe(1);
  });

  it("weights rare words above common ones", () => {
    expect(idfOf(100, 1)).toBeGreaterThan(idfOf(100, 50));
    expect(idfOf(100, 100)).toBeGreaterThan(0);
  });

  it("keeps a ranked list monotonic and fills missing percentages only", () => {
    expect(monotonic([90, 95, 60, 70])).toEqual([90, 90, 60, 60]);
    expect(withMatchPercent([{ score: 8 }, { score: 4, matchPercent: 80 }, { score: 2 }]).map((hit) => hit.matchPercent)).toEqual([100, 80, 25]);
    expect(withMatchPercent([])).toEqual([]);
  });

  it("measures coverage over the question's own words, not alias phrases", () => {
    const built = buildMatchTerms("the Porto boat quotes", [["porto", "oporto"]]);
    expect(built.terms).toEqual(['"porto"*', '"boat"*', '"quote"*']);
    expect(built.match).toContain('"oporto"');
  });
});

describe("index search percentages and latency (E12-S3a)", { timeout: 60_000 }, () => {
  const dirs: string[] = [];
  const open: MemoryIndex[] = [];
  afterEach(async () => {
    for (const index of open.splice(0)) index.close();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function vaultOf(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), "zenod-match-"));
    dirs.push(dir);
    const vault = join(dir, "vault");
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(vault, path)), { recursive: true });
      await writeFile(join(vault, path), content);
    }
    const index = MemoryIndex.open({ path: join(dir, "idx.sqlite"), vaultPath: vault, tenantId: "t" });
    open.push(index);
    return index;
  }

  it("the best hit with every word reads 100 %, partial matches read less, in rank order", async () => {
    const index = await vaultOf({
      "Projects/Garden shed.md": "---\ntitle: Garden shed\n---\nThe garden shed roof leaks; quote from the carpenter.\n",
      "Projects/Garden.md": "---\ntitle: Garden\n---\nTomatoes and the garden hose.\n",
      "Areas/Roof.md": "---\ntitle: Roof\n---\nThe house roof was fixed in May.\n",
      "Areas/Taxes.md": "---\ntitle: Taxes\n---\nNothing about it.\n",
    });
    const hits = await index.search("garden shed roof", 5);
    expect(hits[0]).toMatchObject({ path: "Projects/Garden shed.md", matchPercent: 100 });
    expect(hits.length).toBe(3);
    for (const hit of hits) {
      expect(Number.isInteger(hit.matchPercent)).toBe(true);
      expect(hit.matchPercent).toBeGreaterThanOrEqual(1);
      expect(hit.matchPercent).toBeLessThan(hit === hits[0] ? 101 : 100);
    }
    expect(hits.map((hit) => hit.matchPercent)).toEqual([...hits.map((hit) => hit.matchPercent)].sort((a, b) => b - a));
  });

  it("answers the top 5 well under a second on a vault of about 1,500 rows", async () => {
    const words = ["garden", "boat", "insurance", "tax", "porto", "cabin", "school", "doctor", "flight", "invoice", "roof", "car"];
    const files: Record<string, string> = {};
    for (let i = 0; i < 1500; i++) {
      const a = words[i % words.length]!;
      const b = words[(i * 7 + 3) % words.length]!;
      files[`Notes/Note ${i}.md`] = `---\ntitle: ${a} ${b} ${i}\n---\n${`The ${a} and the ${b} were discussed on day ${i}. `.repeat(20)}\n`;
    }
    const index = await vaultOf(files);
    await index.rebuild();
    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const hits = await index.search(`${words[i % words.length]} ${words[(i + 5) % words.length]} quotes`, 5);
      timings.push(performance.now() - started);
      expect(hits).toHaveLength(5);
      expect(hits.every((hit) => hit.matchPercent >= 1 && hit.matchPercent <= 100)).toBe(true);
    }
    timings.sort((a, b) => a - b);
    // Server-side p95; the < 1 s budget is end to end, so the index keeps a wide margin.
    expect(timings[Math.floor(timings.length * 0.95) - 1]!).toBeLessThan(250);
  });
});
