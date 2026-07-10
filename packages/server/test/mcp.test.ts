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
  async describeImage(data, mimeType) {
    expect(Buffer.from(data).toString("utf8")).toBe("fake screenshot bytes");
    expect(mimeType).toBe("image/png");
    return "Screenshot fact: insurance renewal date is 2026-08-15.";
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
    runtime.settings.setRaw("artifact_archive_provider", "local");
    runtime.settings.setRaw("artifact_archive_local_dir", join(dir, "artifacts"));
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
    const { ticket_id, jobId, status, state, poll } = enqueued.structuredContent as {
      ticket_id: string;
      jobId: string;
      status: string;
      state: string;
      poll: { name: string; inputField: string };
    };
    expect(jobId).toBeTruthy();
    expect(ticket_id).toBe(jobId);
    expect(status).toBe("queued");
    expect(state).toBe("accepted");
    expect(poll).toEqual({ name: "get_task_result", inputField: "ticket_id" });
    for (let attempt = 0; attempt < 50; attempt++) {
      const polled = await client.callTool({ name: "get_task_result", arguments: { ticket_id } });
      const job = polled.structuredContent as { status: string; result: Record<string, unknown> | null };
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
      "get_ingest_result",
      "get_memory",
      "get_recent_conversation_transcript",
      "get_task_result",
      "ingest_memory",
      "read_llm_timeline",
      "run_task",
      "search_memory",
      "store_memory",
      "task_brain",
    ]);
    await client.close();
  });

  it("ingest_memory exposes the async media seam with loud input and processor errors", async () => {
    const client = await connect();

    const bad = await client.callTool({ name: "ingest_memory", arguments: { mediaType: "audio" } });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toEqual({
      code: "invalid_input",
      message: "ingest_memory requires either artifactUrl or bytesRef.",
    });

    const enqueued = await client.callTool({
      name: "ingest_memory",
      arguments: {
        mediaType: "screenshot",
        bytesRef: "ring://media/screenshot-1",
        filename: "screen.png",
        sourceHint: "mcp fixture",
        contentHint: "remember the renewal date visible in the screenshot",
        senderTimestamp: "2026-07-09T12:00:00Z",
        hints: ["insurance"],
      },
    });
    const queued = enqueued.structuredContent as { ticket_id: string; jobId: string; kind: string; status: string; state: string };
    expect(queued.jobId).toBeTruthy();
    expect(queued.ticket_id).toBe(queued.jobId);
    expect(queued.kind).toBe("media_ingest");
    expect(queued.status).toBe("queued");
    expect(queued.state).toBe("accepted");

    let terminal: { status: string; result: Record<string, unknown> | null } | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      const poll = await client.callTool({ name: "get_task_result", arguments: { ticket_id: queued.ticket_id } });
      const job = poll.structuredContent as { status: string; result: Record<string, unknown> | null };
      if (job.status === "done") {
        terminal = job;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(terminal).not.toBeNull();
    const receipt = terminal!.result as {
      status: string;
      code: string;
      mediaType: string;
      rawArtifact: { handle: string | null; archiveUrl: string | null };
      extraction: { handle: string | null; ocrHandle?: string | null };
      digest: { evidenceRef: string | null; pagesTouched: string[]; commitSha: string | null; githubUrls: string[] };
      nextAdapterIssues: string[];
    };
    expect(receipt.status).toBe("error");
    expect(receipt.code).toBe("media_ingest_processor_unavailable");
    expect(receipt.mediaType).toBe("screenshot");
    expect(receipt.rawArtifact.handle).toMatch(/^file:\/\//);
    expect(receipt.rawArtifact.archiveUrl).toBe(receipt.rawArtifact.handle);
    expect(receipt.extraction).toEqual({ handle: null, ocrHandle: null, provider: null });
    expect(receipt.digest).toEqual({ evidenceRef: null, pagesTouched: [], commitSha: null, githubUrls: [] });
    expect(receipt.nextAdapterIssues).toEqual(
      expect.arrayContaining([
        "https://github.com/zenod-ai/zenod/issues/660",
        "https://github.com/zenod-ai/zenod/issues/662",
      ]),
    );

    await client.close();
  });

  it("ingest_memory returns archive, extraction, digest, commit, and GitHub receipts for screenshot bytes", async () => {
    const client = await connect();
    const receipt = await runAsyncTool(client, "ingest_memory", {
      mediaType: "screenshot",
      bytesRef: `data:image/png;base64,${Buffer.from("fake screenshot bytes").toString("base64")}`,
      filename: "insurance-screen.png",
      sourceHint: "mcp fixture",
      contentHint: "remember the visible renewal date",
      hints: ["insurance"],
    });

    expect(receipt.status).toBe("done");
    expect(receipt.mediaType).toBe("screenshot");
    expect(receipt.rawArtifact).toMatchObject({
      handle: expect.stringMatching(/^file:\/\//),
      archiveUrl: expect.stringMatching(/^file:\/\//),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(receipt.extraction).toMatchObject({
      handle: expect.stringMatching(/^file:\/\//),
      ocrHandle: expect.stringMatching(/^file:\/\//),
      provider: "vision model",
    });
    expect(receipt.digest).toEqual({
      evidenceRef: "Log/2026-06-11.md#^e-abc123",
      pagesTouched: ["Areas/Insurance.md"],
      commitSha: "0".repeat(40),
      githubUrls: ["https://github.com/o/r/blob/main/Areas/Insurance.md"],
    });

    await client.close();
  });

  it("get_recent_conversation_transcript returns audited WhatsApp voice transcripts and replies", async () => {
    const client = await connect();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const oldSeconds = nowSeconds - 3 * 60 * 60;
    runtime.whatsappStore.recordInbound({
      messageId: "voice_mcp_old",
      chatId: "34622222222@s.whatsapp.net",
      senderId: "34622222222@s.whatsapp.net",
      senderName: "Tester",
      chatName: "Tester",
      isGroup: false,
      timestamp: oldSeconds,
      body: "old exact transcript",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: null,
      mediaRaw: {},
      raw: {},
    });
    runtime.whatsappStore.recordOutboundAudit({
      messageId: "voice_mcp_old",
      chatId: "34622222222@s.whatsapp.net",
      contactId: "34622222222@s.whatsapp.net",
      bodyText: "old exact receipt",
      status: "sent",
      sentMessageId: "sent_voice_mcp_old",
    });
    runtime.whatsappStore.recordInbound({
      messageId: "voice_mcp_1",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Tester",
      chatName: "Tester",
      isGroup: false,
      timestamp: nowSeconds,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: null,
      mediaRaw: {},
      raw: {},
    });
    runtime.whatsappStore.recordInboundTranscript("voice_mcp_1", "raw voice transcript from WhatsApp");
    runtime.whatsappStore.markMediaStorageStatus("voice_mcp_1", "archived");
    runtime.whatsappStore.recordOutboundAudit({
      messageId: "voice_mcp_1",
      chatId: "34611111111@s.whatsapp.net",
      contactId: "34611111111@s.whatsapp.net",
      bodyText: "reply to the voice note",
      status: "sent",
      sentMessageId: "sent_voice_mcp_1",
    });
    runtime.whatsappStore.recordOutboundAudit({
      messageId: "voice_mcp_1",
      chatId: "34611111111@s.whatsapp.net",
      contactId: "34611111111@s.whatsapp.net",
      bodyText:
        "Storage receipt\n" +
        "Drive audio: voice-2026-06-24T14-06-08-990Z-34611111111.ogg\n" +
        "Drive link: https://drive.google.com/file/d/drive-file-voice-mcp-1/view?usp=drivesdk\n" +
        "Vault evidence: Log/2026-06-24.md#^e-test\n" +
        "Vault commit: 1234567890abcdef\n" +
        "Vault link(s):\n" +
        "- https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-24.md",
      status: "sent",
      sentMessageId: "sent_voice_mcp_1_receipt",
    });

    const result = await client.callTool({
      name: "get_recent_conversation_transcript",
      arguments: { windowMinutes: 60, contactId: "34611111111", limit: 10 },
    });
    const text = result.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(text).toContain("voice_mcp_1");
    expect(text).toContain("media=ptt");
    expect(text).toContain("storage=archived");
    expect(text).toContain("drive-file-voice-mcp-1");
    expect(text).toContain("chars=34");
    expect(text).toContain("raw voice transcript from WhatsApp");
    expect(text).toContain("reply to the voice note");
    const entries = (result.structuredContent as { entries: Array<Record<string, unknown>> }).entries;
    expect(entries).toHaveLength(3);
    const inbound = entries.find((entry) => entry.direction === "inbound") as
      | { media?: Array<{ storageStatus?: string }>; linkedReceipts?: Array<{ driveFileIds?: string[]; vaultEvidenceRefs?: string[] }> }
      | undefined;
    expect(inbound?.media?.[0]?.storageStatus).toBe("archived");
    expect(inbound?.linkedReceipts?.[0]?.driveFileIds).toContain("drive-file-voice-mcp-1");
    expect(inbound?.linkedReceipts?.[0]?.vaultEvidenceRefs).toContain("Log/2026-06-24.md#^e-test");
    const outboundEntries = entries.filter((entry) => entry.direction === "outbound");
    expect(outboundEntries.every((entry) => !("media" in entry) && !("linkedReceipts" in entry))).toBe(true);

    const exact = await client.callTool({
      name: "get_recent_conversation_transcript",
      arguments: { messageId: "voice_mcp_1" },
    });
    const exactText = exact.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(exactText).toContain("raw voice transcript from WhatsApp");
    expect(exactText).toContain("reply to the voice note");
    expect(exactText).toContain("storage=archived");
    expect(exactText).toContain("Drive link: https://drive.google.com/file/d/drive-file-voice-mcp-1/view?usp=drivesdk");
    expect((exact.structuredContent as { entries: unknown[] }).entries).toHaveLength(3);

    const oldExact = await client.callTool({
      name: "get_recent_conversation_transcript",
      arguments: { messageId: "voice_mcp_old" },
    });
    const oldExactText = oldExact.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(oldExactText).toContain("old exact transcript");
    expect(oldExactText).toContain("old exact receipt");
    expect((oldExact.structuredContent as { entries: unknown[] }).entries).toHaveLength(2);
    await client.close();
  });

  it("read_llm_timeline returns the operation-labelled usage ledger, newest-first and filterable", async () => {
    const client = await connect();
    const now = Date.now();
    runtime.usageStore.record(
      { operation: "classify", provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0 },
      now - 90 * 60 * 1000,
    );
    runtime.usageStore.record(
      { operation: "compose", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 2000, outputTokens: 500, cachedInputTokens: 0, cacheCreationInputTokens: 0 },
      now - 5 * 60 * 1000,
    );
    runtime.usageStore.record(
      { operation: "compose", provider: "openai", model: "gpt-5", inputTokens: 999, outputTokens: 111, cachedInputTokens: 0, cacheCreationInputTokens: 0 },
      now - 8 * 24 * 60 * 60 * 1000, // outside a 120m window
    );

    const result = await client.callTool({ name: "read_llm_timeline", arguments: { windowMinutes: 120 } });
    const text = result.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(text).toContain("compose — anthropic/claude-opus-4-8");
    expect(text).toContain("classify — anthropic/claude-haiku-4-5");
    expect(text).not.toContain("gpt-5"); // outside the window
    const calls = (result.structuredContent as { calls: Array<{ operation: string }> }).calls;
    expect(calls[0]?.operation).toBe("compose"); // newest first
    expect(calls.at(-1)?.operation).toBe("classify");

    const filtered = await client.callTool({ name: "read_llm_timeline", arguments: { windowMinutes: 120, operation: "compose" } });
    const filteredCalls = (filtered.structuredContent as { calls: Array<{ operation: string }> }).calls;
    expect(filteredCalls).toHaveLength(1);
    expect(filteredCalls[0]?.operation).toBe("compose");
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
    expect(poll.structuredContent).toMatchObject({
      ticket_id: "does-not-exist",
      state: "error",
      error: { code: "not_found" },
    });
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
  let runnerServer: ServerType;
  let url: URL;
  let token: string;
  let oldRunnerUrl: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-epaminon-mcp-"));
    oldRunnerUrl = process.env.ZENOD_RUNNER_POKE_URL;
    runnerServer = serve({
      fetch: (request) => (new URL(request.url).pathname === "/run" ? Response.json({ ok: true }) : new Response("not found", { status: 404 })),
      port: 0,
    });
    const runnerPort = (runnerServer.address() as AddressInfo).port;
    process.env.ZENOD_RUNNER_POKE_URL = `http://127.0.0.1:${runnerPort}`;
    runtime = new Runtime(dir, EPAMINON_AGENT);
    runtime.settings.set("github_token", "test-token");
    runtime.settings.setRaw("epaminon_codex_cli_auth", "test-cli");
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
    runnerServer.close();
    if (oldRunnerUrl === undefined) delete process.env.ZENOD_RUNNER_POKE_URL;
    else process.env.ZENOD_RUNNER_POKE_URL = oldRunnerUrl;
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

  it("execution_status returns elapsed + phase mid-run (F-2 / C-09)", async () => {
    // Annotate the running ticket with a controller-observed phase/partial.
    await runtime.executionQueue!.recordProgress({ executionId: "104", phase: "editing", progressNote: "wiring the endpoint" });
    const client = await connect();
    try {
      const result = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#103" } });
      const text = JSON.stringify(result.content);
      expect(text).toMatch(/elapsed/);
      expect(text).toContain("editing");
      expect(text).toContain("wiring the endpoint");
      // The structured ticket carries the mid-run phase + startedAt too.
      const ticket = (result.structuredContent as { tickets: Array<{ phase?: string; startedAt?: number }> }).tickets[0];
      expect(ticket.phase).toBe("editing");
      expect(typeof ticket.startedAt).toBe("number");
    } finally {
      await client.close();
    }
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

  // #234 read-path honesty: a filter that matches nothing on a NON-empty queue must not
  // read as "nothing ran" — the text must say tickets exist but were excluded.
  it("does not phrase a filtered-empty read as 'nothing ran' when the queue is non-empty", async () => {
    const client = await connect();
    try {
      const none = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#999999" } });
      const status = none.structuredContent as { tickets: unknown[]; total: number; filtered: number };
      expect(status.filtered).toBe(0);
      expect(status.total).toBeGreaterThan(0);
      const text = JSON.stringify(none.content);
      expect(text).toContain("exist on the executor");
      expect(text).toContain("Do NOT tell the user nothing ran");
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

  it("runs merged-PR reconciliation before MCP execution_status reads", async () => {
    runtime.settings.setRaw("github_token", "gh-test-token");
    await runtime.executionQueue!.reportOutcome({
      executionId: "109",
      outward: true,
      evidenceUrl: "https://github.com/zenod-ai/zenod/pull/302",
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://api.github.com/repos/zenod-ai/zenod/pulls/302") {
          return new Response(JSON.stringify({ html_url: "https://github.com/zenod-ai/zenod/pull/302", state: "closed", merged: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      }),
    );
    const client = await connect();
    try {
      const result = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#109" } });
      expect((result.structuredContent as { tickets: Array<{ executionId: string; state: string }> }).tickets).toEqual([
        expect.objectContaining({ executionId: "109", state: "done" }),
      ]);
    } finally {
      await client.close();
      vi.unstubAllGlobals();
    }
  });

  it("exposes Epaminon-owned exact issue execution start", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("epaminon.run_existing_issue");

      const result = await client.callTool({
        name: "epaminon.run_existing_issue",
        arguments: { target: "zenod-ai/zenod#270", instructions: "Use the current branch.", effort: "high", notifyOnStart: false },
      });
      const structured = result.structuredContent as {
        ticket: { executionId: string; target: string; state: string; context: string; effort?: string; note?: string; notifyOnStart?: boolean };
      };
      expect(structured.ticket).toMatchObject({ target: "zenod-ai/zenod#270" });
      expect(["queued", "running"]).toContain(structured.ticket.state);
      expect(structured.ticket.executionId).toMatch(/^direct-/);
      expect(structured.ticket.context).toContain("Use the current branch.");
      expect(structured.ticket.context).toContain("Effort: high");
      expect(structured.ticket.effort).toBe("high");
      expect(structured.ticket.notifyOnStart).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("exposes prompt-first Epaminon task dispatch aliases and status readback", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("epaminon.run_task");
      expect(names).toContain("epaminon.dispatch_worker");

      const runTask = tools.find((t) => t.name === "epaminon.run_task");
      expect((runTask?.inputSchema as { properties?: Record<string, unknown> })?.properties).toEqual(
        expect.objectContaining({
          prompt: expect.any(Object),
          effort: expect.any(Object),
          repo: expect.any(Object),
          path: expect.any(Object),
          outputTarget: expect.any(Object),
          mcpServers: expect.any(Object),
          skills: expect.any(Object),
          instructions: expect.any(Object),
        }),
      );

      const result = await client.callTool({
        name: "epaminon.run_task",
        arguments: {
          prompt: "Research the current server MCP contract.",
          effort: "high",
          repo: "zenod-ai/zenod",
          path: "packages/server",
          outputTarget: "write a concise handoff artifact",
          mcpServers: ["github", "zenod-memory"],
          skills: ["epic-spine"],
          instructions: "Keep runner lifecycle unchanged.",
        },
      });
      const structured = result.structuredContent as {
        executionId: string;
        statusTool: string;
        typedStatusTool: string;
        ticket: { executionId: string; target: string; state: string; context: string };
      };
      expect(structured.executionId).toBe(structured.ticket.executionId);
      expect(structured.statusTool).toBe("execution_status");
      expect(structured.typedStatusTool).toBe("epaminon.execution_status");
      expect(structured.ticket.target).toBe(`ephemeral:${structured.ticket.executionId}`);
      expect(structured.ticket.context).toContain("Research the current server MCP contract.");
      expect(structured.ticket.context).toContain("Effort: high");
      expect(structured.ticket.context).toContain("Target repo: zenod-ai/zenod");
      expect(structured.ticket.context).toContain("Target path within repo: packages/server");
      expect(structured.ticket.context).toContain("Output target: write a concise handoff artifact");
      expect(structured.ticket.context).toContain("MCP servers/context: github, zenod-memory");
      expect(structured.ticket.context).toContain("Skills: epic-spine");

      const status = await client.callTool({ name: "execution_status", arguments: { message: structured.executionId } });
      expect((status.structuredContent as { tickets: Array<{ executionId: string }> }).tickets).toEqual([
        expect.objectContaining({ executionId: structured.executionId }),
      ]);

      const alias = await client.callTool({
        name: "epaminon.dispatch_worker",
        arguments: { prompt: "Summarize one file.", outputTarget: "return summary only" },
      });
      expect((alias.structuredContent as { executionId: string }).executionId).toMatch(/^ephemeral-/);
    } finally {
      await client.close();
    }
  });

  it("exposes Epaminon-owned ephemeral task execution without a GitHub issue target", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("epaminon.run_ephemeral_task");

      const result = await client.callTool({
        name: "epaminon.run_ephemeral_task",
        arguments: { objective: "Research one thing without creating a backlog ticket.", effort: "high", artifactPolicy: "return summary only" },
      });
      const structured = result.structuredContent as { ticket: { executionId: string; target: string; state: string; context: string; effort?: string; note?: string } };
      expect(structured.ticket.executionId).toMatch(/^ephemeral-/);
      expect(structured.ticket.target).toBe(`ephemeral:${structured.ticket.executionId}`);
      expect(["queued", "running"]).toContain(structured.ticket.state);
      expect(structured.ticket.context).toContain("Research one thing");
      expect(structured.ticket.context).toContain("Effort: high");
      expect(structured.ticket.context).toContain("return summary only");
      expect(structured.ticket.effort).toBe("high");
    } finally {
      await client.close();
    }
  });
});
