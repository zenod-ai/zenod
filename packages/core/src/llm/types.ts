import type { PageIndexEntry } from "../vault/pages.js";
import type { LintError } from "../types.js";

/**
 * The LLM seam. The engine talks to this interface only, so every pipeline
 * is testable with a fake — no API key needed below this line.
 */
export interface BrainLlm {
  /** One haiku-class pass: which meaning pages does this memory touch? */
  classify(input: ClassifyInput): Promise<Classification>;
  /** Compose the full new content of one meaning page, integrating the evidence. */
  composePage(input: ComposePageInput): Promise<string>;
  /** Read-only agent loop over the vault; returns the synthesized answer. */
  answer(input: AnswerInput, tools: VaultReadTools): Promise<AnswerResult>;
  /**
   * Librarian work loop. Without writeTools it surveys and returns a plan
   * (propose mode); with writeTools it executes against the working tree
   * (execute mode). The engine validates and commits — never this loop.
   */
  work(input: WorkLoopInput, tools: VaultReadTools, writeTools?: VaultWriteTools): Promise<WorkLoopResult>;
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

export interface AnswerInput {
  question: string;
  /** AGENTS.md + folder index context for the system prompt. */
  vaultBriefing: string;
  /** Prior conversation turns (chat mode); empty for one-shot ask. */
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
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

export interface AnswerResult {
  text: string;
  /** Vault-relative paths the loop actually opened — provenance for citations. */
  readPaths: string[];
}
