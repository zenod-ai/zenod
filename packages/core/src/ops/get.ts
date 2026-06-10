import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { Note } from "../types.js";
import { parseNote } from "../vault/frontmatter.js";
import { githubUrl, type VaultLocation } from "../vault/github.js";

export class NoteNotFoundError extends Error {
  constructor(path: string) {
    super(`note not found: ${path}`);
  }
}

/** Deterministic note fetch — no LLM. Rejects paths that escape the vault. */
export async function getNote(vaultPath: string, relPath: string, location: VaultLocation = {}): Promise<Note> {
  const clean = normalize(relPath).replaceAll("\\", "/");
  if (isAbsolute(clean) || clean.startsWith("..")) {
    throw new NoteNotFoundError(relPath);
  }

  let raw: string;
  try {
    raw = await readFile(join(vaultPath, clean), "utf8");
  } catch {
    throw new NoteNotFoundError(relPath);
  }

  const { frontmatter, body } = parseNote(raw);
  return {
    path: clean,
    frontmatter: frontmatter ?? {},
    body,
    githubUrl: githubUrl(location, clean),
  };
}
