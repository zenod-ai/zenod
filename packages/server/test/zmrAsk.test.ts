import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createEngine, VaultRepo, type VaultRepository, type AnswerCoverage, type EntrySearchResult, type StoreResult } from "zenod";
import { SqliteStateStore } from "../../core/src/state/sqlite.js";
import type { BrainLlm, AnswerInput, VaultReadTools } from "../../core/src/llm/types.js";
import type { NotePassage } from "../../core/src/ops/passage.js";
import { validateToolResponse } from "../src/toolOutput.js";
import { buildMcpServer } from "../src/mcp.js";
import { TaskJobStore } from "../src/taskJobStore.js";
import { FakeDriveVaultRepository } from "./fixtures/zmr/driveRepository.js";
import { manifest, seedFixture } from "./fixtures/zmr/fixture.js";

// Real public MCP + engine + shared retrieval. Deterministic scripted model;
// these tests prove access/control/grounding behavior, not autonomous model quality.
describe.each(["github", "google_drive"] as const)("ZMR-4 public typed Q&A: %s", provider => {
  it("audits old entries, reports budgets and unread spans, preserves pinned followups and provenance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zmr-ask-"));
    const state = new SqliteStateStore(":memory:");
    const jobs = new TaskJobStore(join(dir, "jobs.sqlite"), "tenant-a");
    let client: Client | undefined; let server: ReturnType<typeof buildMcpServer> | undefined;
    try {
      const seed = join(dir, "seed"); await seedFixture(seed);
      let repo: VaultRepository;
      if (provider === "github") {
        const bare = join(dir, "origin.git"); await simpleGit().init(["--bare", "--initial-branch=main", bare]);
        const git = simpleGit(seed); await git.init(["--initial-branch=main"]);
        await git.addConfig("user.name", "ZMR synthetic").addConfig("user.email", "zmr@example.invalid");
        await git.add("."); await git.commit("frozen synthetic fixture"); await git.addRemote("origin", bare); await git.push("origin", "main");
        repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare, repo: "synthetic/zmr-ask" });
      } else repo = await FakeDriveVaultRepository.open(seed);
      const revision = await repo.currentRevision();
      const before = await readFile(join(repo.path, "Log/2026-01-01.md"), "utf8");
      const receipt = jobs.enqueue("store", { content: "receipt must not replace amber", source: "whatsapp", sourceId: "old-voice", contentType: "voice_note", capturedAt: "2026-01-01T01:00:00Z" });
      jobs.update(receipt.id, { status: "done", result: { evidenceRef: manifest.refs.historical, revision, evidenceUrl: provider === "github" ? "https://github.com/synthetic/zmr-ask/receipt" : "https://drive.google.com/file/d/receipt/view" } as unknown as StoreResult });
      for (let i = 0; i < 510; i++) jobs.enqueue("store", { content: `pending ${i}` });
      let lastCatalog: EntrySearchResult | undefined;
      const readExact = async (tools: VaultReadTools, ref: string) => {
        let cursor: string | undefined; let text = "";
        do {
          const page = JSON.parse(await tools.readNote!(ref, { ...(cursor ? { cursor } : {}), maxChars: 2048 })) as NotePassage;
          expect(page.identity).toBe(ref); expect(page.source.provider).toBe(provider);
          expect(page.source.revisionId).toBe(revision.id);
          text += page.body; cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return text;
      };
      const llm = {
        async answer(input: AnswerInput, tools: VaultReadTools) {
          if (input.question === "audit stale pin" || input.question === "audit refreshed pin") {
            expect(input.vaultBriefing).toContain("original launch color: amber");
            await writeFile(join(repo.path, "Log/2026-01-01.md"), before.replace("original launch color: amber", "original launch color: silver"));
            const catalog = JSON.parse(await tools.searchEntries!({ sourceId: "old-voice", exhaustive: true }));
            expect(catalog.entries).toHaveLength(1); expect(catalog.entries[0].snippet).toContain("silver");
            if (input.question === "audit refreshed pin") {
              const fresh = await readExact(tools, manifest.refs.historical);
              expect(fresh).toContain("silver");
              return { text: `Refreshed original color silver (${manifest.refs.historical})`, readPaths: [] };
            }
            return { text: `Original color amber (${manifest.refs.historical})`, readPaths: [] };
          }
          if (input.question.startsWith("pinned")) {
            expect(input.vaultBriefing).toContain("PINNED EVIDENCE CONTEXT");
            expect(input.conversation).toEqual([]);
            return { text: input.vaultBriefing.includes("now violet") ? `Current color violet (${manifest.refs.correction})` : `Previous color amber (${manifest.refs.historical})`, readPaths: [] };
          }
          if (input.question === "audit concurrent budget") {
            const pages = await Promise.allSettled(Array.from({ length: 12 }, () => tools.searchEntries!({ order: "oldest", limit: 20 })));
            expect(pages.filter(p => p.status === "fulfilled")).toHaveLength(8);
            return { text: "I checked every memory and everything is complete.", readPaths: [] };
          }
          if (input.question === "audit empty") {
            const empty = JSON.parse(await tools.searchEntries!({ query: "payroll-never-in-fixture", capturedAfter: "2026-01-01", capturedBefore: "2026-01-02", exhaustive: true }));
            expect(empty.entries).toEqual([]);
            return { text: `The payroll provider is Invented-999 (${manifest.refs.historical}).`, readPaths: [manifest.refs.historical] };
          }
          if (input.question === "citation-only") {
            await tools.searchVault!("ORCHID");
            return { text: `The coordinator owns a yacht (${manifest.refs.historical}).`, readPaths: [manifest.refs.historical] };
          }
          if (input.question === "failed-read") {
            await expect(tools.readNote!("Log/missing.md")).rejects.toThrow();
            return { text: "All facts are verified", readPaths: ["Log/missing.md"] };
          }
          if (input.question === "unknown") {
            await tools.searchEntries!({ query: "ORCHID", order: "oldest" });
            await readExact(tools, manifest.refs.historical);
            return { text: `The favorite dessert code is Invented-999 (${manifest.refs.historical}).`, readPaths: [manifest.refs.historical] };
          }
          if (input.question === "conversation") {
            const text = await tools.searchChats("discussion");
            expect(text).toContain("Conversation-only detail");
            return { text: "In conversation history you said Conversation-only detail.", readPaths: [] };
          }
          if (input.question === "enriched") {
            lastCatalog = JSON.parse(await tools.searchEntries!({ source: "whatsapp", sourceId: "old-voice", contentType: "voice_note",
              capturedAfter: "2026-01-01T01:00:00Z", capturedBefore: "2026-01-01T01:00:00Z", query: "original amber", order: "oldest" }));
            expect(lastCatalog!.entries.map(e => e.evidenceRef)).toEqual([manifest.refs.historical]);
            expect(lastCatalog!.entries[0]!.revisionId).toBe(revision.id);
            expect(lastCatalog!.entries[0]!.snippet).not.toContain("receipt must not");
            await readExact(tools, manifest.refs.historical);
            return { text: `Original amber (${manifest.refs.historical})`, readPaths: [] };
          }
          if (input.question === "narrow ORCHID access word") {
            await tools.searchEntries!({ query: "ORCHID access", capturedBefore: "2026-01-02" });
            await readExact(tools, manifest.refs.late);
            await readExact(tools, manifest.refs.distractor);
            return { text: `cobalt-seventeen (${manifest.refs.late}); Invented-999 (${manifest.refs.distractor})`, readPaths: [] };
          }
          const partial = input.question === "audit budget";
          lastCatalog = JSON.parse(await tools.searchEntries!({ ...(partial ? {} : { capturedAfter: "2026-01-01", capturedBefore: "2026-01-01T23:59:59.999Z" }), order: "oldest", limit: partial ? 20 : 2, exhaustive: true }));
          if (partial) {
            expect(lastCatalog!.entries).toHaveLength(160);
            expect(lastCatalog!.pagination.hasMore).toBe(true);
            return { text: "I read all 657 entries; this is the complete audit.", readPaths: [] };
          }
          expect(lastCatalog!.entries.map(e => e.evidenceRef)).toEqual(Object.values(manifest.refs));
          if (input.question === "audit passage budget") {
            for (let i = 0; i < 64; i++) await tools.readNote!(manifest.refs.late, { maxChars: 256 });
            await expect(tools.readNote!(manifest.refs.late, { maxChars: 256 })).rejects.toThrow("Passage read budget exhausted");
            return { text: "The entire audit is complete.", readPaths: [] };
          }
          if (input.question === "audit unread") {
            await tools.readNote!(manifest.refs.late, { query: "access word", maxChars: 512 });
            return { text: "Everything is completely verified.", readPaths: [] };
          }
          for (const entry of lastCatalog!.entries) await readExact(tools, entry.evidenceRef);
          if (input.question === "audit changed") {
            await writeFile(join(repo.path, "Log/2026-01-01.md"), before.replace("cobalt-seventeen", "changed-value"));
          }
          return { text: `ORCHID access word cobalt-seventeen (${manifest.refs.late}); previous amber (${manifest.refs.historical}); corrected violet (${manifest.refs.correction}); ORCHARD green (${manifest.refs.distractor}).`, readPaths: [] };
        },
      } as unknown as BrainLlm;
      const engine = createEngine({ repo, llm, state, readSyncTtlMs: 60_000, ...(provider === "github" ? { location: { repo: "synthetic/zmr-ask" } } : {}) });
      server = buildMcpServer(async () => engine, undefined, undefined, undefined, jobs);
      client = new Client({ name: "zmr-4", version: "1" });
      const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
      const ask = async (question: string, contextRefs?: string[]) => {
        const result = await client!.callTool({ name: "ask_brain", arguments: { question, ...(contextRefs ? { contextRefs } : {}) } });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(() => validateToolResponse("zenod.ask_brain", result.structuredContent)).not.toThrow();
        return result.structuredContent as { text: string; sources: Array<{ path: string; provider: string }>; coverage: AnswerCoverage; status: { type: string } };
      };
      const complete = await ask("audit old range");
      expect(complete.coverage.status).toBe("complete-bounded-scope");
      expect(complete.coverage.entryPagesRead).toBe(3);
      expect(complete.coverage.searches[0]).toMatchObject({ matchedEntries: 5, enumeratedEntries: 5, enumerationComplete: true, unreadEvidenceRefs: [], receiptEnrichmentAvailable: true });
      expect(complete.coverage.successfulReads.some(read => read.start > 8000 && read.complete)).toBe(true);
      expect(complete.text).toContain("cobalt-seventeen"); expect(complete.text).toContain(manifest.refs.historical);
      expect(complete.sources).toHaveLength(5);
      expect(complete.status.type).toBe("read_only_status");
      const budget = await ask("audit budget");
      expect(budget.coverage.status).toBe("partial"); expect(budget.text).toContain("Coverage is partial");
      expect(budget.text).not.toContain("read all 657"); expect(budget.sources).toEqual([]);
      const next = budget.coverage.continuation.find(c => c.tool === "search_entries")!;
      const publicNext = await client.callTool({ name: "search_memory", arguments: { ...next.input, limit: 20 } });
      expect(publicNext.isError).not.toBe(true); // Same server-owned cursor contract.
      expect((publicNext.structuredContent?.entries as unknown[]).length).toBe(20);
      const concurrent = await ask("audit concurrent budget");
      expect(concurrent.coverage.status).toBe("partial");
      expect(concurrent.coverage.entryPageAttempts).toBe(8); expect(concurrent.coverage.entryPagesRead).toBe(8);
      expect(concurrent.text).not.toContain("everything is complete");
      const empty = await ask("audit empty");
      expect(empty.coverage.status).toBe("complete-bounded-scope");
      expect(empty.coverage.searches[0]).toMatchObject({ matchedEntries: 0, enumeratedEntries: 0, enumerationComplete: true });
      expect(empty.sources).toEqual([]); expect(empty.text).not.toContain("Invented-999");
      const passageBudget = await ask("audit passage budget");
      expect(passageBudget.coverage.status).toBe("partial");
      expect(passageBudget.coverage.successfulReads).toHaveLength(64);
      expect(passageBudget.coverage.continuation.some(c => c.tool === "read_note")).toBe(true);
      expect(passageBudget.text).not.toContain("entire audit is complete");
      const unread = await ask("audit unread");
      expect(unread.coverage.status).toBe("partial");
      expect(unread.coverage.searches[0]!.enumerationComplete).toBe(true);
      expect(unread.coverage.searches[0]!.unreadEvidenceRefs).toHaveLength(5);
      expect(unread.coverage.continuation).toContainEqual({ tool: "read_note", input: { path: manifest.refs.late } });
      for (const question of ["citation-only", "failed-read"]) {
        const answer = await ask(question); expect(answer.sources).toEqual([]); expect(answer.text).toContain("couldn't verify");
      }
      const unknown = await ask("unknown"); expect(unknown.text).not.toContain("Invented-999");
      const narrow = await ask("narrow ORCHID access word");
      expect(narrow.text).toContain("cobalt-seventeen"); expect(narrow.text).not.toContain("Invented-999"); expect(narrow.text).not.toContain(manifest.refs.distractor);
      const enriched = await ask("enriched"); expect(enriched.coverage.searches[0]!.matchedEntries).toBe(1);
      const current = await ask("pinned current", [manifest.refs.correction]);
      const previous = await ask("pinned previous", [manifest.refs.historical]);
      expect(current.text).toContain("violet"); expect(current.text).not.toContain("amber");
      expect(previous.text).toContain("amber"); expect(previous.text).not.toContain("violet");
      expect(current.coverage.entryPagesRead).toBe(0); expect(current.sources.map(s => s.path)).toEqual([manifest.refs.correction]);
      await state.appendMessage("whatsapp:synthetic", "user", "discussion: Conversation-only detail", "whatsapp");
      const conversation = await ask("conversation");
      expect(conversation.coverage.conversationHistorySearched).toBe(true); expect(conversation.sources).toEqual([]);
      expect(conversation.text).toContain("conversation history");
      expect(await readFile(join(repo.path, "Log/2026-01-01.md"), "utf8")).toBe(before);
      expect((await repo.currentRevision()).id).toBe(revision.id);
      const stalePin = await ask("audit stale pin", [manifest.refs.historical]);
      expect(stalePin.coverage.searches[0]).toMatchObject({ enumerationComplete: true, unreadEvidenceRefs: [manifest.refs.historical] });
      expect(stalePin.coverage.status).toBe("partial"); expect(stalePin.text).not.toContain("color amber");
      expect(stalePin.coverage.successfulReads).toEqual([]);
      await writeFile(join(repo.path, "Log/2026-01-01.md"), before);
      const refreshedPin = await ask("audit refreshed pin", [manifest.refs.historical]);
      expect(refreshedPin.coverage.status).toBe("complete-bounded-scope"); expect(refreshedPin.text).toContain("silver");
      expect(refreshedPin.coverage.searches[0]!.unreadEvidenceRefs).toEqual([]);
      await writeFile(join(repo.path, "Log/2026-01-01.md"), before);
      const changed = await ask("audit changed");
      expect(changed.coverage.status).toBe("partial"); expect(changed.coverage.failedReads.join(" ")).toContain("snapshot changed");
      expect(changed.text).not.toContain("cobalt-seventeen");
    } finally { await client?.close(); await server?.close(); jobs.close(); state.close(); await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});
