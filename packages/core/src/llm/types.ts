import type { NoteReadOptions } from "../ops/passage.js";
import type { PageIndexEntry } from "../vault/pages.js";
import type { BacklogCandidate, BacklogDigestInput, BacklogDigestResult, BacklogSourceRef, LintError, StoreResult } from "../types.js";
import type { TrustedConnectionProfile } from "../taskingPolicy.js";
import type { TurnPlanCompilation, TurnPlanCompileInput } from "./turnPlan.js";

/**
 * The LLM seam. The engine talks to this interface only, so every pipeline
 * is testable with a fake — no API key needed below this line.
 */
export interface BrainLlm {
  /** One haiku-class pass: which meaning pages does this memory touch? */
  classify(input: ClassifyInput): Promise<Classification>;
  /** Compose the full new content of one meaning page, integrating the evidence. */
  composePage(input: ComposePageInput): Promise<string>;
  /**
   * Describe an image using the vision model. Returns a plain-text description
   * that can be stored as a memory or used as engine input.
   */
  describeImage(imageData: Uint8Array, mimeType: string, prompt?: string): Promise<string>;
  /**
   * Agent loop over the vault; returns the synthesized answer. Read-only,
   * unless taskTools is given (chat surface) — then the loop may also
   * propose and, after explicit user approval, execute vault work. With
   * driveTools the loop can also list and ingest files from the user's
   * connected Google Drive.
   */
  answer(
    input: AnswerInput,
    tools: VaultReadTools,
    taskTools?: VaultTaskTools,
    driveTools?: DriveSourceTools,
    peerTools?: PeerTools,
  ): Promise<AnswerResult>;
  /**
   * Librarian work loop. Without writeTools it surveys and returns a plan
   * (propose mode); with writeTools it executes against the working tree
   * (execute mode). The engine validates and commits — never this loop.
   */
  work(input: WorkLoopInput, tools: VaultReadTools, writeTools?: VaultWriteTools): Promise<WorkLoopResult>;
  /** Mine provided evidence/context for structured backlog candidates. */
  extractBacklog(input: BacklogExtractInput): Promise<BacklogExtractResult>;
}

/**
 * Separate seam until RIV-2/3 reshape the current answer loop around it.
 * Consumers must use this as the structured output of that one Ring reasoning
 * call, not insert it as a second preflight call before `answer`.
 */
export interface TurnPlanCompiler {
  compileTurnPlan(input: TurnPlanCompileInput): Promise<TurnPlanCompilation>;
}

export interface ClassifyInput {
  content: string;
  hints: string[];
  pageIndex: PageIndexEntry[];
  tagVocabulary: string[];
}

export interface ClassificationPage {
  /** Vault-relative path, e.g. "Areas/Insurance.md". */
  path: string;
  action: "create" | "update";
  title: string;
}

export interface Classification {
  /** Spend gate: only explicit semantic integration is allowed to invoke the full-page composer. */
  disposition?: "evidence_only" | "append_compact_note" | "integrate_page" | "needs_clarification";
  confidence: number;
  /** One line for the commit message: `memory: <summary>`. */
  summary: string;
  tags: string[];
  pages: ClassificationPage[];
  /** Concrete question for the user when confidence is low. */
  question?: string;
}

export interface ComposePageInput {
  path: string;
  /** Current page content, or null when creating from template. */
  currentContent: string | null;
  template: string;
  evidenceEntry: string;
  /** Citation token to embed, e.g. "[[2026-06-11#^e-7f3a2c]]". */
  citation: string;
  classification: Classification;
  tagVocabulary: string[];
  today: string;
  /** The exact `type` value required for this page's folder (project|area|note). */
  requiredType: string;
  /** Ready-to-use wikilinks to existing pages/indexes — the page must include ≥1 (no orphans). */
  linkHints: string[];
  /** Lint errors from the previous attempt, for validate-with-retry. */
  previousErrors?: LintError[];
}

