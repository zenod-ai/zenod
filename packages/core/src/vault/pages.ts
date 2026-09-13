import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf, isIndexFile, listMarkdownFiles, tierOf, MEANING_FOLDERS } from "./files.js";

export const SUMMARY_MAX_CHARS = 480;

export interface CatalogSection {
  id: string;
  heading: string;
  start: number;
  end: number;
  revision: string;
  scope: string;
}
export const pageRevision = (raw: string) => createHash("sha256").update(raw).digest("hex");
const scope = (text: string) => Array.from(text.replace(/\s+/g, " ").trim()).slice(0, SUMMARY_MAX_CHARS).join("");
/** Heading + occurrence identities survive edits to section prose. Offsets refer to parsed body. */
export function catalogSections(path: string, body: string): CatalogSection[] {
  const headings = [...body.matchAll(/^#{1,6} +[^\n]+/gm)];
  const starts = [...new Set([0, ...headings.map(match => match.index!)])];
  const occurrences = new Map<string, number>();
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? body.length;
    const heading = headings.find(match => match.index === start)?.[0].replace(/^#+ +/, "").trim() ?? "Introduction";
    const occurrence = occurrences.get(heading) ?? 0; occurrences.set(heading, occurrence + 1);
    const text = body.slice(start, end);
    return { id: `s-${pageRevision(`${path}#${heading}:${occurrence}`).slice(0, 20)}`, heading, start, end, revision: pageRevision(text), scope: scope(text) };
  });
}
// Deterministic parse cache only: every scan hashes current bytes, including external edits.
// No model results or cross-tenant lookup; bounded by vault count and entry count.
const catalogs = new Map<string, Map<string, { revision: string; page: PageIndexEntry }>>();
function catalogCache(vaultPath: string) {
  const tenant = resolve(vaultPath);
  const cache = catalogs.get(tenant) ?? new Map<string, { revision: string; page: PageIndexEntry }>();
  catalogs.delete(tenant); catalogs.set(tenant, cache);
  if (catalogs.size > 4) catalogs.delete(catalogs.keys().next().value!);
  return cache;
}

/** One row of the rebuildable catalog. Discovery does not authorize writes. */
export interface PageIndexEntry {
  path: string;
  id?: string;
  revision?: string;
  writable?: boolean;
  links?: string[];
  sections?: CatalogSection[];
  title: string;
  type: string;
  tags: string[];
  summary: string;
  aliases?: string[];
  /** Discovery hints only; read_facts validates their source-backed records. */
  factKeys?: string[];
}

export interface VaultSnapshot {
  /** All markdown files, vault-relative. */
  files: string[];
  /** All readable non-index meaning pages, including legacy plain Markdown. */
  pages: PageIndexEntry[];
  /** Log date (YYYY-MM-DD) → evidence block anchors present in that file. */
  anchors: Map<string, Set<string>>;
  catalogCoverage?: { unreadable: string[]; reused: number; rebuilt: number };
  /** Lowercased link targets (full path without .md, and basename) → real path. */
  linkTargets: Map<string, string>;
}

export const WIKILINK_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
export const MARKDOWN_LINK_RE = /!?\[[^\]]+\]\(([^)#][^)]+?)(?:#[^)]+)?\)/g;
export const CITATION_RE = /\[\[(\d{4}-\d{2}-\d{2})#\^(e-[0-9a-f]{6})(?:\|[^\]]*)?\]\]/g;
export const ANCHOR_RE = /\^(e-[0-9a-f]{6})\b/g;

/** Read the whole vault once: file list, frontmatter index, evidence anchors, link-resolution table. */
export async function scanVault(vaultPath: string): Promise<VaultSnapshot> {
  const files = await listMarkdownFiles(vaultPath);
  const pages: PageIndexEntry[] = [];
  const cache = catalogCache(vaultPath);
  const catalogCoverage = { unreadable: [] as string[], reused: 0, rebuilt: 0 };
  for (const cached of cache.keys()) if (!files.includes(cached)) cache.delete(cached);
  const anchors = new Map<string, Set<string>>();
  const linkTargets = new Map<string, string>();

  for (const file of files) {
    const pathKey = file.replace(/\.md$/, "").toLowerCase();
    if (!linkTargets.has(pathKey)) linkTargets.set(pathKey, file);
    const baseKey = basenameOf(file).toLowerCase();
    if (!linkTargets.has(baseKey)) linkTargets.set(baseKey, file);
  }

  for (const file of files) {
    const tier = tierOf(file);
    if (tier === "meaning" && !isIndexFile(file)) {
      let raw: string;
      try { raw = await readFile(join(vaultPath, file), "utf8"); }
      catch { catalogCoverage.unreadable.push(file); cache.delete(file); continue; }
      const revision = pageRevision(raw);
      const prior = cache.get(file);
      if (prior?.revision === revision) {
        pages.push(structuredClone(prior.page)); catalogCoverage.reused++; continue;
      }
      const { frontmatter, body } = parseNote(raw);
      const metadata = frontmatter ?? {};
      const sections = catalogSections(file, body);
      const page: PageIndexEntry = {
        path: file, id: `p-${pageRevision(file).slice(0, 20)}`, revision,
        writable: Boolean(frontmatter), sections, links: extractPageLinks(body),
        title: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title : body.match(/^# +([^\n]+)/m)?.[1]?.trim() || basenameOf(file),
        type: typeof metadata.type === "string" ? metadata.type : MEANING_FOLDERS[file.split("/")[0]!] ?? "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.filter((t): t is string => typeof t === "string") : [],
        summary: typeof metadata.summary === "string" ? metadata.summary : scope(body),
        ...(Array.isArray(metadata.memoryFacts) ? { factKeys: [...new Set(metadata.memoryFacts
          .filter((fact): fact is { key: string } => Boolean(fact && typeof fact === "object" && typeof fact.key === "string" && fact.key.length <= 160))
          .map(fact => fact.key))] } : {}),
        // Read-only aliases are discovery hints, never evidence that an alias is true.
        aliases: [...new Set([
          ...(Array.isArray(metadata.aliases) ? metadata.aliases.filter((alias): alias is string => typeof alias === "string") : []),
          ...(Array.isArray(metadata.aliasEvidence) ? metadata.aliasEvidence
            .filter((alias): alias is { name: string } => Boolean(alias && typeof alias === "object" && typeof alias.name === "string" && typeof alias.quote === "string" && typeof alias.citation === "string"))
            .map(alias => alias.name) : []),
        ])],
      };
      pages.push(page); catalogCoverage.rebuilt++;
      if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
      cache.set(file, { revision, page: structuredClone(page) });
    } else if (tier === "evidence" && /^Log\/\d{4}-\d{2}-\d{2}\.md$/.test(file)) {
      const date = basenameOf(file);
      const content = await readFile(join(vaultPath, file), "utf8");
      const set = new Set<string>();
      for (const m of content.matchAll(ANCHOR_RE)) set.add(m[1]!);
      anchors.set(date, set);
    }
  }

  return { files, pages, anchors, linkTargets, catalogCoverage };
}

/** Wikilink targets in a body, excluding evidence citations (those are checked separately). */
export function extractPageLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = m[1]!.trim();
    const anchor = m[2] ?? "";
    if (/^#\^e-[0-9a-f]{6}$/.test(anchor)) continue; // evidence citation, not a page link
    if (target.length > 0) out.push(target);
  }
  for (const m of body.matchAll(MARKDOWN_LINK_RE)) {
    if (m[0]!.startsWith("!")) continue;
    const target = normalizeMarkdownConceptTarget(m[1]!.trim());
    if (target) out.push(target);
  }
  return out;
}

function normalizeMarkdownConceptTarget(target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  if (target.startsWith("#")) return null;
  let clean = target.replace(/^\.\//, "").replace(/^\//, "");
  if (!clean.endsWith(".md")) return null;
  clean = clean.replace(/\.md$/, "");
  return clean || null;
}

export function extractCitations(body: string): Array<{ date: string; anchor: string }> {
  const out: Array<{ date: string; anchor: string }> = [];
  for (const m of body.matchAll(CITATION_RE)) {
    out.push({ date: m[1]!, anchor: m[2]! });
  }
  return out;
}
