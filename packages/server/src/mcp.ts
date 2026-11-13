import { captureReceiptsFor, mergeMemoryEntries, searchMemoryEntryPage } from "./memoryEntryCatalog.js";
import { readAsLine, readAsNote, shownReadings, type ReadAs } from "./quickIndexRead.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AnswerCancelledError,
  ContextRefError,
  memoryEntrySummaries,
  type MemoryTreeIndex,
  type EntrySearchInput,
  type EntrySearchResult,
  isGithubAuthorizationRevoked,
  VERSION,
  type BrainEngine,
  type CleanSlateResult,
  type DriveSourceTools,
  type Reply,
  type StoreResult,
  type Surface,
  type TaskingReply,
  type WorkResult,
} from "zenod";
import type { CreateGithubIssueInput, CreateGithubIssueResult, EditGithubIssueInput, EditGithubIssueResult } from "zenod";
import type { IngestJob } from "./ingestStore.js";
import {
  runSyntheticChat,
  type ChatTestAuditInput,
  type ChatTestAuditRecord,
  type ChatTurnInterceptor,
} from "./testHarness.js";
import { awaitingVaultRecovery, type MediaIngestReceipt, type TaskJob, type TaskJobInput, type TaskJobKind } from "./taskJobStore.js";
import type { ExecutionTicket } from "./executionQueue.js";
import {
  formatConversationTranscript,
  transcriptQueryFromToolArgs,
  type ConversationTranscriptEntry,
  type ConversationTranscriptReader,
} from "./conversationTranscript.js";
import {
  formatSessionLog,
  sessionLogQueryFromToolArgs,
  type SessionLogReader,
} from "./sessionLog.js";
import {
  ASK_BRAIN_SHAPE,
  CREATE_ISSUE_SHAPE,
  EDIT_GITHUB_ISSUE_SHAPE,
  EXECUTION_STATUS_SHAPE,
  GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE,
  GET_INGEST_RESULT_SHAPE,
  READ_LLM_TIMELINE_SHAPE,
  GET_MEMORY_SHAPE,
  MEMORY_CLOUD_SHAPE,
  INGEST_MEMORY_SHAPE,
  SEARCH_MEMORY_SHAPE,
  V4_FIND_ISSUE_SHAPE,
  V4_EXECUTION_STATUS_SHAPE,
  V4_GET_ISSUE_SHAPE,
  V4_LIST_ISSUES_SHAPE,
  BACKLOG_CREATE_SHAPE,
  BACKLOG_EDIT_SHAPE,
  BACKLOG_CLOSE_SHAPE,
  BACKLOG_COMMENT_SHAPE,
  BACKLOG_LIST_SHAPE,
  EPAMINON_RUN_TASK_SHAPE,
  RUN_ISSUE_SHAPE,
  RUN_EPHEMERAL_TASK_SHAPE,
  STORE_MEMORY_SHAPE,
} from "./mcpToolSchemas.js";
import { evidence, type ToolResponse, toolResponse, toMcpToolResult } from "./toolOutput.js";
import { storeReceiptHeadline } from "./recentSaves.js";
import { rankHits } from "./rankedMemory.js";
import { opsAlert } from "./opsAlert.js";

/**
 * The long tools (task_brain, run_task, store_memory) run a multi-minute LLM
 * loop / git commit, so they enqueue a background job and return its id at once;
 * the caller polls get_task_result. This is the queue seam the MCP server talks
 * to.
 */
export interface TaskJobs {
  enqueue(kind: TaskJobKind, input: TaskJobInput, idempotencyKey?: string): TaskJob;
  get(id: string): TaskJob | null;
  recent?(limit?: number): TaskJob[];
  /** EPIC-24 M15: lean finished capture receipts, so a read never loads the whole job history. */
  captureReceipts?(evidenceRef?: string): TaskJob[];
  captureContent?(id: string): { content?: string; contentHint?: string } | null;
  admit?(kind: TaskJobKind, input: TaskJobInput): { code: string; message: string } | null;
  /** Hosted public beta uses Drive only as an archive/export destination. */
  hostedArchiveOnlyDrive?: boolean;
}

export interface MediaIngestJobs {
  enqueueAudio(input: {
    bytesRef: string;
    filename?: string;
    hints?: string[];
    contentHint?: string;
    sourceHint?: string;
  }): Promise<IngestJob>;
  get(id: string): IngestJob | null;
}

export type GithubIssueEditor = (input: EditGithubIssueInput) => Promise<EditGithubIssueResult>;
export type GithubIssueCreator = (input: CreateGithubIssueInput) => Promise<CreateGithubIssueResult>;
export type ExecutionStatusReader = () => ExecutionTicket[] | null;
export type BeforeExecutionStatusRead = () => Promise<void> | void;
export type ExistingIssueRunner = (input: {
  target: string;
  instructions?: string;
  repo?: string;
  effort?: "low" | "medium" | "high" | "max";
  notifyOnStart?: boolean;
}) => Promise<ExecutionTicket>;
export type EphemeralTaskRunner = (input: {
  objective: string;
  instructions?: string;
  artifactPolicy?: string;
  effort?: "low" | "medium" | "high" | "max";
  repo?: string;
  path?: string;
  outputTarget?: string;
  mcpServers?: string[];
  skills?: string[];
}) => Promise<ExecutionTicket>;
export interface BacklogIssueReader {
  getIssue(input: { target: string }): Promise<ToolResponse>;
  findIssue(input: { reference: string; repos?: string[]; recentWindow?: string; labels?: string[]; limit?: number }): Promise<ToolResponse>;
  listIssues(input: {
    repo?: string;
    state?: "open" | "closed" | "all";
    labels?: string[];
    createdSince?: string;
    updatedSince?: string;
    limit?: number;
  }): Promise<ToolResponse>;
  // S0-T1 deterministic life-backlog writers (hard-wired repo, read-back verified).
  createIssue(input: { title: string; body?: string; labels?: string[] }): Promise<ToolResponse>;
  editIssue(input: { number: number; title?: string; body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<ToolResponse>;
  closeIssue(input: { number: number; comment?: string; reason?: "completed" | "not_planned" }): Promise<ToolResponse>;
  commentIssue(input: { number: number; body: string }): Promise<ToolResponse>;
  listBacklog(input: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number }): Promise<ToolResponse>;
}
/**
 * E15-Q4: how long ask_brain may run before it stops and says so. Under the 60 s many MCP clients wait,
 * so the honest stop arrives before the client gives up; ZENOD_ASK_BRAIN_TIMEOUT_MS overrides it.
 */
export const ASK_BRAIN_TIMEOUT_MS = 55_000;
export function askBrainTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.ZENOD_ASK_BRAIN_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1_000 && value <= 600_000 ? value : ASK_BRAIN_TIMEOUT_MS;
}

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
  const poll = { name: "get_task_result", inputField: "ticket_id" as const };
  return {
    content: [
      {
        type: "text" as const,
        text: `Queued job ${job.id} (status: ${job.status}). This runs in the background — poll get_task_result with this ticket_id until state is 'done'.`,
      },
    ],
    structuredContent: {
      ticket_id: job.id,
      jobId: job.id,
      kind: job.kind,
      status: job.status,
      state: "accepted" as const,
      poll,
    },
  };
}

function evidenceFileUrl(evidenceRef: string, urls: string[]): string | undefined {
  const [path] = evidenceRef.split("#", 1);
  if (!path) return undefined;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const base = urls.find((value) => {
    try {
      return new URL(value).pathname.endsWith(`/${encodedPath}`);
    } catch {
      return false;
    }
  });
  // Legacy results did not persist the evidence line. Return the canonical log
  // file instead of inventing a GitHub fragment from the Obsidian block id.
  return base?.split("#", 1)[0];
}

