import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { appendFiledLines, chooseTreeNode, isAgentOpsReport, parseFiledLines, planFromChanges } from "../src/engine/treePlacement.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import { lintVault } from "../src/vault/lint.js";
import { fileURLToPath } from "node:url";
import { buildTreeIndex } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { AUDIT_TREE_PROPOSAL, seedTreeFiles } from "../src/vault/treeSeed.js";
import type { StoreResult } from "../src/types.js";
import type { BrainLlm, Classification, ClassifyInput, ComposePageInput } from "../src/llm/types.js";

/**
 * EPIC-9 E9-2b: synthetic replay of 20 capture shapes taken from Jordi's Log
 * (anonymised): voice notes, text, links and agent ops reports across the hair,
 * house, Zenod and Epic Social topics plus long-term domains.
 */
interface Capture {
  key: string;
  content: string;
  contentType?: "voice_note" | "text" | "link";
  /** What the (fake) classifier answers for this capture. */
  pages: Array<{ path: string; action: "create" | "update"; title: string }>;
  confidence?: number;
  ops?: boolean;
  /** Root a placed page must end up under (tree vault). */
  root: string;
}

const CAPTURES: Capture[] = [
  { key: "hair-voice", contentType: "voice_note", root: "Hair transplant",
    content: "Voice note: called the clinic in Istanbul, FUE quote 2,800 euros all-in for 3,000 grafts; compare with the Barcelona quotes before deciding on the hair transplant.",
    pages: [{ path: "Notes/Hair transplant Istanbul quote.md", action: "create", title: "Hair transplant Istanbul quote" }] },
  { key: "hair-text", root: "Hair transplant",
    content: "Hair transplant: budget ceiling 4k, prefer spring timing so recovery fits before summer.",
    pages: [{ path: "Projects/Hair transplant.md", action: "update", title: "Hair transplant" }] },
  { key: "hair-link", contentType: "link", root: "Hair transplant",
    content: "https://example.com/fue-vs-dhi-guide FUE vs DHI comparison for the hair transplant decision",
    pages: [{ path: "Notes/FUE vs DHI guide.md", action: "create", title: "FUE vs DHI guide" }] },
  { key: "house-voice", contentType: "voice_note", root: "House decision",
    content: "Voice note: Cerdanya house visit, 1,100 m altitude, too cold in winter; Maresme stays first on the shortlist.",
    pages: [{ path: "Notes/Cerdanya house visit.md", action: "create", title: "Cerdanya house visit" }] },
  { key: "house-text", root: "House decision",
    content: "House decision: ask the lawyer about legal exposure on rural plots before any offer.",
    pages: [{ path: "Projects/House decision.md", action: "update", title: "House decision" }] },
  { key: "house-link", contentType: "link", root: "House decision",
    content: "https://www.idealista.com/inmueble/000000/ Maresme listing with sea view for the house shortlist",
    pages: [{ path: "Notes/Maresme listing.md", action: "create", title: "Maresme listing" }] },
  { key: "zenod-text", root: "Launching Zenod",
    content: "Zenod positioning: memory that files itself; lead the launch page with WhatsApp voice notes.",
    pages: [{ path: "Notes/Zenod positioning line.md", action: "create", title: "Zenod positioning line" }] },
  { key: "zenod-voice", contentType: "voice_note", root: "Launching Zenod",
    content: "Voice note: Zenod alpha launch needs three paying users before opening signup wider.",
    pages: [{ path: "Projects/Launching Zenod.md", action: "update", title: "Launching Zenod" }] },
  { key: "social-text", root: "Launching Epic Social",
    content: "Epic Social post idea: why every agent team needs a spine; draft it for Reddit and X.",
    pages: [{ path: "Notes/Post idea agent spine.md", action: "create", title: "Post idea agent spine" }] },
  { key: "social-voice", contentType: "voice_note", root: "Launching Epic Social",
    content: "Voice note: Epic Social testers, invite five builders from the Agent Team beta this week.",
    pages: [{ path: "Notes/Epic Social testers.md", action: "create", title: "Epic Social testers" }] },
  { key: "ops-watcher-1", ops: true, root: "Infrastructure and runbooks",
    content: "infra-vps EPIC-15 Watcher read: 3 hosts healthy, disk 71% on vps1, no action needed.",
    pages: [{ path: "Notes/Alpha9 VPS status.md", action: "create", title: "Alpha9 VPS status" }] },
  { key: "ops-console", ops: true, root: "Launching Epic Social",
    content: "agent_team console E6-S36 decision: merged #812 and deployed, health sha 1a2b3c4.",
    pages: [{ path: "Notes/Agent Team console log.md", action: "create", title: "Agent Team console log" }] },
  { key: "ops-wake", ops: true, root: "Launching Zenod",
    content: "zenod EPIC-9 wake run_85ebce2b: dispatched E9-2a and E9-3a, report written to the spine.",
    pages: [{ path: "Notes/Zenod wake log.md", action: "create", title: "Zenod wake log" }] },
  { key: "ops-watcher-2", ops: true, root: "Infrastructure and runbooks",
    content: "infra-vps EPIC-15 Watcher read: backup job green, 2 alerts cleared.",
    pages: [{ path: "Notes/Alpha9 VPS status.md", action: "update", title: "Alpha9 VPS status" }] },
  { key: "unsure", confidence: 0.3, root: "",
    content: "Remember the thing about the passport renewal.",
    pages: [] },
  { key: "uncertain", confidence: 0.5, root: "Life admin",
    content: "Travel insurance renews in March; check health cover abroad.",
    pages: [{ path: "Notes/Travel insurance.md", action: "update", title: "Travel insurance" }] },
  { key: "ventures", root: "Ventures and work",
    content: "Alpha9 tax: quarterly VAT filed with the gestoría, next one due in January.",
    pages: [{ path: "Notes/Alpha9 quarterly VAT.md", action: "create", title: "Alpha9 quarterly VAT" }] },
  { key: "runbook", root: "Infrastructure and runbooks",
    content: "Runbook: when the VPS fleet disk fills, prune docker images first, then old logs.",
    pages: [{ path: "Notes/VPS disk runbook.md", action: "create", title: "VPS disk runbook" }] },
  { key: "idea", root: "Ideas and knowledge",
    content: "Idea from markets research: prediction markets price attention, not truth.",
    pages: [{ path: "Notes/Prediction markets attention.md", action: "create", title: "Prediction markets attention" }] },
  { key: "family", contentType: "voice_note", root: "People and family",
    content: "Voice note: family dinner on Sunday, and mum's birthday is next month.",
    pages: [{ path: "Notes/Family dinner.md", action: "create", title: "Family dinner" }] },
];

