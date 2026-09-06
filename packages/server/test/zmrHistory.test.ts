import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createEngine, VaultRepo, type VaultRepository, type BrainEngine, type StoreResult } from "zenod";
import { SqliteStateStore } from "../../core/src/state/sqlite.js";
import type { BrainLlm } from "../../core/src/llm/types.js";
import { buildMcpServer } from "../src/mcp.js";
import { TaskJobStore } from "../src/taskJobStore.js";
import { FakeDriveVaultRepository } from "./fixtures/zmr/driveRepository.js";
import { manifest, seedFixture } from "./fixtures/zmr/fixture.js";

async function connect(engine: BrainEngine, jobs?: TaskJobStore) {
  const server = buildMcpServer(async () => engine, undefined, undefined, undefined, jobs);
  const client = new Client({ name: "zmr-history", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return { client, server };
}
async function search(client: Client, args: Record<string, unknown>) {
  const result = await client.callTool({ name: "search_memory", arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent as { entries: Array<{ evidenceRef: string; provider: string; url: string; sourceId: string; revisionId: string }>; hits: unknown[]; pagination: { hasMore: boolean; nextCursor: string | null; matchedEntries: number; scannedEntries: number; scannedReceiptJobs: number } };
}

describe.each(["github", "google_drive"] as const)("ZMR historical MCP: %s", provider => {
  it("enumerates all 657 identities, reaches old ranges and rejects stale/foreign/forged cursors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zmr-history-"));
    const state = new SqliteStateStore(":memory:");
    const connections: Awaited<ReturnType<typeof connect>>[] = [];
    try {
      const seed = join(dir, "seed"); await seedFixture(seed);
      let repo: VaultRepository;
      if (provider === "github") {
        const bare = join(dir, "origin.git");
        await simpleGit().init(["--bare", "--initial-branch=main", bare]);
        const git = simpleGit(seed); await git.init(["--initial-branch=main"]);
        await git.addConfig("user.name", "ZMR synthetic").addConfig("user.email", "zmr@example.invalid");
        await git.add("."); await git.commit("frozen synthetic baseline");
        await git.addRemote("origin", bare); await git.push("origin", "main");
        repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare, repo: "synthetic/zmr-history" });
      } else repo = await FakeDriveVaultRepository.open(seed);
      const engine = createEngine({ repo, llm: {} as BrainLlm, state, readSyncTtlMs: 60_000 });
      const first = await connect(engine); connections.push(first);
      const all = await engine.searchEntries({ limit: null, order: "oldest" });
      expect(all).toHaveLength(657);
      for (const order of ["oldest", "newest"]) {
        const refs: string[] = []; let cursor: string | null = null;
        do {
          const page = await search(first.client, { order, limit: 100, ...(cursor ? { cursor } : {}) });
          refs.push(...page.entries.map(e => e.evidenceRef));
          expect(page.pagination.scannedEntries).toBe(657);
          expect(page.pagination.matchedEntries).toBe(657);
          expect(page.pagination.hasMore).toBe(Boolean(page.pagination.nextCursor));
          expect(page.entries.every(e => e.provider === provider)).toBe(true);
          for (const entry of page.entries) expect(entry.revisionId).toBe(all.find(e => e.evidenceRef === entry.evidenceRef)!.revisionId);
          if (provider === "google_drive") expect(JSON.stringify(page)).not.toContain("github.com");
          cursor = page.pagination.nextCursor;
        } while (cursor);
        expect(refs).toEqual((order === "oldest" ? all : [...all].reverse()).map(e => e.evidenceRef));
        expect(new Set(refs).size).toBe(657);
      }
      const old = await search(first.client, { capturedAfter: "2026-01-01T01:00:00+01:00", capturedBefore: "2026-01-02T00:59:59.999+01:00", order: "oldest" });
      expect(old.entries.map(e => e.evidenceRef)).toEqual(Object.values(manifest.refs));
      const combined = await search(first.client, { query: "original amber", capturedBefore: "2026-01-02", order: "oldest" });
      expect(combined.entries.map(e => e.evidenceRef)).toEqual([manifest.refs.historical]);
      const absent = await search(first.client, { query: "payroll", capturedBefore: "2026-01-02" });
      expect(absent.entries).toEqual([]);
      const lexical = await search(first.client, { query: "ZMR ORCHID" });
      expect(lexical.entries).toEqual([]); expect(lexical.pagination).toBeNull(); expect(lexical.hits.length).toBeGreaterThan(0);
      const beginning = await search(first.client, { order: "oldest", limit: 2 });
      const cursor = beginning.pagination.nextCursor!;
      // New stateless MCP instance and new engine object, same actual vault.
      const reconnect = await connect(createEngine({ repo, llm: {} as BrainLlm, state })); connections.push(reconnect);
      const next = await search(reconnect.client, { order: "oldest", limit: 2, cursor });
      expect(next.entries.map(e => e.evidenceRef)).toEqual(all.slice(2, 4).map(e => e.evidenceRef));
      for (const args of [{ order: "oldest", cursor: `${cursor.slice(0, -8)}AAAAAAAA` }, { order: "newest", cursor }]) {
        expect((await first.client.callTool({ name: "search_memory", arguments: args })).isError).toBe(true);
      }
      const foreignSeed = join(dir, "foreign"); await seedFixture(foreignSeed);
      const foreign = await connect(createEngine({ repo: await FakeDriveVaultRepository.open(foreignSeed), llm: {} as BrainLlm, state })); connections.push(foreign);
      expect((await foreign.client.callTool({ name: "search_memory", arguments: { order: "oldest", cursor } })).isError).toBe(true);
      const path = join(repo.path, "Log/2026-01-01.md");
      await writeFile(path, (await readFile(path, "utf8")).replace("cobalt-seventeen", "changed-synthetic"));
      const stale = await first.client.callTool({ name: "search_memory", arguments: { order: "oldest", cursor } });
      expect(stale.isError).toBe(true); expect(JSON.stringify(stale)).toContain("snapshot changed");
    } finally {
      for (const { client, server } of connections) { await client.close(); await server.close(); }
      state.close(); await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

it("enriches old retained receipts before filtering and isolates tenant stores", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zmr-receipts-"));
  const state = new SqliteStateStore(":memory:");
  const jobs = new TaskJobStore(join(dir, "jobs.sqlite"), "tenant-a");
  const foreignJobs = new TaskJobStore(join(dir, "jobs.sqlite"), "tenant-b");
  let connection: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const seed = join(dir, "seed"); await seedFixture(seed);
    const repo = await FakeDriveVaultRepository.open(seed);
    const engine = createEngine({ repo, llm: {} as BrainLlm, state });
    const legacy = manifest.refs.historical;
    const job = jobs.enqueue("store", { content: "receipt cannot overwrite immutable content", source: "whatsapp", contentType: "voice_note", sourceId: "legacy-old", capturedAt: "2026-01-01T10:00:00+02:00" }, undefined, 1);
    const result = { evidenceRef: legacy, evidenceUrl: "https://drive.google.com/file/d/receipt/view", revision: { provider: "google_drive", id: "receipt-revision", committedAt: "2026-01-01T08:00:00Z", urls: [] } } as unknown as StoreResult;
    jobs.update(job.id, { status: "done", result }, 2);
    // More than 500 newer jobs must not hide legacy enrichment.
    for (let i = 0; i < 651; i++) jobs.enqueue("store", { content: `new pending ${i}` }, undefined, i + 10);
    const duplicate = jobs.enqueue("store", { ...job.input }, undefined, 3);
    jobs.update(duplicate.id, { status: "done", result }, 4);
    const foreign = foreignJobs.enqueue("store", { content: "secret", sourceId: "foreign", source: "whatsapp" }, undefined, 5);
    foreignJobs.update(foreign.id, { status: "done", result: { ...result, evidenceRef: "Log/2026-01-01.md#^e-ffffff" } }, 6);
    connection = await connect(engine, jobs);
    const page = await search(connection.client, { query: "original amber", source: "whatsapp", contentType: "voice_note", sourceId: "legacy-old", capturedAfter: "2026-01-01T08:00:00Z", capturedBefore: "2026-01-01T08:00:00Z" });
    expect(page.entries).toHaveLength(1); expect(page.entries[0]).toMatchObject({ evidenceRef: legacy, provider: "google_drive", revisionId: "receipt-revision", url: result.evidenceUrl });
    expect(page.pagination.scannedEntries).toBe(657); expect(page.pagination.scannedReceiptJobs).toBe(653);
    expect((await search(connection.client, { sourceId: "foreign" })).entries).toEqual([]);
    const exact = await connection.client.callTool({ name: "get_memory", arguments: { path: legacy } });
    expect(exact.structuredContent).toMatchObject({ entry: { sourceId: "legacy-old", revisionId: "receipt-revision" } });
    expect(JSON.stringify(exact)).toContain("original launch color: amber");
    expect(JSON.stringify(exact)).not.toContain("receipt cannot overwrite");
    const first = await search(connection.client, { order: "oldest", limit: 1 });
    jobs.update(job.id, { status: "done", result: { ...result, revision: { ...result.revision!, id: "new-receipt" } } }, 9999);
    const stale = await connection.client.callTool({ name: "search_memory", arguments: { order: "oldest", cursor: first.pagination.nextCursor } });
    expect(stale.isError).toBe(true);
  } finally {
    if (connection) { await connection.client.close(); await connection.server.close(); }
    jobs.close(); foreignJobs.close(); state.close(); await rm(dir, { recursive: true, force: true });
  }
});
