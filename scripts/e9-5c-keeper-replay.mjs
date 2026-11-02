#!/usr/bin/env node
/**
 * EPIC-9 E9-5c: replay a vault's last N weeks through the memory-keeper, on a scratch clone.
 *
 *   node scripts/e9-5c-keeper-replay.mjs --source <vault git repo> --work <empty scratch dir> \
 *     [--weeks 8] [--last-sunday 2026-11-01] [--ref main] [--out report.json]
 *   node scripts/e9-5c-keeper-replay.mjs --source <vault git repo> --work <empty dir> --rehearse 2026-11-08 [--runs 2] [--ref main]
 *
 * `--rehearse <day>` runs the keeper's next digestions on a clone of the vault exactly as it stands
 * (its real tree, Keeper notes and Recent changes), one a week from <day>, to show what the first
 * live runs will do. Nothing is pushed.
 *
 * The scratch clone starts from the vault as it stood on the Sunday before the first replayed week,
 * with a tree no discovery has written (so the first digestion is the keeper's first, budget 6) and
 * the vault's current `## Keeper notes` (the person's word applies from the start). Then, one week at
 * a time, it brings in that week's real history (Log days and pages as they were at Sunday 02:00 UTC;
 * the replay's own `parent:`/`memory:` lines win over the history's), commits that as "content", and
 * runs one keeper digestion exactly as the engine does: the sweep with the keeper's gate, the sweep's
 * raw-data guard, `zenod lint` errors introduced = 0, tree lint errors not up, one commit, keeper state
 * beside the vault. After each digestion commit it checks `git revert` gives back the previous tree
 * byte for byte.
 *
 * Nothing is pushed: the clone has no remote. The JSON report holds counts and root names only.
 * Run it with the core package built (`npm run build -w zenod`) or bundled with esbuild.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runTreeSweep, assertSweepChangesSafe, lintErrorKey } from "../packages/core/dist/engine/treeSweep.js";
import { TrackedWrites } from "../packages/core/dist/engine/treePlacement.js";
import {
  KEEPER_WEEKLY_BUDGET,
  keeperWeekKey,
  loadKeeperState,
  readKeeperTreeState,
  saveKeeperState,
} from "../packages/core/dist/engine/treeKeeper.js";
import { lintVault } from "../packages/core/dist/vault/lint.js";
import { lintTree } from "../packages/core/dist/vault/treeLint.js";
import { treeNoteSections } from "../packages/core/dist/vault/treeSteering.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, i, all) => {
  if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
  return acc;
}, []));
if (!args.source || !args.work) {
  console.error("usage: e9-5c-keeper-replay.mjs --source <vault repo> --work <scratch dir> [--weeks 8] [--last-sunday YYYY-MM-DD] [--ref main] [--out file]");
  process.exit(2);
}
const WEEKS = Number(args.weeks ?? 8);
const REF = args.ref ?? "main";
const DAY = 86_400_000;
const sundayOf = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - new Date(`${day}T00:00:00Z`).getUTCDay() * DAY).toISOString().slice(0, 10);
const lastSunday = args["last-sunday"] ?? sundayOf(new Date().toISOString().slice(0, 10));
const sundays = Array.from({ length: WEEKS + 1 }, (_, i) => new Date(Date.parse(`${lastSunday}T00:00:00Z`) - (WEEKS - i) * 7 * DAY).toISOString().slice(0, 10));

const git = (cwd, ...a) => execFileSync("git", ["-c", "core.quotePath=false", ...a], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const gitBuf = (cwd, ...a) => execFileSync("git", a, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

const work = args.work;
if (existsSync(work) && execFileSync("ls", ["-A", work], { encoding: "utf8" }).trim()) throw new Error(`--work ${work} must be empty`);
mkdirSync(work, { recursive: true });
const source = join(work, "source");
const vault = join(work, "vault");
const statePath = join(work, "keeper-state.json");
git(work, "clone", "--quiet", "--no-local", "--no-checkout", args.source, source);
git(source, "remote", "remove", "origin");
const head = git(source, "rev-parse", REF).trim();
const commitAt = (sunday) => git(source, "rev-list", "-1", `--before=${sunday}T02:00:00Z`, head).trim();

/** Content the replay takes from history: the Log and the person's pages (attachments stay out). */
const TAKEN = /^(Log|Areas|Projects|Notes|Inbox)\//;
const TREE_KEYS = /^(parent|memory):/;
const filesAt = (commit) => new Set(git(source, "ls-tree", "-r", "--name-only", commit).split("\n").filter((p) => p.endsWith(".md") && TAKEN.test(p)));

const fm = (raw) => /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);

/**
 * History's page, with the replay's own tree lines kept (history pages from before the tree carry none).
 * A page that had no frontmatter back then (the E9-2c migration added it) borrows its frontmatter from
 * the vault's head, tree lines dropped, so the replay measures the keeper, not that old lint debt.
 */