function taskJobEvidence(job: TaskJob): Array<Record<string, unknown>> {
  const result = job.result as Record<string, unknown> | null;
  const revision = result?.revision && typeof result.revision === "object" && !Array.isArray(result.revision)
    ? result.revision as Record<string, unknown>
    : undefined;
  const commitSha = typeof result?.commitSha === "string" ? result.commitSha : undefined;
  const evidenceRef = typeof result?.evidenceRef === "string" ? result.evidenceRef : undefined;
  const githubUrls = Array.isArray(result?.githubUrls)
    ? result.githubUrls.filter((value): value is string => typeof value === "string")
    : [];
  const urls = Array.isArray(result?.urls)
    ? result.urls.filter((value): value is string => typeof value === "string")
    : githubUrls;
  const evidenceUrl = typeof result?.evidenceUrl === "string"
    ? result.evidenceUrl
    : evidenceRef
      ? evidenceFileUrl(evidenceRef, urls)
      : undefined;
  const pagesTouched = Array.isArray(result?.pagesTouched)
    ? result.pagesTouched.filter((value): value is string => typeof value === "string")
    : [];
  const pageUrls = Array.isArray(result?.pageUrls)
    ? result.pageUrls.filter((value): value is string => typeof value === "string")
    : urls.filter((value) => value !== evidenceUrl && value.split("#", 1)[0] !== evidenceUrl?.split("#", 1)[0]);
  if (job.kind === "store") {
    return [
      {
        kind: "memory_stored",
        id: job.id,
        ticket_id: job.id,
        jobId: job.id,
        status: "done",
        ...(evidenceRef ? { evidenceRef } : {}),
        ...(evidenceUrl ? { url: evidenceUrl } : {}),
        ...(revision ? { revision } : {}),
        urls,
        ...(commitSha ? { commitSha } : {}),
        pagesTouched,
        ...(typeof result?.filing === "string" ? { filing: result.filing } : {}),
        ...(Array.isArray(result?.topics) ? { topics: result.topics } : {}),
        ...(githubUrls.length ? { githubUrls } : {}),
        pageUrls,
      },
    ];
  }
  return [
    {
      kind: "task_job",
      id: job.id,
      ticket_id: job.id,
      ...(commitSha ? { commitSha } : {}),
      ...(revision ? { revision } : {}),
      ...(urls[0] ? { url: urls[0] } : {}),
    },
  ];
}

function formatExecutionStatus(tickets: ExecutionTicket[]): string {
  if (tickets.length === 0) {
    return "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.";
  }
  return tickets
    .map((ticket) => {
      const parts = [
        `#${ticket.executionId}`,
        ticket.target,
        ticket.state,
      ];
      // F-2 / C-09: a RUNNING ticket reports mid-run elapsed + coarse phase, not just state.
      if (ticket.state === "running") {
        parts.push(`elapsed ${formatExecElapsed(ticket)}`);
        if (ticket.phase) parts.push(`phase: ${ticket.phase}`);
        if (ticket.progressNote) parts.push(`last: ${ticket.progressNote}`);
      }
      parts.push(`updated ${new Date(ticket.updatedAt).toISOString()}`);
      if (ticket.note) parts.push(`note: ${ticket.note}`);
      if (ticket.evidenceUrl) parts.push(`evidence: ${ticket.evidenceUrl}`);
      // S-1 (b): the recent controller-observed activity trail, human-rendered.
      if (ticket.recentEvents?.length) parts.push(`recent: ${ticket.recentEvents.join(" › ")}`);
      // S-1 (a/c): the durable full-transcript link — resolves live and after death.
      if (ticket.transcriptUrl) parts.push(`transcript: ${ticket.transcriptUrl}`);
      return parts.join(" — ");
    })
    .join("\n");
}

