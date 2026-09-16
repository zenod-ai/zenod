import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine, VaultRepo, SqliteStateStore, VaultPublicationError, type BrainEngine, type BrainLlm } from "zenod";
import { TaskJobStore } from "../src/taskJobStore.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("supported queue filing replay", () => {
  it.each([false, true, "mixed"] as const)("resumes only unfinished work through the real queue (recovery mode: %s)", async mode => {
    const publicationFailure=mode===true; const mixed=mode==="mixed";
    const root = await mkdtemp(join(tmpdir(), "zenod-queue-filing-")); roots.push(root);
    const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
    const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
    await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
    await repo.commitAndPublish("fixture");
    const content = "Insurance renewal is in October. Axa is the provider.";
    const paths = mixed ? ["Areas/Insurance.md", "Areas/Insurance.md"] : ["Areas/Insurance.md", "Notes/Axa.md"];
    const classify = vi.fn(async () => ({ confidence: 0.95, summary: "two ideas", tags: [], pages: [], topics: paths.map((path, index) => ({
      topic: `Idea ${index + 1}`, summary: `Idea ${index + 1}`, confidence: 0.95, disposition: "integrate_page" as const,
      evidenceQuotes: [index ? "Axa is the provider." : "Insurance renewal is in October."], pages: [{ path, title: index ? "Axa" : "Insurance", action: "update" as const }],
    })) }));
    let failedOnce = false;
    const reconcile = vi.fn(async (request: any) => {
      if (!mixed && !publicationFailure && request.path === paths[1] && !failedOnce) { failedOnce = true; throw new Error("synthetic transient provider outage"); }
      const operations=request.ideas.map((idea: any) => ({ kind: "add", ideaIds: [idea.id], sourceIds: request.addCandidates.filter((candidate:any)=>candidate.ideaIds.includes(idea.id)).map((candidate:any)=>candidate.id),
        sourceQuote: mixed ? (idea.topic==="Idea 1" ? "Insurance renewal is in October." : "Axa is the provider.") : request.sources.find((source: any) => source.id === idea.sourceIds[0]).text,
        statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null }));
      if(mixed && !failedOnce) {failedOnce=true;return [...operations,{...operations[0],kind:"link_source",sourceIds:request.ideas[0].sourceIds,sourceQuote:":123:456",targetId:"missing"}];}
      if(mixed) {
        expect(request.ideas.map((idea:any)=>idea.topic)).toEqual(["Idea 1"]);
        expect(request.ideas[0].priorFailure).toContain("source_support_invalid");
      }
      return operations;
    });
    const state = new SqliteStateStore(join(root, "state.sqlite"));
    const engine = createEngine({ repo, state, llm: { classify, reconcile } as unknown as BrainLlm });
    const captured = await engine.captureEvidence!({ content, source: "selftest", sourceId: "queue-fixture" });
    const logPath = join(repo.path, captured.evidenceRef.split("#")[0]!); const raw = await readFile(logPath, "utf8");
    const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-a");
    const queue = new TaskJobQueue(jobs, async () => engine);
    if (publicationFailure) vi.spyOn(repo, "commitAndPublish").mockImplementationOnce(async () => {
      throw new VaultPublicationError({ code: "partial_recovering", message: "synthetic provider recovery required", retryable: true, transactionId: "fixture", paths });
    });
    const expectedCalls = publicationFailure || mixed ? 2 : 3;
    try {
      const input = { content, source: "selftest" as const, sourceId: "queue-fixture", evidenceRef: captured.evidenceRef };
      const job = queue.enqueue("enrich_memory", input, "enrich:tenant-a:queue-fixture");
      for (let i = 0; i < 500 && jobs.get(job.id)?.status !== "done"; i++) await new Promise(resolve => setTimeout(resolve, 20));
      const done = jobs.get(job.id)!;
      expect(done.status).toBe("done"); expect(done.attempts).toBe(1);
      expect(done.result).toMatchObject({ filing: "filed", topics: [expect.objectContaining({ status: "filed" }), expect.objectContaining({ status: "filed" })] });
      expect(classify).toHaveBeenCalledTimes(1); expect(reconcile).toHaveBeenCalledTimes(expectedCalls);
      expect(reconcile.mock.calls.map(([request]) => request.path)).toEqual(publicationFailure || mixed ? paths : [paths[0], paths[1], paths[1]]);
      for (const path of paths) expect((await readFile(join(repo.path, path), "utf8")).match(/<!-- zenod-op:/g)).toHaveLength(mixed ? 2 : 1);
      const receiptPath = `Inbox/filing-${captured.evidenceRef.slice(4, 14)}-${captured.evidenceRef.split("#^")[1]}.md`;
      expect(await readFile(join(repo.path, receiptPath), "utf8")).toContain("status: filing-resolved");
      expect(await readFile(logPath, "utf8")).toBe(raw);
      const published = await repo.currentPublishedRevision();
      expect(queue.enqueue("enrich_memory", input, "enrich:tenant-a:queue-fixture").id).toBe(job.id);
      await queue.close();
      expect(reconcile).toHaveBeenCalledTimes(expectedCalls); expect((await repo.currentPublishedRevision()).id).toBe(published.id);
    } finally { await queue.close(); jobs.close(); state.close(); }
  }, 30_000);
});

