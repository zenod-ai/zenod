import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { MEANING_FOLDERS } from "../vault/files.js";
import { createHash } from "node:crypto";
import type { Classification, ClassificationTopic } from "../llm/types.js";
import type { EnrichEvidenceInput, TopicFilingResult } from "../types.js";
import type { FileChange } from "../vault/immutability.js";
import type { VaultRevision } from "../vault/repository.js";
import { publicationContentHash } from "../vault/publicationGuard.js";

export type FrozenTopic = ClassificationTopic & { ideaId: string };
export type FilingOutcome = TopicFilingResult & { ideaId?: string; appliedOperationIds?: string[] };
export interface PreparedFilingFile {
  beforeHash: string | null;
  /** Exact approved bytes, persisted before the corresponding page mutation. */
  after: string | null;
  afterHash: string | null;
}
export interface FilingReceipt {
  version: 1;
  evidenceRef: string;
  inputFingerprint: string;
  /** Logical plan identity, independent of the provider publication revision. */
  filingRevision: string;
  baseRevision: VaultRevision;
  phase: "prepared" | "ready";
  classification: Omit<Classification, "topics"> & { topics: FrozenTopic[] };
  outcomes: FilingOutcome[];
  files: Record<string, PreparedFilingFile>;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function filingInputFingerprint(input: EnrichEvidenceInput): string {
  return digest([1, input.evidenceRef, input.content, input.source, input.sourceId ?? null,
    input.contentType ?? null, input.capturedAt ?? null, input.semanticRange ?? null, input.hints ?? []]);
}

export function filingReceiptPath(evidenceRef: string): string {
  const match = /^Log\/(\d{4}-\d{2}-\d{2})\.md#\^(e-[a-zA-Z0-9-]+)$/.exec(evidenceRef);
  if (!match) throw new Error("invalid_filing_evidence_ref");
  return `Inbox/filing-${match[1]}-${match[2]}.md`;
}

/** Passage tables are host-owned runtime indexes; persist only source addresses. */
export function freezeFilingClassification(classification: Omit<Classification, "topics"> & { topics: FrozenTopic[] }): Omit<Classification, "topics"> & { topics: FrozenTopic[] } {
  return { ...classification, topics: classification.topics.map(({ sourcePassages: _runtime, ...topic }) => structuredClone(topic)) };
}

export function sealFilingReceipt(receipt: Omit<FilingReceipt, "filingRevision">): FilingReceipt {
  return { ...receipt, filingRevision: digest(receipt) };
}

export function renderFilingReceipt(receipt: FilingReceipt): string {
  const resolved = receipt.phase === "ready" && receipt.outcomes.length > 0 && receipt.outcomes.every(topic => topic.status === "filed");
  return ["---", `status: ${resolved ? "filing-resolved" : "filing-record"}`, `evidence: ${JSON.stringify(receipt.evidenceRef)}`, "---", "",
    "# Topic filing receipt", "", "This plan is durable only when its containing revision is verified at the vault provider.", "",
    "```json", JSON.stringify(receipt, null, 2), "```", ""].join("\n");
}

export function parseFilingReceipt(content: string, input: EnrichEvidenceInput): FilingReceipt | null {
  const body = /\n```json\n([\s\S]*)\n```\n?$/.exec(content)?.[1];
  if (!body) return null;
  try {
    const value = JSON.parse(body) as FilingReceipt;
    if (value.version !== 1 || value.evidenceRef !== input.evidenceRef || value.inputFingerprint !== filingInputFingerprint(input)
      || !["prepared", "ready"].includes(value.phase) || !Array.isArray(value.classification?.topics)
      || !Array.isArray(value.outcomes) || !value.files || typeof value.files !== "object") return null;
    const { filingRevision, ...payload } = value;
    if (filingRevision !== digest(payload)) return null;
    const ids = value.classification.topics.map(topic => topic.ideaId);
    if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) return null;
    for (const [path, file] of Object.entries(value.files)) {
      if (!safeFilingPath(path) || typeof file.after !== "string" || file.afterHash !== publicationContentHash(file.after)) return null;
    }
    return value;
  } catch { return null; }
}

function safeFilingPath(path: string): boolean {
  return !!path && !path.startsWith("/") && !path.includes("\\") && !path.split("/").some(part => part === ".." || part === "." || !part)
    && !!MEANING_FOLDERS[path.split("/")[0]!] && path.endsWith(".md");
}

/** Verify only this attempt's known workspace edits; never reset unknown files. */
export function verifyPreparedFilingChanges(receipt: FilingReceipt, changes: FileChange[], receiptPath: string): boolean {
  return changes.every(change => {
    if (change.path === receiptPath) return change.after === renderFilingReceipt(receipt);
    const plan = receipt.files[change.path];
    if (!plan || !safeFilingPath(change.path) || publicationContentHash(change.before) !== plan.beforeHash) return false;
    const actual = publicationContentHash(change.after);
    return actual === plan.beforeHash || actual === plan.afterHash;
  });
}

/** Keep successful ideas and destinations out of subsequent model/write work. */
export function unfinishedFilingTopics(receipt: FilingReceipt): FrozenTopic[] {
  return receipt.classification.topics.flatMap(topic => {
    const outcome = receipt.outcomes.find(item => item.ideaId === topic.ideaId);
    if (outcome?.status === "filed" || outcome?.status === "uncertain") return [];
    const completed = new Set(outcome?.filedPages ?? []);
    return [{ ...structuredClone(topic), pages: topic.pages.filter(page => !completed.has(page.path)) }];
  });
}

/** Same meaning-page policy on replay; never follow symlinks into other files. */
export async function assertFilingTarget(vaultPath: string, path: string, canonicalReceipt = false): Promise<void> {
  if (!(canonicalReceipt ? /^Inbox\/filing-\d{4}-\d{2}-\d{2}-e-[a-zA-Z0-9-]+\.md$/.test(path) : safeFilingPath(path))) throw new Error("invalid_filing_target");
  let current = vaultPath;
  for (const part of path.split("/")) {
    current = join(current, part);
    const stat = await lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error("filing_symlink_target");
  }
}
