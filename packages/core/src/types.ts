/**
 * Core engine contract — see docs/M0-SPEC.md. The MCP endpoint, the CLI, and
 * (later) the WhatsApp gateway are all thin adapters over `BrainEngine`.
 */

import type { ChatToolEvent } from "./llm/types.js";

export type Surface = "cli" | "mcp" | "whatsapp" | "telegram" | "web" | "drive" | "selftest";
export type TaskingSurface = "whatsapp" | "telegram" | "web" | "mcp" | "selftest";

export interface StoreInput {
  /** The memory to store: a message, a fact, a capture. */
  content: string;
  /** Where this memory arrived from. */
  source: Surface;
  /** Optional caller hints, e.g. "this belongs to the property project". */
  hints?: string[];
  /** Force verbatim evidence recording (also auto-detected for quoted speech). */
  verbatim?: boolean;
  /** Files to attach; copied into _attachments/<area>/. */
  attachments?: AttachmentInput[];
}

export interface AttachmentInput {
  filename: string;
  data: Uint8Array;
}

export interface StoreResult {
  /** Citation anchor of the evidence entry, e.g. "Log/2026-06-11.md#^e-7f3a2c". */
  evidenceRef: string;
  /** Canonical URL for the exact immutable evidence entry, including its anchor. */
  evidenceUrl?: string;
  /** Vault-relative paths of meaning pages created or updated. */
  pagesTouched: string[];
  /** Canonical URLs for meaning pages, kept separate from the evidence-entry URL. */
  pageUrls?: string[];
  commitSha: string;
  /** Compatibility collection retained for existing consumers. */
  githubUrls: string[];
  /**
   * Present when classification confidence was below threshold: the store
   * landed as an Inbox stub and this is the question to relay to the user.
   */
  question?: string;
  /**
   * Present when the store path also ran the conservative backlog digester.
   * This is advisory: candidates are proposed unless explicitly written.
   */
  backlog?: BacklogDigestResult;
  /**
   * Set when the librarian pipeline was kicked off in the background (off the
   * hot reply line) rather than awaited. The evidenceRef/pagesTouched/commitSha
   * fields are placeholders in this case — the real filing completes later and
   * self-reports to the logs. Callers must not narrate the note as committed.
   */
  queued?: boolean;
}

export type TokenCostOperation = "classify" | "compose" | "ask" | "chat" | "tasking" | "work";

export interface TokenCostMeasurement {
  /** Operation about to call the LLM. Values are estimated before provider billing. */
  operation: TokenCostOperation;
  /** More specific stage, e.g. "proposal", "execute", "retry", or "store". */
  stage?: string;
  /** Approximate input tokens sent by Zenod-owned prompt/context. */
  estimatedInputTokens: number;
  /** Approximate tokens from vaultBriefing(), broken out because it was the main unbounded cost. */
  estimatedBriefingTokens: number;
  /** Raw character count for the bounded briefing text. */
  briefingChars: number;
  /** How much vault metadata the briefing included vs omitted. */
  briefingSections?: Record<string, { included: number; total: number; omitted: number }>;
}

export interface Answer {
  text: string;
  sources: SourceRef[];
}

export const EVIDENCE_CONTEXT_REF_PATTERN =
  "^Log/\\d{4}-\\d{2}-\\d{2}\\.md#\\^e-[0-9a-f]{6}$";

export interface AskOptions {
  /** Exact tenant-local evidence blocks to ground before general vault research. */
  contextRefs?: string[];
}

export class ContextRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextRefError";
  }
}

export interface Reply {
  text: string;
  sources: SourceRef[];
  /** Set when this turn also stored a memory. */
  stored?: StoreResult;
}

export type ChatTestStatus = "ok" | "error";

export interface ChatTestAuditInput {
  correlationId: string;
  testRunId?: string;
  surface: Surface;
  conversationKey: string;
  conversationId: string;
  prompt: string;
  reply?: string;
  sources: SourceRef[];
  toolEvents: ChatToolEvent[];
  status: ChatTestStatus;
  error?: string;
  at: Date;
}

