import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, expect, it, vi } from "vitest";
import { createEngine, VaultRepo, SqliteStateStore, type BrainLlm } from "zenod";
import { TaskJobStore } from "../src/taskJobStore.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const until = async (check: () => boolean, ms = 40_000) => { for (let i = 0; i < ms / 20 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 20)); };

it.each(["before-page", "before-push"] as const)("self-heals an interrupted filing, then retries the writes it blocked (%s)", async crash => {
  const root = await mkdtemp(join(tmpdir(), "zenod-vault-recovery-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
  await repo.commitAndPublish("fixture");
  const content = "Insurance renewal is in October.";
  const classify = vi.fn(async () => ({ confidence: 0.95, summary: "renewal", tags: [], pages: [], topics: [{
    topic: "Renewal", summary: "Renewal", confidence: 0.95, disposition: "integrate_page" as const,
    evidenceQuotes: [content], pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" as const }] }] }));
  const reconcile = vi.fn(async (request: any) => request.ideas.map((idea: any) => ({ kind: "add", ideaIds: [idea.id],
    sourceIds: request.addCandidates.filter((candidate: any) => candidate.ideaIds.includes(idea.id)).map((candidate: any) => candidate.id),
    sourceQuote: request.sources.find((source: any) => source.id === idea.sourceIds[0]).text, statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
  const state = new SqliteStateStore(join(root, "state.sqlite"));
  const engine = createEngine({ repo, state, llm: { classify, reconcile } as unknown as BrainLlm });
  const captured = await engine.captureEvidence!({ content, source: "whatsapp", sourceId: "interrupted" });

  // The process dies in the middle of filing: receipt pending in the tree, or committed but never pushed.
  let checks = 0;
  if (crash === "before-push") vi.spyOn(repo, "commitAndPublish").mockImplementationOnce(async message => { await repo.commit(message); throw new Error("synthetic crash"); });
  await expect(engine.enrichEvidence!({ content, source: "whatsapp", sourceId: "interrupted", evidenceRef: captured.evidenceRef,
    assertActive: () => { if (crash === "before-page" && ++checks >= 5) throw new Error("synthetic crash"); } })).rejects.toThrow("synthetic crash");
  await expect(engine.captureEvidence!({ content: "blocked", source: "selftest" })).rejects.toThrow("filing_recovery_pending");

  const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-a");
  // The enrichment job that owned the filing gave up after the restart; its input still has the exact bytes.
  const owner = jobs.enqueue("enrich_memory", { content, source: "whatsapp", sourceId: "interrupted", evidenceRef: captured.evidenceRef }, "enrich:interrupted");
  jobs.update(owner.id, { status: "interrupted", error: "interrupted by a server restart (gave up after 3 retries)" });
  const lines: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => { lines.push(String(line)); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const queue = new TaskJobQueue(jobs, async () => engine);
  try {
    // A normal write trips the guard, which starts recovery; the write is retried afterwards.
    const blocked = queue.enqueue("store", { content: "a brand new note", source: "whatsapp", sourceId: "after-incident" });
    await until(() => jobs.get(blocked.id)?.status === "done" && jobs.get(owner.id)?.status === "done");
    expect(jobs.get(owner.id)).toMatchObject({ status: "done", result: expect.objectContaining({ filing: "filed" }) });
    expect(jobs.get(blocked.id)?.status).toBe("done");
    expect(await engine.inspectInterruptedFiling!()).toMatchObject({ interrupted: false });
    expect((await repo.currentPublishedRevision()).id).toBe(await repo.headSha());
    expect(lines.some(line => line.startsWith("[vault-recovery] interrupted filing found:") && line.includes(captured.evidenceRef))).toBe(true);
    expect(lines.some(line => line.startsWith("[vault-recovery] recovered; writes unblocked"))).toBe(true);
    expect(lines.join("\n")).not.toContain("a brand new note");
  } finally { await queue.close(); jobs.close(); state.close(); }
}, 90_000);

it("recovers an interrupted filing when the tenant runtime starts, before any save fails (ZAL-A8)", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenod-vault-recovery-start-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
  await repo.commitAndPublish("fixture");
  const content = "Insurance renewal is in October.";
  const classify = vi.fn(async () => ({ confidence: 0.95, summary: "renewal", tags: [], pages: [], topics: [{
    topic: "Renewal", summary: "Renewal", confidence: 0.95, disposition: "integrate_page" as const,
    evidenceQuotes: [content], pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" as const }] }] }));
  const reconcile = vi.fn(async (request: any) => request.ideas.map((idea: any) => ({ kind: "add", ideaIds: [idea.id],
    sourceIds: request.addCandidates.filter((candidate: any) => candidate.ideaIds.includes(idea.id)).map((candidate: any) => candidate.id),
    sourceQuote: request.sources.find((source: any) => source.id === idea.sourceIds[0]).text, statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
  const state = new SqliteStateStore(join(root, "state.sqlite"));
  const engine = createEngine({ repo, state, llm: { classify, reconcile } as unknown as BrainLlm });
  const captured = await engine.captureEvidence!({ content, source: "whatsapp", sourceId: "interrupted" });
  vi.spyOn(repo, "commitAndPublish").mockImplementationOnce(async message => { await repo.commit(message); throw new Error("synthetic crash"); });
  await expect(engine.enrichEvidence!({ content, source: "whatsapp", sourceId: "interrupted", evidenceRef: captured.evidenceRef,
    assertActive: () => {} })).rejects.toThrow("synthetic crash");

  const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-a");
  const owner = jobs.enqueue("enrich_memory", { content, source: "whatsapp", sourceId: "interrupted", evidenceRef: captured.evidenceRef }, "enrich:interrupted");
  jobs.update(owner.id, { status: "error", error: "interrupted by a server restart (gave up after 1 retries)" });
  // A save the guard refused before the restart: the start check retries it once the vault is clean.
  const refused = jobs.enqueue("store", { content: "refused before the restart", source: "whatsapp", sourceId: "refused" });
  jobs.update(refused.id, { status: "error", error: "Error: filing_recovery_pending" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const queue = new TaskJobQueue(jobs, async () => engine);
  try {
    queue.resumeAtStart(0);
    await until(() => jobs.get(owner.id)?.status === "done" && jobs.get(refused.id)?.status === "done");
    expect(jobs.get(owner.id)?.status).toBe("done");
    expect(jobs.get(refused.id)?.status).toBe("done");
    expect(await engine.inspectInterruptedFiling!()).toMatchObject({ interrupted: false });
    expect((await repo.currentPublishedRevision()).id).toBe(await repo.headSha());
  } finally { await queue.close(); jobs.close(); state.close(); }
}, 90_000);

it("requeues only capture jobs that failed on the guard, and leaves a clean vault alone", () => {
  const jobs = new TaskJobStore(join(tmpdirSync(), "j.sqlite"), "tenant-a");
  const blocked = jobs.enqueue("store", { content: "x", source: "whatsapp" }); jobs.update(blocked.id, { status: "error", error: "filing_recovery_pending" });
  const other = jobs.enqueue("store", { content: "y", source: "whatsapp" }); jobs.update(other.id, { status: "error", error: "provider exploded" });
  const chat = jobs.enqueue("chat", { text: "hi" }); jobs.update(chat.id, { status: "error", error: "filing_recovery_pending" });
  expect(jobs.requeueFilingRecoveryBlocked()).toBe(1);
  expect(jobs.get(blocked.id)).toMatchObject({ status: "queued", attempts: 0 });
  expect(jobs.get(other.id)?.status).toBe("error"); expect(jobs.get(chat.id)?.status).toBe("error");
  expect(jobs.requeueForRecovery(blocked.id)).toBe(false); // already queued: never touched
  jobs.close();
});

import { mkdtempSync } from "node:fs";
const tmpdirSync = () => mkdtempSync(join(tmpdir(), "zenod-vr-store-"));
