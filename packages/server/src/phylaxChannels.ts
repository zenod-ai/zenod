import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callPeerTool, type PeerToolResult } from "./peerClient.js";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";
import { normalizeTelegramEntry } from "./telegramConfig.js";

export type PhylaxPortedChannel = "whatsapp" | "telegram";

export interface PhylaxTenantRoute {
  tenantId: string;
  downstreamUrl: string;
  downstreamToken: string;
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
  tool: "chat_with_ring";
  arguments: {
    message: string;
    surface: "whatsapp" | "mcp";
    conversationKey: string;
  };
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
  };
}

export type PhylaxDownstreamCaller = (call: PhylaxDownstreamCall) => Promise<PeerToolResult>;

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
  failureCode: "downstream_unauthorized" | "downstream_rejected" | "downstream_unavailable" | "downstream_empty_reply";
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

function safeArtifactName(value: string | null | undefined): string {
  const safe = String(value ?? "media.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "media.bin";
}

function isAudioMedia(media: NonNullable<PhylaxChannelInbound["media"]>): boolean {
  if (media.mimeType?.toLowerCase().startsWith("audio/")) return true;
  return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(media.fileName?.trim() ?? "");
}

function handoffEnvelope(handoff: PhylaxDownstreamCall["handoff"], text: string): string {
  if (!handoff.artifact_ref && !handoff.transcription_failed) return text;
  return [
    text,
    "",
    "Phylax channel handoff:",
    JSON.stringify(handoff),
  ].filter(Boolean).join("\n");
}

export class PhylaxChannelsOrgan {
  constructor(
    private readonly options: {
      dataDir: string;
      routes: PhylaxTenantRouteResolver;
      transcriber?: PhylaxChannelTranscriber;
      callDownstream?: PhylaxDownstreamCaller;
      artifactUrl?: (tenantId: string, artifactId: string) => string;
      transcriptionDeadlineMs?: number;
      voiceJobDeadlineMs?: number;
    },
  ) {}

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
      throw new PhylaxChannelError("invalid_input", "a WhatsApp audio message with bytes and messageId is required");
    }
    const { sender, route } = await this.resolveInboundRoute(input.channel, input.sender, input.chatId);
    if (expectedTenantId && route.tenantId !== expectedTenantId) {
      throw new PhylaxChannelError("downstream_error", "tenant route changed before media processing");
    }
    const artifact = this.rememberArtifact(route.tenantId, input.media);
    if (!artifact?.path || !artifact.sha256) {
      throw new PhylaxChannelError("invalid_input", "voice artifact could not be persisted");
    }
    return {
      tenantId: route.tenantId,
      sender,
      chatId: input.chatId,
      messageId: input.messageId.trim(),
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
      throw new PhylaxChannelError("downstream_error", "tenant route changed before media processing");
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
      throw new PhylaxChannelError("invalid_input", "text or media is required");
    }
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
    };
    const call: PhylaxDownstreamCall = {
      route,
      tool: "chat_with_ring",
      arguments: {
        message: handoffEnvelope(handoff, text || "A channel artifact was received."),
        surface: input.channel === "whatsapp" ? "whatsapp" : "mcp",
        conversationKey: `${input.channel}:${sender}`,
      },
      handoff,
    };
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
      artifactRef: handoff.artifact_ref ?? null,
      artifactSha256: artifact?.sha256 ?? null,
      downstreamDestination: safeDownstreamDestination(route),
      downstreamCorrelationId: audit.correlationId,
      downstreamReceipt: audit.receipt,
      failureStage: "downstream",
      failureCode,
      timing: { transcriptionQueueWaitMs, transcriptionRuntimeMs, downstreamMs },
    });
    const downstreamStartedAt = Date.now();
    let downstream: PeerToolResult;
    try {
      downstream = await (this.options.callDownstream ?? callRing)(call);
    } catch (error) {
      const failureCode = downstreamFailureCode(error);
      if (failureCode === "downstream_unauthorized") {
        await this.reportDownstreamCredentialStatus(route, "rejected");
        throw downstreamCredentialRejectedError(
          failureAudit(Math.max(0, Date.now() - downstreamStartedAt), failureCode),
        );
      }
      throw new PhylaxChannelError(
        "downstream_error",
        error instanceof Error ? error.message : "tenant downstream request failed",
        failureAudit(Math.max(0, Date.now() - downstreamStartedAt), failureCode),
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
        await this.reportDownstreamCredentialStatus(route, "rejected");
        throw downstreamCredentialRejectedError(failureAudit(downstreamMs, failureCode, audit));
      }
      throw new PhylaxChannelError(
        "downstream_error",
        message,
        failureAudit(downstreamMs, failureCode, audit),
      );
    }
    const replyText = textFromResult(downstream);
    if (!replyText) {
      throw new PhylaxChannelError(
        "downstream_error",
        "tenant downstream returned no reply",
        failureAudit(downstreamMs, "downstream_empty_reply", audit),
      );
    }
    await this.reportDownstreamCredentialStatus(route, "healthy");
    return {
      tenantId: route.tenantId,
      sender,
      replyText,
      downstream,
      handoff,
      artifactSha256: artifact?.sha256 ?? null,
      downstreamDestination: safeDownstreamDestination(route),
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
        downstream_url: safeDownstreamOrigin(route),
        downstream_identity: safeDownstreamDestination(route),
      }],
    };
  }

  private async resolveInboundRoute(
    channel: PhylaxPortedChannel,
    senderValue: string,
    chatId: string,
  ): Promise<{ sender: string; route: PhylaxTenantRoute }> {
    const sender = normalizedSender(channel, senderValue);
    if (!sender || !chatId.trim()) {
      throw new PhylaxChannelError("invalid_input", "sender and chatId are required");
    }
    const route = await this.options.routes.resolve(channel, sender);
    if (!route) {
      throw new PhylaxChannelError("unmatched_sender", "sender is not registered to a Phylax tenant");
    }
    if (!route.downstreamUrl.trim() || !route.downstreamToken.trim()) {
      throw new PhylaxChannelError("downstream_error", "tenant downstream is not configured");
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
      throw new PhylaxChannelError("invalid_input", "artifact URL resolver is required for channel media");
    }
    const reference = this.options.artifactUrl(tenantId, file);
    let parsed: URL;
    try {
      parsed = new URL(reference);
    } catch {
      throw new PhylaxChannelError("invalid_input", "artifact_ref must be a unit-token-fetchable URL");
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new PhylaxChannelError("invalid_input", "artifact_ref must use https");
    }
    return { ref: parsed.toString(), path, sha256: createHash("sha256").update(media.bytes).digest("hex") };
  }
}

function downstreamCredentialRejectedError(audit: PhylaxFailureAudit): PhylaxChannelError {
  return new PhylaxChannelError(
    "downstream_error",
    "Your Ring connection needs attention. Open Phylax settings and replace the Ring MCP URL and bearer token, then retry.",
    audit,
  );
}
async function callRing(call: PhylaxDownstreamCall): Promise<PeerToolResult> {
  return callPeerTool(
    {
      name: `ring-${call.route.tenantId}`,
      url: call.route.downstreamUrl,
      token: call.route.downstreamToken,
      wallet: false,
    },
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
}