/**
 * A tool the agent loop invoked, surfaced to the UI so a long-running step
 * (a Drive ingest, a vault reorganization) shows as live activity instead of
 * a frozen screen. `label` is human-facing ("Ingesting a Drive file"); `tool`
 * is the raw name for keys/debugging.
 */
export interface ChatToolEvent {
  phase: "start" | "end" | "error";
  tool: string;
  label: string;
}

export interface AnswerInput {
  question: string;
  /** Host-owned transient instruction for a bounded recovery attempt; never part of user content or tool arguments. */
  hostInstruction?: string;
  /**
   * Stable id for the conversation this question belongs to (engine.ts's
   * conversationId(surface, key)). Scopes the exact standing-approval token;
   * without it, elevated-risk connected operations remain blocked.
   */
  conversationId?: string;
  /** AGENTS.md + folder index context for the system prompt. */
  vaultBriefing: string;
  /** Prior conversation turns (chat mode); empty for one-shot ask. */
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  /**
   * Host-owned typed terminal capture records for this exact conversation,
   * newest first. These are authority-bearing context, never assistant prose.
   */
  captureContext?: import("../types.js").ConversationCaptureContext[];
  /**
   * If set, the loop streams the answer: each text chunk is delivered as it
   * arrives. The full text is still returned in AnswerResult when the loop ends.
   */
  onTextDelta?: (delta: string) => void;
  /**
   * If set, tool start/end events are delivered as the loop calls tools — the
   * basis for the "calling a tool…" indicator in the chat UI.
   */
  onToolEvent?: (event: ChatToolEvent) => void;
  /**
   * If set, every peer-tool invocation (and its raw result string) is delivered
   * here. Engine uses this to capture peer tool results into the actions array
   * so the UUID returned by z2's async tools can be extracted for job polling.
   */
  onPeerAction?: (
    tool: string,
    input: Record<string, unknown>,
    result: string,
    metadata?: {
      peerAction?: boolean;
      mutationAttempt?: boolean;
      verifiedMutationReceipt?: boolean;
      verifiedReceiptText?: string;
    },
  ) => void;
  /**
   * FP4 · #548 ledger completeness — every READ tool invocation (vault/conversation
   * search, read_note, list_pages, search_chats) is delivered here so the engine records
   * it in the actions array reconcile receives. Without this, a read-only turn (e.g. a
   * search_chats-only recap) reached reconcile with EMPTY actions and its ungrounded
   * correction gate mistook the turn for a pure prose hallucination.
   */
  onReadAction?: (tool: string, input: Record<string, unknown>, result: string) => void;
}

/**
 * Read-only tool callbacks the agent loop may invoke. The vault tools are
 * OPTIONAL: a vaultless agent (the Console shell) omits them so the loop never
 * advertises a tool it can't run. searchChats is state-backed and always present.
 */
export interface VaultReadTools {
  searchVault?(query: string): Promise<string>;
  readNote?(path: string, options?: NoteReadOptions): Promise<string>;
  listPages?(): Promise<string>;
  /** Search the user's past conversations across every channel (WhatsApp, web, …). */
  searchChats(query: string): Promise<string>;
}

/**
 * One peer-agent delegation tool: the loop calls it with a free-form input and
 * gets back the peer's answer. Wired by the server from configured peers (the
 * mesh) — e.g. `ask_zenod` on the Console delegates a memory question to Zenod's
 * MCP. To the loop it is just another tool.
 */
