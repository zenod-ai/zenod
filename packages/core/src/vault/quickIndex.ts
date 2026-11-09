import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf } from "./files.js";
import { CITATION_RE } from "./pages.js";
import { readLogCaptures, withoutOpsRollup } from "./captureOrigin.js";
import { buildTreeIndex, MAX_TREE_DEPTH, type MemoryKind } from "./tree.js";
import { pageCaptureDate } from "./treeOutline.js";

/**
 * The quick index's model-free part (EPIC-14 S28): one entry per place in the memory tree with
 * the one-line summary the tree already keeps (the page's `summary:`, else the root's Tree.md
 * line), the page's own `aliases:` a person would say, counts, when the person last added to it, and what they added
 * to this week. The host adds nicknames found in the person's own words with a small model call
 * and keeps the result; this file reads the vault only and writes nothing.
 */

/** Words of a capture kept per place for the host's nickname pass; never shown in the app. */
const CAPTURE_CHARS = 600;
const CAPTURES_PER_PLACE = 3;
export const QUICK_INDEX_WEEK_DAYS = 7;

export interface QuickIndexCapture {
  /** `YYYY-MM-DD#^e-xxxxxx`, the Log entry's key. */
  key: string;
  date: string;
  text: string;
}

export interface QuickIndexPlace {
  path: string;
  title: string;
  memory: MemoryKind;
  /** Names from the root down to this place. */
  lineage: string[];
  root: boolean;
  /** One line from the tree: the page's `summary:`, else the root's Tree.md line; "" when none. */
  summary: string;
  /** The page's own `aliases:`. */
  aliases: string[];
  /** Pages in this place's subtree, its own included. */
  pages: number;
  /** The person's own captures cited on this page (agent reports not counted). */
  memories: number;
  /** Of those, captured in the last seven days. */
  week: number;
  /** YYYY-MM-DD the person last added to this page, else its frontmatter date. */
  lastTouched: string | null;
  /** Every own capture key cited on the page, newest first. */
  captureKeys: string[];
  /** The newest few own captures, shortened, for the nickname pass. */
  captures: QuickIndexCapture[];
}

export interface QuickIndexBase {
  places: QuickIndexPlace[];
  /** First day (YYYY-MM-DD, UTC) counted as this week. */
  weekFrom: string;
}

/** Summaries are shown on one line: the first sentence, at most this long. */
const SUMMARY_CHARS = 160;
const ALIAS_CHARS = 40;

/** One line: the first sentence when it fits, else cut at a word with an ellipsis. */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_CHARS) return flat;
  const sentence = /^(.{20,}?[.!?])\s/.exec(flat)?.[1];
  if (sentence && sentence.length <= SUMMARY_CHARS) return sentence;
  return `${flat.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "")}…`;
}

/** Aliases a person would say: short, and not a file name or id left by a merge (`AC23…F414.ogg`). */
export function sayableAlias(alias: string): boolean {
  if (alias.length > ALIAS_CHARS) return false;
  if (/\.(ogg|oga|opus|m4a|mp3|mp4|wav|jpe?g|png|pdf|md)\b/i.test(alias)) return false;
  return !alias.split(/\s+/).some((word) => word.length >= 12 && /\d/.test(word) && /^[A-Za-z0-9_-]+$/.test(word));
}

function frontmatterString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function frontmatterList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(list.filter((item): item is string => typeof item === "string").map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

/** Null when the vault has no Tree.md yet. */
export async function quickIndexBase(vaultPath: string, now: number = Date.now()): Promise<QuickIndexBase | null> {
  const index = await buildTreeIndex(vaultPath);
  if (!index.tree) return null;
  const weekFrom = new Date(now - (QUICK_INDEX_WEEK_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const captures = await readLogCaptures(vaultPath);
  const isAgentCapture = (key: string) => captures.get(key)?.origin === "agent";

  const pages = new Map<string, { summary: string; aliases: string[]; keys: string[]; lastTouched: string | null }>();
  await Promise.all([...index.fields.keys()].map(async (path) => {
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
    const { frontmatter, body } = parseNote(raw);
    const keys = new Set<string>();
    for (const match of withoutOpsRollup(body).matchAll(CITATION_RE)) {
      const key = `${match[1]}#^${match[2]}`;
      if (!isAgentCapture(key)) keys.add(key);
    }
    pages.set(path, {
      summary: frontmatterString(frontmatter?.summary),
      aliases: frontmatterList(frontmatter?.aliases),
      keys: [...keys].sort().reverse(),
      lastTouched: pageCaptureDate(raw, isAgentCapture),
    });
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
      path,
      title,
      memory,
      lineage: names,
      root: root !== null,
      // The page's own summary first: a root's Tree.md line is often only counts ("1 page; 6 of your captures…").
      summary: oneLine(page?.summary || root?.summary || ""),
      aliases: (page?.aliases ?? []).filter((alias) => alias.toLowerCase() !== title.toLowerCase() && sayableAlias(alias)),
      pages: page ? 1 : 0,
      memories: page?.keys.length ?? 0,
      week: (page?.keys ?? []).filter((key) => key.slice(0, 10) >= weekFrom).length,
      lastTouched: page?.lastTouched ?? null,
      captureKeys: page?.keys ?? [],
      captures: (page?.keys ?? []).flatMap((key) => {
        const capture = captures.get(key);
        const text = capture ? `${capture.title}\n${capture.content}`.replace(/\s+/g, " ").trim().slice(0, CAPTURE_CHARS) : "";
        return text ? [{ key, date: key.slice(0, 10), text }] : [];
      }).slice(0, CAPTURES_PER_PLACE),
    };
    places.push(place);
    for (const child of index.children(path)) place.pages += visit(child, memory, names, null);
    return place.pages;
  };
  for (const node of index.tree.nodes) {
    visit(index.resolveRef(node.path) ?? node.path, node.kind, [], { name: node.name, summary: node.summary });
  }
  return { places, weekFrom };
}
