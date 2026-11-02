import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { readLogCaptures } from "../vault/captureOrigin.js";
import { scanVault } from "../vault/pages.js";
import {
  buildTreeIndex,
  RECENT_CHANGES_HEADING,
  isTreeParentRef,
  TREE_PARENT,
  TREE_PATH,
  type MemoryKind,
  type TreeIndex,
} from "../vault/tree.js";
import { treeNoteSections } from "../vault/treeSteering.js";
import { DISCOVERY_GENERATOR, renderDiscoveredTree, withTreeFields, type DiscoveredRoot } from "./treeDiscover.js";
import { jaccard, newRootId } from "./treeIdentity.js";
import type { TrackedWrites } from "./treePlacement.js";

/**
 * The memory-keeper (EPIC-9 E9-5c; E9-4 design §5; EpicSpine `references/steward-persona.md`).
 *
 * One persona, the single writer of Tree.md, with two wakes:
 *
 * - a **daily light wake** (`keeperDailyWake`): no model, no vault write. It refreshes the tier-0
 *   index against the vault (the caller does that), counts the person's own captures that still sit
 *   on pages with no topic, and asks for an early digestion when ten or more are waiting (at most
 *   once a day);
 * - a **weekly digestion**: the E9-2d sweep's re-derivation of the roots, gated here. Discovery
 *   proposes a whole new tree; the keeper diffs it against the tree as it stood, by stable id
 *   (E9-5b), and lets through at most `budget` structural changes a week (promote, demote, new root,
 *   split, merge, reform, retire, rename). Doing nothing is the default:
 *     - promote and demote already carry heat hysteresis (0.9 / 0.3), so they may land at once;
 *     - every other change needs the same signal on two digestions in a row (design §4 rule 3):
 *       the first sighting is kept as pending in the keeper's state, beside the vault;
 *     - changes past the budget wait for next week; pages under a change that waits stay where
 *       they were.
 *   Keeper notes were applied by discovery first (pins, names, aliases, keep apart, own root), so
 *   nothing the keeper picks can override them.
 *
 * Every landed change is one line under `## Recent changes` in Tree.md, in the EpicSpine
 * recent-changes rollup shape (`- <day> · <text>`, newest first, 20 kept). A run that changes
 * nothing leaves Tree.md byte for byte as it was. Writes stay uncommitted: the caller commits the
 * whole wake as one revision and reverts on any failure.
 */

export const KEEPER_WEEKLY_BUDGET = 3;
/** The first digestion of a tree discovery never wrote (a new or hand-seeded vault). */
export const KEEPER_FIRST_BUDGET = 6;
/** Hard cap on a week's digestion model spend (E9-A6: $0.05 a week, through the AI allowance). */
export const KEEPER_WEEKLY_CAP_USD = 0.05;
/** Own captures waiting on pages with no topic that make the daily wake ask for an early digestion. */
export const KEEPER_EARLY_WAKE_BACKLOG = 10;
export const RECENT_CHANGES_KEEP = 20;
/** Jaccard overlap at which a pending change seen last week is the same change this week. */
const PENDING_MATCH = 0.5;
/** Share of a root's pages that must go one way for a merge or reform (else it is a retire). */
const MAJORITY = 0.5;

// ── Recent changes (port of the skill's `recent_changes` / `rollup_recent`; parity fixture) ──

export interface RecentNode {
  name: string;
  kind?: string;
  members?: Iterable<string>;
}

export type RecentChange =
  | { op: "added" | "retired"; id: string; name: string }
  | { op: "renamed"; id: string; name: string; from: string; to: string }
  | { op: "moved"; id: string; name: string; from: string | undefined; to: string | undefined }
  | { op: "regrouped"; id: string; name: string; gained: number; lost: number };

/** Python's default string order (code points), which the skill sorts ids by. */
function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** What changed between two derivations keyed by stable id: added, retired, renamed, moved, regrouped; each sorted by id. */
export function recentChanges(previous: Record<string, RecentNode>, current: Record<string, RecentNode>): RecentChange[] {
  const out: RecentChange[] = [];
  const ids = (o: Record<string, RecentNode>) => Object.keys(o).sort(byCodePoint);
  for (const id of ids(current)) if (!(id in previous)) out.push({ op: "added", id, name: current[id]!.name });
  for (const id of ids(previous)) if (!(id in current)) out.push({ op: "retired", id, name: previous[id]!.name });
  const both = ids(previous).filter(id => id in current);
  for (const id of both) {
    if (previous[id]!.name !== current[id]!.name) out.push({ op: "renamed", id, name: current[id]!.name, from: previous[id]!.name, to: current[id]!.name });
  }
  for (const id of both) {
    if (previous[id]!.kind !== current[id]!.kind) out.push({ op: "moved", id, name: current[id]!.name, from: previous[id]!.kind, to: current[id]!.kind });
  }
  for (const id of both) {
    const before = new Set(previous[id]!.members ?? []);
    const after = new Set(current[id]!.members ?? []);
    const gained = [...after].filter(m => !before.has(m)).length;
    const lost = [...before].filter(m => !after.has(m)).length;
    if (gained || lost) out.push({ op: "regrouped", id, name: current[id]!.name, gained, lost });
  }
  return out;
}

