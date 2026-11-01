#!/usr/bin/env node
// EPIC-9 E9-2c: one-time migration of an existing Zenod vault into the memory tree.
//
//   plan   build plan.json from curated placements + the E9-2a seed + a read of the vault
//   apply  apply plan.json to a vault clone as ONE commit on a branch (or --dry-run: in a
//          throwaway git worktree, write the diff, optionally lint, then remove it)
//
// Rules (E9-1 audit default 3): pages are moved, merged or archived, never deleted;
// anything unsure goes to Archive/; Log/ and _attachments/ are never written.
// Private pages are named in the plan by sha256 of their path, so the plan can live
// in a public repo; capture text is read from the vault at apply time, never stored.
//
// Revert: before the branch is merged, delete the branch; after, `git revert <commit>`.

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const PLAN_SCHEMA = "zenod.vault-tree-migration/v1";
const MEANING = new Set(["Areas", "Projects", "Notes"]);
const NEVER_WRITE = ["Log/", "_attachments/", ".git/"];
const ARCHIVE = "Archive";
const TYPE_BY_FOLDER = { Areas: "area", Projects: "project", Notes: "note" };

// ---------- vault reading ----------

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".obsidian" || entry.name === ".brain") continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk("");
  return out.sort();
}

const basename = (p) => p.split("/").pop().replace(/\.md$/, "");
const top = (p) => p.split("/")[0];
const isIndexFile = (p) => { const b = basename(p); return b === "index" || b.endsWith("Index"); };
export const isTreePage = (p) => p.endsWith(".md") && p.includes("/") && MEANING.has(top(p)) && !isIndexFile(p);
const isReceipt = (p) => /^Inbox\/filing-\d{4}-\d{2}-\d{2}-e-[a-zA-Z0-9-]+\.md$/.test(p);
const isStub = (p) => /^Inbox\/needs-filing-[^/]+\.md$/.test(p);
export const isInboxMachineFile = (p) => isReceipt(p) || isStub(p);
export const hashPath = (p) => `sha256:${createHash("sha256").update(p).digest("hex").slice(0, 16)}`;
const noMd = (p) => p.replace(/\.md$/, "");
const wikilink = (p) => `[[${noMd(p)}]]`;
const assertWritable = (p) => {
  if (NEVER_WRITE.some(prefix => p.startsWith(prefix))) throw new Error(`refusing to write ${p}: Log/, _attachments/ and .git/ are never touched`);
};

// ---------- frontmatter (text-preserving; never re-serialises existing YAML) ----------

export function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw);
  if (!m) return { has: false, lines: [], body: raw };
  return { has: true, lines: m[1].split(/\r?\n/), body: raw.slice(m[0].length) };
}

function fmValue(lines, key) {
  const line = lines.find(l => l.startsWith(`${key}:`));
  if (!line) return undefined;
  const v = line.slice(key.length + 1).trim();
  try { return v.startsWith('"') ? JSON.parse(v) : v.replace(/^'(.*)'$/, "$1"); } catch { return v; }
}

