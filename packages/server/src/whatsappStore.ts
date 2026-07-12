import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { maskPhoneNumber, normalizeWhatsAppIdentifier } from "./whatsappConfig.js";

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

export interface WhatsAppStoreDiagnostics {
  inboundMessages: number;
  outboundAudits: number;
  processingCounts: Record<string, number>;
  outboundCounts: Record<string, number>;
  lastInbound: {
    at: number;
    sender: string | null;
    status: string;
    isGroup: boolean;
  } | null;
  lastOutbound: {
    at: number;
    status: string;
  } | null;
}

export interface WhatsAppDigestStatus {
  messageId: string;
  chatId: string;
  contactId: string | null;
  receivedAt: number;
  messageTimestamp: number | null;
  mediaType: string | null;
  status: string;
  lastReport: {
    at: number;
    status: string;
    bodyText: string;
    errorText: string | null;
  } | null;
}

export interface WhatsAppTranscriptEntry {
  direction: "inbound" | "outbound";
  at: number;
  messageId: string | null;
  chatId: string;
  contactId: string | null;
  bodyText: string;
  status: string;
  mediaType: string | null;
  sentMessageId?: string | null;
  media?: WhatsAppTranscriptMedia[];
  linkedReceipts?: WhatsAppTranscriptReceipt[];
  linkedFollowUps?: WhatsAppTranscriptFollowUp[];
}

export interface WhatsAppTranscriptMedia {
  mediaId: number;
  mediaType: string;
  mimeType: string | null;
  fileName: string | null;
  storageStatus: string;
}

export interface WhatsAppTranscriptReceipt {
  at: number;
  status: string;
  sentMessageId: string | null;
  bodyText: string;
  driveLinks: string[];
  driveFileIds: string[];
  vaultEvidenceRefs: string[];
  vaultCommits: string[];
  vaultLinks: string[];
}

export interface WhatsAppTranscriptFollowUp {
  at: number;
  messageId: string;
  bodyText: string;
}

export interface WhatsAppMediaFollowUpLink {
  mediaMessageId: string;
  followupMessageId: string;
  mediaType: string | null;
  mediaStatus: string;
  mediaReceivedAt: number;
  ageMs: number;
  followupText: string;
}

export interface WhatsAppTranscriptQuery {
  sinceMs?: number;
  contactId?: string;
  chatId?: string;
  messageId?: string;
  limit?: number;
}

export interface WhatsAppNotificationEntry {
  notificationId: string;
  channel: "whatsapp";
  at: number;
  messageId: string | null;
  sentMessageId: string | null;
  chatId: string;
  contactId: string | null;
  bodyText: string;
  status: string;
  errorText: string | null;
}

