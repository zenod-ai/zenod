import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryIndex } from "../src/vault/memoryIndex.js";
import { backfillPrivateFlags, flagPrivatePage, privateKindOf, withPrivateFlag } from "../src/vault/privacy.js";

// E15-S2: private notes are flagged when Zenod files them, from what they say and where they sit.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const QUOTES = "Projects/Boat repair/2023 Porto quotes.md";

const dirs: string[] = [];
const open: Array<{ close(): void }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) item.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function vaultWith(files: Record<string, string>, base?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-privacy-"));
  dirs.push(dir);
  const vault = join(dir, "vault");
  if (base) await cp(base, vault, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }
  return vault;
}

const page = (title: string, body: string, extra = "") =>
  `---\ntitle: ${title}\ntype: note\ntags: []\ncreated: 2026-11-09\nupdated: 2026-11-09\nsummary: ${title}.\n${extra}---\n\n# ${title}\n\n${body}\n`;

describe("private notes flagged at filing (E15-S2)", () => {
  it("reads the kind from the note's own words, not from a passing mention or a business word", () => {
    expect(privateKindOf("Talked to my father and my sister about the inheritance; my mother agrees.")).toBe("family");
    expect(privateKindOf("The surgeon at the clinic set the transplant for March; the doctor wants a check first.")).toBe("health");
    expect(privateKindOf("Keep the mortgage small; my salary covers it and the savings stay untouched.")).toBe("money");
    expect(privateKindOf("Mi madre y mi padre hablaron con mi hermana de la herencia.")).toBe("family");
    // One mention in a long work note does not make it private.
    expect(privateKindOf(`Roadmap for the launch. ${"We ship the app and talk to customers. ".repeat(20)} My father liked it.`)).toBeNull();
    // A company's tax and accounting is business, not the person's money.
    expect(privateKindOf("Alpha9 tax filing: the accountant sends the AEAT invoice, VAT and tax registration for the offices.")).toBeNull();
  });

  it("adds one frontmatter line and nothing else; never twice, never over the person's own choice", () => {
    const raw = page("Family visit", "My father, my mother and my brother came for the weekend.");
    const flagged = withPrivateFlag("Notes/Family visit.md", raw);
    expect(flagged).toBe(raw.replace("summary: Family visit.\n", "summary: Family visit.\nprivate: family\n"));
    expect(withPrivateFlag("Notes/Family visit.md", flagged)).toBe(flagged);
    const optedOut = page("Family visit", "My father, my mother and my brother came.", "private: false\n");
    expect(withPrivateFlag("Notes/Family visit.md", optedOut)).toBe(optedOut);
    // Only meaning pages: the Log and other files are never touched.
    expect(withPrivateFlag("Log/2026-11-09.md", raw)).toBe(raw);
  });

  it("flags a short note by its place: under a private page", async () => {
    const vault = await vaultWith({ "Areas/Family.md": page("Family", "Notes about my father, my mother and my sister.", "private: family\n") });
    const leaf = page("Call", "He called again; I said I need time.", 'parent: "[[Areas/Family]]"\n');
    expect(await flagPrivatePage(vault, "Notes/Call.md", leaf)).toContain("private: family\n");
    const elsewhere = page("Call", "He called again; I said I need time.", 'parent: "[[Areas/Work]]"\n');
    expect(await flagPrivatePage(vault, "Notes/Call.md", elsewhere)).toBe(elsewhere);
  });

  it("back-fills existing pages parents first, changing only the frontmatter", async () => {
    const family = page("Family", "My father and my mother, my sister and my brother.");
    const leaf = page("Call", "He called again.", 'parent: "[[Areas/Family]]"\n');
    const work = page("Tax", "Company tax filing with the accountant and the AEAT invoice.");
    const vault = await vaultWith({ "Areas/Family.md": family, "Notes/Call.md": leaf, "Areas/Tax.md": work });
    const expected = [{ path: "Areas/Family.md", kind: "family" }, { path: "Notes/Call.md", kind: "family" }];
    expect(await backfillPrivateFlags(vault)).toEqual(expected);
    expect(await readFile(join(vault, "Notes/Call.md"), "utf8")).toBe(leaf); // a dry run writes nothing
    expect(await backfillPrivateFlags(vault, { write: true })).toEqual(expected);
    expect(await readFile(join(vault, "Notes/Call.md"), "utf8")).toBe(leaf.replace('parent: "[[Areas/Family]]"\n', 'parent: "[[Areas/Family]]"\nprivate: family\n'));
    expect(await readFile(join(vault, "Areas/Tax.md"), "utf8")).toBe(work);
    expect(await backfillPrivateFlags(vault)).toEqual([]);
  });
});

describe("retrieval reads the flag (E15-S2)", { timeout: 20_000 }, () => {
  it("marks a private page and the Log entry it cites; others stay unmarked", async () => {
    const vault = await vaultWith({}, TREE_FIXTURE);
    const raw = await readFile(join(vault, QUOTES), "utf8");
    await writeFile(join(vault, QUOTES), raw.replace("memory: working\n", "memory: working\nprivate: money\n"));
    const index = MemoryIndex.open({ path: join(dirname(vault), "index.sqlite"), vaultPath: vault, tenantId: "t" });
    open.push(index);
    const hits = await index.search("Porto quotes");
    expect(hits.find((hit) => hit.path === QUOTES)).toMatchObject({ private: "money" });
    expect(hits.find((hit) => hit.path === "Log/2026-10-31.md#^e-c64e3b")).toMatchObject({ private: "money" });
    expect(hits.filter((hit) => hit.private).map((hit) => hit.path).sort()).toEqual(["Log/2026-10-31.md#^e-c64e3b", QUOTES].sort());
  });
});
