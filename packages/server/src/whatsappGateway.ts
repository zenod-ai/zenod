import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import type { BrainEngine } from "zenod";
import type { Settings } from "./settings.js";
import { transcribeAudio } from "./transcribe.js";
import {
  maskPhoneNumber,
  normalizeWhatsAppIdentifier,
  senderIsAllowed,
  type WhatsAppSettings,
} from "./whatsappConfig.js";
import { WhatsAppStore, type WhatsAppInboundEvent } from "./whatsappStore.js";

export type WhatsAppConnectionState = "disabled" | "disconnected" | "pairing" | "connected" | "error";

export interface WhatsAppStatus {
  enabled: boolean;
  state: WhatsAppConnectionState;
  linkedNumber: string | null;
  lastActivity: number | null;
  lastError: string | null;
  qr: string | null;
  allowedSenders: string[];
  groupsEnabled: boolean;
  acceptAll: boolean;
}

export interface SocketLike {
  ev: {
    on(event: "connection.update", listener: (update: Record<string, unknown>) => void): void;
    on(event: "messages.upsert", listener: (update: { messages: WAMessage[]; type: string }) => void): void;
  };
  user?: { id?: string | null } | null;
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string | null } } | undefined>;
  end?(error?: Error): void;
}

export type SocketFactory = (sessionDir: string) => Promise<SocketLike>;

function normalizedJid(value: unknown): string {
  if (!value) return "";
  return String(value).replace(/:.*@/, "@");
}

function contentFromMessage(message: WAMessage): Record<string, unknown> {
  const root = (message.message ?? {}) as Record<string, unknown>;
  const ephemeral = root.ephemeralMessage as { message?: Record<string, unknown> } | undefined;
  if (ephemeral?.message) return ephemeral.message;
  const viewOnce = root.viewOnceMessage as { message?: Record<string, unknown> } | undefined;
  if (viewOnce?.message) return viewOnce.message;
  const viewOnceV2 = root.viewOnceMessageV2 as { message?: Record<string, unknown> } | undefined;
  if (viewOnceV2?.message) return viewOnceV2.message;
  const documentWithCaption = root.documentWithCaptionMessage as { message?: Record<string, unknown> } | undefined;
  if (documentWithCaption?.message) return documentWithCaption.message;
  return root;
}

function textField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function extractBodyAndMedia(content: Record<string, unknown>): Omit<
  WhatsAppInboundEvent,
  "messageId" | "chatId" | "senderId" | "senderName" | "chatName" | "isGroup" | "timestamp" | "raw"
> | null {
  if (typeof content.conversation === "string") {
    return {
      body: content.conversation,
      hasMedia: false,
      mediaType: null,
      mimeType: null,
      fileName: null,
      mediaRaw: null,
    };
  }
  const extended = content.extendedTextMessage as { text?: string } | undefined;
  if (extended?.text) {
    return {
      body: extended.text,
      hasMedia: false,
      mediaType: null,
      mimeType: null,
      fileName: null,
      mediaRaw: null,
    };
  }
  const image = content.imageMessage as { caption?: string; mimetype?: string } | undefined;
  if (image) {
    return {
      body: image.caption ?? "",
      hasMedia: true,
      mediaType: "image",
      mimeType: image.mimetype ?? null,
      fileName: null,
      mediaRaw: image,
    };
  }
  const video = content.videoMessage as { caption?: string; mimetype?: string } | undefined;
  if (video) {
    return {
      body: video.caption ?? "",
      hasMedia: true,
      mediaType: "video",
      mimeType: video.mimetype ?? null,
      fileName: null,
      mediaRaw: video,
    };
  }
  const audio = content.audioMessage as { mimetype?: string; ptt?: boolean } | undefined;
  if (audio) {
    return {
      body: "",
      hasMedia: true,
      mediaType: audio.ptt ? "ptt" : "audio",
      mimeType: audio.mimetype ?? null,
      fileName: null,
      mediaRaw: audio,
    };
  }
  const document = content.documentMessage as { caption?: string; mimetype?: string; fileName?: string } | undefined;
  if (document) {
    return {
      body: document.caption ?? "",
      hasMedia: true,
      mediaType: "document",
      mimeType: document.mimetype ?? null,
      fileName: document.fileName ?? null,
      mediaRaw: document,
    };
  }
  return null;
}