it("lets the winning queue recover publication when the original lease expires before its response", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenod-queue-lease-publication-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true }); await repo.commitAndPublish("fixture");
  const content = "Insurance renewal is in October.";
  const classify = vi.fn(async () => ({ confidence: 0.95, summary: "renewal", tags: [], pages: [], topics: [{ topic: "renewal", summary: "renewal", confidence: 0.95, disposition: "integrate_page", evidenceQuotes: [content], pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" }] }] }));
  const reconcile = vi.fn(async (request: any) => request.ideas.map((idea: any) => ({ kind: "add", ideaIds: [idea.id], sourceIds: idea.sourceIds, sourceQuote: request.sources[0].text, statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
  const state = new SqliteStateStore(join(root, "state.sqlite")); const engine = createEngine({ repo, state, llm: { classify, reconcile } as unknown as BrainLlm });
  const captured = await engine.captureEvidence!({ content, source: "selftest" });
  const input = { content, source: "selftest" as const, evidenceRef: captured.evidenceRef };
  const path = join(root, "jobs.sqlite"); const original = new TaskJobStore(path, "tenant"); const queue = new TaskJobQueue(original, async () => engine);
  let winner: TaskJobStore | undefined; let winningQueue: TaskJobQueue | undefined; let clock: ReturnType<typeof vi.spyOn> | undefined;
  let oldClaim: ReturnType<TaskJobStore["get"]>;
  const publish = repo.commitAndPublish.bind(repo);
  vi.spyOn(repo, "commitAndPublish").mockImplementationOnce(async (message, guard) => {
    const result = await publish(message, guard); // Provider accepted the write; its response is still in flight.
    oldClaim = original.recent()[0]!;
    const future = Date.now() + 5 * 60_000;
    clock = vi.spyOn(Date, "now").mockReturnValue(future);
    winner = new TaskJobStore(path, "tenant");
    winningQueue = new TaskJobQueue(winner, async () => engine);
    winningQueue.enqueue("enrich_memory", input, "lease-fixture");
    return result;
  });
  try {
    const job = queue.enqueue("enrich_memory", input, "lease-fixture");
    for (let i = 0; i < 500 && winner?.get(job.id)?.status !== "done"; i++) await new Promise(resolve => setTimeout(resolve, 20));
    expect(winner?.get(job.id)).toMatchObject({ status: "done", result: { filing: "filed" } });
    expect(oldClaim).toBeDefined(); expect(original.updateClaimed(oldClaim!, { status: "done" })).toBe(false);
    expect(classify).toHaveBeenCalledTimes(1); expect(reconcile).toHaveBeenCalledTimes(1);
    expect((await readFile(join(repo.path, "Areas/Insurance.md"), "utf8")).match(/<!-- zenod-op:/g)).toHaveLength(1);
  } finally { await queue.close(); await winningQueue?.close(); original.close(); winner?.close(); state.close(); clock?.mockRestore(); }
}, 30_000);


it("exhausts the shared provider retry budget truthfully without fabricating a durable result", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenod-queue-publication-exhausted-")); roots.push(root);
  const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant");
  const enrichEvidence = vi.fn(async () => { throw new VaultPublicationError({ code: "partial_recovering", message: "provider still recovering", retryable: true, transactionId: "fixture", paths: ["Notes/Idea.md"] }); });
  const queue = new TaskJobQueue(jobs, async () => ({ enrichEvidence }) as unknown as BrainEngine);
  try {
    const job = queue.enqueue("enrich_memory", { evidenceRef: "Log/2026-09-13.md#^e-fixture", content: "source" });
    for (let i = 0; i < 100 && jobs.get(job.id)?.status !== "error"; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(jobs.get(job.id)).toMatchObject({ status: "error", attempts: 1, result: null, error: "provider still recovering" });
    expect(enrichEvidence).toHaveBeenCalledTimes(2);
  } finally { await queue.close(); jobs.close(); }
});


it("queued conversational capture keeps one original and files three topics without blocking its chat job", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenod-chat-capture-")); roots.push(root);
  const bare = join(root, "origin.git"); await mkdir(bare); await simpleGit(bare).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ workdir: join(root, "vault"), remoteUrl: bare });
  await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), repo.path, { recursive: true });
  for (const title of ["Kiln", "Garden"]) await writeFile(join(repo.path, `Notes/${title}.md`), `---\ntitle: ${title}\ntype: note\ntags: []\ncreated: 2026-09-16\nupdated: 2026-09-16\nsummary: ${title} notes.\n---\n\n# ${title}\n`);
  await repo.commitAndPublish("fixture");
  const quotes = ["Insurance renewal is in October.", "Kiln reservation is on Tuesday.", "Garden pump was repaired."];
  const paths = ["Areas/Insurance.md", "Notes/Kiln.md", "Notes/Garden.md"];
  const original = `Please save these three updates: ${quotes.join(" ")}`;
  const classify = vi.fn(async () => ({ confidence: 0.95, summary: "three ideas", tags: [], pages: [], topics: paths.map((path, i) => ({
    topic: `Idea ${i}`, summary: `Idea ${i}`, confidence: 0.95, disposition: "integrate_page", evidenceQuotes: [quotes[i]], pages: [{ path, title: `Idea ${i}`, action: "update" }],
  })) }));
  const reconcile = vi.fn(async (request: any) => request.ideas.map((idea: any) => ({ kind: "add", ideaIds: [idea.id],
    sourceIds: request.addCandidates.filter((candidate: any) => candidate.ideaIds.includes(idea.id)).map((candidate: any) => candidate.id),
    sourceQuote: request.sources.find((source: any) => source.id === idea.sourceIds[0]).text,
    statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
  const state = new SqliteStateStore(join(root, "state.sqlite"));
  const jobs = new TaskJobStore(join(root, "jobs.sqlite"), "tenant-chat");
  let queue: TaskJobQueue;
  const answer = vi.fn(async (_input: unknown, _reads: unknown, tools: any) => {
    const results = await Promise.all(quotes.map(content => tools.captureNote(content)));
    expect(results[0]).toBe(results[1]); expect(results[1]).toBe(results[2]);
    return { text: "Nothing was changed", readPaths: [] };
  });
  const engine = createEngine({ repo, state, llm: { classify, reconcile, answer } as unknown as BrainLlm,
    enqueueEnrichment: (input, key) => queue.enqueue("enrich_memory", { ...input, notifyCaptureCompletion: true }, key) });
  const notified = vi.fn();
  queue = new TaskJobQueue(jobs, async () => engine, undefined, notified);
  try {
    const chat = queue.enqueue("chat", { text: original, source: "web", conversationKey: "capture" }, "chat-one");
    await vi.waitFor(() => expect(jobs.get(chat.id)?.status).toBe("done"), { timeout: 10000 });
    expect((jobs.get(chat.id)?.result as any).text).toContain("Saved the original note. Organization is queued.");
    await vi.waitFor(() => expect(jobs.recent().filter(job => job.kind === "enrich_memory")[0]?.status).toBe("done"), { timeout: 10000 });
    expect(jobs.recent()).toHaveLength(2);
    const enriched = jobs.recent().find(job => job.kind === "enrich_memory")!;
    expect(enriched.input.content).toBe(original);
    expect((enriched.result as any).topics.filter((topic: any) => topic.status === "filed"), JSON.stringify(enriched.result)).toHaveLength(3);
    // The capture instruction prefix remains explicit unassigned evidence; do not pretend all raw bytes were filed.
    expect((enriched.result as any).topics.filter((topic: any) => topic.reason === "source_not_assigned")).toHaveLength(1);
    expect((enriched.result as any).pagesTouched).toEqual(expect.arrayContaining(paths));
    expect((enriched.result as any).pagesTouched.filter((path: string) => path.startsWith("Inbox/filing-"))).toHaveLength(1);
    expect(notified).toHaveBeenCalledTimes(1);
    expect((await engine.getEntry(enriched.input.evidenceRef!)).content).toBe(original);
    expect(await engine.searchEntries({})).toHaveLength(2); // Fixture plus one inbound original.
    expect(classify).toHaveBeenCalledTimes(1);
  } finally { await queue.close(); jobs.close(); state.close(); }
}, 20000);
