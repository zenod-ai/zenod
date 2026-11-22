import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFile as readText } from "node:fs/promises";
import { parseNote } from "../src/vault/frontmatter.js";
import { CITATION_RE } from "../src/vault/pages.js";
import { readLogCaptures, withoutOpsRollup } from "../src/vault/captureOrigin.js";
import { buildTreeIndex, MAX_TREE_DEPTH, type MemoryKind } from "../src/vault/tree.js";
import { pageCaptureDate } from "../src/vault/treeOutline.js";
import { basenameOf } from "../src/vault/files.js";
import {
  forgetQuickIndexCaches, oneLine, quickIndexBase, quickIndexBaseCached, sayableAlias, QUICK_INDEX_WEEK_DAYS,
  type QuickIndexBase, type QuickIndexPhases, type QuickIndexPlace,
} from "../src/vault/quickIndex.js";

// EPIC-24 M34 round 4: the quick-index base is kept per file and on disk, so a save re-reads only what it touched and a
// restart re-reads nothing unchanged, with exactly the results of a full build.
const NOW = Date.parse("2026-11-09T12:00:00Z");

const FILES: Record<string, string> = {
  "Tree.md": `---\ntitle: Tree\n---\n# Memory tree\n\n## Working memory\n\n- Moving to Valencia | working | [[Projects/Moving to Valencia]] | Looking for a one-year rental. ^n-1a2b3c4d\n\n## Long-term memory\n\n- Family | long-term | [[Areas/Family]] | The people closest to you.\n- Work | long-term | [[Areas/Work]] | Jobs.\n`,
  "Projects/Moving to Valencia.md": `---\ntitle: Moving to Valencia\nparent: "[[Tree]]"\nmemory: working\naliases:\n  - The move\n  - Moving to Valencia\n  - Voice note AC2334D9F38222011F8FFB0DB80CC414.ogg ingested thr\n---\nVisit [[2026-11-08#^e-aaaaaa]] and [[2026-10-01#^e-bbbbbb]].\n\n## Ops rollup\n\n- [[2026-11-08#^e-cccccc]]\n`,
  "Notes/Ruzafa flats.md": `---\ntitle: Ruzafa flats\nparent: "[[Moving to Valencia]]"\nsummary: Two flats seen in Ruzafa. The second one has a balcony.\n---\nSeen [[2026-11-08#^e-aaaaaa]] [[2026-11-07#^e-dddddd]] [[2026-11-07#^e-eeeeee]].\n`,
  "Notes/Bot only.md": `---\ntitle: Bot only\nparent: "[[Moving to Valencia]]"\nupdated: 2026-08-02\n---\nOnly a report [[2026-11-07#^e-eeeeee]].\n`,
  "Notes/Dated.md": `---\ntitle: Dated\nparent: "[[Areas/Family]]"\ncreated: 2026-07-04\n---\nNothing cited.\n`,
  "Areas/Family.md": `---\ntitle: Family\nparent: "[[Tree]]"\nmemory: long-term\nupdated: 2026-09-01\n---\nNo citations yet.\n`,
  "Areas/Work.md": `---\ntitle: Work\nparent: "[[Tree]]"\nmemory: long-term\n---\nA [[2026-11-06#^e-ffffff]] and a duplicate [[2026-11-06#^e-ffffff]].\n`,
  "Notes/Loose.md": `---\ntitle: Loose\nparent: 12\n---\nNot in the tree [[2026-11-08#^e-aaaaaa]].\n`,
  "Log/2026-11-08.md": `# 2026-11-08\n\n## 09:00 Flat visit ^e-aaaaaa\n- source: whatsapp\n\n> We saw the flat in Ruzafa again,\n> the flat is perfect.\n\n## 10:00 Ops report ^e-cccccc\n- source: selftest\n\n> agent run done\n`,
  "Log/2026-11-07.md": `# 2026-11-07\n\n## 09:00 Second flat ^e-dddddd\n- source: web\n\n> Second flat, smaller.\n\n## 11:00 Bot ^e-eeeeee\n- source: selftest\n\n> selftest capture\n`,
  "Log/2026-11-06.md": `# 2026-11-06\n\n## 08:00 Job ^e-ffffff\n- source: telegram\n\n> ${"A long note about the job. ".repeat(40)}\n`,
  "Log/2026-10-01.md": `# 2026-10-01\n\n## 09:00 Idea ^e-bbbbbb\n- source: telegram\n\n> Maybe Valencia next year.\n`,
};

