import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type Tier = "evidence" | "meaning" | "inbox" | "other";

export type MeaningType = "project" | "area" | "note";

/** Meaning folder → required frontmatter `type`. */
export const MEANING_FOLDERS: Record<string, MeaningType> = {
  Projects: "project",
  Areas: "area",
  Notes: "note",
};

const SKIP_DIRS = new Set([".git", ".obsidian", ".brain", "node_modules"]);

/** All vault-relative markdown file paths (posix separators), skipping machine dirs. */
export async function listMarkdownFiles(vaultPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(join(vaultPath, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && rel === "" && SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(relPath);
    }
  }
  await walk("");
  return out.sort();
}

/** All raw artifacts under _attachments/ (any extension), vault-relative. */
export async function listAttachmentFiles(vaultPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(join(vaultPath, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relPath = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile()) out.push(relPath);
    }
  }
  await walk("_attachments");
  return out.sort();
}

export function tierOf(relPath: string): Tier {
  const top = relPath.split("/")[0] ?? "";
  if (top === "Log" || top === "_attachments") return "evidence";
  if (top in MEANING_FOLDERS) return "meaning";
  if (top === "Inbox") return "inbox";
  return "other";
}

/** "Areas/Insurance.md" → "Insurance"; used for Obsidian-style basename link resolution. */
export function basenameOf(relPath: string): string {
  const last = relPath.split("/").at(-1) ?? relPath;
  return last.replace(/\.md$/, "");
}

export function isIndexFile(relPath: string): boolean {
  return basenameOf(relPath).endsWith("Index");
}
