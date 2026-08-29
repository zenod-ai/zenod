import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { Note } from "../types.js";
import { parseNote } from "../vault/frontmatter.js";
import { vaultSourceRef, type VaultSourceContext } from "../vault/source.js";
import { normalizeMarkdownNotePath } from "../vault/files.js";

export class NoteNotFoundError extends Error {
  constructor(path: string) {
    super(`note not found: ${path}`);
  }
}

/** Deterministic note fetch — no LLM. Rejects paths that escape the vault. */
export async function getNote(vaultPath: string, relPath: string, location: VaultSourceContext = {}): Promise<Note> {
  const requested = normalize(relPath).replaceAll("\\", "/");
  if (isAbsolute(requested) || requested.startsWith("..")) {
    throw new NoteNotFoundError(relPath);
  }
  const clean = normalizeMarkdownNotePath(requested);

  let raw: string;
  let actual = clean;
  try {
    raw = await readFile(join(vaultPath, clean), "utf8");
  } catch {
    const legacy = clean.replace(/\.md$/, "");
    try {
      raw = await readFile(join(vaultPath, legacy), "utf8");
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
