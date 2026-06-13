import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import type { BrainEngine, StoreResult } from "zenod";
import type { Settings } from "./settings.js";
import { transcribeAudio } from "./transcribe.js";
import {
  maskPhoneNumber,
  normalizeWhatsAppIdentifier,
  senderIsAllowed,
  type WhatsAppSettings,
} from "./whatsappConfig.js";
import { WhatsAppStore, type WhatsAppInboundEvent, type WhatsAppStoreDiagnostics } from "./whatsappStore.js";

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
  diagnostics: WhatsAppDiagnostics;
}

export interface WhatsAppDiagnostics {
  lastUpsertAt: number | null;
  lastUpsertType: string | null;
  lastUpsertMessageCount: number;
  lastIgnoredAt: number | null;
  lastIgnoredReason: string | null;
  allowedSenderAliasCount: number;
  lastAliasRefreshAt: number | null;
  lastAliasRefreshError: string | null;
  lastAliasRefreshAllowedCount: number;
  lastAliasRefreshResultCount: number;
  store: WhatsAppStoreDiagnostics;
}

export interface SocketLike {
  ev: {
    on(event: "connection.update", listener: (update: Record<string, unknown>) => void): void;
    on(event: "messages.upsert", listener: (update: { messages: WAMessage[]; type: string }) => void): void;
  };
  user?: { id?: string | null } | null;
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string | null } } | undefined>;
  readMessages?(keys: WAMessageKey[]): Promise<void>;
  sendReceipts?(keys: WAMessageKey[], type: "read"): Promise<void>;
  sendPresenceUpdate?(type: "composing" | "paused", toJid?: string): Promise<void>;
  onWhatsApp?(...jids: string[]): Promise<Array<{ jid?: string; exists?: unknown; lid?: unknown }> | undefined>;
  end?(error?: Error): void;
  flushCredentials?(): Promise<void>;
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

  // Baileys v7 exposes the phone-number identity for a @lid chat via the alt
  // key fields (remoteJidAlt for DMs, participantAlt for groups). Prefer those
  // so we reply to the @s.whatsapp.net JID and avoid the @lid "waiting for this
  // message" decryption bug. (v6's message.key.senderPn was removed in v7.)
  const senderId = normalizedJid(
    message.key.participantAlt || message.key.remoteJidAlt || message.key.participant || chatId,
  );
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

function skipReasonForBaileysMessage(message: WAMessage): string {
  const messageId = textField(message.key.id);
  const chatId = normalizedJid(message.key.remoteJid);
  if (!messageId) return "missing_message_id";
  if (!chatId) return "missing_chat_id";
  if (!message.message) return "missing_message_body";
  if (chatId.includes("status")) return "status_broadcast";
  if (message.key.fromMe) return "from_linked_number";
  const content = contentFromMessage(message);
  const extracted = extractBodyAndMedia(content);
  if (!extracted) return "unsupported_message_type";
  if (!extracted.body && !extracted.hasMedia) return "empty_message";
  return "unknown";
}

