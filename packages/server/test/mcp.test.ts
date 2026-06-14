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
  async chat(message, _surface, options) {
    if (typeof options === "object") {
      options.onToolEvent?.({ phase: "start", tool: "digestBacklog", label: "Digest backlog" });
      options.onToolEvent?.({ phase: "end", tool: "digestBacklog", label: "Digest backlog" });
    }
    return { text: `Re: ${message}`, sources: [] };
  },
  async handleTasking(input) {
    return { text: `Tasked: ${input.text}`, actions: [] };
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

  /** Enqueue a job via an async tool, then poll get_task_result until terminal. */
  async function runAsyncTool(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const enqueued = await client.callTool({ name, arguments: args });
    const { jobId, status } = enqueued.structuredContent as { jobId: string; status: string };
    expect(jobId).toBeTruthy();
    expect(status).toBe("queued");
    for (let attempt = 0; attempt < 50; attempt++) {
      const poll = await client.callTool({ name: "get_task_result", arguments: { jobId } });
      const job = poll.structuredContent as { status: string; result: Record<string, unknown> | null };
      if (job.status === "done") return job.result!;
      if (job.status === "error" || job.status === "interrupted") throw new Error(`job ${jobId} ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`job ${jobId} did not finish`);
  }

  it("rejects connections without the bearer token", async () => {
    const transport = new StreamableHTTPClientTransport(url);
    const client = new Client({ name: "anon", version: "0.0.0" });
    await expect(client.connect(transport)).rejects.toThrow(/401|unauthorized/i);
  });

  it("lists the Zenod tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_brain",
      "chat_with_zenod",
      "clean_slate_vault",
      "digest_backlog",
      "get_memory",
      "get_task_result",
      "run_task",
      "search_memory",
      "store_memory",
      "task_brain",
    ]);
    await client.close();
  });

  it("clean_slate_vault requires explicit confirmation", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "clean_slate_vault", arguments: { confirm: false } });
    expect((result.structuredContent as { confirmed?: boolean }).confirmed).toBe(false);
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

  it("run_task proposes without a plan and executes with one (async + poll)", async () => {
    const client = await connect();

    const proposal = (await runAsyncTool(client, "run_task", { objective: "sweep the Inbox" })) as {
      mode: string;
      committed: boolean;
      text: string;
    };
    expect(proposal.mode).toBe("proposal");
    expect(proposal.committed).toBe(false);

    const executed = (await runAsyncTool(client, "run_task", {
      objective: "sweep the Inbox",
      approvedPlan: proposal.text,
    })) as { mode: string; committed: boolean; commitSha?: string };
    expect(executed.mode).toBe("executed");
    expect(executed.committed).toBe(true);
    expect(executed.commitSha).toBe("1".repeat(40));

    await client.close();
  });

  it("get_task_result reports a not-found job", async () => {
    const client = await connect();
    const poll = await client.callTool({ name: "get_task_result", arguments: { jobId: "does-not-exist" } });
    expect((poll.structuredContent as { found: boolean }).found).toBe(false);
    expect(poll.isError).toBe(true);
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

  it("chat_with_zenod runs engine.chat and writes a correlated audit row", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "chat_with_zenod",
      arguments: {
        message: "do you have a digest backlog tool?",
        conversationKey: "issue-37-mcp",
        testRunId: "issue-37",
      },
    });
    const chat = result.structuredContent as {
      correlationId: string;
      text: string;
      surface: string;
      conversationId: string;
      toolEvents: Array<{ tool: string }>;
    };
    expect(chat.text).toBe("Re: do you have a digest backlog tool?");
    expect(chat.surface).toBe("mcp");
    expect(chat.conversationId).toBe("mcp:issue-37-mcp");
    expect(chat.toolEvents.map((event) => event.tool)).toEqual(["digestBacklog", "digestBacklog"]);
    expect(runtime.state.getChatTestRun(chat.correlationId)?.prompt).toBe("do you have a digest backlog tool?");
    await client.close();
  });

  it("task_brain routes instructions through the shared tasking entrypoint (async + poll)", async () => {
    const client = await connect();
    const result = (await runAsyncTool(client, "task_brain", {
      text: "create an issue for the digest gap",
      conversationKey: "mcp-test",
    })) as { text: string };
    expect(result.text).toBe("Tasked: create an issue for the digest gap");
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
