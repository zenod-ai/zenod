import type { BrainEngine, InterruptedFilingState } from "zenod";
import type { TaskJob, TaskJobInput, TaskJobKind, TaskJobStore } from "./taskJobStore.js";

export interface VaultRecoveryDeps {
  store: TaskJobStore;
  getEngine: () => Promise<BrainEngine>;
  enqueue: (kind: TaskJobKind, input: TaskJobInput, idempotencyKey?: string) => TaskJob;
  /** Drain the queue again after jobs were put back. */
  kick: () => void;
  isClosed: () => boolean;
  /** How often to re-inspect while the recovery job runs, and when to give up (default 2 s / 30 min). */
  pollMs?: number;
  timeoutMs?: number;
  /** Named at the end of every log line so a stuck vault can be tied to its tenant (EPIC-24 M25; the health page pairs UNRESOLVED with "recovered" by it). */
  tenant?: string;
}

export type VaultRecoveryOutcome =
  | { status: "unsupported" }
  | { status: "clean"; requeued: number }
  | { status: "recovered"; requeued: number }
  | { status: "unresolved"; state: InterruptedFilingState; requeued: number };

const logFor = (tenant?: string) => (message: string, detail: unknown) =>
  console.warn(`[vault-recovery] ${message}: ${JSON.stringify(detail)}${tenant ? ` tenant=${tenant}` : ""}`);

/**
 * Self-healing for `filing_recovery_pending`. Nobody can inspect the tenant volume, so this diagnoses
 * (one structured, content-free line), recovers through the exact path a normal enrichment uses (an
 * enrich_memory job per interrupted receipt, which replays the receipt plan and publishes it), publishes a
 * receipt-less unpublished local commit only when it fast-forwards the authority, then retries the capture
 * jobs the guard had failed. Nothing unpublished is discarded.
 */
export async function recoverInterruptedFiling(deps: VaultRecoveryDeps): Promise<VaultRecoveryOutcome> {
  const log = logFor(deps.tenant);
  const engine = await deps.getEngine();
  if (!engine.inspectInterruptedFiling) return { status: "unsupported" };
  let state = await engine.inspectInterruptedFiling();
  if (!state.interrupted) {
    const requeued = deps.store.requeueFilingRecoveryBlocked();
    if (requeued) { log("vault clean; retried blocked jobs", { requeued }); deps.kick(); }
    return { status: "clean", requeued };
  }
  log("interrupted filing found", state);

  // EPIC-24 M31: a restart that killed the weekly tree sweep left its moved receipts and new pages uncommitted. No
  // receipt of that state can be replayed, so every enrichment fails with filing_recovery_pending for ever. Keep all of
  // it on a side ref (nothing deleted) and go back to the published head; the sweep redoes its work from the receipts.
  if (state.conditions.includes("pending_receipt") && engine.setAsideAbandonedChanges) {
    const kept = await engine.setAsideAbandonedChanges();
    if (kept.status === "set_aside") {
      log("set aside uncommitted changes no filing can replay; nothing deleted, every byte kept on the side ref", { ref: kept.ref, paths: kept.paths, receipts: kept.receipts });
      state = await engine.inspectInterruptedFiling();
    }
  }

  if (!state.receipts.length && state.conditions.includes("unpublished_head") && engine.recoverUnpublishedHead) {
    const result = await engine.recoverUnpublishedHead();
    log("unpublished local head", { result, localHead: state.localHead, publishedRevision: state.publishedRevision });
  }

  for (const receipt of state.receipts) {
    const known = deps.store.enrichmentJobsFor(receipt.evidenceRef)[0];
    let job: TaskJob | null = known ?? null;
    if (!job) {
      const input = await engine.evidenceEnrichInput?.(receipt.evidenceRef);
      if (!input) { log("no enrichment input for receipt; cannot replay", { path: receipt.path, evidenceRef: receipt.evidenceRef }); continue; }
      job = deps.enqueue("enrich_memory", input as TaskJobInput, `enrich-recovery:${receipt.evidenceRef}`);
    }
    if (job.status === "queued" || job.status === "running") {
      log("recovery job already active", { evidenceRef: receipt.evidenceRef, jobId: job.id, status: job.status });
    } else if (deps.store.requeueForRecovery(job.id)) {
      log("requeued enrichment job", { evidenceRef: receipt.evidenceRef, jobId: job.id, was: job.status, phase: receipt.phase });
    }
  }
  deps.kick();

  const pollMs = deps.pollMs ?? 2_000;
  const deadline = Date.now() + (deps.timeoutMs ?? 30 * 60_000);
  for (;;) {
    state = await engine.inspectInterruptedFiling();
    if (!state.interrupted) break;
    if (deps.isClosed() || Date.now() >= deadline) {
      const requeued = deps.store.requeueFilingRecoveryBlocked();
      if (requeued) deps.kick();
      log("UNRESOLVED: filing still interrupted", state);
      return { status: "unresolved", state, requeued };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs).unref?.());
  }
  const requeued = deps.store.requeueFilingRecoveryBlocked();
  log("recovered; writes unblocked", { requeued });
  deps.kick();
  return { status: "recovered", requeued };
}
