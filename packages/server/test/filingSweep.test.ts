import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine, VaultRepo, SqliteStateStore, type BrainEngine, type BrainLlm, type StoreResult } from "zenod";
import { awaitingVaultRecovery, TaskJobStore } from "../src/taskJobStore.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";

// EPIC-24 M3 round 2: 50 voice notes saved on 2026-11-10 were never filed. A rolling release left the old
// process's filing half-written in the shared vault; the new process's first drain then failed every queued
// filing job at once with a permanent error, and nothing put them back.

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function vaultFixture() {
  const root = await mkdtemp(join(tmpdir(), "zenod-filing-sweep-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
  await repo.commitAndPublish("fixture");
  const classify = vi.fn(async (input: { content: string }) => ({ confidence: 0.95, summary: "one idea", tags: [], pages: [], topics: [{
    topic: "Insurance", summary: "Insurance", confidence: 0.95, disposition: "integrate_page" as const,
    evidenceQuotes: [input.content.trim()], pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" as const }],
  }] }));
  const reconcile = vi.fn(async (request: any) => request.ideas.map((idea: any) => ({ kind: "add", ideaIds: [idea.id],
    sourceIds: request.addCandidates.filter((candidate: any) => candidate.ideaIds.includes(idea.id)).map((candidate: any) => candidate.id),
    sourceQuote: request.sources.find((source: any) => source.id === idea.sourceIds[0]).text,
    statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
  const state = new SqliteStateStore(join(root, "state.sqlite"));
  const engine = createEngine({ repo, state, llm: { classify, reconcile } as unknown as BrainLlm });
  const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-a");
  return { root, repo, engine, state, jobs, classify };
}

async function waitFor(check: () => boolean, ms = 20_000): Promise<void> {
  for (let waited = 0; !check(); waited += 20) {
    if (waited > ms) throw new Error("timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const receiptPath = (ref: string) => `Inbox/filing-${ref.slice(4, 14)}-${ref.split("#^")[1]}.md`;

describe("a filing job that meets another filing's half-written plan (EPIC-24 M3)", () => {
  it("waits for vault recovery instead of failing for good, then files once the vault is clean", async () => {
    const { repo, engine, state, jobs } = await vaultFixture();
    const captured = await engine.captureEvidence!({ content: "Insurance renewal is in October.", source: "selftest", contentType: "voice_note" });
    // The old process was cut off mid-filing: its receipt (for another note) is still uncommitted in the shared vault.
    const stray = join(repo.path, "Inbox", "filing-2026-11-10-e-abc123.md");
    await writeFile(stray, "---\nstatus: filing-record\n---\n");
    const queue = new TaskJobQueue(jobs, async () => engine);
    try {
      const job = queue.enqueue("enrich_memory", { content: "Insurance renewal is in October.", source: "selftest", contentType: "voice_note", evidenceRef: captured.evidenceRef }, `enrich:${captured.evidenceRef}`);
      await waitFor(() => jobs.get(job.id)?.status === "error");
      const failed = jobs.get(job.id)!;
      // Before the fix: "filing_unrecognized_local_changes", which nothing ever requeued.
      expect(failed.error).toBe("filing_recovery_pending");
      expect(awaitingVaultRecovery(failed)).toBe(true);
      // The other filing is resolved (published by the old process, or replayed by recovery): the job is put back.
      await rm(stray);
      expect(jobs.requeueFilingRecoveryBlocked()).toBe(1);
      queue.resume();
      await waitFor(() => jobs.get(job.id)?.status === "done");
      expect((jobs.get(job.id)!.result as StoreResult).filing).toBe("filed");
      expect(await readFile(join(repo.path, "Areas/Insurance.md"), "utf8")).toContain(captured.evidenceRef.split("#^")[1]);
    } finally { await queue.close(); jobs.close(); state.close(); }
  }, 30_000);

  it("still fails closed on unknown local changes that are not a filing", async () => {
    const { repo, engine, state, jobs } = await vaultFixture();
    const captured = await engine.captureEvidence!({ content: "Insurance renewal is in October.", source: "selftest" });
    await writeFile(join(repo.path, "Areas", "Stray.md"), "# Stray\n");
    await expect(engine.enrichEvidence!({ content: "Insurance renewal is in October.", source: "selftest", evidenceRef: captured.evidenceRef }))
      .rejects.toThrow("filing_unrecognized_local_changes");
    jobs.close(); state.close();
  }, 30_000);
});

describe("a closing queue (EPIC-24 M3)", () => {
  it("takes no new job after close, so a release never starts a filing it will cut off", async () => {
    const root = await mkdtemp(join(tmpdir(), "zenod-queue-close-")); roots.push(root);
    const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-a");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const enrichEvidence = vi.fn(async (input: { evidenceRef: string }) => {
      await gate;
      return { evidenceRef: input.evidenceRef, pagesTouched: [], filing: "filed", revision: { provider: "git", id: "x" }, urls: [] } as unknown as StoreResult;
    });
    const engine = { enrichEvidence, captureEvidence: vi.fn() } as unknown as BrainEngine;
    const queue = new TaskJobQueue(jobs, async () => engine);
    const first = queue.enqueue("enrich_memory", { content: "a", evidenceRef: "Log/2026-11-10.md#^e-aaaaaa" }, "enrich:a");
    const second = queue.enqueue("enrich_memory", { content: "b", evidenceRef: "Log/2026-11-10.md#^e-bbbbbb" }, "enrich:b");
    await waitFor(() => enrichEvidence.mock.calls.length === 1);
    const closing = queue.close();
    release();
    await closing;
    expect(enrichEvidence).toHaveBeenCalledTimes(1);
    expect(jobs.get(first.id)?.status).not.toBe("queued");
    expect(jobs.get(first.id)?.status).not.toBe("running");
    expect(jobs.get(second.id)?.status).toBe("queued");
    jobs.close();
  });
});

describe("the unfiled-entry sweep (EPIC-24 M3)", () => {
  it("files every entry that is filed nowhere exactly once, and a second run finds nothing", async () => {
    const { repo, engine, state, jobs, classify } = await vaultFixture();
    const filed = await engine.captureEvidence!({ content: "Insurance renewal is in October.", source: "mcp", contentType: "voice_note" });
    const lost = await engine.captureEvidence!({ content: "Axa is the insurance provider.", source: "mcp", contentType: "voice_note", capturedAt: "2026-10-02T09:00:00Z" });
    const noJob = await engine.captureEvidence!({ content: "The insurance policy number changed.", source: "mcp", contentType: "voice_note", capturedAt: "2026-09-12T18:30:00Z" });
    const queue = new TaskJobQueue(jobs, async () => engine);
    try {
      const done = queue.enqueue("enrich_memory", { content: "Insurance renewal is in October.", source: "mcp", contentType: "voice_note", evidenceRef: filed.evidenceRef }, `enrich:${filed.evidenceRef}`);
      await waitFor(() => jobs.get(done.id)?.status === "done");
      // The lost note's job ended the way the 2026-11-10 jobs did: an error after a release, never requeued.
      const lostJob = jobs.enqueue("enrich_memory", { content: "Axa is the insurance provider.", source: "mcp", contentType: "voice_note", capturedAt: "2026-10-02T09:00:00Z",
        evidenceRef: lost.evidenceRef, notifyCaptureCompletion: true }, `enrich:${lost.evidenceRef}`);
      const claimed = jobs.claimNextQueued()!;
      expect(claimed.id).toBe(lostJob.id);
      jobs.updateClaimed(claimed, { status: "error", error: "filing_unrecognized_local_changes" });

      expect((await engine.unfiledEvidence!(today())).map(input => input.evidenceRef)).toEqual([lost.evidenceRef, noJob.evidenceRef]);
      const calls = classify.mock.calls.length;
      const counts = await queue.refileUnfiled(today());
      expect(counts).toEqual({ found: 2, queued: 1, requeued: 1, active: 0, alreadyTried: 0 });
      // Requeued quietly: no chat "filed" message per back-filled note.
      expect(jobs.get(lostJob.id)?.input.notifyCaptureCompletion).toBeUndefined();
      const swept = jobs.enrichmentJobsFor(noJob.evidenceRef);
      expect(swept).toHaveLength(1);
      expect(swept[0]!.idempotencyKey).toBe(`enrich-sweep:${noJob.evidenceRef}`);
      await waitFor(() => jobs.get(lostJob.id)?.status === "done" && jobs.get(swept[0]!.id)?.status === "done");
      expect(classify.mock.calls.length - calls).toBe(2);

      expect(await engine.unfiledEvidence!(today())).toEqual([]);
      expect(await queue.refileUnfiled(today())).toEqual({ found: 0, queued: 0, requeued: 0, active: 0, alreadyTried: 0 });
      // Nothing filed twice: one receipt per note, and each note cited once on the page.
      const page = await readFile(join(repo.path, "Areas/Insurance.md"), "utf8");
      for (const ref of [filed.evidenceRef, lost.evidenceRef, noJob.evidenceRef]) {
        expect(await readFile(join(repo.path, receiptPath(ref)), "utf8")).toContain("filing-resolved");
        expect(page.split(`#^${ref.split("#^")[1]}`).length - 1).toBeGreaterThanOrEqual(1);
      }
      const receipts = (await readdir(join(repo.path, "Inbox"))).filter(name => name.startsWith("filing-"));
      expect(receipts).toHaveLength(3);
      expect(jobs.enrichmentJobsFor(lost.evidenceRef)).toHaveLength(1);
    } finally { await queue.close(); jobs.close(); state.close(); }
  }, 60_000);

  it("leaves an entry whose filing job is still queued alone, and does not sweep the same entry twice", async () => {
    const { engine, state, jobs } = await vaultFixture();
    const captured = await engine.captureEvidence!({ content: "Insurance renewal is in October.", source: "mcp" });
    const queue = new TaskJobQueue(jobs, async () => engine);
    try {
      const waiting = jobs.enqueue("enrich_memory", { content: "Insurance renewal is in October.", source: "mcp", evidenceRef: captured.evidenceRef }, `enrich:${captured.evidenceRef}`);
      // Not drained yet: the sweep must see it as active.
      expect(await queue.refileUnfiled(today())).toMatchObject({ found: 1, active: 1, queued: 0, requeued: 0 });
      expect(jobs.get(waiting.id)?.status).toBe("queued");
      // A swept job that ended without filing is not tried again by the next sweep.
      const claimed = jobs.claimNextQueued()!;
      jobs.updateClaimed(claimed, { status: "error", error: "synthetic" });
      expect(jobs.requeueSwept(waiting.id)).toBe(true);
      const again = jobs.claimNextQueued()!;
      jobs.updateClaimed(again, { status: "error", error: "synthetic" });
      expect(await queue.refileUnfiled(today())).toMatchObject({ found: 1, alreadyTried: 1, queued: 0, requeued: 0 });
    } finally { await queue.close(); jobs.close(); state.close(); }
  }, 30_000);
});