function overlay(path, incoming) {
  const target = join(vault, path);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (!fm(incoming)) {
    let atHead = null;
    try { atHead = gitBuf(source, "show", `${head}:${path}`).toString("utf8"); } catch { /* not at head */ }
    const headFm = atHead && fm(atHead);
    if (!headFm) return incoming;
    incoming = `---\n${headFm[1]}\n---\n${incoming}`;
  }
  const inc = fm(incoming);
  const kept = current && fm(current) ? fm(current)[1].split("\n").filter((l) => TREE_KEYS.test(l)) : [];
  const lines = inc[1].split("\n").filter((l) => !TREE_KEYS.test(l));
  return `---\n${[...lines, ...kept].join("\n")}\n---${inc[2]}${incoming.slice(inc[0].length)}`;
}

function bringIn(commit, previous) {
  const files = filesAt(commit);
  let written = 0;
  let removed = 0;
  for (const path of files) {
    const incoming = gitBuf(source, "show", `${commit}:${path}`).toString("utf8");
    const next = path.startsWith("Log/") ? incoming : overlay(path, incoming);
    const target = join(vault, path);
    if (existsSync(target) && readFileSync(target, "utf8") === next) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, next);
    written++;
  }
  // A page history removed this week goes too (the keeper never deletes; history did).
  for (const path of previous ?? []) {
    if (files.has(path) || path.startsWith("Log/")) continue;
    if (existsSync(join(vault, path))) { rmSync(join(vault, path)); removed++; }
  }
  return { files, written, removed };
}

if (args.rehearse) {
  git(work, "clone", "--quiet", "--no-local", args.source, vault);
  git(vault, "checkout", "--quiet", "-B", "main", head);
  git(vault, "remote", "remove", "origin");
  git(vault, "config", "user.name", "keeper-rehearsal");
  git(vault, "config", "user.email", "keeper-rehearsal@localhost");
  const runs = [];
  for (let i = 0; i < Number(args.runs ?? 2); i++) {
    const today = new Date(Date.parse(`${args.rehearse}T00:00:00Z`) + i * 7 * DAY).toISOString().slice(0, 10);
    const before = ((await readKeeperTreeState(vault))?.roots ?? []).map((r) => ({ id: r.id, name: r.name }));
    const state = await loadKeeperState(statePath);
    const week = keeperWeekKey(today);
    const spent = state.week?.key === week ? state.week.changes : 0;
    const lintBefore = (await lintTree(vault)).issues.filter((x) => x.severity === "error").length;
    const report = await runTreeSweep(vault, { today, keeper: { budget: Math.max(0, KEEPER_WEEKLY_BUDGET - spent), pending: state.pending } }, new TrackedWrites(vault));
    const changes = (() => { const out = []; for (const line of git(vault, "status", "--porcelain", "-uall", "-z").split("\0").filter(Boolean)) { const path = line.slice(3); let b = null; try { b = gitBuf(vault, "show", `HEAD:${path}`).toString("utf8"); } catch {} out.push({ path, before: b, after: existsSync(join(vault, path)) ? readFileSync(join(vault, path), "utf8") : null }); } return out; })();
    let commit = null;
    let revertIdentical = null;
    if (changes.length) {
      assertSweepChangesSafe(changes);
      const known = new Set(report.lintErrorsBefore);
      const introduced = (await lintVault(vault, changes.filter((c) => c.after !== null && c.path.endsWith(".md")).map((c) => c.path))).errors.filter((e) => !known.has(lintErrorKey(e)));
      if (introduced.length) throw new Error(`lint errors introduced: ${introduced.length}`);
      git(vault, "add", "-A");
      git(vault, "commit", "--quiet", "-m", `memory: keeper (weekly digestion, ${report.keeper.applied.length} changes)`);
      commit = git(vault, "rev-parse", "--short", "HEAD").trim();
      git(vault, "revert", "--no-commit", "HEAD");
      try { git(vault, "diff", "--cached", "--quiet", "HEAD~1"); revertIdentical = true; } catch { revertIdentical = false; }
      git(vault, "reset", "--quiet", "--hard", "HEAD");
    }
    const k = report.keeper;
    await saveKeeperState(statePath, { ...state, week: { key: week, changes: spent + k.applied.length - k.steered }, pending: k.pending, lastDigestion: today, runs: [...state.runs] });
    const after = ((await readKeeperTreeState(vault))?.roots ?? []).map((r) => ({ id: r.id, name: r.name }));
    const touched = changes.map((c) => c.path);
    runs.push({
      day: today, budget: k.budget, changes: k.applied.length, applied: k.applied, unconfirmed: k.unconfirmed.length, overBudget: k.overBudget.length,
      rootsBefore: before.length, rootsAfter: after.length, stable: before.filter((r) => after.some((a) => a.id === r.id && a.name === r.name)).length,
      recentLines: k.recentLines, filesChanged: touched.length, logOrAttachmentsTouched: touched.filter((p) => p.startsWith("Log/") || p.startsWith("_attachments/")).length,
      treeLintErrorsBefore: lintBefore, treeLintErrors: (await lintTree(vault)).issues.filter((x) => x.severity === "error").length, commit, revertIdentical, modelCalls: 0, costUsd: 0,
      roots: after.map((r) => r.name),
    });
    console.log(JSON.stringify(runs.at(-1)));
  }
  if (args.out) writeFileSync(args.out, `${JSON.stringify({ schema: "zenod.e9-5c-keeper-rehearsal/v1", sourceHead: head.slice(0, 7), runs }, null, 2)}\n`);
  process.exit(0);
}

