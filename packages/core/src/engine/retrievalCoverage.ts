import type { NotePassage } from "../ops/passage.js";
import type { EntrySearchInput, EntrySearchResult } from "./entryPagination.js";

export const ASK_ENTRY_PAGE_BUDGET = 8;
export const ASK_PASSAGE_READ_BUDGET = 64;
export interface AnswerCoverage {
  contract: "ask-coverage-v1";
  exhaustiveRequested: boolean;
  status: "complete-bounded-scope" | "partial" | "focused";
  scope: "pinned-evidence" | "queried-local-memory";
  entryPageBudget: number;
  entryPagesRead: number;
  entryPageAttempts: number;
  passageReadBudget: number;
  passageReadAttempts: number;
  searches: Array<{
    query: EntrySearchInput; snapshot: string; scope: string;
    matchedEntries: number; enumeratedEntries: number; enumerationComplete: boolean;
    unreadEvidenceRefs: string[]; nextCursor: string | null;
    receiptEnrichmentAvailable: boolean;
  }>;
  successfulReads: Array<{ path: string; identity: string; version: string; start: number; end: number; sectionStart: number; sectionEnd: number; complete: boolean }>;
  pinnedEvidenceRefs: string[];
  failedReads: string[];
  continuation: Array<{ tool: "search_entries" | "read_note"; input: EntrySearchInput | { path: string; cursor?: string } }>;
  conversationHistorySearched: boolean;
  supportPolicy: "only-successfully-read-spans; citations-and-search-snippets-are-not-claim-support";
}

/** A conservative guard; the typed exhaustive flag is authoritative for other phrasing/languages. */
export function exhaustiveMemoryQuestion(question: string): boolean {
  return /\b(exhaustive|complete (?:list|audit|history|inventory)|audit|every (?:memory|entry|capture|note)|all (?:my |the )?(?:memories|entries|captures|notes|voice notes))\b/i.test(question);
}

/** Host routing for explicit personal-memory requests, independent of model tool choice.
 * This is deliberately narrower than generic discussion of memory (for example RAM).
 * Other memory turns are selected by their actual read attempts or citation claims.
 */
export function explicitMemoryRequest(question: string): boolean {
  return /\b(?:my|our|your)\s+(?:(?:stored|saved|past|previous|personal)\s+)?(?:memor(?:y|ies)|notes?|vault|brain|captures?|voice notes?)\b/i.test(question)
    || /\b(?:in|from|across|through|search|check|read)\s+(?:(?:the|my|our|your)\s+)?(?:(?:stored|saved|personal)\s+)?(?:memor(?:y|ies)|vault|brain|notes?|captures?)\b/i.test(question)
    || /\b(?:what|which|when|where|who|how)\b[\s\S]*\b(?:did|have|had)\s+(?:I|we)\b[\s\S]*\b(?:save|saved|store|stored|capture|captured|tell|told|say|said|decide|decided)\b/i.test(question)
    || /\b(?:do you remember|can you recall|recall what|remember when)\b/i.test(question);
}

