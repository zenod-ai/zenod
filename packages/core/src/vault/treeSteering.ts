import { parseNote } from "./frontmatter.js";
import { KEEPER_NOTES_HEADING, RECENT_CHANGES_HEADING, TREE_NOTE_HEADINGS } from "./tree.js";

/**
 * Steering data for the memory tree (EPIC-9 E9-5b; E9-4 design §5 "How Jordi steers").
 *
 * The person's word on their own tree lives in two places, and discovery honours both:
 *
 * - `## Keeper notes` in Tree.md: one line per note, the vault's Operating Learnings —
 *   `- K-<n> | <applies to> | <rule> | <why> | confirmed <YYYY-MM-DD>`. "Applies to" names one or
 *   more roots (comma-separated), each optionally with its stable id (`House ^n-1a2b3c4d`).
 *   Rules: `pinned`, `name: <Name>`, `aliases: a, b, c`, `keep apart`, `own root`, `closed` (E9-5e).
 * - Root page frontmatter mirrors them (`pinned: true`, `name-locked: true`, `aliases: [...]`), and a
 *   person may set those flags in Obsidian themselves.
 *
 * The keeper never overrides either (EPIC-9 L-1: roots are found bottom-up; the person's
 * steering is never undone). Notes are only ever appended; this module never rewrites one.
 */

export const PINNED_FIELD = "pinned";
export const NAME_LOCKED_FIELD = "name-locked";
export const ALIASES_FIELD = "aliases";

export type KeeperRule =
  | { kind: "pinned" }
  | { kind: "name"; name: string }
  | { kind: "aliases"; aliases: string[] }
  | { kind: "keep-apart" }
  | { kind: "own-root" }
  /** The person closed the root (E9-5e): it is held long-term until a later pin reopens it. */
  | { kind: "closed" }
  /** A rule this version does not act on: kept verbatim, never dropped. */
  | { kind: "other"; text: string };

export interface KeeperTarget {
  name: string;
  /** Stable root id, when the note recorded one. */
  id?: string;
}

export interface KeeperNote {
  /** `K-<n>`. */
  id: string;
  targets: KeeperTarget[];
  rule: KeeperRule;
  why: string;
  /** YYYY-MM-DD. */
  confirmed: string;
  /** 1-based line in Tree.md. */
  line: number;
}

export interface KeeperParseProblem {
  line: number;
  rule: string;
  message: string;
}

