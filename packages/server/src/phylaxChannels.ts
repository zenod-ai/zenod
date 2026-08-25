import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Ajv as AjvDraft7 } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import {
  callPeerTool,
  discoverPeerTools,
  type PeerDiscoveryResult,
  type PeerToolResult,
} from "./peerClient.js";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";
import { normalizeTelegramEntry } from "./telegramConfig.js";
import { appendPhylaxCaptureReceiptInvitation } from "./phylaxCaptureReceipt.js";
import {
  formatConversationTranscript,
  transcriptQueryFromToolArgs,
  type ConversationTranscriptReader,
} from "./conversationTranscript.js";
import { GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE } from "./mcpToolSchemas.js";
import type {
  PhylaxBindingArgumentSource,
  PhylaxTurnBindings,
  PhylaxTurnType,
} from "./phylaxTenantSettings.js";

export type PhylaxPortedChannel = "whatsapp" | "telegram";

export interface PhylaxTenantRoute {
  tenantId: string;
  downstreamUrl: string;
  downstreamToken: string;
  /** Ring authority scoped to assistant chat only; never used by capture tools. */
  assistantUrl?: string;
  assistantToken?: string;
  /** Tenant-owned mechanical dispatch table. The resolver must never substitute another tenant's defaults. */
  turnBindings?: PhylaxTurnBindings;
  /** Non-secret revision used only to reject stale in-flight health completions. */
  credentialRevision?: string;
}

export interface PhylaxTenantRouteResolver {
  resolve(channel: PhylaxPortedChannel, sender: string): Promise<PhylaxTenantRoute | null> | PhylaxTenantRoute | null;
  reportDownstreamCredentialStatus?(
    tenantId: string,
    credentialRevision: string,
    status: "healthy" | "rejected",
  ): Promise<boolean | void> | boolean | void;
}

export interface PhylaxChannelInbound {
  channel: PhylaxPortedChannel;
  sender: string;
  chatId: string;
  messageId?: string;
  /** Original provider timestamp normalized by the transport adapter. */
  senderTimestamp?: string;
  /** Provider message ID quoted by structural reply metadata; never inferred from text. */
  replyToMessageId?: string;
  text?: string;
  media?: {
    bytes?: Uint8Array | Buffer;
    artifactRef?: string;
    mimeType?: string | null;
    fileName?: string | null;
  };
  transcription?: PhylaxTranscriptionReceipt;
}

export interface PhylaxTranscriptionReceipt {
  text_transcript?: string;
  transcription_usage?: Record<string, unknown>;
  transcription_failed?: { code: string; message: string };
  transcription_source?: string;
  transcription_timing?: {
    queue_wait_ms?: number | null;
    runtime_ms?: number | null;
  };
}

export interface PhylaxChannelTranscriber {
  transcribe(input: {
    tenantId: string;
    bytes: Uint8Array;
    mimeType: string | null;
    fileName: string | null;
    signal: AbortSignal;
  }): Promise<PhylaxTranscriptionReceipt>;
}

export const DEFAULT_PHYLAX_VOICE_JOB_DEADLINE_MS = 2 * 60 * 60_000;
export const MAX_PHYLAX_VOICE_JOB_DEADLINE_MS = 4 * 60 * 60_000;

export function normalizePhylaxVoiceJobDeadlineMs(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? DEFAULT_PHYLAX_VOICE_JOB_DEADLINE_MS
    : Math.max(100, Math.min(value, MAX_PHYLAX_VOICE_JOB_DEADLINE_MS));
}

export interface PhylaxStagedVoice {
  tenantId: string;
  sender: string;
  chatId: string;
  messageId: string;
  replyToMessageId?: string | null;
  conversationKey: string;
  artifactRef: string;
  artifactPath: string;
  artifactSha256: string;
  mimeType: string | null;
  fileName: string | null;
  text: string;
}

export interface PhylaxDownstreamCall {
  route: PhylaxTenantRoute;
  tool: string;
  arguments: Record<string, unknown>;
  handoff: {
    sender: string;
    text_transcript?: string;
    artifact_ref?: string;
    artifact_mime_type?: string;
    artifact_file_name?: string;
    transcription_usage?: Record<string, unknown>;
    transcription_failed?: { code: string; message: string };
    transcription_source?: string;
    transcription_timing?: { queue_wait_ms?: number | null; runtime_ms?: number | null };
    reply_context?: { evidenceRef: string };
  };
}

export type PhylaxDownstreamCaller = (call: PhylaxDownstreamCall) => Promise<PeerToolResult>;
export type PhylaxDownstreamDiscoverer = (route: PhylaxTenantRoute) => Promise<PeerDiscoveryResult>;
export type PhylaxTerminalReceiptDelivery = (
  channel: PhylaxPortedChannel,
  recipient: string,
  text: string,
  captureProviderMessageId: string,
) => Promise<{ sentMessageId: string }>;

export type PhylaxTerminalReceiptRecovery = (
  channel: PhylaxPortedChannel,
  tenantId: string,
  captureProviderMessageId: string,
  recipient: string,
  text: string,
) => Promise<string | null> | string | null;

export interface PhylaxInboundReceipt {
  tenantId: string;
  sender: string;
  replyText: string;
  downstream: PeerToolResult;
  handoff: PhylaxDownstreamCall["handoff"];
  artifactSha256: string | null;
  downstreamDestination: string;
  downstreamCorrelationId: string | null;
  downstreamReceipt: Record<string, unknown> | null;
  timing: {
    transcriptionQueueWaitMs: number | null;
    transcriptionRuntimeMs: number | null;
    downstreamMs: number;
  };
  evidence: Array<{
    kind: "channel_message_forwarded";
    id: string;
    tenant_id: string;
    channel: PhylaxPortedChannel;
    downstream_url: string;
    downstream_identity: string;
  }>;
  /** Runtime invokes this only after the foreground provider reply is accepted. */
  afterReply?: () => void;
}

export interface PhylaxFailureAudit {
  tenantId: string;
  sender: string;
  transcriptText: string | null;
  transcriptProvenance: string | null;
  transcriptionFailureCode: string | null;
  artifactRef: string | null;
  artifactSha256: string | null;
  downstreamDestination: string;
  downstreamCorrelationId: string | null;
  downstreamReceipt: Record<string, unknown> | null;
  failureStage: "downstream";
  failureCode:
    | "downstream_unauthorized"
    | "downstream_rejected"
    | "downstream_unavailable"
    | "downstream_empty_reply"
    | "downstream_schema_drift"
    | "downstream_job_failed";
  timing: {
    transcriptionQueueWaitMs: number | null;
    transcriptionRuntimeMs: number | null;
    downstreamMs: number;
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read correlation only from the peer's typed envelope; reply prose is never inspected. */
function downstreamAudit(result: PeerToolResult): {
  correlationId: string | null;
  receipt: Record<string, unknown> | null;
} {
  const structured = objectValue(result.structuredContent);
  if (!structured) return { correlationId: null, receipt: null };
  const typedResult = objectValue(structured.result);
  const receipt = objectValue(structured.receipt) ?? objectValue(typedResult?.receipt) ?? typedResult;
  const correlation = structured.correlationId ?? structured.correlation_id
    ?? typedResult?.correlationId ?? typedResult?.correlation_id
    ?? receipt?.correlationId ?? receipt?.correlation_id;
  const correlationId = typeof correlation === "string" && correlation.trim()
    && !/:\/\//.test(correlation)
    && !/\b(?:bearer|authorization|api[_-]?key|token)\b/i.test(correlation)
    ? correlation.trim()
    : null;
  const safeReceipt = safeTypedReceipt(receipt ?? structured);
  return {
    correlationId,
    receipt: Object.keys(safeReceipt).length > 0 ? safeReceipt : null,
  };
}

function safeTypedReceipt(receipt: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ["id", "kind", "status", "code", "mailbox_id", "receipt_id"] as const) {
    const value = receipt[key];
    if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
    if (
      typeof value === "string"
      && !/:\/\//.test(value)
      && !/\b(?:bearer|authorization|api[_-]?key|token)\b/i.test(value)
    ) safe[key] = value;
  }
  if (Array.isArray(receipt.evidence)) {
    safe.evidence = receipt.evidence
      .map(objectValue)
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => safeTypedReceipt(item));
  }
  return safe;
}

