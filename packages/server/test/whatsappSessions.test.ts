import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";

import { Runtime } from "../src/runtime.js";
import { WhatsAppGateway, type SocketLike } from "../src/whatsappGateway.js";
import { WhatsAppSessionError, WhatsAppSessionPool } from "../src/whatsappSessions.js";

/**
 * EPIC-20 A9 (agent_team E60-A2 / E60-S18): more WhatsApp numbers on one account. No real second phone exists yet
 * (the SIMs are not bought), so these tests prove everything short of a real scan: a QR is produced for a new
 * session, its state lives apart from the default number's, a "scan" (connection open) makes it a number, inbound on
 * it carries to_number, replies and notifies go out on the socket chosen by from-number, and nobody else's.
 */

class FakeSocket implements SocketLike {
  readonly emitter = new EventEmitter();
  readonly sent: Array<{ jid: string; text: string }> = [];
  readonly receipts: unknown[] = [];
  ended = false;
  loggedOut = false;
  constructor(public user: { id: string } | null = null) {}
  ev = {
    on: (event: "connection.update" | "messages.upsert" | "messages.update", listener: (...args: never[]) => void) => {
      this.emitter.on(event, listener);
    },
  };
  async sendMessage(jid: string, content: Parameters<SocketLike["sendMessage"]>[1]) {
    this.sent.push({ jid, text: "text" in content ? content.text : content.caption ?? "" });
    return { key: { id: `${this.user?.id ?? "anon"}_sent_${this.sent.length}` } };
  }
  async sendReceipts(keys: unknown[]) {
    this.receipts.push(keys);
  }
  async logout() {
    this.loggedOut = true;
  }
  end() {
    this.ended = true;
  }
  /** Simulates the phone scanning the QR: WhatsApp opens the link for this number. */
  scan(number: string) {
    this.user = { id: `${number}:3@s.whatsapp.net` };
    this.emitter.emit("connection.update", { connection: "open" });
  }
}

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function poolWith(root: string) {
  const sockets: FakeSocket[] = [];
  const dirsUsed: string[] = [];
  const pool = new WhatsAppSessionPool({
    root,
    reconnectDelayMs: 1,
    log: () => undefined,
    socketFactory: async (sessionDir) => {
      dirsUsed.push(sessionDir);
      const socket = new FakeSocket();
      sockets.push(socket);
      // WhatsApp offers a QR right after a fresh session connects.
      const n = sockets.length;
      setTimeout(() => socket.emitter.emit("connection.update", { qr: `2@qr-${n}` }), 1);
      return socket;
    },
  });
  return { pool, sockets, dirsUsed };
}