async function defaultSocketFactory(sessionDir: string): Promise<SocketLike> {
  await mkdir(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  let pendingCredsSave = Promise.resolve();
  let credsSaveError: unknown = null;
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
  socket.ev.on("creds.update", () => {
    pendingCredsSave = Promise.resolve(saveCreds()).catch((err: unknown) => {
      credsSaveError = err;
      console.error("[whatsapp] failed to save credentials:", err);
    });
  });
  return Object.assign(socket, {
    async flushCredentials() {
      await pendingCredsSave;
      if (credsSaveError) throw credsSaveError;
    },
  });
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
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly waiters = new Set<() => void>();
  private lastUpsertAt: number | null = null;
  private lastUpsertType: string | null = null;
  private lastUpsertMessageCount = 0;
  private lastIgnoredAt: number | null = null;
  private lastIgnoredReason: string | null = null;
  private allowedSenderAliases = new Set<string>();
  private aliasRefresh: Promise<void> | null = null;
  private lastAliasRefreshAt: number | null = null;
  private lastAliasRefreshError: string | null = null;
  private lastAliasRefreshAllowedCount = 0;
  private lastAliasRefreshResultCount = 0;

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
      diagnostics: {
        lastUpsertAt: this.lastUpsertAt,
        lastUpsertType: this.lastUpsertType,
        lastUpsertMessageCount: this.lastUpsertMessageCount,
        lastIgnoredAt: this.lastIgnoredAt,
        lastIgnoredReason: this.lastIgnoredReason,
        allowedSenderAliasCount: this.allowedSenderAliases.size,
        lastAliasRefreshAt: this.lastAliasRefreshAt,
        lastAliasRefreshError: this.lastAliasRefreshError,
        lastAliasRefreshAllowedCount: this.lastAliasRefreshAllowedCount,
        lastAliasRefreshResultCount: this.lastAliasRefreshResultCount,
        store: this.options.store.diagnostics(),
      },
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
    if (this.socket) {
      await this.disconnect({ keepEnabled: true });
    }
    await this.start();
  }

  async waitForPairingSignal(timeoutMs = 8_000): Promise<void> {
    await this.waitForStatus(
      () => this.state === "pairing" || this.state === "connected" || this.state === "error",
      timeoutMs,
    );
  }

  async disconnect(options: { keepEnabled?: boolean } = {}): Promise<void> {
    this.clearReconnectTimer();
    if (!options.keepEnabled) this.options.settings.setWhatsAppSettings({ enabled: false });
    const socket = this.socket;
    this.socket = null;
    this.qr = null;
    this.state = "disconnected";
    this.notifyStatusChange();
    socket?.end?.();
  }

  async resetSession(): Promise<void> {
    await this.disconnect();
    await rm(this.sessionDir, { recursive: true, force: true });
    this.options.settings.setRaw("whatsapp_linked_jid", "");
  }

  close(): void {
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.qr = null;
    this.notifyStatusChange();
    socket?.end?.();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private notifyStatusChange(): void {
    for (const waiter of this.waiters) waiter();
  }

  private waitForStatus(predicate: () => boolean, timeoutMs: number): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };
      const waiter = () => {
        if (predicate()) done();
      };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private async flushSocketCredentials(socket: SocketLike | null): Promise<void> {
    if (!socket?.flushCredentials) return;
    await socket.flushCredentials().catch((err: unknown) => {
      this.lastError = `WhatsApp credentials could not be saved: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[whatsapp] credential flush failed:", err);
    });
  }

  private scheduleReconnect(reason: string, delayMs: number): void {
    if (!this.options.settings.whatsappSettings().enabled || this.reconnectTimer) return;
    this.lastError = reason;
    this.state = "disconnected";
    this.notifyStatusChange();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch((err: unknown) => {
        this.state = "error";
        this.lastError = err instanceof Error ? err.message : String(err);
        this.notifyStatusChange();
        console.error("[whatsapp] reconnect failed:", err);
      });
    }, delayMs);
  }

  private async handleConnectionClose(socket: SocketLike, statusCode: number): Promise<void> {
    if (statusCode === DisconnectReason.restartRequired) {
      this.state = "disconnected";
      this.lastError = "WhatsApp requested a restart after pairing. Saving session before reconnecting…";
      this.notifyStatusChange();
      await this.flushSocketCredentials(socket);
      this.scheduleReconnect("WhatsApp requested a restart after pairing. Reconnecting…", 1_500);
      return;
    }
    if (statusCode === DisconnectReason.loggedOut) {
      this.state = "error";
      this.options.settings.setRaw("whatsapp_linked_jid", "");
      this.lastError = "WhatsApp logged out. Reset the session and pair again.";
      this.notifyStatusChange();
      return;
    }
    if (statusCode === DisconnectReason.badSession || statusCode === DisconnectReason.multideviceMismatch) {
      this.state = "error";
      this.options.settings.setRaw("whatsapp_linked_jid", "");
      this.lastError = "WhatsApp session is invalid. Reset the session and pair again.";
      this.notifyStatusChange();
      return;
    }
    this.state = "disconnected";
    this.lastError = statusCode ? `WhatsApp disconnected (${statusCode})` : "WhatsApp disconnected";
    this.notifyStatusChange();
    await this.flushSocketCredentials(socket);
    this.scheduleReconnect(this.lastError, 2_000);
  }

  private rememberIgnored(reason: string): void {
    this.lastIgnoredAt = Date.now();
    this.lastIgnoredReason = reason;
  }

  async refreshAllowedSenderAliases(): Promise<void> {
    if (this.aliasRefresh) return this.aliasRefresh;
    const socket = this.socket;
    const allowed = this.options.settings.whatsappSettings().allowedSenders.filter((sender) => sender !== "*");
    this.lastAliasRefreshAt = Date.now();
    this.lastAliasRefreshAllowedCount = allowed.length;
    this.lastAliasRefreshResultCount = 0;
    this.lastAliasRefreshError = null;
    if (!socket?.onWhatsApp || allowed.length === 0) {
      this.allowedSenderAliases = new Set(allowed);
      return;
    }

    this.aliasRefresh = socket
      .onWhatsApp(...allowed.map((sender) => `${sender}@s.whatsapp.net`))
      .then((results) => {
        const aliases = new Set<string>();
        for (const sender of allowed) aliases.add(sender);
        const resolved = results ?? [];
        this.lastAliasRefreshResultCount = resolved.length;
        for (const result of resolved) {
          const jid = typeof result.jid === "string" ? result.jid : "";
          const lid = typeof result.lid === "string" ? result.lid : "";
          const normalizedJid = normalizeWhatsAppIdentifier(jid);
          const normalizedLid = normalizeWhatsAppIdentifier(lid);
          if (normalizedJid) aliases.add(normalizedJid);
          if (normalizedLid) aliases.add(normalizedLid);
        }
        this.allowedSenderAliases = aliases;
      })
      .catch((err: unknown) => {
        this.lastAliasRefreshError = err instanceof Error ? err.message : String(err);
        console.warn("[whatsapp] could not resolve allowlist LID aliases:", err);
      })
      .finally(() => {
        this.aliasRefresh = null;
      });
    return this.aliasRefresh;
  }

  private senderIsAllowed(senderId: string, settings: Pick<WhatsAppSettings, "acceptAll" | "allowedSenders">): boolean {
    if (senderIsAllowed(senderId, settings)) return true;
    const normalized = normalizeWhatsAppIdentifier(senderId);
    return normalized !== "" && this.allowedSenderAliases.has(normalized);
  }

  private recipientJid(event: WhatsAppInboundEvent): string {
    return event.isGroup ? event.chatId : event.senderId || event.chatId;
  }

  // Send a read receipt (blue ticks) for the inbound message. Uses ONLY the
  // real inbound key — never fabricate/rewrite remoteJid/participant, which is
  // what desynced @lid Signal sessions before. v7 addresses the receipt itself.
  //
  // Prefer sendReceipts(keys, "read") over readMessages(keys): readMessages
  // downgrades to a "read-self" receipt (read on our own devices only, no blue
  // ticks for the sender) unless the bot account's readreceipts privacy is
  // "all". Forcing "read" makes blue ticks reliable regardless of that setting.
  // For lid-addressed chats, the sender's client doesn't attribute a read
  // receipt sent to the @lid, so blue ticks never appear. Re-target the receipt
  // to the phone JID (remoteJidAlt). This is safe: a <receipt> is a plain,
  // unencrypted stanza — not a Signal/session op — so retargeting it cannot
  // desync E2E sessions (unlike rewriting keys for encrypted sends/receipts).
  private readReceiptKey(key: WAMessageKey): WAMessageKey {
    const extra = key as Record<string, unknown>;
    const phoneJid = typeof extra.remoteJidAlt === "string" ? extra.remoteJidAlt : "";
    if (extra.addressingMode === "lid" && phoneJid) {
      return { ...key, remoteJid: phoneJid };
    }
    return key;
  }

  private async markRead(event: WhatsAppInboundEvent): Promise<void> {
    const key = (event.raw as WAMessage | undefined)?.key;
    if (!key) return;
    const socket = this.socket;
    if (!socket) return;
    const receiptKey = this.readReceiptKey(key);
    // TEMP diagnostic: dump the inbound key + chosen receipt target so we can see
    // why blue ticks aren't landing on @lid chats. Remove once confirmed working.
    console.info(
      "[whatsapp][diag] markRead key=",
      JSON.stringify({
        id: key.id,
        remoteJid: key.remoteJid,
        remoteJidAlt: (key as Record<string, unknown>).remoteJidAlt,
        addressingMode: (key as Record<string, unknown>).addressingMode,
        receiptTo: receiptKey.remoteJid,
        via: socket.sendReceipts ? "sendReceipts(read)" : "readMessages",
      }),
    );
    const sent = socket.sendReceipts ? socket.sendReceipts([receiptKey], "read") : socket.readMessages?.([receiptKey]);
    await sent?.catch((err: unknown) => {
      console.warn("[whatsapp] could not mark message read:", err);
    });
  }

  // Typing indicator, sent to the same single JID we reply to. No fan-out.
  private async setTyping(event: WhatsAppInboundEvent, typing: boolean): Promise<void> {
    const jid = this.recipientJid(event);
    if (!jid || !this.socket?.sendPresenceUpdate) return;
    await this.socket.sendPresenceUpdate(typing ? "composing" : "paused", jid).catch((err: unknown) => {
      console.warn("[whatsapp] could not update typing state:", err);
    });
  }

  private bindSocket(socket: SocketLike): void {
    socket.ev.on("connection.update", (update) => {
      if (this.socket !== socket) return;
      const qr = typeof update.qr === "string" ? update.qr : null;
      if (qr) {
        this.qr = qr;
        this.state = "pairing";
        this.lastError = null;
        this.notifyStatusChange();
      }

      if (update.connection === "open") {
        this.clearReconnectTimer();
        this.qr = null;
        this.state = "connected";
        this.lastError = null;
        const linked = socket.user?.id;
        if (linked) this.options.settings.setRaw("whatsapp_linked_jid", linked);
        this.notifyStatusChange();
        void this.refreshAllowedSenderAliases();
      }

      if (update.connection === "close") {
        const closingSocket = this.socket;
        const statusCode = Number(
          (update.lastDisconnect as { error?: { output?: { statusCode?: unknown } } } | undefined)?.error?.output
            ?.statusCode,
        );
        this.socket = null;
        this.qr = null;
        void this.handleConnectionClose(closingSocket ?? socket, statusCode).catch((err: unknown) => {
          this.state = "error";
          this.lastError = err instanceof Error ? err.message : String(err);
          this.notifyStatusChange();
          console.error("[whatsapp] close handler failed:", err);
        });
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
    this.lastUpsertAt = Date.now();
    this.lastUpsertType = type;
    this.lastUpsertMessageCount = messages.length;
    if (type !== "notify") {
      this.rememberIgnored(`upsert_type_${type}`);
      return;
    }
    for (const message of messages) {
      const event = eventFromBaileysMessage(message);
      if (!event) {
        this.rememberIgnored(skipReasonForBaileysMessage(message));
        continue;
      }
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

    let allowed = this.senderIsAllowed(event.senderId, settings);
    if (!allowed && event.senderId.endsWith("@lid")) {
      await this.refreshAllowedSenderAliases();
      allowed = this.senderIsAllowed(event.senderId, settings);
    }

    if (!allowed) {
      this.options.store.markMessageStatus(event.messageId, "denied");
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: event.chatId,
        contactId: event.senderId,
        status: "denied",
      });
      return;
    }

    await this.markRead(event);

    if (event.hasMedia) {
      this.options.store.markMessageStatus(event.messageId, "digest_queued");
      await this.sendReply(event, this.formatIngestAck(event), "ack_sent");
      void this.processDigest(event).catch((err: unknown) => {
        console.error("[whatsapp] digest worker failed:", err);
      });
      return;
    }

    // WhatsApp's "composing" presence auto-expires after ~10s, so refresh it on
    // an interval — otherwise typing vanishes mid-reply on slower engine calls.
    await this.setTyping(event, true);
    const keepTyping = this.socket?.sendPresenceUpdate
      ? setInterval(() => void this.setTyping(event, true), 8_000)
      : null;
    keepTyping?.unref?.();
    try {
      const input = await this.engineInputForEvent(event, settings);
      if (input.kind === "fixed-reply") {
        await this.sendReply(event, input.text, "unsupported_media");
        return;
      }

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
    } finally {
      if (keepTyping) clearInterval(keepTyping);
      await this.setTyping(event, false);
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
      const transcription = await transcribeAudio(data, filename, {
        model: this.options.settings.whisperModel(),
        groqApiKey: this.options.settings.get("groq_api_key"),
        openaiApiKey: this.options.settings.get("openai_api_key"),
        useOpenAiForLongAudio: this.options.settings.useOpenAiForLongTranscription(),
      });
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

  private formatIngestAck(event: WhatsAppInboundEvent): string {
    const timestamp =
      typeof event.timestamp === "object" && event.timestamp !== null && "low" in event.timestamp
        ? String((event.timestamp as { low: unknown }).low)
        : String(event.timestamp ?? "unknown");
    const channel = event.isGroup ? "WhatsApp group" : "WhatsApp";
    const isVoice = event.mediaType === "ptt" || event.mediaType === "audio";
    const kind = isVoice ? "voice note" : event.mediaType ?? "media";
    const work = isVoice ? "transcription, filing, and digestion" : "filing and digestion";
    return [
      `Got this ${kind}. I queued it for ${work}.`,
      `Source: ${channel} message ${event.messageId} at ${timestamp}.`,
      `Digest job: wa-${event.messageId}.`,
    ].join("\n");
  }

  private formatDigestReport(input: {
    event: WhatsAppInboundEvent;
    stored?: StoreResult;
    summary?: string[];
    error?: string;
  }): string {
    const { event, stored, summary = [], error } = input;
    const sourcePointer = `${event.isGroup ? event.chatId : event.senderId} / ${event.messageId}`;
    if (error) {
      return [
        "Digest failed",
        `Summary: ${error}`,
        `Filed: no transcript or memory changes were filed.`,
        "Backlog: no records created.",
        "Open questions: retry after fixing the failure above.",
        `Source: WhatsApp ${sourcePointer}; digest job wa-${event.messageId}.`,
      ].join("\n");
    }

    const filed = [
      stored?.evidenceRef ? `evidence ${stored.evidenceRef}` : null,
      ...(stored?.pagesTouched ?? []).map((page) => `memory ${page}`),
      stored?.commitSha ? `commit ${stored.commitSha}` : null,
    ].filter(Boolean);

    return [
      "Digest complete",
      "Summary:",
      ...(summary.length > 0 ? summary.slice(0, 6).map((line) => `- ${line}`) : ["- Transcript filed as WhatsApp evidence."]),
      `Filed: ${filed.length > 0 ? filed.join("; ") : "no filed paths returned"}.`,
      "Backlog: no backlog records created by the ingest lifecycle.",
      stored?.question ? `Open questions: ${stored.question}` : "Open questions: none reported.",
      `Source: WhatsApp ${sourcePointer}; transcript pointer ${stored?.evidenceRef ?? "unavailable"}; digest job wa-${event.messageId}.`,
    ].join("\n");
  }

  private summarizeForReport(text: string): string[] {
    return text
      .split(/\n+/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  private async processDigest(event: WhatsAppInboundEvent): Promise<void> {
    await this.setTyping(event, true);
    this.options.store.markMessageStatus(event.messageId, "digesting");
    try {
      const input = await this.engineInputForEvent(event, this.options.settings.whatsappSettings());
      if (input.kind === "fixed-reply") {
        this.options.store.markMessageStatus(event.messageId, "digest_failed");
        await this.sendReply(event, this.formatDigestReport({ event, error: input.text }), "digest_failed");
        return;
      }

      const engine = await this.options.getEngine();
      const stored = await engine.store({
        content: [
          `WhatsApp ${event.mediaType ?? "media"} from ${event.senderName || event.senderId}.`,
          `Source message: ${event.messageId}`,
          `Source chat: ${event.chatId}`,
          `Received timestamp: ${String(event.timestamp ?? "unknown")}`,
          "",
          input.text,
        ].join("\n"),
        source: "whatsapp",
        verbatim: true,
      });
      this.options.store.markMessageStatus(event.messageId, "digested");
      await this.sendReply(
        event,
        this.formatDigestReport({ event, stored, summary: this.summarizeForReport(input.text) }),
        "digest_report_sent",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.store.markMessageStatus(event.messageId, "digest_failed");
      await this.sendReply(event, this.formatDigestReport({ event, error: message }), "digest_failed");
    } finally {
      await this.setTyping(event, false);
    }
  }

  private async sendReply(event: WhatsAppInboundEvent, text: string, status: string): Promise<void> {
    if (!text) return;
    const recipientJid = this.recipientJid(event);
    try {
      const sent = await this.socket?.sendMessage(recipientJid, { text });
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: recipientJid,
        contactId: event.senderId,
        bodyText: text,
        status,
        sentMessageId: sent?.key?.id ?? null,
        raw: sent,
      });
    } catch (err) {
      this.options.store.recordOutboundAudit({
        messageId: event.messageId,
        chatId: recipientJid,
        contactId: event.senderId,
        bodyText: text,
        status: "failed",
        errorText: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
