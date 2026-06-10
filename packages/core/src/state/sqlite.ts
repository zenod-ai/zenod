import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationMessage, StateStore, Surface } from "../types.js";

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
    `);
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