export class RetrievalCoverage {
  pages = 0;
  private pageAttempts = 0;
  private readAttempts = 0;
  reserveEntryPage(): boolean {
    if (this.pageAttempts >= ASK_ENTRY_PAGE_BUDGET) return false;
    this.pageAttempts++; return true;
  }
  reserveRead(): boolean {
    if (this.readAttempts >= ASK_PASSAGE_READ_BUDGET) return false;
    this.readAttempts++; return true;
  }
  exhaustive: boolean;
  chats = false;
  failedReads = new Set<string>();
  private searches = new Map<string, { query: EntrySearchInput; last: EntrySearchResult; refs: Set<string>; startedAt: number }>();
  private passages: Array<{ passage: NotePassage; at: number }> = [];
  private sequence = 0;
  private pendingSearches = new Map<string, EntrySearchInput>();
  constructor(question: string, private pinned: string[]) { this.exhaustive = exhaustiveMemoryQuestion(question); }
  recordSearch(input: EntrySearchInput, result: EntrySearchResult): void {
    this.pages++;
    this.pendingSearches.delete(JSON.stringify(input));
    this.exhaustive ||= input.exhaustive === true;
    const { cursor: _cursor, exhaustive: _exhaustive, limit: _limit, ...filters } = input;
    const query = Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) as EntrySearchInput;
    const key = JSON.stringify(query);
    let search = this.searches.get(key);
    // Never join different snapshots, or pretend a tail-page restart enumerated its prefix.
    if (!search || search.last.pagination.snapshot !== result.pagination.snapshot || !input.cursor) {
      search = { query, last: result, refs: new Set(), startedAt: ++this.sequence };
      this.searches.set(key, search);
    }
    search.last = result;
    for (const entry of result.entries) search.refs.add(entry.evidenceRef);
  }
  failSearch(input: EntrySearchInput, message: string): void {
    this.failedReads.add(message);
    this.pendingSearches.set(JSON.stringify(input), input);
  }
  enumeratedRefs(): Set<string> { return new Set([...this.searches.values()].flatMap(s => [...s.refs])); }
  scopes(): Array<{ query: EntrySearchInput; snapshot: string }> {
    return [...this.searches.values()].map(s => ({ query: s.query, snapshot: s.last.pagination.snapshot }));
  }
  invalidate(query: EntrySearchInput): void {
    for (const search of this.searches.values()) if (JSON.stringify(search.query) === JSON.stringify(query)) {
      search.refs.clear();
      search.last.pagination.hasMore = true;
      search.last.pagination.nextCursor = null;
    }
    this.failedReads.add("Entry snapshot changed during retrieval; discard old pages and restart.");
  }
  recordRead(passage: NotePassage): void { this.passages.push({ passage, at: ++this.sequence }); }
  private entryComplete(ref: string, since: number): boolean {
    // Bootstrap pins remain primary for pinned-only answers, but are not tied
    // to a later catalog snapshot. Audits require a fresh read after enumeration.
    const reads = this.passages.filter(p => p.at > since && p.passage.identity === ref && p.passage.part === "body").map(p => p.passage);
    const version = reads.at(-1)?.version;
    const current = reads.filter(p => p.version === version).sort((a, b) => a.extent.start - b.extent.start);
    if (current.length === 0) return false;
    let end = current[0]!.extent.sectionStart;
    for (const p of current) { if (p.extent.start > end) return false; end = Math.max(end, p.extent.end); }
    return end >= current[0]!.extent.sectionEnd;
  }
  result(): AnswerCoverage {
    const groups = new Map<string, NotePassage[]>();
    const latestVersions = new Map<string, string>();
    for (const { passage: p } of this.passages.filter(p => p.passage.part === "body")) {
      latestVersions.set(p.identity, p.version);
      const key = JSON.stringify([p.identity, p.version]);
      const group = groups.get(key) ?? []; group.push(p); groups.set(key, group);
    }
    const successfulReads: AnswerCoverage["successfulReads"] = [];
    const continuation: AnswerCoverage["continuation"] = [...this.pendingSearches.values()].map(input => ({ tool: "search_entries", input }));
    for (const group of groups.values()) {
      group.sort((a, b) => a.extent.start - b.extent.start);
      const first = group[0]!; let end = first.extent.sectionStart; let gap = false;
      for (const p of group) {
        if (p.extent.start > end) gap = true;
        end = Math.max(end, p.extent.end);
      }
      const complete = !gap && end >= first.extent.sectionEnd;
      for (const p of group) successfulReads.push({ path: p.source.path, identity: p.identity, version: p.version,
        start: p.extent.start, end: p.extent.end, sectionStart: p.extent.sectionStart, sectionEnd: p.extent.sectionEnd, complete });
      if (!complete && latestVersions.get(first.identity) === first.version) {
        const last = group.at(-1)!;
        // Gaps/query seeks require restarting rather than skipping unread prefixes.
        continuation.push({ tool: "read_note", input: { path: first.identity.includes("#^") ? first.identity : first.readPath,
          ...(!gap && last.nextCursor ? { path: last.readPath, cursor: last.nextCursor } : {}) } });
      }
    }
    const searches = [...this.searches.values()].map(({ query, last, refs, startedAt }) => {
      const p = last.pagination;
      const enumerationComplete = !p.hasMore && refs.size === p.matchedEntries;
      const unreadEvidenceRefs = [...refs].filter(ref => !this.entryComplete(ref, startedAt));
      if (!enumerationComplete) continuation.push({ tool: "search_entries", input: { ...query, exhaustive: true, ...(p.nextCursor ? { cursor: p.nextCursor } : {}) } });
      for (const ref of unreadEvidenceRefs) if (!continuation.some(c => c.tool === "read_note" && "path" in c.input && c.input.path === ref)) {
        continuation.push({ tool: "read_note", input: { path: ref } });
      }
      return { query, snapshot: p.snapshot, scope: p.scope, matchedEntries: p.matchedEntries,
        enumeratedEntries: refs.size, enumerationComplete, unreadEvidenceRefs, nextCursor: p.nextCursor,
        receiptEnrichmentAvailable: p.receiptEnrichmentAvailable };
    });
    const completed = searches.length > 0
      ? searches.every(s => s.enumerationComplete && s.unreadEvidenceRefs.length === 0)
      : this.pinned.length > 0;
    return { contract: "ask-coverage-v1", exhaustiveRequested: this.exhaustive,
      status: this.exhaustive ? completed && this.failedReads.size === 0 ? "complete-bounded-scope" : "partial" : "focused",
      scope: this.pinned.length > 0 ? "pinned-evidence" : "queried-local-memory", entryPageBudget: ASK_ENTRY_PAGE_BUDGET,
      entryPagesRead: this.pages, entryPageAttempts: this.pageAttempts, passageReadBudget: ASK_PASSAGE_READ_BUDGET,
      passageReadAttempts: this.readAttempts, searches, successfulReads, pinnedEvidenceRefs: this.pinned,
      failedReads: [...this.failedReads], continuation, conversationHistorySearched: this.chats,
      supportPolicy: "only-successfully-read-spans; citations-and-search-snippets-are-not-claim-support" };
  }
}
