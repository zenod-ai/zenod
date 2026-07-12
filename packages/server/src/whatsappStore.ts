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
  channelAudit?: WhatsAppChannelAuditRecord;
  mediaRecovery?: WhatsAppMediaRecoveryRecord;
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

export type WhatsAppChannelLifecycle = "forwarded" | "replied" | "failed" | "interrupted";

export interface WhatsAppChannelAuditInput {
  providerMessageId: string;
  tenantId: string;
  senderId: string;
  transcriptText?: string | null;
  transcriptProvenance?: string | null;
  artifactRef?: string | null;
  artifactSha256?: string | null;
  downstreamDestination: string;
  downstreamCorrelationId?: string | null;
  downstreamReceipt?: Record<string, unknown> | null;
  replyText?: string | null;
}

export interface WhatsAppChannelAuditRecord {
  providerMessageId: string;
  tenantId: string;
  senderId: string;
  transcriptText: string | null;
  transcriptProvenance: string | null;
  artifactRef: string | null;
  artifactSha256: string | null;
  downstreamDestination: string;
  downstreamCorrelationId: string | null;
  downstreamReceipt: Record<string, unknown> | null;
  replyText: string | null;
  mediaRecovery?: WhatsAppMediaRecoveryRecord;
  lifecycleState: WhatsAppChannelLifecycle;
  outboundProviderId: string | null;
  outboundStatus: string | null;
  forwardedAt: number;
  updatedAt: number;
}

export type WhatsAppMediaRecoveryKind = "forwarded_reply" | "interrupted_failure";
export type WhatsAppMediaRecoveryState =
  | "pending"
  | "claimed"
  | "recovered_replied"
  | "failure_notified"
  | "provider_notification_failed";

export interface WhatsAppMediaRecoveryClaim {
  providerMessageId: string;
  kind: WhatsAppMediaRecoveryKind;
  state: "claimed";
  chatId: string;
  contactId: string | null;
  replyText: string;
  claimedAt: number;
}

export interface WhatsAppMediaRecoveryRecord {
  providerMessageId: string;
  kind: WhatsAppMediaRecoveryKind;
  state: WhatsAppMediaRecoveryState;
  replyText: string;
  outboundProviderId: string | null;
  errorText: string | null;
  claimedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {}, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Uint8Array) return `[Uint8Array ${item.byteLength} bytes]`;
    return item;
  });
}

const MAX_RECOVERY_REPLY_CHARS = 65_536;

