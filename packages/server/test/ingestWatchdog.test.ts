import { describe, expect, it } from "vitest";
import { detectStuckIngestJobs, formatStuckIngestAlert, STUCK_INGEST_THRESHOLD_MS } from "../src/ingestWatchdog.js";
import type { IngestJob } from "../src/ingestStore.js";

function job(overrides: Partial<IngestJob> = {}): IngestJob {
  return {
    id: "job-1",
    driveFileId: "drive-1",
    fileName: "Zenod 3.m4a",
    hints: [],
    status: "transcribing",
    progress: 40,
    step: "Transcribing",
    error: null,
    evidenceRef: null,
    pages: [],
    commitSha: null,
    backlog: null,
    archived: false,
    cached: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("detectStuckIngestJobs (M-5)", () => {
  it("alerts once for a newly-stale job", () => {
    const now = STUCK_INGEST_THRESHOLD_MS + 60_000;
    const { alerts, alertedIds } = detectStuckIngestJobs([job()], new Set(), now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ jobId: "job-1", fileName: "Zenod 3.m4a", status: "transcribing" });
    expect(alertedIds.has("job-1")).toBe(true);
  });

  it("does not re-alert a job already alerted while it stays stale", () => {
    const now = STUCK_INGEST_THRESHOLD_MS + 60_000;
    const first = detectStuckIngestJobs([job()], new Set(), now);
    const second = detectStuckIngestJobs([job()], first.alertedIds, now + 30_000);
    expect(second.alerts).toHaveLength(0);
    expect(second.alertedIds.has("job-1")).toBe(true);
  });

  it("clears alert-state once the job leaves the stale-active set (finished or reset)", () => {
    const now = STUCK_INGEST_THRESHOLD_MS + 60_000;
    const first = detectStuckIngestJobs([job()], new Set(), now);
    // Job no longer stale-active (done, or restart-interrupted) — not passed in.
    const second = detectStuckIngestJobs([], first.alertedIds, now + 30_000);
    expect(second.alertedIds.has("job-1")).toBe(false);

    // A LATER stuck episode on the same id must alert again, not stay silenced.
    const third = detectStuckIngestJobs([job()], second.alertedIds, now + 700_000);
    expect(third.alerts).toHaveLength(1);
  });

  it("handles multiple distinct stuck jobs independently", () => {
    const now = STUCK_INGEST_THRESHOLD_MS + 60_000;
    const jobs = [job({ id: "a" }), job({ id: "b", fileName: "Other.m4a" })];
    const { alerts, alertedIds } = detectStuckIngestJobs(jobs, new Set(), now);
    expect(alerts.map((a) => a.jobId).sort()).toEqual(["a", "b"]);
    expect(alertedIds.size).toBe(2);
  });
});

describe("formatStuckIngestAlert", () => {
  it("renders a readable operator alert with the file name, state, and age", () => {
    const text = formatStuckIngestAlert({ jobId: "job-1", fileName: "Zenod 3.m4a", status: "transcribing", ageMs: 12 * 60_000 });
    expect(text).toContain("Zenod 3.m4a");
    expect(text).toContain("transcribing");
    expect(text).toContain("~12min");
    expect(text).toContain("job-1");
  });
});