export function eventFromBaileysMessage(message: WAMessage): WhatsAppInboundEvent | null {
  const messageId = textField(message.key.id);
  const chatId = normalizedJid(message.key.remoteJid);
  if (!messageId || !chatId || !message.message) return null;
  if (chatId.includes("status")) return null;
  if (message.key.fromMe) return null;

  const senderId = normalizedJid(message.key.participant || chatId);
  const content = contentFromMessage(message);
  const extracted = extractBodyAndMedia(content);
  if (!extracted) return null;
  if (!extracted.body && !extracted.hasMedia) return null;

  return {
    messageId,
    chatId,
    senderId,
    senderName: textField(message.pushName, normalizeWhatsAppIdentifier(senderId) || senderId),
    chatName: textField(message.pushName, normalizeWhatsAppIdentifier(chatId) || chatId),
    isGroup: chatId.endsWith("@g.us"),
    timestamp: message.messageTimestamp,
    body: extracted.body,
    hasMedia: extracted.hasMedia,
    mediaType: extracted.mediaType,
    mimeType: extracted.mimeType,
    fileName: extracted.fileName,
    mediaRaw: extracted.mediaRaw,
    raw: message,
  };
}

async function defaultSocketFactory(sessionDir: string): Promise<SocketLike> {
  await mkdir(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: process.env.WHATSAPP_LOG_LEVEL ?? "silent" }),
    printQRInTerminal: false,
    browser: ["Zenod WhatsApp", "Chrome", "120.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: "" }),
  }) as WASocket;
  socket.ev.on("creds.update", saveCreds);
  return socket;
}

