import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { simpleGit } from "simple-git";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createEngine, VaultRepo, type VaultRepository } from "zenod";
import { SqliteStateStore } from "../../core/src/state/sqlite.js";
import type { AnswerInput, BrainLlm, ClassifyInput, ComposePageInput, VaultReadTools } from "../../core/src/llm/types.js";
import { listMarkdownFiles } from "../../core/src/vault/files.js";
import { buildMcpServer } from "../src/mcp.js";
import { FakeDriveVaultRepository } from "./fixtures/zmr/driveRepository.js";
import { manifest, multiTopic, oversizedSummary, seedFixture } from "./fixtures/zmr/fixture.js";

// This observer scripts tool calls, not model reasoning. It deliberately reports
// availability instead of inferring an answer from a search snippet/summary.
class Observer {
  classifyInputs: ClassifyInput[] = [];
  composeInputs: ComposePageInput[] = [];
  reads: Array<{ query: string; search: string; body: string; tools: string[] }> = [];
  async classify(input: ClassifyInput) {
    this.classifyInputs.push(input);
    const uncertain = input.content.includes("UNCERTAIN:");
    const path = uncertain ? "Notes/Axa.md" : this.classifyInputs.length === 1 ? "Areas/Insurance.md" : "Projects/Sample Project.md";
    return { confidence: uncertain ? 0.4 : 0.95, summary: "synthetic multi-topic filing", tags: ["work"], pages: [{ path, action: "update" as const, title: path }], ...(uncertain ? { question: "Which third topic?" } : {}) };
  }
  async composePage(input: ComposePageInput) {
    this.composeInputs.push(input);
    return `${input.currentContent!}\n\n## Captured topic\n\n${input.evidenceEntry}\n\n${input.citation}\n`;
  }
  async answer(input: AnswerInput, tools: VaultReadTools) {
    const query = input.question.includes("payroll") ? "payroll" : input.question.includes("hue") ? "hue replaced shade flower" : "ZMR ORCHID";
    const search = await tools.searchVault!(query);
    const pinned = input.vaultBriefing.includes("PINNED EVIDENCE CONTEXT");
    // ZMR-2: follow the bounded read contract over the unchanged frozen fixture.
    // This is still a scripted access observer, not autonomous model proof.
    let body = pinned ? input.vaultBriefing : "";
    if (!pinned) {
      let cursor: string | undefined;
      let calls = 0;
      do {
        const page = JSON.parse(await tools.readNote!("Log/2026-01-01.md", { cursor }));
        body += page.body;
        cursor = page.nextCursor ?? undefined;
        if (++calls > 32) throw new Error("Synthetic traversal exceeded explicit 32-read budget");
      } while (cursor);
    }
    this.reads.push({ query, search, body, tools: Object.keys(tools) });
    const match = input.question.includes("original") ? body.match(/original launch color: ([a-z]+)/)
      : input.question.includes("now") || input.question.includes("hue") ? body.match(/launch color is now ([a-z]+)/)
      : body.match(/access word: ([a-z-]+)/);
    const text = input.question.includes("payroll") ? "unknown (scripted abstention; model quality unmeasured)" : match?.[1] ?? "unavailable in supplied note body";
    return { text, readPaths: pinned ? [] : ["Log/2026-01-01.md"] };
  }
}

async function snapshot(path: string) {
  const files = (await listMarkdownFiles(path)).sort();
  const entries = await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(join(path, file))).digest("hex")]));
  return Object.fromEntries(entries);
}

