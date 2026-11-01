import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyToWorkingTree, buildPlan, classifyInbox, computeMigration, hashPath, logEntry, main, rewriteLinks, makeResolver } from "./e9-2c-vault-tree-migration.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const seedDir = join(repo, "docs/epic9/E9-2a-tree-proposal");
const fm = (title, extra = "") => `---\ntitle: "${title}"\ntype: project\ntags: []\ncreated: 2026-06-01\nupdated: 2026-06-01\nsummary: "${title}"\n${extra}---\n`;

const FILES = {
  "Log/2026-10-31.md": "# 2026-10-31\n\n## 10:00 hair transplant quotes ^e-aaaaaa\n- source: mcp\n\n> Barcelona hair transplant quotes from 2023.\n\n## 11:00 house note ^e-bbbbbb\n- source: whatsapp\n\n> See [[Projects/Old Place/Bar]] for the shortlist.\n",
  "Projects/Zenod.md": `${fm("Zenod")}\n# Zenod\n\nThe product. See [[Zenod/Foo]].\n`,
  "Projects/Zenod/Foo.md": "# Foo design\n\nLinks to [[Projects/Old Place/Bar|the bar page]] and [[Dup]].\n",
  "Projects/Old Place/Bar.md": `${fm("Bar")}\n# Bar\n\nShortlist. [[2026-10-31#^e-bbbbbb]]\n`,
  "Projects/Old Place/draft_v1.md": "# Draft v1\n\nOld draft.\n",
  "Areas/Dup.md": `${fm("Dup")}\n# Dup\n\nArea version.\n`,
  "Notes/Dup.md": `${fm("Dup", "memoryFacts: []\n")}\n# Dup\n\nNotes version.\n\n## Detail\n\nMore.\n`,
  "Areas/Secret.md": `${fm("Secret")}\n# Secret\n\nPrivate.\n`,
  "Inbox/filing-2026-10-31-e-aaaaaa.md": "---\nstatus: filing-record\nevidence: \"Log/2026-10-31.md#^e-aaaaaa\"\n---\n\n# Topic filing receipt\n\n```json\n[{\"topic\": \"confidence\", \"pages\": [\"Projects/Zenod/hair.md\"], \"status\": \"pending\", \"disposition\": \"append_compact_note\"}]\n```\n\n## confidence (pending)\n\n2026-10-31: Jordi's hair transplant quotes from Barcelona clinics.\n",
  "Inbox/needs-filing-2026-07-01T10-00-00.md": "---\nstatus: needs-filing\nevidence: \"Log/2026-10-31.md#^e-bbbbbb\"\n---\n\nthe ring is alive\n",
  "Inbox/Jordi own note.md": "my own inbox note\n",
};

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), "e9-2c-test-"));
  for (const [p, c] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixture"]);
  return dir;
}

const PLACEMENTS = {
  ticket: "E9-2c",
  date: "2026-11-01",
  create: [{ path: "Projects/Old Place/Old Place.md", title: "Old Place", parent: "Areas/Ventures and work", summary: "A branch node." }],
  pages: [
    { path: "Projects/Zenod.md", action: "keep", parent: "Projects/Launching Zenod", confidence: "high", reason: "r" },
    { path: "Projects/Zenod/Foo.md", action: "keep", parent: "Projects/Zenod", confidence: "high", reason: "r" },
    { path: "Projects/Old Place/Bar.md", action: "move", target: "Projects/House decision/Bar.md", parent: "Projects/House decision", confidence: "medium", reason: "r" },
    { path: "Projects/Old Place/draft_v1.md", action: "archive", linkFrom: "Projects/Old Place/Bar.md", confidence: "medium", reason: "r" },
    { path: "Areas/Dup.md", action: "keep", parent: "Areas/Life admin", confidence: "high", reason: "r" },
    { path: "Notes/Dup.md", action: "merge-into", target: "Areas/Dup.md", confidence: "medium", reason: "r" },
    { pathHash: hashPath("Areas/Secret.md"), private: true, action: "keep", parent: "Areas/People and family", confidence: "high", reason: "r" },
  ],
  other: [],
};

test("classifies Inbox machine files: unfiled capture re-filed by topic, test capture archived", () => {
  const dir = makeVault();
  const receipt = "Inbox/filing-2026-10-31-e-aaaaaa.md";
  const r = classifyInbox(receipt, FILES[receipt], logEntry(dir, "Log/2026-10-31.md#^e-aaaaaa"));
  assert.equal(r.action, "refile");
  assert.equal(r.target, "Projects/Hair transplant.md");
  const stub = "Inbox/needs-filing-2026-07-01T10-00-00.md";
  assert.equal(classifyInbox(stub, FILES[stub], logEntry(dir, "Log/2026-10-31.md#^e-bbbbbb")).action, "archive");
});

