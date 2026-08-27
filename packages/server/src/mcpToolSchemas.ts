import { z } from "zod";
import { EVIDENCE_CONTEXT_REF_PATTERN } from "zenod/evidence-context";

/**
 * Shared input schemas for the tools the Console's mesh gateway re-publishes.
 * Both the AGENT (which registers the tool with a local implementation) and the
 * CONSOLE gateway (which registers a straight-through proxy of the same tool)
 * import these, so the arguments an external client sees at the front door are
 * exactly what the owning agent accepts — no drift, no LLM in the path.
 */

export const SEARCH_MEMORY_SHAPE = {
  query: z.string().min(1).optional().describe("Optional semantic search terms, e.g. 'travel insurance'."),
  source: z
    .enum(["cli", "mcp", "whatsapp", "telegram", "web", "drive", "selftest"])
    .optional()
    .describe("Optional structural source filter."),
  contentType: z
    .enum(["text", "voice_note", "audio", "image", "screenshot", "pdf", "document", "link"])
    .optional()
    .describe("Optional structural content-type filter."),
  capturedAfter: z.string().min(1).optional().describe("Optional inclusive ISO-8601 lower bound for the source capture time."),
  capturedBefore: z.string().min(1).optional().describe("Optional inclusive ISO-8601 upper bound for the source capture time."),
  order: z.enum(["newest", "oldest", "relevance"]).optional().describe("Ordering. Defaults to relevance for text queries and newest for structural entry queries."),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum results. Defaults to 20."),
};

export const GET_MEMORY_SHAPE = {
  path: z.string().min(1).describe("Vault-relative path, e.g. Areas/Insurance.md"),
};

export const ASK_BRAIN_SHAPE = {
  question: z.string().min(1).describe("The question, in natural language"),
  contextRefs: z
    .array(z.string().regex(new RegExp(EVIDENCE_CONTEXT_REF_PATTERN)))
    .min(1)
    .max(10)
    .optional()
    .describe("Exact tenant-local evidence refs to ground first, e.g. Log/2026-06-11.md#^e-7f3a2c"),
};

export const STORE_MEMORY_SHAPE = {
  content: z.string().min(1).describe("The memory to store, as the user expressed it"),
  hints: z.array(z.string()).optional().describe("Optional filing hints, e.g. 'belongs to the housing project'"),
  verbatim: z.boolean().optional().describe("Force verbatim evidence recording (exact words preserved)"),
  source: z
    .enum(["cli", "mcp", "whatsapp", "telegram", "web", "drive", "selftest"])
    .optional()
    .describe("Structural origin of the memory. Defaults to mcp when the caller does not know it."),
  contentType: z
    .enum(["text", "voice_note", "audio", "image", "screenshot", "pdf", "document", "link"])
    .optional()
    .describe("Structural content type, independent of the memory's subject."),
  capturedAt: z.string().min(1).optional().describe("Original source timestamp in ISO-8601 form."),
  sourceId: z.string().trim().min(1).max(512).optional().describe("Stable source/provider entry identifier."),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe("Optional caller-stable key. Retries return the original durable job and receipt."),
};

export const INGEST_MEMORY_SHAPE = {
  mediaType: z
    .enum(["audio", "screenshot", "image", "pdf", "document", "link"])
    .describe("Artifact class. Z-10 v0 requires audio and screenshot/image; pdf/document/link are reserved by the same contract."),
  artifactUrl: z.string().url().optional().describe("Fetchable URL for the raw artifact. The URL is treated as evidence, not as memory text."),
  bytesRef: z
    .string()
    .min(1)
    .optional()
    .describe("Opaque reference to bytes already staged by the caller/transport, e.g. a Drive id, object-store key, or Ring media handle."),
  filename: z.string().min(1).optional().describe("Original filename, if known."),
  sourceHint: z.string().min(1).optional().describe("Where this came from, e.g. 'Claude upload', 'WhatsApp', 'Ring', or 'Drive'."),
  contentHint: z.string().min(1).optional().describe("User-provided context for filing/digesting, e.g. 'remember the renewal date shown here'."),
  providedTranscript: z
    .string()
    .optional()
    .describe("Optional transcript already produced by the authenticated channel transport. Empty when transcription was intentionally skipped."),
  transcriptionProvider: z
    .string()
    .min(1)
    .optional()
    .describe("Provider label for an authenticated channel-supplied transcript."),
  audioDurationSeconds: z
    .number()
    .nonnegative()
    .nullable()
    .optional()
    .describe("Best-effort probed audio duration supplied by the channel transport."),
  transcriptionDisposition: z
    .enum(["provided", "skip_duration_limit", "skip_unavailable"])
    .optional()
    .describe("Whether to use the supplied transcript or archive audio without another transcription attempt."),
  senderTimestamp: z.string().min(1).optional().describe("Original sender/source timestamp, preferably ISO-8601."),
  hints: z.array(z.string().min(1)).optional().describe("Optional filing hints for the eventual memory digest."),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe("Optional caller-stable key. Retries return the original durable media job and receipt."),
};

