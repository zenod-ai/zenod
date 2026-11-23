import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { BrainEngine, MemoryEntry } from "zenod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureReceiptsFor, captureReceiptsForAsync, mergeMemoryEntries, mergeMemoryEntriesAsync } from "../src/memoryEntryCatalog.js";
import { searchMemoryEntryPage } from "../src/memoryEntrySearch.js";
import { TaskJobStore } from "../src/taskJobStore.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

// EPIC-24 M15: production ran out of JavaScript heap four times on 13 Nov 2026 (exit 134), each time
// inside one MCP call from the team's personas. A search_memory with a filter (or none), get_memory of an
// evidence ref and the subscriber notes API merged vault entries with `recent(Number.MAX_SAFE_INTEGER)`:
// every task job the tenant ever had, note text and receipts included, parsed onto the heap at once. The
// job history only grows, so the live set of one call grew with it until it passed Node's heap limit.

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function store(tenant = "tenant-a"): Promise<TaskJobStore> {
  const root = await mkdtemp(join(tmpdir(), "zenod-m15-"));
  roots.push(root);
  return new TaskJobStore(join(root, "jobs.sqlite"), tenant);
}

type Seed = { id: string; kind?: string; status?: string; input?: Record<string, unknown>; result?: unknown; key?: string | null; at?: number; tenant?: string };
function insert(jobs: TaskJobStore, rows: Seed[]): void {
  const db = (jobs as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void }; exec(sql: string): void } }).db;
  const tenant = (jobs as unknown as { tenantId: string }).tenantId;
  const ins = db.prepare(`INSERT INTO task_jobs (id, tenant_id, idempotency_key, kind, input_json, status, result_json, error, created_at, updated_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1)`);
  db.exec("BEGIN");
  for (const row of rows) {
    ins.run(row.id, row.tenant ?? tenant, row.key ?? null, row.kind ?? "store", JSON.stringify(row.input ?? {}), row.status ?? "done",
      row.result === undefined ? null : JSON.stringify(row.result), row.at ?? 1000, row.at ?? 1000);
  }
  db.exec("COMMIT");
}