function setFmKey(lines, key, value) {
  const out = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}:`)) {
      out.push(`${key}: ${value}`);
      replaced = true;
      while (i + 1 < lines.length && /^\s+\S|^\s*-\s/.test(lines[i + 1]) && !/^\S/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  if (!replaced) out.push(`${key}: ${value}`);
  return out;
}

const joinNote = (lines, body) => `---\n${lines.join("\n")}\n---\n${body}`;
const q = (s) => JSON.stringify(s);

export function titleOf(raw, path) {
  const fm = splitFrontmatter(raw);
  const t = fm.has ? fmValue(fm.lines, "title") : undefined;
  if (typeof t === "string" && t.trim()) return t.trim();
  const h1 = /^#\s+(.+?)\s*$/m.exec(fm.body);
  return h1 ? h1[1] : basename(path);
}

// ---------- links ----------

const WIKILINK = /(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;

/** Obsidian-like resolution against a file list: exact path, then path suffix, then unique basename. */
export function makeResolver(files) {
  const byPath = new Map();
  const byBase = new Map();
  for (const f of files) {
    const key = (f.endsWith(".md") ? noMd(f) : f).toLowerCase();
    byPath.set(key, f);
    const b = key.split("/").pop();
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  return (target) => {
    let t = target.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
    if (t.toLowerCase().endsWith(".md")) t = t.slice(0, -3);
    const key = t.toLowerCase();
    if (byPath.has(key)) return byPath.get(key);
    if (key.includes("/")) {
      const hits = [...byPath.entries()].filter(([k]) => k.endsWith(`/${key}`));
      return hits.length === 1 ? hits[0][1] : null;
    }
    const hits = byBase.get(key) ?? [];
    return hits.length === 1 ? hits[0] : (hits.length > 1 ? hits.slice().sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] : null);
  };
}

/** Rewrite wikilinks that resolve (before) to a renamed file so they resolve to its new home (after). */
export function rewriteLinks(text, resolveBefore, renames, afterBaseCount) {
  let count = 0;
  const out = text.replace(WIKILINK, (all, bang, target, heading = "", alias = "") => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(target.trim())) return all; // Log citation
    const resolved = resolveBefore(target);
    if (!resolved || !renames.has(resolved)) return all;
    const next = renames.get(resolved);
    const pathQualified = target.includes("/");
    if (!pathQualified && basename(next).toLowerCase() === basename(resolved).toLowerCase() && afterBaseCount(basename(next)) === 1) return all;
    count++;
    const shown = alias || (pathQualified ? "" : `|${target.trim()}`);
    return `${bang}[[${noMd(next)}${heading}${shown}]]`;
  });
  return { text: out, count };
}

// ---------- Inbox classification ----------

// Refile targets are pages the migration itself creates, so re-filing never edits an existing page.
export const INBOX_RULES = [
  { target: "Projects/Hair transplant.md", words: ["hair transplant", "hair_flow", "hair flow", "norwood", "hair loss", "hair situation"] },
  { target: "Projects/House decision.md", words: ["house decision", "housing", "cerdanya", "maresme", "sardinia", "mortgage", "real estate", "real-estate", "buy-to-let", "rental yield", "property decision", "house", "flat purchase", "altitude"] },
  { target: "Projects/Idealista Data Relationship/Idealista Data Relationship.md", words: ["idealista", "ideascraper", "idea_scraper", "infohomes", "openprop", "lucía", "lucia"] },
  { target: "Projects/Launching Epic Social.md", words: ["epic social", "agent team", "team desk", "team home", "epic book", "epicspine", "epic spine", "epic team", "console", "persona", "reddit", "post idea", "post topic", "social post", "linkedin", "posted", "writer", "scout"] },
  { target: "Projects/Launching Zenod.md", words: ["zenod", "zenot", "phylax", "whatsapp connector", "zal ", "zal-", "tenant", "signup", "stripe", "librarian", "store_memory", "ask_brain", "obsidian-brain", "memory tree"] },
  { target: "Areas/Infrastructure and runbooks.md", words: ["infra-vps", "dokploy", "hetzner", "vps1", "vps2", "vps3", "tailscale", "tailnet", "cloudflare", "github auth", "gmail", "chrome-automation", "browser automation", "opencode", "watcher read"] },
  { target: "Areas/Ventures and work.md", words: ["alpha9", "aeat", "gestor", "hacienda", "tax inspection", "tax audit", "tax assist", "expense", "invoice", "polymarket", "poly-maker", "poly maker", "polymaker", "kalshi", "trading", "altamira", "patronbtc", "nectary", "repominingfunding", "dividend"] },
  { target: "Areas/Ideas and knowledge.md", words: ["power law", "power-law", "inflation", "asset growth", "macro", "exponential", "hyperbolic", "fat tail", "network effect", "market-making", "market making", "hedg"] },
  { target: "Areas/Life admin.md", words: ["insurance", "travel", "macbook", "hardware", "doctor", "dentist", "vehicle", "passport", "flight"] },
  { target: "Areas/People and family.md", words: ["family", "father", "sister", "mother", "girlfriend", "birthday"] },
];
const TEST_MARKERS = [/zenith-\d+/i, /\bblueberry\b/i, /silver orchard/i, /\bcanary\b/i, /\bcode ?(word|phrase)\b/i, /\bsmoke[- ]test\b/i, /\btest capture\b/i,
  /\bacceptance (test|record)\b/i, /\bznmt-/i, /\bsynthetic acceptance\b/i, /the ring is alive/i, /\bbanana\b/i, /\bquick (parallel )?test\b/i, /microphone check/i,
  /during testing/i, /voice-note test/i, /capture-first production replay/i, /cobalt finch/i, /\bfake tester\b/i, /prod-tester-/i, /wakamala/i];

function receiptJson(raw) {
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(raw);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Filing outcomes of a receipt: the legacy array form, or `outcomes` of the v1 plan form. */
function receiptEntries(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.outcomes)) return json.outcomes;
  return null;
}

const BOILERPLATE = /^(I recorded the evidence|Saved, but automatic filing|Where should this memory be filed|This memory|Is this|No existing page|Evidence:|Raw artifact)/i;

/** The Log entry a receipt or stub points at: its heading words and quoted capture text. */
export function logEntry(vault, evidence) {
  if (!evidence) return { heading: "", text: "" };
  const [log, anchor] = evidence.split("#^");
  let raw = "";
  try { raw = readFileSync(join(vault, log), "utf8"); } catch { return { heading: "", text: "" }; }
  const lines = raw.split("\n");
  const start = lines.findIndex(l => l.startsWith("## ") && l.includes(`^${anchor}`));
  if (start < 0) return { heading: "", text: "" };
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  const heading = lines[start].replace(/^##\s+\d{1,2}:\d{2}\s+/, "").replace(/\s*\^e-[0-9a-f]{6}\s*$/, "").replace(/\.\.\.$/, "…");
  const text = lines.slice(start + 1, end).filter(l => l.startsWith(">")).map(l => l.replace(/^>\s?/, "")).join("\n");
  return { heading, text };
}

/** Capture text the classifier reads: receipt topics and summary (never its guessed page paths), the stub body, and the Log entry. */
function captureText(path, raw, entry = { heading: "", text: "" }) {
  const fm = splitFrontmatter(raw);
  const prose = fm.body.replace(/```json[\s\S]*?```/g, "").replace(/This plan is durable only when[^\n]*/g, "").replace(/^#.*$/gm, "");
  const parts = [entry.heading, entry.text];
  if (isReceipt(path)) {
    const json = receiptJson(raw);
    parts.unshift(json?.classification?.summary ?? "", (receiptEntries(json) ?? []).map(e => e.topic ?? "").join("\n"));
    parts.push(prose.replace(/^.*\.md\s*$/gm, ""));
  } else {
    parts.unshift(prose);
  }
  return parts.join("\n");
}

// Product names that contain another node's keyword are normalised first.
const ALIASES = [[/ingested (through|from) [^\n.]*|zenod media seam|zenod media ingestion/gi, " "], [/^(source|media type|raw artifact[^:]*|source timestamp|extraction artifact):.*$/gim, " "], [/zenod-social|social\.alpha9\.io|team\.alpha9\.io|zenot social/gi, "epic social"], [/agent_team|agent team/gi, "agent team"]];

export function classifyInbox(path, raw, entry) {
  const fm = splitFrontmatter(raw);
  const evidence = fm.has ? fmValue(fm.lines, "evidence") : undefined;
  const kind = isReceipt(path) ? "receipt" : "stub";
  const base = { path, kind, ...(evidence ? { evidence } : {}) };
  if (kind === "receipt") {
    const entries = receiptEntries(receiptJson(raw));
    if (entries && entries.length && entries.every(e => e.status === "filed")) {
      const pages = [...new Set(entries.flatMap(e => e.filedPages ?? []))];
      return { ...base, action: "archive", confidence: "high", reason: `capture already filed (${pages.length} page${pages.length === 1 ? "" : "s"}); the receipt is history` };
    }
    if (entries && entries.length && entries.every(e => e.disposition === "evidence_only")) {
      return { ...base, action: "archive", confidence: "high", reason: "the librarian kept this capture as evidence only; nothing to file" };
    }
  }
  const text = captureText(path, raw, entry);
  if (TEST_MARKERS.some(re => re.test(text))) return { ...base, action: "archive", confidence: "high", reason: "test or canary capture, not Jordi's memory" };
  if (!evidence || !/^Log\/\d{4}-\d{2}-\d{2}\.md#\^e-[0-9a-f]{6}$/.test(evidence)) {
    return { ...base, action: "archive", confidence: "medium", reason: "no usable Log evidence reference to re-file" };
  }
  const lower = ALIASES.reduce((t, [re, to]) => t.replace(re, to), text.toLowerCase());
  const scores = INBOX_RULES.map(r => ({ target: r.target, score: r.words.reduce((n, w) => n + (lower.split(w).length - 1), 0) }))
    .filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  if (!scores.length) return { ...base, action: "archive", confidence: "medium", reason: "no node matches; unsure, so Archive (the Log entry stays the evidence)" };
  const [first, second] = scores;
  const margin = first.score - (second?.score ?? 0);
  if (margin === 0) return { ...base, action: "archive", confidence: "low", suggested: first.target, reason: `tie between ${basename(first.target)} and ${basename(second.target)}; unsure, so Archive` };
  const confidence = first.score >= 2 && margin >= 2 ? "high" : "medium";
  return { ...base, action: "refile", target: first.target, confidence, reason: `unfiled capture; matches ${basename(first.target)}${second ? ` over ${basename(second.target)}` : ""}` };
}

// ---------- plan ----------

function readSeed(seedDir) {
  const out = [];
  for (const rel of listFiles(seedDir)) {
    if (!rel.endsWith(".md") || rel === "README.md") continue;
    out.push({ path: rel, content: readFileSync(join(seedDir, rel), "utf8"), source: "E9-2a seed" });
  }
  return out;
}

function hubContent(c, date) {
  return [
    "---",
    `title: ${q(c.title)}`,
    `type: ${c.type ?? "project"}`,
    "tags: []",
    `created: ${date}`,
    `updated: ${date}`,
    `summary: ${q(c.summary)}`,
    `description: ${q(c.summary)}`,
    `parent: ${q(wikilink(c.parent))}`,
    "---",
    "",
    `# ${c.title}`,
    "",
    c.summary,
    "",
    "A branch node created by the E9-2c clean-up to group the pages below it.",
    "",
  ].join("\n");
}

