import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { conversationId, type BrainEngine, type StoreInput, type StoreResult } from "zenod";
import { createApp } from "../src/app.js";
import { formatConversationTranscript } from "../src/conversationTranscript.js";
import { Runtime } from "../src/runtime.js";
import {
  maskPhoneNumber,
  normalizeAllowedSenders,
  normalizeWhatsAppIdentifier,
  senderIsAllowed,
} from "../src/whatsappConfig.js";
import {
  WhatsAppGateway,
  eventFromBaileysMessage,
  installBaileysSessionLogRedaction,
  whatsappNativeTransportConfig,
  type SocketLike,
} from "../src/whatsappGateway.js";
import { WhatsAppStore } from "../src/whatsappStore.js";

vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whiskeysockets/baileys")>();
  return {
    ...actual,
    downloadContentFromMessage: vi.fn(async function* () {
      yield Buffer.from("fake-audio-bytes");
    }),
  };
});

class FakeSocket implements SocketLike {
  readonly emitter = new EventEmitter();
  readonly sent: Array<{ jid: string; text: string }> = [];
  readonly receipts: Array<{ keys: Array<{ id?: string | null; remoteJid?: string | null }>; type: string }> = [];
  readonly presence: Array<{ type: string; jid?: string }> = [];
  user = { id: "34600000000:1@s.whatsapp.net" };
  onWhatsApp?: SocketLike["onWhatsApp"];
  ev = {
    on: (event: "connection.update" | "messages.upsert", listener: (...args: never[]) => void) => {
      this.emitter.on(event, listener);
    },
  };

  async sendMessage(jid: string, content: { text: string }) {
    this.sent.push({ jid, text: content.text });
    return { key: { id: `sent_${this.sent.length}` } };
  }

  async sendReceipts(keys: Array<{ id?: string | null; remoteJid?: string | null }>, type: "read") {
    this.receipts.push({ keys, type });
  }

  async sendPresenceUpdate(type: "composing" | "paused", toJid?: string) {
    this.presence.push({ type, jid: toJid });
  }

  end() {
    this.emitter.removeAllListeners();
  }
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      id: "msg_1",
      remoteJid: "34611111111@s.whatsapp.net",
      fromMe: false,
    },
    pushName: "Tester",
    messageTimestamp: 1_800_000_000,
    message: { conversation: "hello" },
    ...overrides,
  } as never;
}

function fakeEngine(calls: string[]): BrainEngine {
  return {
    async chat(message, _surface, options) {
      calls.push(`${typeof options === "object" ? options.conversationKey : "none"}:${message}`);
      return { text: `Re: ${message}`, sources: [] };
    },
    async handleTasking(input) {
      calls.push(`${input.conversationKey}:${input.text}`);
      return { text: `Re: ${input.text}`, actions: [] };
    },
    async store() {
      throw new Error("unused");
    },
    async ask() {
      throw new Error("unused");
    },
    async search() {
      return [];
    },
    async get() {
      throw new Error("unused");
    },
    async lint() {
      return { ok: true, errors: [], checkedFiles: 0 };
    },
    async work() {
      return { mode: "proposal", text: "", committed: false };
    },
    async digestBacklog() {
      return { candidates: [], written: [], skipped: [], source_refs: [] };
    },
  };
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 2_000): Promise<T> {
  const started = Date.now();
  let value = read();
  while (!done(value)) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for async work");
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function audioEvent(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "voice_1",
    chatId: "34611111111@s.whatsapp.net",
    senderId: "34611111111@s.whatsapp.net",
    senderName: "Tester",
    chatName: "Tester",
    isGroup: false,
    timestamp: 1_800_000_000,
    body: "",
    hasMedia: true,
    mediaType: "ptt",
    mimeType: "audio/ogg",
    fileName: null,
    mediaRaw: {},
    raw: {
      key: { id: "voice_1", remoteJid: "34611111111@s.whatsapp.net", fromMe: false },
    },
    ...overrides,
  };
}

function imageEvent(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "image_1",
    chatId: "34611111111@s.whatsapp.net",
    senderId: "34611111111@s.whatsapp.net",
    senderName: "Tester",
    chatName: "Tester",
    isGroup: false,
    timestamp: 1_800_000_000,
    body: "",
    hasMedia: true,
    mediaType: "image",
    mimeType: "image/jpeg",
    fileName: "photo.jpg",
    mediaRaw: {},
    raw: {
      key: { id: "image_1", remoteJid: "34611111111@s.whatsapp.net", fromMe: false },
    },
    ...overrides,
  };
}

