import type { LintError } from "../types.js";

/** A pending change, before it is committed. `before` null = new file, `after` null = deletion. */
export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

function isEvidencePath(path: string): boolean {
  return path.startsWith("Log/") || path.startsWith("_attachments/");
}

/**
 * The evidence-immutability contract: no existing line under Log/ or
 * _attachments/ may ever be modified or deleted by the engine. Log files may
 * only grow by appending; attachments are write-once. Enforced as a diff
 * check before every commit — never by prompt.
 */
export function checkEvidenceImmutability(changes: FileChange[]): LintError[] {
  const errors: LintError[] = [];

  for (const change of changes) {
    if (!isEvidencePath(change.path)) continue;
    const { path, before, after } = change;

    if (before === null) continue; // new evidence is always fine

    if (after === null) {
      errors.push({ path, rule: "evidence/immutable", message: "evidence files may never be deleted" });
      continue;
    }

    if (path.startsWith("_attachments/")) {
      if (before !== after) {
        errors.push({ path, rule: "evidence/immutable", message: "attachments are write-once and may never be modified" });
      }
      continue;
    }

    // Log/: append-only. The old content must survive verbatim as a prefix.
    // Appending to a file whose last line lacks a newline must terminate that
    // line first — appending onto it would rewrite an existing line.
    const prefix = before.endsWith("\n") ? before : `${before}\n`;
    const ok = after === before || after.startsWith(prefix);
    if (!ok) {
      errors.push({
        path,
        rule: "evidence/immutable",
        message: "Log files are append-only — existing lines were modified or deleted",
      });
    }
  }

  return errors;
}
