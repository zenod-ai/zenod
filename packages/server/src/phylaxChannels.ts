import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
}

export interface PhylaxTenantRouteResolver {
  resolve(channel: PhylaxPortedChannel, sender: string): Promise<PhylaxTenantRoute | null> | PhylaxTenantRoute | null;
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
}

export interface PhylaxChannelTranscriber {
  transcribe(input: {
    tenantId: string;
    bytes: Uint8Array;
    mimeType: string | null;
    fileName: string | null;
  }): Promise<PhylaxTranscriptionReceipt>;
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
  };
}

export type PhylaxDownstreamCaller = (call: PhylaxDownstreamCall) => Promise<PeerToolResult>;

export interface PhylaxInboundReceipt {
  tenantId: string;
  sender: string;
  replyText: string;
  downstream: PeerToolResult;
  handoff: PhylaxDownstreamCall["handoff"];
  evidence: Array<{
    kind: "channel_message_forwarded";
    id: string;
    tenant_id: string;
    channel: PhylaxPortedChannel;
    downstream_url: string;
  }>;
}

export class PhylaxChannelError extends Error {
  constructor(
    readonly code: "unmatched_sender" | "invalid_input" | "downstream_error" | "delivery_error",
    message: string,
  ) {
    super(message);
    this.name = "PhylaxChannelError";
  }
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
    },
  ) {}

  async receive(input: PhylaxChannelInbound): Promise<PhylaxInboundReceipt> {
    const sender = normalizedSender(input.channel, input.sender);
    if (!sender || !input.chatId.trim()) {
      throw new PhylaxChannelError("invalid_input", "sender and chatId are required");
    }
    const route = await this.options.routes.resolve(input.channel, sender);
    if (!route) {
      throw new PhylaxChannelError("unmatched_sender", "sender is not registered to a Phylax tenant");
    }
    if (!route.downstreamUrl.trim() || !route.downstreamToken.trim()) {
      throw new PhylaxChannelError("downstream_error", "tenant downstream is not configured");
    }

    const artifactRef = input.media ? this.rememberArtifact(route.tenantId, input.media) : undefined;
    let transcription: PhylaxTranscriptionReceipt = input.transcription ?? {};
    if (!input.transcription && input.media?.bytes && this.options.transcriber) {
      try {
        transcription = await this.options.transcriber.transcribe({
          tenantId: route.tenantId,
          bytes: Buffer.from(input.media.bytes),
          mimeType: input.media.mimeType ?? null,
          fileName: input.media.fileName ?? null,
        });
      } catch (error) {
        transcription = {
          transcription_failed: {
            code: "unavailable",
            message: error instanceof Error ? error.message : "transcription failed",
          },
        };
      }
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
    const downstream = await (this.options.callDownstream ?? callRing)(call);
    if (downstream.isError) {
      throw new PhylaxChannelError("downstream_error", textFromResult(downstream) || "tenant downstream rejected the message");
    }
    const replyText = textFromResult(downstream);
    if (!replyText) throw new PhylaxChannelError("downstream_error", "tenant downstream returned no reply");
    return {
      tenantId: route.tenantId,
      sender,
      replyText,
      downstream,
      handoff,
      evidence: [{
        kind: "channel_message_forwarded",
        id: input.messageId?.trim() || `phylax_${randomUUID().replaceAll("-", "")}`,
        tenant_id: route.tenantId,
        channel: input.channel,
        downstream_url: route.downstreamUrl,
      }],
    };
  }

  private rememberArtifact(tenantId: string, media: NonNullable<PhylaxChannelInbound["media"]>): string | undefined {
    if (media.artifactRef?.trim()) return media.artifactRef.trim();
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
    return parsed.toString();
  }
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
