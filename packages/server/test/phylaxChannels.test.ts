import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore, createUnit } from "@zenod/mcp-chassis";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PhylaxChannelError,
  PhylaxChannelsOrgan,
  phylaxWhatsAppPaths,
  registerPhylaxChannelTools,
  type PhylaxDownstreamCall,
} from "../src/phylaxChannels.js";
import { PhylaxPortedRuntime } from "../src/phylaxPortedRuntime.js";
import type { WhatsAppInboundEvent } from "../src/whatsappStore.js";

const dirs: string[] = [];

vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whiskeysockets/baileys")>();
  return {
    ...actual,
    downloadContentFromMessage: vi.fn(async function* () {
      yield Buffer.from("immutable-image-bytes");
    }),
  };
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PhylaxChannelsOrgan", () => {
  it("resolves sender to exactly one tenant downstream and never crosses tokens", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-channels-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve(_channel, sender) {
          if (sender === "34611111111") return { tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/alpha", downstreamToken: "alpha-secret" };
          if (sender === "34622222222") return { tenantId: "beta", downstreamUrl: "https://ring.zenod.dev/mcp/beta", downstreamToken: "beta-secret" };
          return null;
        },
      },
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: `${call.route.tenantId} council reply` }] };
      },
    });

    const alpha = await organ.receive({ channel: "whatsapp", sender: "+34 611 111 111@s.whatsapp.net", chatId: "alpha-chat", text: "hello" });
    const beta = await organ.receive({ channel: "whatsapp", sender: "+34 622 222 222@s.whatsapp.net", chatId: "beta-chat", text: "hello" });

    expect(alpha.tenantId).toBe("alpha");
    expect(beta.tenantId).toBe("beta");
    expect(calls.map((call) => [call.route.tenantId, call.route.downstreamToken])).toEqual([
      ["alpha", "alpha-secret"],
      ["beta", "beta-secret"],
    ]);
    expect(calls[0].arguments).toMatchObject({ message: "hello", surface: "whatsapp", conversationKey: "whatsapp:34611111111" });
    expect(JSON.stringify(calls[0])).not.toContain("beta-secret");
    expect(JSON.stringify(calls[1])).not.toContain("alpha-secret");
  });

  it("rejects unmatched senders before any downstream call", async () => {
    let called = false;
    const organ = new PhylaxChannelsOrgan({
      dataDir: "/tmp/unused-phylax",
      routes: { resolve: () => null },
      async callDownstream() {
        called = true;
        return { content: [{ type: "text", text: "wrong" }] };
      },
    });
    await expect(organ.receive({ channel: "telegram", sender: "@unknown", chatId: "5", text: "hi" })).rejects.toMatchObject({ code: "unmatched_sender" });
    expect(called).toBe(false);
  });

  it("ports D18 transcript, artifact and usage; transcription failure forwards immediately", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-d18-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    let fail = false;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.test/mcp/alpha", downstreamToken: "token" }) },
      transcriber: {
        async transcribe() {
          if (fail) throw new Error("provider offline");
          return { text_transcript: "voice text", transcription_usage: { seconds: 2 }, transcription_source: "phylax@test" };
        },
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/alpha-token/artifacts/${tenantId}/${artifactId}`,
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: "council reply" }] };
      },
    });
    const passed = await organ.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat",
      media: { bytes: Buffer.from("ogg"), fileName: "voice.ogg", mimeType: "audio/ogg" },
    });
    expect(passed.handoff).toMatchObject({ sender: "34611111111", text_transcript: "voice text", transcription_usage: { seconds: 2 }, transcription_source: "phylax@test" });
    expect(passed.handoff.artifact_ref).toMatch(/^https:\/\/phylax\.zenod\.dev\/mcp\/alpha-token\/artifacts\/alpha\//);
    expect(existsSync(join(phylaxWhatsAppPaths(dataDir).artifacts, "alpha"))).toBe(true);

    fail = true;
    const degraded = await Promise.race([
      organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat",
        media: { bytes: Buffer.from("ogg2"), fileName: "voice2.ogg", mimeType: "audio/ogg" },
      }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("D18 failure path queued")), 250)),
    ]);
    expect(degraded.handoff).toMatchObject({ transcription_failed: { code: "unavailable", message: "provider offline" } });
    expect(calls).toHaveLength(2);
    expect(calls[1].arguments.message).toContain("transcription_failed");
    expect(calls[1].route.tenantId).toBe("alpha");
  });

  it("uses only the fresh Phylax-owned /data/whatsapp shape", () => {
    expect(phylaxWhatsAppPaths("/data")).toEqual({
      root: "/data/whatsapp",
      session: "/data/whatsapp/session",
      store: "/data/whatsapp/whatsapp.sqlite",
      artifacts: "/data/whatsapp/artifacts",
    });
  });
});

describe("Phylax MCP channel tools", () => {
  it("registers send_message, notify and channel_status through conduct and returns receipts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-tools-"));
    dirs.push(dataDir);
    const tenantStore = createMemoryTenantStore([{ token: "alpha-token", tenant: { id: "alpha", name: "Alpha" } }]);
    const unit = createUnit({
      name: "phylax",
      tenantAuth: { store: tenantStore },
      storage: { dataDir },
      conduct: { toolKinds: { read: ["channel_status"], mutate: ["send_message", "notify"] } },
      tools(server) {
        registerPhylaxChannelTools(server, {
          async send(channel, recipient) {
            return { channel, recipient, sentMessageId: "provider-1", status: "sent", at: "2026-07-11T00:00:00.000Z" };
          },
          async notify() {
            return [{ channel: "telegram", recipient: "42", sentMessageId: "tg-1", status: "delivered", at: "2026-07-11T00:00:00.000Z" }];
          },
          status() {
            return { whatsapp: "connected", telegram: "connected" };
          },
        });
      },
    });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const client = new Client({ name: "phylax-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp/alpha-token`)));
    try {
      const sent = await client.callTool({ name: "send_message", arguments: { channel: "whatsapp", recipient: "34611111111", text: "hello" } });
      expect(sent.isError).not.toBe(true);
      expect(sent.structuredContent).toMatchObject({ evidence: [{ kind: "message_delivery", id: "provider-1", status: "sent" }] });
      expect(JSON.stringify(sent)).not.toContain("silent_ack");

      const notified = await client.callTool({ name: "notify", arguments: { text: "done" } });
      expect(notified.isError).not.toBe(true);
      expect(notified.structuredContent).toMatchObject({ evidence: [{ kind: "message_delivery", id: "tg-1", status: "delivered" }] });

      const status = await client.callTool({ name: "channel_status", arguments: {} });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toEqual({ status: { whatsapp: "connected", telegram: "connected" } });
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails loudly when a delivery adapter returns no receipt", async () => {
    expect(() => {
      throw new PhylaxChannelError("delivery_error", "channel returned no delivery receipt");
    }).toThrow("channel returned no delivery receipt");
  });
});

