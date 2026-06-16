import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION, type BrainEngine, type CleanSlateResult, type DriveSourceTools, type StoreResult, type TaskingReply, type WorkResult } from "zenod";
import type { CreateGithubIssueInput, CreateGithubIssueResult, EditGithubIssueInput, EditGithubIssueResult } from "zenod";
import { runSyntheticChat, type ChatTestAuditInput, type ChatTestAuditRecord } from "./testHarness.js";
import type { TaskJob, TaskJobInput, TaskJobKind } from "./taskJobStore.js";
import {
  ASK_BRAIN_SHAPE,
  CREATE_ISSUE_SHAPE,
  EDIT_GITHUB_ISSUE_SHAPE,
  GET_MEMORY_SHAPE,
  SEARCH_MEMORY_SHAPE,
} from "./mcpToolSchemas.js";

/**
 * The long tools (task_brain, run_task, store_memory) run a multi-minute LLM
 * loop / git commit, so they enqueue a background job and return its id at once;
 * the caller polls get_task_result. This is the queue seam the MCP server talks
 * to.
 */
export interface TaskJobs {
  enqueue(kind: TaskJobKind, input: TaskJobInput): TaskJob;
  get(id: string): TaskJob | null;
}

export type GithubIssueEditor = (input: EditGithubIssueInput) => Promise<EditGithubIssueResult>;
export type GithubIssueCreator = (input: CreateGithubIssueInput) => Promise<CreateGithubIssueResult>;

/** Human-facing text for a finished task_brain job — mirrors the old reply. */
function formatTaskingReply(result: TaskingReply): string {
  const actions =
    result.actions.length > 0
      ? ["", "Actions:", ...result.actions.map((action) => `- ${action.tool}: ${action.result}`)]
      : [];
  return [result.text, ...actions].join("\n");
}

