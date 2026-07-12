import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Surface } from "../types.js";

export interface EvidenceEntry {
  /** "Log/YYYY-MM-DD.md" */
  logPath: string;
  /** "e-7f3a2c" */
  anchor: string;
  /** One-based line containing the evidence heading in the committed log file. */
  line: number;
  /** The exact markdown appended. */
  entry: string;
  date: string;
}

export function todayString(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function entryTitle(content: string): string {
  const firstLine = content.split("\n")[0] ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return (words.length > 60 ? `${words.slice(0, 57)}...` : words) || "Capture";
}

/** Append an immutable evidence entry to today's Log file (creating it if needed). */
export async function appendEvidence(
  vaultPath: string,
  content: string,
  source: Surface,
  verbatim: boolean,
  now = new Date(),
): Promise<EvidenceEntry> {
  const date = todayString(now);
  const logPath = `Log/${date}.md`;
  const anchor = `e-${randomBytes(3).toString("hex")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const entry = [
    `## ${time} ${entryTitle(content)}  ^${anchor}`,
    `- source: ${source}`,
    `- verbatim: ${verbatim ? "yes" : "no"}`,
    "",
    content
      .trimEnd()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "",
  ].join("\n");

  const absolute = join(vaultPath, logPath);
  let existing: string;
  try {
    existing = await readFile(absolute, "utf8");
  } catch {
    await mkdir(dirname(absolute), { recursive: true });
    existing = `# ${date}\n`;
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  const prefix = `${existing}${separator}`;
  const line = prefix.split("\n").length;
  await writeFile(absolute, `${prefix}${entry}`);

  return { logPath, anchor, line, entry, date };
}