test("link rewrite keeps unique basenames and rewrites path-qualified links", () => {
  const files = ["Projects/A/X.md", "Notes/Y.md"];
  const renames = new Map([["Projects/A/X.md", "Projects/B/X.md"]]);
  const { text, count } = rewriteLinks("[[X]] [[Projects/A/X|x]] [[Y]] [[2026-10-31#^e-aaaaaa]]", makeResolver(files), renames, () => 1);
  assert.equal(text, "[[X]] [[Projects/B/X|x]] [[Y]] [[2026-10-31#^e-aaaaaa]]");
  assert.equal(count, 1);
});

test("plan + apply: one commit, nothing deleted, Log untouched, every page rooted", async () => {
  const dir = makeVault();
  const { plan, problems } = buildPlan({ vault: dir, placements: PLACEMENTS, seedDir, baseCommit: null });
  assert.deepEqual(problems, []);
  assert.ok(!JSON.stringify(plan).includes("Secret.md"), "private page path stays out of the plan");
  assert.equal(plan.inbox.length, 2);

  const logBefore = readFileSync(join(dir, "Log/2026-10-31.md"), "utf8");
  const pre = computeMigration(dir, plan);
  assert.deepEqual(pre.errors, []);
  assert.deepEqual(pre.report.logLinksAffected, [{ file: "Log/2026-10-31.md", links: 1 }]);

  const result = applyToWorkingTree(dir, plan, { message: "E9-2c test" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const count = execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(count, "2");
  const renamed = execFileSync("git", ["-C", dir, "show", "-M", "--name-status", "--format=", "HEAD"], { encoding: "utf8" });
  assert.ok(!/^D\t/m.test(renamed), `no file is deleted:\n${renamed}`);
  assert.equal(readFileSync(join(dir, "Log/2026-10-31.md"), "utf8"), logBefore);

  const read = (p) => readFileSync(join(dir, p), "utf8");
  assert.match(read("Projects/Zenod/Foo.md"), /^---\ntitle: "Foo design"\ntype: project\n[\s\S]*parent: "\[\[Projects\/Zenod\]\]"\n---\n# Foo design/);
  assert.match(read("Projects/Zenod/Foo.md"), /\[\[Projects\/House decision\/Bar\|the bar page\]\]/);
  assert.match(read("Projects/House decision/Bar.md"), /parent: "\[\[Projects\/House decision\]\]"/);
  assert.match(read("Projects/House decision/Bar.md"), /## Earlier drafts[\s\S]*\[\[Archive\/Projects\/Old Place\/draft_v1\|draft_v1\]\]/);
  assert.match(read("Areas/Dup.md"), /## Merged from \[\[Archive\/Notes\/Dup\|Dup\]\] \(E9-2c, 2026-11-01\)\n\nNotes version\.\n\n### Detail/);
  assert.match(read("Archive/Notes/Dup.md"), /merged-into: "\[\[Areas\/Dup\]\]"/);
  assert.match(read("Areas/Secret.md"), /parent: "\[\[Areas\/People and family\]\]"/);
  assert.match(read("Projects/Hair transplant.md"), /- 2026-10-31 · Barcelona hair transplant quotes from 2023\. \[\[2026-10-31#\^e-aaaaaa\]\]/);
  assert.match(read("Projects/Launching Zenod.md"), /## In this branch\n\n- \[\[Projects\/Zenod\|Zenod\]\]/);
  assert.ok(existsSync(join(dir, "Archive/Inbox/needs-filing-2026-07-01T10-00-00.md")));
  assert.ok(existsSync(join(dir, "Inbox/Jordi own note.md")), "Jordi's own Inbox notes stay");
  assert.ok(!/In this branch/.test(read("Tree.md")));

  const lintModule = join(repo, "packages/core/dist/vault/treeLint.js");
  if (existsSync(lintModule)) {
    const { lintTree } = await import(lintModule);
    const report = await lintTree(dir);
    assert.deepEqual(report.issues.filter(i => i.severity === "error"), []);
    assert.equal(report.stats.rooted, report.stats.treePages);
    assert.equal(report.stats.inboxMachineFiles, 0);
    assert.equal(report.stats.duplicateTitleGroups, 0);
  }
});

test("apply refuses a vault that drifted from the plan, and --dry-run leaves the clone untouched", async () => {
  const dir = makeVault();
  const { plan } = buildPlan({ vault: dir, placements: PLACEMENTS, seedDir, baseCommit: null });
  const planPath = join(mkdtempSync(join(tmpdir(), "e9-2c-plan-")), "plan.json");
  writeFileSync(planPath, JSON.stringify(plan));
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  const log = console.log; console.log = () => {};
  try {
    assert.equal(await main(["apply", "--vault", dir, "--plan", planPath, "--dry-run"]), 0);
  } finally { console.log = log; }
  assert.equal(execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }), head);
  assert.equal(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }), "");
  assert.equal(execFileSync("git", ["-C", dir, "worktree", "list"], { encoding: "utf8" }).trim().split("\n").length, 1);

  writeFileSync(join(dir, "Notes/New page.md"), `${fm("New page")}\n# New\n`);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "drift"]);
  const { errors } = computeMigration(dir, plan);
  assert.ok(errors.some(e => e.includes("Notes/New page.md") && e.includes("re-run plan")), errors.join("\n"));
});
