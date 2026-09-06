import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { MemoryEntry, MemoryEntryQuery } from "../types.js";
import { memoryTimestamp, selectMemoryEntries } from "./evidence.js";

// Process-local signing: stateless HTTP requests share this key. Restart/another
// process invalidates continuations explicitly; no deployment credential needed.
const key = randomBytes(32);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sign = (payload: string) => createHmac("sha256", key).update(payload).digest();
interface Cursor { v: 1; scope: string; snapshot: string; query: string; after: [number, string] }

export interface MemoryEntryPage {
  entries: MemoryEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  snapshot: string;
  matchedEntries: number;
  scannedEntries: number;
}

/** Full captured entry set in, filtered stable page out. Never paginate before enrichment. */
export function paginateMemoryEntries(
  entries: MemoryEntry[],
  query: MemoryEntryQuery,
  scope: string,
  cursor?: string,
): MemoryEntryPage {
  const limit = query.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Entry page limit must be 1–100");
  const scopeHash = hash(scope);
  const snapshot = hash([...entries].sort((a, b) => a.evidenceRef < b.evidenceRef ? -1 : a.evidenceRef > b.evidenceRef ? 1 : 0));
  const queryHash = hash({ query: query.query?.normalize("NFKC").toLowerCase().trim().split(/\s+/), source: query.source, contentType: query.contentType,
    sourceId: query.sourceId, after: query.capturedAfter ? memoryTimestamp(query.capturedAfter) : null,
    before: query.capturedBefore ? memoryTimestamp(query.capturedBefore) : null, order: query.order ?? "newest" });
  const selected = selectMemoryEntries(entries, query);
  let offset = 0;
  if (cursor) {
    let decoded: Cursor;
    try {
      if (cursor.length > 2048) throw new Error();
      const parts = cursor.split(".");
      if (parts.length !== 2) throw new Error();
      const payload = parts[0]!;
      const signature = Buffer.from(parts[1]!, "base64url");
      if (signature.length !== 32 || !timingSafeEqual(signature, sign(payload))) throw new Error();
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Cursor;
      if (decoded.v !== 1 || decoded.scope !== scopeHash || decoded.query !== queryHash) throw new Error();
    } catch { throw new Error("Invalid entry cursor or changed query/vault/process; restart without cursor"); }
    if (decoded.snapshot !== snapshot) throw new Error("Entry snapshot changed; restart without cursor and discard prior pages");
    offset = selected.findIndex(entry => entry.evidenceRef === decoded.after[1] && memoryTimestamp(entry.capturedAt) === decoded.after[0]) + 1;
    if (!offset) throw new Error("Entry cursor position missing; restart without cursor");
  }
  const page = selected.slice(offset, offset + limit);
  const hasMore = offset + page.length < selected.length;
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const payload = Buffer.from(JSON.stringify({ v: 1, scope: scopeHash, snapshot, query: queryHash,
      after: [memoryTimestamp(last.capturedAt), last.evidenceRef] } satisfies Cursor)).toString("base64url");
    nextCursor = `${payload}.${sign(payload).toString("base64url")}`;
  }
  return { entries: page, hasMore, nextCursor, snapshot, matchedEntries: selected.length, scannedEntries: entries.length };
}
