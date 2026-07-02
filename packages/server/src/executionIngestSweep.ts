import type { ExecutionTicket } from "./executionQueue.js";
import type { JourneyStore } from "./journeyStore.js";
import { buildIngestPacket } from "./journeyAuthorityReconciler.js";

/**
 * R1-T2 (production seam) — the execution-result ingest sweep.
 *
 * The create-and-run journey completes its execution step AT DISPATCH TIME
 * (createIssueRunJourney records the still-running ticket and calls completeStep),
 * so the step reconciler never sees the terminal edge and the reconciler-side
 * ingest branch is unreachable on the main path. This sweep runs on the journey
 * monitor cadence instead: it scans recent execution_record artifacts, re-reads
 * any non-terminal ones from the execution authority (local queue on Epaminon,
 * the executor peer over the mesh on the Console), refreshes the artifact, and
 * files the cited meaning note to Zenod.
 *
 * Filing is ASYNC on Zenod (a job that can fail long after acceptance — e.g. the
 * 2026-07-02 out-of-credits incident silently killed every filing for a week), so
 * the zenod_ingest guard has a LIFECYCLE instead of being written at acceptance:
 *   (no guard) → store_memory accepted → guard {status:"pending", jobId, attempts}
 *   pending → job done  → guard {status:"filed", evidenceRef}
 *   pending → job error → re-file (attempts+1) … up to MAX_ATTEMPTS → {status:"gave-up", error}
 * "queued"/"running" jobs are left for the next pass. A terminal execution with no
 * deliverable gets {status:"skipped"} so it is never re-polled.
 */

const TERMINAL_STATES = new Set(["done", "needs-review", "approved", "failed"]);
const MAX_ATTEMPTS = 3;

export type IngestGuardStatus = "pending" | "filed" | "skipped" | "gave-up";

export interface IngestGuardData {
  executionId: string;
  status: IngestGuardStatus;
  jobId?: string;
  attempts?: number;
  evidenceRef?: string;
  error?: string;
  [key: string]: unknown;
}

export interface MemoryJobStatus {
  status: "queued" | "running" | "done" | "error" | "interrupted";
  evidenceRef?: string;
  error?: string;
}

export interface IngestSweepDeps {
  store: JourneyStore;
  /** Read the live ticket from the execution authority; null on miss/failure. */
  readExecution: (reference: string) => Promise<ExecutionTicket | null>;
  /** Start an async Zenod filing; returns the jobId, or null on failure (retried next pass). */
  fileMemory: (input: { executionId: string; content: string; hints: string[] }) => Promise<{ jobId: string } | null>;
  /** Poll an async Zenod filing job; null when the job is unknown/unreachable. */
  pollMemoryJob: (jobId: string) => Promise<MemoryJobStatus | null>;
  now?: () => number;
  /** How many recent execution records to consider per pass. */
  limit?: number;
}

export interface IngestSweepResult {
  checked: number;
  refreshed: number;
  started: number;
  filed: number;
  skipped: number;
  gaveUp: number;
}

function ticketFromArtifactData(data: Record<string, unknown>): ExecutionTicket | null {
  if (typeof data.executionId !== "string" || typeof data.state !== "string") return null;
  return data as unknown as ExecutionTicket;
}

