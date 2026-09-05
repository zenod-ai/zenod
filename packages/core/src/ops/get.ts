import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { Note } from "../types.js";
import { parseNote } from "../vault/frontmatter.js";
import { vaultSourceRef, type VaultSourceContext } from "../vault/source.js";
import { normalizeMarkdownNotePath } from "../vault/files.js";

const MACHINE_DIRS = new Set([".git", ".brain", ".obsidian", "node_modules"]);

export class NoteNotFoundError extends Error {
  constructor(path: string) {
    super(`note not found: ${path}`);
  }
}

/** Deterministic note fetch — no LLM. Rejects paths that escape the vault. */
export async function getNote(vaultPath: string, relPath: string, location: VaultSourceContext = {}): Promise<Note> {
  const requested = normalize(relPath.replaceAll("\\", "/"));
  if (isAbsolute(requested) || requested.startsWith("..") || requested.split("/").some((part) => MACHINE_DIRS.has(part))) {
    throw new NoteNotFoundError(relPath);
  }
  const clean = normalizeMarkdownNotePath(requested);

  const root = await realpath(vaultPath);
  async function readContained(path: string): Promise<string> {
    const target = await realpath(join(root, path));
    const rel = relative(root, target);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.split("/").some((part) => MACHINE_DIRS.has(part))) throw new NoteNotFoundError(relPath);
    return readFile(target, "utf8");
  }
  let raw: string;
  let actual = clean;
  try {
    raw = await readContained(clean);
  } catch {
    const legacy = clean.replace(/\.md$/, "");
    try {
      raw = await readContained(legacy);
      actual = legacy;
    } catch {
      throw new NoteNotFoundError(relPath);
    }
  }

  const { frontmatter, body } = parseNote(raw);
  return {
    ...vaultSourceRef(location, actual),
    frontmatter: frontmatter ?? {},
    body,
  };
}
