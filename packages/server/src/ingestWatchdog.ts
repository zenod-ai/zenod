import type { IngestJob } from "./ingestStore.js";

/**
 * M-5 — stuck-job watchdog: an ingest job that has been active (queued/downloading/
 * transcribing/filing) for over 10 minutes with no terminal state gets ONE Phylax
 * operator alert, not a repeat every sweep tick. A restart already resets any
 * mid-flight job to "interrupted" (IngestStore's constructor), so alert-state never
 * needs to survive a restart — only the current process's ticks.
 */
export const STUCK_INGEST_THRESHOLD_MS = 10 * 60 * 1000;

export interface StuckIngestAlert {
  jobId: string;
  fileName: string;
  status: IngestJob["status"];
  ageMs: number;
}

/**
 * Pure decision: given the currently stale-active jobs and the ids already alerted,
 * return the NEW alerts to send plus the updated alerted-id set to keep for the next
 * tick. A job's alert-state clears once it leaves the stale-active set (it went
 * terminal, or was reset by a restart), so a later stuck episode on the same job id
 * alerts again rather than being silenced forever.
 */
export function detectStuckIngestJobs(
  staleActiveJobs: readonly IngestJob[],
  alreadyAlerted: ReadonlySet<string>,
  now: number,
): { alerts: StuckIngestAlert[]; alertedIds: Set<string> } {
  const stillStale = new Set(staleActiveJobs.map((job) => job.id));
  const alertedIds = new Set([...alreadyAlerted].filter((id) => stillStale.has(id)));
  const alerts: StuckIngestAlert[] = [];
  for (const job of staleActiveJobs) {
    if (alertedIds.has(job.id)) continue;
    alertedIds.add(job.id);
    alerts.push({ jobId: job.id, fileName: job.fileName, status: job.status, ageMs: now - job.createdAt });
  }
  return { alerts, alertedIds };
}

export function formatStuckIngestAlert(alert: StuckIngestAlert): string {
  const minutes = Math.max(1, Math.round(alert.ageMs / 60_000));
  return `⚠️ Ingest job stuck: "${alert.fileName}" has been "${alert.status}" for ~${minutes}min with no terminal state (${alert.jobId}).`;
}