function boundedRecoveryReply(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text.slice(0, MAX_RECOVERY_REPLY_CHARS) : null;
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

      CREATE TABLE IF NOT EXISTS whatsapp_channel_audit (
        provider_message_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        transcript_text TEXT,
        transcript_provenance TEXT,
        artifact_ref TEXT,
        artifact_sha256 TEXT,
        downstream_destination TEXT NOT NULL,
        downstream_correlation_id TEXT,
        downstream_receipt_json TEXT,
        reply_text TEXT,
        lifecycle_state TEXT NOT NULL,
        outbound_provider_id TEXT,
        outbound_status TEXT,
        forwarded_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_channel_audit_correlation
        ON whatsapp_channel_audit(downstream_correlation_id);

      CREATE TABLE IF NOT EXISTS whatsapp_media_recovery (
        provider_message_id TEXT PRIMARY KEY,
        recovery_kind TEXT NOT NULL,
        recovery_state TEXT NOT NULL,
        reply_text TEXT NOT NULL,
        outbound_provider_id TEXT,
        error_text TEXT,
        claimed_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_media_recovery_state
        ON whatsapp_media_recovery(recovery_state, created_at);
    `);

    // W-P2 is an additive migration over the W-P3 audit table already present
    // on phylax-data. CREATE TABLE does not add a column to existing tables.
    const auditColumns = this.db.prepare("PRAGMA table_info(whatsapp_channel_audit)").all() as unknown as Array<{ name: string }>;
    if (!auditColumns.some((column) => column.name === "reply_text")) {
      this.db.exec("ALTER TABLE whatsapp_channel_audit ADD COLUMN reply_text TEXT");
    }

    // Recover the durable boundary, never the Ring call. If the provider send
    // was already audited, reconcile it as replied. Otherwise queue exactly one
    // provider action: the stored Ring reply when forwarding completed, or a
    // static failure notice when the restart happened before that boundary.
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `INSERT INTO whatsapp_outbound_audit (
           audit_id, message_id, chat_id, contact_id, body_text, status,
           error_text, sent_message_id, created_at, raw_json
         )
         SELECT 'whaudit_' || lower(hex(randomblob(16))), r.provider_message_id,
           m.chat_id, m.contact_id, r.reply_text, 'recovery_unknown',
           'recovery send outcome unknown after restart', NULL, ?, '{}'
         FROM whatsapp_media_recovery r
         JOIN whatsapp_messages m ON m.message_id = r.provider_message_id
         WHERE r.recovery_state = 'claimed'`,
      ).run(now);
      this.db.prepare(
        `UPDATE whatsapp_messages
         SET processing_status = 'failed'
         WHERE message_id IN (
           SELECT provider_message_id FROM whatsapp_media_recovery WHERE recovery_state = 'claimed'
         )`,
      ).run();
      this.db.prepare(
        `UPDATE whatsapp_channel_audit
         SET lifecycle_state = 'failed', outbound_status = 'recovery_unknown', updated_at = ?
         WHERE provider_message_id IN (
           SELECT provider_message_id FROM whatsapp_media_recovery WHERE recovery_state = 'claimed'
         )`,
      ).run(now);
      this.db.prepare(
        `UPDATE whatsapp_media_recovery
         SET recovery_state = 'provider_notification_failed',
             error_text = COALESCE(error_text, 'recovery send outcome unknown after restart'),
             completed_at = ?, updated_at = ?
         WHERE recovery_state = 'claimed'`,
      ).run(now, now);
      this.db.prepare(
        `UPDATE whatsapp_messages
         SET processing_status = 'replied'
         WHERE processing_status = 'processing'
           AND EXISTS (
             SELECT 1 FROM whatsapp_channel_audit a
             WHERE a.provider_message_id = whatsapp_messages.message_id
               AND a.outbound_provider_id IS NOT NULL
               AND a.outbound_status IN ('sent', 'delivered', 'read', 'recovery_sent')
           )`,
      ).run();
      this.db.prepare(
        `UPDATE whatsapp_channel_audit
         SET lifecycle_state = 'replied', updated_at = ?
         WHERE lifecycle_state = 'forwarded'
           AND outbound_provider_id IS NOT NULL
           AND outbound_status IN ('sent', 'delivered', 'read', 'recovery_sent')`,
      ).run(now);
      this.db.prepare(
        `INSERT OR IGNORE INTO whatsapp_media_recovery (
           provider_message_id, recovery_kind, recovery_state, reply_text,
           created_at, updated_at
         )
         SELECT m.message_id,
           CASE WHEN NULLIF(TRIM(a.reply_text), '') IS NOT NULL
             THEN 'forwarded_reply' ELSE 'interrupted_failure' END,
           'pending',
           COALESCE(NULLIF(TRIM(a.reply_text), ''),
             '⚠️ I received your media, but processing was interrupted by a service restart. It was not sent to Ring again; please resend it.'),
           ?, ?
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_channel_audit a ON a.provider_message_id = m.message_id
         WHERE m.processing_status = 'processing'
           AND m.has_media = 1`,
      ).run(now, now);
      this.db.prepare(
        "UPDATE whatsapp_messages SET processing_status = 'interrupted' WHERE processing_status = 'processing'",
      ).run();
      this.db.prepare(
        `UPDATE whatsapp_channel_audit
         SET lifecycle_state = 'interrupted', updated_at = ?
         WHERE lifecycle_state = 'forwarded'
           AND EXISTS (
             SELECT 1 FROM whatsapp_messages m
             WHERE m.message_id = whatsapp_channel_audit.provider_message_id
               AND m.processing_status = 'interrupted'
           )`,
      ).run(now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
    if (status === "replied" || status === "failed" || status === "interrupted") {
      this.db
        .prepare(
          "UPDATE whatsapp_channel_audit SET lifecycle_state = ?, updated_at = ? WHERE provider_message_id = ?",
        )
        .run(status, Date.now(), messageId);
    }
  }

  recordChannelForwarding(input: WhatsAppChannelAuditInput): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO whatsapp_channel_audit (
         provider_message_id, tenant_id, sender_id, transcript_text, transcript_provenance,
         artifact_ref, artifact_sha256, downstream_destination, downstream_correlation_id,
         downstream_receipt_json, reply_text, lifecycle_state, forwarded_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'forwarded', ?, ?)
       ON CONFLICT(provider_message_id) DO UPDATE SET
         tenant_id=excluded.tenant_id,
         sender_id=excluded.sender_id,
         transcript_text=excluded.transcript_text,
         transcript_provenance=excluded.transcript_provenance,
         artifact_ref=excluded.artifact_ref,
         artifact_sha256=excluded.artifact_sha256,
         downstream_destination=excluded.downstream_destination,
         downstream_correlation_id=excluded.downstream_correlation_id,
         downstream_receipt_json=excluded.downstream_receipt_json,
         reply_text=excluded.reply_text,
         lifecycle_state='forwarded',
         updated_at=excluded.updated_at`,
    ).run(
      input.providerMessageId,
      input.tenantId,
      input.senderId,
      input.transcriptText ?? null,
      input.transcriptProvenance ?? null,
      input.artifactRef ?? null,
      input.artifactSha256 ?? null,
      input.downstreamDestination,
      input.downstreamCorrelationId ?? null,
      input.downstreamReceipt ? safeJson(input.downstreamReceipt) : null,
      boundedRecoveryReply(input.replyText),
      now, now,
    );
  }

  channelAudit(providerMessageId: string): WhatsAppChannelAuditRecord | null {
    const row = this.db.prepare(
      `SELECT provider_message_id AS providerMessageId, tenant_id AS tenantId,
         sender_id AS senderId, transcript_text AS transcriptText,
         transcript_provenance AS transcriptProvenance, artifact_ref AS artifactRef,
         artifact_sha256 AS artifactSha256, downstream_destination AS downstreamDestination,
         downstream_correlation_id AS downstreamCorrelationId,
         downstream_receipt_json AS downstreamReceiptJson, reply_text AS replyText,
         lifecycle_state AS lifecycleState,
         outbound_provider_id AS outboundProviderId, outbound_status AS outboundStatus,
         forwarded_at AS forwardedAt, updated_at AS updatedAt
       FROM whatsapp_channel_audit WHERE provider_message_id = ?`,
    ).get(providerMessageId) as
      | (Omit<WhatsAppChannelAuditRecord, "downstreamReceipt"> & { downstreamReceiptJson: string | null })
      | undefined;
    if (!row) return null;
    const { downstreamReceiptJson, ...record } = row;
    const mediaRecovery = this.mediaRecovery(providerMessageId);
    return {
      ...record,
      downstreamReceipt: downstreamReceiptJson
        ? (JSON.parse(downstreamReceiptJson) as Record<string, unknown>)
        : null,
      ...(mediaRecovery ? { mediaRecovery } : {}),
    };
  }

  claimInterruptedMediaRecovery(): WhatsAppMediaRecoveryClaim | null {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(
        `SELECT r.provider_message_id AS providerMessageId,
           r.recovery_kind AS kind, r.reply_text AS replyText,
           m.chat_id AS chatId, m.contact_id AS contactId
         FROM whatsapp_media_recovery r
         JOIN whatsapp_messages m ON m.message_id = r.provider_message_id
         WHERE r.recovery_state = 'pending'
         ORDER BY r.created_at ASC
         LIMIT 1`,
      ).get() as Omit<WhatsAppMediaRecoveryClaim, "state" | "claimedAt"> | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }
      const claimed = this.db.prepare(
        `UPDATE whatsapp_media_recovery
         SET recovery_state = 'claimed', claimed_at = ?, updated_at = ?
         WHERE provider_message_id = ? AND recovery_state = 'pending'`,
      ).run(now, now, row.providerMessageId).changes;
      this.db.exec("COMMIT");
      return claimed ? { ...row, state: "claimed", claimedAt: now } : null;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeInterruptedMediaRecovery(
    claim: WhatsAppMediaRecoveryClaim,
    outcome: { sentMessageId: string; raw?: unknown } | { error: string },
  ): void {
    const now = Date.now();
    const sent = "sentMessageId" in outcome;
    const recoveryState: WhatsAppMediaRecoveryState = sent
      ? claim.kind === "forwarded_reply" ? "recovered_replied" : "failure_notified"
      : "provider_notification_failed";
    const messageStatus = sent
      ? claim.kind === "forwarded_reply" ? "replied" : "failed_notified"
      : "failed";
    const outboundStatus = sent
      ? claim.kind === "forwarded_reply" ? "recovery_sent" : "recovery_notice_sent"
      : "recovery_failed";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `INSERT INTO whatsapp_outbound_audit (
           audit_id, message_id, chat_id, contact_id, body_text, status, error_text,
           sent_message_id, created_at, raw_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `whaudit_${randomUUID().replaceAll("-", "")}`,
        claim.providerMessageId,
        claim.chatId,
        claim.contactId,
        claim.replyText,
        outboundStatus,
        sent ? null : outcome.error,
        sent ? outcome.sentMessageId : null,
        now,
        safeJson(sent ? outcome.raw : {}),
      );
      this.db.prepare(
        `UPDATE whatsapp_media_recovery
         SET recovery_state = ?, outbound_provider_id = ?, error_text = ?,
             completed_at = ?, updated_at = ?
         WHERE provider_message_id = ? AND recovery_state = 'claimed'`,
      ).run(
        recoveryState,
        sent ? outcome.sentMessageId : null,
        sent ? null : outcome.error,
        now,
        now,
        claim.providerMessageId,
      );
      this.db.prepare("UPDATE whatsapp_messages SET processing_status = ? WHERE message_id = ?")
        .run(messageStatus, claim.providerMessageId);
      this.db.prepare(
        `UPDATE whatsapp_channel_audit
         SET lifecycle_state = ?, outbound_provider_id = ?, outbound_status = ?, updated_at = ?
         WHERE provider_message_id = ?`,
      ).run(
        sent && claim.kind === "forwarded_reply" ? "replied" : "failed",
        sent ? outcome.sentMessageId : null,
        outboundStatus,
        now,
        claim.providerMessageId,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  mediaRecovery(providerMessageId: string): WhatsAppMediaRecoveryRecord | null {
    return (this.db.prepare(
      `SELECT provider_message_id AS providerMessageId, recovery_kind AS kind,
         recovery_state AS state, reply_text AS replyText,
         outbound_provider_id AS outboundProviderId, error_text AS errorText,
         claimed_at AS claimedAt, completed_at AS completedAt,
         created_at AS createdAt, updated_at AS updatedAt
       FROM whatsapp_media_recovery WHERE provider_message_id = ?`,
    ).get(providerMessageId) as WhatsAppMediaRecoveryRecord | undefined) ?? null;
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
    if (input.messageId) {
      this.db.prepare(
        `UPDATE whatsapp_channel_audit
         SET outbound_provider_id = COALESCE(?, outbound_provider_id), outbound_status = ?, updated_at = ?
         WHERE provider_message_id = ?`,
      ).run(input.sentMessageId ?? null, input.status, Date.now(), input.messageId);
    }
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
    const channelAuditByMessage = new Map<string, WhatsAppChannelAuditRecord>();
    const mediaRecoveryByMessage = new Map<string, WhatsAppMediaRecoveryRecord>();
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
      for (const messageId of inboundMessageIds) {
        const audit = this.channelAudit(messageId);
        if (audit) channelAuditByMessage.set(messageId, audit);
        const recovery = this.mediaRecovery(messageId);
        if (recovery) mediaRecoveryByMessage.set(messageId, recovery);
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
      ...(row.direction === "inbound" && row.messageId && channelAuditByMessage.has(row.messageId)
        ? { channelAudit: channelAuditByMessage.get(row.messageId) }
        : {}),
      ...(row.direction === "inbound" && row.messageId && mediaRecoveryByMessage.has(row.messageId)
        ? { mediaRecovery: mediaRecoveryByMessage.get(row.messageId) }
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
