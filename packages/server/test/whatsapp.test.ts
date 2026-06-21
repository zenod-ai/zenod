import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BrainEngine, StoreInput, StoreResult } from "zenod";
import { createApp } from "../src/app.js";
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

async function waitFor<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  const started = Date.now();
  let value = read();
  while (!done(value)) {
    if (Date.now() - started > 2_000) throw new Error("timed out waiting for async work");
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

describe("WhatsApp helpers", () => {
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
      expect(body.allowedSenders).toEqual(["34600000001"]);
      expect(JSON.stringify(body)).not.toContain("session");

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