/** One bullet: `- 2026-11-02 · renamed House → Housing`. */
export function recentChangeLine(change: RecentChange, day: string): string {
  switch (change.op) {
    case "added": return `- ${day} · new ${change.name}`;
    case "retired": return `- ${day} · retired ${change.name}`;
    case "renamed": return `- ${day} · renamed ${change.from} → ${change.to}`;
    case "moved": return `- ${day} · moved ${change.name}: ${change.from} → ${change.to}`;
    case "regrouped": return `- ${day} · regrouped ${change.name} (+${change.gained} −${change.lost})`;
  }
}

/** The section's bullets after one run: this run's lines first, then the older ones, at most `keep`. */
export function rollupRecent(existing: readonly string[], lines: readonly string[], keep = RECENT_CHANGES_KEEP): string[] {
  return [...lines, ...existing.filter(line => line.trim())].slice(0, keep);
}

/** The bullets under `## Recent changes` in a Tree.md. */
export function recentChangeLines(treeRaw: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of parseNote(treeRaw).body.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) { inside = h[1]!.toLowerCase() === RECENT_CHANGES_HEADING.toLowerCase(); continue; }
    if (inside && /^- /.test(line)) out.push(line.replace(/\r$/, ""));
  }
  return out;
}

export const RECENT_CHANGES_INTRO = "What the memory keeper changed in this tree, newest first. Say \"that's wrong\" about any line and it is undone.";