function safeDownstreamDestination(route: PhylaxTenantRoute): string {
  try {
    const parsed = new URL(route.downstreamUrl);
    return `${parsed.host}#tenant:${route.tenantId}`;
  } catch {
    return `configured-downstream#tenant:${route.tenantId}`;
  }
}

function safeDownstreamOrigin(route: PhylaxTenantRoute): string {
  try {
    return new URL(route.downstreamUrl).origin;
  } catch {
    return "configured-downstream";
  }
}

export class PhylaxChannelError extends Error {
  constructor(
    readonly code: "unmatched_sender" | "invalid_input" | "downstream_error" | "delivery_error",
    message: string,
    readonly audit?: PhylaxFailureAudit,
    readonly retryDisposition: "idempotent_capture" | null = null,
  ) {
    super(message);
    this.name = "PhylaxChannelError";
  }
}

function downstreamFailureCode(error: unknown): PhylaxFailureAudit["failureCode"] {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:unauthori[sz]ed|forbidden|401|403)\b/i.test(message)
    ? "downstream_unauthorized"
    : "downstream_unavailable";
}

export function phylaxWhatsAppPaths(dataDir: string) {
  const root = join(dataDir, "whatsapp");
  return {
    root,
    session: join(root, "session"),
    store: join(root, "whatsapp.sqlite"),
    artifacts: join(root, "artifacts"),
  };
}

function normalizedSender(channel: PhylaxPortedChannel, sender: string): string {
  return channel === "whatsapp"
    ? normalizeWhatsAppIdentifier(sender)
    : normalizeTelegramEntry(sender);
}

