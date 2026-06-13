import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

const fakeEngine: BrainEngine = {
  async store(input) {
    return {
      evidenceRef: "Log/2026-06-11.md#^e-abc123",
      pagesTouched: ["Areas/Insurance.md"],
      commitSha: "0".repeat(40),
      githubUrls: ["https://github.com/o/r/blob/main/Areas/Insurance.md"],
      ...(input.content.includes("cryptic") ? { question: "Where does this belong?" } : {}),
    };
  },
  async ask(question) {
    return { text: `Answer to: ${question}`, sources: [{ path: "Areas/Insurance.md", githubUrl: "" }] };
  },
  async chat(message) {
    return { text: `Re: ${message}`, sources: [] };
  },
  async search(query) {
    return [{ path: "Areas/Insurance.md", snippet: `about ${query}`, score: 9, githubUrl: "" }];
  },
  async get(path) {
    return { path, frontmatter: { title: "Insurance" }, body: "# Insurance", githubUrl: "" };
  },
  async lint() {
    return { ok: true, errors: [], checkedFiles: 1 };
  },
  async work(input) {
    if (!input.plan) return { mode: "proposal" as const, text: `PLAN for: ${input.objective}`, committed: false };
    return {
      mode: "executed" as const,
      text: "swept",
      committed: true,
      commitSha: "1".repeat(40),
      changedPaths: ["Notes/Swept.md"],
      githubUrls: [],
    };
  },
  async digestBacklog(input) {
    const sourceRefs = input.sourceRefs ?? [{ path: input.memoryPath ?? "Log/2026-06-13.md#^e-abc123", githubUrl: "" }];
    return {
      candidates: [
        {
          title: "Write launch backlog",
          type: "action" as const,
          owner: "agent" as const,
          priority: "P0" as const,
          status: "ready" as const,
          source_refs: sourceRefs,
          summary: "Create structured backlog from the transcript.",
          context: "The source asks for backlog writing.",
          acceptance_criteria: ["Candidates include citations."],
          dependencies: [],
          open_questions: [],
          difficulty: "medium" as const,
          suggested_labels: ["backlog"],
          target_repo: "zenod-ai/zenod",
        },
      ],
      written: input.write ? [{ path: "Backlog/write-launch-backlog.md", githubUrl: "", title: "Write launch backlog" }] : [],
      skipped: input.write ? [] : [{ reason: "write not requested; returned proposed candidates only" }],
      source_refs: sourceRefs,
    };
  },
};

describe("MCP endpoint", () => {
  let dir: string;
  let runtime: Runtime;
  let server: ServerType;
  let url: URL;
  let token: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-mcp-"));
    runtime = new Runtime(dir);
    runtime.getEngine = async () => fakeEngine;
    token = runtime.settings.apiToken();
    const app = createApp(runtime);
    server = serve({ fetch: app.fetch, port: 0 });
    const { port } = server.address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    server.close();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  function connect() {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    return client.connect(transport).then(() => client);
  }

  it("rejects connections without the bearer token", async () => {
    const transport = new StreamableHTTPClientTransport(url);
    const client = new Client({ name: "anon", version: "0.0.0" });
    await expect(client.connect(transport)).rejects.toThrow(/401|unauthorized/i);
  });

  it("lists the six Zenod tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_brain",
      "digest_backlog",
      "get_memory",
      "run_task",
      "search_memory",
      "store_memory",
    ]);
    await client.close();
  });

  it("search_memory and store_memory round-trip", async () => {
    const client = await connect();

    const search = await client.callTool({ name: "search_memory", arguments: { query: "insurance" } });
    expect(JSON.stringify(search.structuredContent)).toContain("Areas/Insurance.md");

    const store = await client.callTool({
      name: "store_memory",
      arguments: { content: "I renewed my insurance" },
    });
    const stored = store.structuredContent as { commitSha: string; question?: string };
    expect(stored.commitSha).toBe("0".repeat(40));
    expect(stored.question).toBeUndefined();

    const unsure = await client.callTool({
      name: "store_memory",
      arguments: { content: "something cryptic" },
    });
    expect((unsure.structuredContent as { question?: string }).question).toBeTruthy();

    await client.close();
  });

  it("run_task proposes without a plan and executes with one", async () => {
    const client = await connect();

    const propose = await client.callTool({ name: "run_task", arguments: { objective: "sweep the Inbox" } });
    const proposal = propose.structuredContent as { mode: string; committed: boolean; text: string };
    expect(proposal.mode).toBe("proposal");
    expect(proposal.committed).toBe(false);

    const execute = await client.callTool({
      name: "run_task",
      arguments: { objective: "sweep the Inbox", approvedPlan: proposal.text },
    });
    const executed = execute.structuredContent as { mode: string; committed: boolean; commitSha?: string };
    expect(executed.mode).toBe("executed");
    expect(executed.committed).toBe(true);
    expect(executed.commitSha).toBe("1".repeat(40));

    await client.close();
  });

  it("ask_brain returns a synthesized answer with sources", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "ask_brain", arguments: { question: "what insurance do I have?" } });
    const answer = result.structuredContent as { text: string; sources: Array<{ path: string }> };
    expect(answer.text).toContain("what insurance do I have?");
    expect(answer.sources[0]?.path).toBe("Areas/Insurance.md");
    await client.close();
  });

  it("digest_backlog returns structured candidates and preserves source refs", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "digest_backlog",
      arguments: {
        rawText: "launch backlog writing",
        sourceRefs: [{ path: "Log/2026-06-13.md#^e-test", githubUrl: "https://example.test/source" }],
      },
    });
    const digest = result.structuredContent as {
      candidates: Array<{ title: string; source_refs: Array<{ path: string }> }>;
      written: Array<{ path: string }>;
    };
    expect(digest.candidates[0]?.title).toBe("Write launch backlog");
    expect(digest.candidates[0]?.source_refs[0]?.path).toBe("Log/2026-06-13.md#^e-test");
    expect(digest.written).toEqual([]);
    await client.close();
  });
});