/** Tree.md's note sections with `## Recent changes` holding `lines` (Keeper notes stay verbatim, first). */
export function withRecentChanges(treeRaw: string, lines: readonly string[]): string {
  const sections = treeNoteSections(treeRaw);
  const kept = (sections ? sections.split(/\n\n(?=## )/) : []).filter(part => !part.toLowerCase().startsWith(`## ${RECENT_CHANGES_HEADING.toLowerCase()}`));
  return [...kept, [`## ${RECENT_CHANGES_HEADING}`, "", RECENT_CHANGES_INTRO, "", ...lines].join("\n")].join("\n\n");
}

// ── The tree as it stands, keyed by id ──

export interface KeeperRoot {
  id: string;
  name: string;
  kind: MemoryKind;
  /** Root page (resolved vault path). */
  path: string;
  summary: string;
  /** Tree pages under the root, root page included, sorted. */
  members: string[];
}

export interface KeeperPage {
  /** `parent:` as written, or undefined. */
  parent: string | undefined;
  /** Id of the root the page hangs under, or null when it hangs under none. */
  root: string | null;
}

export interface KeeperTreeState {
  generated: boolean;
  roots: KeeperRoot[];
  /** Tree.md roots whose page has left the vault (the person moved or removed it): dropped, and logged. */
  missing: KeeperRoot[];
  pages: Map<string, KeeperPage>;
}

/** Roots with ids (a root written before ids existed gets the id its members would get, as discovery does) and every page's root. */
export function treeStateOf(index: TreeIndex, generated: boolean): KeeperTreeState {
  const membersOf = new Map<string, string[]>();
  for (const path of index.fields.keys()) {
    const lineage = index.lineage(path);
    if (!lineage.ok) continue;
    const rootPath = index.resolveRef(lineage.root.path) ?? lineage.root.path;
    membersOf.set(rootPath, [...(membersOf.get(rootPath) ?? []), path]);
  }
  const roots: KeeperRoot[] = [];
  const used = new Set<string>();
  const missing: KeeperRoot[] = [];
  for (const node of index.tree?.nodes ?? []) {
    const path = index.resolveRef(node.path) ?? node.path;
    if (!index.fields.has(path)) {
      if (node.id && !used.has(node.id)) { used.add(node.id); missing.push({ id: node.id, name: node.name, kind: node.kind, path, summary: node.summary, members: [] }); }
      continue;
    }
    if (roots.some(r => r.path === path)) continue;
    const members = (membersOf.get(path) ?? [path]).sort();
    let id = node.id && !used.has(node.id) ? node.id : newRootId(members);
    for (let n = 2; used.has(id); n++) id = `${newRootId(members)}-${n}`;
    used.add(id);
    roots.push({ id, name: node.name, kind: node.kind, path, summary: node.summary, members });
  }
  const rootOfPath = new Map(roots.map(r => [r.path, r.id]));
  const pages = new Map<string, KeeperPage>();
  for (const [path, f] of index.fields) {
    const lineage = index.lineage(path);
    const root = lineage.ok ? rootOfPath.get(index.resolveRef(lineage.root.path) ?? lineage.root.path) ?? null : null;
    pages.set(path, { parent: f.parent, root });
  }
  return { generated, roots, missing, pages };
}

export async function readKeeperTreeState(vaultPath: string): Promise<KeeperTreeState | null> {
  const raw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => null);
  if (raw === null) return null;
  const index = await buildTreeIndex(vaultPath);
  return treeStateOf(index, parseNote(raw).frontmatter?.generated === DISCOVERY_GENERATOR);
}

// ── Changes ──

export type KeeperChangeKind = "promote" | "demote" | "new" | "split" | "merge" | "reform" | "retire" | "rename";

export interface KeeperChange {
  kind: KeeperChangeKind;
  /** Stable key across runs for the id-based kinds; member-based kinds match on `members`. */
  key: string;
  /** Old ids this change retires. */
  retire: string[];
  /** New ids this change adds. */
  add: string[];
  /** Persisting id this change touches (rename, promote, demote; the receiving root of a merge or split). */
  persist: string | null;
  /** Pages of the root this change creates (member-matched kinds). */
  members: string[];
  /** Plain words for logs: `merge Travel into Family`. Root names only. */
  label: string;
  /** Needs the same signal on the previous digestion before it lands. */
  needsConfirm: boolean;
  /** The person's own word (a close, pin, name or own-root note) makes this change: it lands at once, outside the budget. */
  steered?: boolean;
  /** Bigger first among equals. */
  weight: number;
}

/**
 * Identity follows the name the person sees (keeper rule on top of the shared Jaccard match): a
 * proposed root with a new id but the same name as a root that is leaving (its page left the vault,
 * or most of its pages went into this root) keeps that root's id. A root that grew past the Jaccard
 * threshold in a week is still the same root to the person. Mutates `proposed`; returns how many ids it carried.
 */
export function carryIds(before: KeeperTreeState, proposed: KeeperTreeState): number {
  const proposedIds = new Set(proposed.roots.map(r => r.id));
  const leaving = [...before.missing, ...before.roots.filter(r => !proposedIds.has(r.id))];
  const remap = new Map<string, string>();
  for (const root of proposed.roots) {
    if (before.roots.some(r => r.id === root.id)) continue;
    const name = root.name.toLowerCase();
    const old = leaving.find(r => r.name.toLowerCase() === name && ![...remap.values()].includes(r.id));
    if (!old) continue;
    if (old.members.length) {
      const into = old.members.filter(m => proposed.pages.get(m)?.root === root.id).length;
      if (into < MAJORITY * old.members.length) continue;
    }
    remap.set(root.id, old.id);
  }
  for (const root of proposed.roots) root.id = remap.get(root.id) ?? root.id;
  for (const page of proposed.pages.values()) if (page.root) page.root = remap.get(page.root) ?? page.root;
  return remap.size;
}

const ORDER: Record<KeeperChangeKind, number> = { promote: 0, new: 1, reform: 2, split: 3, merge: 4, demote: 5, retire: 6, rename: 7 };

/** Steering discovery applied to a proposed root, keyed by its page (E9-5b/E9-5e Keeper notes). */
export interface RootSteer {
  pinned?: boolean;
  nameLocked?: boolean;
  closed?: boolean;
  ownRoot?: boolean;
}

/** Every structural change between the tree as it stood and discovery's proposal, one unit per change. */
export function classifyChanges(before: KeeperTreeState, proposed: KeeperTreeState, fresh = false, steer: ReadonlyMap<string, RootSteer> = new Map()): KeeperChange[] {
  const oldById = new Map(before.roots.map(r => [r.id, r]));
  const newById = new Map(proposed.roots.map(r => [r.id, r]));
  const out: KeeperChange[] = [];
  const pairedRetire = new Set<string>();
  // Where an old root's pages went: new root id → count.
  const flow = (oldId: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const page of oldById.get(oldId)!.members) {
      const to = proposed.pages.get(page)?.root;
      if (to) counts.set(to, (counts.get(to) ?? 0) + 1);
    }
    return counts;
  };
  // Where a new root's pages came from: old root id → count.
  const source = (newId: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const page of newById.get(newId)!.members) {
      const from = before.pages.get(page)?.root;
      if (from) counts.set(from, (counts.get(from) ?? 0) + 1);
    }
    return counts;
  };
  const top = (counts: Map<string, number>): [string, number] | null =>
    [...counts].sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]))[0] ?? null;

  for (const root of [...newById.values()].filter(r => !oldById.has(r.id)).sort((a, b) => byCodePoint(a.id, b.id))) {
    const from = top(source(root.id));
    const origin = from ? oldById.get(from[0])! : null;
    if (origin && !newById.has(origin.id) && !pairedRetire.has(origin.id) && from![1] >= MAJORITY * origin.members.length) {
      pairedRetire.add(origin.id);
      out.push({ kind: "reform", key: `reform:${origin.id}`, retire: [origin.id], add: [root.id], persist: null, members: root.members,
        label: origin.name === root.name ? `reform ${root.name}` : `reform ${origin.name} as ${root.name}`, needsConfirm: !fresh, weight: root.members.length });
    } else if (origin && newById.has(origin.id)) {
      out.push({ kind: "split", key: `split:${origin.id}`, retire: [], add: [root.id], persist: origin.id, members: root.members,
        label: `split ${root.name} out of ${origin.name}`, needsConfirm: !fresh, weight: root.members.length });
    } else {
      // A root whose page left the vault, found again under its name: re-homed without waiting a week.
      const rehomed = before.missing.some(m => m.id === root.id);
      out.push({ kind: "new", key: rehomed ? `rehome:${root.id}` : "new", retire: [], add: [root.id], persist: null, members: root.members,
        label: `new ${root.name}`, needsConfirm: !fresh && !rehomed, weight: root.members.length });
    }
  }
  for (const root of [...oldById.values()].filter(r => !newById.has(r.id) && !pairedRetire.has(r.id)).sort((a, b) => byCodePoint(a.id, b.id))) {
    const to = top(flow(root.id));
    const into = to && newById.has(to[0]) && oldById.has(to[0]) && to[1] >= MAJORITY * root.members.length ? newById.get(to[0])! : null;
    out.push(into
      ? { kind: "merge", key: `merge:${root.id}>${into.id}`, retire: [root.id], add: [], persist: into.id, members: [], label: `merge ${root.name} into ${oldById.get(into.id)!.name}`, needsConfirm: !fresh, weight: root.members.length }
      : { kind: "retire", key: `retire:${root.id}`, retire: [root.id], add: [], persist: null, members: [], label: `retire ${root.name}`, needsConfirm: !fresh, weight: root.members.length });
  }
  for (const root of proposed.roots) {
    const old = oldById.get(root.id);
    if (!old) continue;
    if (old.kind !== root.kind) {
      const kind = root.kind === "working" ? "promote" : "demote";
      out.push({ kind, key: `${kind}:${root.id}`, retire: [], add: [], persist: root.id, members: [], label: `move ${old.name} to ${root.kind}`, needsConfirm: false, weight: root.members.length });
    }
    if (old.name !== root.name) {
      out.push({ kind: "rename", key: `rename:${root.id}>${root.name.toLowerCase()}`, retire: [], add: [], persist: root.id, members: [], label: `rename ${old.name} to ${root.name}`, needsConfirm: !fresh, weight: root.members.length });
    }
  }
  // The person's word: a closed root goes long-term, a pinned one comes back, a named one takes its name,
  // an own root (or a closed one) stands alone. Those land at once (never wait, never spend the budget).
  for (const change of out) {
    const root = (id: string | null) => proposedRootPath(id);
    const s = (id: string | null) => { const path = root(id); return path ? steer.get(path) : undefined; };
    const target = s(change.persist);
    const added = change.add.map(id => s(id));
    change.steered = (change.kind === "demote" && target?.closed === true)
      || (change.kind === "promote" && target?.pinned === true)
      || (change.kind === "rename" && target?.nameLocked === true)
      || ((change.kind === "new" || change.kind === "split" || change.kind === "reform") && added.some(a => a?.ownRoot === true || a?.closed === true));
    if (change.steered) change.needsConfirm = false;
  }
  function proposedRootPath(id: string | null): string | null {
    return id ? newById.get(id)?.path ?? null : null;
  }
  return out.sort((a, b) => Number(Boolean(b.steered)) - Number(Boolean(a.steered)) || ORDER[a.kind] - ORDER[b.kind] || b.weight - a.weight || byCodePoint(a.key, b.key));
}

