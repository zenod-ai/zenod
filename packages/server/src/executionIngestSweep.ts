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
 * files the cited meaning note to Zenod exactly once per executionId — guarded by
 * a zenod_ingest artifact, exactly like the reconciler branch.
 */

const TERMINAL_STATES = new Set(["done", "needs-review", "approved", "failed"]);

export interface IngestSweepDeps {
  store: JourneyStore;
  /** Read the live ticket from the execution authority; null on miss/failure. */
  readExecution: (reference: string) => Promise<ExecutionTicket | null>;
  /** File the note to Zenod; null on failure (sweep retries next pass). */
  fileMemory: (input: { executionId: string; content: string; hints: string[] }) => Promise<{ evidenceRef?: string } | null>;
  now?: () => number;
  /** How many recent execution records to consider per pass. */
  limit?: number;
}

export interface IngestSweepResult {
  checked: number;
  refreshed: number;
  filed: number;
  skipped: number;
}

function ticketFromArtifactData(data: Record<string, unknown>): ExecutionTicket | null {
  if (typeof data.executionId !== "string" || typeof data.state !== "string") return null;
  return data as unknown as ExecutionTicket;
}

export async function runExecutionIngestSweep(deps: IngestSweepDeps): Promise<IngestSweepResult> {
  const now = deps.now ?? Date.now;
  const result: IngestSweepResult = { checked: 0, refreshed: 0, filed: 0, skipped: 0 };
  const records = deps.store.artifactsByKind("execution_record", deps.limit ?? 50);
  if (records.length === 0) return result;

  // One guard set across ALL journeys: the note files once per executionId even when
  // several journeys reference the same execution.
  const guarded = new Set(deps.store.artifactsByKind("zenod_ingest", 200).map((a) => a.artifactKey));

  for (const artifact of records) {
    const recorded = ticketFromArtifactData(artifact.data as Record<string, unknown>);
    const executionId = recorded?.executionId ?? artifact.artifactKey.replace(/^execution:/, "");
    if (!executionId) continue;
    const guardKey = `zenod-ingest:${executionId}`;
    if (guarded.has(guardKey)) continue;
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
      deps.store.addArtifact(
        artifact.journeyId,
        { kind: "zenod_ingest", artifactKey: guardKey, data: { executionId, skipped: "no deliverable" } },
        now(),
      );
      guarded.add(guardKey);
      result.skipped += 1;
      continue;
    }

    const filed = await deps.fileMemory({ executionId, ...packet });
    if (!filed) continue; // no guard written — retried on the next pass
    deps.store.addArtifact(
      artifact.journeyId,
      {
        kind: "zenod_ingest",
        artifactKey: guardKey,
        data: { executionId, ...(filed.evidenceRef ? { evidenceRef: filed.evidenceRef } : {}) },
      },
      now(),
    );
    guarded.add(guardKey);
    result.filed += 1;
  }
  return result;
}