export interface PeerTool {
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  /** Discovered MCP schemas are already JSON Schema, not Zod schemas. */
  schemaFormat?: "json-schema";
  /** MCP behavior hints retained from the owner's tools/list response. */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
  /**
   * This wallet peer tool is classified as mutating. The host still validates its
   * returned evidence after execution; this flag alone never proves success.
   */
  verifiedMutationReceipt?: boolean;
  /** The tool was discovered from a tenant-connected MCP wallet entry. */
  connectedMcp?: boolean;
  /** Host-owned risk limits for the exact tenant connection that exposed this tool. */
  trustedProfile?: TrustedConnectionProfile;
  /**
   * Tool results contain tenant-supplied advisory material. The model may use
   * that material as domain guidance, but it never changes instruction priority
   * or bypasses mutation/approval guards enforced by the host.
   */
  advisoryContent?: boolean;
  /** Host-owned read output that must not be paraphrased by the model. */
  authoritativeReadResult?: boolean;
  /** Host-owned MCP catalog inspection, available only for explicit catalog intent. */
  requiresMcpCatalogIntent?: boolean;
  /** Host-owned repository boundary for this connection's direct mutations. */
  authorityRepo?: string;
  /** Connection identity used only to scope exact standing approvals. */
  owner?: string;
  run(input: string | Record<string, unknown>): Promise<string>;
}
export type PeerTools = Record<string, PeerTool>;

/**
 * Mutating tool callbacks for the work loop. All operate on the local
 * working tree only; the engine commits. Implementations must reject paths
 * that escape the vault or touch the immutable evidence tier.
 */
export interface VaultWriteTools {
  /** Every file in the vault (markdown and attachments), one per line. */
  listFiles(): Promise<string>;
  writeNote(path: string, content: string): Promise<string>;
  moveNote(from: string, to: string): Promise<string>;
  deleteNote(path: string): Promise<string>;
}

export interface WorkLoopInput {
  objective: string;
  vaultBriefing: string;
  /** The approved plan, in execute mode. */
  plan?: string;
  /** Validation errors from the previous execute attempt (validate-with-retry). */
  previousErrors?: LintError[];
}

export interface WorkLoopResult {
  /** Propose mode: the plan. Execute mode: one-line summary first (commit message), then details. */
  text: string;
}

export interface BacklogExtractInput {
  content: string;
  sourceRefs: BacklogSourceRef[];
}

export interface BacklogExtractResult {
  candidates: BacklogCandidate[];
}

/**
 * Vault-work callbacks for the chat loop — thin wrappers over engine.work().
 * proposeTask returns the plan to relay; executeTask must only be called with
 * a plan the user explicitly approved in the conversation.
 */
export interface VaultTaskTools {
  /** Project GitHub issue/backlog/execution tools are projected only when explicitly connected. */
  githubAvailable: boolean;
  captureNote(content: string, hints?: string[]): Promise<StoreResult>;
  proposeTask(objective: string): Promise<string>;
  executeTask(objective: string, plan: string): Promise<string>;
  digestBacklog(input: BacklogDigestInput): Promise<BacklogDigestResult>;
  createIssue(input: { repo: string; title: string; body: string; labels?: string[] }): Promise<string>;
  labelIssue(input: { repo: string; issueNumber: number; labels: string[] }): Promise<string>;
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
  closeIssue(input: { repo?: string; issueNumber: number; comment?: string; notPlanned?: boolean }): Promise<string>;
  queueExecution(input: { target: string; title: string; context: string; repo?: string }): Promise<string>;
  approveExecution(input: { executionId: number; finalContent?: string; repo?: string }): Promise<string>;
  queryBacklog(query?: string): Promise<string>;
  serviceBacklog(query?: string): Promise<string>;
  approveQueue(input: { repo: string; issueNumbers: number[] }): Promise<string>;
  approveMerge(input: { repo: string; issueNumbers: number[] }): Promise<string>;
}

/**
 * External-source callbacks for the chat loop — implemented by the server
 * (Google Drive today). listDriveFiles returns a formatted listing;
 * ingestDriveFile downloads one file, extracts/transcribes it when supported,
 * and runs it through the librarian store pipeline, returning a filing report.
 */
export interface DriveSourceTools {
  listDriveFiles(query?: string): Promise<string>;
  /** Enqueue a file for background media/document ingest; returns immediately with the job status. */
  ingestDriveFile(fileId: string, hints?: string[]): Promise<string>;
}

export interface AnswerResult {
  text: string;
  /** Vault-relative paths the loop actually opened — provenance for citations. */
  readPaths: string[];
}
