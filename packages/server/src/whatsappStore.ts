import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";

export interface WhatsAppInboundEvent {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  chatName: string;
  isGroup: boolean;
  timestamp: unknown;
  body: string;
  hasMedia: boolean;
  mediaType: string | null;
  mimeType: string | null;
  fileName: string | null;
  mediaRaw?: unknown;
  raw?: unknown;
}

export interface RecordInboundResult {
  inserted: boolean;
  direction: "inbound";
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {}, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Uint8Array) return `[Uint8Array ${item.byteLength} bytes]`;
    return item;
  });
}

function epochMsFromWhatsAppTimestamp(value: unknown): number | null {
  if (!value) return null;
  const seconds =
    typeof value === "object" && value !== null && "low" in value
      ? Number((value as { low: unknown }).low)
      : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

export class WhatsAppStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 30000;

      CREATE TABLE IF NOT EXISTS whatsapp_contacts (
        contact_id TEXT PRIMARY KEY,
        phone_number TEXT,
        display_name TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS whatsapp_chats (
        chat_id TEXT PRIMARY KEY,
        chat_type TEXT NOT NULL,
        display_name TEXT,
        last_message_id TEXT,
        last_message_at INTEGER,
        inbound_message_count INTEGER NOT NULL DEFAULT 0,
        outbound_message_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        message_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        contact_id TEXT,
        direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        message_timestamp INTEGER,
        body_text TEXT NOT NULL DEFAULT '',
        has_media INTEGER NOT NULL DEFAULT 0,
        media_type TEXT,
        processing_status TEXT NOT NULL DEFAULT 'new',
        received_at INTEGER NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_time
        ON whatsapp_messages(chat_id, message_timestamp);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_processing
        ON whatsapp_messages(processing_status, received_at);

      CREATE TABLE IF NOT EXISTS whatsapp_message_media (
        media_id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        mime_type TEXT,
        file_name TEXT,
        storage_status TEXT NOT NULL DEFAULT 'metadata_only',
        created_at INTEGER NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (message_id, media_type, file_name)
      );

      CREATE TABLE IF NOT EXISTS whatsapp_outbound_audit (
        audit_id TEXT PRIMARY KEY,
        message_id TEXT,
        chat_id TEXT NOT NULL,
        contact_id TEXT,
        body_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        error_text TEXT,
        sent_message_id TEXT,
        created_at INTEGER NOT NULL,
        raw_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
  }

  recordInbound(event: WhatsAppInboundEvent): RecordInboundResult {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const phoneNumber = normalizeWhatsAppIdentifier(event.senderId) || null;
      this.db
        .prepare(
          `INSERT INTO whatsapp_contacts (contact_id, phone_number, display_name, first_seen_at, last_seen_at, raw_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(contact_id) DO UPDATE SET
             phone_number = COALESCE(excluded.phone_number, whatsapp_contacts.phone_number),
             display_name = COALESCE(NULLIF(excluded.display_name, ''), whatsapp_contacts.display_name),
             last_seen_at = excluded.last_seen_at,
             raw_json = excluded.raw_json`,
        )
        .run(event.senderId, phoneNumber, event.senderName || phoneNumber || event.senderId, now, now, "{}");

      this.db
        .prepare(
          `INSERT INTO whatsapp_chats (
             chat_id, chat_type, display_name, last_message_id, last_message_at,
             inbound_message_count, outbound_message_count, updated_at, raw_json
           )
           VALUES (?, ?, ?, NULL, NULL, 0, 0, ?, ?)
           ON CONFLICT(chat_id) DO UPDATE SET
             chat_type = excluded.chat_type,
             display_name = COALESCE(NULLIF(excluded.display_name, ''), whatsapp_chats.display_name),
             updated_at = excluded.updated_at,
             raw_json = excluded.raw_json`,
        )
        .run(event.chatId, event.isGroup ? "group" : "direct", event.chatName || event.senderName || event.chatId, now, "{}");

      const timestamp = epochMsFromWhatsAppTimestamp(event.timestamp);
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO whatsapp_messages (
             message_id, chat_id, contact_id, direction, message_timestamp, body_text,
             has_media, media_type, received_at, raw_json
           )
           VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.messageId,
          event.chatId,
          event.senderId,
          timestamp,
          event.body,
          event.hasMedia ? 1 : 0,
          event.mediaType,
          now,
          safeJson(event.raw),
        ).changes;

      if (inserted) {
        this.db
          .prepare(
            `UPDATE whatsapp_chats SET
               last_message_id = ?,
               last_message_at = ?,
               inbound_message_count = inbound_message_count + 1,
               updated_at = ?
             WHERE chat_id = ?`,
          )
          .run(event.messageId, timestamp, now, event.chatId);
      }

      if (inserted && event.hasMedia) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO whatsapp_message_media (
               message_id, media_type, mime_type, file_name, created_at, raw_json
             )
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.messageId,
            event.mediaType ?? "unknown",
            event.mimeType,
            event.fileName,
            now,
            safeJson(event.mediaRaw),
          );
      }

      this.db.exec("COMMIT");
      return { inserted: Boolean(inserted), direction: "inbound" };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  markMessageStatus(messageId: string, status: string): void {
    this.db.prepare("UPDATE whatsapp_messages SET processing_status = ? WHERE message_id = ?").run(status, messageId);
  }

  recordOutboundAudit(input: {
    messageId?: string | null;
    chatId: string;
    contactId?: string | null;
    bodyText?: string;
    status: string;
    errorText?: string | null;
    sentMessageId?: string | null;
    raw?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO whatsapp_outbound_audit (
           audit_id, message_id, chat_id, contact_id, body_text, status, error_text,
           sent_message_id, created_at, raw_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `whaudit_${randomUUID().replaceAll("-", "")}`,
        input.messageId ?? null,
        input.chatId,
        input.contactId ?? null,
        input.bodyText ?? "",
        input.status,
        input.errorText ?? null,
        input.sentMessageId ?? null,
        Date.now(),
        safeJson(input.raw),
      );
  }

  lastActivity(): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(at) AS at FROM (
           SELECT received_at AS at FROM whatsapp_messages
           UNION ALL
           SELECT created_at AS at FROM whatsapp_outbound_audit
         )`,
      )
      .get() as { at: number | null } | undefined;
    return row?.at ?? null;
  }

  countMessages(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_messages").get() as { count: number };
    return row.count;
  }

  countOutboundAudits(status?: string): number {
    const row = status
      ? (this.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_outbound_audit WHERE status = ?").get(status) as {
          count: number;
        })
      : (this.db.prepare("SELECT COUNT(*) AS count FROM whatsapp_outbound_audit").get() as { count: number });
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