/** Deterministic classifier/composer keyed by capture text; no tree knowledge (placement is the host's job). */
class ReplayLlm implements BrainLlm {
  async classify(input: ClassifyInput): Promise<Classification> {
    const capture = CAPTURES.find(c => input.content.includes(c.content.slice(0, 40)));
    if (!capture) throw new Error(`unknown capture: ${input.content.slice(0, 60)}`);
    const confidence = capture.confidence ?? 0.95;
    return {
      disposition: "integrate_page", confidence, summary: capture.content.slice(0, 80), tags: [], pages: capture.pages,
      ...(confidence < 0.7 ? { question: "Where does this belong?" } : {}),
    };
  }

  async composePage(input: ComposePageInput): Promise<string> {
    if (input.currentContent) {
      const { frontmatter, body } = parseNote(input.currentContent);
      return serializeNote(frontmatter!, `${body.trimEnd()}\n- ${input.classification.summary} (${input.citation}).\n`);
    }
    const title = input.classification.pages.find(page => page.path === input.path)?.title ?? "Untitled";
    return serializeNote(
      { title, type: input.requiredType, tags: [], created: input.today, updated: input.today, summary: input.classification.summary },
      `# ${title}\n\n- ${input.classification.summary} (${input.citation}).\n\nSee [[Index]].\n`,
    );
  }

