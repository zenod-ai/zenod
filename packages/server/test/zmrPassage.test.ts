import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createEngine, VaultRepo, type VaultRepository } from "zenod";
import { SqliteStateStore } from "../../core/src/state/sqlite.js";
import type { BrainLlm, AnswerInput, VaultReadTools } from "../../core/src/llm/types.js";
import type { NotePassage } from "../../core/src/ops/passage.js";
import { buildMcpServer } from "../src/mcp.js";
import { FakeDriveVaultRepository } from "./fixtures/zmr/driveRepository.js";
import { manifest, seedFixture } from "./fixtures/zmr/fixture.js";

// Same frozen ZMR-1 bytes/providers. Only the scripted reader changes: this
// verifies public ask_brain access and citation support, not model reasoning.
describe.each(["github", "google_drive"] as const)("ZMR-2 public passage recall: %s", provider => {
  it("locates and traverses late exact evidence through ask_brain, preserves get_memory and pinned isolation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zmr-2-public-"));
    const state = new SqliteStateStore(":memory:");
    let client: Client | undefined; let server: ReturnType<typeof buildMcpServer> | undefined;
    try {
      const seed = join(dir, "seed"); await seedFixture(seed);
      let repo: VaultRepository;
      if (provider === "github") {
        const bare = join(dir, "origin.git");
        await simpleGit().init(["--bare", "--initial-branch=main", bare]);
        const git = simpleGit(seed); await git.init(["--initial-branch=main"]);
        await git.addConfig("user.name", "ZMR synthetic").addConfig("user.email", "zmr@example.invalid");
        await git.add("."); await git.commit("frozen synthetic fixture");
        await git.addRemote("origin", bare); await git.push("origin", "main");
        repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare, repo: "synthetic/zmr-passage" });
      } else repo = await FakeDriveVaultRepository.open(seed);
      const revision = await repo.currentRevision();
      const pages: NotePassage[] = [];
      const llm = {
        async answer(input: AnswerInput, tools: VaultReadTools) {
          if (input.question === "pinned") {
            // A reread of the pinned file must still return only that evidence.
            const body = await tools.readNote!("Log/2026-01-01.md");
            expect(body).not.toContain("original launch color");
            expect(body).toContain("cobalt-seventeen");
            return { text: `cobalt-seventeen (${manifest.refs.late})`, readPaths: [] };
          }
          await tools.searchVault!("ZMR ORCHID");
          if (input.question === "seek") {
            const page = JSON.parse(await tools.readNote!("Log/2026-01-01.md", { query: "access word", maxChars: 512 })) as NotePassage;
            pages.push(page);
            expect(page.extent.start).toBeGreaterThan(8000);
            expect(page.omittedBefore).toBe(true);
            expect(page.body).not.toContain("original launch color");
            return { text: `cobalt-seventeen (${page.identity})`, readPaths: ["Log/2026-01-01.md"] };
          }
          let cursor: string | undefined; let text = ""; let count = 0;
          do {
            const page = JSON.parse(await tools.readNote!(manifest.refs.late, { cursor, maxChars: 1024 })) as NotePassage;
            pages.push(page); text += page.body;
            expect(page.body).not.toContain("original launch color");
            cursor = page.nextCursor ?? undefined;
            if (++count > 16) throw new Error("Explicit 16-read synthetic budget exhausted; incomplete coverage");
          } while (cursor);
          expect(count).toBeGreaterThan(8);
          expect(text).toContain("cobalt-seventeen");
          expect(text).toContain("- source-id: ZMR-e-000001");
          expect(text).toContain("- source: mcp");
          return { text: `cobalt-seventeen (${manifest.refs.late})`, readPaths: [manifest.refs.late] };
        },
      } as unknown as BrainLlm;
      const engine = createEngine({ repo, llm, state, ...(provider === "github" ? { location: { repo: "synthetic/zmr-passage" } } : {}) });
      server = buildMcpServer(async () => engine); client = new Client({ name: "zmr-2", version: "1" });
      const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
      for (const question of ["seek", "traverse", "pinned"]) {
        const result = await client.callTool({ name: "ask_brain", arguments: { question, ...(question === "pinned" ? { contextRefs: [manifest.refs.late] } : {}) } });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent?.text).toBe(`cobalt-seventeen (${manifest.refs.late})`);
        expect(result.structuredContent?.sources).toEqual(expect.arrayContaining([expect.objectContaining({ provider, path: manifest.refs.late })]));
      }
      for (const page of pages) {
        expect(page.source).toMatchObject({ provider, revisionId: revision.id });
        if (provider === "google_drive") expect(JSON.stringify(page)).not.toContain("github.com");
        else expect(page.source.url).toContain(revision.commitSha!);
      }
      const full = await client.callTool({ name: "get_memory", arguments: { path: "Log/2026-01-01.md" } });
      expect(full.isError).not.toBe(true);
      expect(JSON.stringify(full.structuredContent)).toContain("original launch color");
      const exact = await client.callTool({ name: "get_memory", arguments: { path: manifest.refs.late } });
      expect(exact.isError).not.toBe(true);
      expect(JSON.stringify(exact.structuredContent)).not.toContain("original launch color");
      expect((await repo.currentRevision()).id).toBe(revision.id);
    } finally { await client?.close(); await server?.close(); state.close(); await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});