export interface ChatTestAuditRecord extends ChatTestAuditInput {
  at: Date;
}

export interface TaskingInput {
  text: string;
  surface: TaskingSurface;
  conversationKey: string;
  /**
   * Raw source evidence for this turn, when the transport had to normalize the
   * user's input before tasking. Example: a WhatsApp voice note is transcribed
   * into `text` for the agent to act on, but any capture/store tool call must
   * file the exact transcript as verbatim evidence, not a model-written digest.
   */
  rawEvidence?: {
    content: string;
    hints?: string[];
  };
  /**
   * Structured context for the model only. The engine still stores `text` as the
   * user's message; this note is extra guidance derived by the transport/shell.
   */
  contextNote?: string;
  /**
   * True when `text` is derived from EMBEDDED material — an image's described contents,
   * a quoted/forwarded message — rather than the user's own directive. Embedded content
   * is CONTEXT, never user intent (soak finding #1 / C-26): the Console must not decompose
   * it into intake ask-buckets. The user's actual instruction, if any, is a caption handled
   * as ordinary directive text.
   */
  embeddedContext?: boolean;
}

export interface TaskingAction {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  /** This action came from a connected MCP peer, rather than a Ring-owned tool. */
  peerAction?: boolean;
  /**
   * The connected tool was classified as mutating. This records intent only: MCP
   * annotations are advisory classification metadata and never prove success.
   */
  mutationAttempt?: boolean;
  /**
   * The host validated concrete same-turn evidence in the mutating tool result.
   * This must never be set from a tool annotation alone.
   */
  verifiedMutationReceipt?: boolean;
  /** Host-owned rendering of the validated evidence; raw peer prose is never a receipt. */
  verifiedReceiptText?: string;
}

export interface TaskingReply {
  text: string;
  actions: TaskingAction[];
}

export interface ExternalTaskingTools {
  createIssue(input: { repo?: string; title: string; body: string; labels?: string[] }): Promise<string>;
  labelIssue(input: { repo?: string; issueNumber: number; labels: string[] }): Promise<string>;
  /**
   * Edit an existing GitHub issue in place — title, body, label add/remove/set,
   * a comment, and non-gated status. The queue/merge gates still hold: this can
   * never set status:queued or status:approved-merge (those go through
   * approveQueue/approveMerge), so the agent can revise tickets without
   * escalating execution on its own.
   */
  editIssue(input: {
    repo?: string;
    issueNumber: number;
    title?: string;
    body?: string;
    labelsAdd?: string[];
    labelsRemove?: string[];
    labelsSet?: string[];
    comment?: string;
    status?: string;
    state?: "open" | "closed";
    stateReason?: "completed" | "not_planned" | "reopened";
  }): Promise<string>;
  /**
   * Close a ticket by number — a dedicated, single-purpose CLOSE that always sets
   * GitHub's issue state to closed (so the model can't accidentally downgrade a
   * close to a comment/label). Optionally posts a closing comment.
   */
  closeIssue(input: { repo?: string; issueNumber: number; comment?: string; notPlanned?: boolean }): Promise<string>;
  /**
   * Queue a work ticket for execution (Archus, on explicit human approval to run):
   * mint a central `type:execution` ticket (`exec:queued`) linking the target work
   * ticket + carrying the run context, then dispatch it to Epaminon. Minting IS the
   * act of queuing. Returns the new execution ticket id + URL.
   */
  queueExecution(input: { target: string; title: string; context: string; repo?: string }): Promise<string>;
  /**
   * Approve a needs-review execution (Archus, on the human's go): flip the exec
   * ticket to `exec:approved` and dispatch `approve_execution` to Epaminon to ship
   * the outward outcome (merge/send). finalContent carries the human's edit, if any.
   */
  approveExecution(input: { executionId: number; finalContent?: string; repo?: string }): Promise<string>;
  queryBacklog(query?: string): Promise<string>;
  serviceBacklog(query?: string): Promise<string>;
  /**
   * Promote proposed issues to owner:agent + status:queued. The ONLY path
   * allowed to set queued — invoked solely on explicit human approval relayed
   * through chat (#58). createIssue/labelIssue stay gated and can never queue.
   */
  approveQueue(input: { repo?: string; issueNumbers: number[] }): Promise<string>;
  /**
   * Approve merge of the PR(s) produced for central tickets at
   * status:needs-review — flips them to status:approved-merge so the controller
   * (monitor) merges on green CI. The ONLY path allowed to set approved-merge;
   * invoked solely on explicit human approval relayed through chat. Zenod never
   * merges directly — it relays the trigger; the controller publishes.
   */
  approveMerge(input: { repo?: string; issueNumbers: number[] }): Promise<string>;
}

