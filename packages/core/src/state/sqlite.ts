import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ChatTestAuditInput,
  ChatTestAuditRecord,
  ConversationMessage,
  ConversationSearchHit,
  ConversationSearchOptions,
  SourceRef,
  StateStore,
  Surface,
} from "../types.js";
import type { ChatToolEvent } from "../llm/types.js";

const WINDOW_MESSAGES = 20;
const WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Conversation state on a single SQLite file (node:sqlite — no native deps).
 * Only conversations live here; the vault is the memory.
 */
export class SqliteStateStore implements StateStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 30000;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        surface TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, at);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_clients (
        name TEXT PRIMARY KEY,
        version TEXT,
        last_seen INTEGER NOT NULL,
        connections INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS chat_test_runs (
        correlation_id TEXT PRIMARY KEY,
        test_run_id TEXT,
        surface TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        reply TEXT,
        sources_json TEXT NOT NULL,
        tool_events_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
        error TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_test_runs_at ON chat_test_runs (at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_test_runs_test_run_id ON chat_test_runs (test_run_id, at DESC);
      CREATE TABLE IF NOT EXISTS approval_tokens (
        conversation_id TEXT NOT NULL,
        token_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approval_tokens_conversation ON approval_tokens (conversation_id, expires_at);
    `);
  }

  /** Record an MCP client handshake (from the initialize request's clientInfo). */
  recordMcpClient(name: string, version: string | null): void {
    this.db
      .prepare(
        `INSERT INTO mcp_clients (name, version, last_seen, connections) VALUES (?, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET version = excluded.version, last_seen = excluded.last_seen,
           connections = mcp_clients.connections + 1`,
      )
      .run(name, version, Date.now());
  }

  listMcpClients(): Array<{ name: string; version: string | null; lastSeen: number; connections: number }> {
    return this.db
      .prepare("SELECT name, version, last_seen AS lastSeen, connections FROM mcp_clients ORDER BY last_seen DESC")
      .all() as Array<{ name: string; version: string | null; lastSeen: number; connections: number }>;
  }

  async appendMessage(conversationId: string, role: "user" | "assistant", text: string, surface: Surface): Promise<void> {
    this.db
      .prepare("INSERT INTO messages (conversation_id, role, text, surface, at) VALUES (?, ?, ?, ?, ?)")
      .run(conversationId, role, text, surface, Date.now());
  }

  async recentWindow(conversationId: string): Promise<ConversationMessage[]> {
    const cutoff = Date.now() - WINDOW_MS;
    const rows = this.db
      .prepare(
        `SELECT role, text, surface, at FROM messages
         WHERE conversation_id = ? AND at >= ?
         ORDER BY at DESC, id DESC LIMIT ?`,
      )
      .all(conversationId, cutoff, WINDOW_MESSAGES) as Array<{
      role: "user" | "assistant";
      text: string;
      surface: Surface;
      at: number;
    }>;
    return rows.reverse().map((r) => ({ role: r.role, text: r.text, surface: r.surface, at: new Date(r.at) }));
  }

  async clearConversation(conversationId: string): Promise<void> {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
    this.db.prepare("DELETE FROM approval_tokens WHERE conversation_id = ?").run(conversationId);
  }

  async loadApprovalTokens(conversationId: string): Promise<Array<{
    tool: string;
    draftHash: string;
    expiresAt: number;
    owner?: string;
    description?: string;
    args?: Record<string, unknown>;
    anyOutboundSend?: boolean;
  }>> {
    this.db.prepare("DELETE FROM approval_tokens WHERE expires_at <= ?").run(Date.now());
    return this.db
      .prepare("SELECT token_json FROM approval_tokens WHERE conversation_id = ? ORDER BY expires_at")
      .all(conversationId)
      .flatMap((row) => {
        try {
          return [JSON.parse(String((row as { token_json: string }).token_json))];
        } catch {
          return [];
        }
      });
  }

  async saveApprovalTokens(conversationId: string, tokens: Array<{
    tool: string;
    draftHash: string;
    expiresAt: number;
    owner?: string;
    description?: string;
    args?: Record<string, unknown>;
    anyOutboundSend?: boolean;
  }>): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM approval_tokens WHERE conversation_id = ?").run(conversationId);
      const insert = this.db.prepare("INSERT INTO approval_tokens (conversation_id, token_json, expires_at) VALUES (?, ?, ?)");
      for (const token of tokens) insert.run(conversationId, JSON.stringify(token), token.expiresAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async searchConversations(query: string, options: ConversationSearchOptions = {}): Promise<ConversationSearchHit[]> {
    // Deterministic LIKE search (no FTS extension in node:sqlite). Strip LIKE
    // wildcards so user input can't smuggle them in, dedupe, and cap the term
    // count so a rambling query can't blow up the WHERE clause.
    const terms = Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/[%_]/g, " ").trim())
          .filter((t) => t.length >= 2),
      ),
    ).slice(0, 8);
    if (terms.length === 0) return [];

    const surfaces = (options.surfaces ?? []).filter(Boolean);
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 6), 1), 20);

    const where = [`(${terms.map(() => "lower(text) LIKE ?").join(" OR ")})`];
    const params: Array<string | number> = terms.map((t) => `%${t}%`);
    if (surfaces.length) {
      where.push(`surface IN (${surfaces.map(() => "?").join(", ")})`);
      params.push(...surfaces);
    }
    // Pull a generous pool of the most recent matching messages, then group and
    // rank in JS. The pool bounds work for a hot query without missing matches
    // in any single conversation we ultimately surface.
    const POOL = 400;
    params.push(POOL);
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, role, text, surface, at FROM messages
         WHERE ${where.join(" AND ")}
         ORDER BY at DESC, id DESC LIMIT ?`,
      )
      .all(...params) as Array<{
      id: number;
      conversationId: string;
      role: "user" | "assistant";
      text: string;
      surface: Surface;
      at: number;
    }>;

    type Group = { surface: Surface; lastAt: number; score: number; rows: typeof rows };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const lower = r.text.toLowerCase();
      const score = terms.reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0);
      const g = groups.get(r.conversationId);
      if (g) {
        g.rows.push(r);
        g.score = Math.max(g.score, score);
        g.lastAt = Math.max(g.lastAt, r.at);
      } else {
        groups.set(r.conversationId, { surface: r.surface, lastAt: r.at, score, rows: [r] });
      }
    }

    const MESSAGES_PER_HIT = 12;
    return Array.from(groups.entries())
      .sort((a, b) => b[1].score - a[1].score || b[1].lastAt - a[1].lastAt)
      .slice(0, limit)
      .map(([conversationId, g]) => ({
        conversationId,
        surface: g.surface,
        matchCount: g.rows.length,
        lastAt: new Date(g.lastAt),
        messages: g.rows
          .slice()
          .sort((a, b) => a.at - b.at || a.id - b.id)
          .slice(-MESSAGES_PER_HIT)
          .map((r) => ({ role: r.role, text: r.text, surface: r.surface, at: new Date(r.at) })),
      }));
  }

  recordChatTestRun(input: ChatTestAuditInput): ChatTestAuditRecord {
    this.db
      .prepare(
        `INSERT INTO chat_test_runs (
           correlation_id, test_run_id, surface, conversation_key, conversation_id,
           prompt, reply, sources_json, tool_events_json, status, error, at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.correlationId,
        input.testRunId ?? null,
        input.surface,
        input.conversationKey,
        input.conversationId,
        input.prompt,
        input.reply ?? null,
        JSON.stringify(input.sources),
        JSON.stringify(input.toolEvents),
        input.status,
        input.error ?? null,
        input.at.getTime(),
      );
    return { ...input };
  }

  getChatTestRun(correlationId: string): ChatTestAuditRecord | null {
    const row = this.db
      .prepare(
        `SELECT correlation_id AS correlationId, test_run_id AS testRunId, surface, conversation_key AS conversationKey,
                conversation_id AS conversationId, prompt, reply, sources_json AS sourcesJson,
                tool_events_json AS toolEventsJson, status, error, at
         FROM chat_test_runs WHERE correlation_id = ?`,
      )
      .get(correlationId) as ChatTestRunRow | undefined;
    return row ? chatTestRunFromRow(row) : null;
  }

  listChatTestRuns(limit = 20): ChatTestAuditRecord[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = this.db
      .prepare(
        `SELECT correlation_id AS correlationId, test_run_id AS testRunId, surface, conversation_key AS conversationKey,
                conversation_id AS conversationId, prompt, reply, sources_json AS sourcesJson,
                tool_events_json AS toolEventsJson, status, error, at
         FROM chat_test_runs ORDER BY at DESC LIMIT ?`,
      )
      .all(safeLimit) as unknown as ChatTestRunRow[];
    return rows.map(chatTestRunFromRow);
  }

  /** Simple key-value settings — used by the server for runtime configuration. */
  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  close(): void {
    this.db.close();
  }
}

interface ChatTestRunRow {
  correlationId: string;
  testRunId: string | null;
  surface: Surface;
  conversationKey: string;
  conversationId: string;
  prompt: string;
  reply: string | null;
  sourcesJson: string;
  toolEventsJson: string;
  status: "ok" | "error";
  error: string | null;
  at: number;
}

function chatTestRunFromRow(row: ChatTestRunRow): ChatTestAuditRecord {
  return {
    correlationId: row.correlationId,
    ...(row.testRunId ? { testRunId: row.testRunId } : {}),
    surface: row.surface,
    conversationKey: row.conversationKey,
    conversationId: row.conversationId,
    prompt: row.prompt,
    ...(row.reply !== null ? { reply: row.reply } : {}),
    sources: JSON.parse(row.sourcesJson) as SourceRef[],
    toolEvents: JSON.parse(row.toolEventsJson) as ChatToolEvent[],
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    at: new Date(row.at),
  };
}