export function buildPlan({ vault, placements, seedDir, baseCommit }) {
  const files = listFiles(vault);
  const fileSet = new Set(files);
  const byHash = new Map(files.map(f => [hashPath(f), f]));
  const problems = [];
  const date = placements.date;

  const create = [...readSeed(seedDir)];
  for (const c of placements.create ?? []) create.push({ path: c.path, content: hubContent(c, date), source: "E9-2c branch node" });
  for (const c of create) if (fileSet.has(c.path)) problems.push(`create target already exists: ${c.path}`);

  const placed = new Set();
  const pages = [];
  for (const p of placements.pages) {
    const real = p.pathHash ? byHash.get(p.pathHash) : p.path;
    if (!real || !fileSet.has(real)) { problems.push(`placement source missing in vault: ${p.path ?? p.pathHash}`); continue; }
    if (placed.has(real)) problems.push(`placed twice: ${p.path ?? p.pathHash}`);
    placed.add(real);
    pages.push(p);
  }
  const unplaced = files.filter(f => isTreePage(f) && !placed.has(f));
  for (const f of unplaced) problems.push(`tree page has no placement: ${f.startsWith("Areas/") || f.startsWith("Notes/") || f.startsWith("Projects/") ? f : hashPath(f)}`);

  const inbox = files.filter(isInboxMachineFile).map(f => {
    const raw = readFileSync(join(vault, f), "utf8");
    const fm = splitFrontmatter(raw);
    const item = classifyInbox(f, raw, logEntry(vault, fm.has ? fmValue(fm.lines, "evidence") : undefined));
    if (item.action === "refile") {
      const [log, anchor] = item.evidence.split("#^");
      const logRaw = fileSet.has(log) ? readFileSync(join(vault, log), "utf8") : "";
      if (!new RegExp(`\\^${anchor}\\b`).test(logRaw)) return { ...item, action: "archive", confidence: "medium", target: undefined, reason: "evidence anchor not found in the Log; unsure, so Archive" };
    }
    return item;
  });

  const other = (placements.other ?? []).filter(o => {
    if (!fileSet.has(o.path)) { problems.push(`other entry missing in vault: ${o.path}`); return false; }
    return true;
  });

  return {
    plan: {
      schema: PLAN_SCHEMA,
      ticket: placements.ticket ?? "E9-2c",
      date,
      vault: { repo: "AlfaBlok/obsidian-brain", baseCommit: baseCommit ?? null },
      rules: { archiveRoot: ARCHIVE, neverWrite: NEVER_WRITE, deletes: 0 },
      create,
      pages,
      inbox,
      other,
    },
    problems,
  };
}

