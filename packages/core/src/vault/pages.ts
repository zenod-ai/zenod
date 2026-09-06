import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf, isIndexFile, listMarkdownFiles, tierOf } from "./files.js";

export const SUMMARY_MAX_CHARS = 480;

/** One row of the frontmatter index — the cheap first retrieval pass. */
export interface PageIndexEntry {
  path: string;
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
  /** Frontmatter index over meaning pages that have valid-enough frontmatter. */
  pages: PageIndexEntry[];
  /** Log date (YYYY-MM-DD) → evidence block anchors present in that file. */
  anchors: Map<string, Set<string>>;
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
      const { frontmatter } = parseNote(await readFile(join(vaultPath, file), "utf8"));
      if (frontmatter) {
        pages.push({
          path: file,
          title: typeof frontmatter.title === "string" ? frontmatter.title : basenameOf(file),
          type: typeof frontmatter.type === "string" ? frontmatter.type : "",
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === "string") : [],
          summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
          ...(Array.isArray(frontmatter.memoryFacts) ? { factKeys: [...new Set(frontmatter.memoryFacts
            .filter((fact): fact is { key: string } => Boolean(fact && typeof fact === "object" && typeof fact.key === "string" && fact.key.length <= 160))
            .map(fact => fact.key))] } : {}),
          aliases: Array.isArray(frontmatter.aliasEvidence) ? frontmatter.aliasEvidence
            .filter((alias): alias is { name: string } => Boolean(alias && typeof alias === "object" && typeof alias.name === "string" && typeof alias.quote === "string" && typeof alias.citation === "string"))
            .map((alias) => alias.name) : [],
        });
      }
    } else if (tier === "evidence" && /^Log\/\d{4}-\d{2}-\d{2}\.md$/.test(file)) {
      const date = basenameOf(file);
      const content = await readFile(join(vaultPath, file), "utf8");
      const set = new Set<string>();
      for (const m of content.matchAll(ANCHOR_RE)) set.add(m[1]!);
      anchors.set(date, set);
    }
  }

  return { files, pages, anchors, linkTargets };
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