export const GET_TASK_RESULT_SHAPE = {
  jobId: z.string().min(1).describe("The jobId returned by an async tool such as store_memory"),
};

export const GET_INGEST_RESULT_SHAPE = {
  jobId: z.string().min(1).describe("The jobId returned by ingest_memory"),
};

export const GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE = {
  windowMinutes: z.number().int().min(1).max(24 * 60).optional().describe("Lookback window in minutes. Defaults to 120."),
  contactId: z.string().optional().describe("Optional WhatsApp sender/contact id or phone number to filter."),
  chatId: z.string().optional().describe("Optional exact WhatsApp chat id to filter."),
  messageId: z
    .string()
    .optional()
    .describe("Optional exact WhatsApp message id. Use this when the user names a specific message or voice note; returns the matching row and linked replies/receipts."),
  limit: z.number().int().min(1).max(500).optional().describe("Maximum transcript lines to return. Defaults to 100."),
};

export const FETCH_EXECUTION_DELIVERABLE_SHAPE = {
  reference: z
    .string()
    .min(1)
    .describe(
      "Which execution's deliverable to fetch: an executionId (e.g. 'direct-…'), a fully-qualified work ticket 'owner/repo#N', or a message containing one. Returns the live file body at the run's head commit (works for unmerged/draft PRs) plus the honest merge state.",
    ),
};

export const READ_LLM_TIMELINE_SHAPE = {
  windowMinutes: z.number().int().min(1).max(7 * 24 * 60).optional().describe("Lookback window in minutes. Defaults to 120."),
  operation: z.string().optional().describe("Optional case-insensitive substring filter on the operation label, e.g. 'compose', 'classify', 'ask'."),
  model: z.string().optional().describe("Optional case-insensitive substring filter on the model id, e.g. 'opus', 'gpt-5'."),
  limit: z.number().int().min(1).max(2000).optional().describe("Maximum calls to return (newest first). Defaults to 200."),
};

export const CHAT_WITH_CONSOLE_SHAPE = {
  message: z.string().min(1).describe("Natural-language prompt to send through the Console chat/tasking path."),
  surface: z
    .enum(["whatsapp", "telegram", "web", "mcp", "selftest"])
    .optional()
    .describe("Surface to run as. Defaults to whatsapp so callers can reproduce the phone-native path."),
  conversationKey: z.string().min(1).optional().describe("Stable conversation key for multi-turn chat sessions. Defaults to a generated correlation id."),
};

export const EXECUTION_STATUS_SHAPE = {
  message: z.string().optional().describe("Optional natural-language filter, e.g. an execution id or owner/repo#N target."),
};

export const V4_EXECUTION_STATUS_SHAPE = {
  workIssue: z.string().min(1).optional().describe("Exact work issue target, e.g. owner/repo#123."),
  executionIssue: z.string().min(1).optional().describe("Exact execution issue target, when known."),
  executionId: z.string().min(1).optional().describe("Exact execution id minted by Archus/Epaminon."),
  state: z
    .enum(["queued", "running", "needs_review", "blocked", "done", "failed"])
    .optional()
    .describe("Optional canonical v4 execution state filter."),
  since: z.string().min(1).optional().describe("Optional ISO timestamp; only executions updated at or after this time are returned."),
  limit: z.number().int().positive().max(100).optional().describe("Maximum executions to return. Defaults to 20."),
};

export const V4_GET_ISSUE_SHAPE = {
  target: z.string().min(1).describe("Exact issue target as owner/repo#123."),
};