describe("ported gateway integration", () => {
  it("feeds Baileys inbound through the tenant seam and sends the Ring reply through the same socket", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-ported-runtime-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const sent: Array<{ jid: string; text: string }> = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/alpha", downstreamToken: "ring-alpha" }) },
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: "Council: ported reply" }] };
      },
    });
    const listeners = new Map<string, (...args: never[]) => void>();
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {}, {
      whatsappSocketFactory: async () => ({
        ev: { on(event, listener) { listeners.set(event, listener as (...args: never[]) => void); } },
        user: { id: "34999999999@s.whatsapp.net" },
        async sendMessage(jid, content) {
          sent.push({ jid, text: content.text });
          return { key: { id: `sent-${sent.length}` } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    const event: WhatsAppInboundEvent = {
      messageId: "wa-1",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "hello council",
      hasMedia: false,
      mediaType: null,
      mimeType: null,
      fileName: null,
    };
    try {
      await runtime.whatsapp.handleEvent(event);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ route: { tenantId: "alpha", downstreamToken: "ring-alpha" }, arguments: { message: "hello council" } });
      expect(sent).toEqual([{ jid: "34611111111@s.whatsapp.net", text: "Council: ported reply" }]);
      expect(runtime.whatsappStore.recentTranscript({ messageId: "wa-1", sinceMs: 0 })).toEqual(expect.arrayContaining([
        expect.objectContaining({ direction: "inbound", status: "replied" }),
        expect.objectContaining({ direction: "outbound", sentMessageId: "sent-1", status: "sent" }),
      ]));
    } finally {
      runtime.close();
    }
  });

  it("forwards captioned and uncaptioned images once with authenticated artifacts and metadata", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-ported-images-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const sent: Array<{ jid: string; text: string }> = [];
    let transcriptionCalls = 0;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/alpha", downstreamToken: "ring-alpha" }) },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/customer-unit-token/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe() {
          transcriptionCalls += 1;
          throw new Error("image bytes must not reach transcription");
        },
      },
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: `Council image reply ${calls.length}` }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {}, {
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        user: { id: "34999999999@s.whatsapp.net" },
        async sendMessage(jid, content) {
          sent.push({ jid, text: content.text });
          return { key: { id: `sent-${sent.length}` } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    const image = (messageId: string, body: string, mimeType: string): WhatsAppInboundEvent => ({
      messageId,
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body,
      hasMedia: true,
      mediaType: "image",
      mimeType,
      fileName: null,
      mediaRaw: {},
    });
    try {
      await runtime.whatsapp.handleEvent(image("wa-image-captioned", "please inspect this", "image/png"));
      await runtime.whatsapp.handleEvent(image("wa-image-plain", "", "image/jpeg"));

      expect(calls).toHaveLength(2);
      expect(transcriptionCalls).toBe(0);
      expect(sent).toEqual([
        { jid: "34611111111@s.whatsapp.net", text: "Council image reply 1" },
        { jid: "34611111111@s.whatsapp.net", text: "Council image reply 2" },
      ]);
      expect(calls[0].handoff).toMatchObject({
        text_transcript: "please inspect this",
        artifact_mime_type: "image/png",
        artifact_file_name: "wa-image-captioned.png",
      });
      expect(calls[1].handoff).toMatchObject({
        artifact_mime_type: "image/jpeg",
        artifact_file_name: "wa-image-plain.jpg",
      });
      expect(calls[1].arguments.message).toContain("A channel artifact was received.");
      for (const call of calls) {
        expect(call.handoff.artifact_ref).toMatch(/^https:\/\/phylax\.zenod\.dev\/mcp\/customer-unit-token\/artifacts\/alpha\//);
        expect(call.arguments.message).toContain(call.handoff.artifact_ref!);
      }
      const artifactDir = join(phylaxWhatsAppPaths(dataDir).artifacts, "alpha");
      const { readdir, readFile } = await import("node:fs/promises");
      const artifacts = await readdir(artifactDir);
      expect(artifacts).toHaveLength(2);
      await Promise.all(artifacts.map(async (file) => {
        expect(await readFile(join(artifactDir, file))).toEqual(Buffer.from("immutable-image-bytes"));
      }));
      expect(runtime.whatsappStore.recentTranscript({ sinceMs: 0 }).filter((entry) => entry.direction === "outbound")).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });
});