function inbound(id: string, from: string, text = "hello") {
  return {
    key: { id, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
    pushName: "Jordi",
    messageTimestamp: 1_800_000_000,
    message: { conversation: text },
  } as never;
}

describe("WhatsAppSessionPool (EPIC-20 A9)", () => {
  it("pairs a second and a third number by QR, each in its own session dir beside the default one", async () => {
    const root = await tempDir("wa-pool-");
    const { pool, sockets, dirsUsed } = poolWith(root);

    const second = await pool.pair("jordi", { label: "EpicSocial desk" });
    expect(second).toMatchObject({ tenantId: "jordi", label: "EpicSocial desk", state: "pairing", qr: "2@qr-1", number: null });
    expect(second.sessionId).toMatch(/^wa_[a-f0-9]{12}$/);
    const third = await pool.pair("jordi", { label: "EpicTeam desk" });
    expect(third.qr).toBe("2@qr-2");
    expect(third.sessionId).not.toBe(second.sessionId);

    // Each session's state is stored apart; the default number's `session/` dir is never used.
    expect(dirsUsed).toEqual([join(root, "sessions", second.sessionId), join(root, "sessions", third.sessionId)]);
    expect(existsSync(join(root, "session"))).toBe(false);
    expect((await readdir(join(root, "sessions"))).sort()).toEqual([second.sessionId, third.sessionId].sort());

    sockets[0]!.scan("34600000002");
    expect(pool.get("jordi", second.sessionId)).toMatchObject({ state: "connected", number: "+34600000002", qr: null });
    expect(pool.list("jordi").map((v) => v.state).sort()).toEqual(["connected", "pairing"]);
    await pool.close();
  });

  it("reconnects after WhatsApp's post-scan restart and stops quietly when a QR runs out", async () => {
    const root = await tempDir("wa-pool-restart-");
    const { pool, sockets } = poolWith(root);
    const view = await pool.pair("jordi");
    // Right after a scan WhatsApp closes with 515 (restart required); the session reconnects with the saved creds.
    sockets[0]!.emitter.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 515 } } } });
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.scan("34600000002");
    expect(pool.get("jordi", view.sessionId).state).toBe("connected");

    const stale = await pool.pair("jordi");
    sockets[2]!.emitter.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 408 } } } });
    expect(pool.get("jordi", stale.sessionId)).toMatchObject({ state: "disconnected" });
    expect(sockets).toHaveLength(3);
    // Asking again for that session gives a fresh QR.
    const again = await pool.pair("jordi", { sessionId: stale.sessionId });
    expect(again).toMatchObject({ sessionId: stale.sessionId, state: "pairing", qr: "2@qr-4" });
    await pool.close();
  });

  it("keeps each account's numbers to itself and resolves a sender by number or session id", async () => {
    const root = await tempDir("wa-pool-tenant-");
    const { pool, sockets } = poolWith(root);
    const mine = await pool.pair("jordi");
    await pool.pair("someone-else");
    sockets[0]!.scan("34600000002");
    sockets[1]!.scan("34600000009");

    expect(pool.resolve("jordi", "+34 600 000 002").sessionId).toBe(mine.sessionId);
    expect(pool.resolve("jordi", mine.sessionId).socket).toBe(sockets[0]);
    expect(() => pool.resolve("jordi", "+34600000009")).toThrow(WhatsAppSessionError);
    expect(() => pool.get("someone-else", mine.sessionId)).toThrow(/not paired to this Zenod account/);
    await expect(pool.remove("someone-else", mine.sessionId)).rejects.toBeInstanceOf(WhatsAppSessionError);
    expect(pool.list("jordi")).toHaveLength(1);
    await pool.close();
  });

  it("refuses a pairing past the per-account limit and unpairs by logging out and deleting the session", async () => {
    const root = await tempDir("wa-pool-limit-");
    const { pool, sockets } = poolWith(root);
    const small = new WhatsAppSessionPool({ root: join(root, "small"), maxPerTenant: 1, log: () => undefined, socketFactory: async () => new FakeSocket() });
    await small.pair("jordi", {}, 5);
    await expect(small.pair("jordi", {}, 5)).rejects.toMatchObject({ code: "limit" });
    await small.close();

    const view = await pool.pair("jordi");
    sockets[0]!.scan("34600000002");
    await pool.remove("jordi", view.sessionId);
    expect(sockets[0]!.loggedOut).toBe(true);
    expect(existsSync(join(root, "sessions", view.sessionId))).toBe(false);
    expect(pool.list("jordi")).toEqual([]);
    await pool.close();
  });

  it("restores paired sessions after a restart and leaves never-paired ones idle", async () => {
    const root = await tempDir("wa-pool-restore-");
    const first = poolWith(root);
    const paired = await first.pool.pair("jordi", { label: "EpicTeam desk" });
    const unpaired = await first.pool.pair("jordi");
    await first.pool.close();
    // Baileys writes creds.json once the phone scanned the QR.
    await writeFile(join(root, "sessions", paired.sessionId, "creds.json"), JSON.stringify({ registered: true, me: { id: "34600000002:3@s.whatsapp.net" } }));

    const second = poolWith(root);
    await second.pool.startAll();
    expect(second.dirsUsed).toEqual([join(root, "sessions", paired.sessionId)]);
    second.sockets[0]!.scan("34600000002");
    expect(second.pool.get("jordi", paired.sessionId)).toMatchObject({ state: "connected", label: "EpicTeam desk", number: "+34600000002" });
    expect(second.pool.get("jordi", unpaired.sessionId).state).toBe("disconnected");
    await second.pool.close();
  });
});