export interface WhatsAppNotificationQuery {
  sinceMs?: number;
  contactId?: string;
  chatId?: string;
  query?: string;
  limit?: number;
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

function uniqueMatches(text: string, re: RegExp): string[] {
  return [...new Set([...text.matchAll(re)].map((match) => match[1]).filter((value): value is string => Boolean(value)))];
}

function driveFileIdFromLink(link: string): string | null {
  const match = /\/file\/d\/([^/?#]+)/.exec(link);
  return match?.[1] ?? null;
}

function receiptFromOutbound(row: {
  at: number;
  status: string;
  sentMessageId: string | null;
  bodyText: string;
}): WhatsAppTranscriptReceipt | null {
  if (!/^Storage receipt\b/i.test(row.bodyText.trim())) return null;
  const driveLinks = uniqueMatches(row.bodyText, /(https:\/\/drive\.google\.com\/[^\s)]+)/g);
  return {
    at: row.at,
    status: row.status,
    sentMessageId: row.sentMessageId,
    bodyText: row.bodyText,
    driveLinks,
    driveFileIds: driveLinks.map(driveFileIdFromLink).filter((id): id is string => Boolean(id)),
    vaultEvidenceRefs: uniqueMatches(row.bodyText, /^Vault evidence:\s*(.+)$/gm),
    vaultCommits: uniqueMatches(row.bodyText, /^Vault commit:\s*([0-9a-f]{7,40})$/gim),
    vaultLinks: uniqueMatches(row.bodyText, /(https:\/\/github\.com\/[^\s)]+)/g),
  };
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

      CREATE TABLE IF NOT EXISTS whatsapp_media_followups (
        followup_message_id TEXT PRIMARY KEY,
        media_message_id TEXT NOT NULL,
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

  recordInboundTranscript(messageId: string, transcript: string): void {
    this.db
      .prepare(
        `UPDATE whatsapp_messages
         SET body_text = ?
         WHERE message_id = ?
           AND direction = 'inbound'`,
      )
      .run(transcript, messageId);
  }

  markMediaStorageStatus(messageId: string, status: string): void {
    this.db
      .prepare(
        `UPDATE whatsapp_message_media
         SET storage_status = ?
         WHERE message_id = ?`,
      )
      .run(status, messageId);
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

  diagnostics(): WhatsAppStoreDiagnostics {
    const inboundMessages = this.countMessages();
    const outboundAudits = this.countOutboundAudits();
    const processingRows = this.db
      .prepare("SELECT processing_status AS status, COUNT(*) AS count FROM whatsapp_messages GROUP BY processing_status")
      .all() as unknown as Array<{ status: string; count: number }>;
    const outboundRows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM whatsapp_outbound_audit GROUP BY status")
      .all() as unknown as Array<{ status: string; count: number }>;
    const lastInbound = this.db
      .prepare(
        `SELECT m.received_at, m.contact_id, m.processing_status, c.chat_type
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_chats c ON c.chat_id = m.chat_id
         ORDER BY m.received_at DESC LIMIT 1`,
      )
      .get() as
      | { received_at: number; contact_id: string | null; processing_status: string; chat_type: string | null }
      | undefined;
    const lastOutbound = this.db
      .prepare("SELECT created_at, status FROM whatsapp_outbound_audit ORDER BY created_at DESC LIMIT 1")
      .get() as { created_at: number; status: string } | undefined;

    return {
      inboundMessages,
      outboundAudits,
      processingCounts: Object.fromEntries(processingRows.map((row) => [row.status, Number(row.count)])),
      outboundCounts: Object.fromEntries(outboundRows.map((row) => [row.status, Number(row.count)])),
      lastInbound: lastInbound
        ? {
            at: lastInbound.received_at,
            sender: lastInbound.contact_id ? maskPhoneNumber(lastInbound.contact_id) : null,
            status: lastInbound.processing_status,
            isGroup: lastInbound.chat_type === "group",
          }
        : null,
      lastOutbound: lastOutbound ? { at: lastOutbound.created_at, status: lastOutbound.status } : null,
    };
  }

  latestDigestStatusForContact(contactId: string): WhatsAppDigestStatus | null {
    const message = this.db
      .prepare(
        // Voice notes are no longer a digest/ingest artifact — they're treated
        // as text and answered inline — so they must NOT surface as a
        // digest status. The shortcut now only reflects ingest
        // media (e.g. images), which still flow through the digest path.
        `SELECT message_id, chat_id, contact_id, received_at, message_timestamp, media_type, processing_status
         FROM whatsapp_messages
         WHERE direction='inbound'
           AND has_media=1
           AND (media_type IS NULL OR media_type NOT IN ('ptt','audio'))
           AND contact_id=?
         ORDER BY received_at DESC
         LIMIT 1`,
      )
      .get(contactId) as
      | {
          message_id: string;
          chat_id: string;
          contact_id: string | null;
          received_at: number;
          message_timestamp: number | null;
          media_type: string | null;
          processing_status: string;
        }
      | undefined;
    if (!message) return null;

    const report = this.db
      .prepare(
        `SELECT created_at, status, body_text, error_text
         FROM whatsapp_outbound_audit
         WHERE message_id=?
           AND status IN ('digest_report_sent', 'digest_failed', 'ack_sent')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(message.message_id) as
      | { created_at: number; status: string; body_text: string; error_text: string | null }
      | undefined;

    return {
      messageId: message.message_id,
      chatId: message.chat_id,
      contactId: message.contact_id,
      receivedAt: message.received_at,
      messageTimestamp: message.message_timestamp,
      mediaType: message.media_type,
      status: message.processing_status,
      lastReport: report
        ? {
            at: report.created_at,
            status: report.status,
            bodyText: report.body_text,
            errorText: report.error_text,
          }
        : null,
    };
  }

  linkRecentMediaFollowUp(event: WhatsAppInboundEvent, maxAgeMs = 10 * 60 * 1000): WhatsAppMediaFollowUpLink | null {
    if (event.hasMedia) return null;
    const text = event.body.trim();
    if (!this.isMediaFollowUpText(text)) return null;
    const current = this.db
      .prepare("SELECT received_at AS receivedAt FROM whatsapp_messages WHERE message_id = ?")
      .get(event.messageId) as { receivedAt: number } | undefined;
    const eventAt = current?.receivedAt ?? Date.now();
    const since = eventAt - maxAgeMs;
    const media = this.db
      .prepare(
        `SELECT
           message_id AS messageId,
           received_at AS receivedAt,
           media_type AS mediaType,
           processing_status AS mediaStatus
         FROM whatsapp_messages
         WHERE direction='inbound'
           AND has_media=1
           AND (media_type IS NULL OR media_type NOT IN ('ptt','audio'))
           AND received_at <= ?
           AND received_at >= ?
           AND chat_id = ?
           AND contact_id = ?
         ORDER BY received_at DESC
         LIMIT 1`,
      )
      .get(eventAt, since, event.chatId, event.senderId) as
      | { messageId: string; receivedAt: number; mediaType: string | null; mediaStatus: string }
      | undefined;
    if (!media) return null;

    const ageMs = Math.max(0, eventAt - media.receivedAt);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO whatsapp_media_followups (
           followup_message_id, media_message_id, created_at, raw_json
         )
         VALUES (?, ?, ?, ?)`,
      )
      .run(event.messageId, media.messageId, Date.now(), safeJson({ reason: "nearby_media_followup", ageMs }));
    return {
      mediaMessageId: media.messageId,
      followupMessageId: event.messageId,
      mediaType: media.mediaType,
      mediaStatus: media.mediaStatus,
      mediaReceivedAt: media.receivedAt,
      ageMs,
      followupText: text,
    };
  }

  followUpsForMedia(messageId: string): WhatsAppTranscriptFollowUp[] {
    return (
      this.db
        .prepare(
          `SELECT
             f.followup_message_id AS messageId,
             COALESCE(m.message_timestamp, m.received_at) AS at,
             m.body_text AS bodyText
           FROM whatsapp_media_followups f
           JOIN whatsapp_messages m ON m.message_id = f.followup_message_id
           WHERE f.media_message_id = ?
           ORDER BY at ASC`,
        )
        .all(messageId) as unknown as WhatsAppTranscriptFollowUp[]
    ).map((row) => ({ at: row.at, messageId: row.messageId, bodyText: row.bodyText }));
  }

  private isMediaFollowUpText(text: string): boolean {
    if (!text || text.length > 500) return false;
    return /\b(?:related to|for|about|regarding|comment(?: is)?|add(?:ing)? this comment|attach(?: this)?|did this happen already|did it happen already)\b[\s\S]{0,120}\b(?:picture|image|screenshot|photo|attachment|media|this|that)\b/i.test(
      text,
    );
  }

  recentTranscript(input: WhatsAppTranscriptQuery = {}): WhatsAppTranscriptEntry[] {
    const sinceMs = input.sinceMs ?? Date.now() - 2 * 60 * 60 * 1000;
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const contact = input.contactId ? normalizeWhatsAppIdentifier(input.contactId) : "";
    const chat = input.chatId ?? "";
    const message = input.messageId?.trim() ?? "";
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT
             direction,
             COALESCE(message_timestamp, received_at) AS at,
             message_id AS messageId,
             chat_id AS chatId,
             contact_id AS contactId,
             body_text AS bodyText,
             processing_status AS status,
             media_type AS mediaType,
             NULL AS sentMessageId
           FROM whatsapp_messages
           WHERE received_at >= ?
           UNION ALL
           SELECT
             'outbound' AS direction,
             created_at AS at,
             message_id AS messageId,
             chat_id AS chatId,
             contact_id AS contactId,
             body_text AS bodyText,
             status AS status,
             NULL AS mediaType,
             sent_message_id AS sentMessageId
           FROM whatsapp_outbound_audit
           WHERE created_at >= ?
         )
         WHERE (? = '' OR REPLACE(REPLACE(REPLACE(COALESCE(contactId, ''), '@s.whatsapp.net', ''), '@lid', ''), '+', '') LIKE '%' || ? || '%')
           AND (? = '' OR chatId = ?)
           AND (? = '' OR messageId = ? OR sentMessageId = ?)
         ORDER BY at DESC
         LIMIT ?`,
      )
      .all(sinceMs, sinceMs, contact, contact, chat, chat, message, message, message, limit) as unknown as Array<{
      direction: "inbound" | "outbound";
      at: number;
      messageId: string | null;
      chatId: string;
      contactId: string | null;
      bodyText: string;
      status: string;
      mediaType: string | null;
      sentMessageId: string | null;
    }>;
    const inboundMessageIds = [
      ...new Set(rows.filter((row) => row.direction === "inbound" && row.messageId).map((row) => row.messageId as string)),
    ];
    const mediaByMessage = new Map<string, WhatsAppTranscriptMedia[]>();
    const receiptsByMessage = new Map<string, WhatsAppTranscriptReceipt[]>();
    const followUpsByMessage = new Map<string, WhatsAppTranscriptFollowUp[]>();
    if (inboundMessageIds.length > 0) {
      const placeholders = inboundMessageIds.map(() => "?").join(",");
      const mediaRows = this.db
        .prepare(
          `SELECT
             message_id AS messageId,
             media_id AS mediaId,
             media_type AS mediaType,
             mime_type AS mimeType,
             file_name AS fileName,
             storage_status AS storageStatus
           FROM whatsapp_message_media
           WHERE message_id IN (${placeholders})
           ORDER BY media_id ASC`,
        )
        .all(...inboundMessageIds) as unknown as Array<{
        messageId: string;
        mediaId: number;
        mediaType: string;
        mimeType: string | null;
        fileName: string | null;
        storageStatus: string;
      }>;
      for (const row of mediaRows) {
        const bucket = mediaByMessage.get(row.messageId) ?? [];
        bucket.push({
          mediaId: row.mediaId,
          mediaType: row.mediaType,
          mimeType: row.mimeType,
          fileName: row.fileName,
          storageStatus: row.storageStatus,
        });
        mediaByMessage.set(row.messageId, bucket);
      }

      const receiptRows = this.db
        .prepare(
          `SELECT
             message_id AS messageId,
             created_at AS at,
             status,
             sent_message_id AS sentMessageId,
             body_text AS bodyText
           FROM whatsapp_outbound_audit
           WHERE message_id IN (${placeholders})
           ORDER BY created_at ASC`,
        )
        .all(...inboundMessageIds) as unknown as Array<{
        messageId: string;
        at: number;
        status: string;
        sentMessageId: string | null;
        bodyText: string;
      }>;
      for (const row of receiptRows) {
        const receipt = receiptFromOutbound(row);
        if (!receipt) continue;
        const bucket = receiptsByMessage.get(row.messageId) ?? [];
        bucket.push(receipt);
        receiptsByMessage.set(row.messageId, bucket);
      }

      const followUpRows = this.db
        .prepare(
          `SELECT
             f.media_message_id AS mediaMessageId,
             f.followup_message_id AS messageId,
             COALESCE(m.message_timestamp, m.received_at) AS at,
             m.body_text AS bodyText
           FROM whatsapp_media_followups f
           JOIN whatsapp_messages m ON m.message_id = f.followup_message_id
           WHERE f.media_message_id IN (${placeholders})
           ORDER BY at ASC`,
        )
        .all(...inboundMessageIds) as unknown as Array<{
        mediaMessageId: string;
        messageId: string;
        at: number;
        bodyText: string;
      }>;
      for (const row of followUpRows) {
        const bucket = followUpsByMessage.get(row.mediaMessageId) ?? [];
        bucket.push({ at: row.at, messageId: row.messageId, bodyText: row.bodyText });
        followUpsByMessage.set(row.mediaMessageId, bucket);
      }
    }

    return rows.reverse().map((row) => ({
      direction: row.direction,
      at: row.at,
      messageId: row.messageId,
      chatId: row.chatId,
      contactId: row.contactId,
      bodyText: row.bodyText,
      status: row.status,
      mediaType: row.mediaType,
      ...(row.sentMessageId ? { sentMessageId: row.sentMessageId } : {}),
      ...(row.direction === "inbound" && row.messageId && mediaByMessage.has(row.messageId) ? { media: mediaByMessage.get(row.messageId) } : {}),
      ...(row.direction === "inbound" && row.messageId && receiptsByMessage.has(row.messageId) ? { linkedReceipts: receiptsByMessage.get(row.messageId) } : {}),
      ...(row.direction === "inbound" && row.messageId && followUpsByMessage.has(row.messageId)
        ? { linkedFollowUps: followUpsByMessage.get(row.messageId) }
        : {}),
    }));
  }

  recentNotifications(input: WhatsAppNotificationQuery = {}): WhatsAppNotificationEntry[] {
    const sinceMs = input.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const contact = input.contactId ? normalizeWhatsAppIdentifier(input.contactId) : "";
    const chat = input.chatId ?? "";
    const query = input.query?.trim() ?? "";
    const rows = this.db
      .prepare(
        `SELECT
           audit_id AS notificationId,
           created_at AS at,
           message_id AS messageId,
           sent_message_id AS sentMessageId,
           chat_id AS chatId,
           contact_id AS contactId,
           body_text AS bodyText,
           status,
           error_text AS errorText
         FROM whatsapp_outbound_audit
         WHERE created_at >= ?
           AND (status = 'notify' OR COALESCE(message_id, '') LIKE 'notify-%')
           AND (? = '' OR REPLACE(REPLACE(REPLACE(COALESCE(contact_id, ''), '@s.whatsapp.net', ''), '@lid', ''), '+', '') LIKE '%' || ? || '%')
           AND (? = '' OR chat_id = ?)
           AND (
             ? = ''
             OR body_text LIKE '%' || ? || '%'
             OR COALESCE(message_id, '') LIKE '%' || ? || '%'
             OR COALESCE(sent_message_id, '') LIKE '%' || ? || '%'
           )
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sinceMs, contact, contact, chat, chat, query, query, query, query, limit) as unknown as Array<{
      notificationId: string;
      at: number;
      messageId: string | null;
      sentMessageId: string | null;
      chatId: string;
      contactId: string | null;
      bodyText: string;
      status: string;
      errorText: string | null;
    }>;
    return rows.map((row) => ({ ...row, channel: "whatsapp" }));
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