export const V4_FIND_ISSUE_SHAPE = {
  reference: z.string().min(1).describe("Fuzzy or partial issue reference, e.g. '#108', 'that runner ticket', or title text."),
  repos: z.array(z.string().min(1)).optional().describe("Repos to search, as owner/repo. Defaults to the configured backlog repo."),
  recentWindow: z.string().min(1).optional().describe("Optional human-readable window echoed in issue_not_found evidence, e.g. '48h'."),
  labels: z.array(z.string().min(1)).optional().describe("Optional labels that returned issues must include."),
  limit: z.number().int().positive().max(25).optional().describe("Maximum candidates to return. Defaults to 10."),
};

export const V4_LIST_ISSUES_SHAPE = {
  repo: z.string().min(1).optional().describe("Repo to list, as owner/repo. Defaults to the configured backlog repo."),
  state: z.enum(["open", "closed", "all"]).optional().describe("GitHub issue state. Defaults to open."),
  labels: z.array(z.string().min(1)).optional().describe("Labels that returned issues must include."),
  createdSince: z.string().min(1).optional().describe("Optional ISO timestamp; only issues created at or after this time are returned."),
  updatedSince: z.string().min(1).optional().describe("Optional ISO timestamp; only issues updated at or after this time are returned."),
  limit: z.number().int().positive().max(100).optional().describe("Maximum issues to return. Defaults to 20."),
};

// --- S0-T1: deterministic life-backlog write tools -------------------------
// These target the ONE configured life-backlog repo (AlfaBlok/obsidian-brain).
// There is deliberately NO repo parameter on any of them: the destination is a
// hard-wired constant, so a caller can never redirect a write to another repo
// (the 2026-07-02 'AlfaBlok/backlog' hallucination becomes structurally
// impossible). Zero LLM sits in the path; every write is read-back verified.
export const BACKLOG_CREATE_SHAPE = {
  title: z.string().min(1).describe("Issue title."),
  body: z.string().optional().describe("Issue body (Markdown)."),
  labels: z.array(z.string().min(1)).optional().describe("Labels to apply verbatim. No status label is forced."),
};

export const BACKLOG_EDIT_SHAPE = {
  number: z.number().int().positive().describe("Issue number in the life backlog to edit."),
  title: z.string().min(1).optional().describe("New title, if changing."),
  body: z.string().optional().describe("New body (Markdown), if changing."),
  addLabels: z.array(z.string().min(1)).optional().describe("Labels to add."),
  removeLabels: z.array(z.string().min(1)).optional().describe("Labels to remove."),
};

export const BACKLOG_CLOSE_SHAPE = {
  number: z.number().int().positive().describe("Issue number in the life backlog to close."),
  comment: z.string().min(1).optional().describe("Optional closing comment posted before the state change."),
  reason: z.enum(["completed", "not_planned"]).optional().describe("Close reason. Defaults to completed."),
};

export const BACKLOG_COMMENT_SHAPE = {
  number: z.number().int().positive().describe("Issue number in the life backlog to comment on."),
  body: z.string().min(1).describe("Comment body (Markdown)."),
};

export const BACKLOG_LIST_SHAPE = {
  state: z.enum(["open", "closed", "all"]).optional().describe("GitHub issue state. Defaults to open."),
  labels: z.array(z.string().min(1)).optional().describe("Labels that returned issues must include."),
  limit: z.number().int().positive().max(100).optional().describe("Maximum issues to return. Defaults to 20."),
};

export const REQUEST_BACKLOG_ACTION_SHAPE = {
  message: z
    .string()
    .min(1)
    .describe("Natural-language backlog action request. Archus decides create/update/comment/close, repo placement, labels, and structure."),
};