  async answer(): Promise<never> { throw new Error("not used"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("not used"); }
  async extractBacklog(): Promise<never> { throw new Error("not used"); }
}

const CONFIG = "schema_version: 1\ntags:\n  - health\n  - housing\n  - work\n  - finance\n  - travel\nconfidence_threshold: 0.7\n";
const INDEX = "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n";
const TRAVEL_INSURANCE = [
  "---", "title: Travel insurance", "type: note", "tags: [travel]", "created: 2026-10-01", "updated: 2026-10-01",
  "summary: Travel insurance policy and renewal.", "---", "", "# Travel insurance", "", "Policy notes. See [[Index]].", "",
].join("\n");

async function vaultRepo(dir: string, withTree: boolean): Promise<VaultRepo> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  const files: Array<{ path: string; content: string }> = [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: INDEX },
    { path: "Notes/Travel insurance.md", content: TRAVEL_INSURANCE },
    { path: "Log/.gitkeep", content: "" },
    { path: "Inbox/.gitkeep", content: "" },
    // What `zenod tree seed --out` writes: Tree.md plus one lint-clean root page per node.
    ...(withTree ? seedTreeFiles(AUDIT_TREE_PROPOSAL, "2026-11-01") : []),
  ];
  for (const file of files) {
    await mkdir(dirname(join(seed, file.path)), { recursive: true });
    await writeFile(join(seed, file.path), file.content);
  }
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("seed vault");
  await git.push("origin", "main");
  return VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
}

async function replay(repo: VaultRepo): Promise<Array<{ capture: Capture; result: StoreResult; filed: string[] }>> {
  const engine = createEngine({ repo, llm: new ReplayLlm(), state: new SqliteStateStore(":memory:") });
  const out: Array<{ capture: Capture; result: StoreResult; filed: string[] }> = [];
  for (const capture of CAPTURES) {
    const result = await engine.store({ content: capture.content, source: "whatsapp", ...(capture.contentType ? { contentType: capture.contentType } : {}) });
    const [logPath, anchor] = result.evidenceRef.split("#^") as [string, string];
    out.push({ capture, result, filed: parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor) });
  }
  return out;
}

