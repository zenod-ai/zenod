import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ExecutionQueue, type ExecutionEvent, type ExecutionTicket } from "../src/executionQueue.js";
import { JourneyStore } from "../src/journeyStore.js";
import { JourneyMonitor } from "../src/journeyMonitor.js";
import { createJourneyAuthorityReconciler, buildIngestPacket } from "../src/journeyAuthorityReconciler.js";
import {
  resolveDeliverableManifest,
  fetchDeliverableFiles,
  formatDeliverableResult,
  type GithubContentsReader,
} from "../src/executionDeliverable.js";

/**
 * R1-T5 — the #105 legal-matrix replay. Proves the whole R1 chain end to end:
 * ask → run (outward outcome w/ deliverable) → manifest on the ticket + reported edge
 * → journey ingest files ONE cited note (honest unmerged state) → recall finds it →
 * fetch returns the live file body at the head SHA of the unmerged draft PR.
 */
describe("R1 replay — #105 legal matrix (ask → run → ingest → recall → fetch)", () => {
  const deliverable = {
    repo: "AlfaBlok/idea_scraper",
    issue: 105,
    prUrl: "https://github.com/AlfaBlok/idea_scraper/pull/106",
    branch: "codex/issue-105-legal-matrix",
    headSha: "deadbeefcafe",
    merged: false, // the stranded draft — honesty is the whole point
    paths: ["ideascraper-vps-v1/telegram-bot/LEGAL_COMMERCIAL_DECISION_MATRIX.md"],
    handoffExcerpt: "Produced the legal/commercial decision matrix; opened a draft PR for review.",
  };
  const FILE_BODY = "# Legal / commercial decision matrix\n\n| Option | Legal risk | ...";

  it("carries the deliverable, files one honest cited note, and fetches the live unmerged file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-r1-replay-"));
    const store = new JourneyStore(join(dir, "journeys.sqlite"));
    try {
      // 1) ASK → RUN: the queue drives a dispatched run to an outward outcome that
      //    carries the reconstructed deliverable manifest.
      const events: ExecutionEvent[] = [];
      const q = new ExecutionQueue({
        concurrency: 1,
        now: () => 1,
        launch: () => {},
        ship: async () => "ship://x",
        report: (e) => events.push(e),
      });
      await q.enqueue({ executionId: "direct-105", target: "AlfaBlok/idea_scraper#105", context: "Produce a legal/commercial decision matrix" });
      await q.reportOutcome({ executionId: "direct-105", outward: true, evidenceUrl: deliverable.prUrl, deliverable });

      const ticket = q.get("direct-105") as ExecutionTicket;
      expect(ticket.state).toBe("needs-review");
      expect(ticket.deliverable).toEqual(deliverable);
      // The reported edge carries the manifest (so Archus/journey see it).
      expect(events.find((e) => e.state === "needs-review")?.deliverable).toEqual(deliverable);

      // 2) INGEST: a journey execution step reconciles to terminal and files exactly
      //    one cited note. Capture what would be stored to Zenod.
      const journey = store.create({ surface: "console", originalRequest: "produce the matrix" }, 1);
      const step = store.addStep(
        journey.id,
        { owner: "epaminon", title: "Run #105", input: { intent: "execution.issue.run", executionId: "direct-105" }, wakeAt: 1 },
        2,
      );
      const filed: string[] = [];
      const monitor = new JourneyMonitor(store, {
        now: () => 10,
        reconcileStep: createJourneyAuthorityReconciler({
          readExecution: async () => ticket,
          fileExecutionMemory: async ({ content }) => {
            filed.push(content);
            return { jobId: "job-105" };
          },
        }),
      });
      await monitor.runOnce();

      expect(step).toBeTruthy();
      expect(filed).toHaveLength(1);
      // The note is honest about the unmerged draft and carries the citation.
      expect(filed[0]).toContain("NOT merged yet");
      expect(filed[0]).toContain("pr=https://github.com/AlfaBlok/idea_scraper/pull/106");
      expect(filed[0]).toContain(deliverable.paths[0]);
      // The zenod_ingest guard artifact is recorded so it never re-files.
      const snap = store.snapshot(journey.id)!;
      expect(snap.artifacts.some((a) => a.kind === "zenod_ingest" && a.artifactKey === "zenod-ingest:direct-105")).toBe(true);

      // Sanity: the packet builder alone yields the same honest note.
      expect(buildIngestPacket(ticket)?.content).toContain("merged=false");

      // 3) RECALL → FETCH: resolve the manifest from the execution_record artifact the
      //    reconcile wrote, then fetch the live file at the head SHA (unmerged-safe).
      const artifacts = store.artifactsByKind("execution_record", 50);
      const resolved = resolveDeliverableManifest(artifacts, "AlfaBlok/idea_scraper#105");
      expect(resolved).toEqual(deliverable);

      const reads: Array<{ path: string; ref?: string }> = [];
      const read: GithubContentsReader = async (_repo, path, ref) => {
        reads.push({ path, ref });
        return FILE_BODY;
      };
      const fetched = await fetchDeliverableFiles(resolved!, read);
      expect(reads[0].ref).toBe("deadbeefcafe"); // read at head SHA of the unmerged draft
      expect(fetched.mergeState).toBe("PR open — NOT merged yet");
      const text = formatDeliverableResult(fetched);
      expect(text).toContain(FILE_BODY);
      expect(text).toContain("NOT merged yet");
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
