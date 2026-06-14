import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LintError, LintReport } from "../types.js";
import { ConfigError, loadBrainConfig, type BrainConfig } from "./config.js";
import { parseNote } from "./frontmatter.js";
import { basenameOf, isIndexFile, MEANING_FOLDERS, tierOf } from "./files.js";
import { extractCitations, extractPageLinks, scanVault, type VaultSnapshot } from "./pages.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const REQUIRED_FIELDS = ["title", "type", "tags", "created", "updated", "summary"] as const;

/**
 * Deterministic vault validation — the anti-rot rules from docs/M0-SPEC.md.
 * `paths` narrows the check to specific files (the store pipeline validates
 * only what it changed); vault-wide context (anchors, link targets) is always
 * loaded so narrowed runs still resolve cross-file references.
 */
export async function lintVault(vaultPath: string, paths?: string[]): Promise<LintReport> {
  const errors: LintError[] = [];

  let config: BrainConfig | null = null;
  try {
    config = await loadBrainConfig(vaultPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      errors.push({ path: ".brain/config.yml", rule: "config", message: err.message });
    } else {
      throw err;
    }
  }

  const snapshot = await scanVault(vaultPath);
  const targets = paths ?? snapshot.files;
  let checked = 0;

  for (const file of targets) {
    if (!file.endsWith(".md")) continue;
    if (!snapshot.files.includes(file)) {
      errors.push({ path: file, rule: "missing", message: "file does not exist in the vault" });
      continue;
    }
    checked++;
    const tier = tierOf(file);
    const raw = await readFile(join(vaultPath, file), "utf8");

    if (tier === "meaning" && !isIndexFile(file)) {
      lintMeaningPage(file, raw, config, snapshot, errors);
    } else if (tier === "evidence" && file.startsWith("Log/")) {
      lintLogFile(file, raw, errors);
    }
  }

  return { ok: errors.length === 0, errors, checkedFiles: checked };
}

function lintMeaningPage(
  file: string,
  raw: string,
  config: BrainConfig | null,
  snapshot: VaultSnapshot,
  errors: LintError[],
): void {
  const { frontmatter, body } = parseNote(raw);
  const expectedType = MEANING_FOLDERS[file.split("/")[0]!];

  if (!frontmatter) {
    errors.push({ path: file, rule: "frontmatter/missing", message: "meaning page has no valid YAML frontmatter" });
    return;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in frontmatter)) {
      errors.push({ path: file, rule: "frontmatter/field", message: `missing required field: ${field}` });
    }
  }

  if ("title" in frontmatter && (typeof frontmatter.title !== "string" || frontmatter.title.trim() === "")) {
    errors.push({ path: file, rule: "frontmatter/field", message: "title must be a non-empty string" });
  }
  if ("summary" in frontmatter && (typeof frontmatter.summary !== "string" || frontmatter.summary.trim() === "")) {
    errors.push({ path: file, rule: "frontmatter/field", message: "summary must be a non-empty one-line string" });
  }
  if ("description" in frontmatter && (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "")) {
    errors.push({ path: file, rule: "frontmatter/field", message: "description must be a non-empty one-line string" });
  }
  if ("type" in frontmatter && frontmatter.type !== expectedType) {
    errors.push({
      path: file,
      rule: "frontmatter/type-folder",
      message: `type is "${String(frontmatter.type)}" but pages in ${file.split("/")[0]}/ must be "${expectedType}"`,
    });
  }
  for (const field of ["created", "updated"] as const) {
    if (field in frontmatter) {
      const value = frontmatter[field];
      const asString = value instanceof Date ? value.toISOString().slice(0, 10) : value;
      if (typeof asString !== "string" || !DATE_RE.test(asString)) {
        errors.push({ path: file, rule: "frontmatter/field", message: `${field} must be a YYYY-MM-DD date` });
      }
    }
  }
  if ("timestamp" in frontmatter) {
    const value = frontmatter.timestamp;
    const asString = value instanceof Date ? value.toISOString() : value;
    if (typeof asString !== "string" || !ISO_DATETIME_RE.test(asString)) {
      errors.push({ path: file, rule: "frontmatter/field", message: "timestamp must be an ISO 8601 datetime" });
    }
  }

  if ("tags" in frontmatter) {
    if (!Array.isArray(frontmatter.tags)) {
      errors.push({ path: file, rule: "frontmatter/field", message: "tags must be a list" });
    } else if (config) {
      const vocabulary = new Set(config.tags);
      for (const tag of frontmatter.tags) {
        if (typeof tag !== "string" || !vocabulary.has(tag)) {
          errors.push({
            path: file,
            rule: "tags/vocabulary",
            message: `tag "${String(tag)}" is not in the .brain/config.yml vocabulary`,
          });
        }
      }
    }
  }

  // No orphans: at least one wikilink resolving to another meaning page or an index note.
  const links = extractPageLinks(body);
  const resolvesToPage = links.some((target) => {
    const resolved = snapshot.linkTargets.get(target.toLowerCase());
    if (!resolved || resolved === file) return false;
    return tierOf(resolved) === "meaning" || isIndexFile(resolved) || basenameOf(resolved) === "Index";
  });
  if (!resolvesToPage) {
    errors.push({
      path: file,
      rule: "links/orphan",
      message: "page links no other meaning page or index — a note without links is a bug",
    });
  }

  // Every evidence citation must resolve to a real anchor in the cited Log file.
  for (const { date, anchor } of extractCitations(body)) {
    if (!snapshot.anchors.get(date)?.has(anchor)) {
      errors.push({
        path: file,
        rule: "citations/unresolved",
        message: `citation [[${date}#^${anchor}]] does not match any evidence anchor in Log/${date}.md`,
      });
    }
  }
}

function lintLogFile(file: string, raw: string, errors: LintError[]): void {
  const base = basenameOf(file);
  if (!DATE_RE.test(base) && !isIndexFile(file)) {
    errors.push({ path: file, rule: "log/filename", message: "Log/ files must be named YYYY-MM-DD.md" });
    return;
  }

  // Anchors are optional (human-authored entries predate Zenod) but must be unique when present.
  const seen = new Set<string>();
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i]!.matchAll(/\^(e-[0-9a-f]{6})\b/g)) {
      if (seen.has(m[1]!)) {
        errors.push({
          path: file,
          line: i + 1,
          rule: "evidence/anchor-duplicate",
          message: `duplicate evidence anchor ^${m[1]}`,
        });
      }
      seen.add(m[1]!);
    }
  }
}