describe("WhatsAppGateway with extra numbers (EPIC-20 A9)", () => {
  async function setup(senderTenant: (sender: string) => string | null = () => "jordi") {
    const dir = await tempDir("wa-gateway-extra-");
    const runtime = new Runtime(dir);
    const defaultSocket = new FakeSocket({ id: "34600000001:1@s.whatsapp.net" });
    const { pool, sockets } = poolWith(join(dir, "whatsapp"));
    const handled: Array<{ toNumber: string | null | undefined; sessionId: string | null | undefined; text: string }> = [];
    const gateway = new WhatsAppGateway({
      dataDir: join(dir, "whatsapp"),
      settings: runtime.settings,
      store: runtime.whatsappStore,
      getEngine: async () => ({}) as BrainEngine,
      socketFactory: async () => defaultSocket,
      sessions: pool,
      extraNumberSenderAllowed: async (event, owner) => senderTenant(event.senderId) === owner,
      portedInboundHandler: async ({ event, text }) => {
        handled.push({ toNumber: event.toNumber, sessionId: event.sessionId, text });
        return { replyText: `got it on ${event.toNumber}` };
      },
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, acceptAll: true });
    await gateway.start();
    defaultSocket.emitter.emit("connection.update", { connection: "open" });
    const extra = await pool.pair("jordi", { label: "EpicTeam desk" });
    sockets[0]!.scan("34600000002");
    return { runtime, gateway, pool, defaultSocket, extraSocket: sockets[0]!, extra, handled };
  }

  it("tags inbound with the number it was sent TO and answers from that same number", async () => {
    const { runtime, gateway, defaultSocket, extraSocket, extra, handled } = await setup();
    try {
      extraSocket.emitter.emit("messages.upsert", { messages: [inbound("m_extra", "34611111111", "note for the desk")], type: "notify" });
      await vi.waitFor(() => expect(extraSocket.sent).toHaveLength(1));
      defaultSocket.emitter.emit("messages.upsert", { messages: [inbound("m_default", "34611111111", "note for zenod")], type: "notify" });
      await vi.waitFor(() => expect(defaultSocket.sent).toHaveLength(1));

      expect(handled).toEqual([
        { toNumber: "+34600000002", sessionId: extra.sessionId, text: "note for the desk" },
        { toNumber: "+34600000001", sessionId: null, text: "note for zenod" },
      ]);
      expect(extraSocket.sent[0]).toMatchObject({ jid: "34611111111@s.whatsapp.net", text: "got it on +34600000002" });
      expect(defaultSocket.sent[0]).toMatchObject({ text: "got it on +34600000001" });
      expect(extraSocket.receipts).toHaveLength(1);
      // Stored with the message, so a voice note transcribed later still knows where it was sent.
      expect(runtime.whatsappStore.inboundMediaIdentity("m_extra")).toMatchObject({ toNumber: "+34600000002", sessionId: extra.sessionId });
      expect(runtime.whatsappStore.inboundMediaIdentity("m_default")).toMatchObject({ toNumber: "+34600000001" });
      expect(runtime.whatsappStore.inboundMediaIdentity("m_default")).not.toHaveProperty("sessionId");
    } finally {
      await gateway.close();
      await runtime.close();
    }
  });

  it("sends a delayed reply (a voice note's receipt after transcription) from the number the note came in on", async () => {
    const { runtime, gateway, defaultSocket, extraSocket } = await setup();
    try {
      extraSocket.emitter.emit("messages.upsert", { messages: [inbound("m_voice", "34611111111", "long note")], type: "notify" });
      await vi.waitFor(() => expect(extraSocket.sent).toHaveLength(1));
      const db = (runtime.whatsappStore as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
      db.prepare(
        `INSERT INTO whatsapp_media_recovery (provider_message_id, recovery_kind, recovery_state, reply_text, created_at, updated_at)
         VALUES (?, 'forwarded_reply', 'pending', ?, ?, ?)`,
      ).run("m_voice", "Saved: your long note.", Date.now(), Date.now());
      await gateway.drainMediaRecovery();
      expect(extraSocket.sent.map((s) => s.text)).toEqual(["got it on +34600000002", "Saved: your long note."]);
      expect(defaultSocket.sent).toEqual([]);
    } finally {
      await gateway.close();
      await runtime.close();
    }
  });

  it("drops, unread and unanswered, a message on an extra number from someone outside the account", async () => {
    const { runtime, gateway, extraSocket, handled } = await setup((sender) => (sender.startsWith("34611111111") ? "jordi" : "stranger"));
    try {
      extraSocket.emitter.emit("messages.upsert", { messages: [inbound("m_foreign", "34699999999")], type: "notify" });
      await vi.waitFor(() => expect(gateway.status().diagnostics.lastIgnoredReason).toBe("extra_number_foreign_sender"));
      expect(handled).toEqual([]);
      expect(extraSocket.sent).toEqual([]);
      expect(extraSocket.receipts).toEqual([]);
    } finally {
      await gateway.close();
      await runtime.close();
    }
  });

  it("sends from the number named by from, and from the default number without it", async () => {
    const { runtime, gateway, defaultSocket, extraSocket, extra } = await setup();
    try {
      const byNumber = await gateway.sendText("+34611111111", "from the desk", undefined, "jordi", undefined, "+34600000002");
      const bySession = await gateway.sendText("+34611111111", "from the desk again", undefined, "jordi", undefined, extra.sessionId);
      const byDefault = await gateway.sendText("+34611111111", "from zenod", undefined, "jordi");
      expect(byNumber.fromNumber).toBe("+34600000002");
      expect(bySession.fromNumber).toBe("+34600000002");
      expect(byDefault.fromNumber).toBeUndefined();
      expect(extraSocket.sent.map((s) => s.text)).toEqual(["from the desk", "from the desk again"]);
      expect(defaultSocket.sent.map((s) => s.text)).toEqual(["from zenod"]);
      await expect(gateway.sendText("+34611111111", "x", undefined, "someone-else", undefined, "+34600000002")).rejects.toBeInstanceOf(WhatsAppSessionError);
      await expect(gateway.sendText("+34611111111", "x", undefined, "jordi", undefined, "+34600000077")).rejects.toThrow(/not paired/);
      expect(defaultSocket.sent).toHaveLength(1);
    } finally {
      await gateway.close();
      await runtime.close();
    }
  });
});