// ── Keeper state (beside the vault, never in it) ──

export interface PendingChange {
  kind: KeeperChangeKind;
  key: string;
  members?: string[];
  firstSeen: string;
}

export interface KeeperRunRecord {
  day: string;
  mode: "weekly" | "early";
  /** Structural changes applied. */
  changes: number;
  /** Changes seen but waiting (unconfirmed or over budget). */
  waiting: number;
  roots: number;
  /** Roots of the tree before this run that kept their id and name. */
  stable: number;
  costUsd: number;
}

export interface KeeperState {
  version: 1;
  /** Week key (`YYYY-MM-DD`, the Sunday) → structural changes applied that week. */
  week: { key: string; changes: number } | null;
  pending: PendingChange[];
  lastDigestion: string | null;
  lastDailyWake: string | null;
  lastEarlyWake: string | null;
  runs: KeeperRunRecord[];
  /** Changes the person undid ("that's wrong"): not proposed again until 8 weeks after `since`. */
  refused: Array<{ label: string; since: string }>;
}

export const emptyKeeperState = (): KeeperState => ({ version: 1, week: null, pending: [], lastDigestion: null, lastDailyWake: null, lastEarlyWake: null, runs: [], refused: [] });

/** How long a change the person undid stays off the table (E9-4 §5: "not proposed again for 8 weeks"). */
export const REFUSED_DAYS = 56;