describe("WhatsApp helpers", () => {
  it("redacts only libsignal session objects while preserving health and unrelated logs", () => {
    const captured: Array<{ level: "info" | "warn"; args: unknown[] }> = [];
    const target = {
      info: (...args: unknown[]) => captured.push({ level: "info", args }),
      warn: (...args: unknown[]) => captured.push({ level: "warn", args }),
    };
    installBaileysSessionLogRedaction(target);
    const installedInfo = target.info;
    const installedWarn = target.warn;
    installBaileysSessionLogRedaction(target);
    expect(target.info).toBe(installedInfo);
    expect(target.warn).toBe(installedWarn);

    const secretSession = {
      _chains: { secretChain: { chainKey: Buffer.from("private-chain-key") } },
      indexInfo: { baseKey: Buffer.from("private-base-key"), remoteIdentityKey: Buffer.from("private-identity-key") },
    };
    target.info("Closing session:", secretSession);
    target.warn("Session already closed", secretSession);
    target.info("[whatsapp][health]", JSON.stringify({ event: "reconnect_succeeded", state: "connected" }));
    target.warn("[whatsapp] unrelated adapter warning", { code: 428 });

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("private-chain-key");
    expect(serialized).not.toContain("private-base-key");
    expect(serialized).not.toContain("private-identity-key");
    expect(captured).toEqual([
      { level: "info", args: ["Closing session:", "[redacted libsignal session]"] },
      { level: "warn", args: ["Session already closed", "[redacted libsignal session]"] },
      { level: "info", args: ["[whatsapp][health]", '{"event":"reconnect_succeeded","state":"connected"}'] },
      { level: "warn", args: ["[whatsapp] unrelated adapter warning", { code: 428 }] },
    ]);
  });
  it("normalizes, masks, and matches phone allowlists", () => {
    expect(normalizeWhatsAppIdentifier("+34 652 029 134@s.whatsapp.net")).toBe("34652029134");
    expect(normalizeWhatsAppIdentifier("12345:10@s.whatsapp.net")).toBe("12345");
    expect(normalizeAllowedSenders("+34 652 029 134\n+34 652 029 134")).toEqual(["34652029134"]);
    expect(maskPhoneNumber("+34 652 029 134@s.whatsapp.net")).toBe("••••9134");
    expect(senderIsAllowed("34652029134@s.whatsapp.net", { acceptAll: false, allowedSenders: ["34652029134"] })).toBe(
      true,
    );
    expect(senderIsAllowed("34652029134@s.whatsapp.net", { acceptAll: false, allowedSenders: [] })).toBe(false);
    expect(senderIsAllowed("34652029134@s.whatsapp.net", { acceptAll: true, allowedSenders: [] })).toBe(true);
  });

  it("extracts direct text messages and filters status/from-self", () => {
    expect(eventFromBaileysMessage(textMessage())?.body).toBe("hello");
    expect(eventFromBaileysMessage(textMessage({ key: { id: "m", remoteJid: "status@broadcast", fromMe: false } }))).toBe(
      null,
    );
    expect(eventFromBaileysMessage(textMessage({ key: { id: "m", remoteJid: "1@s.whatsapp.net", fromMe: true } }))).toBe(
      null,
    );
  });

  it("prefers Baileys remoteJidAlt (phone JID) over LID remote ids for direct senders", () => {
    const event = eventFromBaileysMessage(
      textMessage({
        key: {
          id: "m_lid",
          remoteJid: "123456789012345@lid",
          remoteJidAlt: "34611111111@s.whatsapp.net",
          fromMe: false,
        },
      }),
    );

    expect(event?.chatId).toBe("123456789012345@lid");
    expect(event?.senderId).toBe("34611111111@s.whatsapp.net");
  });
});

