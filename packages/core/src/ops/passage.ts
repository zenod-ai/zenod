import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { getNote } from "./get.js";
import { entryHeading } from "../engine/evidence.js";
import type { VaultSourceContext } from "../vault/source.js";
import type { VaultSourceRef } from "../vault/repository.js";

export interface NoteReadOptions {
  part?: "body" | "frontmatter" | undefined;
  /** Opaque continuation from this reader. Omit query when continuing. */
  cursor?: string | undefined;
  /** Literal passage locator; never interpreted as an instruction. */
  query?: string | undefined;
  /** UTF-16 body units per response; 256–8000, default 8000. */
  maxChars?: number | undefined;
}

export interface NotePassage {
  source: VaultSourceRef;
  /** Pass this same path with nextCursor. */
  readPath: string;
  part: "body" | "frontmatter";
  frontmatterChars: number;
  /** Content digest, independent of optional remote revision. */
  version: string;
  identity: string;
  extent: { unit: "utf16"; start: number; end: number; total: number; scopeStart: number; scopeEnd: number; sectionStart: number; sectionEnd: number };
  body: string;
  truncated: boolean;
  omittedBefore: boolean;
  nextCursor: string | null;
  queryMatched?: boolean;
}

interface Section { start: number; end: number; anchor?: string }
interface Cursor { v: 1; scope: string; version: string; offset: number }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Reuse the evidence heading parser; quoted transcript headings cannot split an entry. */
function sections(body: string, evidence: boolean): Section[] {
  const starts: Array<{ start: number; anchor?: string }> = [{ start: 0 }];
  let offset = 0;
  for (const line of body.split("\n")) {
    const heading = evidence ? entryHeading(line) : null;
    if (heading || (!evidence && /^#{1,6} /.test(line))) {
      const section = { start: offset, ...(heading ? { anchor: heading.anchor } : {}) };
      if (offset === 0) starts[0] = section;
      else starts.push(section);
    }
    offset += line.length + 1;
  }
  return starts.map((section, index) => ({ ...section, end: starts[index + 1]?.start ?? body.length }));
}

function boundary(text: string, offset: number): number {
  // Keep surrogate pairs intact, while preserving offsets in the original body.
  const code = text.charCodeAt(offset);
  return code >= 0xdc00 && code <= 0xdfff ? offset - 1 : offset;
}

/** Bounded section/evidence read. Public get_memory remains the full-content API. */
export async function readNotePassage(
  vaultPath: string,
  requested: string,
  options: NoteReadOptions = {},
  location: VaultSourceContext = {},
): Promise<NotePassage> {
  const maxChars = options.maxChars ?? 8000;
  const part = options.part ?? "body";
  if (part !== "body" && part !== "frontmatter") throw new Error("Invalid note part");
  if (!Number.isInteger(maxChars) || maxChars < 256 || maxChars > 8000) throw new Error("maxChars must be an integer from 256 to 8000");
  if (options.cursor && options.query) throw new Error("Continue with cursor only; omit query");
  if (options.query && options.query.length > 1000) throw new Error("query exceeds 1000 characters");
  const marker = requested.indexOf("#");
  const path = marker < 0 ? requested : requested.slice(0, marker);
  const anchor = marker < 0 ? undefined : requested.slice(marker + 1);
  if (anchor !== undefined && !/^\^e-[0-9a-f]{6}$/i.test(anchor)) throw new Error("Invalid evidence anchor");
  if (anchor && part === "frontmatter") throw new Error("Exact evidence reads cannot access file frontmatter");
  const note = await getNote(vaultPath, path, location);
  const frontmatterText = JSON.stringify(note.frontmatter, null, 2);
  const content = part === "frontmatter" ? frontmatterText : note.body;
  const all = sections(content, part === "body" && note.path.startsWith("Log/"));
  const exact = anchor ? all.find((section) => section.anchor === anchor.slice(1)) : undefined;
  if (anchor && !exact) throw new Error(`evidence entry not found: ${requested}`);
  const lower = exact?.start ?? 0;
  const upper = exact?.end ?? content.length;
  const version = `sha256:${hash(JSON.stringify([note.frontmatter, note.body]))}`;
  const scope = hash(JSON.stringify([await realpath(vaultPath), note.provider, note.path, anchor ?? "", note.revisionId ?? "", part]));
  let start = lower;
  let queryMatched: boolean | undefined;
  if (options.cursor) {
    let cursor: Cursor;
    try {
      if (options.cursor.length > 2048) throw new Error();
      cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as Cursor;
    } catch { throw new Error("Invalid read cursor; restart the read"); }
    if (!cursor || typeof cursor !== "object") throw new Error("Invalid read cursor; restart the read");
    if (cursor.v !== 1 || cursor.scope !== scope) throw new Error("Read cursor belongs to another source or revision; restart the read");
    if (cursor.version !== version) throw new Error("Stale read cursor: note changed; restart the read");
    if (!Number.isInteger(cursor.offset) || cursor.offset < lower || cursor.offset >= upper || boundary(content, cursor.offset) !== cursor.offset) throw new Error("Invalid read cursor offset");
    start = cursor.offset;
  } else if (options.query?.trim()) {
    // A case-insensitive regex preserves original Unicode offsets; lowercasing
    // the body instead can change its string length.
    const literal = options.query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(literal, "iu").exec(content.slice(lower, upper));
    queryMatched = match !== null;
    if (match) {
      const at = lower + match.index;
      const section = exact ?? all.find((candidate) => candidate.start <= at && candidate.end > at)!;
      start = boundary(content, Math.max(section.start, at - Math.floor(maxChars / 4)));
    }
  }
  const section = exact ?? all.find((candidate) => candidate.start <= start && candidate.end > start) ?? all[all.length - 1]!;
  const end = boundary(content, Math.min(start + maxChars, section.end, upper));
  const nextCursor = end < upper ? Buffer.from(JSON.stringify({ v: 1, scope, version, offset: end } satisfies Cursor)).toString("base64url") : null;
  const source = { ...note } as VaultSourceRef & { body?: string; frontmatter?: unknown };
  delete source.body;
  delete source.frontmatter;
  // Keep provider publication URL as returned by its resolver; identity carries
  // the exact block/span even where a provider has no web fragment support.
  const identity = part === "frontmatter" ? `${note.path}#frontmatter` : section.anchor ? `${note.path}#^${section.anchor}` : `${note.path}#section-${section.start}`;
  return {
    source, part, frontmatterChars: frontmatterText.length, readPath: anchor ? `${note.path}#${anchor}` : note.path, version, identity,
    extent: { unit: "utf16", start, end, total: content.length, scopeStart: lower, scopeEnd: upper, sectionStart: section.start, sectionEnd: section.end },
    body: content.slice(start, end),
    truncated: start > lower || end < upper,
    omittedBefore: start > lower,
    nextCursor,
    ...(queryMatched === undefined ? {} : { queryMatched }),
  };
}