/** The immediate reply when a long agentic tool enqueues a background job. */
function enqueuedResponse(job: TaskJob) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Queued job ${job.id} (status: ${job.status}). This runs in the background — poll get_task_result with this jobId until status is 'done'.`,
      },
    ],
    structuredContent: { jobId: job.id, kind: job.kind, status: job.status },
  };
}

/** Human-facing text for a finished store_memory job — mirrors the old reply. */
function formatStoreResult(result: StoreResult): string {
  return [
    result.question ? `QUESTION FOR THE USER: ${result.question}` : "Stored.",
    `evidence: ${result.evidenceRef}`,
    `pages: ${result.pagesTouched.join(", ")}`,
    `commit: ${result.commitSha}`,
    ...result.githubUrls,
  ].join("\n");
}

/** Human-facing text for a finished run_task job — mirrors the old reply. */
function formatWorkResult(result: WorkResult): string {
  const lines =
    result.mode === "proposal"
      ? [`PLAN (relay to the user for approval, then call run_task again with approvedPlan):`, result.text]
      : [
          result.mode === "failed" ? "FAILED (rolled back, nothing committed)" : result.committed ? "EXECUTED" : "EXECUTED (no changes were needed)",
          result.text,
          ...(result.commitSha ? [`commit: ${result.commitSha}`] : []),
          ...(result.changedPaths?.length ? [`changed: ${result.changedPaths.join(", ")}`] : []),
        ];
  return lines.join("\n");
}

/**
 * The Zenod MCP tool surface (docs/M0-SPEC.md): no raw file CRUD. Drive tools
 * appear only while a Google Drive connection is configured. Built fresh per
 * request — the transport is stateless Streamable HTTP.
 */
export function buildMcpServer(
  getEngine: () => Promise<BrainEngine>,
  getDriveTools?: () => DriveSourceTools | undefined,
  cleanSlate?: () => Promise<CleanSlateResult>,
  recordChatTestRun?: (input: ChatTestAuditInput) => ChatTestAuditRecord,
  taskJobs?: TaskJobs,
  editGithubIssue?: GithubIssueEditor,
  createGithubIssue?: GithubIssueCreator,
  agentName: string = "zenod",
): McpServer {
  const server = new McpServer({ name: "zenod-mcp-server", version: VERSION });

  // This agent's chat-brain tool: a full engine.chat turn (the agent reasons with
  // its own tools and replies). Named per-agent — chat_with_zenod, chat_with_archus
  // — so it reads sensibly on every agent and routes unambiguously over the mesh.
  server.registerTool(
    `chat_with_${agentName}`,
    {
      title: `Chat with ${agentName}`,
      description:
        "Send a natural-language prompt through this agent's engine.chat loop (the same loop used by web and WhatsApp) — the agent reasons with its own tools and returns a reply. For a backlog agent this engages its backlog brain (query/triage/create/edit issues); for a memory agent, the vault. Supports an explicit conversationKey/testRunId for isolated multi-turn sessions and self-tests. Returns reply text, sources, tool events, and a correlation id written to the chat audit log.",
      inputSchema: {
        message: z.string().min(1).describe("Natural-language prompt to send to the agent"),
        surface: z.enum(["cli", "mcp", "whatsapp", "web", "drive"]).optional().describe("Surface label to run as. Defaults to mcp."),
        conversationKey: z.string().min(1).optional().describe("Stable key for multi-turn test context"),
        testRunId: z.string().min(1).optional().describe("Optional caller-supplied test run grouping id"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ message, surface, conversationKey, testRunId }) => {
      if (!recordChatTestRun) throw new Error("chat test audit store is not configured");
      const result = await runSyntheticChat({
        request: { message, ...(surface ? { surface } : {}), ...(conversationKey ? { conversationKey } : {}), ...(testRunId ? { testRunId } : {}) },
        defaultSurface: "mcp",
        getEngine,
        recordAudit: recordChatTestRun,
      });
      const lines = [
        result.status === "ok" ? result.text : `ERROR: ${result.error}`,
        "",
        `correlationId: ${result.correlationId}`,
        `conversationId: ${result.conversationId}`,
        `toolEvents: ${result.toolEvents.length}`,
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result as unknown as { [key: string]: unknown },
        isError: result.status === "error",
      };
    },
  );

  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description:
        "Deterministic search over the user's memory vault. Returns ranked note paths with snippets, scores, and GitHub source URLs. Fast (no LLM) — call this first to locate memories; then use get_memory to read one. For fuzzy or synthesis questions, prefer ask_brain.",
      inputSchema: SEARCH_MEMORY_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const engine = await getEngine();
      const hits = await engine.search(query);
      const output = { hits };
      return {
        content: [
          {
            type: "text",
            text:
              hits.length === 0
                ? `No memories match '${query}'.`
                : hits.map((h) => `${h.path} (score ${h.score}) — ${h.snippet}${h.githubUrl ? `\n  ${h.githubUrl}` : ""}`).join("\n"),
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_memory",
    {
      title: "Get memory",
      description:
        "Read one note from the memory vault by its vault-relative path (e.g. 'Areas/Insurance.md'). Returns frontmatter, full content, and the GitHub source URL. Paths come from search_memory results.",
      inputSchema: GET_MEMORY_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      const engine = await getEngine();
      const note = await engine.get(path);
      return {
        content: [
          {
            type: "text",
            text: `# ${note.path}\nfrontmatter: ${JSON.stringify(note.frontmatter)}\n${note.githubUrl ? `source: ${note.githubUrl}\n` : ""}\n${note.body}`,
          },
        ],
        structuredContent: { path: note.path, frontmatter: note.frontmatter, body: note.body, githubUrl: note.githubUrl },
      };
    },
  );

  server.registerTool(
    "store_memory",
    {
      title: "Store memory",
      description:
        "Store a memory in the user's vault through the librarian pipeline: records immutable evidence in the Log, files the meaning onto the right page(s) with citations, validates, and commits to GitHub. If the librarian is unsure where the memory belongs, it returns a question instead of guessing — relay that question to the user. Use for anything the user wants remembered: facts, decisions, events, preferences. ASYNC: the librarian pipeline runs classify + compose LLM calls and a git commit (slower for longer memories), so it returns a jobId immediately (status 'queued') and does NOT wait — poll get_task_result with that jobId until status is 'done' to read the evidence ref, pages touched, commit SHA, and any question.",
      inputSchema: {
        content: z.string().min(1).describe("The memory to store, as the user expressed it"),
        hints: z.array(z.string()).optional().describe("Optional filing hints, e.g. 'belongs to the housing project'"),
        verbatim: z.boolean().optional().describe("Force verbatim evidence recording (exact words preserved)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ content, hints, verbatim }) => {
      const input: TaskJobInput = {
        content,
        ...(hints ? { hints } : {}),
        ...(verbatim !== undefined ? { verbatim } : {}),
      };
      if (taskJobs) {
        const job = taskJobs.enqueue("store", input);
        return enqueuedResponse(job);
      }
      // No queue wired (e.g. a minimal embedding) — run synchronously.
      const engine = await getEngine();
      const result = await engine.store({
        content,
        source: "mcp",
        ...(hints ? { hints } : {}),
        ...(verbatim !== undefined ? { verbatim } : {}),
      });
      return { content: [{ type: "text", text: formatStoreResult(result) }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "ask_brain",
    {
      title: "Ask the brain",
      description:
        "Ask the user's memory agent a free-form question. It runs its own read-only research loop over the vault and returns a synthesized answer with cited sources (vault paths + GitHub URLs). Use for fuzzy or cross-note questions ('what do I know about X?', 'when does my policy renew?') where search_memory alone is not enough. Slower than search_memory (runs an LLM loop).",
      inputSchema: ASK_BRAIN_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ question }) => {
      const engine = await getEngine();
      const answer = await engine.ask(question);
      const sources = answer.sources.map((s) => `- ${s.path}${s.githubUrl ? ` (${s.githubUrl})` : ""}`).join("\n");
      return {
        content: [{ type: "text", text: sources ? `${answer.text}\n\nSources:\n${sources}` : answer.text }],
        structuredContent: { ...answer },
      };
    },
  );

  server.registerTool(
    "task_brain",
    {
      title: "Task the brain",
      description:
        "Send an instruction-bearing message through the shared tasking loop used by WhatsApp, Web, MCP, and self-tests. Use for requests to file/capture notes, run a digest, create or label GitHub issues, query backlog status, or service/select backlog work. ASYNC: this runs a multi-minute agent loop, so it returns a jobId immediately (status 'queued') and does NOT wait — poll get_task_result with that jobId until status is 'done' to read the reply and actions. Queue one instruction per call; jobs run one at a time.",
      inputSchema: {
        text: z.string().min(1).describe("The user's instruction or status question"),
        conversationKey: z.string().min(1).optional().describe("Correlation/thread key; defaults to mcp"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ text, conversationKey }) => {
      const input: TaskJobInput = { text, ...(conversationKey ? { conversationKey } : {}) };
      if (taskJobs) {
        const job = taskJobs.enqueue("task", input);
        return enqueuedResponse(job);
      }
      // No queue wired (e.g. a minimal embedding) — run synchronously.
      const engine = await getEngine();
      const result = await engine.handleTasking({ text, surface: "mcp", conversationKey: conversationKey ?? "mcp" });
      return { content: [{ type: "text", text: formatTaskingReply(result) }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "run_task",
    {
      title: "Run a vault task",
      description:
        "Give the librarian an objective that requires reorganizing the vault (sweep the Inbox, merge duplicate pages, refile or archive notes, fix structure). Two-step contract: call WITHOUT approvedPlan first — the librarian surveys read-only and returns a concrete plan; show that plan to the user. Once the user approves, call again with the (possibly user-edited) plan as approvedPlan — the librarian executes it on the vault working tree, the engine validates (lint + evidence immutability) and lands everything as ONE commit, or rolls back fully. Log/ and _attachments/ are immutable and can never be changed by this tool. NEVER pass approvedPlan without explicit user approval of that plan. ASYNC: both steps run a multi-minute agent loop, so each call returns a jobId immediately (status 'queued') and does NOT wait — poll get_task_result with that jobId until status is 'done' to read the plan (propose step) or the execution result.",
      inputSchema: {
        objective: z.string().min(1).describe("What to accomplish, e.g. 'sweep the Inbox: file, archive, or delete each item'"),
        approvedPlan: z
          .string()
          .min(1)
          .optional()
          .describe("The user-approved plan from the propose step. Only pass after the user said yes."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ objective, approvedPlan }) => {
      const input: TaskJobInput = { objective, ...(approvedPlan ? { plan: approvedPlan } : {}) };
      if (taskJobs) {
        const job = taskJobs.enqueue("work", input);
        return enqueuedResponse(job);
      }
      // No queue wired (e.g. a minimal embedding) — run synchronously.
      const engine = await getEngine();
      const result = await engine.work({ objective, ...(approvedPlan ? { plan: approvedPlan } : {}) });
      return { content: [{ type: "text", text: formatWorkResult(result) }], structuredContent: { ...result } };
    },
  );

  if (taskJobs) {
    server.registerTool(
      "get_task_result",
      {
        title: "Get task result",
        description:
          "Poll a background job started by task_brain, run_task, or store_memory, by its jobId. Returns the current status: 'queued' or 'running' (not finished — poll again shortly), 'done' (the result is included: the tasking reply + actions for a task_brain job, the plan/execution result for a run_task job, or the evidence ref + pages + commit for a store_memory job), 'error' (with the message), or 'interrupted' (a server restart killed it — re-issue the original call). Jobs run one at a time, so a queued job may wait behind earlier ones.",
        inputSchema: { jobId: z.string().min(1).describe("The jobId returned by task_brain, run_task, or store_memory") },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ jobId }) => {
        const job = taskJobs.get(jobId);
        if (!job) {
          return {
            content: [{ type: "text", text: `No job found for id ${jobId}.` }],
            structuredContent: { found: false, jobId },
            isError: true,
          };
        }
        const resultText =
          job.status === "done" && job.result
            ? job.kind === "task"
              ? formatTaskingReply(job.result as TaskingReply)
              : job.kind === "store"
                ? formatStoreResult(job.result as StoreResult)
                : formatWorkResult(job.result as WorkResult)
            : job.status === "error"
              ? `ERROR: ${job.error ?? "unknown error"}`
              : job.status === "interrupted"
                ? `INTERRUPTED: ${job.error ?? "a server restart killed this job"} — re-issue the original call.`
                : `Status: ${job.status}. Not finished yet — poll get_task_result again shortly.`;
        return {
          content: [{ type: "text", text: resultText }],
          structuredContent: {
            found: true,
            jobId: job.id,
            kind: job.kind,
            status: job.status,
            result: job.result ?? null,
            error: job.error,
          },
          isError: job.status === "error",
        };
      },
    );
  }

  if (cleanSlate) {
    server.registerTool(
      "clean_slate_vault",
      {
        title: "Clean-slate vault onboarding",
        description:
          "Initialize a fresh empty vault through Zenod's clean-slate onboarding flow. This is intentionally hard to invoke: it refuses non-empty vaults and requires confirm=true. It creates two auditable commits: clean-slate: initial vault, then clean-slate: initialize Zenod schema. Use only when the user explicitly asks to start a clean-slate vault.",
        inputSchema: {
          confirm: z.boolean().describe("Must be true after explicit user confirmation."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async ({ confirm }) => {
        if (!confirm) {
          return {
            content: [
              {
                type: "text",
                text: "Confirmation required. Ask the user to confirm clean-slate onboarding, then call clean_slate_vault with confirm=true.",
              },
            ],
            structuredContent: { confirmed: false },
          };
        }
        const result = await cleanSlate();
        const lines = [
          "Clean-slate vault initialized.",
          `vault: ${result.vaultPath}`,
          `initial commit: ${result.initialCommitSha}`,
          `setup commit: ${result.setupCommitSha}`,
          `top-level: ${result.topLevelPaths.join(", ")}`,
          `lint: ${result.lint.ok ? "ok" : `${result.lint.errors.length} error(s)`}`,
          "inspect:",
          ...result.inspect.map((cmd) => `- ${cmd}`),
          "revert:",
          ...result.revert.map((cmd) => `- ${cmd}`),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: { ...result } };
      },
    );
  }

  server.registerTool(
    "digest_backlog",
    {
      title: "Digest backlog",
      description:
        "Mine a transcript, memory note, or scoped vault query for structured backlog/action candidates with citations. Returns proposed candidates by default. Set write=true only when the user explicitly wants proposed backlog records materialized in the vault backlog surface; this writes records, not arbitrary task execution or GitHub issues.",
      inputSchema: {
        rawText: z.string().min(1).optional().describe("Raw transcript or note text to mine directly"),
        memoryPath: z.string().min(1).optional().describe("Vault-relative note/log path to mine"),
        query: z.string().min(1).optional().describe("Vault search scope, e.g. 'recent Zenod voice notes launch backlog'"),
        sourceRefs: z
          .array(z.object({ path: z.string().min(1), githubUrl: z.string() }))
          .optional()
          .describe("Optional source refs to attach to rawText candidates"),
        write: z.boolean().optional().describe("When true, write proposed backlog records under Backlog/"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ rawText, memoryPath, query, sourceRefs, write }) => {
      const engine = await getEngine();
      const result = await engine.digestBacklog({
        ...(rawText ? { rawText } : {}),
        ...(memoryPath ? { memoryPath } : {}),
        ...(query ? { query } : {}),
        ...(sourceRefs ? { sourceRefs } : {}),
        ...(write !== undefined ? { write } : {}),
      });
      const lines = [
        `Backlog candidates: ${result.candidates.length}`,
        ...result.candidates.map((candidate, index) => {
          const sources = candidate.source_refs.map((ref) => ref.path).join(", ");
          return `${index + 1}. [${candidate.priority}/${candidate.type}/${candidate.status}] ${candidate.title}${sources ? ` — ${sources}` : ""}`;
        }),
        ...(result.written.length > 0 ? ["", "Written:", ...result.written.map((item) => `- ${item.path}${item.githubUrl ? ` (${item.githubUrl})` : ""}`)] : []),
        ...(result.skipped.length > 0 ? ["", "Skipped:", ...result.skipped.map((item) => `- ${item.title ? `${item.title}: ` : ""}${item.reason}`)] : []),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: { ...result } };
    },
  );

  if (editGithubIssue) {
    server.registerTool(
      "edit_github_issue",
      {
        title: "Edit a GitHub issue",
        description:
          "Edit one issue in the configured GitHub repository: update title/body, add/remove/set labels, post a comment, replace assignees, or update the lifecycle status label. Examples: {issueNumber: 52, title: 'Clarify launch scope'} edits the title; {issueNumber: 52, labelsAdd: ['owner:agent'], status: 'proposed'} assigns agent ownership while keeping the ticket proposed; {issueNumber: 52, comment: 'Blocked on API decision.'} posts a comment. Governance: generic label edits normalize status:queued and status:approved-merge to status:proposed. Setting status:queued requires direct user approval for this exact numbered issue and queueApproval=true. status:approved-merge is not available here; use the merge approval gate.",
        inputSchema: EDIT_GITHUB_ISSUE_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (input) => {
        const result = await editGithubIssue(input);
        const lines = [
          `Edited ${result.repo}#${result.issueNumber}: ${result.issueUrl}`,
          ...(result.operations.length ? [`operations: ${result.operations.join(", ")}`] : ["operations: none"]),
          ...(result.labels ? [`labels: ${result.labels.join(", ")}`] : []),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: { ...result } };
      },
    );
  }

  if (createGithubIssue) {
    server.registerTool(
      "create_issue",
      {
        title: "Open a GitHub issue",
        description:
          "Open a new issue in the agent's GitHub repository (defaults to its configured backlog/vault repo; pass repo to target another). Direct structured creation — no LLM. Tickets are worked by autonomous agents, so write a runnable body: objective, explicit scope, and a done-condition/acceptance criteria (plus the files for code work). The ticket is created at status:proposed and does NOT run until it is explicitly queued. Returns the new number + URL.",
        inputSchema: CREATE_ISSUE_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (input) => {
        const result = await createGithubIssue(input);
        return {
          content: [{ type: "text", text: `Created ${result.repo}#${result.issueNumber}: ${result.issueUrl}` }],
          structuredContent: { ...result },
        };
      },
    );
  }

  const driveTools = getDriveTools?.();
  if (driveTools) {
    server.registerTool(
      "list_drive_files",
      {
        title: "List Google Drive files",
        description:
          "List files waiting in the user's Google Drive inbox folder, newest first — one per line with name, file ID, type, size, and modified date (already-ingested files live in its Archive/ subfolder and are not shown). Optional query filters by name. Use the file IDs with ingest_drive_file.",
        inputSchema: { query: z.string().optional().describe("Filter by file name (substring)") },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async ({ query }) => ({
        content: [{ type: "text", text: await driveTools.listDriveFiles(query) }],
      }),
    );

    server.registerTool(
      "ingest_drive_file",
      {
        title: "Ingest a Google Drive file",
        description:
          "Queue one Google Drive file (by ID) for background transcription: it downloads, transcribes audio with the configured provider (Groq when set, otherwise local whisper.cpp), files the transcript into the vault as evidence + meaning, commits, and archives the original — in a background worker. Returns immediately with the job id/status; it does not wait for completion. Queue one file per call.",
        inputSchema: {
          fileId: z.string().min(1).describe("The Drive file ID from list_drive_files"),
          hints: z.array(z.string()).optional().describe("Optional filing hints"),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ fileId, hints }) => ({
        content: [{ type: "text", text: await driveTools.ingestDriveFile(fileId, hints) }],
      }),
    );
  }

  return server;
}
