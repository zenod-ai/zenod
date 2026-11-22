import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    // EPIC-24 M25: every vault-recovery line ends with its tenant, so the health page can pair UNRESOLVED with "recovered".
    expect(lines.filter(line => line.startsWith("[vault-recovery]")).every(line => line.endsWith(" tenant=tenant-a"))).toBe(true);
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

it("sets aside what a killed tree sweep left uncommitted, keeps every byte, then lets saves and enrichments through (EPIC-24 M31)", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenod-vault-recovery-sweep-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
  // Two filing receipts the weekly sweep had not yet archived when the container was replaced.
  const receipts = ["Inbox/filing-2026-11-09-e-95ec58.md", "Inbox/filing-2026-11-10-e-23248c.md"];
  for (const path of receipts) await writeFile(join(repo.path, path), `---\nstatus: filing-resolved\n---\nreceipt of ${path}\n`);
  await repo.commitAndPublish("fixture with receipts");
  const published = await repo.headSha();
  // The sweep copies each receipt into Archive/ and removes the original, edits a page, and dies before its one commit.
  await mkdir(join(repo.path, "Archive/Inbox"), { recursive: true });
  const archived = receipts.map(path => ({ path, copy: `Archive/Inbox/${path.split("/").pop()}`, body: `receipt of ${path}` }));
  for (const { path, copy, body } of archived) {
    await writeFile(join(repo.path, copy), `---\nstatus: filing-resolved\n---\n${body}\n`);
    await rm(join(repo.path, path));
  }
  await appendFile(join(repo.path, "Areas/Insurance.md"), "\nA line the sweep added to a page.\n");
  const state = new SqliteStateStore(join(root, "state.sqlite"));
  const engine = createEngine({ repo, state, llm: { classify: vi.fn(), reconcile: vi.fn() } as unknown as BrainLlm });
  expect(await engine.inspectInterruptedFiling!()).toMatchObject({ interrupted: true, conditions: ["pending_receipt"], headPublished: true,
    receipts: [{ phase: "unreadable" }, { phase: "unreadable" }] });
  await expect(engine.captureEvidence!({ content: "blocked", source: "selftest" })).rejects.toThrow("filing_recovery_pending");

  const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-a");
  const refused = jobs.enqueue("store", { content: "a note Jordi sent while the vault was blocked", source: "whatsapp", sourceId: "refused" });
  jobs.update(refused.id, { status: "error", error: "Error: filing_recovery_pending" });
  const lines: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => { lines.push(String(line)); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const queue = new TaskJobQueue(jobs, async () => engine);
  try {
    const next = queue.enqueue("store", { content: "a brand new note after the recovery", source: "whatsapp", sourceId: "after-incident" });
    await until(() => jobs.get(next.id)?.status === "done" && jobs.get(refused.id)?.status === "done");
    expect(jobs.get(next.id)?.status).toBe("done");
    expect(jobs.get(refused.id)?.status).toBe("done");
    expect(await engine.inspectInterruptedFiling!()).toMatchObject({ interrupted: false });
    // The working tree is the published head again: the receipts are back, the sweep's copies and edit are gone from it ...
    for (const path of receipts) expect(await readFile(join(repo.path, path), "utf8")).toContain("filing-resolved");
    expect(await readFile(join(repo.path, "Areas/Insurance.md"), "utf8")).not.toContain("the sweep added");
    // ... and every byte of the abandoned state is kept on a side ref that descends from the published head.
    const git = simpleGit(repo.path);
    const refs = (await git.raw(["for-each-ref", "--format=%(refname)", "refs/zenod/set-aside/"])).trim().split("\n").filter(Boolean);
    expect(refs).toHaveLength(1);
    expect((await git.raw(["rev-parse", `${refs[0]}^1`])).trim()).toBe(published);
    // The side commit records the dirty tree itself (the receipts are deleted in it, still in its parent).
    expect((await git.raw(["diff", "--name-status", `${refs[0]}^1`, refs[0]!])).trim().split("\n").sort())
      .toEqual([...receipts.map(path => `D\t${path}`), "M\tAreas/Insurance.md"].sort());
    for (const path of receipts) expect(await git.raw(["show", `${refs[0]}^1:${path}`])).toContain("filing-resolved");
    expect(await git.raw(["show", `${refs[0]}:Areas/Insurance.md`])).toContain("A line the sweep added to a page.");
    expect(await git.raw(["show", `${refs[0]}^3:${archived[0]!.copy}`])).toContain(archived[0]!.body);
    // Nothing of the published history changed, and the new note is published beside it.
    expect((await git.raw(["merge-base", "--is-ancestor", published, "HEAD"]).then(() => true, () => false))).toBe(true);
    expect((await repo.currentPublishedRevision()).id).toBe(await repo.headSha());
    expect(lines.some(line => line.startsWith("[vault-recovery] set aside uncommitted changes no filing can replay"))).toBe(true);
    expect(lines.some(line => line.startsWith("[vault-recovery] recovered; writes unblocked"))).toBe(true);
    expect(lines.filter(line => line.startsWith("[vault-recovery]")).every(line => line.endsWith(" tenant=tenant-a"))).toBe(true);
    expect(lines.join("\n")).not.toContain("a brand new note");
  } finally { await queue.close(); jobs.close(); state.close(); }
}, 90_000);

it("does not set aside a replayable receipt, an unpublished head or a clean tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenod-vault-recovery-noset-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
  await repo.commitAndPublish("fixture");
  const state = new SqliteStateStore(join(root, "state.sqlite"));
  const engine = createEngine({ repo, state, llm: { classify: vi.fn(), reconcile: vi.fn() } as unknown as BrainLlm });
  try {
    expect(await engine.setAsideAbandonedChanges!()).toEqual({ status: "clean" });
    // An unpublished local commit: the head is not published, so nothing is touched.
    await writeFile(join(repo.path, "Inbox/filing-2026-11-09-e-95ec58.md"), "x");
    await repo.commit("local only");
    await rm(join(repo.path, "Inbox/filing-2026-11-09-e-95ec58.md"));
    await writeFile(join(repo.path, "Areas/Unsaved.md"), "kept in place\n");
    expect(await engine.setAsideAbandonedChanges!()).toEqual({ status: "not_eligible" });
    expect(await readFile(join(repo.path, "Areas/Unsaved.md"), "utf8")).toBe("kept in place\n");
    expect(await simpleGit(repo.path).raw(["for-each-ref", "refs/zenod/"])).toBe("");
  } finally { state.close(); }
}, 60_000);

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