describe("E9-2b tree placement replay", { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e92b-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("files all 20 captures as leaves with a resolvable parent and a filed: line (tree vault)", async () => {
    const repo = await vaultRepo(dir, true);
    const runs = await replay(repo);
    const index = await buildTreeIndex(repo.path);

    let receiptOnly = 0;
    let withParent = 0;
    for (const { capture, result, filed } of runs) {
      expect(filed.length, capture.key).toBeGreaterThan(0);
      expect(filed.some(line => line.startsWith("log only")), capture.key).toBe(false);
      const targets = filed.map(line => /^\[\[([^\]]+)\]\]/.exec(line)![1]! + ".md");
      if (targets.length === 0) receiptOnly++;
      const placed = targets.every(path => {
        const lineage = index.lineage(path);
        return lineage.ok && (!capture.root || lineage.root.name === capture.root);
      });
      expect(placed, `${capture.key}: ${filed.join(" | ")}`).toBe(true);
      if (placed) withParent++;
      // Every filed line carries the node path, root first.
      for (const line of filed) expect(line, capture.key).toMatch(/\((?:Working|Long-term) › [^)]+\)/);
      expect(result.filing, capture.key).not.toBe("pending");
    }
    expect(receiptOnly).toBe(0);
    expect(withParent).toBe(CAPTURES.length);

    // Rule 5: ops reports are rollup lines on their project node, not product pages.
    for (const { capture, filed } of runs.filter(run => run.capture.ops)) {
      expect(filed, capture.key).toHaveLength(1);
      expect(filed[0], capture.key).toMatch(/· ops rollup$/);
    }
    const files = await listMarkdownFiles(repo.path);
    expect(files).not.toContain("Notes/Alpha9 VPS status.md");
    expect(files).not.toContain("Notes/Agent Team console log.md");
    const infra = await readFile(join(repo.path, "Areas/Infrastructure and runbooks.md"), "utf8");
    expect(infra).toMatch(/## Ops rollup\n[\s\S]*\n- \d{4}-\d{2}-\d{2} ops \(2\): \[\[[^\]]+\]\], \[\[[^\]]+\]\]\n/);
    // Ops traffic never refreshes `updated:`, so it cannot make a node look ongoing.
    expect(parseNote(infra).frontmatter!.updated).toBe("2026-11-01");

    // Rule 4: the low-confidence capture became a provisional leaf, the orphan page got a parent.
    const unsure = runs.find(run => run.capture.key === "unsure")!;
    expect(unsure.filed[0]).toMatch(/· provisional$/);
    const leafPath = /^\[\[([^\]]+)\]\]/.exec(unsure.filed[0]!)![1]! + ".md";
    expect(parseNote(await readFile(join(repo.path, leafPath), "utf8")).frontmatter).toMatchObject({ provisional: true });
    expect(parseNote(await readFile(join(repo.path, "Notes/Travel insurance.md"), "utf8")).frontmatter!.parent).toBe("[[Areas/Life admin]]");

    // The touched pages, and the whole tree, lint clean; one durable revision per capture.
    const tree = await lintTree(repo.path);
    expect(tree.issues.filter(issue => issue.severity === "error")).toEqual([]);
    expect((await lintVault(repo.path)).errors).toEqual([]);
    const log = await simpleGit(repo.path).log();
    expect(log.all.filter(commit => commit.message.startsWith("memory")).length).toBe(CAPTURES.length);
  });

  it("leaves a tree-less vault exactly as before apart from the filed: line", async () => {
    const repo = await vaultRepo(dir, false);
    const runs = await replay(repo);

    for (const { capture, result, filed } of runs) {
      expect(result.filing, capture.key).toBe(capture.confidence === undefined ? "filed" : capture.pages.length ? "uncertain" : "inbox");
      expect(filed, capture.key).toHaveLength(Math.max(1, capture.pages.length));
      if (capture.pages.length) {
        expect(filed, capture.key).toEqual(capture.pages.map(page => `[[${page.path.replace(/\.md$/, "")}]]`));
        expect(result.pagesTouched, capture.key).toEqual(capture.pages.map(page => page.path));
      } else {
        expect(filed[0]).toMatch(/^log only \(needs filing: /);
        expect(result.pagesTouched[0]).toMatch(/^Inbox\/needs-filing-/);
      }
    }
    // No tree writes: no parent/provisional fields, no rollups, no leaves, no Tree.md.
    const files = await listMarkdownFiles(repo.path);
    expect(files).not.toContain("Tree.md");
    for (const file of files.filter(path => !path.startsWith("Log/"))) {
      const raw = await readFile(join(repo.path, file), "utf8");
      expect(raw, file).not.toMatch(/^(?:parent|provisional|memory):/m);
      expect(raw, file).not.toContain("## Ops rollup");
    }
    expect(files.filter(path => path.startsWith("Inbox/needs-filing-"))).toHaveLength(1);
    // Ops reports still file through the classifier, as before.
    expect(files).toContain("Notes/Alpha9 VPS status.md");
    expect((await lintVault(repo.path)).errors).toEqual([]);
    const log = await simpleGit(repo.path).log();
    expect(log.all.filter(commit => commit.message.startsWith("memory")).length).toBe(CAPTURES.length);
  });
});