export interface SourceRef {
  /** Vault-relative path, optionally with a block anchor. */
  path: string;
  githubUrl: string;
}

export interface Hit {
  path: string;
  snippet: string;
  score: number;
  githubUrl: string;
}

export interface Note {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  githubUrl: string;
}

export interface LintError {
  path: string;
  line?: number;
  rule: string;
  message: string;
}

export interface LintReport {
  ok: boolean;
  errors: LintError[];
  checkedFiles: number;
}

export interface WorkInput {
  /** What to accomplish, e.g. "sweep the Inbox: file, archive, or delete each item". */
  objective: string;
  /**
   * The approved plan from a previous propose run. Absent → propose mode
   * (read-only survey, returns a plan, commits nothing). Present → execute
   * mode (write loop, validated, one commit).
   */
  plan?: string;
}

export interface WorkResult {
  mode: "proposal" | "executed" | "failed";
  /** Proposal: the plan to relay for approval. Executed: summary. Failed: why. */
  text: string;
  committed: boolean;
  commitSha?: string;
  changedPaths?: string[];
  githubUrls?: string[];
}

export type BacklogCandidateType = "action" | "question-action" | "blocker" | "roadmap" | "follow-up";
export type BacklogOwner = "agent" | "human" | "unknown";
export type BacklogPriority = "P0" | "P1" | "P2" | "unknown";
export type BacklogStatus = "proposed" | "ready" | "blocked" | "needs-clarification";
export type BacklogDifficulty = "low" | "medium" | "high" | "unknown";

export interface BacklogSourceRef {
  /** Vault-relative path, optionally with a block anchor. */
  path: string;
  githubUrl: string;
}

export interface BacklogCandidate {
  title: string;
  type: BacklogCandidateType;
  owner: BacklogOwner;
  priority: BacklogPriority;
  status: BacklogStatus;
  source_refs: BacklogSourceRef[];
  summary: string;
  context: string;
  acceptance_criteria: string[];
  dependencies: string[];
  open_questions: string[];
  difficulty: BacklogDifficulty;
  suggested_labels: string[];
  target_repo?: string;
}

export interface BacklogDigestInput {
  /** Vault-relative memory/log/meaning path to mine. */
  memoryPath?: string;
  /** Raw transcript or note text to mine directly. */
  rawText?: string;
  /** Search scope, e.g. "mine recent Zenod voice notes for launch backlog". */
  query?: string;
  /** Optional source refs to attach to rawText candidates. */
  sourceRefs?: BacklogSourceRef[];
  /** When true, write proposed backlog records to the vault backlog surface. */
  write?: boolean;
}

export interface BacklogDigestResult {
  candidates: BacklogCandidate[];
  written: Array<{ path: string; githubUrl: string; title: string }>;
  skipped: Array<{ title?: string; reason: string }>;
  source_refs: BacklogSourceRef[];
}

