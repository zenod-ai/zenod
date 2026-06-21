import { z } from "zod";

/**
 * Shared input schemas for the tools the Console's mesh gateway re-publishes.
 * Both the AGENT (which registers the tool with a local implementation) and the
 * CONSOLE gateway (which registers a straight-through proxy of the same tool)
 * import these, so the arguments an external client sees at the front door are
 * exactly what the owning agent accepts — no drift, no LLM in the path.
 */

export const SEARCH_MEMORY_SHAPE = {
  query: z.string().min(1).describe("Search terms, e.g. 'travel insurance'"),
};

export const GET_MEMORY_SHAPE = {
  path: z.string().min(1).describe("Vault-relative path, e.g. Areas/Insurance.md"),
};

export const ASK_BRAIN_SHAPE = {
  question: z.string().min(1).describe("The question, in natural language"),
};

export const STORE_MEMORY_SHAPE = {
  content: z.string().min(1).describe("The memory to store, as the user expressed it"),
  hints: z.array(z.string()).optional().describe("Optional filing hints, e.g. 'belongs to the housing project'"),
  verbatim: z.boolean().optional().describe("Force verbatim evidence recording (exact words preserved)"),
};

export const GET_TASK_RESULT_SHAPE = {
  jobId: z.string().min(1).describe("The jobId returned by an async tool such as store_memory"),
};

export const GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE = {
  windowMinutes: z.number().int().min(1).max(24 * 60).optional().describe("Lookback window in minutes. Defaults to 120."),
  contactId: z.string().optional().describe("Optional WhatsApp sender/contact id or phone number to filter."),
  chatId: z.string().optional().describe("Optional exact WhatsApp chat id to filter."),
  limit: z.number().int().min(1).max(500).optional().describe("Maximum transcript lines to return. Defaults to 100."),
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