export const RUN_ISSUE_SHAPE = {
  target: z
    .string()
    .regex(/^[^#\s]+\/[^#\s]+#\d+$/)
    .describe("Exact work issue to run, as owner/repo#123. Do not pass a fuzzy reference."),
  instructions: z.string().min(1).optional().describe("Optional user instructions to include in Archus's execution request."),
  repo: z.string().min(1).optional().describe("Optional central backlog repo where Archus should mint the execution ticket, as owner/repo."),
  effort: z
    .enum(["low", "medium", "high", "max"])
    .optional()
    .describe("Optional worker effort/depth hint. Defaults are owned by the Epaminon runtime."),
  notifyOnStart: z
    .boolean()
    .optional()
    .describe("Set false only when the user explicitly asks not to be notified until terminal/blocked execution state."),
};

export const RUN_EPHEMERAL_TASK_SHAPE = {
  objective: z.string().min(1).describe("The one-off task objective. This does not create a GitHub issue by default."),
  instructions: z.string().min(1).optional().describe("Optional constraints, context, or success criteria for the ephemeral run."),
  effort: z
    .enum(["low", "medium", "high", "max"])
    .optional()
    .describe("Optional worker effort/depth hint. Defaults are owned by the Epaminon runtime."),
  repo: z
    .string()
    .min(1)
    .optional()
    .describe("Target GitHub repo as owner/repo when the task works a known codebase. Resolve the user's informal project name to this BEFORE calling; pass it so the worker clones the right repo instead of guessing."),
  path: z.string().min(1).optional().describe("Sub-path within the repo where the relevant code lives, if known (e.g. 'app/telegram-bot')."),
  outputTarget: z
    .string()
    .min(1)
    .optional()
    .describe("Optional requested durable output target, e.g. 'write docs/research.md', 'open one PR', or 'return summary only'."),
  artifactPolicy: z
    .string()
    .min(1)
    .optional()
    .describe("Optional guidance for where durable output should land, e.g. 'return summary only' or 'create follow-up issues only if needed'."),
  mcpServers: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional MCP servers/connectors to prewire for the worker, by name or connection hint."),
  skills: z.array(z.string().min(1)).optional().describe("Optional Codex/Claude skills or playbooks the worker should load."),
};

export const EPAMINON_RUN_TASK_SHAPE = {
  prompt: z.string().min(1).describe("The task prompt/objective to run. No pre-created GitHub issue is required."),
  effort: z
    .enum(["low", "medium", "high", "max"])
    .optional()
    .describe("Optional worker effort/depth hint. Defaults are owned by the Epaminon runtime."),
  repo: z.string().min(1).optional().describe("Optional target GitHub repo as owner/repo when the task works a known codebase."),
  path: z.string().min(1).optional().describe("Optional sub-path within the repo where the worker should focus."),
  outputTarget: z
    .string()
    .min(1)
    .optional()
    .describe("Optional requested durable output target, e.g. 'write docs/research.md', 'open one PR', or 'return summary only'."),
  mcpServers: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional MCP servers/connectors to prewire for the worker, by name or connection hint."),
  skills: z.array(z.string().min(1)).optional().describe("Optional Codex/Claude skills or playbooks the worker should load."),
  instructions: z.string().min(1).optional().describe("Optional constraints, context, success criteria, or handoff instructions."),
};

export const CREATE_ISSUE_SHAPE = {
  repo: z.string().min(1).optional().describe("owner/repo. Defaults to the agent's configured backlog/vault repo."),
  title: z.string().min(1).describe("Issue title."),
  body: z.string().optional().describe("Issue body (Markdown). For a runnable ticket, include objective, scope, and a done-condition."),
  labels: z.array(z.string().min(1)).optional().describe("Labels to apply. Gated status labels are normalized; the ticket always starts at status:proposed."),
};

export const EDIT_GITHUB_ISSUE_SHAPE = {
  repo: z.string().min(1).optional().describe("owner/repo. Defaults to the agent's configured backlog/vault repo."),
  issueNumber: z.number().int().positive().describe("GitHub issue number to edit."),
  title: z.string().min(1).optional().describe("New issue title."),
  body: z.string().optional().describe("New issue body."),
  labelsAdd: z.array(z.string().min(1)).optional().describe("Labels to add. Gated status labels are normalized to status:proposed."),
  labelsRemove: z.array(z.string().min(1)).optional().describe("Labels to remove if present."),
  labelsSet: z.array(z.string().min(1)).optional().describe("Replace all issue labels with this set. Gated status labels are normalized to status:proposed."),
  comment: z.string().min(1).optional().describe("Comment body to post on the issue."),
  assignees: z.array(z.string().min(1)).optional().describe("Replace assignees with these GitHub logins. Empty array clears assignees."),
  status: z
    .string()
    .min(1)
    .optional()
    .describe("Lifecycle status label, with or without 'status:' prefix, e.g. proposed, blocked, needs-review, queued."),
  queueApproval: z
    .boolean()
    .optional()
    .describe("Set true only after the user explicitly approved queueing this exact numbered issue."),
};