export async function runExecutionIngestSweep(deps: IngestSweepDeps): Promise<IngestSweepResult> {
  const now = deps.now ?? Date.now;
  const result: IngestSweepResult = { checked: 0, refreshed: 0, started: 0, filed: 0, skipped: 0, gaveUp: 0 };
  const records = deps.store.artifactsByKind("execution_record", deps.limit ?? 50);
  if (records.length === 0) return result;

  // One guard view across ALL journeys: the note files once per executionId even when
  // several journeys reference the same execution. Map key → the guard artifact.
  const guards = new Map(deps.store.artifactsByKind("zenod_ingest", 200).map((a) => [a.artifactKey, a]));

  for (const artifact of records) {
    const recorded = ticketFromArtifactData(artifact.data as Record<string, unknown>);
    const executionId = recorded?.executionId ?? artifact.artifactKey.replace(/^execution:/, "");
    if (!executionId) continue;
    const guardKey = `zenod-ingest:${executionId}`;
    const guard = guards.get(guardKey);
    const guardData = (guard?.data ?? null) as IngestGuardData | null;

    // Finished lifecycles never re-run. A legacy guard with NO status was written at
    // acceptance time by the pre-lifecycle code (its filing may have black-holed) —
    // treat it as unfinished: re-file and upgrade it to the pending lifecycle.
    if (guardData && guardData.status !== undefined && guardData.status !== "pending") continue;
    if (guard && guardData && guardData.status === undefined) {
      const ticketForLegacy = recorded && TERMINAL_STATES.has(recorded.state) ? recorded : await deps.readExecution(executionId);
      const legacyPacket = ticketForLegacy ? buildIngestPacket(ticketForLegacy) : null;
      if (!legacyPacket) {
        deps.store.updateArtifactData(guard.journeyId, guardKey, { executionId, status: "skipped" }, now());
        result.skipped += 1;
        continue;
      }
      const legacyJob = await deps.fileMemory({ executionId, ...legacyPacket });
      if (legacyJob) {
        deps.store.updateArtifactData(
          guard.journeyId,
          guardKey,
          { executionId, status: "pending", jobId: legacyJob.jobId, attempts: 1 },
          now(),
        );
        result.started += 1;
      }
      continue;
    }

    // A pending guard: poll its filing job and advance the lifecycle.
    if (guard && guardData?.status === "pending") {
      if (!guardData.jobId) continue; // malformed — leave for inspection
      const job = await deps.pollMemoryJob(guardData.jobId);
      if (!job || job.status === "queued" || job.status === "running") continue; // next pass
      if (job.status === "done") {
        deps.store.updateArtifactData(
          guard.journeyId,
          guardKey,
          { ...guardData, status: "filed", ...(job.evidenceRef ? { evidenceRef: job.evidenceRef } : {}) },
          now(),
        );
        result.filed += 1;
        continue;
      }
      // error / interrupted → re-file, bounded.
      const attempts = guardData.attempts ?? 1;
      if (attempts >= MAX_ATTEMPTS) {
        deps.store.updateArtifactData(
          guard.journeyId,
          guardKey,
          { ...guardData, status: "gave-up", error: job.error ?? job.status },
          now(),
        );
        result.gaveUp += 1;
        continue;
      }
      const ticketForRetry = recorded && TERMINAL_STATES.has(recorded.state) ? recorded : await deps.readExecution(executionId);
      const retryPacket = ticketForRetry ? buildIngestPacket(ticketForRetry) : null;
      if (!retryPacket) continue;
      const refiled = await deps.fileMemory({ executionId, ...retryPacket });
      if (refiled) {
        deps.store.updateArtifactData(
          guard.journeyId,
          guardKey,
          { ...guardData, jobId: refiled.jobId, attempts: attempts + 1 },
          now(),
        );
      }
      continue;
    }

    result.checked += 1;

    // Use the recorded ticket if it is already terminal; otherwise re-read the authority.
    let ticket: ExecutionTicket | null = recorded && TERMINAL_STATES.has(recorded.state) ? recorded : null;
    if (!ticket) {
      ticket = await deps.readExecution(executionId);
      if (!ticket || !TERMINAL_STATES.has(ticket.state)) continue; // still running/blocked — next pass
      deps.store.updateArtifactData(artifact.journeyId, artifact.artifactKey, ticket as unknown as Record<string, unknown>, now());
      result.refreshed += 1;
    }

    const packet = buildIngestPacket(ticket);
    if (!packet) {
      // Terminal but nothing to cite (no deliverable) — guard so we stop re-checking.
      const data: IngestGuardData = { executionId, status: "skipped" };
      const added = deps.store.addArtifact(artifact.journeyId, { kind: "zenod_ingest", artifactKey: guardKey, data }, now());
      guards.set(guardKey, added);
      result.skipped += 1;
      continue;
    }

    const startedJob = await deps.fileMemory({ executionId, ...packet });
    if (!startedJob) continue; // acceptance failed — no guard, retried next pass
    const data: IngestGuardData = { executionId, status: "pending", jobId: startedJob.jobId, attempts: 1 };
    const added = deps.store.addArtifact(artifact.journeyId, { kind: "zenod_ingest", artifactKey: guardKey, data }, now());
    guards.set(guardKey, added);
    result.started += 1;
  }
  return result;
}
