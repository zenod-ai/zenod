/**
 * Core engine contract — see docs/M0-SPEC.md. The MCP endpoint, the CLI, and
 * (later) the WhatsApp gateway are all thin adapters over `BrainEngine`.
 */

export type Surface = "cli" | "mcp" | "whatsapp" | "web";

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
  /** Vault-relative paths of meaning pages created or updated. */
  pagesTouched: string[];
  commitSha: string;
  githubUrls: string[];
  /**
   * Present when classification confidence was below threshold: the store
   * landed as an Inbox stub and this is the question to relay to the user.
   */
  question?: string;
}

export interface Answer {
  text: string;
  sources: SourceRef[];
}

export interface Reply {
  text: string;
  sources: SourceRef[];
  /** Set when this turn also stored a memory. */
  stored?: StoreResult;
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

export interface BrainEngine {
  /** The librarian pipeline — the only write path. */
  store(input: StoreInput): Promise<StoreResult>;
  /** Read-only agent loop: synthesized answer with citations. */
  ask(question: string): Promise<Answer>;
  /** Full conversational turn: ask + optional store, with conversation memory. */
  chat(message: string, surface: Surface): Promise<Reply>;
  /** Librarian work loop: propose (no plan) then execute (approved plan) vault maintenance. */
  work(input: WorkInput): Promise<WorkResult>;
  /** Deterministic two-pass search. No LLM. */
  search(query: string): Promise<Hit[]>;
  /** Deterministic note fetch. No LLM. */
  get(path: string): Promise<Note>;
  /** Deterministic vault validation. No LLM. */
  lint(): Promise<LintReport>;
}

/**
 * Conversation state (and only that — the vault is the memory). SQLite-backed
 * in this repo; the interface exists so a hosted shell can swap in Postgres.
 */
export interface StateStore {
  appendMessage(conversationId: string, role: "user" | "assistant", text: string, surface: Surface): Promise<void>;
  /** Most recent window: last 20 messages or 48h, whichever is smaller. */
  recentWindow(conversationId: string): Promise<ConversationMessage[]>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  surface: Surface;
  at: Date;
}