async function streamToBuffer(stream: AsyncIterable<Uint8Array | Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export class WhatsAppGateway {
  private socket: SocketLike | null = null;
  private state: WhatsAppConnectionState = "disconnected";
  private qr: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly options: {
      dataDir: string;
      settings: Settings;
      store: WhatsAppStore;
      getEngine: () => Promise<BrainEngine>;
      socketFactory?: SocketFactory;
    },
  ) {}

  private get sessionDir(): string {
    return join(this.options.dataDir, "session");
  }

  status(): WhatsAppStatus {
    const settings = this.options.settings.whatsappSettings();
    const linked = this.socket?.user?.id ?? this.options.settings.getRaw("whatsapp_linked_jid");
    return {
      enabled: settings.enabled,
      state: settings.enabled ? this.state : "disabled",
      linkedNumber: maskPhoneNumber(linked),
      lastActivity: this.options.store.lastActivity(),
      lastError: this.lastError,
      qr: this.state === "pairing" ? this.qr : null,
      allowedSenders: settings.allowedSenders,
      groupsEnabled: settings.groupsEnabled,
      acceptAll: settings.acceptAll,
    };
  }

  async startIfEnabled(): Promise<void> {
    if (this.options.settings.whatsappSettings().enabled) await this.start();
  }

  async start(): Promise<void> {
    if (this.socket) return;
    this.lastError = null;
    this.state = "disconnected";
    const factory = this.options.socketFactory ?? defaultSocketFactory;
    this.socket = await factory(this.sessionDir);
    this.bindSocket(this.socket);
  }

  async pair(): Promise<void> {
    this.options.settings.setWhatsAppSettings({ enabled: true });
    await this.start();
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.qr = null;
    this.state = "disconnected";
    socket?.end?.();
  }

  async resetSession(): Promise<void> {
    await this.disconnect();
    await rm(this.sessionDir, { recursive: true, force: true });
    this.options.settings.setRaw("whatsapp_linked_jid", "");
  }

  private bindSocket(socket: SocketLike): void {
    socket.ev.on("connection.update", (update) => {
      const qr = typeof update.qr === "string" ? update.qr : null;
      if (qr) {
        this.qr = qr;
        this.state = "pairing";
      }

      if (update.connection === "open") {
        this.qr = null;
        this.state = "connected";
        const linked = socket.user?.id;
        if (linked) this.options.settings.setRaw("whatsapp_linked_jid", linked);
      }

      if (update.connection === "close") {
        const statusCode = Number(
          (update.lastDisconnect as { error?: { output?: { statusCode?: unknown } } } | undefined)?.error?.output
            ?.statusCode,
        );
        this.socket = null;
        this.qr = null;
        if (statusCode === DisconnectReason.loggedOut) {
          this.state = "error";
          this.lastError = "WhatsApp logged out. Reset the session and pair again.";
          return;
        }
        this.state = "disconnected";
        this.lastError = statusCode ? `WhatsApp disconnected (${statusCode})` : "WhatsApp disconnected";
      }
    });

    socket.ev.on("messages.upsert", (update) => {
      void this.handleMessages(update.messages, update.type).catch((err: unknown) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        console.error("[whatsapp] message handler failed:", err);
      });
    });
  }

  async handleMessages(messages: WAMessage[], type: string): Promise<void> {
    if (type !== "notify") return;
    for (const message of messages) {
      const event = eventFromBaileysMessage(message);
      if (!event) continue;
      await this.handleEvent(event);
    }
  }

  async handleEvent(event: WhatsAppInboundEvent): Promise<void> {
    const result = this.options.store.recordInbound(event);
    if (!result.inserted) return;

    const settings = this.options.settings.whatsappSettings();
    if (event.isGroup && !settings.groupsEnabled) {
      this.options.store.markMessageStatus(event.messageId, "skipped_group");
      return;
    }

    if (!senderIsAllowed(event.senderId, settings)) {
      this.options.store.markMessageStatus(event.messageId, "denied");
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: event.chatId,
        contactId: event.senderId,
        status: "denied",
      });
      return;
    }

    const input = await this.engineInputForEvent(event, settings);
    if (input.kind === "fixed-reply") {
      await this.sendReply(event, input.text, "unsupported_media");
      return;
    }

    try {
      this.options.store.markMessageStatus(event.messageId, "processing");
      const engine = await this.options.getEngine();
      const reply = await engine.chat(input.text, "whatsapp", {
        conversationKey: normalizeWhatsAppIdentifier(event.senderId) || event.senderId,
      });
      await this.sendReply(event, reply.text, "sent");
      this.options.store.markMessageStatus(event.messageId, "replied");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.store.markMessageStatus(event.messageId, "failed");
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: event.chatId,
        contactId: event.senderId,
        status: "failed",
        errorText: message,
      });
      throw err;
    }
  }

  private async engineInputForEvent(
    event: WhatsAppInboundEvent,
    settings: WhatsAppSettings,
  ): Promise<{ kind: "engine"; text: string } | { kind: "fixed-reply"; text: string }> {
    if (!event.hasMedia) return { kind: "engine", text: event.body };

    if (event.mediaType === "audio" || event.mediaType === "ptt") {
      if (!event.mediaRaw) {
        return { kind: "fixed-reply", text: "I received a voice note, but could not download it." };
      }
      const stream = await downloadContentFromMessage(event.mediaRaw as never, "audio");
      const data = await streamToBuffer(stream);
      const filename = `${event.messageId}.${event.mimeType?.includes("mpeg") ? "mp3" : "ogg"}`;
      const transcription = await transcribeAudio(data, filename);
      if (!transcription.success) {
        return { kind: "fixed-reply", text: `I could not transcribe that voice note: ${transcription.error}` };
      }
      const sender = normalizeWhatsAppIdentifier(event.senderId) || event.senderName;
      return {
        kind: "engine",
        text: `WhatsApp voice note transcript from ${sender}:\n\n${transcription.transcript}`,
      };
    }

    if (event.body.trim()) {
      return {
        kind: "engine",
        text: `WhatsApp ${event.mediaType ?? "media"} caption from ${event.senderName}:\n\n${event.body}`,
      };
    }

    return {
      kind: "fixed-reply",
      text:
        settings.acceptAll || settings.allowedSenders.length > 0
          ? "I received media, but this Zenod WhatsApp connector can only process text, captions, and voice notes in v1."
          : "",
    };
  }

  private async sendReply(event: WhatsAppInboundEvent, text: string, status: string): Promise<void> {
    if (!text) return;
    try {
      const sent = await this.socket?.sendMessage(event.chatId, { text });
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: event.chatId,
        contactId: event.senderId,
        bodyText: text,
        status,
        sentMessageId: sent?.key?.id ?? null,
        raw: sent,
      });
    } catch (err) {
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: event.chatId,
        contactId: event.senderId,
        bodyText: text,
        status: "failed",
        errorText: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
