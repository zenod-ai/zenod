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