describe("E9-2b capture-first enrichment (WhatsApp path)", { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e92b-enrich-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("places enriched captures, rolls up ops reports and gives a no-page capture a provisional leaf", async () => {
    const repo = await vaultRepo(dir, true);
    const engine = createEngine({ repo, llm: new ReplayLlm(), state: new SqliteStateStore(":memory:") });
    for (const key of ["hair-voice", "ops-watcher-1", "unsure"]) {
      const capture = CAPTURES.find(c => c.key === key)!;
      const input = { content: capture.content, source: "whatsapp" as const, ...(capture.contentType ? { contentType: capture.contentType } : {}) };
      const captured = await engine.captureEvidence!(input);
      const result = await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
      const [logPath, anchor] = captured.evidenceRef.split("#^") as [string, string];
      const filed = parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor);
      expect(filed, key).toHaveLength(1);
      expect(filed[0], key).toMatch(/\((?:Working|Long-term) › /);
      if (capture.ops) expect(filed[0], key).toMatch(/· ops rollup$/);
      if (key === "unsure") expect(filed[0], key).toMatch(/· provisional$/);
      // The result reports the revision that holds the whole filing, including the filed: line.
      expect(result.commitSha, key).toBe(await simpleGit(repo.path).revparse(["HEAD"]));
      // A replay records nothing twice.
      await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
      expect(parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor), key).toEqual(filed);
    }
    // Touched pages lint clean (the fixture's untouched orphan `Notes/Travel insurance.md` is not this test's capture).
    expect((await lintTree(repo.path)).issues.filter(issue => issue.severity === "error" && issue.path !== "Notes/Travel insurance.md")).toEqual([]);
    expect((await lintVault(repo.path)).errors).toEqual([]);
  });
});

describe("E9-2b helpers", () => {
  it("walks down to a deeper node only when its own name matches", async () => {
    const vault = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
    const index = await buildTreeIndex(vault);
    expect((await chooseTreeNode(vault, index, "Two more Barcelona quotes from another clinic"))?.path).toBe("Projects/Hair transplant/2023 Barcelona quotes.md");
    expect((await chooseTreeNode(vault, index, "Hair transplant: spring timing is better"))?.path).toBe("Projects/Hair transplant.md");
    expect(await chooseTreeNode(vault, index, "zzz qqq")).toMatchObject({ weak: true, score: 0 });
  });

  it("recognises agent ops reports and leaves people's notes alone", () => {
    for (const capture of CAPTURES) expect(isAgentOpsReport(capture.content), capture.key).toBe(!!capture.ops);
  });

  it("addresses filed: lines to an entry that is no longer last, keeping anchors unique", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-e92b-log-"));
    try {
      await mkdir(join(dir, "Log"));
      const log = "# 2026-11-01\n\n## 09:00 First  ^e-aaaaaa\n- source: cli\n\n> one\n\n## 09:05 Second  ^e-bbbbbb\n- source: cli\n\n> two\n";
      await writeFile(join(dir, "Log/2026-11-01.md"), log);
      expect(await appendFiledLines(dir, "Log/2026-11-01.md#^e-bbbbbb", ["[[Notes/B]]"])).toEqual(["- filed: [[Notes/B]]"]);
      expect(await appendFiledLines(dir, "Log/2026-11-01.md#^e-aaaaaa", ["[[Notes/A]]"])).toEqual(["- filed e-aaaaaa: [[Notes/A]]"]);
      expect(await appendFiledLines(dir, "Log/2026-11-01.md#^e-aaaaaa", ["[[Notes/A]]"])).toEqual([]);
      const after = await readFile(join(dir, "Log/2026-11-01.md"), "utf8");
      expect(after.startsWith(log)).toBe(true);
      expect(parseFiledLines(after, "e-aaaaaa")).toEqual(["[[Notes/A]]"]);
      expect(parseFiledLines(after, "e-bbbbbb")).toEqual(["[[Notes/B]]"]);
      expect((await lintVault(dir, ["Log/2026-11-01.md"])).errors.filter(error => error.rule === "evidence/anchor-duplicate")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("derives the plan from a filing's pending changes", () => {
    expect(planFromChanges([{ path: "Log/2026-11-01.md", after: "x" }, { path: "Notes/A.md", after: "y" }])).toEqual({ pages: ["Notes/A.md"], leafAllowed: false, rollup: false });
    expect(planFromChanges([{ path: "Inbox/needs-filing-x.md", after: 'question: "Where?"\n' }])).toEqual({ pages: [], reason: "needs filing: Where?", leafAllowed: true });
    expect(planFromChanges([{ path: "Inbox/filing-2026-11-01-e-aaaaaa.md", after: '"status": "pending"' }])).toBeNull();
    expect(planFromChanges([{ path: "Log/2026-11-01.md", after: "x" }])).toMatchObject({ pages: [], leafAllowed: false });
  });
});

