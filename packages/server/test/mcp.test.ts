import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
import { ARCHUS_AGENT, EPAMINON_AGENT } from "../src/agent.js";
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
      "create_issue",
      "digest_backlog",
      "edit_github_issue",
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

    const stored = (await runAsyncTool(client, "store_memory", {
      content: "I renewed my insurance",
    })) as { commitSha: string; question?: string };
    expect(stored.commitSha).toBe("0".repeat(40));
    expect(stored.question).toBeUndefined();

    const unsure = (await runAsyncTool(client, "store_memory", {
      content: "something cryptic",
    })) as { question?: string };
    expect(unsure.question).toBeTruthy();

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

describe("Archus MCP v4 issue reads", () => {
  let dir: string;
  let runtime: Runtime;
  let server: ServerType;
  let url: URL;
  let token: string;
  let originalFetch: typeof globalThis.fetch;

  const issue103 = {
    number: 103,
    title: "Fusion spike planning",
    html_url: "https://github.com/AlfaBlok/obsidian-brain/issues/103",
    labels: [{ name: "owner:agent" }, { name: "status:proposed" }],
    created_at: "2026-06-18T10:00:00Z",
    updated_at: "2026-06-19T10:00:00Z",
    state: "open",
    body: "Acceptance criteria: explain the Fusion spike. Scope: repo docs. Source context: voice note.",
  };
  const issue108 = {
    number: 108,
    title: "Runner notification bug",
    html_url: "https://github.com/AlfaBlok/obsidian-brain/issues/108",
    labels: [{ name: "bug" }],
    created_at: "2026-06-19T11:00:00Z",
    updated_at: "2026-06-20T11:00:00Z",
    state: "open",
    body: "Notifications did not fire.",
  };

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.github.com/")) return originalFetch(input, init);
      if (url.includes("/repos/AlfaBlok/obsidian-brain/issues/103/comments")) {
        return new Response(JSON.stringify([{ body: "runner launched", html_url: `${issue103.html_url}#issuecomment-1`, created_at: "2026-06-19T10:30:00Z" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/repos/AlfaBlok/obsidian-brain/issues/108/comments")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/repos/AlfaBlok/obsidian-brain/issues/103")) {
        return new Response(JSON.stringify(issue103), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/repos/AlfaBlok/obsidian-brain/issues/108")) {
        return new Response(JSON.stringify(issue108), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/repos/AlfaBlok/obsidian-brain/issues/999")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/repos/AlfaBlok/obsidian-brain/issues?")) {
        return new Response(JSON.stringify([issue108, issue103]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof globalThis.fetch;

    dir = await mkdtemp(join(tmpdir(), "zenod-archus-mcp-"));
    runtime = new Runtime(dir, ARCHUS_AGENT);
    runtime.settings.setRaw("backlog_repo", "AlfaBlok/obsidian-brain");
    runtime.settings.setRaw("github_token", "test-token");
    token = runtime.settings.regenerateApiToken();
    const app = createApp(runtime);
    server = serve({ fetch: app.fetch, port: 0 });
    const { port } = server.address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    server.close();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function connect() {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "archus-test-client", version: "0.0.0" });
    await client.connect(transport);
    return client;
  }

  it("exposes structured get/list/find issue reads", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      expect.arrayContaining(["archus.get_issue", "archus.find_issue", "archus.list_issues"]),
    );

    const got = await client.callTool({ name: "archus.get_issue", arguments: { target: "AlfaBlok/obsidian-brain#103" } });
    expect(JSON.stringify(got.content)).toContain("state: open");
    expect(JSON.stringify(got.content)).toContain("Acceptance criteria: explain the Fusion spike.");
    expect(JSON.stringify(got.content)).toContain("runner launched");
    expect(JSON.stringify(got.content)).toContain(issue103.html_url);
    expect(got.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "issue",
            target: "AlfaBlok/obsidian-brain#103",
            title: "Fusion spike planning",
            url: issue103.html_url,
          }),
        ],
      }),
    );

    const listed = await client.callTool({ name: "archus.list_issues", arguments: { state: "open", labels: ["bug"] } });
    expect(JSON.stringify(listed.content)).toContain("AlfaBlok/obsidian-brain#108");
    expect(JSON.stringify(listed.content)).toContain("Runner notification bug");
    expect(JSON.stringify(listed.content)).toContain(issue108.html_url);
    expect(listed.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "issue_list",
            issues: [expect.objectContaining({ target: "AlfaBlok/obsidian-brain#108", title: "Runner notification bug" })],
          }),
        ],
      }),
    );

    const resolved = await client.callTool({ name: "archus.find_issue", arguments: { reference: "#103" } });
    expect(resolved.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "issue_resolved",
            target: "AlfaBlok/obsidian-brain#103",
            url: issue103.html_url,
          }),
        ],
      }),
    );

    const phrasedNumber = await client.callTool({ name: "archus.find_issue", arguments: { reference: "issue 108" } });
    expect(phrasedNumber.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "issue_resolved",
            target: "AlfaBlok/obsidian-brain#108",
            url: issue108.html_url,
          }),
        ],
      }),
    );

    const ambiguous = await client.callTool({ name: "archus.find_issue", arguments: { reference: "issue" } });
    expect(ambiguous.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [],
        candidates: expect.arrayContaining([
          expect.objectContaining({ target: "AlfaBlok/obsidian-brain#103" }),
          expect.objectContaining({ target: "AlfaBlok/obsidian-brain#108" }),
        ]),
      }),
    );

    const missingResolver = await client.callTool({ name: "archus.find_issue", arguments: { reference: "does-not-exist", recentWindow: "48h" } });
    expect(missingResolver.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "issue_not_found",
            searchedRepos: ["AlfaBlok/obsidian-brain"],
            searchedWindow: "48h",
            candidates: [],
          }),
        ],
      }),
    );
    expect(missingResolver.isError).toBeUndefined();

    const missingGet = await client.callTool({ name: "archus.get_issue", arguments: { target: "AlfaBlok/obsidian-brain#999" } });
    expect(missingGet.isError).toBe(true);
    expect(missingGet.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [],
        errors: [expect.objectContaining({ code: "issue_not_found" })],
      }),
    );
    await client.close();
  });
});