describe("WhatsAppStore", () => {
  it("records inbound messages once and audits denied replies", () => {
    const store = new WhatsAppStore(":memory:");
    const event = eventFromBaileysMessage(textMessage())!;

    expect(store.recordInbound(event).inserted).toBe(true);
    expect(store.recordInbound(event).inserted).toBe(false);
    store.markMessageStatus(event.messageId, "denied");
    store.recordOutboundAudit({ messageId: event.messageId, chatId: event.chatId, contactId: event.senderId, status: "denied" });

    expect(store.countMessages()).toBe(1);
    expect(store.countOutboundAudits("denied")).toBe(1);
    store.close();
  });

  it("marks in-flight messages interrupted when the process restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-restart-"));
    const path = join(dir, "whatsapp.sqlite");
    try {
      const before = new WhatsAppStore(path);
      const event = eventFromBaileysMessage(textMessage())!;
      before.recordInbound(event);
      before.markMessageStatus(event.messageId, "processing");
      before.close();

      const after = new WhatsAppStore(path);
      expect(after.diagnostics().processingCounts.processing).toBeUndefined();
      expect(after.diagnostics().processingCounts.interrupted).toBe(1);
      after.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("WhatsApp API", () => {
  it("requires auth and persists safe status/settings without session secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-api-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    try {
      expect((await app.request("/api/whatsapp/status")).status).toBe(401);
      const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
      const saved = await app.request("/api/whatsapp/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ enabled: false, allowedSenders: ["+34 600 000 001"], acceptAll: false }),
      });
      expect(saved.status).toBe(200);
      const body = await saved.json();
      expect(body.providerMode).toBe("self_host_dev");
      expect(body.allowedSenders).toEqual(["34600000001"]);
      expect(JSON.stringify(body)).not.toContain("session");

      const cloud = await app.request("/api/whatsapp/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          enabled: true,
          providerMode: "cloud",
          cloudProvider: "managed-whatsapp",
          cloudWebhookUrl: "https://ring.example.test/webhooks/phylax",
          cloudPhoneNumberId: "pn_123",
          cloudStatus: "configured",
          testRecipient: "+34 600 000 002",
        }),
      });
      expect(cloud.status).toBe(200);
      const cloudBody = await cloud.json();
      expect(cloudBody).toEqual(
        expect.objectContaining({
          enabled: true,
          providerMode: "cloud",
          state: "disconnected",
          qr: null,
          cloud: {
            provider: "managed-whatsapp",
            webhookUrl: "https://ring.example.test/webhooks/phylax",
            phoneNumberId: "pn_123",
            status: "configured",
            testRecipient: "+34 600 000 002",
          },
        }),
      );

      const reset = await app.request("/api/whatsapp/reset-session", {
        method: "POST",
        headers,
        body: JSON.stringify({ confirm: "wrong" }),
      });
      expect(reset.status).toBe(400);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("WhatsApp lifecycle", () => {
  it("configures Baileys native connect and keepalive deadlines without a Phylax ping loop", () => {
    expect(whatsappNativeTransportConfig({})).toEqual({
      connectTimeoutMs: 10_000,
      keepAliveIntervalMs: 30_000,
    });
    expect(whatsappNativeTransportConfig({
      PHYLAX_WHATSAPP_CONNECT_TIMEOUT_MS: "250",
      PHYLAX_WHATSAPP_KEEPALIVE_INTERVAL_MS: "999999",
    })).toEqual({
      connectTimeoutMs: 1_000,
      keepAliveIntervalMs: 300_000,
    });
  });

  it("bounds a stalled socket factory and schedules a replacement", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-startup-timeout-"));
    const runtime = new Runtime(dir);
    const created = deferred<SocketLike>();
    const socket = new FakeSocket();
    socket.end = vi.fn(() => socket.emitter.removeAllListeners());
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => created.promise,
      lifecycle: { startupTimeoutMs: 50, reconnectDelayMs: 1_000 },
    });

    try {
      runtime.settings.setWhatsAppSettings({ enabled: true });
      const starting = gateway.start();
      const rejectedStart = expect(starting).rejects.toThrow("startup timed out");
      await vi.advanceTimersByTimeAsync(50);
      await rejectedStart;
      expect(gateway.status().receivePath).toMatchObject({
        status: "degraded",
        phase: "retry_wait",
      });
      expect(gateway.status().receivePath.nextRetryAt).toBe(Date.now() + 1_000);
      created.resolve(socket);
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.end).toHaveBeenCalledTimes(1);
      await gateway.close();
    } finally {
      vi.useRealTimers();
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("restarts a socket that never completes its handshake", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-handshake-timeout-"));
    const runtime = new Runtime(dir);
    const sockets = [new FakeSocket(), new FakeSocket()];
    sockets[0]!.end = vi.fn(() => sockets[0]!.emitter.removeAllListeners());
    let created = 0;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => sockets[created++]!,
      lifecycle: { handshakeTimeoutMs: 50, reconnectDelayMs: 100 },
    });

    try {
      runtime.settings.setWhatsAppSettings({ enabled: true });
      await gateway.start();
      expect(gateway.status().receivePath.phase).toBe("handshake");
      await vi.advanceTimersByTimeAsync(50);
      expect(sockets[0]!.end).toHaveBeenCalledTimes(1);
      expect(gateway.status().receivePath).toMatchObject({ status: "degraded", phase: "retry_wait" });
      await vi.advanceTimersByTimeAsync(100);
      expect(created).toBe(2);
      sockets[1]!.emitter.emit("connection.update", { connection: "open" });
      expect(gateway.status().receivePath).toMatchObject({ status: "ready", phase: "ready" });
      await gateway.close();
    } finally {
      vi.useRealTimers();
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a quiet connected transport healthy without user-message recency", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-quiet-healthy-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    let created = 0;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => {
        created += 1;
        return socket;
      },
      lifecycle: { handshakeTimeoutMs: 50 },
    });

    try {
      runtime.settings.setWhatsAppSettings({ enabled: true });
      await gateway.start();
      socket.emitter.emit("connection.update", { connection: "open" });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(created).toBe(1);
      expect(gateway.status().receivePath).toMatchObject({ status: "ready", phase: "ready" });
      expect(gateway.status().diagnostics.lastUpsertAt).toBeNull();
      await gateway.close();
    } finally {
      vi.useRealTimers();
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bounds restart after Baileys reports native transport loss", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-native-loss-"));
    const runtime = new Runtime(dir);
    const sockets = [new FakeSocket(), new FakeSocket()];
    let created = 0;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => sockets[created++]!,
    });

    try {
      runtime.settings.setWhatsAppSettings({ enabled: true });
      await gateway.start();
      sockets[0]!.emitter.emit("connection.update", { connection: "open" });
      expect(gateway.status().receivePath.outageSince).toBeNull();
      sockets[0]!.emitter.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode: 408 } } },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(gateway.status().receivePath.phase).toBe("retry_wait");
      const outageSince = gateway.status().receivePath.outageSince;
      expect(outageSince).toBeTypeOf("number");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(created).toBe(2);
      expect(gateway.status().receivePath.outageSince).toBe(outageSince);
      sockets[1]!.emitter.emit("connection.update", { connection: "open" });
      expect(gateway.status().receivePath.status).toBe("ready");
      expect(gateway.status().receivePath.outageSince).toBeNull();
      await gateway.close();
    } finally {
      vi.useRealTimers();
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps terminal authentication failure loud without marking it restartable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-terminal-auth-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ enabled: true });
      await gateway.start();
      socket.emitter.emit("connection.update", { connection: "open" });
      socket.emitter.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      });
      await vi.waitFor(() => expect(gateway.status().receivePath.status).toBe("terminal"));
      expect(gateway.status().receivePath).toMatchObject({
        phase: "terminal",
        restartable: false,
        operatorActionRequired: true,
        reason: "WhatsApp logged out. Reset the session and pair again.",
      });
      expect(gateway.status().receivePath.outageSince).toBeTypeOf("number");
      await gateway.disconnect();
      expect(gateway.status().receivePath).toMatchObject({
        status: "disabled",
        outageSince: null,
      });
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("discards a socket factory result that arrives after terminal close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-late-start-"));
    const runtime = new Runtime(dir);
    const created = deferred<SocketLike>();
    const socket = new FakeSocket();
    const flushCredentials = vi.fn(async () => undefined);
    const end = vi.fn(() => socket.emitter.removeAllListeners());
    socket.flushCredentials = flushCredentials;
    socket.end = end;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => created.promise,
    });

    try {
      runtime.settings.setWhatsAppSettings({ enabled: true });
      const starting = gateway.start();
      const closing = gateway.close();
      created.resolve(socket);
      await Promise.all([starting, closing]);
      socket.emitter.emit("connection.update", { connection: "open" });

      expect(flushCredentials).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledTimes(1);
      expect(gateway.status().state).toBe("disconnected");
      expect(runtime.settings.getRaw("whatsapp_linked_jid")).toBeNull();
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("awaits credential flush before ending the socket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-flush-close-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const flushed = deferred<void>();
    const order: string[] = [];
    socket.flushCredentials = vi.fn(async () => {
      order.push("flush-start");
      await flushed.promise;
      order.push("flush-end");
    });
    socket.end = vi.fn(() => {
      order.push("end");
      socket.emitter.removeAllListeners();
    });
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      await gateway.start();
      const closing = gateway.close();
      await vi.waitFor(() => expect(order).toEqual(["flush-start"]));
      expect(socket.end).not.toHaveBeenCalled();
      flushed.resolve();
      await closing;
      expect(order).toEqual(["flush-start", "flush-end", "end", "flush-start", "flush-end"]);
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ends the socket and rejects shutdown when credential flush fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-flush-failure-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    socket.flushCredentials = vi.fn(async () => {
      throw new Error("credential storage unavailable");
    });
    socket.end = vi.fn(() => socket.emitter.removeAllListeners());
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      await gateway.start();
      await expect(gateway.close()).rejects.toThrow("WhatsApp shutdown failed");
      expect(socket.end).toHaveBeenCalledTimes(1);
      expect(gateway.status().lastError).toContain("credential storage unavailable");
    } finally {
      await runtime.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("WhatsAppGateway", () => {
  it("sends an automated error reply when the engine fails (never silent)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-gateway-err-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => ({
        ...fakeEngine([]),
        async chat() {
          throw new Error("You exceeded your current quota (429)");
        },
        async handleTasking() {
          throw new Error("You exceeded your current quota (429)");
        },
      }),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      socket.emitter.emit("connection.update", { connection: "open" });

      await gateway.handleMessages([textMessage()], "notify");

      // The sender must get an automated, non-LLM notice — not silence.
      expect(socket.sent).toHaveLength(1);
      expect(socket.sent[0]!.text).toContain("AI model is unavailable");
      expect(runtime.whatsappStore.countOutboundAudits("failed")).toBe(1);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forces a reconnect when a send fails on a half-dead socket (no close event)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-watchdog-"));
    const runtime = new Runtime(dir);
    const dead = new FakeSocket();
    // The socket is closed underneath us but never emits connection.update:close.
    dead.sendMessage = async () => {
      throw Object.assign(new Error("Connection Closed"), { output: { statusCode: 428 } });
    };
    const fresh = new FakeSocket();
    let created = 0;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => {
        created += 1;
        return created === 1 ? dead : fresh;
      },
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      dead.emitter.emit("connection.update", { connection: "open" });
      expect(created).toBe(1);

      // The reply send throws "Connection Closed" — the watchdog should tear the
      // dead socket down and reconnect (a 1s scheduled retry) instead of hanging.
      await gateway.handleMessages([textMessage()], "notify");
      expect(runtime.whatsappStore.countOutboundAudits("failed")).toBeGreaterThan(0);

      const reconnected = await Promise.race([
        (async () => {
          for (let i = 0; i < 40; i++) {
            if (created >= 2) return true;
            await new Promise((r) => setTimeout(r, 50));
          }
          return false;
        })(),
        new Promise<boolean>((r) => setTimeout(() => r(false), 2_500)),
      ]);
      expect(reconnected).toBe(true);
    } finally {
      gateway.close();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("notifyOwner proactively messages the allowed senders (#35 ping primitive)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-notify-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      socket.emitter.emit("connection.update", { connection: "open" });

      const result = await gateway.notifyOwner("✅ #43 ready for review");

      expect(result.sent).toBe(1);
      expect(socket.sent).toEqual([{ jid: "34611111111@s.whatsapp.net", text: "✅ #43 ready for review" }]);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replies to allowlisted text once and denies non-allowlisted senders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-gateway-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const calls: string[] = [];
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine(calls),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      socket.emitter.emit("connection.update", { connection: "open" });

      await gateway.handleMessages([textMessage()], "notify");
      await gateway.handleMessages([textMessage()], "notify");
      await gateway.handleMessages(
        [textMessage({ key: { id: "msg_2", remoteJid: "34622222222@s.whatsapp.net", fromMe: false } })],
        "notify",
      );

      expect(calls).toEqual(["34611111111:hello"]);
      expect(socket.sent).toEqual([{ jid: "34611111111@s.whatsapp.net", text: "Re: hello" }]);
      expect(runtime.whatsappStore.countMessages()).toBe(2);
      expect(runtime.whatsappStore.countOutboundAudits("denied")).toBe(1);
      expect(gateway.status().diagnostics.store.processingCounts.replied).toBe(1);
      expect(gateway.status().diagnostics.store.outboundCounts.denied).toBe(1);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports ignored Baileys messages before storage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-diagnostics-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      await gateway.pair();
      await gateway.handleMessages([textMessage({ key: { id: "m", remoteJid: "1@s.whatsapp.net", fromMe: true } })], "notify");
      expect(gateway.status().diagnostics.lastIgnoredReason).toBe("from_linked_number");
      expect(gateway.status().diagnostics.store.inboundMessages).toBe(0);

      await gateway.handleMessages([textMessage({ key: { id: "m2", remoteJid: "1@s.whatsapp.net", fromMe: false } })], "append");
      expect(gateway.status().diagnostics.lastIgnoredReason).toBe("upsert_type_append");
      expect(gateway.status().diagnostics.lastUpsertType).toBe("append");
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows LID senders resolved from allowlisted phone numbers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-lid-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const calls: string[] = [];
    socket.onWhatsApp = async () => [
      {
        jid: "34611111111@s.whatsapp.net",
        exists: true,
        lid: "123456789012345@lid",
      },
    ];
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine(calls),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      socket.emitter.emit("connection.update", { connection: "open" });

      await gateway.handleMessages(
        [textMessage({ key: { id: "msg_lid", remoteJid: "123456789012345@lid", fromMe: false } })],
        "notify",
      );

      expect(calls).toEqual(["123456789012345:hello"]);
      expect(socket.sent).toEqual([{ jid: "123456789012345@lid", text: "Re: hello" }]);
      expect(gateway.status().diagnostics.allowedSenderAliasCount).toBeGreaterThan(1);
      expect(gateway.status().diagnostics.lastAliasRefreshAllowedCount).toBe(1);
      expect(gateway.status().diagnostics.lastAliasRefreshResultCount).toBe(1);
      expect(gateway.status().diagnostics.lastAliasRefreshError).toBeNull();
      expect(runtime.whatsappStore.countOutboundAudits("denied")).toBe(0);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sends direct replies to the phone JID (remoteJidAlt) when WhatsApp provides a LID chat id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-senderpn-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const calls: string[] = [];
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine(calls),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      socket.emitter.emit("connection.update", { connection: "open" });

      await gateway.handleMessages(
        [
          textMessage({
            key: {
              id: "msg_senderpn",
              remoteJid: "123456789012345@lid",
              remoteJidAlt: "34611111111@s.whatsapp.net",
              fromMe: false,
            },
          }),
        ],
        "notify",
      );

      expect(calls).toEqual(["34611111111:hello"]);
      expect(socket.sent).toEqual([{ jid: "34611111111@s.whatsapp.net", text: "Re: hello" }]);
      expect(runtime.whatsappStore.countOutboundAudits("denied")).toBe(0);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("marks the inbound message read with the real key and sends typing to the reply JID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-receipts-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const calls: string[] = [];
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine(calls),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      socket.emitter.emit("connection.update", { connection: "open" });

      await gateway.handleMessages(
        [
          textMessage({
            key: {
              id: "msg_receipt",
              remoteJid: "123456789012345@lid",
              remoteJidAlt: "34611111111@s.whatsapp.net",
              addressingMode: "lid",
              fromMe: false,
            },
          }),
        ],
        "notify",
      );

      // Read receipt is forced to type "read" (blue ticks, not "read-self"). For a
      // lid-addressed chat the receipt is re-targeted to the phone JID so the
      // sender's client attributes it — but it keeps the original message id.
      expect(socket.receipts).toEqual([
        {
          keys: [expect.objectContaining({ id: "msg_receipt", remoteJid: "34611111111@s.whatsapp.net" })],
          type: "read",
        },
      ]);
      // Typing is sent to the same phone JID we reply to: composing, then paused.
      expect(socket.presence).toEqual([
        { type: "composing", jid: "34611111111@s.whatsapp.net" },
        { type: "paused", jid: "34611111111@s.whatsapp.net" },
      ]);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a voice note as text — transcribes and replies inline, no ingest ack (voice ≡ text)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-voice-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const stored: StoreInput[] = [];
    const calls: string[] = [];
    const taskingInputs: Parameters<BrainEngine["handleTasking"]>[0][] = [];
    const fakeVoiceEngine = {
      ...fakeEngine(calls),
      async handleTasking(input: Parameters<BrainEngine["handleTasking"]>[0]) {
        taskingInputs.push(input);
        calls.push(`${input.conversationKey}:${input.text}`);
        return { text: `Re: ${input.text}`, actions: [] };
      },
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-06-13.md#^e-wa1",
          pagesTouched: ["Projects/Zenod.md"],
          commitSha: "1".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeVoiceEngine,
      socketFactory: async () => socket,
    });

    try {
      process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "queue 51 and 53";
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();

      await gateway.handleEvent(audioEvent() as never);

      // No "queued for filing/digestion" ack — a voice note is acted on through
      // the same tasking loop as text and answered with a single reply.
      await waitFor(() => socket.sent.length, (count) => count === 1);
      expect(socket.sent.some((m) => m.text.includes("Got this voice note"))).toBe(false);
      expect(calls).toContain("34611111111:queue 51 and 53");
      expect(socket.sent[0]!.text).toContain("queue 51 and 53");
      expect(taskingInputs[0]?.rawEvidence?.content).toContain("WhatsApp voice-note raw transcript.");
      expect(taskingInputs[0]?.rawEvidence?.content).toContain("Message id: voice_1");
      expect(taskingInputs[0]?.rawEvidence?.content).toContain("Transcript:\nqueue 51 and 53");
      expect(taskingInputs[0]?.rawEvidence?.hints).toContain("raw transcript");
      expect(runtime.whatsappStore.recentTranscript({ limit: 5 }).some((entry) => entry.messageId === "voice_1" && entry.bodyText === "queue 51 and 53")).toBe(true);
      expect(runtime.whatsappStore.diagnostics().processingCounts.replied).toBe(1);
      // Filing is NOT automatic (#68) — a voice note is acted on, not pushed
      // into the vault. The transcript lives in the WhatsApp audit; explicit
      // "file this" requests do the vault filing, using that transcript as raw evidence.
      expect(stored).toHaveLength(0);
    } finally {
      delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records delayed storage receipts into the WhatsApp conversation history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-receipt-history-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    let peerServer: Server | undefined;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
      recordAssistantMessage: (event, text) =>
        runtime.state.appendMessage(
          conversationId("whatsapp", normalizeWhatsAppIdentifier(event.senderId) || event.senderId),
          "assistant",
          text,
          "whatsapp",
        ),
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      peerServer = createServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            job: {
              status: "done",
              result: {
                evidenceRef: "Log/2026-06-21.md#^e-voice",
                pagesTouched: ["Projects/Voice Notes.md"],
                commitSha: "a".repeat(40),
                githubUrls: ["https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-21.md"],
              },
            },
          }),
        );
      });
      await new Promise<void>((resolve) => peerServer!.listen(0, "127.0.0.1", resolve));
      const port = (peerServer.address() as AddressInfo).port;
      runtime.settings.setPeers([{ name: "zenod", url: `http://127.0.0.1:${port}/mcp`, token: "token" }]);
      await gateway.pair();

      const jobId = "11111111-1111-4111-8111-111111111111";
      const poller = gateway as unknown as {
        spawnPeerJobPoller(
          reply: { text: string; actions: Array<{ tool: string; input: Record<string, unknown>; result: string }> },
          event: ReturnType<typeof audioEvent>,
        ): void;
      };
      poller.spawnPeerJobPoller(
        { text: `Queued job ${jobId}.`, actions: [{ tool: "add_memory", input: { content: "store this" }, result: `Queued job ${jobId}.` }] },
        audioEvent(),
      );

      await waitFor(() => socket.sent.length, (count) => count === 1, 7_000);
      expect(socket.sent[0]!.text).toContain("Storage receipt");
      expect(socket.sent[0]!.text).toContain("Vault evidence: Log/2026-06-21.md#^e-voice");

      const window = await runtime.state.recentWindow(conversationId("whatsapp", "34611111111"));
      expect(window.some((message) => message.role === "assistant" && message.text === socket.sent[0]!.text)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => peerServer?.close(() => resolve()) ?? resolve());
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it("replies clearly when a voice note can't be transcribed (never silent)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-voice-failure-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();

      await gateway.handleEvent(audioEvent({ mediaRaw: null }) as never);

      // No ack first — a single, clear reply (never silent), no "queued" framing.
      await waitFor(() => socket.sent.length, (count) => count === 1);
      expect(socket.sent.some((m) => m.text.includes("Got this voice note"))).toBe(false);
      expect(socket.sent[0]!.text).toContain("could not download");
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replies immediately when cloud STT fails instead of degrading to local Whisper", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-stt-fail-loud-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "unused";
      process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS = "openrouter";
      runtime.settings.set("openrouter_api_key", "sk-or-test");
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();

      await Promise.race([
        gateway.handleEvent(audioEvent() as never),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("STT failure reply exceeded one second")), 1_000),
        ),
      ]);

      expect(socket.sent).toHaveLength(1);
      expect(socket.sent[0]!.text).toContain("could not transcribe");
      expect(socket.sent[0]!.text).toContain("openrouter transcription failed");
    } finally {
      delete process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS;
      delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("voice notes are answered inline — a follow-up question routes through chat, not a digest-status shortcut", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-digest-status-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const calls: string[] = [];
    const fakeDigestEngine = {
      ...fakeEngine(calls),
      async store() {
        return {
          evidenceRef: "Log/2026-06-13.md#^e-wa-status",
          pagesTouched: ["Projects/Zenod.md"],
          commitSha: "2".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeDigestEngine,
      socketFactory: async () => socket,
    });

    try {
      process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "renew the travel insurance";
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();

      await gateway.handleEvent(audioEvent() as never);
      // One inline reply, no ack.
      await waitFor(() => socket.sent.length, (count) => count === 1);
      const db = new DatabaseSync(join(dir, "whatsapp", "whatsapp.sqlite"));
      try {
        const row = db.prepare("SELECT storage_status FROM whatsapp_message_media WHERE message_id = ?").get("voice_1") as
          | { storage_status: string }
          | undefined;
        expect(row?.storage_status).toBe("archive_unavailable");
      } finally {
        db.close();
      }

      await gateway.handleEvent({
        ...(eventFromBaileysMessage(
          textMessage({
            key: { id: "status_1", remoteJid: "34611111111@s.whatsapp.net", fromMe: false },
            message: { conversation: "what happened to my voice note?" },
          }),
        ) as NonNullable<ReturnType<typeof eventFromBaileysMessage>>),
      } as never);

      // Voice notes no longer create a "digest job", so the question is answered
      // as a normal chat turn — NOT intercepted by the (image-only) shortcut.
      expect(socket.sent).toHaveLength(2);
      expect(socket.sent[1]!.text).not.toContain("Latest voice-note digest status");
      expect(socket.sent[1]!.text).toBe("Re: what happened to my voice note?");
      expect(runtime.whatsappStore.diagnostics().processingCounts.replied_from_digest_state).toBeUndefined();
    } finally {
      delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("links immediate text follow-ups to the recent image intake in transcript readback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-media-followup-store-"));
    const store = new WhatsAppStore(join(dir, "whatsapp.sqlite"));
    try {
      store.recordInbound(imageEvent() as never);
      store.markMessageStatus("image_1", "digest_queued");
      const commentEvent = imageEvent({
        messageId: "comment_1",
        body: "this comment is related to the picture: please remember the red marker",
        hasMedia: false,
        mediaType: null,
        mimeType: null,
        fileName: null,
        mediaRaw: undefined,
        raw: { key: { id: "comment_1" } },
      });
      store.recordInbound(commentEvent as never);

      const linked = store.linkRecentMediaFollowUp(commentEvent as never);

      expect(linked).toMatchObject({
        mediaMessageId: "image_1",
        followupMessageId: "comment_1",
        mediaStatus: "digest_queued",
      });
      const [image] = store.recentTranscript({ messageId: "image_1" });
      expect(image?.linkedFollowUps).toEqual([
        expect.objectContaining({
          messageId: "comment_1",
          bodyText: "this comment is related to the picture: please remember the red marker",
        }),
      ]);
      const transcript = formatConversationTranscript(store.recentTranscript({ messageId: "image_1" }));
      expect(transcript).toContain("Linked follow-up comment(s):");
      expect(transcript).toContain("please remember the red marker");
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers pending media status with the attached follow-up comment instead of a bare not-done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-media-followup-status-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => socket,
    });

    try {
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();
      runtime.whatsappStore.recordInbound(imageEvent() as never);
      runtime.whatsappStore.markMessageStatus("image_1", "digest_queued");

      await gateway.handleEvent(
        imageEvent({
          messageId: "comment_1",
          body: "this comment is related to the picture, did this happen already?",
          hasMedia: false,
          mediaType: null,
          mimeType: null,
          fileName: null,
          mediaRaw: undefined,
          raw: { key: { id: "comment_1" } },
        }) as never,
      );

      expect(socket.sent).toHaveLength(1);
      expect(socket.sent[0]!.text).toContain("Latest media ingest status: digest_queued");
      expect(socket.sent[0]!.text).toContain("Follow-up attached to image_1");
      expect(socket.sent[0]!.text).toContain("No final digest report has been recorded yet.");
      const [image] = runtime.whatsappStore.recentTranscript({ messageId: "image_1" });
      expect(image?.linkedFollowUps?.[0]?.bodyText).toContain("did this happen already");
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes tasking instructions that mention voice-note digestion through chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-tasking-after-digest-"));
    const runtime = new Runtime(dir);
    const socket = new FakeSocket();
    const calls: string[] = [];
    const fakeDigestEngine = {
      ...fakeEngine(calls),
      async store() {
        return {
          evidenceRef: "Log/2026-06-13.md#^e-wa-tasking",
          pagesTouched: ["Projects/Zenod.md"],
          commitSha: "3".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeDigestEngine,
      socketFactory: async () => socket,
    });

    try {
      process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "test fan out from this voice note";
      runtime.settings.setWhatsAppSettings({ allowedSenders: ["34611111111"] });
      await gateway.pair();

      await gateway.handleEvent(audioEvent() as never);
      await waitFor(() => socket.sent.length, (count) => count === 1);

      const taskingText =
        "So I think I want to fast track one job which is doing log analysis of the last transcripts because I sent three voice notes but only got two digestions. Can you immediately create this one issue and launch a Codex agent against that issue?";
      await gateway.handleEvent({
        ...(eventFromBaileysMessage(
          textMessage({
            key: { id: "tasking_1", remoteJid: "34611111111@s.whatsapp.net", fromMe: false },
            message: { conversation: taskingText },
          }),
        ) as NonNullable<ReturnType<typeof eventFromBaileysMessage>>),
      } as never);

      // The voice note acts via the tasking loop too, so there are two
      // handleTasking calls: the voice transcript, then the text instruction —
      // and one reply each (no ack), so two sends total.
      expect(calls).toHaveLength(2);
      expect(calls).toContain("34611111111:test fan out from this voice note");
      expect(calls).toContain(`34611111111:${taskingText}`);
      expect(socket.sent).toHaveLength(2);
      expect(socket.sent[1]!.text).toBe(`Re: ${taskingText}`);
      expect(socket.sent[1]!.text).not.toContain("Latest voice-note digest status");
      expect(runtime.whatsappStore.diagnostics().processingCounts.replied).toBe(2);
      expect(runtime.whatsappStore.diagnostics().processingCounts.replied_from_digest_state).toBeUndefined();
    } finally {
      delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("restarts after Baileys restartRequired 515 during pairing", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "zenod-whatsapp-restart-"));
    const runtime = new Runtime(dir);
    const sockets = [new FakeSocket(), new FakeSocket()];
    let created = 0;
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => fakeEngine([]),
      socketFactory: async () => sockets[created++]!,
    });

    try {
      await gateway.pair();
      expect(created).toBe(1);
      sockets[0]!.emitter.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode: 515 } } },
      });
      expect(gateway.status().lastError).toContain("Saving session");
      await vi.advanceTimersByTimeAsync(0);
      expect(gateway.status().lastError).toContain("Reconnecting");

      await vi.advanceTimersByTimeAsync(1_600);
      expect(created).toBe(2);
      sockets[1]!.emitter.emit("connection.update", { connection: "open" });
      expect(gateway.status().state).toBe("connected");
      expect(gateway.status().lastError).toBeNull();
    } finally {
      vi.useRealTimers();
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
