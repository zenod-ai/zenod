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

export function mergeMemoryEntries(entries: MemoryEntry[], jobs: TaskJob[]): MemoryEntry[] {
  const vaultByRef = new Map(entries.map((entry) => [entry.evidenceRef, entry]));
  const winningReceipts = new Map<string, TaskJob>();
  for (const job of [...jobs].sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))) {
    if (job.status !== "done" || (job.kind !== "store" && job.kind !== "media_ingest")) continue;
    const evidenceRef = resultEvidenceRef(job);
    if (evidenceRef) winningReceipts.set(evidenceRef, job);
  }
  const byRef = new Map(vaultByRef);
  for (const [evidenceRef, job] of winningReceipts) {
    // Only immutable vault evidence is an authoritative base. An older derived
    // receipt must not make its content/title sticky under newer metadata.
    const derived = entryFromJob(job, vaultByRef.get(evidenceRef));
    if (derived) byRef.set(evidenceRef, derived);
  }
  return [...byRef.values()];
}

export async function searchMemoryEntryPage(engine: BrainEngine, taskJobs: { recent?(limit?: number): TaskJob[] } | undefined, input: EntrySearchInput): Promise<EntrySearchResult> {
  const vaultEntries = await engine.searchEntries({ limit: null });
  const jobs = taskJobs?.recent?.(Number.MAX_SAFE_INTEGER) ?? [];
  const page = paginateMemoryEntries(mergeMemoryEntries(vaultEntries, jobs), {
    ...input, order: input.order ?? "newest", limit: input.limit ?? 20,
  }, memoryScope(engine), input.cursor);
  return { entries: memoryEntrySummaries(page.entries), pagination: {
    hasMore: page.hasMore, nextCursor: page.nextCursor, snapshot: page.snapshot,
    matchedEntries: page.matchedEntries, scannedEntries: page.scannedEntries, scannedVaultEntries: vaultEntries.length,
    scannedReceiptJobs: jobs.length, receiptEnrichmentAvailable: Boolean(taskJobs?.recent),
    scope: "all-local-vault-evidence-and-retained-tenant-receipts",
  } };
}