describe("Epaminon MCP execution status", () => {
  let dir: string;
  let runtime: Runtime;
  let server: ServerType;
  let url: URL;
  let token: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-epaminon-mcp-"));
    runtime = new Runtime(dir, EPAMINON_AGENT);
    token = runtime.settings.apiToken();
    await runtime.executionQueue!.enqueue({
      executionId: "104",
      target: "AlfaBlok/obsidian-brain#103",
      context: "Fusion spike execution context",
    });
    await runtime.executionQueue!.enqueue({
      executionId: "109",
      target: "AlfaBlok/obsidian-brain#108",
      context: "Backlog system plan execution context",
    });
    await runtime.executionQueue!.enqueue({
      executionId: "100",
      target: "AlfaBlok/obsidian-brain#1",
      context: "Older execution context",
    });
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

  async function connect() {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "epaminon-test-client", version: "0.0.0" });
    await client.connect(transport);
    return client;
  }

  it("exposes execution_status as a deterministic queue read", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("execution_status");

    const result = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#103" } });
    const status = result.structuredContent as {
      tickets: Array<{ executionId: string; target: string; state: string }>;
      executor: boolean;
    };
    expect(status.executor).toBe(true);
    expect(status.tickets).toEqual([
      expect.objectContaining({
        executionId: "104",
        target: "AlfaBlok/obsidian-brain#103",
        state: "running",
      }),
    ]);
    expect(JSON.stringify(result.content)).toContain("AlfaBlok/obsidian-brain#103");
    await client.close();
  });

  it("normalizes human execution_status filters without substring false positives", async () => {
    const client = await connect();
    try {
      const exact = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#108" } });
      expect((exact.structuredContent as { tickets: Array<{ target: string }> }).tickets.map((ticket) => ticket.target)).toEqual([
        "AlfaBlok/obsidian-brain#108",
      ]);

      const unqualified = await client.callTool({ name: "execution_status", arguments: { message: "Did issue 108 run?" } });
      expect((unqualified.structuredContent as { tickets: Array<{ target: string }> }).tickets.map((ticket) => ticket.target)).toEqual([
        "AlfaBlok/obsidian-brain#108",
      ]);

      const executionIssue = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#109" } });
      expect(
        (executionIssue.structuredContent as { tickets: Array<{ executionId: string; target: string }> }).tickets.map((ticket) => ({
          executionId: ticket.executionId,
          target: ticket.target,
        })),
      ).toEqual([{ executionId: "109", target: "AlfaBlok/obsidian-brain#108" }]);

      const broad = await client.callTool({ name: "execution_status", arguments: { message: "Show the current recent execution backlog." } });
      expect((broad.structuredContent as { tickets: Array<unknown>; filtered: number }).filtered).toBe(3);
    } finally {
      await client.close();
    }
  });

  it("exposes epaminon.execution_status as the typed v4 status read", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("epaminon.execution_status");

    const result = await client.callTool({
      name: "epaminon.execution_status",
      arguments: { workIssue: "AlfaBlok/obsidian-brain#103" },
    });
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "execution_status",
            executionId: "104",
            workIssue: "AlfaBlok/obsidian-brain#103",
            state: "running",
          }),
        ],
      }),
    );

    const byExecutionIssue = await client.callTool({
      name: "epaminon.execution_status",
      arguments: { executionIssue: "AlfaBlok/obsidian-brain#109" },
    });
    expect(byExecutionIssue.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "execution_status",
            executionId: "109",
            workIssue: "AlfaBlok/obsidian-brain#108",
            state: "running",
          }),
        ],
      }),
    );

    const missing = await client.callTool({
      name: "epaminon.execution_status",
      arguments: { executionId: "missing" },
    });
    expect(missing.structuredContent).toEqual(
      expect.objectContaining({
        evidence: [
          expect.objectContaining({
            kind: "execution_none",
            executions: [],
          }),
        ],
      }),
    );
    expect(missing.isError).toBeUndefined();
    await client.close();
  });
});