const dirs: string[] = [];
afterEach(async () => {
  forgetQuickIndexCaches();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-quick-memo-"));
  dirs.push(dir);
  return dir;
}

async function settle(dir: string, path: string): Promise<void> {
  const old = new Date(Date.now() - 60_000);
  await utimes(join(dir, path), old, old);
}

async function put(dir: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), content);
  await settle(dir, path);
}

async function vault(files: Record<string, string>): Promise<string> {
  const dir = await scratch();
  for (const [path, content] of Object.entries(files)) await put(dir, path, content);
  return dir;
}

/** The base as it was built before the memo: the tree index, the Log, and a read of every page. Never changed. */
async function referenceBase(vaultPath: string, now: number): Promise<QuickIndexBase | null> {
  const frontmatterString = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const frontmatterList = (v: unknown) => {
    const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    return [...new Set(list.filter((i): i is string => typeof i === "string").map((i) => i.replace(/\s+/g, " ").trim()).filter(Boolean))];
  };
  const index = await buildTreeIndex(vaultPath);
  if (!index.tree) return null;
  const weekFrom = new Date(now - (QUICK_INDEX_WEEK_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const captures = await readLogCaptures(vaultPath);
  const isAgentCapture = (key: string) => captures.get(key)?.origin === "agent";
  const pages = new Map<string, { summary: string; aliases: string[]; keys: string[]; lastTouched: string | null }>();
  await Promise.all([...index.fields.keys()].map(async (path) => {
    const raw = await readText(join(vaultPath, path), "utf8").catch(() => "");
    const { frontmatter, body } = parseNote(raw);
    const keys = new Set<string>();
    for (const match of withoutOpsRollup(body).matchAll(CITATION_RE)) {
      const key = `${match[1]}#^${match[2]}`;
      if (!isAgentCapture(key)) keys.add(key);
    }
    pages.set(path, { summary: frontmatterString(frontmatter?.summary), aliases: frontmatterList(frontmatter?.aliases), keys: [...keys].sort().reverse(), lastTouched: pageCaptureDate(raw, isAgentCapture) });
  }));
  const places: QuickIndexPlace[] = [];
  const seen = new Set<string>();
  const visit = (path: string, memory: MemoryKind, lineage: string[], root: { name: string; summary: string } | null): number => {
    if (seen.has(path) || lineage.length >= MAX_TREE_DEPTH) return 0;
    seen.add(path);
    const page = pages.get(path);
    const fields = index.fields.get(path);
    const title = root?.name ?? fields?.title ?? basenameOf(path);
    const names = [...lineage, title];
    const place: QuickIndexPlace = {
      path, title, memory, lineage: names, root: root !== null,
      summary: oneLine(page?.summary || root?.summary || ""),
      aliases: (page?.aliases ?? []).filter((alias) => alias.toLowerCase() !== title.toLowerCase() && sayableAlias(alias)),
      pages: page ? 1 : 0,
      memories: page?.keys.length ?? 0,
      week: (page?.keys ?? []).filter((key) => key.slice(0, 10) >= weekFrom).length,
      lastTouched: page?.lastTouched ?? null,
      captureKeys: page?.keys ?? [],
      captures: (page?.keys ?? []).flatMap((key) => {
        const capture = captures.get(key);
        const text = capture ? `${capture.title}\n${capture.content}`.replace(/\s+/g, " ").trim().slice(0, 600) : "";
        return text ? [{ key, date: key.slice(0, 10), text }] : [];
      }).slice(0, 3),
    };
    places.push(place);
    for (const child of index.children(path)) place.pages += visit(child, memory, names, null);
    return place.pages;
  };
  for (const node of index.tree.nodes) visit(index.resolveRef(node.path) ?? node.path, node.kind, [], { name: node.name, summary: node.summary });
  return { places, weekFrom };
}

describe("quick index per-file memo (EPIC-24 M34 round 4)", () => {
  it("builds exactly what the full read built, cold and from a saved memo", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    const want = await referenceBase(dir, NOW);
    expect(want!.places.length).toBeGreaterThan(5);
    expect(await quickIndexBase(dir, NOW)).toEqual(want);
    const cold: QuickIndexPhases = {};
    expect(await quickIndexBaseCached(dir, NOW, cold, { memoPath })).toEqual(want);
    expect(cold).toMatchObject({ parsedFiles: 11, reusedFiles: 0 });
    // A restart: nothing kept in this process, the memo is read from disk and nothing is parsed.
    forgetQuickIndexCaches();
    const warm: QuickIndexPhases = {};
    expect(await quickIndexBaseCached(dir, NOW, warm, { memoPath })).toEqual(want);
    expect(warm).toMatchObject({ parsedFiles: 0, reusedFiles: 11, rebuilt: true });
  });

  it("re-reads only the files a save changed, and still equals a full build", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    // A filing: one page cites a new entry, one Log day gains it (and its agent-ness changes another page's count).
    await put(dir, "Areas/Family.md", `---\ntitle: Family\nparent: "[[Tree]]"\nmemory: long-term\nupdated: 2026-09-01\n---\nNow [[2026-11-09#^e-999999]] and [[2026-11-07#^e-eeeeee]].\n`);
    await put(dir, "Log/2026-11-09.md", `# 2026-11-09\n\n## 08:00 New ^e-999999\n- source: whatsapp\n\n> A new thing.\n`);
    const phases: QuickIndexPhases = {};
    const got = await quickIndexBaseCached(dir, NOW, phases, { memoPath });
    expect(phases).toMatchObject({ parsedFiles: 2, reusedFiles: 10, rebuilt: true });
    expect(got).toEqual(await referenceBase(dir, NOW));
    expect(got!.places.find((p) => p.path === "Areas/Family.md")).toMatchObject({ memories: 1, lastTouched: "2026-11-09" });
    // An agent capture turning into a person's capture changes a page that did not change itself.
    await put(dir, "Log/2026-11-07.md", FILES["Log/2026-11-07.md"]!.replace("source: selftest", "source: whatsapp"));
    const again: QuickIndexPhases = {};
    const after = await quickIndexBaseCached(dir, NOW, again, { memoPath });
    expect(again.parsedFiles).toBe(1);
    expect(after).toEqual(await referenceBase(dir, NOW));
    expect(after!.places.find((p) => p.path === "Notes/Bot only.md")!.memories).toBe(1);
  });

  it("drops a deleted file and finds a new tree page, and survives a restart in between", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    await rm(join(dir, "Notes/Ruzafa flats.md"));
    await put(dir, "Notes/New.md", `---\ntitle: New\nparent: "[[Areas/Work]]"\naliases: [Fresh]\n---\nHi [[2026-11-06#^e-ffffff]].\n`);
    forgetQuickIndexCaches();
    const phases: QuickIndexPhases = {};
    const got = await quickIndexBaseCached(dir, NOW, phases, { memoPath });
    expect(phases.parsedFiles).toBe(1);
    expect(got).toEqual(await referenceBase(dir, NOW));
    expect(got!.places.map((p) => p.path)).not.toContain("Notes/Ruzafa flats.md");
    expect(got!.places.map((p) => p.path)).toContain("Notes/New.md");
  });

  it("a week change re-counts from the memo without reading a file", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    const phases: QuickIndexPhases = {};
    const later = NOW + 4 * 86_400_000;
    const got = await quickIndexBaseCached(dir, later, phases, { memoPath });
    expect(phases).toMatchObject({ parsedFiles: 0, rebuilt: true });
    expect(got).toEqual(await referenceBase(dir, later));
  });

  it("never keeps a file written in the last 100 ms", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    await writeFile(join(dir, "Areas/Work.md"), `---\ntitle: Work\nparent: "[[Tree]]"\nmemory: long-term\n---\nJust now [[2026-11-06#^e-ffffff]].\n`);
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    forgetQuickIndexCaches();
    const phases: QuickIndexPhases = {};
    await quickIndexBaseCached(dir, NOW, phases, { memoPath });
    expect(phases.parsedFiles).toBe(1);
  });

  it("starts empty from a missing, unreadable, other-version or other-vault memo, and rebuilds the same base", async () => {
    const dir = await vault(FILES);
    const other = await vault(FILES);
    const home = await scratch();
    const memoPath = join(home, "quick-index-base.json");
    const want = await referenceBase(dir, NOW);
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    const good = await readFile(memoPath, "utf8");
    for (const body of ["not json", "{}", JSON.stringify({ ...JSON.parse(good), version: 999 }), JSON.stringify({ ...JSON.parse(good), chars: 1 }), JSON.stringify({ ...JSON.parse(good), vault: "/elsewhere" })]) {
      await writeFile(memoPath, body);
      forgetQuickIndexCaches();
      const phases: QuickIndexPhases = {};
      expect(await quickIndexBaseCached(dir, NOW, phases, { memoPath })).toEqual(want);
      expect(phases).toMatchObject({ parsedFiles: 11, reusedFiles: 0 });
    }
    // The memo of one vault is not read for another.
    forgetQuickIndexCaches();
    const phases: QuickIndexPhases = {};
    expect(await quickIndexBaseCached(other, NOW, phases, { memoPath })).toEqual(await referenceBase(other, NOW));
    expect(phases.parsedFiles).toBe(11);
  });

  it("a memo that cannot be written changes nothing", async () => {
    const dir = await vault(FILES);
    const blocker = join(await scratch(), "file");
    await writeFile(blocker, "x");
    const got = await quickIndexBaseCached(dir, NOW, {}, { memoPath: join(blocker, "inside", "quick-index-base.json") });
    expect(got).toEqual(await referenceBase(dir, NOW));
  });

  it("keeps the memo small: no page text, no Log text beyond the nickname excerpt", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    const body = await readFile(memoPath, "utf8");
    expect(body).not.toContain("Visit ");
    expect(body).not.toContain("No citations yet");
    expect(JSON.parse(body).logs.find(([path]: [string]) => path === "Log/2026-11-06.md")[1].captures[0].text.length).toBeLessThanOrEqual(600);
  });

  // The memo stores what each file contributes; changing that without bumping MEMO_VERSION would serve old results
  // after a deploy. If this fails, bump MEMO_VERSION in quickIndex.ts and update the expected text here.
  it("pins what a page and a Log day contribute (bump MEMO_VERSION when this changes)", async () => {
    const dir = await vault(FILES);
    const memoPath = join(await scratch(), "quick-index-base.json");
    await quickIndexBaseCached(dir, NOW, {}, { memoPath });
    const saved = JSON.parse(await readFile(memoPath, "utf8"));
    const strip = (entries: Array<[string, { stamp: unknown }]>) => entries.map(([path, entry]) => [path, { ...entry, stamp: undefined }]);
    expect({ version: saved.version, pages: strip(saved.pages).slice(0, 2), logs: strip(saved.logs).slice(0, 1), sorted: saved.logs.map(([path]: [string]) => path) }).toEqual({
      sorted: ["Log/2026-10-01.md", "Log/2026-11-06.md", "Log/2026-11-07.md", "Log/2026-11-08.md"],
      version: 1,
      pages: [
        ["Areas/Family.md", { fields: { parent: "[[Tree]]", memory: "long-term", title: "Family" }, summary: "", aliases: [], keys: [], date: "2026-09-01" }],
        ["Areas/Work.md", { fields: { parent: "[[Tree]]", memory: "long-term", title: "Work" }, summary: "", aliases: [], keys: ["2026-11-06#^e-ffffff"], date: null }],
      ],
      logs: [["Log/2026-10-01.md", { captures: [{ key: "2026-10-01#^e-bbbbbb", agent: false, text: "Idea Maybe Valencia next year." }] }]],
    });
  });
});