// Characterization: these assertions intentionally name the existing failures.
// Fix tickets should replace the corresponding expectations with desired behavior.
describe.each(["github", "google_drive"] as const)("ZMR baseline: %s", provider => {
  it("demonstrates public recall boundaries and freezes synthetic evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-zmr-baseline-"));
    const state = new SqliteStateStore(":memory:");
    const observer = new Observer();
    const durations: Record<string, number> = {};
    let client: Client | undefined;
    let server: ReturnType<typeof buildMcpServer> | undefined;
    try {
      const seed = join(dir, "seed");
      await seedFixture(seed);
      let repo: VaultRepository;
      if (provider === "github") {
        const bare = join(dir, "origin.git");
        await simpleGit().init(["--bare", "--initial-branch=main", bare]);
        const git = simpleGit(seed);
        await git.init(["--initial-branch=main"]);
        await git.addConfig("user.name", "ZMR synthetic").addConfig("user.email", "zmr@example.invalid");
        await git.add(".");
        await git.commit("frozen synthetic baseline");
        await git.addRemote("origin", bare);
        await git.push("origin", "main");
        repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare, repo: "synthetic/zmr-baseline" });
      } else repo = await FakeDriveVaultRepository.open(seed);
      const initialHashes = await snapshot(repo.path);
      const before = await repo.currentRevision();
      const engine = createEngine({ repo, llm: observer as unknown as BrainLlm, state, readSyncTtlMs: 0, now: () => new Date("2026-09-06T00:00:00.000Z") });
      server = buildMcpServer(async () => engine);
      client = new Client({ name: "zmr-baseline", version: "1" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const call = async (name: string, args: Record<string, unknown>, label: string) => {
        const start = performance.now();
        const result = await client!.callTool({ name, arguments: args });
        durations[label] = performance.now() - start;
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        return result.structuredContent as Record<string, any>;
      };
      const note = await engine.get("Log/2026-01-01.md");
      expect(note.body.indexOf("cobalt-seventeen")).toBeGreaterThan(8000);
      const search = await call("search_memory", { query: "ZMR ORCHID" }, "lexicalSearch");
      expect(search.hits.some((hit: any) => hit.path === "Log/2026-01-01.md")).toBe(true);
      const answer = await call("ask_brain", { question: manifest.cases[0].prompt }, "unpinnedAsk");
      expect(answer.text).toBe("cobalt-seventeen");
      expect(observer.reads.at(-1)!.body).toBe(note.body);
      expect(answer.sources).toEqual(expect.arrayContaining([expect.objectContaining({ path: manifest.refs.late, provider, revisionId: before.id })]));
      const exact = await call("get_memory", { path: manifest.refs.late }, "exactGet");
      expect(exact.entry.content).toContain("cobalt-seventeen");
      expect(exact.entry.content).not.toContain("original launch color");
      expect(exact.entry.provider).toBe(provider);
      expect(exact.entry.evidenceRef).toBe(manifest.refs.late);
      expect(exact.entry.sourceId).toBe("ZMR-e-000001");
      expect(exact.entry.contentType).toBe("text");
      expect(exact.entry.capturedAt).toBe("2026-01-01T00:00:00.000Z");
      // revisionId is optional and currently omitted on engine read sources.
      expect(exact.entry.revisionId).toBeUndefined();
      const pinned = await call("ask_brain", { question: manifest.cases[0].prompt, contextRefs: [manifest.refs.late] }, "pinnedAsk");
      expect(pinned.text).toBe("cobalt-seventeen");
      expect(pinned.sources[0].provider).toBe(provider);
      if (provider === "google_drive") {
        expect(JSON.stringify(exact)).not.toContain("github.com");
        expect(exact.entry.url).toContain("drive.google.com");
        expect(exact.entry.githubUrl).toBeUndefined();
      }
      const filters = { capturedAfter: "2026-01-01T00:00:00.000Z", capturedBefore: "2026-01-01T23:59:59.999Z", order: "oldest" as const, limit: 20 };
      const coreOld = await engine.searchEntries(filters);
      expect(coreOld.map(entry => entry.evidenceRef)).toEqual(Object.values(manifest.refs));
      const historical = await call("search_memory", filters, "historicalSearch");
      expect(historical.entries.map((entry: { evidenceRef: string }) => entry.evidenceRef)).toEqual(Object.values(manifest.refs));
      const catalog = await client.listTools();
      expect(catalog.tools.find(tool => tool.name === "search_memory")!.inputSchema.properties).toHaveProperty("cursor");
      const correction = await call("get_memory", { path: manifest.refs.correction }, "correctionGet");
      expect(correction.entry.content).toContain("now violet; amber is superseded");
      const original = await call("get_memory", { path: manifest.refs.historical }, "originalGet");
      expect(original.entry.content).toContain("original launch color: amber");
      const distractor = await call("get_memory", { path: manifest.refs.distractor }, "distractorGet");
      expect(distractor.entry.content).toContain("ORCHARD");
      expect(correction.entry.content).not.toContain("ORCHARD");
      const unknown = await call("search_memory", { query: "payroll" }, "unknownSearch");
      expect(unknown.hits).toEqual([]);
      const paraphrase = await call("search_memory", { query: "hue replaced shade flower" }, "paraphraseSearch");
      expect(paraphrase.hits).toEqual([]);
      const answerCases = [];
      for (const testCase of manifest.cases) {
        const actual = await call("ask_brain", { question: testCase.prompt }, `ask-${testCase.id}`);
        answerCases.push({ id: testCase.id, prompt: testCase.prompt, expected: testCase.expected, actual: actual.text, refs: testCase.refs.map(key => manifest.refs[key as keyof typeof manifest.refs]) });
      }
      const allSeed = await engine.searchEntries({ limit: 1000 });
      // The inherited vault has one historical evidence entry to keep its citations valid.
      expect(allSeed).toHaveLength(500); // core also clamps requests to 500
      const fixtureEntries = (await Promise.all(["2026-01-01", "2026-06-10", "2026-09-01"].map(async date =>
        (await readFile(join(repo.path, `Log/${date}.md`), "utf8")).match(/^## .*  \^e-[0-9a-f]{6}$/gm)?.length ?? 0))).reduce((a, b) => a + b, 0);
      expect(fixtureEntries).toBe(manifest.fixture.totalSeedEntries + 1);
      expect(await snapshot(repo.path)).toEqual(initialHashes);
      expect((await repo.currentRevision()).id).toBe(before.id);
      const store = await call("store_memory", { content: multiTopic, verbatim: true }, "multiTopicStore");
      expect(observer.classifyInputs.length).toBeGreaterThanOrEqual(3);
      expect(observer.classifyInputs[0].pageIndex.find(page => page.path === "Notes/Oversized.md")!.summary.length).toBeLessThanOrEqual(480);
      expect(observer.composeInputs).toHaveLength(2);
      expect(observer.composeInputs.every((input) => !input.evidenceEntry.includes("UNCERTAIN:"))).toBe(true);
      expect(store.topics.some((topic: { status: string }) => topic.status === "filed")).toBe(true);
      expect(store.topics.some((topic: { status: string }) => topic.status === "uncertain")).toBe(true);
      expect(store.filing).toBe("uncertain");
      expect(store.revision.provider).toBe(provider);
      expect(store.urls.length).toBeGreaterThan(0);
      if (provider === "google_drive") {
        expect(store.githubUrls).toBeUndefined();
        expect(store.urls.every((url: string) => url.startsWith("https://drive.google.com/"))).toBe(true);
      }
      expect(store.pagesTouched).toEqual(expect.arrayContaining(["Areas/Insurance.md", "Projects/Sample Project.md"]));
      expect(store.pagesTouched.some((path: string) => path.startsWith("Inbox/filing-"))).toBe(true);
      const storedEntry = await engine.getEntry(store.evidenceRef);
      expect(storedEntry.content).toBe(multiTopic);
      expect((await repo.currentRevision()).provider).toBe(provider);
      const report = {
        manifest: manifest.id, provider, answerCases, fixtureHashes: initialHashes, durationsMs: durations,
        observed: { seedEntryCount: fixtureEntries, sourceRevisionId: exact.entry.revisionId ?? null, unpinnedAnswer: answer.text, pinnedAnswer: pinned.text, coreOldRefs: coreOld.map(e => e.evidenceRef), mcpOldRefs: historical.entries, filing: store.filing, pagesTouched: store.pagesTouched, classifySegments: observer.classifyInputs.length, summaryInputChars: Math.max(...observer.classifyInputs.flatMap(input => input.pageIndex.map(page => page.summary.length))), typedReadTools: observer.reads[0].tools, unknownSearchHits: unknown.hits.length, paraphraseSearchHits: paraphrase.hits.length },
        externalApiCalls: 0, realModelQuality: "unmeasured", realModelLatencyMs: null, realModelCostUsd: null,
      };
      console.log(`ZMR_BASELINE ${JSON.stringify(report)}`);
      if (process.env.ZMR_BASELINE_OUTPUT_DIR) await writeFile(join(process.env.ZMR_BASELINE_OUTPUT_DIR, `${provider}.json`), JSON.stringify(report, null, 2) + "\n");
    } finally {
      await client?.close();
      await server?.close();
      state.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
