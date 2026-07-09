import { randomUUID } from "node:crypto";
import {
  normalizeWhatsAppIdentifier,
  senderIsAllowed,
} from "./whatsappConfig.js";

export type PhylaxChannel = "whatsapp" | "telegram";

export interface PhylaxChannelSettings {
  acceptAll: boolean;
  allowedSenders: string[];
  groupsEnabled: boolean;
  providerMode: "cloud" | "self_host_dev";
  testRecipient: string | null;
}

export interface PhylaxEvidence {
  kind: string;
  channel?: PhylaxChannel;
  chat_id?: string;
  mailbox_id?: string;
  sent_message_id?: string;
  media_id?: string;
  at: string;
}

export interface PhylaxToolResult {
  evidence: PhylaxEvidence[];
}

export class PhylaxSeamError extends Error {
  constructor(
    readonly code: "unauthorized" | "not_found" | "invalid_input" | "unavailable" | "invalid_receipt",
    message: string,
  ) {
    super(message);
    this.name = "PhylaxSeamError";
  }
}

export interface PhylaxMediaInput {
  mediaId?: string;
  mimeType?: string | null;
  fileName?: string | null;
  bytes?: Uint8Array | Buffer | string;
  url?: string;
  size?: number;
  meta?: Record<string, unknown>;
}

export interface PhylaxInboundEvent {
  channel: PhylaxChannel;
  chatId: string;
  contactId?: string | null;
  senderName?: string | null;
  isGroup?: boolean;
  text?: string | null;
  media?: PhylaxMediaInput | null;
  providerMessageId?: string | null;
  receivedAt?: number;
}

export interface RingMessageReceivedInput {
  channel: PhylaxChannel;
  chat_id: string;
  contact_id?: string | null;
  sender_name?: string | null;
  text?: string;
  media_id?: string;
  media_meta?: {
    mime_type?: string | null;
    file_name?: string | null;
    size?: number | null;
    provider_message_id?: string | null;
    source: "phylax";
  };
}

export interface RingMessageReceivedReceipt {
  mailbox_id?: string;
  evidence?: Array<{ kind?: string; mailbox_id?: string; mailboxId?: string; id?: string }>;
}

export interface PhylaxRingClient {
  messageReceived(input: RingMessageReceivedInput): Promise<RingMessageReceivedReceipt>;
}

export interface PhylaxDeliveryAdapter {
  send(input: { channel: PhylaxChannel; chatId: string; text: string; replyToMailboxId?: string | null }): Promise<{
    sentMessageId?: string | null;
  }>;
  deliveryStatus?(sentMessageId: string): Promise<PhylaxDeliveryStatus>;
}

export interface PhylaxDeliveryStatus {
  message_id: string;
  status: "unknown" | "queued" | "sent" | "delivered" | "read" | "failed";
  error?: string | null;
  at: string;
}

export interface PhylaxMediaRecord {
  media_id: string;
  mime_type: string | null;
  file_name: string | null;
  bytes_b64?: string;
  url?: string;
  size: number | null;
  meta: Record<string, unknown>;
}

export interface PhylaxPairingStatus {
  channel: PhylaxChannel;
  mode: PhylaxChannelSettings["providerMode"];
  state: "disabled" | "cloud" | "disconnected" | "pairing" | "connected" | "error";
  linked_number: string | null;
  qr_available: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mediaBytesToBase64(value: Uint8Array | Buffer | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return Buffer.from(value).toString("base64");
  return Buffer.from(value).toString("base64");
}

function mediaSize(input: PhylaxMediaInput): number | null {
  if (typeof input.size === "number" && Number.isFinite(input.size) && input.size >= 0) return input.size;
  if (input.bytes === undefined) return null;
  if (typeof input.bytes === "string") return Buffer.byteLength(input.bytes);
  return input.bytes.byteLength;
}

function mailboxIdFromReceipt(receipt: RingMessageReceivedReceipt): string | null {
  if (receipt.mailbox_id) return receipt.mailbox_id;
  for (const item of receipt.evidence ?? []) {
    if (item.mailbox_id) return item.mailbox_id;
    if (item.mailboxId) return item.mailboxId;
    if (item.kind === "mailbox_entry_created" && item.id) return item.id;
  }
  return null;
}

export class PhylaxGatewaySeam {
  private readonly media = new Map<string, PhylaxMediaRecord>();

  constructor(
    private readonly options: {
      settings: Pick<
        PhylaxChannelSettings,
        "acceptAll" | "allowedSenders" | "groupsEnabled" | "providerMode" | "testRecipient"
      >;
      ring: PhylaxRingClient;
      delivery: PhylaxDeliveryAdapter;
      linkedNumber?: string | null;
      connectionState?: "disabled" | "disconnected" | "pairing" | "connected" | "error";
    },
  ) {}