const entry = (evidenceRef: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({
  evidenceRef, path: evidenceRef.split("#^")[0]!, anchor: evidenceRef.split("#^")[1]!, title: "Vault title", content: "vault text",
  source: "mcp", verbatim: false, capturedAt: "2026-11-01T10:00:00.000Z", url: "", provider: "github", ...extra,
});

describe("capture receipts stay lean (EPIC-24 M15)", () => {
  it("merges to exactly the entries the full job history gave", async () => {
    const jobs = await store();
    const revision = { provider: "github", id: "r1", commitSha: "a".repeat(40) };
    insert(jobs, [
      { id: "in-vault", input: { content: "job text 1", source: "whatsapp", contentType: "voice_note", capturedAt: "2026-11-02T08:00:00Z", sourceId: "wamid.1", verbatim: true },
        result: { evidenceRef: "Log/2026-11-02.md#^e-1", evidenceUrl: "https://example.test/1", revision }, key: "cap:whatsapp:wamid.1", at: 10 },
      { id: "not-in-vault", input: { content: "job text 2", source: "mcp", verbatim: false }, result: { evidenceRef: "Log/2026-11-03.md#^e-2" }, at: 20 },
      { id: "hint-only", kind: "media_ingest", input: { mediaType: "audio", contentHint: "a voice memo", sourceHint: "telegram chat" },
        result: { digest: { evidenceRef: "Log/2026-11-04.md#^e-3", evidenceUrl: "https://example.test/3", revision } }, at: 30 },
      { id: "older-receipt", input: { content: "old text", source: "web" }, result: { evidenceRef: "Log/2026-11-03.md#^e-2" }, at: 5 },
      { id: "enrich", kind: "enrich_memory", input: { content: "enrich", evidenceRef: "Log/2026-11-02.md#^e-1" }, result: { evidenceRef: "Log/2026-11-02.md#^e-1" }, at: 40 },
      { id: "failed", status: "error", input: { content: "failed" }, result: { evidenceRef: "Log/2026-11-05.md#^e-5" }, at: 50 },
      { id: "no-ref", input: { content: "no ref" }, result: { revision }, at: 60 },
      { id: "array-revision", input: { content: "arr" }, result: { evidenceRef: "Log/2026-11-06.md#^e-6", revision: [1, 2] }, at: 70 },
    ]);
    insert(jobs, [{ id: "other-tenant", tenant: "tenant-b", input: { content: "not ours" }, result: { evidenceRef: "Log/2026-11-07.md#^e-7" } }]);
    const vault = [entry("Log/2026-11-02.md#^e-1"), entry("Log/2026-11-09.md#^e-9")];
    const before = mergeMemoryEntries(vault, jobs.recent(Number.MAX_SAFE_INTEGER));
    const { jobs: lean, loadContent } = captureReceiptsFor(jobs);
    expect(lean.every((job) => job.input.content === undefined)).toBe(true);
    expect(mergeMemoryEntries(vault, lean, loadContent)).toEqual(before);
    // One evidence ref (get_memory) reads only its own receipts.
    const one = captureReceiptsFor(jobs, "Log/2026-11-03.md#^e-2");
    expect(one.jobs.map((job) => job.id).sort()).toEqual(["not-in-vault", "older-receipt"]);
    for (const base of [[entry("Log/2026-11-03.md#^e-2")], []]) {
      const pick = (list: MemoryEntry[]) => list.find((candidate) => candidate.evidenceRef === "Log/2026-11-03.md#^e-2");
      expect(pick(mergeMemoryEntries(base, one.jobs, one.loadContent))).toEqual(pick(mergeMemoryEntries(base, jobs.recent(Number.MAX_SAFE_INTEGER))));
    }
  });

  it("a filtered search never loads the whole job history", async () => {
    const jobs = await store();
    insert(jobs, [{ id: "j1", input: { content: "text", source: "mcp" }, result: { evidenceRef: "Log/2026-11-02.md#^e-1" } }]);
    const recent = vi.spyOn(jobs, "recent");
    const engine = { searchEntries: async () => [entry("Log/2026-11-02.md#^e-1")], memoryScope: "scope" } as unknown as BrainEngine;
    const page = await searchMemoryEntryPage(engine, jobs, { order: "newest", limit: 20 });
    expect(recent).not.toHaveBeenCalled();
    expect(page.entries.map((e) => e.evidenceRef)).toEqual(["Log/2026-11-02.md#^e-1"]);
  });

  it("holds a small fraction of the heap the full history took", async () => {
    const jobs = await store();
    const words = "remember the decision about the launch and the testers ".repeat(80); // ~4.5 KB of note text per job
    const receipt = { evidenceUrl: "https://github.com/o/v/blob/main/Log/x.md", revision: { provider: "github", id: "r", commitSha: "b".repeat(40) },
      pagesTouched: Array.from({ length: 6 }, (_, i) => `Areas/Topic ${i}.md`), urls: Array.from({ length: 6 }, (_, i) => `https://github.com/o/v/blob/main/Areas/Topic%20${i}.md`) };
    const COUNT = 8000;
    insert(jobs, Array.from({ length: COUNT }, (_, i) => ({
      id: `job-${i}`, kind: i % 2 ? "enrich_memory" : "store", at: i,
      input: { content: `${i} ${words}`, source: "mcp", contentType: "text" },
      result: { ...receipt, evidenceRef: `Log/2026-11-01.md#^e-${i.toString(16)}` },
    })));
    const held = (load: () => unknown[]): number => {
      gc();
      const before = process.memoryUsage().heapUsed;
      const kept = load();
      gc();
      const mb = (process.memoryUsage().heapUsed - before) / 1048576;
      expect(kept.length).toBeGreaterThan(0);
      return mb;
    };
    const full = held(() => jobs.recent(Number.MAX_SAFE_INTEGER));
    const lean = held(() => captureReceiptsFor(jobs).jobs);
    if (process.env.M15_PRINT) console.log(`M15 held full=${full.toFixed(1)} MB lean=${lean.toFixed(1)} MB`);
    // Measured on VPS3: the full history holds ~45 MB here, the lean receipts ~3 MB.
    expect(full).toBeGreaterThan(30);
    expect(lean).toBeLessThan(full / 6);
  });
});

// EPIC-24 M34 round 4: the watchdog named the 33-41 s `event_loop.blocked` on production: `captureReceipts`
// (a synchronous node:sqlite scan of every finished capture job) called from the notes list and get_memory, and
// 5.7 s inside `mergeMemoryEntries`. Both now leave the main thread free.
describe("capture receipts do not hold the main thread (EPIC-24 M34 round 4)", () => {
  /** The longest time the event loop went without running a timer while `work` ran. */
  async function longestGap<T>(work: () => Promise<T>): Promise<{ value: T; gapMs: number }> {
    let last = Date.now();
    let gapMs = 0;
    const timer = setInterval(() => { const now = Date.now(); gapMs = Math.max(gapMs, now - last); last = now; }, 5);
    try {
      last = Date.now();
      return { value: await work(), gapMs };
    } finally {
      clearInterval(timer);
    }
  }

  const rows: Seed[] = [
    { id: "a", input: { content: "text a", source: "whatsapp", contentType: "voice_note", capturedAt: "2026-11-02T08:00:00Z", verbatim: true }, result: { evidenceRef: "Log/2026-11-02.md#^e-1", evidenceUrl: "https://example.test/1", revision: { provider: "github", id: "r1" } }, key: "cap:whatsapp:wamid.1", at: 10 },
    { id: "b", kind: "media_ingest", input: { mediaType: "audio", contentHint: "memo" }, result: { digest: { evidenceRef: "Log/2026-11-04.md#^e-3", evidenceUrl: "https://example.test/3" } }, at: 30 },
    { id: "quote", input: { content: "q" }, result: { evidenceRef: 'Log/2026-11-05 "café" \\ é.md#^e-4' }, at: 40 },
    { id: "other", input: { content: "o" }, result: { evidenceRef: "Log/2026-11-02.md#^e-10" }, at: 50 },
    { id: "failed", status: "error", input: { content: "f" }, result: { evidenceRef: "Log/2026-11-02.md#^e-1" }, at: 60 },
  ];

  it("reads the same receipts on a worker thread, for all of them and for one evidence ref", async () => {
    const jobs = await store();
    insert(jobs, rows);
    expect(await jobs.captureReceiptsAsync()).toEqual(jobs.captureReceipts());
    for (const ref of ["Log/2026-11-02.md#^e-1", "Log/2026-11-04.md#^e-3", 'Log/2026-11-05 "café" \\ é.md#^e-4', "Log/2026-11-02.md#^e-10", "Log/none.md#^e-0"]) {
      expect(await jobs.captureReceiptsAsync(ref)).toEqual(jobs.captureReceipts(ref));
    }
    expect((await jobs.captureReceiptsAsync("Log/2026-11-02.md#^e-1")).map((job) => job.id)).toEqual(["a"]);
    // The through-the-queue shape callers use.
    const { jobs: lean, loadContent } = await captureReceiptsForAsync(jobs, "Log/2026-11-02.md#^e-1");
    expect(lean.map((job) => job.id)).toEqual(["a"]);
    expect(loadContent).toBeTypeOf("function");
  });

  it("shares one read between callers that ask for the same thing at once", async () => {
    const jobs = await store();
    insert(jobs, rows);
    const [one, two] = await Promise.all([jobs.captureReceiptsAsync(), jobs.captureReceiptsAsync()]);
    expect(one).toBe(two);
  });

  it("keeps the event loop running while a big history is read", async () => {
    const jobs = await store();
    const text = "remember the decision about the launch and the testers ".repeat(400); // ~22 KB of note text per job
    insert(jobs, Array.from({ length: 5000 }, (_, i) => ({
      id: `job-${i}`, at: i, input: { content: `${i} ${text}`, source: "mcp", contentType: "text" },
      result: { evidenceRef: `Log/2026-11-01.md#^e-${i.toString(16)}`, revision: { provider: "github", id: "r" } },
    })));
    const started = Date.now();
    jobs.captureReceipts();
    const syncMs = Date.now() - started; // the whole read is one block of the loop
    const off = await longestGap(() => jobs.captureReceiptsAsync());
    expect(off.value).toHaveLength(5000);
    if (process.env.M34_PRINT) console.log(`M34 receipts: main thread held ${syncMs} ms, off the thread ${off.gapMs} ms`);
    expect(syncMs).toBeGreaterThan(off.gapMs);
    expect(off.gapMs).toBeLessThan(250);
  });

  it("falls back to the synchronous read when the store cannot be opened by another thread", async () => {
    const memory = new TaskJobStore(":memory:", "tenant-a");
    insert(memory, rows);
    expect((await memory.captureReceiptsAsync("Log/2026-11-02.md#^e-1")).map((job) => job.id)).toEqual(["a"]);
  });

  it("merges to the same entries in slices that give the thread back", async () => {
    const jobs = await store();
    insert(jobs, Array.from({ length: 1500 }, (_, i) => ({
      id: `job-${i}`, at: i, input: { source: "mcp", contentType: "text" }, result: { evidenceRef: `Log/2026-11-01.md#^e-${i.toString(16)}` },
    })));
    const lean = jobs.captureReceipts();
    // Each note read costs ~1 ms, as a cold disk would: 1.5 s of work that used to run as one block.
    const slow = (id: string) => { const end = Date.now() + 1; while (Date.now() < end) { /* spin */ } return { content: `text of ${id}` }; };
    const vault = [entry("Log/2026-11-01.md#^e-0")];
    const expected = mergeMemoryEntries(vault, lean, (id) => ({ content: `text of ${id}` }));
    const { value, gapMs } = await longestGap(() => mergeMemoryEntriesAsync(vault, lean, slow));
    expect(value).toEqual(expected);
    if (process.env.M34_PRINT) console.log(`M34 merge: longest hold ${gapMs} ms`);
    expect(gapMs).toBeLessThan(150);
  });
});

