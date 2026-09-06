import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createEngine, VaultRepo, type VaultRepository, type StoreResult } from "zenod";
import { SqliteStateStore } from "../../core/src/state/sqlite.js";
import type { BrainLlm, AnswerInput, VaultReadTools, ClassifyInput } from "../../core/src/llm/types.js";
import type { FactProposal, FactView } from "../../core/src/engine/temporalFacts.js";
import { parseNote, serializeNote } from "../../core/src/vault/frontmatter.js";
import { validateToolResponse } from "../src/toolOutput.js";
import { buildMcpServer } from "../src/mcp.js";
import { FakeDriveVaultRepository } from "./fixtures/zmr/driveRepository.js";

// Real store/ask/get engine paths and public MCP, scripted classifier/tool selection.
// No external model or real user-vault writes; the user_report lane is also a local fixture.
describe.each(["github", "google_drive"] as const)("ZMR-7 temporal memory public journey: %s", provider => {
  it("retains successive corrections, reconstructs effective dates and refuses stale or conflicting current claims", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zmr-facts-")); const state = new SqliteStateStore(":memory:");
    let client: Client | undefined; let server: ReturnType<typeof buildMcpServer> | undefined;
    try {
      const seed = join(dir, "seed");
      await cp(fileURLToPath(new URL("../../core/test/fixtures/vault", import.meta.url)), seed, { recursive: true });
      const initial = serializeNote({ title: "Orchid", type: "note", tags: ["work"], created: "2026-01-01", updated: "2026-01-01", summary: "Orchid decisions and incident history." }, "# Orchid\n\n## Unrelated historical knowledge\n\nKeep the old budget and its citation [[2026-06-10#^e-7f3a2c]].\n\n[[Index]]\n");
      await writeFile(join(seed, "Notes/Orchid.md"), initial);
      await writeFile(join(seed, "Notes/Legacy.md"), serializeNote({ title: "Legacy", type: "note", tags: ["work"], created: "2026-01-01", updated: "2026-01-01", summary: "Old incident" }, "Production is broken. [[2026-06-10#^e-7f3a2c]]\n[[Index]]\n"));
      let repo: VaultRepository;
      if (provider === "github") {
        const bare = join(dir,"origin.git"); await simpleGit().init(["--bare", "--initial-branch=main", bare]);
        const git = simpleGit(seed); await git.init(["--initial-branch=main"]);
        await git.addConfig("user.name","ZMR synthetic").addConfig("user.email","zmr@example.invalid");
        await git.add("."); await git.commit("local ZMR-7 fixture"); await git.addRemote("origin",bare); await git.push("origin","main");
        repo = await VaultRepo.open({ workdir: join(dir,"work"), remoteUrl: bare, repo: "synthetic/zmr-facts" });
      } else repo = await FakeDriveVaultRepository.open(seed);
      let proposals: FactProposal[] = []; let latestView: FactView | undefined;
      let mutateAfterRead = false;
      const llm = {
        async classify(input: ClassifyInput) {
          // Exclude the synthetic marker from the assignment deliberately: origin must use full immutable evidence.
          if (input.content.includes("Orchid color is violet.")) expect(input.pageIndex.find(page => page.path === "Notes/Orchid.md")?.factKeys).toContain("orchid.color");
          const quote = input.content.replace(/^Synthetic test data\.\s*/, "");
          const page = { path: "Notes/Orchid.md", action: "update" as const, title: "Orchid" };
          return { confidence: 1, summary: "Orchid fact", tags: ["work"], pages: [page], topics: [{ topic: "Orchid", confidence: 1, disposition: "append_compact_note" as const, summary: "Orchid fact", pages: [page], evidenceQuotes: [quote], facts: proposals }, ...(input.content.startsWith("Synthetic test data.") ? [{ topic: "Fixture marker", confidence: 1, disposition: "evidence_only" as const, summary: "Fixture", pages: [], evidenceQuotes: ["Synthetic test data."], facts: [] }] : [])] };
        },
        async answer(input: AnswerInput, tools: VaultReadTools) {
          const args = JSON.parse(input.question) as { path: string; key?: string; asOf?: string; repeat?: number };
          if (args.repeat) {
            const calls = await Promise.allSettled(Array.from({ length: args.repeat }, () => tools.readFacts!(args)));
            expect(calls.filter(call => call.status === "fulfilled")).toHaveLength(4);
            return { text: "Everything everywhere is complete and verified.", readPaths: [] };
          }
          latestView = JSON.parse(await tools.readFacts!(args));
          if (mutateAfterRead) {
            const path = join(repo.path, "Log/2026-09-06.md");
            await writeFile(path, (await readFile(path, "utf8")).replaceAll("Orchid owner is Ana.", "Changed after read."));
          }
          return { text: "Production is definitely still broken and every fact is live verified. The color is invented-magenta.", readPaths: [] };
        },
      } as unknown as BrainLlm;
      const engine = createEngine({ repo, llm, state, now: () => new Date("2026-09-06T12:00:00Z"), readSyncTtlMs: 60000,
        ...(provider === "github" ? { location: { repo: "synthetic/zmr-facts" } } : {}) });
      server = buildMcpServer(async () => engine);
      client = new Client({ name: "zmr-7", version: "1" }); const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
      const originals: Array<{ ref: string; content: string }> = [];
      const store = async (key: string, statement: string, effectiveDate: string | null, prior?: string, synthetic = true, verificationQuote: string | null = null) => {
        const correctionQuote = prior ? `Correction: replace "${prior}" with "${statement}"${effectiveDate ? ` effective ${effectiveDate}` : ""}.` : null;
        const content = `${synthetic ? "Synthetic test data. " : ""}${correctionQuote ?? statement}${effectiveDate && !correctionQuote ? ` Effective ${effectiveDate}.` : ""}${verificationQuote ? ` ${verificationQuote}` : ""}`;
        proposals = [{ key, statement, effectiveDate, effectiveDateQuote: content.replace(/^Synthetic test data\.\s*/, ""), correctionQuote, supersedesQuotes: prior ? [prior] : [], verificationQuote }];
        const response = await client!.callTool({ name: "store_memory", arguments: { content, source: "mcp", capturedAt: "2026-09-06T11:00:00Z" } });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        const stored = response.structuredContent as unknown as StoreResult;
        expect(stored.filing).toBe("filed"); expect(stored.pagesTouched).toContain("Notes/Orchid.md");
        originals.push({ ref: stored.evidenceRef, content }); return stored;
      };
      await store("orchid.color", "Orchid color is amber.", "2026-01-01");
      await store("orchid.color", "Orchid color is violet.", "2026-02-01", "Orchid color is amber.");
      await store("orchid.color", "Orchid color is blue.", "2026-03-01", "Orchid color is violet.");
      const ask = async (key?: string, asOf?: string, path = "Notes/Orchid.md") => {
        const result = await client!.callTool({ name: "ask_brain", arguments: { question: JSON.stringify({ path, ...(key ? { key } : {}), ...(asOf ? { asOf } : {}) }) } });
        expect(result.isError, JSON.stringify(result)).not.toBe(true); validateToolResponse("zenod.ask_brain", result.structuredContent);
        return result.structuredContent as { text: string; sources: Array<{ provider: string; revisionId: string; url: string; path: string; githubUrl?: string }> };
      };
      const current = await ask("orchid.color");
      expect(current.text).toContain("Orchid color is blue."); expect(current.text).not.toContain("Orchid color is amber."); expect(current.text).not.toContain("invented-magenta");
      expect(current.text).toContain("Synthetic fixture"); expect(latestView!.facts.map(f => f.status)).toEqual(["superseded","superseded","active"]);
      for (const source of current.sources) {
        expect(source.provider).toBe(provider); expect(source.revisionId).toBe((await repo.currentRevision()).id);
        expect(source.path).toMatch(/^Log\/2026-09-06.md#\^e-/); expect(source.url).toContain(provider === "github" ? "github.com" : "drive.google.com");
        if (provider === "google_drive") expect(source.githubUrl).toBeUndefined();
      }
      const past = await ask("orchid.color", "2026-01-15"); expect(past.text).toContain("Orchid color is amber."); expect(past.text).not.toContain("Orchid color is blue.");
      expect((await ask("orchid.color", "2026-02-15")).text).toContain("Orchid color is violet.");
      // Backdated, independently reported claim has a genuine earlier effective date and later evidence date.
      await store("orchid.owner", "Orchid owner is Ana.", "2025-12-01");
      expect((await ask("orchid.owner", "2026-01-15")).text).toContain("Orchid owner is Ana.");
      await store("orchid.color", "Orchid color is silver.", null, "an ambiguous old color");
      const conflict = await ask("orchid.color"); expect(conflict.text).toContain("Unresolved conflict"); expect(conflict.text).toContain("Orchid color is blue."); expect(conflict.text).toContain("Orchid color is silver.");
      expect((await ask("orchid.color", "2026-01-15")).text).toContain("Effective date unknown");
      await store("orchid.bug", "The old login check failed.", "2026-01-04", undefined, false, 'Verified "The old login check failed." on 2026-01-04 in local fixture version old-build only.');
      const bug = await ask("orchid.bug"); expect(bug.text).toContain("User report"); expect(bug.text).toContain("local fixture version old-build only");
      expect(bug.text).toContain("An absent fix record never proves"); expect(bug.text).not.toContain("definitely still broken");
      const legacy = await ask(undefined, undefined, "Notes/Legacy.md"); expect(legacy.text).toContain("Legacy or unstructured"); expect(legacy.text).not.toContain("Production is broken");
      const budget = await client.callTool({ name: "ask_brain", arguments: { question: JSON.stringify({ path: "Notes/Orchid.md", key: "orchid.color", repeat: 5 }) } });
      expect((budget.structuredContent as { text: string }).text).toContain("answer is partial");
      expect((budget.structuredContent as { text: string }).text).not.toContain("Everything everywhere");
      const note = await engine.get("Notes/Orchid.md"); expect(note.body).toContain(parseNote(initial).body);
      expect((note.frontmatter.memoryFacts as unknown[]).length).toBe(6);
      // Reversed model relation must not turn the source's removed value into current truth.
      await store("orchid.direction", "Orchid direction is amber.", null, undefined, false);
      const reversedContent = 'Correction: replace "Orchid direction is blue." with "Orchid direction is amber.".';
      proposals = [{ key: "orchid.direction", statement: "Orchid direction is blue.", effectiveDate: null, effectiveDateQuote: null,
        correctionQuote: reversedContent, supersedesQuotes: ["Orchid direction is amber."], verificationQuote: null }];
      const reversedSave = await client.callTool({ name: "store_memory", arguments: { content: reversedContent, source: "mcp", capturedAt: "2026-09-06T11:00:00Z" } });
      expect(reversedSave.isError).not.toBe(true);
      originals.push({ ref: (reversedSave.structuredContent as unknown as StoreResult).evidenceRef, content: reversedContent });
      const direction = await ask("orchid.direction");
      expect(direction.text).toContain("Unresolved conflict");
      expect(latestView!.facts.map(f => f.status)).toEqual(["conflict", "conflict"]);
      expect(latestView!.facts[1]!.unresolvedCorrection).toBe(true);
      // A different subsystem's successful check cannot verify the claimed billing failure.
      const unrelatedCheck = 'Verified "Orchid login succeeds." on 2026-01-04 in production version v1.';
      await store("orchid.billing", "Orchid billing retries fail.", null, undefined, false, unrelatedCheck);
      const billing = await ask("orchid.billing");
      expect(billing.text).toContain("Verification scope: unknown"); expect(billing.text).not.toContain("production version v1");
      const notePath = join(repo.path, "Notes/Orchid.md");
      const beforeForgery = await readFile(notePath, "utf8");
      const parsed = parseNote(beforeForgery);
      const records = parsed.frontmatter!.memoryFacts as Array<{ key: string; id: string; supersedes: string[]; unresolvedCorrection: boolean; verificationQuote: string | null }>;
      const directionRecords = records.filter(f => f.key === "orchid.direction");
      directionRecords[1]!.supersedes = [directionRecords[0]!.id]; directionRecords[1]!.unresolvedCorrection = false;
      records.find(f => f.key === "orchid.billing")!.verificationQuote = unrelatedCheck;
      await writeFile(notePath, serializeNote(parsed.frontmatter!, parsed.body));
      await ask("orchid.direction"); expect(latestView!.facts.map(f => f.status)).toEqual(["conflict", "conflict"]);
      expect((await ask("orchid.billing")).text).toContain("Verification scope: unknown");
      await writeFile(notePath, beforeForgery);
      for (const original of originals) {
        const result = await client.callTool({ name: "get_memory", arguments: { path: original.ref } });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect((result.structuredContent?.entry as { content: string }).content).toBe(original.content);
        expect((await engine.getEntry(original.ref)).content).toBe(original.content);
      }
      // A stale annotation loses support if its evidence changes; no fabricated current claim leaks through.
      const log = join(repo.path,"Log/2026-09-06.md"); const before = await readFile(log,"utf8");
      await writeFile(log, before.replaceAll("Orchid owner is Ana.","Owner text was removed."));
      const changed = await ask("orchid.owner"); expect(changed.text).toContain("unsupported record"); expect(changed.text).not.toContain("Orchid owner is Ana.");
      await writeFile(log,before);
      mutateAfterRead = true;
      const mixed = await ask("orchid.owner");
      expect(mixed.text).toContain("snapshot changed"); expect(mixed.text).not.toContain("Orchid owner is Ana."); expect(mixed.sources).toEqual([]);
      mutateAfterRead = false; await writeFile(log,before);
    } finally { await client?.close(); await server?.close(); state.close(); await rm(dir,{ recursive: true, force: true, maxRetries: 3 }); }
  }, 60000);
});
