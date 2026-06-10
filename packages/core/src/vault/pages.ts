import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf, listMarkdownFiles, tierOf } from "./files.js";

/** One row of the frontmatter index — the cheap first retrieval pass. */
export interface PageIndexEntry {
  path: string;
  title: string;
  type: string;
  tags: string[];
  summary: string;
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
    if (tier === "meaning") {
      const { frontmatter } = parseNote(await readFile(join(vaultPath, file), "utf8"));
      if (frontmatter) {
        pages.push({
          path: file,
          title: typeof frontmatter.title === "string" ? frontmatter.title : basenameOf(file),
          type: typeof frontmatter.type === "string" ? frontmatter.type : "",
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === "string") : [],
          summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
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
  return out;
}

export function extractCitations(body: string): Array<{ date: string; anchor: string }> {
  const out: Array<{ date: string; anchor: string }> = [];
  for (const m of body.matchAll(CITATION_RE)) {
    out.push({ date: m[1]!, anchor: m[2]! });
  }
  return out;
}
