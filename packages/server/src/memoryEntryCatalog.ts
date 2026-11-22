import { randomUUID } from "node:crypto";
import { paginateMemoryEntries, memoryEntrySummaries, type BrainEngine, type EntrySearchInput, type EntrySearchResult, type MemoryContentType, type MemoryEntry, type StoreResult, type Surface } from "zenod";
import type { TaskJob } from "./taskJobStore.js";

const fallbackMemoryScopes = new WeakMap<BrainEngine, string>();
function memoryScope(engine: BrainEngine): string {
  if (engine.memoryScope) return engine.memoryScope;
  let scope = fallbackMemoryScopes.get(engine);
  if (!scope) { scope = randomUUID(); fallbackMemoryScopes.set(engine, scope); }
  return scope;
}

function captureIdentity(idempotencyKey: string | null): { surface?: Surface; sourceId?: string } {
  if (!idempotencyKey) return {};
  const first = idempotencyKey.indexOf(":");
  const second = first < 0 ? -1 : idempotencyKey.indexOf(":", first + 1);
  if (first < 0 || second < 0) return {};
  const channel = idempotencyKey.slice(first + 1, second);
  if (channel !== "whatsapp" && channel !== "telegram") return {};
  const sourceId = idempotencyKey.slice(second + 1).trim();
  return { surface: channel, ...(sourceId ? { sourceId } : {}) };
}

function resultEvidenceRef(job: TaskJob): string | null {
  if (!job.result || typeof job.result !== "object") return null;
  const result = job.result as unknown as Record<string, unknown>;
  if (typeof result.evidenceRef === "string") return result.evidenceRef;
  const digest = result.digest;
  if (!digest || typeof digest !== "object") return null;
  const evidenceRef = (digest as Record<string, unknown>).evidenceRef;
  return typeof evidenceRef === "string" ? evidenceRef : null;
}

function resultEvidenceUrl(job: TaskJob): string {
  if (!job.result || typeof job.result !== "object") return "";
  const result = job.result as unknown as Record<string, unknown>;
  if (typeof result.evidenceUrl === "string") return result.evidenceUrl;
  const digest = result.digest;
  if (!digest || typeof digest !== "object") return "";
  const evidenceUrl = (digest as Record<string, unknown>).evidenceUrl;
  return typeof evidenceUrl === "string" ? evidenceUrl : "";
}

function resultRevision(job: TaskJob): StoreResult["revision"] | undefined {
  if (!job.result || typeof job.result !== "object") return undefined;
  const result = job.result as unknown as Record<string, unknown>;
  const direct = result.revision;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as StoreResult["revision"];
  const digest = result.digest;
  if (!digest || typeof digest !== "object") return undefined;
  const nested = (digest as Record<string, unknown>).revision;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as StoreResult["revision"]
    : undefined;
}

function sourceFromJob(job: TaskJob): Surface {
  if (job.input.source) return job.input.source;
  const identity = captureIdentity(job.idempotencyKey);
  if (identity.surface) return identity.surface;
  const hint = job.input.sourceHint?.trim().toLowerCase() ?? "";
  if (hint.startsWith("whatsapp")) return "whatsapp";
  if (hint.startsWith("telegram")) return "telegram";
  if (hint.startsWith("drive")) return "drive";
  return "mcp";
}

function contentTypeFromJob(job: TaskJob, source: Surface): MemoryContentType {
  if (job.input.contentType) return job.input.contentType;
  if (job.kind === "media_ingest" && job.input.mediaType) return job.input.mediaType;
  if (job.kind === "store" && (source === "whatsapp" || source === "telegram")) return "voice_note";
  return "text";
}

function titleFromContent(content: string): string {
  const first = content.split("\n")[0]?.trim() ?? "";
  return first.length > 100 ? `${first.slice(0, 97)}...` : first || "Memory entry";
}

function entryFromJob(job: TaskJob, base?: MemoryEntry): MemoryEntry | null {
  if (job.status !== "done" || (job.kind !== "store" && job.kind !== "media_ingest")) return null;
  const evidenceRef = resultEvidenceRef(job);
  if (!evidenceRef) return null;
  const marker = evidenceRef.lastIndexOf("#^");
  if (marker < 0) return null;
  const source = sourceFromJob(job);
  const identity = captureIdentity(job.idempotencyKey);
  const content = base?.content ?? job.input.content ?? job.input.contentHint ?? "";
  const revision = resultRevision(job);
  const url = resultEvidenceUrl(job) || base?.url || "";
  return {
    evidenceRef,
    path: evidenceRef.slice(0, marker),
    anchor: evidenceRef.slice(marker + 2),
    title: base?.title ?? titleFromContent(content),
    content,
    source,
    verbatim: job.input.verbatim ?? base?.verbatim ?? false,
    contentType: job.input.contentType ?? base?.contentType ?? contentTypeFromJob(job, source),
    capturedAt: job.input.capturedAt ?? job.input.senderTimestamp ?? new Date(job.createdAt).toISOString(),
    sourceId: job.input.sourceId ?? identity.sourceId,
    url,
    provider: revision?.provider ?? base?.provider ?? "github",
    ...(revision?.id ? { revisionId: revision.id } : base?.revisionId ? { revisionId: base.revisionId } : {}),
    ...((revision?.provider ?? base?.provider ?? "github") === "github"
      ? { githubUrl: url || base?.githubUrl || "" }
      : {}),
  };
}