// ---------- apply (pure: computes the file operations) ----------

function demoteHeadings(body) {
  let fence = false;
  return body.split("\n").map(line => {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^#{1,5}\s/.test(line)) return `#${line}`;
    return line;
  }).join("\n");
}

/** One line naming the capture: the librarian's own summary or topic, else the stub text, else the Log heading. */
function gistOf(path, raw, entry) {
  const fm = splitFrontmatter(raw);
  const json = isReceipt(path) ? receiptJson(raw) : null;
  const topic = (receiptEntries(json) ?? []).map(e => e.topic ?? "").find(t => t.split(/\s+/).length > 3);
  const stubLine = isReceipt(path) ? "" : fm.body.split("\n").map(l => l.trim()).find(l => l && !l.startsWith("#") && !BOILERPLATE.test(l));
  const quote = entry.text.split("\n").map(l => l.trim()).find(l => l && !BOILERPLATE.test(l) && !/^(Screenshot\/image|Voice note|Raw artifact|Media type|Source)/.test(l));
  const candidates = [json?.classification?.summary, topic, stubLine, quote, entry.heading];
  let s = candidates.find(c => c && c.trim() && !BOILERPLATE.test(c.trim()) && !/^classification pending/i.test(c.trim())) ?? "";
  s = s.replace(/^\d{4}-\d{2}-\d{2}:\s*/, "").replace(/\[\[|\]\]/g, "").replace(/[`|*]/g, "").replace(/\s+/g, " ").trim();
  if (s.length > 140) s = `${s.slice(0, 137).replace(/\s+\S*$/, "")}…`;
  return s || "(capture without text)";
}

function gitDates(vault, path) {
  try {
    const out = execFileSync("git", ["-C", vault, "log", "--follow", "--format=%cs", "--", path], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    return out.length ? { created: out[out.length - 1], updated: out[0] } : null;
  } catch { return null; }
}

/**
 * Compute every write, rename and edit for a plan against a vault directory.
 * Returns { writes: Map<path, content>, renames: Map<from, to>, report, errors }.
 * Nothing is written here.
 */
export function computeMigration(vault, plan) {
  const errors = [];
  if (plan.schema !== PLAN_SCHEMA) errors.push(`plan schema is ${plan.schema}, expected ${PLAN_SCHEMA}`);
  const files = listFiles(vault);
  const fileSet = new Set(files);
  const byHash = new Map(files.map(f => [hashPath(f), f]));
  const date = plan.date;
  const read = (p) => readFileSync(join(vault, p), "utf8");
  const content = new Map(); // path (before) → edited content
  const get = (p) => content.get(p) ?? read(p);
  const renames = new Map();
  const creates = new Map(plan.create.map(c => [c.path, c.content]));
  const report = { created: 0, keep: 0, move: 0, merge: 0, archive: 0, refiled: 0, inboxArchived: 0, otherArchived: 0, frontmatterAdded: 0, linksRewritten: 0, logLinksAffected: [], droppedFromMerge: [] };

  for (const c of plan.create) if (fileSet.has(c.path)) errors.push(`create target already exists: ${c.path}`);

  // Resolve page entries.
  const pages = [];
  for (const p of plan.pages) {
    const real = p.pathHash ? byHash.get(p.pathHash) : p.path;
    if (!real || !fileSet.has(real)) { errors.push(`page missing in vault: ${p.path ?? p.pathHash}`); continue; }
    pages.push({ ...p, real });
  }
  const planned = new Set(pages.map(p => p.real));
  for (const f of files) if (isTreePage(f) && !planned.has(f)) errors.push(`tree page has no plan entry (re-run plan): ${p0(f)}`);

  // Final location of every page, for parent links.
  for (const p of pages) {
    if (p.action === "move") renames.set(p.real, p.target);
    if (p.action === "archive" || p.action === "merge-into") renames.set(p.real, `${ARCHIVE}/${p.real}`);
  }
  for (const o of plan.other ?? []) if (o.action === "archive") { if (fileSet.has(o.path)) renames.set(o.path, `${ARCHIVE}/${o.path}`); else errors.push(`other entry missing: ${o.path}`); }
  for (const i of plan.inbox) {
    if (!fileSet.has(i.path)) { errors.push(`inbox file missing in vault: ${i.path}`); continue; }
    renames.set(i.path, `${ARCHIVE}/${i.path}`);
  }
  const finalOf = (p) => renames.get(p) ?? p;
  const afterFiles = new Set([...files.map(finalOf), ...creates.keys()]);
  for (const [from, to] of renames) {
    assertWritable(from); assertWritable(to);
    if (fileSet.has(to) && !renames.has(to)) errors.push(`rename target already exists: ${to} (from ${p0(from)})`);
  }
  const targets = [...renames.values()];
  if (new Set(targets).size !== targets.length) errors.push("two files would land on the same path");

  const resolveBefore = makeResolver(files);
  const resolveAfterTarget = (ref) => {
    const path = ref.endsWith(".md") ? ref : `${ref}.md`;
    if (creates.has(path)) return path;
    if (fileSet.has(path)) return finalOf(path);
    return null;
  };

  // Parents and missing frontmatter.
  for (const p of pages) {
    if (p.action === "keep" || p.action === "move") {
      const parentFinal = resolveAfterTarget(p.parent);
      if (!parentFinal) { errors.push(`parent of ${p0(p.real)} does not exist after the migration: ${p.parent}`); continue; }
      if (!isTreePage(parentFinal) && !creates.has(parentFinal)) errors.push(`parent of ${p0(p.real)} is not a meaning page: ${parentFinal}`);
      const raw = get(p.real);
      const fm = splitFrontmatter(raw);
      let lines = fm.lines;
      if (!fm.has) {
        const dates = gitDates(vault, p.real) ?? { created: date, updated: date };
        const title = titleOf(raw, p.real);
        lines = [`title: ${q(title)}`, `type: ${TYPE_BY_FOLDER[top(finalOf(p.real))]}`, "tags: []", `created: ${dates.created}`, `updated: ${dates.updated}`, `summary: ${q(title)}`];
        report.frontmatterAdded++;
      }
      lines = setFmKey(lines, "parent", q(wikilink(parentFinal)));
      content.set(p.real, joinNote(lines, fm.has ? fm.body : raw));
      report[p.action]++;
    }
  }

  // Merges: append the source body to the target, mark the source, archive it.
  for (const p of pages.filter(x => x.action === "merge-into")) {
    if (!fileSet.has(p.target)) { errors.push(`merge target missing: ${p.target}`); continue; }
    if (finalOf(p.target).startsWith(`${ARCHIVE}/`)) errors.push(`merge target is itself archived: ${p.target}`);
    const src = get(p.real);
    const sfm = splitFrontmatter(src);
    const title = titleOf(src, p.real);
    let body = sfm.body.replace(/^\s*#\s+.*\n/, "").replace(/^\s+/, "").replace(/\s+$/, "");
    const dropped = sfm.has ? sfm.lines.filter(l => /^[A-Za-z_]+:/.test(l)).map(l => l.split(":")[0]).filter(k => !["title", "type", "tags", "created", "updated", "summary", "description", "timestamp"].includes(k)) : [];
    if (dropped.length) report.droppedFromMerge.push({ page: p0(p.real), keys: dropped });
    const section = `\n\n## Merged from [[${noMd(finalOf(p.real))}|${title.replace(/[|\]]/g, "")}]] (E9-2c, ${date})\n\n${demoteHeadings(body)}\n`;
    content.set(p.target, get(p.target).replace(/\s*$/, "") + section);
    const marks = setFmKey(setFmKey(sfm.lines, "merged-into", q(wikilink(finalOf(p.target)))), "archived", date);
    content.set(p.real, joinNote(marks, sfm.body));
    report.merge++;
  }

  // Archived drafts linked from the page that supersedes them.
  const draftLinks = new Map();
  for (const p of pages.filter(x => x.action === "archive")) {
    report.archive++;
    if (!p.linkFrom) continue;
    if (!fileSet.has(p.linkFrom) || finalOf(p.linkFrom).startsWith(`${ARCHIVE}/`)) { errors.push(`linkFrom page missing or archived: ${p.linkFrom}`); continue; }
    draftLinks.set(p.linkFrom, [...(draftLinks.get(p.linkFrom) ?? []), finalOf(p.real)]);
  }
  for (const [page, list] of draftLinks) {
    const lines = list.sort().map(a => `- [[${noMd(a)}|${basename(a)}]]`);
    content.set(page, `${get(page).replace(/\s*$/, "")}\n\n## Earlier drafts (archived by E9-2c, ${date})\n\n${lines.join("\n")}\n`);
  }
  report.otherArchived = (plan.other ?? []).filter(o => o.action === "archive").length;

  // Inbox: re-filed captures become one dated line on the node the migration creates.
  const refiled = new Map();
  for (const i of plan.inbox) {
    if (!fileSet.has(i.path)) continue;
    if (i.action !== "refile") { report.inboxArchived++; continue; }
    if (!creates.has(i.target)) { errors.push(`refile target ${i.target} is not a page the migration creates`); continue; }
    const [log, anchor] = i.evidence.split("#^");
    const day = basename(log);
    refiled.set(i.target, [...(refiled.get(i.target) ?? []), { day, line: `- ${day} · ${gistOf(i.path, read(i.path), logEntry(vault, i.evidence))} [[${day}#^${anchor}]]` }]);
    report.refiled++;
  }

  // Children lists on the pages the migration creates.
  const children = new Map();
  for (const p of pages) {
    if (p.action !== "keep" && p.action !== "move") continue;
    const parentFinal = resolveAfterTarget(p.parent);
    if (!parentFinal || !creates.has(parentFinal)) continue;
    children.set(parentFinal, [...(children.get(parentFinal) ?? []), finalOf(p.real)]);
  }
  for (const [path, base] of creates) {
    let text = base.replace(/\s*$/, "\n");
    if (path === "Tree.md") { creates.set(path, text); report.created++; continue; }
    const kids = (children.get(path) ?? []).sort();
    // Branch nodes created by the migration hang under another created page too.
    for (const [cp] of creates) if (cp !== path && new RegExp(`^parent: "\\[\\[${noMd(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]"`, "m").test(creates.get(cp))) kids.push(cp);
    if (kids.length) {
      const titleFor = (k) => (creates.has(k) ? titleOf(creates.get(k), k) : titleOf(get(Array.from(fileSet).find(f => finalOf(f) === k) ?? k), k)).replace(/[|\]]/g, "");
      text += `\n## In this branch\n\n${[...new Set(kids)].sort().map(k => `- [[${noMd(k)}|${titleFor(k)}]]`).join("\n")}\n`;
    }
    const caps = (refiled.get(path) ?? []).sort((a, b) => a.day.localeCompare(b.day));
    if (caps.length) text += `\n## Captures re-filed here by the clean-up (E9-2c, ${date})\n\nEach line is a capture Zenod had not filed; the Log entry is the evidence.\n\n${caps.map(c => c.line).join("\n")}\n`;
    creates.set(path, text);
    report.created++;
  }

  // Rewrite links that point at renamed files (never in Log/, _attachments/ or Archive/).
  const afterBase = new Map();
  for (const f of afterFiles) if (f.endsWith(".md")) afterBase.set(basename(f).toLowerCase(), (afterBase.get(basename(f).toLowerCase()) ?? 0) + 1);
  const afterBaseCount = (b) => afterBase.get(b.toLowerCase()) ?? 0;
  const mdRenames = new Map([...renames].filter(([f]) => f.endsWith(".md")));
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const to = finalOf(f);
    if (f.startsWith("Log/")) {
      const hits = rewriteLinks(read(f), resolveBefore, mdRenames, afterBaseCount).count;
      if (hits) report.logLinksAffected.push({ file: f, links: hits });
      continue;
    }
    if (NEVER_WRITE.some(x => f.startsWith(x)) || to.startsWith(`${ARCHIVE}/`)) continue;
    const { text, count } = rewriteLinks(get(f), resolveBefore, mdRenames, afterBaseCount);
    if (count) { content.set(f, text); report.linksRewritten += count; }
  }
  for (const [path, text] of creates) {
    const { text: t2, count } = rewriteLinks(text, resolveBefore, mdRenames, afterBaseCount);
    creates.set(path, t2); report.linksRewritten += count;
  }

  const writes = new Map();
  for (const [p, text] of content) { const to = finalOf(p); assertWritable(to); writes.set(to, text); }
  for (const [p, text] of creates) { assertWritable(p); writes.set(p, text); }
  return { writes, renames, report, errors };

  function p0(f) { return /^(Areas|Projects|Notes)\//.test(f) && !plan.pages.some(x => x.pathHash && byHash.get(x.pathHash) === f) ? f : hashPath(f); }
}