/** PURE (F-2 / C-09): compact mid-run elapsed for a running ticket from its startedAt. */
function formatExecElapsed(ticket: ExecutionTicket, now = Date.now()): string {
  const started = ticket.startedAt ?? ticket.updatedAt;
  const s = Math.max(0, Math.round((now - started) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function filterExecutionTickets(tickets: ExecutionTicket[], message?: string): ExecutionTicket[] {
  const query = message?.trim().toLowerCase();
  if (!query) return tickets;

  const qualifiedRefs = Array.from(query.matchAll(/\b[a-z0-9_.-]+\/[a-z0-9_.-]+#\d+\b/g)).map((match) => match[0]);
  if (qualifiedRefs.length > 0) {
    const refs = new Set(qualifiedRefs);
    const numbers = new Set(qualifiedRefs.map((ref) => ref.match(/#(\d+)$/)?.[1]).filter((n): n is string => Boolean(n)));
    return tickets.filter((ticket) => refs.has(ticket.target.toLowerCase()) || numbers.has(ticket.executionId.toLowerCase()));
  }

  const unqualifiedRefs = Array.from(query.matchAll(/(?:#|issue\s+|ticket\s+|execution\s+)(\d+)\b/g)).map((match) => match[1]);
  if (unqualifiedRefs.length > 0) {
    const refs = new Set(unqualifiedRefs);
    return tickets.filter((ticket) => refs.has(ticket.executionId.toLowerCase()) || unqualifiedRefs.some((ref) => ticket.target.endsWith(`#${ref}`)));
  }

  if (/\b(list|show|current|recent|all|backlog|queue|status|executions?)\b/.test(query)) {
    return tickets;
  }

  return tickets.filter((ticket) => {
    const searchable = [ticket.executionId, ticket.target, ticket.state, ticket.note ?? "", ticket.evidenceUrl ?? ""].join(" ").toLowerCase();
    return searchable.includes(query);
  });
}

type V4ExecutionState = "queued" | "running" | "needs_review" | "blocked" | "done" | "failed";

function canonicalExecutionState(state: ExecutionTicket["state"]): V4ExecutionState {
  if (state === "needs-review" || state === "approved") return "needs_review";
  return state;
}

function filterExecutionTicketsV4(
  tickets: ExecutionTicket[],
  filters: {
    workIssue?: string;
    executionIssue?: string;
    executionId?: string;
    state?: V4ExecutionState;
    since?: string;
    limit?: number;
  },
): ExecutionTicket[] {
  const sinceMs = filters.since ? Date.parse(filters.since) : NaN;
  const executionIssueId = filters.executionIssue?.match(/#(\d+)$/)?.[1] ?? filters.executionIssue;
  return tickets
    .filter((ticket) => {
      if (filters.executionId && ticket.executionId !== filters.executionId) return false;
      if (filters.workIssue && ticket.target !== filters.workIssue) return false;
      if (filters.executionIssue && ticket.executionId !== executionIssueId && ticket.target !== filters.executionIssue) return false;
      if (filters.state && canonicalExecutionState(ticket.state) !== filters.state) return false;
      if (Number.isFinite(sinceMs) && ticket.updatedAt < sinceMs) return false;
      return true;
    })
    .slice(0, filters.limit ?? 20);
}

function executionStatusEvidence(ticket: ExecutionTicket) {
  const blockers = ticket.state === "blocked" && ticket.note ? [ticket.note] : [];
  const resultRefs = ticket.evidenceUrl ? [ticket.evidenceUrl] : [];
  // F-2 / C-09: a running ticket returns mid-run elapsed + coarse phase, not just state.
  const midRun =
    ticket.state === "running"
      ? {
          elapsed: formatExecElapsed(ticket),
          ...(ticket.startedAt ? { startedAt: new Date(ticket.startedAt).toISOString() } : {}),
          ...(ticket.phase ? { phase: ticket.phase } : {}),
          ...(ticket.progressNote ? { lastPartial: ticket.progressNote } : {}),
        }
      : {};
  return evidence("execution_status", {
    executionId: ticket.executionId,
    workIssue: ticket.target,
    state: canonicalExecutionState(ticket.state),
    runnerStatus: ticket.state,
    ...midRun,
    // S-1 (b): the last-N observed events, live and after terminal.
    ...(ticket.recentEvents?.length ? { recentEvents: ticket.recentEvents } : {}),
    // S-1 (a/c): the durable full-transcript link.
    ...(ticket.transcriptUrl ? { transcriptUrl: ticket.transcriptUrl } : {}),
    ...(blockers.length ? { blockers } : {}),
    ...(resultRefs.length ? { resultRefs } : {}),
    updatedAt: new Date(ticket.updatedAt).toISOString(),
  });
}

function v4ExecutionStatusResponse(
  tickets: ExecutionTicket[],
  filters: {
    workIssue?: string;
    executionIssue?: string;
    executionId?: string;
    state?: V4ExecutionState;
    since?: string;
    limit?: number;
  },
) {
  const filteredTickets = filterExecutionTicketsV4(tickets, filters);
  if (filteredTickets.length === 0) {
    return toolResponse({
      text: "No executions matched the requested scope.",
      evidence: [
        evidence("execution_none", {
          searchScope: filters,
          executions: [],
        }),
      ],
    });
  }
  return toolResponse({
    text: formatExecutionStatus(filteredTickets),
    evidence: filteredTickets.map(executionStatusEvidence),
  });
}

type PublicEpaminonTaskInput = {
  prompt: string;
  effort?: "low" | "medium" | "high" | "max";
  repo?: string;
  path?: string;
  outputTarget?: string;
  mcpServers?: string[];
  skills?: string[];
  instructions?: string;
};

function publicExecutionResponse(toolName: string, ticket: ExecutionTicket) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Queued execution ${ticket.executionId}: ${ticket.state}. Poll execution_status with executionId ${ticket.executionId}.`,
      },
    ],
    structuredContent: {
      executionId: ticket.executionId,
      statusTool: "execution_status",
      typedStatusTool: "epaminon.execution_status",
      tool: toolName,
      ticket,
    },
  };
}

/** Human-facing text for a finished store_memory job — mirrors the old reply. */
function formatStoreResult(result: StoreResult): string {
  const status = storeReceiptHeadline(result);
  return [
    status,
    ...(result.topics ?? []).map((topic) => `${topic.status}: ${topic.topic} (${topic.pages.join(", ") || "evidence only"})${topic.reason ? ` — ${topic.reason}` : ""}`),
    `evidence: ${result.evidenceRef}`,
    ...(result.evidenceUrl ? [`evidence URL: ${result.evidenceUrl}`] : []),
    `pages: ${result.pagesTouched.join(", ")}`,
    ...(result.revision ? [`saved revision: ${result.revision.provider}:${result.revision.id}`] : []),
    ...(result.commitSha ? [`commit: ${result.commitSha}`] : []),
    ...(result.urls ?? result.githubUrls ?? []),
  ].join("\n");
}

function ingestReceipt(job: IngestJob): Record<string, unknown> {
  return {
    jobId: job.id,
    status: job.status,
    rawArtifact: {
      kind: "drive_file",
      handle: job.driveFileId,
      filename: job.fileName,
      url: job.sourceLink,
      archived: job.archived,
    },
    transcript: job.evidenceRef
      ? {
          evidenceRef: job.evidenceRef,
          provider: job.transcribedBy,
        }
      : null,
    pagesTouched: job.pages,
    revision: job.revision,
    urls: job.urls,
    ...(job.commitSha ? { commitSha: job.commitSha } : {}),
    ...(job.githubUrls.length ? { githubUrls: job.githubUrls } : {}),
    backlog: job.backlog,
  };
}

function formatIngestResult(job: IngestJob): string {
  if (job.status === "error") return `ERROR: ${job.error ?? "audio ingest failed"}`;
  if (job.status === "interrupted") return `INTERRUPTED: ${job.error ?? job.step ?? "audio ingest was interrupted"} — retry the ingest.`;
  if (job.status !== "done") {
    return `Status: ${job.status}${job.step ? ` — ${job.step}` : ""}${job.progress ? ` (${job.progress}%)` : ""}.`;
  }
  return [
    "Audio ingest complete.",
    `raw artifact: ${job.driveFileId}${job.sourceLink ? ` (${job.sourceLink})` : ""}`,
    `archived: ${job.archived ? "yes" : "no"}`,
    `transcript evidence: ${job.evidenceRef ?? "(missing)"}`,
    job.transcribedBy ? `transcribed by: ${job.transcribedBy}` : null,
    `pages: ${job.pages.join(", ")}`,
    job.revision ? `saved revision: ${job.revision.provider}:${job.revision.id}` : "saved revision: (missing)",
    ...(job.commitSha ? [`commit: ${job.commitSha}`] : []),
    ...job.urls,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatMediaIngestResult(result: MediaIngestReceipt): string {
  return [
    result.status === "error" ? `ERROR: ${result.code}` : "Media ingest complete.",
    result.message,
    `mediaType: ${result.mediaType}`,
    `rawArtifact: ${result.rawArtifact.handle ?? "none"}`,
    `archiveUrl: ${result.rawArtifact.archiveUrl ?? "none"}`,
    `extraction: ${result.extraction.handle ?? "none"}`,
    `evidence: ${result.digest.evidenceRef ?? "none"}`,
    `pages: ${result.digest.pagesTouched.join(", ") || "none"}`,
    result.digest.revision ? `saved revision: ${result.digest.revision.provider}:${result.digest.revision.id}` : "saved revision: none",
    ...(result.digest.commitSha ? [`commit: ${result.digest.commitSha}`] : []),
    ...(result.digest.enrichmentJobId ? [`background enrichment: ${result.digest.enrichmentJobId}`] : []),
    ...(result.digest.urls.length ? result.digest.urls : result.digest.githubUrls ?? []),
  ].join("\n");
}

/** Human-facing text for a finished run_task job — mirrors the old reply. */
function formatWorkResult(result: WorkResult): string {
  const lines =
    result.mode === "proposal"
      ? [`PLAN (relay to the user for approval, then call run_task again with approvedPlan):`, result.text]
      : [
          result.mode === "failed" ? "FAILED (rolled back, nothing saved)" : result.committed ? "EXECUTED" : "EXECUTED (no changes were needed)",
          result.text,
          ...(result.revision ? [`saved revision: ${result.revision.provider}:${result.revision.id}`] : []),
          ...(result.commitSha ? [`commit: ${result.commitSha}`] : []),
          ...(result.changedPaths?.length ? [`changed: ${result.changedPaths.join(", ")}`] : []),
        ];
  return lines.join("\n");
}

function githubConnectionRequired(tool: string) {
  const message = `Connect GitHub before using ${tool}. Memory and local Markdown backlog tools remain available.`;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { error: { code: "github_connection_required", message } },
    isError: true,
  };
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
  readExecutionStatus?: ExecutionStatusReader,
  beforeReadExecutionStatus?: BeforeExecutionStatusRead,
  readBacklogIssues?: BacklogIssueReader,
  readConversationTranscript?: ConversationTranscriptReader,
  runExistingIssue?: ExistingIssueRunner,
  runEphemeralTask?: EphemeralTaskRunner,
  readSessionLog?: SessionLogReader,
  // User-set display name for THIS instance (settings.instance_name). Lets a user
  // run several memories and tell them apart in their client. Empty → default.
  serverName: string = "",
  mediaIngest?: MediaIngestJobs,
  existingServer?: McpServer,
  chatInterceptor?: ChatTurnInterceptor,
  githubCapability?: () => boolean,
  onGithubAuthorizationRevoked?: () => void,
  readAsFor?: (question: string) => Promise<ReadAs[]>,
): McpServer {
  const server =
    existingServer ??
    new McpServer({
      name: serverName.trim() || "zenod-mcp-server",
      version: VERSION,
    });

  // This agent's chat-brain tool: a full engine.chat turn (the agent reasons with
  // its own tools and replies). Named per-agent — chat_with_zenod, chat_with_archus
  // — so it reads sensibly on every agent and routes unambiguously over the mesh.
  server.registerTool(
    `chat_with_${agentName}`,
    {
      title: `Chat with ${agentName}`,
      description:
        "Send a message to this agent's chat, the same conversation it holds on the web and in WhatsApp, and return its reply. The agent answers with its own tools; for Zenod that is the user's memory vault. A conversationKey keeps a separate multi-turn conversation. Messaging channels can pass an idempotencyKey to run the turn as a background job, whose reply get_task_result returns; resending the same key returns the same job, not a second reply.",
      inputSchema: {
        message: z.string().min(1).describe("The message to send, in natural language"),
        surface: z.enum(["cli", "mcp", "whatsapp", "web", "drive"]).optional().describe("Surface label to run as. Defaults to mcp."),
        conversationKey: z.string().min(1).optional().describe("Stable key that keeps one multi-turn conversation separate from others"),
        testRunId: z.string().min(1).optional().describe("Caller-supplied id that groups related turns in the chat audit"),
        idempotencyKey: z.string().min(1).max(512).optional().describe("Stable message key from a messaging channel; when present, the turn runs as a background job and get_task_result returns its reply"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ message, surface, conversationKey, testRunId, idempotencyKey }) => {
      if (!recordChatTestRun) throw new Error("chat test audit store is not configured");
      if (idempotencyKey) {
        if (!taskJobs) {
          return {
            content: [{ type: "text", text: "Durable Zenod chat is unavailable on this instance." }],
            structuredContent: {
              error: { code: "durable_chat_unavailable", message: "Durable Zenod chat is unavailable on this instance." },
            },
            isError: true,
          };
        }
        const input: TaskJobInput = {
          text: message,
          source: surface ?? "mcp",
          ...(conversationKey ? { conversationKey } : {}),
        };
        return enqueuedResponse(taskJobs.enqueue("chat", input, idempotencyKey));
      }
      const result = await runSyntheticChat({
        request: { message, ...(surface ? { surface } : {}), ...(conversationKey ? { conversationKey } : {}), ...(testRunId ? { testRunId } : {}) },
        defaultSurface: "mcp",
        getEngine,
        recordAudit: recordChatTestRun,
        ...(chatInterceptor ? { interceptChat: chatInterceptor } : {}),
      });
      const text = result.status === "ok" ? result.text : `ERROR: ${result.error}`;
      const structuredContent =
        result.status === "ok"
          ? {
              ...result,
              evidence: [
                {
                  kind: "chat_audit",
                  id: result.correlationId,
                  correlationId: result.correlationId,
                  conversationId: result.conversationId,
                },
              ],
            }
          : {
              ...result,
              error: {
                code: "chat_failed",
                message: result.error ?? "Chat failed",
                currentState: {
                  correlationId: result.correlationId,
                  conversationId: result.conversationId,
                },
              },
            };
      return {
        content: [{ type: "text", text }],
        structuredContent,
        isError: result.status === "error",
      };
    },
  );

  if (readConversationTranscript) {
    server.registerTool(
      "get_recent_conversation_transcript",
      {
        title: "Get recent conversation transcript",
        description:
          "Deterministically read recent WhatsApp/phone conversation transcript from Zenod's channel audit store. Includes inbound/outbound lines, timestamps, message ids, status, media type, transcribed voice-note text, structured media evidence, media storage status, and linked storage receipts when available. Use messageId when the user names a specific WhatsApp message, voice note, or screenshot; that returns the matching row and linked replies/receipts. Use broader window/contact filters for requests like 'last two hours phone transcript' or 'what did I send by WhatsApp recently'. Empty transcript bodies or missing media receipts are explicit evidence gaps.",
        inputSchema: GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ windowMinutes, contactId, chatId, messageId, limit }) => {
        const query = transcriptQueryFromToolArgs({ windowMinutes, contactId, chatId, messageId, limit });
        const entries = readConversationTranscript(query);
        return {
          content: [{ type: "text", text: formatConversationTranscript(entries) }],
          structuredContent: { entries, count: entries.length, sinceMs: query.sinceMs, windowMinutes: query.windowMinutes },
        };
      },
    );
  }

  if (readSessionLog) {
    server.registerTool(
      "read_llm_timeline",
      {
        title: "Read LLM usage timeline",
        description:
          "Deterministically read the durable LLM-usage ledger (/data/usage.sqlite) as an operation-labelled, newest-first timeline of real (provider-billed) LLM calls — timestamp, operation, provider/model, token counts, and cost per call. This is the 'check the logs' primitive: it reads structured data that survives container recreate, unlike docker stdout which every deploy wipes. Use it to answer 'what ran / why was a reply slow / where did the tokens go' without host or SSH access. Empty results mean nothing ran in the window (or the filter excluded it), not that logging failed.",
        inputSchema: READ_LLM_TIMELINE_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ windowMinutes, operation, model, limit }) => {
        const query = sessionLogQueryFromToolArgs({ windowMinutes, operation, model, limit });
        const calls = readSessionLog(query);
        return {
          content: [{ type: "text", text: formatSessionLog(calls, query.windowMinutes) }],
          structuredContent: { calls, count: calls.length, sinceMs: query.sinceMs, windowMinutes: query.windowMinutes },
        };
      },
    );
  }

  if (readExecutionStatus) {
    if (runExistingIssue) {
      server.registerTool(
        "epaminon.run_existing_issue",
        {
          title: "Run existing issue",
          description:
            "Owner: Epaminon. Start execution for one exact existing work issue. Input must be a qualified target owner/repo#N; this does not resolve fuzzy references and does not answer status questions.",
          inputSchema: RUN_ISSUE_SHAPE,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        },
        async (input) => {
          const ticket = await runExistingIssue(input);
          return {
            content: [
              {
                type: "text",
                text: `Queued execution ${ticket.executionId} for ${ticket.target}: ${ticket.state}`,
              },
            ],
            structuredContent: { ticket },
          };
        },
      );
    }

    if (runEphemeralTask) {
      const runPublicTask = async (toolName: string, input: PublicEpaminonTaskInput) => {
        const ticket = await runEphemeralTask({
          objective: input.prompt,
          ...(input.instructions ? { instructions: input.instructions } : {}),
          ...(input.outputTarget ? { artifactPolicy: input.outputTarget, outputTarget: input.outputTarget } : {}),
          ...(input.effort ? { effort: input.effort } : {}),
          ...(input.repo ? { repo: input.repo } : {}),
          ...(input.path ? { path: input.path } : {}),
          ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
          ...(input.skills ? { skills: input.skills } : {}),
        });
        return publicExecutionResponse(toolName, ticket);
      };

      server.registerTool(
        "epaminon.run_task",
        {
          title: "Run task",
          description:
            "Owner: Epaminon. Public prompt-first durable task dispatch. Starts one execution from a prompt; a caller does not need to pre-create a GitHub issue. Accepts effort, repo/path, output target, MCP servers, skills, and instructions. Returns an executionId/ticket; poll execution_status or epaminon.execution_status for status, transcript, and evidence.",
          inputSchema: EPAMINON_RUN_TASK_SHAPE,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        },
        async (input) => runPublicTask("epaminon.run_task", input),
      );

      server.registerTool(
        "epaminon.dispatch_worker",
        {
          title: "Dispatch worker",
          description:
            "Owner: Epaminon. Alias for epaminon.run_task for clients that model Epaminon as a cloud worker dispatcher. Starts one durable prompt-first execution and returns an executionId/ticket readable through execution_status or epaminon.execution_status.",
          inputSchema: EPAMINON_RUN_TASK_SHAPE,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        },
        async (input) => runPublicTask("epaminon.dispatch_worker", input),
      );

      server.registerTool(
        "epaminon.run_ephemeral_task",
        {
          title: "Run one-off task",
          description:
            "Owner: Epaminon. Backward-compatible legacy name for direct prompt-first one-off execution. Prefer epaminon.run_task or epaminon.dispatch_worker. This starts a durable execution queue entry without requiring the caller to pre-create a GitHub issue; status is read through execution_status or epaminon.execution_status.",
          inputSchema: RUN_EPHEMERAL_TASK_SHAPE,
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        },
        async (input) => {
          const ticket = await runEphemeralTask(input);
          return {
            content: [{ type: "text", text: `Queued ephemeral execution ${ticket.executionId}: ${ticket.state}` }],
            structuredContent: { ticket },
          };
        },
      );
    }

    server.registerTool(
      "execution_status",
      {
        title: "Execution status",
        description:
          "Read this executor agent's live execution queue deterministically. Returns queued/running/blocked/needs-review/approved/done/failed tickets, notes, and evidence URLs. Does not use chat and does not start work.",
        inputSchema: EXECUTION_STATUS_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ message }) => {
        await beforeReadExecutionStatus?.();
        const tickets = readExecutionStatus();
        if (!tickets) {
          return {
            content: [{ type: "text", text: "This agent is not configured as an executor; no execution queue is available." }],
            structuredContent: { tickets: [], executor: false },
            isError: true,
          };
        }
        const filteredTickets = filterExecutionTickets(tickets, message);
        // #234 read-path honesty: an EMPTY result must not become "no work ran". Only
        // say "no executions exist" when the queue really is empty; if a filter emptied
        // a non-empty queue, say so explicitly rather than asserting nothing ran.
        const text =
          filteredTickets.length > 0
            ? formatExecutionStatus(filteredTickets)
            : tickets.length === 0
              ? "No execution tickets exist yet (none have ever been queued on this executor)."
              : `No execution tickets matched this query, but ${tickets.length} exist on the executor. Do NOT tell the user nothing ran — the filter excluded them; broaden the query or list all.`;
        return {
          content: [{ type: "text", text }],
          structuredContent: { tickets: filteredTickets, total: tickets.length, filtered: filteredTickets.length, executor: true },
        };
      },
    );

    server.registerTool(
      "epaminon.execution_status",
      {
        title: "Execution status",
        description:
          "Owner: Epaminon. Deterministic v4 read of the execution queue using explicit fields only. Does not use fuzzy message input and does not start work.",
        inputSchema: V4_EXECUTION_STATUS_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ workIssue, executionIssue, executionId, state, since, limit }) => {
        await beforeReadExecutionStatus?.();
        const tickets = readExecutionStatus();
        if (!tickets) {
          return toMcpToolResult(
            "epaminon.execution_status",
            toolResponse({
              evidence: [],
              errors: [{ code: "executor_not_configured", message: "This agent is not configured as an executor." }],
            }),
          );
        }
        return toMcpToolResult("epaminon.execution_status", v4ExecutionStatusResponse(tickets, { workIssue, executionIssue, executionId, state, since, limit }));
      },
    );
  }

  if (readBacklogIssues) {
    server.registerTool(
      "archus.get_issue",
      {
        title: "Get issue",
        description:
          "Owner: Archus. Deterministic v4 read of one exact GitHub issue by qualified target owner/repo#N. Returns issue evidence only on successful read; a missing exact issue is a tool error, not a fuzzy search.",
        inputSchema: V4_GET_ISSUE_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.get_issue", await readBacklogIssues.getIssue(input)),
    );

    server.registerTool(
      "archus.find_issue",
      {
        title: "Find issue",
        description:
          "Owner: Archus. Structured resolver for fuzzy issue references. Use when repo or number is unclear. Returns issue_resolved on a unique hit, candidates when ambiguous, or issue_not_found with searched scope.",
        inputSchema: V4_FIND_ISSUE_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.find_issue", await readBacklogIssues.findIssue(input)),
    );

    server.registerTool(
      "archus.list_issues",
      {
        title: "List issues",
        description:
          "Owner: Archus. Deterministic v4 issue inventory read using explicit filters. Empty results mean no issues matched the echoed filters, not that a fuzzy reference never existed.",
        inputSchema: V4_LIST_ISSUES_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.list_issues", await readBacklogIssues.listIssues(input)),
    );

    // S0-T1: deterministic life-backlog write tools. Repo is hard-wired (no repo
    // parameter exists), zero LLM sits in the path, and every write is read-back
    // verified before it is reported done. On failure they return FAILED + the
    // verbatim error and no success evidence (S0-T6 honesty).
    server.registerTool(
      "backlog_create",
      {
        title: "Create backlog issue",
        description:
          "Deterministic, LLM-free creation of one issue in the life backlog (the configured backlog repo — no other repo is reachable). Returns the qualified owner/repo#N only after a read-back GET confirms the issue exists.",
        inputSchema: BACKLOG_CREATE_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.backlog_create", await readBacklogIssues.createIssue(input)),
    );

    server.registerTool(
      "backlog_edit",
      {
        title: "Edit backlog issue",
        description:
          "Deterministic, LLM-free edit of one life-backlog issue by number (title/body/labels). Read-back verified. No repo parameter; only the configured backlog repo is reachable.",
        inputSchema: BACKLOG_EDIT_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.backlog_edit", await readBacklogIssues.editIssue(input)),
    );

    server.registerTool(
      "backlog_close",
      {
        title: "Close backlog issue",
        description:
          "Deterministic, LLM-free close of one life-backlog issue by number, with an optional closing comment. Reported closed only after a read-back GET confirms state=closed.",
        inputSchema: BACKLOG_CLOSE_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.backlog_close", await readBacklogIssues.closeIssue(input)),
    );

    server.registerTool(
      "backlog_comment",
      {
        title: "Comment on backlog issue",
        description:
          "Deterministic, LLM-free comment on one life-backlog issue by number. Reported done only after a read-back GET confirms the comment is present.",
        inputSchema: BACKLOG_COMMENT_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.backlog_comment", await readBacklogIssues.commentIssue(input)),
    );

    server.registerTool(
      "backlog_list",
      {
        title: "List backlog issues",
        description:
          "Deterministic, LLM-free inventory of the life backlog (the configured backlog repo). Filter by state/labels. No repo parameter.",
        inputSchema: BACKLOG_LIST_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input) => toMcpToolResult("archus.backlog_list", await readBacklogIssues.listBacklog(input)),
    );
  }

  const searchEntryPage = (engine: BrainEngine, input: EntrySearchInput): Promise<EntrySearchResult> =>
    searchMemoryEntryPage(engine, taskJobs, input);

  // Lineage is additive context (EPIC-9 E9-3a): it never changes ranking and never fails
  // a read. No tree, an engine without one, or any tree error → every memory is unplaced.
  const loadTree = async (engine: BrainEngine): Promise<MemoryTreeIndex | null> => {
    if (!engine.memoryTree) return null;
    try {
      return await engine.memoryTree();
    } catch (error) {
      console.warn(`[memory-tree] lineage unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const unplaced = { placement: "unplaced" as const, lineage: [], evidence: [], parent: null, children: [] };
  const lineageFields = async (tree: MemoryTreeIndex | null, path: string) => {
    const found = tree ? await tree.nodeView(path).catch(() => unplaced) : unplaced;
    return { placement: found.placement, lineage: found.lineage, evidenceRefs: found.evidence, parent: found.parent, children: found.children };
  };

  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description:
        "Search the user's memory vault and return matching notes and captured entries, each with its vault path, capture time, source and evidence reference. A query matches literal words in titles and text; filters narrow results by source, content type and capture date, and order sorts them by newest, oldest or relevance. Without a query, entries are listed by filters alone. Each entry's capturedAt is the original capture time; Log headings can show the later processing time. Entries are paginated: hasMore and nextCursor return the next page for the same query, filters and order, until the vault changes or the server restarts. Note hits are a separate ranked top 20 (hitLimit narrows it, e.g. to the top 5) that ignores entry filters; each note hit has its rank, a matchPercent from 1 to 100 (half how much of the query it contains, weighted by word rarity, half its strength relative to the best hit; relative to this query, not a probability), its vault url (GitHub or Google Drive) and appPath, the path that opens it in the Zenod app. Each result carries its place in the memory tree, and its evidence reference opens with get_memory.",
      inputSchema: SEARCH_MEMORY_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, source, sourceId, contentType, capturedAfter, capturedBefore, order, limit, cursor, hitLimit }) => {
      const started = performance.now();
      const engine = await getEngine();
      const timed = query ? engine.searchTimed ? await engine.searchTimed(query) : { hits: await engine.search(query), tier: "scan" as const, ms: null } : null;
      // E12-S3a: rank, matchPercent and appPath are additive; existing hit fields are unchanged.
      // E12-S3c: the chat's recent-note fields (relation, via, unlinked, unwritten) stay out of this tool's output.
      const rankedHits = rankHits((timed?.hits ?? []).slice(0, hitLimit ?? undefined).map(({ relation: _r, via: _v, unlinked: _u, unwritten: _w, ...hit }) => hit));
      const tree = rankedHits.length ? await loadTree(engine) : null;
      const hits = await Promise.all(rankedHits.map(async (hit) => {
        const { placement, lineage, evidenceRefs } = await lineageFields(tree, hit.path);
        return { ...hit, placement, lineage, evidenceRefs };
      }));
      const structuralQuery = Boolean(source || sourceId || contentType || capturedAfter || capturedBefore || cursor || order === "newest" || order === "oldest" || !query);
      let entries: ReturnType<typeof memoryEntrySummaries> = [];
      let pagination: Record<string, unknown> | null = null;
      if (structuralQuery) {
        const page = await searchEntryPage(engine, {
          ...(query ? { query } : {}), ...(source ? { source } : {}), ...(sourceId ? { sourceId } : {}),
          ...(contentType ? { contentType } : {}), ...(capturedAfter ? { capturedAfter } : {}),
          ...(capturedBefore ? { capturedBefore } : {}), order: order === "oldest" ? "oldest" : "newest", limit: limit ?? 20,
          ...(cursor ? { cursor } : {}),
        });
        entries = page.entries;
        pagination = { ...page.pagination, contract: "entries-v1", snapshotPolicy: "restart-on-change-or-process-restart",
          querySemantics: "all-whitespace-terms-as-case-insensitive-substrings-in-title-or-content", noteHitsScope: "independent-lexical-top-20" };
      }
      const output = { hits, entries, pagination };
      const noteText = hits.length === 0
        ? query ? `No note paths match '${query}'.` : ""
        // Tree lineage stays in structured output only (E9-5j, root L-6): the text is as before EPIC-9.
        : hits.map((hit) => `${hit.path} (score ${hit.score}, ${hit.matchPercent}% match) — ${hit.snippet}${hit.url ? `\n  ${hit.url}` : ""}\n  app: ${hit.appPath}`).join("\n");
      if (timed?.ms != null && rankedHits.length) {
        // E24-M7: `tool` is the whole call so far (vault sync, index, tree places, entries).
        console.info(`[memory-search] ${timed.tier === "index" ? "tier-0 index" : "scan"}, ${timed.ms} ms${"index" in timed && timed.index ? ` (${timed.index.rows} rows, ${(timed.index.bytes / 1_048_576).toFixed(1)} MB${timed.index.refreshMs != null ? `, refresh ${timed.index.refreshMs} ms` : ""})` : ""}, tool ${Math.round(performance.now() - started)} ms`);
      }
      const entryText = entries.length === 0
        ? structuralQuery ? "No memory entries match the structural filters." : ""
        : entries.map((entry) => [
            `${entry.capturedAt} · ${entry.source}/${entry.contentType ?? "unknown"} · ${entry.evidenceRef}`,
            entry.snippet,
            entry.url,
          ].filter(Boolean).join("\n  ")).join("\n");
      return {
        content: [
          {
            type: "text",
            text: [noteText, entryText, pagination ? `Entry coverage: ${pagination.matchedEntries} matches / ${pagination.scannedEntries} scanned; hasMore=${pagination.hasMore}. ${pagination.hasMore ? `Continue with nextCursor=${pagination.nextCursor} and the same query/filters/order.` : "End of matching entries in this local snapshot."} Note hits are independently ranked and do not obey entry filters.` : ""].filter(Boolean).join("\n\n"),
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
        "Read one memory: a vault note by its vault-relative path (for example Areas/Insurance.md), or one captured entry by the exact evidence reference that search_memory returns (for example Log/2026-08-01.md#^e-123abc). An evidence reference returns only that entry, with its source, content type, capture time and source URL, without neighboring entries from the same daily log. A path returns the note's text, frontmatter and place in the memory tree.",
      inputSchema: GET_MEMORY_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      const engine = await getEngine();
      if (path.includes("#^")) {
        const storedEntry = await engine.getEntry(path);
        const receipts = captureReceiptsFor(taskJobs, storedEntry.evidenceRef);
        const entry = mergeMemoryEntries([storedEntry], receipts.jobs, receipts.loadContent)
          .find((candidate) => candidate.evidenceRef === storedEntry.evidenceRef) ?? storedEntry;
        return {
          content: [{ type: "text", text: `${entry.evidenceRef}\nsource: ${entry.source}\ncontentType: ${entry.contentType ?? "unknown"}\ncapturedAt: ${entry.capturedAt}\n${entry.url ? `source URL: ${entry.url}\n` : ""}${entry.content}` }],
          structuredContent: { entry },
        };
      }
      const note = await engine.get(path);
      const tree = await loadTree(engine);
      const placement = await lineageFields(tree, note.path);
      return {
        content: [
          {
            type: "text",
            text: `# ${note.path}\nfrontmatter: ${JSON.stringify(note.frontmatter)}\n${note.url ? `source: ${note.url}\n` : ""}\n${note.body}`,
          },
        ],
        structuredContent: { ...note, ...placement },
      };
    },
  );

  server.registerTool(
    "memory_cloud",
    {
      title: "Memory cloud",
      description:
        "Follow the strong links in the user's memory. Each memory (a vault page or a captured entry) links to others with a strength from 0 to 1, set by how it was filed, cited, linked and placed in the memory tree. Starting from a question's best matching memories (query) or from one memory (path), this walks the links and multiplies their strengths along each path, keeping every memory whose path stays at or above the threshold (default 0.8): 1.0, then 0.9, then 0.95 gives 0.855, kept. Returns the memories strongest first, each with its node id, strength, hops, the path walked and its evidence reference for get_memory, plus the links between them. Suited to gathering what is closely tied to a topic without reading weakly related notes.",
      inputSchema: MEMORY_CLOUD_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, path, threshold, maxNodes }) => {
      const engine = await getEngine();
      if (!query && !path) {
        return { content: [{ type: "text", text: "Give a query or a path to start the cloud from." }], structuredContent: { code: "invalid_request", message: "query or path is required" }, isError: true };
      }
      const cloud = engine.memoryCloud
        ? await engine.memoryCloud({ ...(path ? { center: path } : { query: query! }), ...(threshold !== undefined ? { threshold } : {}), ...(maxNodes ? { maxNodes } : {}) })
          .catch((error: unknown) => { if (error instanceof Error && error.name === "NoteNotFoundError") return undefined; throw error; })
        : null;
      if (cloud === undefined) {
        return { content: [{ type: "text", text: `No memory at ${path}.` }], structuredContent: { code: "not_found", message: `No memory at ${path}.` }, isError: true };
      }
      if (cloud === null) {
        return { content: [{ type: "text", text: "The memory index is not available on this vault yet." }], structuredContent: { code: "unavailable", message: "no memory index" }, isError: true };
      }
      const text = cloud.nodes.length === 0
        ? `No memory is tied strongly enough (threshold ${cloud.threshold}).`
        : cloud.nodes.map((node) => `${Math.round(node.strength * 100)}% ${node.path} (${node.id}, ${node.hops} hop${node.hops === 1 ? "" : "s"}${node.via ? ` via ${node.via}` : ""}) — ${node.title}`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: { ...cloud } };
    },
  );

  server.registerTool(
    "store_memory",
    {
      title: "Store memory",
      description:
        "Save something the user wants remembered, such as a fact, decision, event or preference, to their vault. Zenod records the exact words as evidence in the dated Log, files the meaning onto the right page or pages with citations back to that evidence, and saves the change to the user's GitHub repository or Google Drive. Filing completes in every case: anything uncertain is noted in the vault for later review, not returned as a question. Runs in the background: the call returns a jobId at once, and get_task_result with that jobId returns the receipt (evidence reference, pages touched, saved revision, links and filing disposition) when the job is done.",
      inputSchema: STORE_MEMORY_SHAPE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ content, hints, verbatim, source, contentType, capturedAt, sourceId, idempotencyKey }) => {
      const input: TaskJobInput = {
        content,
        ...(hints ? { hints } : {}),
        ...(verbatim !== undefined ? { verbatim } : {}),
        ...(source ? { source } : {}),
        ...(contentType ? { contentType } : {}),
        ...(capturedAt ? { capturedAt } : {}),
        ...(sourceId ? { sourceId } : {}),
      };
      if (taskJobs) {
        const job = taskJobs.enqueue("store", input, idempotencyKey);
        return enqueuedResponse(job);
      }
      if (idempotencyKey) {
        return {
          content: [{ type: "text", text: "Idempotent store_memory requires the durable task-job queue." }],
          structuredContent: {
            code: "idempotency_unavailable",
            message: "This Zenod runtime cannot guarantee idempotency without its durable task-job queue.",
          },
          isError: true,
        };
      }
      // No queue wired (e.g. a minimal embedding) — run synchronously.
      const engine = await getEngine();
      const result = await engine.store({
        content,
        source: source ?? "mcp",
        ...(hints ? { hints } : {}),
        ...(verbatim !== undefined ? { verbatim } : {}),
        ...(contentType ? { contentType } : {}),
        ...(capturedAt ? { capturedAt } : {}),
        ...(sourceId ? { sourceId } : {}),
      });
      return { content: [{ type: "text", text: formatStoreResult(result) }], structuredContent: { ...result } };
    },
  );

  const hostedArchiveOnlyDrive = taskJobs?.hostedArchiveOnlyDrive === true;
  server.registerTool(
    "ingest_memory",
    {
      title: "Ingest memory artifact",
      description: hostedArchiveOnlyDrive
        ? "Queue a file or link for the user's memory: audio and voice notes, screenshots and images, PDFs and documents, or web links, given as a fetchable URL or a handle the caller has already staged. Zenod archives the original, transcribes or extracts its content, records that as evidence and files the meaning into the vault. Google Drive file references are not accepted on Zenod Hosted, where Drive is the archive. Runs in the background: the call returns a jobId at once, and get_task_result returns the receipt (archived original, transcript or extraction, evidence reference, pages touched, saved revision and links) or a structured error."
        : "Queue a file or link for the user's memory: audio and voice notes, screenshots and images, PDFs and documents, or web links, given as a fetchable URL, a Google Drive file ID or a handle the caller has already staged. Zenod archives the original, transcribes or extracts its content, records that as evidence and files the meaning into the vault. Runs in the background: the call returns a jobId at once, and get_task_result returns the receipt (archived original, transcript or extraction, evidence reference, pages touched, saved revision and links) or a structured error. A handle Zenod cannot resolve fails with media_ingest_processor_unavailable.",
      inputSchema: hostedArchiveOnlyDrive
        ? {
            ...INGEST_MEMORY_SHAPE,
            bytesRef: z.string().min(1).optional().describe(
              "Opaque reference to bytes already staged by the caller/transport, such as an object-store key or channel media handle. Hosted Drive file references are rejected.",
            ),
          }
        : INGEST_MEMORY_SHAPE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({
      contentType,
      mediaType,
      artifactUrl,
      bytesRef,
      filename,
      sourceHint,
      contentHint,
      providedTranscript,
      transcriptionProvider,
      audioDurationSeconds,
      transcriptionDisposition,
      senderTimestamp,
      hints,
      idempotencyKey,
    }) => {
      if (contentType && mediaType !== "audio") {
        return {
          content: [{ type: "text", text: "Audio contentType requires mediaType audio." }],
          structuredContent: { code: "invalid_input", message: "Audio contentType requires mediaType audio." },
          isError: true,
        };
      }
      if (!artifactUrl && !bytesRef) {
        return {
          content: [{ type: "text", text: "Invalid media ingest input: provide artifactUrl or bytesRef." }],
          structuredContent: {
            code: "invalid_input",
            message: "ingest_memory requires either artifactUrl or bytesRef.",
          },
          isError: true,
        };
      }
      const input: TaskJobInput = {
        mediaType,
        ...(contentType ? { contentType } : {}),
        ...(artifactUrl ? { artifactUrl } : {}),
        ...(bytesRef ? { bytesRef } : {}),
        ...(filename ? { filename } : {}),
        ...(sourceHint ? { sourceHint } : {}),
        ...(contentHint ? { contentHint } : {}),
        ...(providedTranscript !== undefined ? { providedTranscript } : {}),
        ...(transcriptionProvider ? { transcriptionProvider } : {}),
        ...(audioDurationSeconds !== undefined ? { audioDurationSeconds } : {}),
        ...(transcriptionDisposition ? { transcriptionDisposition } : {}),
        ...(senderTimestamp ? { senderTimestamp } : {}),
        ...(hints ? { mediaHints: hints } : {}),
      };
      const rejection = taskJobs?.admit?.("media_ingest", input);
      if (rejection) {
        return {
          content: [{ type: "text", text: rejection.message }],
          structuredContent: rejection,
          isError: true,
        };
      }
      if (taskJobs) {
        const job = taskJobs.enqueue("media_ingest", input, idempotencyKey);
        return enqueuedResponse(job);
      }
      const result: MediaIngestReceipt = {
        status: "error",
        code: "media_ingest_processor_unavailable",
        message: "Media ingest queue is not configured for this embedding; wire taskJobs and the #660-#662 processors before using ingest_memory.",
        mediaType,
        source: {
          ...(filename ? { filename } : {}),
          ...(sourceHint ? { sourceHint } : {}),
          ...(senderTimestamp ? { senderTimestamp } : {}),
          ...(contentHint ? { contentHint } : {}),
          ...(hints ? { hints } : {}),
        },
        rawArtifact: { handle: null, archiveUrl: null },
        extraction: {
          handle: null,
          transcriptHandle: mediaType === "audio" ? null : undefined,
          ocrHandle: mediaType === "screenshot" || mediaType === "image" ? null : undefined,
          provider: null,
        },
        digest: { evidenceRef: null, pagesTouched: [], revision: null, urls: [] },
        nextAdapterIssues: ["https://github.com/zenod-ai/zenod/issues/660", "https://github.com/zenod-ai/zenod/issues/661", "https://github.com/zenod-ai/zenod/issues/662"],
      };
      return { content: [{ type: "text", text: formatMediaIngestResult(result) }], structuredContent: { ...result }, isError: true };
    },
  );

  server.registerTool(
    "get_ingest_result",
    {
      title: "Get ingest result",
      description:
        "Check an audio ingest job from the Google Drive inbox by its jobId. Returns its progress while queued or running, then the receipt (archived original, transcript evidence, pages touched, commit and links) or a structured error.",
      inputSchema: GET_INGEST_RESULT_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ jobId }) => {
      const job = mediaIngest?.get(jobId) ?? null;
      if (!job) {
        return {
          content: [{ type: "text", text: `No ingest job found for id ${jobId}.` }],
          structuredContent: { found: false, jobId },
          isError: true,
        };
      }
      const receipt = ingestReceipt(job);
      return {
        content: [{ type: "text", text: formatIngestResult(job) }],
        structuredContent: { found: true, ...receipt, error: job.error },
        isError: job.status === "error",
      };
    },
  );

  server.registerTool(
    "ask_brain",
    {
      title: "Ask the brain",
      description:
        "Answer a free-form question from the user's memory, such as 'what do I know about X?' or 'when does my policy renew?'. Zenod reads across the vault with a read-only research loop and returns a written answer that cites the vault pages and source links it used. Suited to questions that span several notes; slower than search_memory because it runs a language model.",
      inputSchema: ASK_BRAIN_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ question, contextRefs }, extra) => {
      const engine = await getEngine();
      // E15-Q4: the answer stops when the caller hangs up (its own timeout) or at the host's time limit,
      // so no model call keeps running, and billing, for an answer nobody will read.
      const limitMs = askBrainTimeoutMs();
      const cancel = new AbortController();
      const timer = setTimeout(() => cancel.abort(new AnswerCancelledError("timeout")), limitMs);
      const hangUp = () => cancel.abort(new AnswerCancelledError("caller"));
      if (extra?.signal?.aborted) hangUp(); else extra?.signal?.addEventListener("abort", hangUp, { once: true });
      // EPIC-14 S29: the question's vague words read against the quick index; the answer says how.
      const readings = readAsFor ? shownReadings(await readAsFor(question).catch(() => [] as ReadAs[])) : [];
      const note = readAsNote(readings);
      let answer;
      try {
        answer = await engine.ask(note ? `${question}\n${note}` : question, { ...(contextRefs ? { contextRefs } : {}), entrySearch: input => searchEntryPage(engine, input), signal: cancel.signal });
      } catch (error) {
        // EPIC-24 M2: a timed-out or failed answer is counted for the health page (a caller hanging up is not).
        if (error instanceof AnswerCancelledError) {
          if (error.reason === "timeout") opsAlert("answer", "ask_brain_timeout", { secs: Math.round(limitMs / 1000) });
        } else if (!(error instanceof ContextRefError)) {
          opsAlert("answer", "ask_brain_error", { name: error instanceof Error ? error.name : "Error" });
        }
        if (error instanceof AnswerCancelledError) {
          const text = error.reason === "timeout"
            ? `No answer this time: I stopped after ${Math.round(limitMs / 1000)} seconds so the search would not keep running unseen. Try a narrower question, or search_memory to find the pages directly.`
            : "No answer: the request was cancelled before the answer was ready, so I stopped looking.";
          return { content: [{ type: "text", text }], structuredContent: { code: error.reason === "timeout" ? "ask_timeout" : "ask_cancelled", message: text }, isError: true };
        }
        if (!(error instanceof ContextRefError)) throw error;
        return {
          content: [{ type: "text", text: error.message }],
          structuredContent: {
            code: "context_ref_unavailable",
            message: error.message,
          },
          isError: true,
        };
      } finally {
        clearTimeout(timer);
        extra?.signal?.removeEventListener("abort", hangUp);
      }
      const answerContent = {
        type: "answer_content" as const,
        text: answer.text,
        sources: answer.sources,
        ...(answer.coverage ? { coverage: answer.coverage } : {}),
        ...(answer.lineage?.length ? { lineage: answer.lineage } : {}),
      };
      const sources = answerContent.sources.map((s) => `- ${s.path}${s.url ? ` (${s.url})` : ""}`).join("\n");
      const status = {
        type: "read_only_status" as const,
        text: "Read-only answer — no action was performed.",
      };
      const readAsText = readings.length ? `Read as: ${readAsLine(readings)}\n\n` : "";
      return {
        content: [{ type: "text", text: `${readAsText}${sources ? `${answerContent.text}\n\nSources:\n${sources}` : answerContent.text}\n\n${status.text}` }],
        structuredContent: { ...answerContent, status, ...(readings.length ? { readAs: readings } : {}) },
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
          "Check a background job started by another Zenod tool, such as store_memory or ingest_memory, by its jobId. Returns its status: queued or running while in progress; done with the job's result (for a save: the evidence reference, pages touched and saved revision; for an ingest: the media receipt or error); error with a message; or interrupted when a server restart stopped the job, in which case the original call can be sent again. Jobs run one at a time, so a queued job may wait behind earlier ones.",
        inputSchema: {
          ticket_id: z.string().min(1).optional().describe("The canonical ticket_id returned by an async tool"),
          jobId: z.string().min(1).optional().describe("Compatibility alias for ticket_id"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ ticket_id, jobId }) => {
        const requestedId = ticket_id ?? jobId;
        if (!requestedId) {
          return {
            content: [{ type: "text", text: "get_task_result requires ticket_id." }],
            structuredContent: {
              error: { code: "invalid_ticket", message: "get_task_result requires ticket_id." },
            },
            isError: true,
          };
        }
        const stored = taskJobs.get(requestedId);
        // Refused by the vault guard: recovery replays it, so report it as still queued (ZAL-A8).
        const job = stored && awaitingVaultRecovery(stored)
          ? { ...stored, status: "queued" as const, error: null }
          : stored;
        if (!job) {
          return {
            content: [{ type: "text", text: `No job found for id ${requestedId}.` }],
            structuredContent: {
              found: false,
              ticket_id: requestedId,
              jobId: requestedId,
              state: "error" as const,
              error: { code: "not_found", message: `No job found for id ${requestedId}.` },
            },
            isError: true,
          };
        }
        const resultText =
          job.status === "done" && job.result
              ? job.kind === "chat"
                ? (job.result as Reply).text
                : job.kind === "task"
                ? formatTaskingReply(job.result as TaskingReply)
                : job.kind === "store" || job.kind === "enrich_memory"
                  ? formatStoreResult(job.result as StoreResult)
                  : job.kind === "media_ingest"
                    ? formatMediaIngestResult(job.result as MediaIngestReceipt)
                    : formatWorkResult(job.result as WorkResult)
            : job.status === "error"
              ? `ERROR: ${job.error ?? "unknown error"}`
              : job.status === "interrupted"
                ? `INTERRUPTED: ${job.error ?? "a server restart killed this job"} — re-issue the original call.`
                : `Status: ${job.status}. Not finished yet — poll get_task_result again shortly.`;
        const failed = job.status === "error" || job.status === "interrupted";
        const state = failed ? "error" : job.status;
        return {
          content: [{ type: "text", text: resultText }],
          structuredContent: {
            found: true,
            ticket_id: job.id,
            jobId: job.id,
            kind: job.kind,
            ...(job.kind === "chat" ? { correlationId: job.id } : {}),
            status: job.status,
            state,
            result: job.result ?? null,
            ...(job.status === "done" ? { evidence: taskJobEvidence(job) } : {}),
            ...(failed
              ? {
                  error: {
                    code: job.status === "interrupted" ? "interrupted" : "job_failed",
                    message: job.error ?? `Job ${job.id} ${job.status}.`,
                  },
                }
              : {}),
          },
          isError: failed,
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
          .array(z.union([
            z.object({
              path: z.string().min(1),
              url: z.string().min(1),
              provider: z.enum(["github", "google_drive"]),
              revisionId: z.string().optional(),
              githubUrl: z.string().optional(),
            }),
            z.object({ path: z.string().min(1), githubUrl: z.string().min(1) }),
          ]))
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
        ...(sourceRefs ? { sourceRefs: sourceRefs.map((source) => "url" in source
          ? source
          : { path: source.path, url: source.githubUrl, provider: "github" as const, githubUrl: source.githubUrl }) } : {}),
        ...(write !== undefined ? { write } : {}),
      });
      const lines = [
        `Backlog candidates: ${result.candidates.length}`,
        ...result.candidates.map((candidate, index) => {
          const sources = candidate.source_refs.map((ref) => ref.path).join(", ");
          return `${index + 1}. [${candidate.priority}/${candidate.type}/${candidate.status}] ${candidate.title}${sources ? ` — ${sources}` : ""}`;
        }),
        ...(result.written.length > 0 ? ["", "Written:", ...result.written.map((item) => `- ${item.path}${item.url ? ` (${item.url})` : ""}`)] : []),
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
        if (githubCapability && !githubCapability()) return githubConnectionRequired("edit_github_issue");
        let result;
        try {
          result = await editGithubIssue(input);
        } catch (error) {
          if (!isGithubAuthorizationRevoked(error)) throw error;
          onGithubAuthorizationRevoked?.();
          return githubConnectionRequired("edit_github_issue");
        }
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
        if (githubCapability && !githubCapability()) return githubConnectionRequired("create_issue");
        let result;
        try {
          result = await createGithubIssue(input);
        } catch (error) {
          if (!isGithubAuthorizationRevoked(error)) throw error;
          onGithubAuthorizationRevoked?.();
          return githubConnectionRequired("create_issue");
        }
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
          "Queue one Google Drive file (by ID) for background memory ingest: it downloads the raw artifact, extracts text/visual facts for images and PDFs, transcribes audio with the configured provider, files the extraction/transcript into the vault as evidence + meaning, commits, and archives the original — in a background worker. Unsupported media and extraction failures become loud job errors. Returns immediately with the job id/status; it does not wait for completion. Queue one file per call.",
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