function textFromResult(result: PeerToolResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

/** Keep support correlation in typed audit fields, never in customer prose. */
export function sanitizePhylaxCustomerReply(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^\s*(?:internal\s+)?(?:correlation|job|ticket|execution)[ _-]?id\s*[:#=]/i.test(line))
    .map((line) => line.replace(
      /\s*(?:\(|[-–—;,])?\s*\b(?:internal\s+test\s+)?(?:correlation|job|ticket|execution)[ _-]?id\b\s*[:#=]?\s*[A-Za-z0-9._:@/-]+\)?/gi,
      "",
    ).trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeArtifactName(value: string | null | undefined): string {
  const safe = String(value ?? "media.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "media.bin";
}

function isAudioMedia(media: NonNullable<PhylaxChannelInbound["media"]>): boolean {
  if (media.mimeType?.toLowerCase().startsWith("audio/")) return true;
  return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(media.fileName?.trim() ?? "");
}

function handoffEnvelope(handoff: PhylaxDownstreamCall["handoff"], text: string): string {
  if (!handoff.artifact_ref && !handoff.transcription_failed && !handoff.reply_context) return text;
  return [
    text,
    "",
    ...(handoff.reply_context
      ? [
          "Phylax trusted host metadata: the quoted capture evidenceRef is a memory source reference, not an async job identifier. Preserve it exactly for the connected read-only memory Q&A capability's contextRefs input.",
        ]
      : []),
    "Phylax channel handoff:",
    JSON.stringify(handoff),
  ].filter(Boolean).join("\n");
}

const DEFAULT_CAPTURE_FOREGROUND_DEADLINE_MS = 4 * 60_000;
const DEFAULT_CAPTURE_POLL_INTERVAL_MS = 1_000;
const CAPTURE_PENDING_REPLY = "I’m still filing this memory — I’ll confirm here when it is saved.";
const CHAT_PENDING_REPLY = "I’m still working on that — I’ll reply here when it is finished.";

interface PhylaxCaptureJob {
  tenantId: string;
  channel: PhylaxPortedChannel;
  providerMessageId: string;
  sender: string;
  chatId: string;
  conversationKey: string;
  tool: string;
  jobId: string;
  state: "polling" | "done" | "error";
  receiptText: string | null;
  evidenceRef: string | null;
  deliveredAt: number | null;
}

/**
 * D14's local custody seam. This deliberately mirrors W-P4's durable
 * BEGIN-IMMEDIATE claim/update pattern; Zenod's idempotencyKey remains the
 * authority for the network ambiguity between dispatch and this commit.
 */
class PhylaxCaptureJournal {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 30000;

      CREATE TABLE IF NOT EXISTS phylax_capture_jobs (
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        tool TEXT NOT NULL,
        job_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('polling', 'done', 'error')),
        receipt_text TEXT,
        evidence_ref TEXT,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, channel, provider_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_phylax_capture_jobs_pending
        ON phylax_capture_jobs(state, updated_at);

      CREATE TABLE IF NOT EXISTS phylax_capture_conversations (
        tenant_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, conversation_key)
      );

      CREATE TABLE IF NOT EXISTS phylax_capture_receipts (
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        provider_receipt_message_id TEXT NOT NULL,
        capture_provider_message_id TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, channel, provider_receipt_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_phylax_capture_receipts_lookup
        ON phylax_capture_receipts(tenant_id, channel, conversation_key, provider_receipt_message_id);
    `);
  }

  accepted(input: Omit<PhylaxCaptureJob, "state" | "receiptText" | "evidenceRef" | "deliveredAt">): PhylaxCaptureJob {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `INSERT INTO phylax_capture_jobs (
           tenant_id, channel, provider_message_id, sender, chat_id,
           conversation_key, tool, job_id, state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'polling', ?, ?)
         ON CONFLICT (tenant_id, channel, provider_message_id) DO UPDATE SET
           sender = excluded.sender,
           chat_id = excluded.chat_id,
           conversation_key = excluded.conversation_key,
           tool = excluded.tool,
           job_id = excluded.job_id,
           state = CASE
             WHEN phylax_capture_jobs.state = 'done' THEN 'done'
             ELSE 'polling'
           END,
           updated_at = excluded.updated_at`,
      ).run(
        input.tenantId,
        input.channel,
        input.providerMessageId,
        input.sender,
        input.chatId,
        input.conversationKey,
        input.tool,
        input.jobId,
        now,
        now,
      );
      const stored = this.get(input.tenantId, input.channel, input.providerMessageId);
      this.db.exec("COMMIT");
      if (!stored) throw new Error("capture job was not persisted");
      return stored;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(tenantId: string, channel: PhylaxPortedChannel, providerMessageId: string): PhylaxCaptureJob | null {
    const row = this.db.prepare(
      `SELECT tenant_id, channel, provider_message_id, sender, chat_id,
              conversation_key, tool, job_id, state, receipt_text,
              evidence_ref, delivered_at
       FROM phylax_capture_jobs
       WHERE tenant_id = ? AND channel = ? AND provider_message_id = ?`,
    ).get(tenantId, channel, providerMessageId) as Record<string, unknown> | undefined;
    return row ? captureJobFromRow(row) : null;
  }

  pending(): PhylaxCaptureJob[] {
    return (this.db.prepare(
      `SELECT tenant_id, channel, provider_message_id, sender, chat_id,
              conversation_key, tool, job_id, state, receipt_text,
              evidence_ref, delivered_at
       FROM phylax_capture_jobs
       WHERE state = 'polling'
       ORDER BY created_at`,
    ).all() as unknown as Record<string, unknown>[]).map(captureJobFromRow);
  }

  unindexedTerminalReceipts(): PhylaxCaptureJob[] {
    return (this.db.prepare(
      `SELECT jobs.tenant_id, jobs.channel, jobs.provider_message_id, jobs.sender, jobs.chat_id,
              jobs.conversation_key, jobs.tool, jobs.job_id, jobs.state, jobs.receipt_text,
              jobs.evidence_ref, jobs.delivered_at
       FROM phylax_capture_jobs AS jobs
       WHERE jobs.state = 'done'
         AND jobs.evidence_ref IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM phylax_capture_receipts AS receipts
           WHERE receipts.tenant_id = jobs.tenant_id
             AND receipts.channel = jobs.channel
             AND receipts.capture_provider_message_id = jobs.provider_message_id
         )
       ORDER BY jobs.created_at`,
    ).all() as unknown as Record<string, unknown>[]).map(captureJobFromRow);
  }

  terminal(
    job: PhylaxCaptureJob,
    state: "done" | "error",
    receiptText: string,
    evidenceRef: string | null,
  ): void {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(
        `UPDATE phylax_capture_jobs
         SET state = ?, receipt_text = ?, evidence_ref = ?, updated_at = ?
         WHERE tenant_id = ? AND channel = ? AND provider_message_id = ?`,
      ).run(
        state,
        receiptText,
        evidenceRef,
        now,
        job.tenantId,
        job.channel,
        job.providerMessageId,
      );
      if (state === "done" && evidenceRef) {
        this.db.prepare(
          `INSERT INTO phylax_capture_conversations (
             tenant_id, conversation_key, evidence_ref, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT (tenant_id, conversation_key) DO UPDATE SET
             evidence_ref = excluded.evidence_ref,
             updated_at = excluded.updated_at`,
        ).run(job.tenantId, job.conversationKey, evidenceRef, now);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  claimDelivery(job: PhylaxCaptureJob): boolean {
    const result = this.db.prepare(
      `UPDATE phylax_capture_jobs
       SET delivered_at = ?, updated_at = ?
       WHERE tenant_id = ? AND channel = ? AND provider_message_id = ?
         AND delivered_at IS NULL`,
    ).run(Date.now(), Date.now(), job.tenantId, job.channel, job.providerMessageId);
    return Number(result.changes) === 1;
  }

  lastEvidenceRef(tenantId: string, conversationKey: string): string | null {
    const row = this.db.prepare(
      `SELECT evidence_ref FROM phylax_capture_conversations
       WHERE tenant_id = ? AND conversation_key = ?`,
    ).get(tenantId, conversationKey) as { evidence_ref?: unknown } | undefined;
    return typeof row?.evidence_ref === "string" ? row.evidence_ref : null;
  }

  recordReceiptDelivery(
    tenantId: string,
    channel: PhylaxPortedChannel,
    captureProviderMessageId: string,
    providerReceiptMessageId: string,
  ): boolean {
    const job = this.get(tenantId, channel, captureProviderMessageId);
    const receiptId = providerReceiptMessageId.trim();
    if (job?.state !== "done" || !job.evidenceRef || !receiptId) return false;
    this.db.prepare(
      `INSERT INTO phylax_capture_receipts (
         tenant_id, channel, conversation_key, provider_receipt_message_id,
         capture_provider_message_id, evidence_ref, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, channel, provider_receipt_message_id) DO NOTHING`,
    ).run(
      tenantId,
      channel,
      job.conversationKey,
      receiptId,
      captureProviderMessageId,
      job.evidenceRef,
      Date.now(),
    );
    return true;
  }

  evidenceForReceipt(
    tenantId: string,
    channel: PhylaxPortedChannel,
    conversationKey: string,
    providerReceiptMessageId: string,
  ): string | null {
    const row = this.db.prepare(
      `SELECT evidence_ref FROM phylax_capture_receipts
       WHERE tenant_id = ? AND channel = ? AND conversation_key = ?
         AND provider_receipt_message_id = ?`,
    ).get(
      tenantId,
      channel,
      conversationKey,
      providerReceiptMessageId,
    ) as { evidence_ref?: unknown } | undefined;
    return typeof row?.evidence_ref === "string" ? row.evidence_ref : null;
  }

  close(): void {
    this.db.close();
  }
}

function captureJobFromRow(row: Record<string, unknown>): PhylaxCaptureJob {
  return {
    tenantId: String(row.tenant_id),
    channel: row.channel === "telegram" ? "telegram" : "whatsapp",
    providerMessageId: String(row.provider_message_id),
    sender: String(row.sender),
    chatId: String(row.chat_id),
    conversationKey: String(row.conversation_key),
    tool: String(row.tool),
    jobId: String(row.job_id),
    state: row.state === "done" ? "done" : row.state === "error" ? "error" : "polling",
    receiptText: typeof row.receipt_text === "string" ? row.receipt_text : null,
    evidenceRef: typeof row.evidence_ref === "string" ? row.evidence_ref : null,
    deliveredAt: typeof row.delivered_at === "number" ? row.delivered_at : null,
  };
}

function captureTurnType(input: PhylaxChannelInbound): PhylaxTurnType {
  if (input.transcription || (input.media && isAudioMedia(input.media))) return "voice_note";
  return input.media ? "media" : "text";
}

type PhylaxIngestMediaType = "audio" | "screenshot" | "image" | "pdf" | "document" | "link";

function ingestMediaTypeFromHandoff(
  handoff: PhylaxDownstreamCall["handoff"],
): PhylaxIngestMediaType | undefined {
  if (!handoff.artifact_ref) return undefined;
  const mimeType = handoff.artifact_mime_type?.trim().toLowerCase() ?? "";
  const filename = handoff.artifact_file_name?.trim().toLowerCase() ?? "";
  if (
    mimeType.startsWith("audio/")
    || /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/.test(filename)
  ) return "audio";
  if (mimeType === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (
    mimeType === "text/uri-list"
    || /\.(?:url|webloc)$/.test(filename)
  ) return "link";
  if (mimeType.startsWith("image/") || /\.(?:avif|bmp|gif|heic|jpeg|jpg|png|webp)$/.test(filename)) {
    return /(?:^|[-_. ])screen(?:shot|[-_. ]?capture)(?:[-_. ]|$)/.test(filename)
      ? "screenshot"
      : "image";
  }
  return "document";
}

function valueFromBindingSource(
  source: PhylaxBindingArgumentSource,
  input: {
    transcript: string;
    sender: string;
    chatId: string;
    message: string;
    surface: "whatsapp" | "mcp";
    conversationKey: string;
    artifactUrl?: string;
    mediaType?: PhylaxIngestMediaType;
    filename?: string;
    channel: PhylaxPortedChannel;
    providerMessageId?: string;
    senderTimestamp?: string;
  },
): unknown {
  switch (source.source) {
    case "transcript": return input.transcript;
    case "sender": return input.sender;
    case "chatId": return input.chatId;
    case "artifactUrl": return input.artifactUrl;
    case "mediaType": return input.mediaType;
    case "filename": return input.filename;
    case "channel": return input.channel;
    case "providerMessageId": return input.providerMessageId;
    case "senderTimestamp": return input.senderTimestamp;
    case "constant": return source.value;
    case "message": return input.message;
    case "surface": return input.surface;
    case "conversationKey": return input.conversationKey;
  }
}

function isDurableChannelTool(tool: string): tool is "chat_with_zenod" | "store_memory" | "ingest_memory" {
  return tool === "chat_with_zenod" || tool === "store_memory" || tool === "ingest_memory";
}

function pendingReplyForTool(tool: string): string {
  return tool === "chat_with_zenod" ? CHAT_PENDING_REPLY : CAPTURE_PENDING_REPLY;
}

function acceptedJobId(result: PeerToolResult): string | null {
  const structured = objectValue(result.structuredContent);
  const candidate = structured?.ticket_id ?? structured?.jobId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function jobState(result: PeerToolResult): string | null {
  const structured = objectValue(result.structuredContent);
  const candidate = structured?.state ?? structured?.status;
  return typeof candidate === "string" ? candidate.toLowerCase() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function terminalCaptureReceipt(result: PeerToolResult, expectedJobId: string, tool: string): {
  state: "done" | "error";
  text: string;
  evidenceRef: string | null;
} | null {
  const state = jobState(result);
  if (!state || !["done", "error", "interrupted"].includes(state)) return null;
  const structured = objectValue(result.structuredContent);
  const responseJobId = structured?.ticket_id ?? structured?.jobId;
  if (responseJobId !== expectedJobId) return null;
  const payload = objectValue(structured?.result);
  if (state !== "done" || result.isError || !payload) {
    return {
      state: "error",
      text: tool === "chat_with_zenod"
        ? "⚠️ I could not confirm the result of that request. Please check your Zenod activity before trying it again."
        : "⚠️ Zenod could not finish saving that memory. Please try again.",
      evidenceRef: null,
    };
  }
  if (tool === "chat_with_zenod") {
    const stored = objectValue(payload.stored);
    const evidenceRef = typeof stored?.evidenceRef === "string" && stored.evidenceRef.trim()
      ? stored.evidenceRef.trim()
      : null;
    const reply = sanitizePhylaxCustomerReply(typeof payload.text === "string" ? payload.text : "");
    return {
      state: "done",
      text: reply || "Zenod finished the request, but returned no reply text.",
      evidenceRef,
    };
  }
  const digest = objectValue(payload.digest);
  const rawArtifact = objectValue(payload.rawArtifact);
  const evidenceValue = payload.evidenceRef ?? digest?.evidenceRef;
  const evidenceRef = typeof evidenceValue === "string" && evidenceValue.trim()
    ? evidenceValue.trim()
    : null;
  const pages = stringArray(payload.pagesTouched ?? digest?.pagesTouched);
  const filingValue = payload.filing ?? digest?.filing;
  const filing = ["filed", "uncertain", "inbox", "pending"].includes(String(filingValue))
    ? String(filingValue)
    : typeof payload.question === "string"
      ? "inbox"
      : "filed";
  const recap = typeof payload.recap === "string" && payload.recap.trim()
    ? payload.recap.trim()
    : typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
    : "Your memory has been filed.";
  return {
    state: "done",
    evidenceRef,
    text: sanitizePhylaxCustomerReply(appendPhylaxCaptureReceiptInvitation([
      "Saved ✓",
      `Recap: ${recap}`,
      ...(typeof rawArtifact?.archiveUrl === "string" && rawArtifact.archiveUrl.trim()
        ? ["Media: archived"]
        : []),
      ...(pages.length > 0 ? [`Filed: ${pages.join(", ")}`] : []),
      ...(filing === "uncertain"
        ? [`Filing: saved to ${pages[0] ?? "the selected page"} with an open filing question logged in the page (review anytime).`]
        : filing === "inbox"
          ? ["Filing: saved to Inbox; the filing question is logged in the note."]
          : []),
    ].join("\n"))),
  };
}

export class PhylaxChannelsOrgan {
  private readonly captureJournal: PhylaxCaptureJournal;
  private terminalReceiptDelivery: PhylaxTerminalReceiptDelivery | null = null;
  private terminalReceiptRecovery: PhylaxTerminalReceiptRecovery | null = null;
  private readonly backgroundPolls = new Map<string, Promise<void>>();
  private closing = false;

  constructor(
    private readonly options: {
      dataDir: string;
      routes: PhylaxTenantRouteResolver;
      transcriber?: PhylaxChannelTranscriber;
      callDownstream?: PhylaxDownstreamCaller;
      discoverDownstream?: PhylaxDownstreamDiscoverer;
      artifactUrl?: (tenantId: string, artifactId: string) => string;
      transcriptionDeadlineMs?: number;
      voiceJobDeadlineMs?: number;
      captureForegroundDeadlineMs?: number;
      capturePollIntervalMs?: number;
      sleep?: (milliseconds: number) => Promise<void>;
    },
  ) {
    this.captureJournal = new PhylaxCaptureJournal(options.dataDir);
  }

  setTerminalReceiptDelivery(delivery: PhylaxTerminalReceiptDelivery): void {
    this.terminalReceiptDelivery = delivery;
  }

  setTerminalReceiptRecovery(recovery: PhylaxTerminalReceiptRecovery): void {
    this.terminalReceiptRecovery = recovery;
  }

  lastCaptureEvidenceRef(tenantId: string, conversationKey: string): string | null {
    return this.captureJournal.lastEvidenceRef(tenantId, conversationKey);
  }

  captureReceiptReady(
    channel: PhylaxPortedChannel,
    tenantId: string,
    providerMessageId: string,
  ): boolean {
    const job = this.captureJournal.get(tenantId, channel, providerMessageId);
    return job?.state === "done" && Boolean(job.evidenceRef);
  }

  recordCaptureReceiptDelivery(
    channel: PhylaxPortedChannel,
    tenantId: string,
    captureProviderMessageId: string,
    providerReceiptMessageId: string,
  ): boolean {
    return this.captureJournal.recordReceiptDelivery(
      tenantId,
      channel,
      captureProviderMessageId,
      providerReceiptMessageId,
    );
  }

  async resumePendingCaptures(): Promise<void> {
    await this.reconcileTerminalReceiptDeliveries();
    for (const job of this.captureJournal.pending()) {
      this.startBackgroundPoll(job);
    }
  }

  private async reconcileTerminalReceiptDeliveries(): Promise<void> {
    if (!this.terminalReceiptRecovery) return;
    for (const job of this.captureJournal.unindexedTerminalReceipts()) {
      try {
        const sentMessageId = await this.terminalReceiptRecovery(
          job.channel,
          job.tenantId,
          job.providerMessageId,
          job.channel === "telegram" ? job.chatId : job.sender,
          job.receiptText ?? "",
        );
        if (sentMessageId?.trim()) {
          this.captureJournal.recordReceiptDelivery(
            job.tenantId,
            job.channel,
            job.providerMessageId,
            sentMessageId,
          );
        }
      } catch (error) {
        console.error(`[phylax] failed to reconcile capture receipt ${job.providerMessageId}:`, error);
      }
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.backgroundPolls.values());
    this.captureJournal.close();
  }

  private callDownstream(call: PhylaxDownstreamCall): Promise<PeerToolResult> {
    return (this.options.callDownstream ?? callConfiguredPeer)(call);
  }

  private discoverDownstream(route: PhylaxTenantRoute): Promise<PeerDiscoveryResult> {
    return (this.options.discoverDownstream ?? discoverConfiguredPeer)(route);
  }

  private async validateBoundCall(call: PhylaxDownstreamCall): Promise<{ supportsIdempotencyKey: boolean }> {
    const discovery = await this.discoverDownstream(call.route);
    if (discovery.tools !== "ready") {
      throw new Error(`downstream schema discovery failed: ${discovery.error ?? "tools/list unavailable"}`);
    }
    const spec = discovery.specs.find((candidate) => candidate.mcp === call.tool);
    if (!spec) throw new Error(`configured tool "${call.tool}" is not advertised by the tenant downstream`);
    const schema = typeof spec.inputSchema === "object" ? spec.inputSchema : { type: "object" };
    const dialect = "$schema" in schema && typeof schema.$schema === "string"
      ? schema.$schema
      : "";
    const isDraft7 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/.test(dialect);
    const validator = isDraft7
      ? new AjvDraft7({ allErrors: true, strict: false })
      : new Ajv2020({ allErrors: true, strict: false });
    const validationSchema = isDraft7
      ? { ...schema, $schema: "http://json-schema.org/draft-07/schema#" }
      : schema;
    const validate = validator.compile(validationSchema);
    if (!validate(call.arguments)) {
      const detail = validate.errors
        ?.map((error: { instancePath: string; message?: string }) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; ");
      throw new Error(`configured mapping no longer matches "${call.tool}" input schema${detail ? `: ${detail}` : ""}`);
    }
    const properties = objectValue((schema as Record<string, unknown>).properties);
    return { supportsIdempotencyKey: Boolean(properties?.idempotencyKey) };
  }

  private async pollCapture(
    job: PhylaxCaptureJob,
    route: PhylaxTenantRoute,
    handoff: PhylaxDownstreamCall["handoff"],
    deadlineAt: number | null,
  ): Promise<{ result: PeerToolResult; receipt: ReturnType<typeof terminalCaptureReceipt> } | null> {
    const interval = Math.max(1, this.options.capturePollIntervalMs ?? DEFAULT_CAPTURE_POLL_INTERVAL_MS);
    const maxTransientBackoff = Math.max(interval, 30_000);
    const sleep = this.options.sleep ?? ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
      }));
    const boundedSleep = async (milliseconds: number) => {
      const remaining = deadlineAt === null
        ? milliseconds
        : Math.max(0, deadlineAt - Date.now());
      if (remaining > 0) await sleep(Math.min(milliseconds, remaining));
    };
    let transientFailures = 0;
    for (;;) {
      if (this.closing) return null;
      if (deadlineAt !== null && Date.now() >= deadlineAt) return null;
      const pendingPoll = Promise.resolve().then(() => this.callDownstream({
        route,
        tool: "get_task_result",
        arguments: { ticket_id: job.jobId },
        handoff,
      }));
      const observedPoll = pendingPoll.then(
        (result) => ({ kind: "result" as const, result }),
        () => ({ kind: "transient_error" as const }),
      );
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const attempt = deadlineAt === null
        ? await observedPoll
        : await Promise.race([
            observedPoll,
            new Promise<{ kind: "deadline" }>((resolve) => {
              const remaining = Math.max(0, deadlineAt - Date.now());
              deadlineTimer = setTimeout(() => resolve({ kind: "deadline" }), remaining);
              deadlineTimer.unref?.();
            }),
          ]).finally(() => {
            if (deadlineTimer) clearTimeout(deadlineTimer);
          });
      if (attempt.kind === "deadline") return null;
      if (attempt.kind === "transient_error") {
        transientFailures += 1;
        await boundedSleep(Math.min(
          interval * (2 ** Math.min(transientFailures - 1, 10)),
          maxTransientBackoff,
        ));
        continue;
      }
      const result = attempt.result;
      const terminal = terminalCaptureReceipt(result, job.jobId, job.tool);
      if (terminal) {
        this.captureJournal.terminal(job, terminal.state, terminal.text, terminal.evidenceRef);
        return { result, receipt: terminal };
      }
      if (result.isError) {
        transientFailures += 1;
        await boundedSleep(Math.min(
          interval * (2 ** Math.min(transientFailures - 1, 10)),
          maxTransientBackoff,
        ));
        continue;
      }
      transientFailures = 0;
      await boundedSleep(interval);
    }
  }

  private startBackgroundPoll(job: PhylaxCaptureJob): void {
    const key = `${job.tenantId}\0${job.channel}\0${job.providerMessageId}`;
    if (this.backgroundPolls.has(key)) return;
    const polling = (async () => {
      try {
        const route = await this.options.routes.resolve(job.channel, job.sender);
        if (!route || route.tenantId !== job.tenantId) {
          throw new Error("tenant route is unavailable while resuming capture");
        }
        const completed = await this.pollCapture(job, route, { sender: job.sender }, null);
        if (!completed || !completed.receipt) return;
        const current = this.captureJournal.get(job.tenantId, job.channel, job.providerMessageId);
        if (!current || current.deliveredAt !== null || !this.terminalReceiptDelivery) return;
        // W-P4 convention: claim the provider boundary durably before the send;
        // a crash after this point is ambiguous and must not duplicate a reply.
        if (!this.captureJournal.claimDelivery(job)) return;
        const delivery = await this.terminalReceiptDelivery(
          job.channel,
          job.channel === "telegram" ? job.chatId : job.sender,
          completed.receipt.text,
          job.providerMessageId,
        );
        if (completed.receipt.state === "done" && completed.receipt.evidenceRef) {
          this.captureJournal.recordReceiptDelivery(
            job.tenantId,
            job.channel,
            job.providerMessageId,
            delivery.sentMessageId,
          );
        }
      } catch (error) {
        console.error(`[phylax] capture poll ${job.jobId} failed:`, error);
      }
    })().finally(() => this.backgroundPolls.delete(key));
    this.backgroundPolls.set(key, polling);
  }

  private async reportDownstreamCredentialStatus(
    route: PhylaxTenantRoute,
    status: "healthy" | "rejected",
  ): Promise<void> {
    if (!route.credentialRevision) return;
    try {
      await this.options.routes.reportDownstreamCredentialStatus?.(
        route.tenantId,
        route.credentialRevision,
        status,
      );
    } catch {
      // Health persistence must never turn a completed downstream call into a duplicate-prone retry.
    }
  }

  async tenantIdFor(channel: PhylaxPortedChannel, senderValue: string, chatId: string): Promise<string> {
    const { route } = await this.resolveInboundRoute(channel, senderValue, chatId);
    return route.tenantId;
  }

  /**
   * Establish custody before any duration probe or transcription work starts.
   * The returned path is local-only queue state; only artifactRef crosses the
   * downstream seam.
   */
  async stageVoice(input: PhylaxChannelInbound, expectedTenantId?: string): Promise<PhylaxStagedVoice> {
    if (input.channel !== "whatsapp" || !input.messageId?.trim() || !input.media?.bytes || !isAudioMedia(input.media)) {
      throw new PhylaxChannelError("invalid_input", "Zenod could not read that voice note. Please try again.");
    }
    const { sender, route } = await this.resolveInboundRoute(input.channel, input.sender, input.chatId);
    if (expectedTenantId && route.tenantId !== expectedTenantId) {
      throw new PhylaxChannelError("downstream_error", "Zenod could not finish processing that message. Please try again.");
    }
    const artifact = this.rememberArtifact(route.tenantId, input.media);
    if (!artifact?.path || !artifact.sha256) {
      throw new PhylaxChannelError("invalid_input", "Zenod could not retain that voice note safely. Please try again.");
    }
    return {
      tenantId: route.tenantId,
      sender,
      chatId: input.chatId,
      messageId: input.messageId.trim(),
      replyToMessageId: input.replyToMessageId?.trim() || null,
      conversationKey: `whatsapp:${sender}`,
      artifactRef: artifact.ref,
      artifactPath: artifact.path,
      artifactSha256: artifact.sha256,
      mimeType: input.media.mimeType ?? null,
      fileName: input.media.fileName ?? null,
      text: input.text?.trim() ?? "",
    };
  }

  async transcribeStagedVoice(
    voice: Pick<PhylaxStagedVoice, "tenantId" | "mimeType" | "fileName"> & { bytes: Uint8Array },
    signal: AbortSignal,
  ): Promise<PhylaxTranscriptionReceipt> {
    if (!this.options.transcriber) {
      return { transcription_failed: { code: "disabled", message: "tenant transcription is disabled" } };
    }
    if (signal.aborted) throw signal.reason ?? new Error("voice transcription cancelled");
    const deadlineMs = normalizePhylaxVoiceJobDeadlineMs(this.options.voiceJobDeadlineMs);
    const controller = new AbortController();
    const externalAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", externalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("voice transcription safety deadline exceeded")), deadlineMs);
    timer.unref?.();
    try {
      return await this.options.transcriber.transcribe({
        tenantId: voice.tenantId,
        bytes: voice.bytes,
        mimeType: voice.mimeType,
        fileName: voice.fileName,
        signal: controller.signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        transcription_failed: {
          code: controller.signal.aborted ? "timeout" : "unavailable",
          message: controller.signal.aborted
            ? `transcription exceeded the ${deadlineMs}ms safety deadline`
            : error instanceof Error ? error.message : "transcription failed",
        },
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", externalAbort);
    }
  }

  async forwardStagedVoice(
    voice: PhylaxStagedVoice,
    transcription: PhylaxTranscriptionReceipt,
  ): Promise<PhylaxInboundReceipt> {
    return this.receive({
      channel: "whatsapp",
      sender: voice.sender,
      chatId: voice.chatId,
      messageId: voice.messageId,
      ...(voice.replyToMessageId ? { replyToMessageId: voice.replyToMessageId } : {}),
      text: voice.text,
      media: {
        artifactRef: voice.artifactRef,
        mimeType: voice.mimeType,
        fileName: voice.fileName,
      },
      transcription,
    }, voice.tenantId);
  }

  async receive(input: PhylaxChannelInbound, expectedTenantId?: string): Promise<PhylaxInboundReceipt> {
    const { sender, route } = await this.resolveInboundRoute(input.channel, input.sender, input.chatId);
    if (expectedTenantId && route.tenantId !== expectedTenantId) {
      throw new PhylaxChannelError("downstream_error", "Zenod could not finish processing that message. Please try again.");
    }

    const artifact = input.media ? this.rememberArtifact(route.tenantId, input.media) : undefined;
    const artifactRef = artifact?.ref;
    let transcription: PhylaxTranscriptionReceipt = input.transcription ?? {};
    let transcriptionQueueWaitMs = typeof input.transcription?.transcription_timing?.queue_wait_ms === "number"
      && Number.isFinite(input.transcription.transcription_timing.queue_wait_ms)
      ? Math.max(0, Math.round(input.transcription.transcription_timing.queue_wait_ms))
      : null;
    let transcriptionRuntimeMs = typeof input.transcription?.transcription_timing?.runtime_ms === "number"
      && Number.isFinite(input.transcription.transcription_timing.runtime_ms)
      ? Math.max(0, Math.round(input.transcription.transcription_timing.runtime_ms))
      : null;
    if (!input.transcription && input.media?.bytes && isAudioMedia(input.media) && this.options.transcriber) {
      const transcriptionStartedAt = Date.now();
      const configuredDeadline = this.options.transcriptionDeadlineMs ?? 60_000;
      const deadlineMs = Number.isFinite(configuredDeadline)
        ? Math.max(100, Math.min(configuredDeadline, 300_000))
        : 60_000;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        transcription = await Promise.race([
          this.options.transcriber.transcribe({
            tenantId: route.tenantId,
            bytes: Buffer.from(input.media.bytes),
            mimeType: input.media.mimeType ?? null,
            fileName: input.media.fileName ?? null,
            signal: controller.signal,
          }),
          new Promise<PhylaxTranscriptionReceipt>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve({
                transcription_failed: {
                  code: "timeout",
                  message: `transcription exceeded the ${deadlineMs}ms deadline`,
                },
              });
            }, deadlineMs);
            timer.unref?.();
          }),
        ]);
      } catch (error) {
        transcription = {
          transcription_failed: {
            code: controller.signal.aborted ? "timeout" : "unavailable",
            message: error instanceof Error ? error.message : "transcription failed",
          },
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
      const observedTranscriptionMs = Math.max(0, Date.now() - transcriptionStartedAt);
      const reportedQueueWait = transcription.transcription_timing?.queue_wait_ms;
      const reportedRuntime = transcription.transcription_timing?.runtime_ms;
      transcriptionQueueWaitMs = typeof reportedQueueWait === "number" && Number.isFinite(reportedQueueWait)
        ? Math.max(0, Math.round(reportedQueueWait))
        : null;
      transcriptionRuntimeMs = typeof reportedRuntime === "number" && Number.isFinite(reportedRuntime)
        ? Math.max(0, Math.round(reportedRuntime))
        : Math.max(0, observedTranscriptionMs - (transcriptionQueueWaitMs ?? 0));
    }
    const text = transcription.text_transcript?.trim() || input.text?.trim() || "";
    if (!text && !artifactRef && !transcription.transcription_failed) {
      throw new PhylaxChannelError("invalid_input", "Please send text, a voice note, or supported media.");
    }
    const conversationKey = `${input.channel}:${sender}`;
    const turnType = captureTurnType(input);
    const quotedProviderMessageId = input.replyToMessageId?.trim() ?? "";
    const replyEvidenceRef = input.channel === "whatsapp"
      && quotedProviderMessageId
      && (turnType === "text" || turnType === "voice_note")
      ? this.captureJournal.evidenceForReceipt(
          route.tenantId,
          input.channel,
          conversationKey,
          quotedProviderMessageId,
        )
      : null;
    const handoff: PhylaxDownstreamCall["handoff"] = {
      sender,
      ...(text ? { text_transcript: text } : {}),
      ...(artifactRef ? { artifact_ref: artifactRef } : {}),
      ...(artifactRef && input.media?.mimeType ? { artifact_mime_type: input.media.mimeType } : {}),
      ...(artifactRef && input.media?.fileName ? { artifact_file_name: input.media.fileName } : {}),
      ...(transcription.transcription_usage ? { transcription_usage: transcription.transcription_usage } : {}),
      ...(transcription.transcription_failed ? { transcription_failed: transcription.transcription_failed } : {}),
      ...(transcription.transcription_source ? { transcription_source: transcription.transcription_source } : {}),
      ...(transcription.transcription_timing ? { transcription_timing: transcription.transcription_timing } : {}),
      ...(replyEvidenceRef ? { reply_context: { evidenceRef: replyEvidenceRef } } : {}),
    };
    const auditHandoff: PhylaxDownstreamCall["handoff"] = handoff.artifact_ref
      ? {
          ...handoff,
          artifact_ref: artifact?.sha256 ? `sha256:${artifact.sha256}` : "transport-artifact",
        }
      : handoff;
    const message = handoffEnvelope(handoff, text || "A channel artifact was received.");
    const surface: "whatsapp" | "mcp" = input.channel === "whatsapp" ? "whatsapp" : "mcp";
    const binding = replyEvidenceRef
      ? route.turnBindings?.text
      : route.turnBindings?.[turnType];
    const ingestMediaType = ingestMediaTypeFromHandoff(handoff);
    const bindingInput = {
      // A tenant may map its Ring text field from either `message` or
      // `transcript`. Both must carry the structural evidence ref for a known
      // receipt reply; the raw transcript remains available in `handoff`.
      transcript: replyEvidenceRef ? message : text,
      sender,
      chatId: input.chatId,
      message,
      surface,
      conversationKey,
      ...(handoff.artifact_ref ? { artifactUrl: handoff.artifact_ref } : {}),
      ...(handoff.artifact_file_name ? { filename: handoff.artifact_file_name } : {}),
      ...(ingestMediaType ? { mediaType: ingestMediaType } : {}),
      channel: input.channel,
      ...(input.messageId ? { providerMessageId: input.messageId } : {}),
      senderTimestamp: input.senderTimestamp ?? new Date().toISOString(),
    };
    const selectedRoute = binding?.tool === "chat_with_ring"
      ? assistantRoute(route)
      : route;
    const call: PhylaxDownstreamCall = binding
      ? {
          route: selectedRoute,
          tool: binding.tool,
          arguments: Object.fromEntries(
            Object.entries(binding.argumentMappings).flatMap(([field, source]) => {
              const value = valueFromBindingSource(source, bindingInput);
              if (value === undefined) {
                throw new PhylaxChannelError(
                  "invalid_input",
                  "Zenod could not process that message because the channel configuration needs attention.",
                );
              }
              return [[field, value]];
            }),
          ),
          handoff,
        }
      : {
          route: selectedRoute,
          tool: "chat_with_zenod",
          arguments: { message, surface, conversationKey },
          handoff,
        };
    const providerMessageId = input.messageId?.trim();
    if ((call.tool === "store_memory" || call.tool === "ingest_memory") && !providerMessageId) {
      throw new PhylaxChannelError(
        "invalid_input",
        "Zenod could not establish a safe delivery identity for that message. Please try again.",
      );
    }
    if ((call.tool === "store_memory" || call.tool === "ingest_memory") && providerMessageId) {
      call.arguments.idempotencyKey = `${route.tenantId}:${input.channel}:${providerMessageId}`;
    }
    if (call.tool === "ingest_memory" && text && call.arguments.contentHint === undefined) {
      call.arguments.contentHint = text;
    }
    if (call.tool === "ingest_memory" && input.senderTimestamp && call.arguments.senderTimestamp === undefined) {
      call.arguments.senderTimestamp = input.senderTimestamp;
    }
    const failureAudit = (
      downstreamMs: number,
      failureCode: PhylaxFailureAudit["failureCode"],
      audit: { correlationId: string | null; receipt: Record<string, unknown> | null } = {
        correlationId: null,
        receipt: null,
      },
    ): PhylaxFailureAudit => ({
      tenantId: route.tenantId,
      sender,
      transcriptText: handoff.text_transcript ?? null,
      transcriptProvenance: handoff.transcription_source ?? (input.media ? "whatsapp-media" : "whatsapp-text"),
      transcriptionFailureCode: handoff.transcription_failed?.code ?? null,
      artifactRef: auditHandoff.artifact_ref ?? null,
      artifactSha256: artifact?.sha256 ?? null,
      downstreamDestination: safeDownstreamDestination(call.route),
      downstreamCorrelationId: audit.correlationId,
      downstreamReceipt: audit.receipt,
      failureStage: "downstream",
      failureCode,
      timing: { transcriptionQueueWaitMs, transcriptionRuntimeMs, downstreamMs },
    });
    const downstreamStartedAt = Date.now();
    let downstream: PeerToolResult;
    let backgroundCaptureJob: PhylaxCaptureJob | null = null;
    // Chat becomes durable only when the discovered, version-coherent Zenod
    // schema explicitly advertises idempotencyKey. Legacy/custom unbound
    // assistants remain synchronous and are never sent an invented argument.
    let durableChat = false;
    try {
      if (binding) {
        try {
          const validation = await this.validateBoundCall(call);
          if (call.tool === "chat_with_zenod" && providerMessageId && validation.supportsIdempotencyKey) {
            call.arguments.idempotencyKey = `${route.tenantId}:${input.channel}:${providerMessageId}`;
            durableChat = true;
          }
        } catch (error) {
          throw new PhylaxChannelError(
            "downstream_error",
            "Zenod could not process that message because the channel configuration needs attention.",
            failureAudit(
              Math.max(0, Date.now() - downstreamStartedAt),
              "downstream_schema_drift",
            ),
          );
        }
      }
      const durableCall = isDurableChannelTool(call.tool) && (call.tool !== "chat_with_zenod" || durableChat);
      const existing = durableCall && providerMessageId
        ? this.captureJournal.get(route.tenantId, input.channel, providerMessageId)
        : null;
      if (existing?.state === "done" && existing.receiptText) {
        downstream = {
          content: [{ type: "text", text: existing.receiptText }],
          structuredContent: {
            ticket_id: existing.jobId,
            jobId: existing.jobId,
            state: "done",
            result: {
              ...(existing.evidenceRef ? { evidenceRef: existing.evidenceRef } : {}),
            },
          },
        };
      } else if (existing?.state === "error" && existing.receiptText) {
        downstream = {
          isError: true,
          content: [{ type: "text", text: existing.receiptText }],
          structuredContent: {
            ticket_id: existing.jobId,
            jobId: existing.jobId,
            state: "error",
            error: { code: "job_failed", message: existing.receiptText },
          },
        };
      } else if (existing) {
        const deadline = Date.now() + Math.max(
          1,
          this.options.captureForegroundDeadlineMs ?? DEFAULT_CAPTURE_FOREGROUND_DEADLINE_MS,
        );
        const completed = await this.pollCapture(existing, route, handoff, deadline);
        if (completed?.receipt) {
          downstream = {
            ...completed.result,
            content: [{ type: "text", text: completed.receipt.text }],
            ...(completed.receipt.state === "error" ? { isError: true } : {}),
          };
        } else {
          downstream = {
            content: [{ type: "text", text: pendingReplyForTool(call.tool) }],
            structuredContent: {
              ticket_id: existing.jobId,
              jobId: existing.jobId,
              state: "polling",
            },
          };
          backgroundCaptureJob = existing;
        }
      } else {
        downstream = await this.callDownstream(call);
        const jobId = durableCall && !downstream.isError
          ? acceptedJobId(downstream)
          : null;
        if (durableCall && !downstream.isError && !jobId) {
          // A version-coherent Zenod surface advertises the durable contract and
          // must return a canonical ticket. Never fall back to a second,
          // mutation-capable synchronous call after that contract is selected.
          throw new Error(`${call.tool} returned no canonical ticket_id; channel request cannot be polled safely`);
        }
        if (jobId && providerMessageId) {
          // Synchronous SQLite commit happens before the first await/poll.
          const job = this.captureJournal.accepted({
            tenantId: route.tenantId,
            channel: input.channel,
            providerMessageId,
            sender,
            chatId: input.chatId,
            conversationKey,
            tool: call.tool,
            jobId,
          });
          const deadline = Date.now() + Math.max(
            1,
            this.options.captureForegroundDeadlineMs ?? DEFAULT_CAPTURE_FOREGROUND_DEADLINE_MS,
          );
          const completed = await this.pollCapture(job, route, handoff, deadline);
          if (completed?.receipt) {
            downstream = {
              ...completed.result,
              content: [{ type: "text", text: completed.receipt.text }],
              ...(completed.receipt.state === "error" ? { isError: true } : {}),
            };
          } else {
            downstream = {
              ...downstream,
              content: [{ type: "text", text: pendingReplyForTool(call.tool) }],
            };
            backgroundCaptureJob = job;
          }
        }
      }
    } catch (error) {
      if (error instanceof PhylaxChannelError) throw error;
      const failureCode = downstreamFailureCode(error);
      if (failureCode === "downstream_unauthorized") {
        await this.reportDownstreamCredentialStatus(call.route, "rejected");
        throw downstreamCredentialRejectedError(
          failureAudit(Math.max(0, Date.now() - downstreamStartedAt), failureCode),
          call.tool === "chat_with_ring" ? "assistant" : "memory",
          call.tool === "store_memory" && Boolean(providerMessageId),
        );
      }
      throw new PhylaxChannelError(
        "downstream_error",
        "Zenod could not process that message. Please try again.",
        failureAudit(Math.max(0, Date.now() - downstreamStartedAt), failureCode),
        call.tool === "store_memory" && providerMessageId ? "idempotent_capture" : null,
      );
    }
    const downstreamMs = Math.max(0, Date.now() - downstreamStartedAt);
    const audit = downstreamAudit(downstream);
    if (downstream.isError) {
      const message = textFromResult(downstream) || "tenant downstream rejected the message";
      const failureCode = downstreamFailureCode(message) === "downstream_unauthorized"
        ? "downstream_unauthorized"
        : "downstream_rejected";
      if (failureCode === "downstream_unauthorized") {
        await this.reportDownstreamCredentialStatus(call.route, "rejected");
        throw downstreamCredentialRejectedError(
          failureAudit(downstreamMs, failureCode, audit),
          call.tool === "chat_with_ring" ? "assistant" : "memory",
          call.tool === "store_memory" && Boolean(providerMessageId),
        );
      }
      throw new PhylaxChannelError(
        "downstream_error",
        "Zenod could not process that message. Please try again.",
        failureAudit(downstreamMs, failureCode, audit),
      );
    }
    const replyText = sanitizePhylaxCustomerReply(textFromResult(downstream));
    if (!replyText) {
      throw new PhylaxChannelError(
        "downstream_error",
        "Zenod finished the request but returned no reply. Please try again.",
        failureAudit(downstreamMs, "downstream_empty_reply", audit),
      );
    }
    await this.reportDownstreamCredentialStatus(call.route, "healthy");
    return {
      tenantId: route.tenantId,
      sender,
      replyText,
      downstream,
      handoff: auditHandoff,
      artifactSha256: artifact?.sha256 ?? null,
      downstreamDestination: safeDownstreamDestination(call.route),
      downstreamCorrelationId: audit.correlationId,
      downstreamReceipt: audit.receipt,
      timing: {
        transcriptionQueueWaitMs,
        transcriptionRuntimeMs,
        downstreamMs,
      },
      evidence: [{
        kind: "channel_message_forwarded",
        id: input.messageId?.trim() || `phylax_${randomUUID().replaceAll("-", "")}`,
        tenant_id: route.tenantId,
        channel: input.channel,
        downstream_url: safeDownstreamOrigin(call.route),
        downstream_identity: safeDownstreamDestination(call.route),
      }],
      ...(backgroundCaptureJob
        ? { afterReply: () => this.startBackgroundPoll(backgroundCaptureJob) }
        : {}),
    };
  }

  private async resolveInboundRoute(
    channel: PhylaxPortedChannel,
    senderValue: string,
    chatId: string,
  ): Promise<{ sender: string; route: PhylaxTenantRoute }> {
    const sender = normalizedSender(channel, senderValue);
    if (!sender || !chatId.trim()) {
      throw new PhylaxChannelError("invalid_input", "Zenod could not identify this conversation.");
    }
    const route = await this.options.routes.resolve(channel, sender);
    if (!route) {
      throw new PhylaxChannelError("unmatched_sender", "This channel is not connected to a Zenod account.");
    }
    if (!route.downstreamUrl.trim() || !route.downstreamToken.trim()) {
      throw new PhylaxChannelError("downstream_error", "Your Zenod connection needs attention. Open Zenod settings and reconnect it.");
    }
    return { sender, route };
  }

  private rememberArtifact(
    tenantId: string,
    media: NonNullable<PhylaxChannelInbound["media"]>,
  ): { ref: string; path: string | null; sha256: string | null } | undefined {
    if (media.artifactRef?.trim()) {
      return {
        ref: media.artifactRef.trim(),
        path: null,
        sha256: media.bytes ? createHash("sha256").update(media.bytes).digest("hex") : null,
      };
    }
    if (!media.bytes) return undefined;
    const paths = phylaxWhatsAppPaths(this.options.dataDir);
    const tenantDir = join(paths.artifacts, tenantId);
    mkdirSync(tenantDir, { recursive: true });
    const file = `${randomUUID()}-${safeArtifactName(media.fileName)}`;
    const path = join(tenantDir, file);
    writeFileSync(path, Buffer.from(media.bytes), { flag: "wx", mode: 0o600 });
    if (!this.options.artifactUrl) {
      throw new PhylaxChannelError("invalid_input", "Zenod could not prepare that media safely. Please try again.");
    }
    const reference = this.options.artifactUrl(tenantId, file);
    let parsed: URL;
    try {
      parsed = new URL(reference);
    } catch {
      throw new PhylaxChannelError("invalid_input", "Zenod could not prepare that media safely. Please try again.");
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new PhylaxChannelError("invalid_input", "Zenod could not prepare that media safely. Please try again.");
    }
    return { ref: parsed.toString(), path, sha256: createHash("sha256").update(media.bytes).digest("hex") };
  }
}

function downstreamCredentialRejectedError(
  audit: PhylaxFailureAudit,
  _target: "memory" | "assistant",
  retryableCapture: boolean,
): PhylaxChannelError {
  return new PhylaxChannelError(
    "downstream_error",
    "Your Zenod connection needs attention. Open Zenod settings and reconnect it.",
    audit,
    retryableCapture ? "idempotent_capture" : null,
  );
}

function assistantRoute(route: PhylaxTenantRoute): PhylaxTenantRoute {
  if (!route.assistantUrl?.trim() || !route.assistantToken?.trim()) {
    throw new PhylaxChannelError(
      "downstream_error",
      "The connected assistant needs attention. Open its settings and reconnect it.",
    );
  }
  return {
    tenantId: route.tenantId,
    downstreamUrl: route.assistantUrl,
    downstreamToken: route.assistantToken,
    turnBindings: route.turnBindings,
  };
}

function configuredPeer(route: PhylaxTenantRoute) {
  return {
    name: `phylax-memory-${route.tenantId}`,
    url: route.downstreamUrl,
    token: route.downstreamToken,
    wallet: false,
  } as const;
}

async function discoverConfiguredPeer(route: PhylaxTenantRoute): Promise<PeerDiscoveryResult> {
  return discoverPeerTools(configuredPeer(route));
}

async function callConfiguredPeer(call: PhylaxDownstreamCall): Promise<PeerToolResult> {
  return callPeerTool(
    configuredPeer(call.route),
    call.tool,
    call.arguments,
  );
}

export interface PhylaxDeliveryReceipt {
  channel: PhylaxPortedChannel;
  recipient: string;
  sentMessageId: string;
  status: "sent" | "delivered" | "read" | "queued";
  at: string;
}

export interface PhylaxTenantDelivery {
  send(channel: PhylaxPortedChannel, recipient: string, text: string): Promise<PhylaxDeliveryReceipt>;
  status(): Promise<Record<string, unknown>> | Record<string, unknown>;
  notify?(text: string): Promise<PhylaxDeliveryReceipt[]>;
  /** Tenant-filtered reader backed by Phylax's authoritative transport store. */
  readConversationTranscript?: ConversationTranscriptReader;
}

function deliveryToolResult(receipts: PhylaxDeliveryReceipt[]) {
  if (receipts.length === 0) {
    throw new PhylaxChannelError("delivery_error", "channel returned no delivery receipt");
  }
  return {
    content: [{ type: "text" as const, text: receipts.map((item) => `${item.channel}:${item.sentMessageId}:${item.status}`).join("\n") }],
    structuredContent: {
      status: "ok",
      receipts,
      evidence: receipts.map((item) => ({
        kind: "message_delivery",
        id: item.sentMessageId,
        channel: item.channel,
        recipient: item.recipient,
        status: item.status,
        at: item.at,
      })),
    },
  };
}

/** Register through createUnit's instrumented server; never bypass conduct middleware. */
export function registerPhylaxChannelTools(server: McpServer, delivery: PhylaxTenantDelivery): void {
  server.registerTool(
    "send_message",
    {
      title: "Send a channel message",
      description: "Send one WhatsApp or Telegram message and return its provider delivery receipt.",
      inputSchema: {
        channel: z.enum(["whatsapp", "telegram"]),
        recipient: z.string().min(1),
        text: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ channel, recipient, text }) => deliveryToolResult([await delivery.send(channel, recipient, text)]),
  );
  server.registerTool(
    "notify",
    {
      title: "Notify through configured channels",
      description: "Send a tenant notification through configured channel preferences and return every delivery receipt.",
      inputSchema: { text: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ text }) => {
      if (!delivery.notify) throw new PhylaxChannelError("delivery_error", "tenant notification preferences are not configured");
      return deliveryToolResult(await delivery.notify(text));
    },
  );
  server.registerTool(
    "channel_status",
    {
      title: "Read channel status",
      description: "Read tenant-scoped WhatsApp and Telegram connection health.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const status = await delivery.status();
      return { content: [{ type: "text" as const, text: JSON.stringify(status) }], structuredContent: { status } };
    },
  );
  if (delivery.readConversationTranscript) {
    server.registerTool(
      "get_recent_conversation_transcript",
      {
        title: "Get recent channel transcript",
        description: "Read the tenant-scoped authoritative WhatsApp transcript from Phylax transport custody.",
        inputSchema: GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ windowMinutes, contactId, chatId, messageId, limit }) => {
        const query = transcriptQueryFromToolArgs({ windowMinutes, contactId, chatId, messageId, limit });
        const entries = delivery.readConversationTranscript!(query);
        return {
          content: [{ type: "text" as const, text: formatConversationTranscript(entries) }],
          structuredContent: { entries, count: entries.length, sinceMs: query.sinceMs, windowMinutes: query.windowMinutes },
        };
      },
    );
  }
}
