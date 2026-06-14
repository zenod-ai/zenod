import type { PageIndexEntry } from "../vault/pages.js";
import type { BacklogCandidate, BacklogDigestInput, BacklogDigestResult, BacklogSourceRef, LintError, StoreResult } from "../types.js";

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
  /** AGENTS.md + folder index context for the system prompt. */
  vaultBriefing: string;
  /** Prior conversation turns (chat mode); empty for one-shot ask. */
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
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
}

/** Read-only tool callbacks the agent loop may invoke. */
export interface VaultReadTools {
  searchVault(query: string): Promise<string>;
  readNote(path: string): Promise<string>;
  listPages(): Promise<string>;
}

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
  captureNote(content: string, hints?: string[]): Promise<StoreResult>;
  proposeTask(objective: string): Promise<string>;
  executeTask(objective: string, plan: string): Promise<string>;
  digestBacklog(input: BacklogDigestInput): Promise<BacklogDigestResult>;
  createIssue(input: { repo: string; title: string; body: string; labels?: string[] }): Promise<string>;
  labelIssue(input: { repo: string; issueNumber: number; labels: string[] }): Promise<string>;
  queryBacklog(query?: string): Promise<string>;
  serviceBacklog(query?: string): Promise<string>;
  approveQueue(input: { repo: string; issueNumbers: number[] }): Promise<string>;
  approveMerge(input: { repo: string; issueNumbers: number[] }): Promise<string>;
}

/**
 * External-source callbacks for the chat loop — implemented by the server
 * (Google Drive today). listDriveFiles returns a formatted listing;
 * ingestDriveFile downloads one file, transcribes it when it is audio, and
 * runs it through the librarian store pipeline, returning a filing report.
 */
export interface DriveSourceTools {
  listDriveFiles(query?: string): Promise<string>;
  /** Enqueue a file for background ingestion; returns immediately with the job status. */
  ingestDriveFile(fileId: string, hints?: string[]): Promise<string>;
}

export interface AnswerResult {
  text: string;
  /** Vault-relative paths the loop actually opened — provenance for citations. */
  readPaths: string[];
}
