import { randomUUID } from "node:crypto";
import { paginateMemoryEntries, memoryEntrySummaries, type BrainEngine, type EntrySearchInput, type EntrySearchResult } from "zenod";
import { captureReceiptsForAsync, mergeMemoryEntriesAsync, type CaptureReceiptSource } from "./memoryEntryCatalog.js";

/** The paged entry search (split from memoryEntryCatalog so the Phylax bundle, which reads single entries only, carries no runtime zenod import). */
const fallbackMemoryScopes = new WeakMap<BrainEngine, string>();
function memoryScope(engine: BrainEngine): string {
  if (engine.memoryScope) return engine.memoryScope;
  let scope = fallbackMemoryScopes.get(engine);
  if (!scope) { scope = randomUUID(); fallbackMemoryScopes.set(engine, scope); }
  return scope;
}

export async function searchMemoryEntryPage(engine: BrainEngine, taskJobs: CaptureReceiptSource | undefined, input: EntrySearchInput): Promise<EntrySearchResult> {
  const vaultEntries = await engine.searchEntries({ limit: null });
  const { jobs, loadContent } = await captureReceiptsForAsync(taskJobs);
  const page = paginateMemoryEntries(await mergeMemoryEntriesAsync(vaultEntries, jobs, loadContent), {
    ...input, order: input.order ?? "newest", limit: input.limit ?? 20,
  }, memoryScope(engine), input.cursor);
  return { entries: memoryEntrySummaries(page.entries), pagination: {
    hasMore: page.hasMore, nextCursor: page.nextCursor, snapshot: page.snapshot,
    matchedEntries: page.matchedEntries, scannedEntries: page.scannedEntries, scannedVaultEntries: vaultEntries.length,
    scannedReceiptJobs: jobs.length, receiptEnrichmentAvailable: Boolean(taskJobs?.captureReceipts || taskJobs?.recent),
    scope: "all-local-vault-evidence-and-retained-tenant-receipts",
  } };
}