/** Where the lean receipts come from (TaskJobStore / TaskJobQueue); `recent` is the older full-history fallback. */
export interface CaptureReceiptSource {
  captureReceipts?(evidenceRef?: string): TaskJob[];
  /** The same receipts read on a worker thread (TaskJobStore.captureReceiptsAsync): preferred where a caller can await. */
  captureReceiptsAsync?(evidenceRef?: string): Promise<TaskJob[]>;
  captureContent?(id: string): { content?: string; contentHint?: string } | null;
  recent?(limit?: number): TaskJob[];
}

/**
 * EPIC-24 M15: the finished capture receipts a merge needs, without putting the whole job history on the heap.
 * Lean receipts carry no note text; `loadContent` reads it for the few entries the vault does not hold yet.
 */
export type CaptureReceipts = { jobs: TaskJob[]; loadContent?: (id: string) => { content?: string; contentHint?: string } | null };

export function captureReceiptsFor(source: CaptureReceiptSource | undefined, evidenceRef?: string): CaptureReceipts {
  if (source?.captureReceipts) {
    return { jobs: source.captureReceipts(evidenceRef), ...(source.captureContent ? { loadContent: (id: string) => source.captureContent!(id) } : {}) };
  }
  return { jobs: source?.recent?.(Number.MAX_SAFE_INTEGER) ?? [] };
}

type ContentLoader = (id: string) => { content?: string; contentHint?: string } | null;

/** The merge as steps: each yield is a safe place to hand the thread back (mergeMemoryEntriesAsync). */
function* mergeMemoryEntrySteps(entries: MemoryEntry[], jobs: TaskJob[], loadContent?: ContentLoader): Generator<void, MemoryEntry[]> {
  const vaultByRef = new Map(entries.map((entry) => [entry.evidenceRef, entry]));
  const winningReceipts = new Map<string, TaskJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))) {
    if (job.status !== "done" || (job.kind !== "store" && job.kind !== "media_ingest")) continue;
    const evidenceRef = resultEvidenceRef(job);
    if (evidenceRef) winningReceipts.set(evidenceRef, job);
  }
  const byRef = new Map(vaultByRef);
  for (const [evidenceRef, job] of winningReceipts) {
    yield;
    // Only immutable vault evidence is an authoritative base. An older derived
    // receipt must not make its content/title sticky under newer metadata.
    const base = vaultByRef.get(evidenceRef);
    // A lean receipt has no note text: read it only when the vault does not hold this evidence yet.
    const full = !base && loadContent && job.input.content === undefined && job.input.contentHint === undefined
      ? { ...job, input: { ...job.input, ...(loadContent(job.id) ?? {}) } }
      : job;
    const derived = entryFromJob(full, base);
    if (derived) byRef.set(evidenceRef, derived);
  }
  return [...byRef.values()];
}

export function mergeMemoryEntries(entries: MemoryEntry[], jobs: TaskJob[], loadContent?: ContentLoader): MemoryEntry[] {
  const steps = mergeMemoryEntrySteps(entries, jobs, loadContent);
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
}

/** How long the merge may hold the thread before it lets other requests run (EPIC-24 M34 round 4). */
const MERGE_SLICE_MS = 20;

/**
 * The same merge, giving the thread back every ~20 ms. On production one merge over the receipts of every capture a
 * tenant ever made held the loop for 5.7 s (`event_loop.blocked`, stack `entryFromJob`); chat and WhatsApp waited.
 */
export async function mergeMemoryEntriesAsync(entries: MemoryEntry[], jobs: TaskJob[], loadContent?: ContentLoader): Promise<MemoryEntry[]> {
  const steps = mergeMemoryEntrySteps(entries, jobs, loadContent);
  let sliceStart = Date.now();
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return step.value;
    if (Date.now() - sliceStart >= MERGE_SLICE_MS) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      sliceStart = Date.now();
    }
  }
}

/** `captureReceiptsFor` for a caller that can await: the receipts are read off the main thread when the source can. */
export async function captureReceiptsForAsync(source: CaptureReceiptSource | undefined, evidenceRef?: string): Promise<CaptureReceipts> {
  if (source?.captureReceiptsAsync) {
    return { jobs: await source.captureReceiptsAsync(evidenceRef), ...(source.captureContent ? { loadContent: (id: string) => source.captureContent!(id) } : {}) };
  }
  return captureReceiptsFor(source, evidenceRef);
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
