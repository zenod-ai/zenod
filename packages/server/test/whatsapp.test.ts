import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
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

class FakeSocket implements SocketLike {
  readonly emitter = new EventEmitter();
  readonly sent: Array<{ jid: string; text: string }> = [];
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
      expect(runtime.whatsappStore.countOutboundAudits("denied")).toBe(0);
    } finally {
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