// Seed: the vault on the first Sunday, plus a tree no discovery wrote, holding today's Keeper notes.
const seedCommit = commitAt(sundays[0]);
mkdirSync(vault);
git(vault, "init", "--quiet", "-b", "main");
git(vault, "config", "user.name", "keeper-replay");
git(vault, "config", "user.email", "keeper-replay@localhost");
for (const path of ["Index.md", "AGENTS.md", ".brain/config.yml"]) {
  try { const raw = gitBuf(source, "show", `${seedCommit}:${path}`); mkdirSync(dirname(join(vault, path)), { recursive: true }); writeFileSync(join(vault, path), raw); } catch { /* optional */ }
}
const headTree = (() => { try { return gitBuf(source, "show", `${head}:Tree.md`).toString("utf8"); } catch { return ""; } })();
const notes = treeNoteSections(headTree).split(/\n\n(?=## )/).filter((s) => /^## Keeper notes/i.test(s)).join("\n\n");
writeFileSync(join(vault, "Tree.md"), ["---", "title: Tree", "---", "", "# Memory tree", "", "## Working memory", "", "## Long-term memory", "", ...(notes ? [notes, ""] : [])].join("\n"));
let previousFiles = bringIn(seedCommit, null).files;
git(vault, "add", "-A");
git(vault, "commit", "--quiet", "-m", `replay: content as of ${sundays[0]}`);

const rootsOf = async () => ((await readKeeperTreeState(vault))?.roots ?? []).map((r) => ({ id: r.id, name: r.name, kind: r.kind, path: r.path, pages: r.members.length }));
const changesOf = () => {
  const out = [];
  for (const line of git(vault, "status", "--porcelain", "-uall", "-z").split("\0").filter(Boolean)) {
    const path = line.slice(3);
    let before = null;
    try { before = gitBuf(vault, "show", `HEAD:${path}`).toString("utf8"); } catch { /* new file */ }
    const after = existsSync(join(vault, path)) ? readFileSync(join(vault, path), "utf8") : null;
    out.push({ path, before, after });
  }
  return out;
};

const weeks = [];
let lastFinal = [];
for (let i = 0; i < sundays.length; i++) {
  const today = sundays[i];
  let content = { written: 0, removed: 0 };
  if (i > 0) {
    const brought = bringIn(commitAt(today), previousFiles);
    previousFiles = brought.files;
    content = { written: brought.written, removed: brought.removed };
    git(vault, "add", "-A");
    if (git(vault, "status", "--porcelain").trim()) git(vault, "commit", "--quiet", "-m", `replay: content as of ${today}`);
  }
  const before = await rootsOf();
  const state = await loadKeeperState(statePath);
  const week = keeperWeekKey(today);
  const spent = state.week?.key === week ? state.week.changes : 0;
  const writes = new TrackedWrites(vault);
  const started = Date.now();
  const report = await runTreeSweep(vault, { today, keeper: { budget: Math.max(0, KEEPER_WEEKLY_BUDGET - spent), pending: state.pending } }, writes);
  const ms = Date.now() - started;
  const changes = changesOf();
  let commit = null;
  let revertIdentical = null;
  if (changes.length) {
    assertSweepChangesSafe(changes);
    const lintBefore = new Set(report.lintErrorsBefore);
    const written = changes.filter((c) => c.after !== null && c.path.endsWith(".md")).map((c) => c.path);
    const introduced = (await lintVault(vault, written)).errors.filter((e) => !lintBefore.has(lintErrorKey(e)));
    if (introduced.length) throw new Error(`week ${today}: lint errors introduced: ${introduced.map((e) => `${e.path} [${e.rule}]`).join("; ")}`);
    const k = report.keeper;
    git(vault, "add", "-A");
    git(vault, "commit", "--quiet", "-m", `memory: keeper (weekly digestion, ${k.applied.length} changes)`);
    commit = git(vault, "rev-parse", "--short", "HEAD").trim();
    // One revert gives back the tree as it stood, byte for byte.
    git(vault, "revert", "--no-commit", "HEAD");
    try { git(vault, "diff", "--cached", "--quiet", "HEAD~1"); revertIdentical = true; } catch { revertIdentical = false; }
    git(vault, "reset", "--quiet", "--hard", "HEAD");
  }
  const k = report.keeper;
  await saveKeeperState(statePath, {
    ...state,
    week: { key: week, changes: spent + k.applied.length - k.steered },
    pending: k.pending,
    lastDigestion: today,
    runs: [...state.runs, { day: today, mode: "weekly", changes: k.applied.length, waiting: k.unconfirmed.length + k.overBudget.length, roots: k.rootsAfter, stable: k.stable, costUsd: 0 }],
  });
  const after = await rootsOf();
  const treeLint = await lintTree(vault);
  // Week to week: last week's final roots that this week's tree still has, same id and same name.
  // A root whose page the person's own history moved or removed this week is counted apart.
  const kept = lastFinal.filter((r) => after.some((a) => a.id === r.id && a.name === r.name)).length;
  const lostToHistory = lastFinal.filter((r) => !after.some((a) => a.id === r.id && a.name === r.name) && !existsSync(join(vault, r.path))).length;
  weeks.push({
    sunday: today,
    content,
    first: k.first,
    budget: k.budget,
    changes: k.applied.length,
    applied: k.applied,
    unconfirmed: k.unconfirmed.length,
    overBudget: k.overBudget.length,
    rootsLastWeek: lastFinal.length,
    rootsBefore: before.length,
    rootsAfter: after.length,
    stable: kept,
    stableShare: lastFinal.length ? Math.round((kept / lastFinal.length) * 1000) / 1000 : null,
    lostToHistory,
    keeperStableShare: lastFinal.length - lostToHistory ? Math.round((kept / (lastFinal.length - lostToHistory)) * 1000) / 1000 : null,
    carriedOrMissing: k.missing,
    recentLines: k.recentLines,
    treeLintErrors: treeLint.issues.filter((x) => x.severity === "error").length,
    treeLintErrorsBefore: report.counts.treeLintErrorsBefore,
    filesChanged: changes.length,
    commit,
    revertIdentical,
    modelCalls: 0,
    costUsd: 0,
    ms,
    roots: after.map((r) => `${r.kind === "working" ? "W" : "L"} ${r.name}`),
  });
  lastFinal = after;
  console.log(`${today}: ${k.first ? "first " : ""}budget ${k.budget}, changes ${k.applied.length}, waiting ${k.unconfirmed.length}+${k.overBudget.length}, roots ${before.length}→${after.length}, stable ${kept}/${weeks.at(-1).rootsLastWeek} (history removed ${lostToHistory} root pages), lint ${treeLint.issues.filter((x) => x.severity === "error").length}, ${commit ? `commit ${commit}, revert ${revertIdentical ? "identical" : "DIFFERENT"}` : "no commit"}, ${ms} ms`);
}

const measured = weeks.slice(1);
const summary = {
  weeks: measured.length,
  firstSunday: sundays[1],
  lastSunday,
  sourceHead: head.slice(0, 7),
  meanStableShare: Math.round((measured.reduce((s, w) => s + (w.stableShare ?? 1), 0) / measured.length) * 1000) / 1000,
  minStableShare: Math.min(...measured.map((w) => w.stableShare ?? 1)),
  weeksAtOrAbove80: measured.filter((w) => (w.stableShare ?? 1) >= 0.8).length,
  pooledStableShare: Math.round((measured.reduce((s, w) => s + w.stable, 0) / Math.max(1, measured.reduce((s, w) => s + w.rootsLastWeek, 0))) * 1000) / 1000,
  meanKeeperStableShare: Math.round((measured.reduce((s, w) => s + (w.keeperStableShare ?? 1), 0) / measured.length) * 1000) / 1000,
  weeksKeeperAtOrAbove80: measured.filter((w) => (w.keeperStableShare ?? 1) >= 0.8).length,
  rootPagesRemovedByHistory: measured.reduce((s, w) => s + w.lostToHistory, 0),
  maxChanges: Math.max(...measured.map((w) => w.changes)),
  totalChanges: measured.reduce((s, w) => s + w.changes, 0),
  commits: weeks.filter((w) => w.commit).length,
  revertsIdentical: weeks.filter((w) => w.revertIdentical).length,
  modelCalls: 0,
  costUsd: 0,
  maxTreeLintErrors: Math.max(...weeks.map((w) => w.treeLintErrors)),
};
const out = { schema: "zenod.e9-5c-keeper-replay/v1", summary, seed: weeks[0], weeks: measured };
console.log(JSON.stringify(summary, null, 2));
if (args.out) writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
