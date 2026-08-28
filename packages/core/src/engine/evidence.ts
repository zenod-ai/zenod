import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryContentType, MemoryEntry, MemoryEntryQuery, Surface } from "../types.js";
import type { VaultLocation } from "../vault/github.js";
import { githubUrl } from "../vault/github.js";
import { listMarkdownFiles } from "../vault/files.js";

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

export interface EvidenceMetadata {
  contentType?: MemoryContentType;
  capturedAt?: string;
  sourceId?: string;
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
  metadata: EvidenceMetadata = {},
): Promise<EvidenceEntry> {
  const date = todayString(now);
  const logPath = `Log/${date}.md`;
  const anchor = `e-${randomBytes(3).toString("hex")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const entry = [
    `## ${time} ${entryTitle(content)}  ^${anchor}`,
    `- source: ${source}`,
    `- verbatim: ${verbatim ? "yes" : "no"}`,
    ...(metadata.contentType ? [`- content-type: ${singleLine(metadata.contentType)}`] : []),
    ...(metadata.capturedAt ? [`- captured-at: ${singleLine(metadata.capturedAt)}`] : []),
    ...(metadata.sourceId ? [`- source-id: ${singleLine(metadata.sourceId)}`] : []),
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

function singleLine(value: string): string {
  return value.split("\n").map((part) => part.trim()).filter(Boolean).join(" ");
}

const SURFACES = new Set<Surface>(["cli", "mcp", "whatsapp", "telegram", "web", "drive", "selftest"]);
const CONTENT_TYPES = new Set<MemoryContentType>([
  "text",
  "voice_note",
  "audio",
  "image",
  "screenshot",
  "pdf",
  "document",
  "link",
]);

function validAnchor(value: string): boolean {
  if (value.length !== 8 || !value.startsWith("e-")) return false;
  const hex = "0123456789abcdef";
  return [...value.slice(2).toLowerCase()].every((character) => hex.includes(character));
}

function entryHeading(line: string): { anchor: string; title: string; time: string } | null {
  if (!line.startsWith("## ")) return null;
  const marker = line.lastIndexOf("  ^");
  if (marker < 0) return null;
  const anchor = line.slice(marker + 3).trim();
  if (!validAnchor(anchor)) return null;
  const heading = line.slice(3, marker).trim();
  const separator = heading.indexOf(" ");
  if (separator < 0) return null;
  return { anchor, time: heading.slice(0, separator), title: heading.slice(separator + 1).trim() };
}

function logDate(path: string): string | null {
  if (!path.startsWith("Log/") || !path.endsWith(".md")) return null;
  const date = path.slice(4, -3);
  return date.length === 10 ? date : null;
}

function parseEvidenceFile(path: string, text: string, location: VaultLocation): MemoryEntry[] {
  const date = logDate(path);
  if (!date) return [];
  const lines = text.split("\n");
  const starts: Array<{ index: number; heading: NonNullable<ReturnType<typeof entryHeading>> }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = entryHeading(lines[index] ?? "");
    if (heading) starts.push({ index, heading });
  }
  return starts.map(({ index, heading }, position) => {
    const end = starts[position + 1]?.index ?? lines.length;
    let source: Surface = "mcp";
    let verbatim = false;
    let contentType: MemoryContentType | undefined;
    let capturedAt = `${date}T${heading.time}:00`;
    let sourceId: string | undefined;
    const content: string[] = [];
    for (const line of lines.slice(index + 1, end)) {
      if (line.startsWith("- source: ")) {
        const value = line.slice("- source: ".length).trim() as Surface;
        if (SURFACES.has(value)) source = value;
      } else if (line.startsWith("- verbatim: ")) {
        verbatim = line.slice("- verbatim: ".length).trim() === "yes";
      } else if (line.startsWith("- content-type: ")) {
        const value = line.slice("- content-type: ".length).trim() as MemoryContentType;
        if (CONTENT_TYPES.has(value)) contentType = value;
      } else if (line.startsWith("- captured-at: ")) {
        capturedAt = line.slice("- captured-at: ".length).trim() || capturedAt;
      } else if (line.startsWith("- source-id: ")) {
        sourceId = line.slice("- source-id: ".length).trim() || undefined;
      } else if (line.startsWith("> ")) {
        content.push(line.slice(2));
      } else if (line === ">") {
        content.push("");
      }
    }
    const evidenceRef = `${path}#^${heading.anchor}`;
    return {
      evidenceRef,
      path,
      anchor: heading.anchor,
      title: heading.title,
      content: content.join("\n").trimEnd(),
      source,
      verbatim,
      ...(contentType ? { contentType } : {}),
      capturedAt,
      ...(sourceId ? { sourceId } : {}),
      // Obsidian block ids are not GitHub line anchors. Keep the canonical file
      // URL here and carry the exact block identity separately in evidenceRef.
      githubUrl: githubUrl(location, path),
    };
  });
}

function within(value: string, lower?: string, upper?: string): boolean {
  if (lower && value < lower) return false;
  if (upper && value > upper) return false;
  return true;
}

export async function searchEvidenceEntries(
  vaultPath: string,
  query: MemoryEntryQuery = {},
  location: VaultLocation = {},
): Promise<MemoryEntry[]> {
  const paths = (await listMarkdownFiles(vaultPath)).filter((path) => logDate(path) !== null);
  const entries: MemoryEntry[] = [];
  for (const path of paths) {
    const text = await readFile(join(vaultPath, path), "utf8");
    entries.push(...parseEvidenceFile(path, text, location));
  }
  const order = query.order ?? "newest";
  const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
  return entries
    .filter((entry) => !query.source || entry.source === query.source)
    .filter((entry) => !query.contentType || entry.contentType === query.contentType)
    .filter((entry) => !query.sourceId || entry.sourceId === query.sourceId)
    .filter((entry) => within(entry.capturedAt, query.capturedAfter, query.capturedBefore))
    .sort((left, right) => {
      const comparison = left.capturedAt.localeCompare(right.capturedAt) || left.evidenceRef.localeCompare(right.evidenceRef);
      return order === "newest" ? -comparison : comparison;
    })
    .slice(0, limit);
}

export async function getEvidenceEntry(
  vaultPath: string,
  evidenceRef: string,
  location: VaultLocation = {},
): Promise<MemoryEntry> {
  const marker = evidenceRef.lastIndexOf("#^");
  if (marker < 0) throw new Error(`invalid evidence ref: ${evidenceRef}`);
  const path = evidenceRef.slice(0, marker);
  const anchor = evidenceRef.slice(marker + 2);
  if (!logDate(path) || !validAnchor(anchor)) throw new Error(`invalid evidence ref: ${evidenceRef}`);
  const text = await readFile(join(vaultPath, path), "utf8");
  const entry = parseEvidenceFile(path, text, location).find((candidate) => candidate.anchor === anchor);
  if (!entry) throw new Error(`evidence entry not found: ${evidenceRef}`);
  return entry;
}