// ---------- apply (I/O) ----------

function git(cwd, args, opts = {}) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

export function applyToWorkingTree(dir, plan, { message }) {
  const { writes, renames, report, errors } = computeMigration(dir, plan);
  const text = typeof message === "function" ? message(report) : message;
  if (errors.length) return { ok: false, errors, report };
  for (const [from, to] of renames) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    renameSync(join(dir, from), join(dir, to));
  }
  for (const [path, text] of writes) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, ["add", "-A", "--", "."]);
  const staged = git(dir, ["diff", "--cached", "--name-status", "-M", "--no-renames"]).split("\n").filter(Boolean);
  const touchedLog = staged.filter(l => /\t(Log|_attachments)\//.test(l));
  const deleted = git(dir, ["diff", "--cached", "--name-status", "-M"]).split("\n").filter(l => l.startsWith("D\t"));
  if (touchedLog.length || deleted.length) {
    return { ok: false, errors: [...touchedLog.map(l => `would touch protected path: ${l}`), ...deleted.map(l => `would delete: ${l}`)], report };
  }
  const hasIdentity = spawnSync("git", ["-C", dir, "config", "user.email"]).status === 0;
  const idArgs = hasIdentity ? [] : ["-c", "user.name=Zenod E9-2c migration", "-c", "user.email=zenod-bot@users.noreply.github.com"];
  execFileSync("git", ["-C", dir, ...idArgs, "commit", "-q", "-m", text]);
  const sha = git(dir, ["rev-parse", "HEAD"]).trim();
  return { ok: true, sha, report };
}