export interface BrainEngine {
  /** The librarian pipeline — the only write path. */
  store(input: StoreInput): Promise<StoreResult>;
  /** Describe an image via the vision model and return a plain-text description. */
  describeImage(imageData: Uint8Array, mimeType: string, prompt?: string): Promise<string>;
  /** Read-only agent loop: synthesized answer with citations. */
  ask(question: string, options?: AskOptions): Promise<Answer>;
  /**
   * Full conversational turn: ask + optional store, with conversation memory.
   * Pass onDelta to stream the answer text, onToolEvent to surface tool
   * start/end activity (the chat "calling a tool…" indicator). `conversationKey`
   * scopes history for surfaces with multiple independent users, such as
   * WhatsApp senders.
   */
  chat(
    message: string,
    surface: Surface,
    onDeltaOrOptions?: ((delta: string) => void) | ChatOptions,
    onToolEvent?: (event: ChatToolEvent) => void,
    conversationKey?: string,
  ): Promise<Reply>;
  /**
   * Shared tasking entrypoint for transport gateways. Gateways do only
   * transport work, then call this surface-agnostic loop with a correlation
   * key. The returned actions are the mutating/status tools invoked in the
   * loop, suitable for self-test/audit correlation.
   */
  handleTasking(input: TaskingInput): Promise<TaskingReply>;
  /** Librarian work loop: propose (no plan) then execute (approved plan) vault maintenance. */
  work(input: WorkInput): Promise<WorkResult>;
  /**
   * Mine memory, transcript text, or a scoped vault query for structured
   * backlog candidates. Writing is opt-in and materializes proposed records.
   */
  digestBacklog(input: BacklogDigestInput): Promise<BacklogDigestResult>;
  /** Deterministic two-pass search. No LLM. */
  search(query: string): Promise<Hit[]>;
  /** Deterministic note fetch. No LLM. */
  get(path: string): Promise<Note>;
  /** Deterministic vault validation. No LLM. */
  lint(): Promise<LintReport>;
}

export interface ChatOptions {
  onDelta?: (delta: string) => void;
  onToolEvent?: (event: ChatToolEvent) => void;
  conversationKey?: string;
  /** Host-owned, per-turn grounding shown to the model but never stored as the user's message. */
  contextNote?: string;
}

/**
 * Conversation state (and only that — the vault is the memory). SQLite-backed
 * in this repo; the interface exists so a hosted shell can swap in Postgres.
 */
export interface StateStore {
  appendMessage(conversationId: string, role: "user" | "assistant", text: string, surface: Surface): Promise<void>;
  /** Most recent window: last 20 messages or 48h, whichever is smaller. */
  recentWindow(conversationId: string): Promise<ConversationMessage[]>;
  /** Delete every message in a conversation. */
  clearConversation(conversationId: string): Promise<void>;
  /**
   * Search across every stored conversation, all channels. Matches messages
   * containing the query terms, grouped by conversation and ranked by relevance
   * then recency. This is how the agent recalls a past discussion that lives in
   * chat history (WhatsApp, web, …) rather than in the vault.
   */
  searchConversations(query: string, options?: ConversationSearchOptions): Promise<ConversationSearchHit[]>;
  /** Tenant-local durable standing-action state. Optional for custom ephemeral stores. */
  loadApprovalTokens?(conversationId: string): Promise<Array<{
    tool: string;
    draftHash: string;
    expiresAt: number;
    owner?: string;
    description?: string;
    args?: Record<string, unknown>;
    anyOutboundSend?: boolean;
  }>>;
  /** Atomically replace the live standing actions for one conversation. */
  saveApprovalTokens?(conversationId: string, tokens: Array<{
    tool: string;
    draftHash: string;
    expiresAt: number;
    owner?: string;
    description?: string;
    args?: Record<string, unknown>;
    anyOutboundSend?: boolean;
  }>): Promise<void>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  surface: Surface;
  at: Date;
}

export interface ConversationSearchOptions {
  /** Restrict to these channels; omitted or empty means search all of them. */
  surfaces?: Surface[];
  /** Max conversations to return (default 6, hard cap 20). */
  limit?: number;
}

export interface ConversationSearchHit {
  conversationId: string;
  surface: Surface;
  /** How many messages in this conversation matched the query. */
  matchCount: number;
  /** Timestamp of the most recent matching message. */
  lastAt: Date;
  /** The matching messages, oldest first, capped per conversation. */
  messages: ConversationMessage[];
}
