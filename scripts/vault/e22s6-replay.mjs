#!/usr/bin/env node
// E22-S6 dry-run replay: the notes that still made a new file, run again through the filer's rescue step.
//
// Never writes to the vault it reads. It exports the vault at one commit (`git archive`) into a scratch
// folder, removes each listed note's new leaves there, and replays that note's rescued points in their
// receipt order with the new rescue rules (packages/core dist: build it first):
//   1. a point with no subject page of its own grows the closest page this note already reached;
//   2. a leaf this note made counts as such a page, so a note makes at most one new page;
//   3. with neither and a weak word match, the root-topic pick (an external classify command) decides;
//   a one-off or cut-off fragment stays in the Log.
// The upstream decisions (which points the organiser filed, which it could not place) are the ones the
// receipts recorded, so the replay changes only the step this ticket changed.
//
// Usage:
//   node scripts/vault/e22s6-replay.mjs --vault <checkout> --rev <sha> --misses <misses.json> \
//     [--classify-cmd "<cmd reading ClassifyInput JSON on stdin, printing Classification JSON>"] [--json]
// misses.json: [{ "id": "e-079c02", "file": "2026-11-25.md", "new": ["Notes/…"], "targets": [...] }]
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const vault = resolve(opt("vault", ""));
const rev = opt("rev", "HEAD");
const misses = JSON.parse(readFileSync(resolve(opt("misses", "")), "utf8"));
const classifyCmd = opt("classify-cmd", null);
const core = resolve(fileURLToPath(new URL("../../packages/core/dist/", import.meta.url)));
const load = (path) => import(pathToFileURL(join(core, path)).href);
const tp = await load("engine/treePlacement.js");
const { buildTreeIndex } = await load("vault/tree.js");
const { getEvidenceEntry } = await load("engine/evidence.js");

const REJECTED = /reconciliation_(?:needs_clarification|incompatible_decisions)/;
const receiptOf = (dir, ref) => {
  const [log, anchor] = ref.split("#^");
  const raw = readFileSync(join(dir, "Inbox", `filing-${log.slice(4, -3)}-${anchor}.md`), "utf8");
  return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)[1]);
};
/** The person's words a leaf quoted for this note (its `## Capture …` block). */
const quotedIn = (raw, citation) => {
  const at = raw.indexOf(citation);
  const block = raw.slice(raw.indexOf("\n", at) + 1).split(/\n## |\nFiling note:/)[0];
  return block.split("\n").filter((line) => line.startsWith("> ")).map((line) => line.slice(2)).join("\n").trim();
};
const classify = classifyCmd ? async (input) => JSON.parse(execSync(classifyCmd, { input: JSON.stringify(input), maxBuffer: 1 << 24 }).toString()) : null;

const scratch = mkdtempSync(join(tmpdir(), "e22s6-replay-"));
const results = [];
try {
  execSync(`git -C ${JSON.stringify(vault)} archive ${rev} | tar -x -C ${JSON.stringify(scratch)}`);
  execFileSync("git", ["init", "-q"], { cwd: scratch }); // TrackedWrites needs nothing more; nothing is committed or pushed.
  for (const miss of misses) {
    const ref = `Log/${miss.file}#^${miss.id}`;
    const receipt = receiptOf(scratch, ref);
    const [date, anchor] = [miss.file.slice(0, -3), miss.id];
    const citation = `[[${date}#^${anchor}]]`;
    const leafWords = new Map();
    for (const leaf of miss.new) {
      const raw = readFileSync(join(scratch, `${leaf}.md`), "utf8");
      leafWords.set(`${leaf}.md`, quotedIn(raw, citation));
    }
    const entry = await getEvidenceEntry(scratch, ref);
    // A plan receipt holds { classification, outcomes }; a plain filing record holds the outcomes alone.
    const outcomes = (Array.isArray(receipt) ? receipt : receipt.outcomes).map((o) => ({ ...o }));
    // The scratch vault as it was before the rescue made those leaves: the leaves are gone, the topic pages stay.
    for (const leaf of leafWords.keys()) rmSync(join(scratch, leaf), { force: true });
    // The rescued points start unplaced: only where this replay puts them counts as a page of the note.
    for (const outcome of outcomes) if (outcome.filedPages.some((page) => leafWords.has(page))) outcome.rescued = outcome.filedPages.find((page) => leafWords.has(page)), outcome.filedPages = [];
    const steps = [];
    for (const outcome of outcomes) {
      const leaf = outcome.rescued;
      if (!leaf) continue;
      const text = leafWords.get(leaf) || outcome.topic;
      if (tp.isOneOff(entry.content)) { outcome.filedPages = []; steps.push({ topic: outcome.topic, to: "log only (one-off)", how: "one-off" }); continue; }
      const topicIdea = receipt.classification?.topics?.find((t) => t.ideaId === outcome.ideaId);
      const anchors = outcome.reroutedFrom || REJECTED.test(outcome.reason ?? "") ? [] : (topicIdea?.pages ?? []).map((p) => p.path);
      const notePages = [...new Set(outcomes.filter((o) => o !== outcome).flatMap((o) => o.filedPages))];
      const index = await buildTreeIndex(scratch);
      let fallback = null;
      let how = "note page";
      if (!(await tp.notePageChoice(scratch, index, `${outcome.topic}\n\n${text}`, notePages, ref)) && !tp.anchorNode(index, anchors)) {
        how = "word match";
        const byWords = await tp.chooseTreeNode(scratch, index, `${outcome.topic}\n\n${text}`, { rootsOnly: true });
        if ((!byWords || byWords.weak) && classify) {
          fallback = await tp.pickRootTopic(scratch, index, { title: outcome.topic, content: text, note: entry.content }, classify, { threshold: Math.min(0.7, tp.ROOT_PICK_MIN_CONFIDENCE) });
          how = fallback ? "root-topic pick" : "root-topic pick: none";
        }
      } else if (tp.anchorNode(index, anchors)) how = "own subject";
      const writes = new tp.TrackedWrites(scratch);
      const placed = await tp.writeProvisionalLeaf(scratch, index,
        { title: outcome.topic, content: text, evidenceRef: ref, reason: outcome.reason ?? "replay", today: date }, writes,
        { rootsOnly: true, anchors, notePages, fallback });
      const isNew = placed && !placed.grown;
      outcome.filedPages = placed ? [placed.path] : [];
      steps.push({ topic: outcome.topic, to: placed?.path ?? "nowhere", how: isNew ? `${how} → new leaf` : how, newLeaf: !!isNew });
    }
    results.push({ id: miss.id, before: miss.new.length, after: new Set(steps.filter((s) => s.newLeaf).map((s) => s.to)).size, steps });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const before = results.reduce((n, r) => n + r.before, 0);
const after = results.reduce((n, r) => n + r.after, 0);
if (args.includes("--json")) {
  writeFileSync(1, `${JSON.stringify({ rev, notes: results.length, leavesBefore: before, leavesAfter: after, results }, null, 2)}\n`);
} else {
  for (const r of results) {
    console.log(`${r.id}: ${r.before} → ${r.after} new leaves`);
    for (const s of r.steps) console.log(`  - ${s.how}: ${s.to}`);
  }
  console.log(`\n${results.length} notes: ${before} new leaves before, ${after} after (dry run, vault ${rev} untouched)`);
}