/** The change labels of a keeper digestion commit subject: `memory: keeper (weekly digestion, 2 changes: a; b; re-filed …)` → [a, b]. */
export function keeperCommitLabels(subject: string): string[] {
  const m = /keeper \((?:weekly|early) digestion, \d+ changes?: (.*?); re-filed /.exec(subject);
  return m ? m[1]!.split("; ").map(l => l.trim()).filter(Boolean) : [];
}

/**
 * The refused list after reading the vault's recent commits (newest first): a keeper digestion the
 * person undid (`memory: undo <sha> (keeper (…))`, E9-5e) refuses its changes from `today`; a redo
 * (`memory: redo …`) of it lifts that; entries older than 8 weeks drop.
 */
export function refusedChanges(state: Pick<KeeperState, "refused">, subjects: readonly string[], today: string): KeeperState["refused"] {
  const out = new Map(state.refused.filter(r => daysBetweenDays(r.since, today) < REFUSED_DAYS).map(r => [r.label, r]));
  const seen = new Set<string>();
  for (const subject of subjects) {
    const m = /^memory: (undo|redo) [0-9a-f]+ \((.+)\)$/.exec(subject);
    if (!m) continue;
    for (const label of keeperCommitLabels(m[2]!)) {
      if (seen.has(label)) continue; // the newest undo/redo of a change decides
      seen.add(label);
      if (m[1] === "undo") { if (!out.has(label)) out.set(label, { label, since: today }); } else out.delete(label);
    }
  }
  return [...out.values()];
}

function daysBetweenDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export async function loadKeeperState(path: string | undefined): Promise<KeeperState> {
  if (!path) return emptyKeeperState();
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return emptyKeeperState();
  try {
    const value = JSON.parse(raw) as Partial<KeeperState>;
    return { ...emptyKeeperState(), ...value, version: 1, pending: Array.isArray(value.pending) ? value.pending : [], runs: Array.isArray(value.runs) ? value.runs.slice(-26) : [], refused: Array.isArray(value.refused) ? value.refused : [] };
  } catch {
    return emptyKeeperState();
  }
}

export async function saveKeeperState(path: string | undefined, state: KeeperState): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ ...state, runs: state.runs.slice(-26) }, null, 2)}\n`);
  await rename(tmp, path);
}

/** The Sunday (UTC) that starts `day`'s week: the keeper's budget window. */
export function keeperWeekKey(day: string): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return new Date(ms - new Date(ms).getUTCDay() * 86_400_000).toISOString().slice(0, 10);
}

function seenBefore(change: KeeperChange, pending: readonly PendingChange[]): boolean {
  return pending.some(p => p.kind === change.kind && (change.members.length && p.members?.length
    ? (change.kind === "new" || p.key === change.key) && jaccard(p.members, change.members) >= PENDING_MATCH
    : p.key === change.key));
}

export interface KeeperSelection {
  budget: number;
  applied: KeeperChange[];
  /** First sightings: they land next digestion if seen again. */
  unconfirmed: KeeperChange[];
  /** Confirmed, but past the week's budget or clashing with what landed. */
  overBudget: KeeperChange[];
  /** Changes the person undid in the last 8 weeks: not proposed again. */
  refused: KeeperChange[];
}

/**
 * Pick what lands. The person's own word (steered changes) lands first and spends no budget. Then
 * confirmed changes in order (promote, new, reform, split, merge, demote, retire, rename; bigger first)
 * until the week's budget is spent. A change the person undid stays off the table. Changes touching the
 * same root as one already picked wait, so each landed change stands on its own.
 */
export function selectChanges(changes: readonly KeeperChange[], pending: readonly PendingChange[], budget: number, refused: ReadonlySet<string> = new Set()): KeeperSelection {
  const applied: KeeperChange[] = [];
  const unconfirmed: KeeperChange[] = [];
  const overBudget: KeeperChange[] = [];
  const refusedOut: KeeperChange[] = [];
  const touched = new Set<string>();
  let spent = 0;
  const ordered = [...changes.filter(c => c.steered), ...changes.filter(c => !c.steered)];
  for (const change of ordered) {
    if (!change.steered && refused.has(change.label)) { refusedOut.push(change); continue; }
    if (change.needsConfirm && !seenBefore(change, pending)) { unconfirmed.push(change); continue; }
    const ids = [...change.retire, ...change.add, ...(change.persist && change.kind !== "split" && change.kind !== "merge" ? [change.persist] : [])];
    if ((!change.steered && spent >= budget) || ids.some(id => touched.has(id))) { overBudget.push(change); continue; }
    applied.push(change);
    if (!change.steered) spent++;
    for (const id of ids) touched.add(id);
  }
  return { budget, applied, unconfirmed, overBudget, refused: refusedOut };
}

// ── Applying a selection ──

export interface KeeperApplyResult {
  roots: KeeperRoot[];
  recent: RecentChange[];
  changedPaths: string[];
}

/**
 * Write the tree the selection allows: Tree.md with the final roots (old order kept, new roots at the
 * end of their group) and every page's `parent:`/`memory:`. Pages under a change that waits keep the
 * parent they had before; pages with nowhere left to go hang under the final root that holds most of
 * their proposed root's pages.
 */
export async function applyKeeperSelection(
  vaultPath: string,
  input: { before: KeeperTreeState; proposed: KeeperTreeState; proposedRoots: readonly DiscoveredRoot[]; selection: KeeperSelection; today: string; treeRawBefore: string },
  writes: TrackedWrites,
): Promise<KeeperApplyResult> {
  const { before, proposed, selection } = input;
  const proposedById = new Map(proposed.roots.map(r => [r.id, r]));
  const final = new Map<string, KeeperRoot>(before.roots.map(r => [r.id, { ...r }]));
  for (const change of selection.applied) {
    for (const id of change.retire) final.delete(id);
    for (const id of change.add) final.set(id, { ...proposedById.get(id)! });
    if (change.persist && final.has(change.persist)) {
      const root = final.get(change.persist)!;
      const next = proposedById.get(change.persist)!;
      if (change.kind === "promote" || change.kind === "demote") root.kind = next.kind;
      if (change.kind === "rename") root.name = next.name;
    }
  }
  // A persisting root follows discovery's choice of page (identity drift, not a change), unless
  // another root still holds that page; then both keep the page they had (the old tree was valid).
  const oldById = new Map(before.roots.map(r => [r.id, r]));
  for (const root of final.values()) {
    const next = proposedById.get(root.id);
    if (next && oldById.has(root.id)) root.path = next.path;
  }
  for (let pass = 0; pass < 4; pass++) {
    let fixed = 0;
    const byPath = new Map<string, KeeperRoot[]>();
    for (const root of final.values()) byPath.set(root.path, [...(byPath.get(root.path) ?? []), root]);
    for (const roots of byPath.values()) {
      if (roots.length < 2) continue;
      for (const root of roots) {
        const old = oldById.get(root.id);
        if (old && root.path !== old.path) { root.path = old.path; fixed++; }
      }
    }
    if (!fixed) break;
  }
  // Two roots may not share a name either: a rename that would clash waits (the old name stays).
  for (const root of final.values()) {
    const old = oldById.get(root.id);
    if (old && root.name !== old.name && [...final.values()].some(other => other !== root && other.name.toLowerCase() === root.name.toLowerCase())) root.name = old.name;
  }
  // A new root that still clashes on page or name with a kept root waits (its change is undone).
  const seenPath = new Set<string>();
  const seenName = new Set<string>();
  for (const root of [...final.values()].sort((a, b) => Number(oldById.has(b.id)) - Number(oldById.has(a.id)))) {
    if (seenPath.has(root.path) || seenName.has(root.name.toLowerCase())) { final.delete(root.id); continue; }
    seenPath.add(root.path);
    seenName.add(root.name.toLowerCase());
  }

  const finalIds = new Set(final.keys());
  const proposedIds = new Set(proposed.roots.map(r => r.id));
  const rootPageOf = new Map([...final.values()].map(r => [r.path, r]));
  const index = await buildTreeIndex(vaultPath);
  const parentRefOf = (path: string) => `[[${path.replace(/\.md$/, "")}]]`;

  // Fallback home for pages whose proposed root waits and whose old root is gone.
  const fallbackFor = (proposedRoot: string | null): KeeperRoot | null => {
    const members = new Set(proposedRoot ? proposedById.get(proposedRoot)?.members ?? [] : []);
    let best: KeeperRoot | null = null;
    let bestScore = -1;
    for (const root of final.values()) {
      const score = root.members.filter(m => members.has(m)).length;
      if (score > bestScore || (score === bestScore && best && root.members.length > best.members.length)) { best = root; bestScore = score; }
    }
    return best;
  };

  const parentOf = new Map<string, string>();
  const rootOf = new Map<string, string>();
  for (const [path, now] of proposed.pages) {
    const root = rootPageOf.get(path);
    if (root) { parentOf.set(path, TREE_PARENT); rootOf.set(path, root.id); continue; }
    const n = now.root;
    const o = before.pages.get(path)?.root ?? null;
    const oldParent = before.pages.get(path)?.parent;
    // A page discovery made a root that is not a root here hangs under its final root instead.
    const proposedParent = now.parent && !isTreeParentRef(now.parent) ? now.parent : null;
    if (n && finalIds.has(n) && (!o || !finalIds.has(o) || proposedIds.has(o) || o === n)) {
      parentOf.set(path, proposedParent ?? parentRefOf(final.get(n)!.path));
      rootOf.set(path, n);
    } else if (o && finalIds.has(o) && oldParent && !isTreeParentRef(oldParent)) {
      parentOf.set(path, oldParent);
      rootOf.set(path, o);
    } else {
      const home = (o ? final.get(o) : undefined) ?? fallbackFor(n);
      if (!home) continue;
      parentOf.set(path, parentRefOf(home.path));
      rootOf.set(path, home.id);
    }
  }
  // Mixed old and new edges can loop or dangle: such a page hangs straight under its root page.
  const resolve = (ref: string) => index.resolveRef(ref);
  for (let pass = 0; pass < 3; pass++) {
    let fixed = 0;
    for (const [path, ref] of parentOf) {
      if (rootPageOf.has(path)) continue;
      const seen = new Set<string>([path]);
      let current = resolve(ref);
      let ok = false;
      for (let depth = 0; current && !isTreeParentRef(ref) && depth < 12; depth++) {
        if (seen.has(current)) break;
        if (parentOf.get(current) === TREE_PARENT) { ok = rootPageOf.has(current); break; }
        seen.add(current);
        const next = parentOf.get(current);
        if (!next) break;
        current = resolve(next);
      }
      if (ok) continue;
      const home = final.get(rootOf.get(path) ?? "") ?? fallbackFor(rootOf.get(path) ?? null);
      if (!home || home.path === path) continue;
      parentOf.set(path, parentRefOf(home.path));
      rootOf.set(path, home.id);
      fixed++;
    }
    if (!fixed) break;
  }
  // Final members and each page's group follow the final lineage.
  const finalRootOf = (path: string): string | null => {
    const seen = new Set<string>();
    let current: string | null = path;
    while (current && !seen.has(current)) {
      seen.add(current);
      const root = rootPageOf.get(current);
      if (root && parentOf.get(current) === TREE_PARENT) return root.id;
      const ref = parentOf.get(current);
      current = ref && ref !== TREE_PARENT ? resolve(ref) : null;
    }
    return null;
  };
  const members = new Map<string, string[]>([...final.keys()].map(id => [id, []]));
  const changedPaths: string[] = [];
  for (const [path, assigned] of [...parentOf].sort(([a], [b]) => a.localeCompare(b))) {
    let ref = assigned;
    let rootId = finalRootOf(path);
    if (!rootId) {
      // Last resort: straight under the final root that holds most of its proposed root's pages.
      const home = fallbackFor(rootOf.get(path) ?? null);
      if (!home || home.path === path) continue;
      ref = parentRefOf(home.path);
      parentOf.set(path, ref);
      rootId = home.id;
    }
    members.get(rootId)!.push(path);
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
    if (raw === null) continue;
    // A page with no frontmatter is left as it is, as discovery leaves it.
    const next = withTreeFields(raw, ref, final.get(rootId)!.kind, rootPageOf.has(path));
    if (next !== null) { await writes.write(path, next); changedPaths.push(path); }
  }
  for (const [id, list] of members) final.get(id)!.members = list.sort();

  // Tree.md: old roots in their old order, new roots after them in each group, as discovery would order them.
  const order = [...before.roots.map(r => r.id), ...proposed.roots.map(r => r.id)];
  const roots = [...final.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const steered = new Map(input.proposedRoots.map(r => [r.id, r]));
  for (const root of roots) if (!root.summary) root.summary = steered.get(root.id)?.summary ?? "";

  const toRecent = (list: readonly KeeperRoot[]) => Object.fromEntries(list.map(r => [r.id, { name: r.name, kind: r.kind, members: r.members }]));
  // Membership drift (pages filed into a root) is not a structural change: only landed changes are logged.
  const recent = recentChanges(toRecent([...before.roots, ...before.missing]), toRecent(roots)).filter(c => c.op !== "regrouped"
    || selection.applied.some(a => (a.kind === "merge" || a.kind === "split") && a.persist === c.id));
  const lines = recent.map(c => recentChangeLine(c, input.today));
  const existing = recentChangeLines(input.treeRawBefore);
  const sections = lines.length ? withRecentChanges(input.treeRawBefore, rollupRecent(existing, lines)) : treeNoteSections(input.treeRawBefore);
  const treeFile = renderDiscoveredTree(roots.map(r => ({ name: r.name, kind: r.kind, path: r.path, summary: r.summary, id: r.id })), input.today, sections);
  const current = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => "");
  const strip = (s: string) => s.replace(/^updated: .*$/m, "");
  if (strip(input.treeRawBefore) === strip(treeFile)) {
    if (current !== input.treeRawBefore) { await writes.write(TREE_PATH, input.treeRawBefore); changedPaths.push(TREE_PATH); }
  } else if (strip(current) !== strip(treeFile)) {
    await writes.write(TREE_PATH, treeFile);
    changedPaths.push(TREE_PATH);
  } else if (current !== treeFile) {
    await writes.write(TREE_PATH, treeFile);
    changedPaths.push(TREE_PATH);
  }
  return { roots, recent, changedPaths };
}

// ── Daily light wake ──

export interface KeeperDailyReport {
  day: string;
  /** Own captures since the last digestion. */
  ownCapturesSinceDigestion: number;
  /** Of those, how many sit only on provisional leaves or on no page (no topic yet). */
  waitingForTopic: number;
  /** True when the backlog asks for an early digestion today. */
  earlyDigestion: boolean;
  modelCalls: 0;
}

/**
 * The $0 daily wake's vault read: own captures since the last digestion, and how many of them sit on
 * pages with no topic (provisional leaves) or on no page. No model, no write.
 */
export async function keeperDailyWake(vaultPath: string, state: KeeperState, day: string): Promise<KeeperDailyReport> {
  const snapshot = await scanVault(vaultPath);
  const index = await buildTreeIndex(vaultPath, snapshot);
  const captures = await readLogCaptures(vaultPath, snapshot.files);
  const since = state.lastDigestion ?? "0000-00-00";
  const own = [...captures.values()].filter(c => c.origin === "user" && c.date > since && c.date <= day);
  const cited = new Map<string, string[]>();
  const CITE = /\[\[(\d{4}-\d{2}-\d{2})#\^(e-[0-9a-f]+)/g;
  for (const path of index.fields.keys()) {
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
    for (const m of raw.matchAll(CITE)) {
      const key = `${m[1]}#^${m[2]}`;
      cited.set(key, [...(cited.get(key) ?? []), path]);
    }
  }
  const waiting = own.filter(c => (cited.get(c.key) ?? []).every(page => index.fields.get(page)?.provisional === true)).length;
  const earlyDigestion = waiting >= KEEPER_EARLY_WAKE_BACKLOG && state.lastEarlyWake !== day && state.lastDigestion !== day;
  return { day, ownCapturesSinceDigestion: own.length, waitingForTopic: waiting, earlyDigestion, modelCalls: 0 };
}