function commitMessage(plan, planHash, report) {
  return [
    `E9-2c: move the vault into the memory tree (${plan.date})`,
    "",
    `One commit from plan ${planHash} (zenod-ai/zenod docs/epic9/E9-2c-migration/plan.json), base ${plan.vault.baseCommit ?? "?"}.`,
    `Created ${report.created} tree pages (Tree.md, roots, branch nodes); placed ${report.keep + report.move} pages (${report.move} moved), merged ${report.merge} duplicates, archived ${report.archive} superseded drafts and ${report.otherArchived} other files;`,
    `Inbox: ${report.refiled} captures re-filed as dated lines on their node, ${report.refiled + report.inboxArchived} machine files moved to Archive/Inbox/. Nothing deleted; Log/ untouched.`,
    `Frontmatter added to ${report.frontmatterAdded} pages that had none; ${report.linksRewritten} links rewritten to moved pages.`,
    "",
    "Revert: git revert <this commit>",
  ].join("\n");
}

function lintIn(dir, cmd) {
  if (!cmd) return null;
  const r = spawnSync("bash", ["-c", cmd], { env: { ...process.env, ZENOD_VAULT_PATH: dir }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---------- CLI ----------

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const USAGE = `usage:
  e9-2c-vault-tree-migration.mjs plan  --vault <clone> --placements <placements.json> --seed <seed dir> --out <plan.json> [--date YYYY-MM-DD]
  e9-2c-vault-tree-migration.mjs apply --vault <clone> --plan <plan.json> --dry-run [--diff-out <file>] [--lint "<cmd>"]...
  e9-2c-vault-tree-migration.mjs apply --vault <clone> --plan <plan.json> --branch <name> [--lint "<cmd>"]
  e9-2c-vault-tree-migration.mjs summary --plan <plan.json>

apply --dry-run applies the plan in a throwaway git worktree of the clone, writes the commit's diff,
runs each --lint command there with ZENOD_VAULT_PATH set (e.g. "zenod tree lint"), then removes the worktree.
apply --branch creates <branch> in the clone and commits the migration there as one commit; nothing is pushed.
Revert: delete the branch before merging it; after merging, \`git revert <commit>\`.`;

export function summarize(plan) {
  const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return {
    create: plan.create.length,
    pages: count(plan.pages, p => p.action),
    pageConfidence: count(plan.pages, p => p.confidence),
    inbox: count(plan.inbox, i => `${i.kind}:${i.action}`),
    inboxTargets: count(plan.inbox.filter(i => i.action === "refile"), i => basename(i.target)),
    other: count(plan.other ?? [], o => o.action),
  };
}

async function main(argv) {
  const a = args(argv);
  const cmd = a._[0];
  if (cmd === "plan") {
    if (!a.vault || !a.placements || !a.seed || !a.out) { console.error(USAGE); return 2; }
    const placements = JSON.parse(readFileSync(a.placements, "utf8"));
    if (typeof a.date === "string") placements.date = a.date;
    const baseCommit = spawnSync("git", ["-C", a.vault, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || null;
    const { plan, problems } = buildPlan({ vault: a.vault, placements, seedDir: a.seed, baseCommit });
    for (const p of problems) console.error(`problem: ${p}`);
    writeFileSync(a.out, `${JSON.stringify(plan, null, 1)}\n`);
    console.log(JSON.stringify(summarize(plan), null, 1));
    return problems.length ? 1 : 0;
  }
  if (cmd === "summary") {
    console.log(JSON.stringify(summarize(JSON.parse(readFileSync(a.plan, "utf8"))), null, 1));
    return 0;
  }
  if (cmd === "apply") {
    if (!a.vault || !a.plan || (!a["dry-run"] && !a.branch)) { console.error(USAGE); return 2; }
    const raw = readFileSync(a.plan, "utf8");
    const plan = JSON.parse(raw);
    const planHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
    if (git(a.vault, ["status", "--porcelain"]).trim()) { console.error("vault clone has uncommitted changes; apply needs a clean clone"); return 1; }
    const head = git(a.vault, ["rev-parse", "HEAD"]).trim();
    if (plan.vault.baseCommit && head !== plan.vault.baseCommit) console.error(`note: plan was built on ${plan.vault.baseCommit.slice(0, 7)}, clone is at ${head.slice(0, 7)}; every planned path is re-checked`);
    const lintCmds = argv.reduce((acc, v, i) => (v === "--lint" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
    let dir = a.vault;
    let cleanup = () => {};
    if (a["dry-run"]) {
      dir = mkdtempSync(join(tmpdir(), "e9-2c-dry-run-"));
      rmSync(dir, { recursive: true, force: true });
      git(a.vault, ["worktree", "add", "-q", "--detach", dir, "HEAD"]);
      cleanup = () => { git(a.vault, ["worktree", "remove", "--force", dir]); };
    } else {
      git(a.vault, ["checkout", "-q", "-b", a.branch]);
    }
    try {
      const before = lintCmds.map(c => ({ cmd: c, ...lintIn(dir, c) }));
      const result = applyToWorkingTree(dir, plan, { message: report => commitMessage(plan, planHash, report) });
      if (!result.ok) {
        for (const e of result.errors) console.error(`error: ${e}`);
        if (!a["dry-run"]) { git(a.vault, ["checkout", "-q", "-"]); git(a.vault, ["branch", "-q", "-D", a.branch]); }
        return 1;
      }
      const after = lintCmds.map(c => ({ cmd: c, ...lintIn(dir, c) }));
      const stat = git(dir, ["show", "-M", "--stat=200", "--format=%H%n%s", "HEAD"]);
      if (a["diff-out"]) writeFileSync(a["diff-out"], git(dir, ["show", "-M", "--format=fuller", "HEAD"]));
      console.log(JSON.stringify({ mode: a["dry-run"] ? "dry-run" : "branch", branch: a.branch ?? null, base: head, commit: result.sha, planHash, report: result.report }, null, 1));
      console.log(stat.split("\n").slice(-3).join("\n"));
      for (const l of [...before.map(x => ({ ...x, when: "before" })), ...after.map(x => ({ ...x, when: "after" }))]) {
        console.log(`--- lint ${l.when}: ${l.cmd} (exit ${l.status})\n${l.out.split("\n").filter(x => !/ExperimentalWarning|trace-warnings/.test(x)).slice(-6).join("\n")}`);
      }
      if (!a["dry-run"]) console.log(`\nRevert: before merging, \`git branch -D ${a.branch}\`; after merging, \`git revert ${result.sha}\`.`);
      return after.some(l => l.status !== 0) ? 3 : 0;
    } finally {
      cleanup();
    }
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(code => process.exit(code), err => { console.error(err.stack ?? String(err)); process.exit(1); });
}

export { main };