const NOTE_ID_RE = /^K-(\d+)$/;
const TARGET_RE = /^(.*?)(?:\s+\^([A-Za-z0-9][A-Za-z0-9-]*))?$/;
const CONFIRMED_RE = /^confirmed\s+(\d{4}-\d{2}-\d{2})$/i;
/** Characters a root name may not hold: they would break a Tree.md or Keeper-note line. */
export const UNSAFE_NAME_RE = /[|\n\r^[\]#]/;
export const MAX_ROOT_NAME = 60;

export function parseKeeperRule(text: string): KeeperRule {
  const clean = text.trim();
  if (/^pin(?:ned)?$/i.test(clean)) return { kind: "pinned" };
  if (/^keep[ -]apart$/i.test(clean)) return { kind: "keep-apart" };
  if (/^own[ -]root$/i.test(clean)) return { kind: "own-root" };
  if (/^closed?$/i.test(clean)) return { kind: "closed" };
  const name = /^name:\s*(.+)$/i.exec(clean);
  if (name) return { kind: "name", name: name[1]!.trim() };
  const aliases = /^alias(?:es)?:\s*(.+)$/i.exec(clean);
  if (aliases) return { kind: "aliases", aliases: aliases[1]!.split(/\s*,\s*/).map(a => a.trim()).filter(Boolean) };
  return { kind: "other", text: clean };
}

export function formatKeeperRule(rule: KeeperRule): string {
  switch (rule.kind) {
    case "pinned": return "pinned";
    case "keep-apart": return "keep apart";
    case "own-root": return "own root";
    case "closed": return "closed";
    case "name": return `name: ${rule.name}`;
    case "aliases": return `aliases: ${rule.aliases.join(", ")}`;
    case "other": return rule.text;
  }
}

export function formatKeeperNote(note: Omit<KeeperNote, "line">): string {
  const targets = note.targets.map(t => t.id ? `${t.name} ^${t.id}` : t.name).join(", ");
  return `- ${note.id} | ${targets} | ${formatKeeperRule(note.rule)} | ${note.why.replace(/\s*[|\n]\s*/g, " / ")} | confirmed ${note.confirmed}`;
}

/** Lines of Tree.md with their 1-based numbers (frontmatter included, so numbers match the file). */
function sectionLines(raw: string, heading: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  const { body } = parseNote(raw);
  const offset = raw.length > body.length ? raw.slice(0, raw.length - body.length).split("\n").length - 1 : 0;
  let inside = false;
  body.split("\n").forEach((text, i) => {
    const h = /^## (.+?)\s*$/.exec(text);
    if (h) { inside = h[1]!.toLowerCase() === heading.toLowerCase(); return; }
    if (inside) out.push({ text: text.replace(/\r$/, ""), line: i + 1 + offset });
  });
  return out;
}

/** The Keeper notes of a Tree.md, in file order, plus malformed `- K-` lines. */
export function parseKeeperNotes(treeRaw: string): { notes: KeeperNote[]; problems: KeeperParseProblem[] } {
  const notes: KeeperNote[] = [];
  const problems: KeeperParseProblem[] = [];
  const seen = new Map<string, number>();
  for (const { text, line } of sectionLines(treeRaw, KEEPER_NOTES_HEADING)) {
    const m = /^- (K-\S+) \| (.+)$/.exec(text);
    if (!m) {
      if (/^- K-/.test(text)) problems.push({ line, rule: "tree/keeper-note", message: "Keeper note must be `- K-<n> | applies to | rule | why | confirmed YYYY-MM-DD`" });
      continue;
    }
    const fields = m[2]!.split(" | ").map(f => f.trim());
    const confirmed = CONFIRMED_RE.exec(fields.at(-1) ?? "");
    if (!NOTE_ID_RE.test(m[1]!) || fields.length < 4 || !confirmed) {
      problems.push({ line, rule: "tree/keeper-note", message: "Keeper note must be `- K-<n> | applies to | rule | why | confirmed YYYY-MM-DD`" });
      continue;
    }
    if (seen.has(m[1]!)) {
      problems.push({ line, rule: "tree/keeper-note", message: `${m[1]} repeats line ${seen.get(m[1]!)}` });
      continue;
    }
    seen.set(m[1]!, line);
    const targets = fields[0]!.split(/\s*,\s*/).map((t): KeeperTarget => {
      const target = TARGET_RE.exec(t.trim())!;
      return { name: target[1]!.trim(), ...(target[2] ? { id: target[2] } : {}) };
    }).filter(t => t.name || t.id);
    notes.push({ id: m[1]!, targets, rule: parseKeeperRule(fields[1]!), why: fields.slice(2, -1).join(" | "), confirmed: confirmed[1]!, line });
  }
  return { notes, problems };
}

/**
 * The non-group sections of a Tree.md (Keeper notes, then Recent changes), verbatim, for a
 * re-derived Tree.md to carry over. Empty string when there are none.
 */
export function treeNoteSections(treeRaw: string): string {
  const parts: string[] = [];
  for (const heading of TREE_NOTE_HEADINGS) {
    const lines = sectionLines(treeRaw, heading).map(l => l.text);
    if (!lines.length && !new RegExp(`^## ${heading}\\s*$`, "mi").test(treeRaw)) continue;
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    parts.push([`## ${heading}`, "", ...lines].join("\n"));
  }
  return parts.join("\n\n");
}

export const KEEPER_NOTES_INTRO = "Your word on this tree, one line each: `K-<n> | applies to | rule | why | confirmed date`. Zenod never undoes a note.";

/** Append a note (next free K-<n>) to Tree.md's `## Keeper notes`, creating the section before `## Recent changes` or at the end. */
export function appendKeeperNote(treeRaw: string, note: Omit<KeeperNote, "id" | "line">): { raw: string; id: string } {
  const { notes } = parseKeeperNotes(treeRaw);
  const used = new Set<number>();
  for (const line of sectionLines(treeRaw, KEEPER_NOTES_HEADING)) {
    const m = /^- K-(\d+)\b/.exec(line.text);
    if (m) used.add(Number(m[1]));
  }
  for (const n of notes) used.add(Number(NOTE_ID_RE.exec(n.id)![1]));
  const id = `K-${used.size ? Math.max(...used) + 1 : 1}`;
  const text = formatKeeperNote({ ...note, id });
  const lines = treeRaw.replace(/\n*$/, "").split("\n");
  const headingAt = lines.findIndex(l => new RegExp(`^## ${KEEPER_NOTES_HEADING}\\s*$`, "i").test(l));
  if (headingAt >= 0) {
    let end = lines.findIndex((l, i) => i > headingAt && /^## /.test(l));
    if (end < 0) end = lines.length;
    let at = end;
    while (at > headingAt + 1 && !lines[at - 1]!.trim()) at--;
    lines.splice(at, 0, text);
  } else {
    const section = [`## ${KEEPER_NOTES_HEADING}`, "", KEEPER_NOTES_INTRO, "", text];
    const recentAt = lines.findIndex(l => new RegExp(`^## ${RECENT_CHANGES_HEADING}\\s*$`, "i").test(l));
    if (recentAt >= 0) lines.splice(recentAt, 0, ...section, "");
    else lines.push("", ...section);
  }
  return { raw: `${lines.join("\n")}\n`, id };
}

/** Alias groups the notes declare: each `aliases:` note → [its target names…, its aliases…]. */
export function keeperAliasGroups(notes: readonly KeeperNote[]): string[][] {
  return notes.filter(n => n.rule.kind === "aliases")
    .map(n => [...new Set([...n.targets.map(t => t.name).filter(Boolean), ...(n.rule as { aliases: string[] }).aliases])])
    .filter(group => group.length >= 2);
}

/** Root-page frontmatter steering flags (set by a note's mirror or by hand). */
export interface PageSteering {
  pinned: boolean;
  nameLocked: boolean;
  aliases: string[];
}

export function pageSteering(frontmatter: Record<string, unknown> | null | undefined): PageSteering {
  const aliases = frontmatter?.[ALIASES_FIELD];
  return {
    pinned: frontmatter?.[PINNED_FIELD] === true,
    nameLocked: frontmatter?.[NAME_LOCKED_FIELD] === true,
    aliases: Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === "string" && a.trim() !== "").map(a => a.trim())
      : typeof aliases === "string" && aliases.trim() ? [aliases.trim()] : [],
  };
}

/**
 * Add steering flags to a page's frontmatter, preserving every other line. Only adds: never
 * removes a flag or an alias (a flag the person set by hand stays theirs). Null when nothing changes.
 */
export function withSteeringFields(raw: string, add: { pinned?: boolean; nameLocked?: boolean; aliases?: readonly string[] }): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);
  if (!match) return null;
  const current = pageSteering(parseNote(raw).frontmatter);
  let lines = match[1]!.split("\n");
  let changed = false;
  const set = (field: string, value: string) => {
    changed = true;
    lines = lines.filter(line => !line.startsWith(`${field}:`));
    lines.push(`${field}: ${value}`);
  };
  if (add.pinned && !current.pinned) set(PINNED_FIELD, "true");
  if (add.nameLocked && !current.nameLocked) set(NAME_LOCKED_FIELD, "true");
  const known = new Set(current.aliases.map(a => a.toLowerCase()));
  const extra = (add.aliases ?? []).filter(a => a.trim() && !known.has(a.trim().toLowerCase()));
  if (extra.length) {
    changed = true;
    // Rewrite the aliases field as one flow list (block-list items of an old field are dropped with it).
    const all = [...current.aliases, ...extra.map(a => a.trim())];
    const out: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (line.startsWith(`${ALIASES_FIELD}:`)) { skipping = true; continue; }
      if (skipping && /^\s+-\s/.test(line)) continue;
      skipping = false;
      out.push(line);
    }
    lines = [...out, `${ALIASES_FIELD}: [${all.map(a => JSON.stringify(a)).join(", ")}]`];
  }
  if (!changed) return null;
  // `parent:` and `memory:` stay last, where discovery writes them, so the two writers never reorder each other.
  const tree = (line: string) => /^(?:parent|memory):/.test(line);
  lines = [...lines.filter(line => !tree(line)), ...lines.filter(tree)];
  const next = `---\n${lines.join("\n")}\n---${match[2]}${raw.slice(match[0].length)}`;
  return next === raw ? null : next;
}