  async receiveInbound(event: PhylaxInboundEvent): Promise<PhylaxToolResult> {
    const text = event.text?.trim() ?? "";
    if (!event.chatId.trim()) throw new PhylaxSeamError("invalid_input", "chat_id is required");
    if (!text && !event.media) throw new PhylaxSeamError("invalid_input", "text or media is required");
    if (event.isGroup && !this.options.settings.groupsEnabled) {
      throw new PhylaxSeamError("unauthorized", "group messages are disabled for this channel");
    }
    const sender = event.contactId ?? event.chatId;
    if (!senderIsAllowed(sender, this.options.settings)) {
      throw new PhylaxSeamError("unauthorized", "sender is not allowed for this channel");
    }

    const media = event.media ? this.rememberMedia(event.media) : null;
    const receipt = await this.options.ring.messageReceived({
      channel: event.channel,
      chat_id: event.chatId,
      contact_id: event.contactId ?? event.chatId,
      sender_name: event.senderName ?? null,
      ...(text ? { text } : {}),
      ...(media
        ? {
            media_id: media.media_id,
            media_meta: {
              mime_type: media.mime_type,
              file_name: media.file_name,
              size: media.size,
              provider_message_id: event.providerMessageId ?? null,
              source: "phylax",
            },
          }
        : {}),
    });
    const mailboxId = mailboxIdFromReceipt(receipt);
    if (!mailboxId) {
      throw new PhylaxSeamError("invalid_receipt", "ring message_received returned no mailbox evidence");
    }
    return {
      evidence: [
        {
          kind: "ring_message_accepted",
          channel: event.channel,
          chat_id: event.chatId,
          mailbox_id: mailboxId,
          ...(media ? { media_id: media.media_id } : {}),
          at: nowIso(),
        },
      ],
    };
  }

  async sendToUser(input: {
    channel: PhylaxChannel;
    chatId: string;
    text: string;
    replyToMailboxId?: string | null;
  }): Promise<PhylaxToolResult> {
    const text = input.text;
    if (!input.chatId.trim()) throw new PhylaxSeamError("invalid_input", "chat_id is required");
    if (!text.trim()) throw new PhylaxSeamError("invalid_input", "text is required");
    const sent = await this.options.delivery.send({
      channel: input.channel,
      chatId: input.chatId,
      text,
      replyToMailboxId: input.replyToMailboxId ?? null,
    });
    if (!sent.sentMessageId) {
      throw new PhylaxSeamError("invalid_receipt", "delivery returned no sent message id");
    }
    return {
      evidence: [
        {
          kind: "message_sent",
          channel: input.channel,
          chat_id: input.chatId,
          sent_message_id: sent.sentMessageId,
          at: nowIso(),
        },
      ],
    };
  }

  async sendTestMessage(channel: PhylaxChannel, text = "Phylax test message"): Promise<PhylaxToolResult> {
    const recipient = this.options.settings.testRecipient?.trim();
    if (!recipient) throw new PhylaxSeamError("invalid_input", "test_recipient is not configured");
    return this.sendToUser({ channel, chatId: recipient, text });
  }

  getMedia(mediaId: string): PhylaxMediaRecord | { code: "not_found"; message: string; media_id: string } {
    const found = this.media.get(mediaId);
    if (!found) return { code: "not_found", message: "media handle not found", media_id: mediaId };
    return found;
  }

  async deliveryStatus(sentMessageId: string): Promise<PhylaxDeliveryStatus> {
    if (!sentMessageId.trim()) throw new PhylaxSeamError("invalid_input", "sent_message_id is required");
    if (!this.options.delivery.deliveryStatus) {
      return { message_id: sentMessageId, status: "unknown", at: nowIso() };
    }
    return this.options.delivery.deliveryStatus(sentMessageId);
  }

  pairingStatus(): PhylaxPairingStatus {
    const state = this.options.settings.providerMode === "cloud" ? "cloud" : (this.options.connectionState ?? "disconnected");
    return {
      channel: "whatsapp",
      mode: this.options.settings.providerMode,
      state,
      linked_number: normalizeWhatsAppIdentifier(this.options.linkedNumber) || null,
      qr_available: this.options.settings.providerMode === "self_host_dev",
    };
  }

  private rememberMedia(input: PhylaxMediaInput): PhylaxMediaRecord {
    const mediaId = input.mediaId?.trim() || `phylax_media_${randomUUID().replaceAll("-", "")}`;
    const record: PhylaxMediaRecord = {
      media_id: mediaId,
      mime_type: input.mimeType ?? null,
      file_name: input.fileName ?? null,
      ...(input.bytes !== undefined ? { bytes_b64: mediaBytesToBase64(input.bytes) } : {}),
      ...(input.url ? { url: input.url } : {}),
      size: mediaSize(input),
      meta: input.meta ?? {},
    };
    this.media.set(mediaId, record);
    return record;
  }
}
