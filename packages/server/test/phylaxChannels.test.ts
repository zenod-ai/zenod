import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
import {
  phylaxTranscriptionConfigurationError,
  phylaxTranscriptionOptions,
} from "../src/phylaxUnit.js";
import { WhatsAppStore, type WhatsAppInboundEvent } from "../src/whatsappStore.js";

const dirs: string[] = [];

vi.mock("@whiskeysockets/baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whiskeysockets/baileys")>();
  return {
    ...actual,
    downloadContentFromMessage: vi.fn(async function* (input?: { testBytes?: string }) {
      yield Buffer.from(input?.testBytes ?? "immutable-image-bytes");
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
    expect(passed.artifactSha256).toBe("90308fe99871113bf5490ec73a8813b667adc60fe01530102a6c7bfb73c66481");
    expect(passed.evidence[0]).toMatchObject({
      downstream_url: "https://ring.test",
      downstream_identity: "ring.test#tenant:alpha",
    });
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

  it("bounds transcription, preserves the artifact, and forwards a typed timeout to Ring", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-transcription-timeout-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    let aborted = false;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      transcriptionDeadlineMs: 100,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.test/mcp/alpha", downstreamToken: "token" }) },
      transcriber: {
        async transcribe({ signal }) {
          await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          }, { once: true }));
          return {};
        },
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/token/artifacts/${tenantId}/${artifactId}`,
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: "I could not transcribe that voice note." }] };
      },
    });

    const result = await organ.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat",
      messageId: "voice-timeout",
      media: { bytes: Buffer.from("timeout-audio"), fileName: "voice.ogg", mimeType: "audio/ogg" },
    });

    expect(aborted).toBe(true);
    expect(result.handoff.transcription_failed).toMatchObject({ code: "timeout" });
    expect(result.handoff.artifact_ref).toMatch(/^https:\/\/phylax\.zenod\.dev\/mcp\/token\/artifacts\/alpha\//);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments.message).toContain('"code":"timeout"');
    expect(existsSync(join(phylaxWhatsAppPaths(dataDir).artifacts, "alpha"))).toBe(true);
  });

  it("uses a safe local model policy and requires tenant keys for cloud audio", () => {
    const signal = new AbortController().signal;
    const localDefault = phylaxTranscriptionOptions(
      { provider: "local", model: null, key: null },
      { GROQ_API_KEY: "must-not-leak", OPENAI_API_KEY: "must-not-leak" },
      signal,
    );
    expect(localDefault).toMatchObject({
      model: "small",
      groqApiKey: "",
      openaiApiKey: "",
      openrouterApiKey: "",
      includeTiming: true,
    });
    expect(phylaxTranscriptionOptions(
      { provider: "local", model: "base", key: null },
      {},
      signal,
    ).model).toBe("base");
    expect(phylaxTranscriptionConfigurationError({ provider: "local", model: "not-a-model", key: null }))
      .toContain("unsupported local transcription model");
    expect(phylaxTranscriptionOptions(
      { provider: "local", model: "not-a-model", key: null },
      { PHYLAX_LOCAL_WHISPER_MODEL: "also-invalid" },
      signal,
    ).model).toBe("small");
    expect(phylaxTranscriptionConfigurationError({ provider: "groq", model: null, key: null }))
      .toBe("groq transcription requires a tenant-configured provider key");
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
  it("migrates an existing W-P3 audit table additively", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-recovery-migration-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    await mkdir(join(dataDir, "whatsapp"), { recursive: true });
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE whatsapp_channel_audit (
        provider_message_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        transcript_text TEXT,
        transcript_provenance TEXT,
        artifact_ref TEXT,
        artifact_sha256 TEXT,
        downstream_destination TEXT NOT NULL,
        downstream_correlation_id TEXT,
        downstream_receipt_json TEXT,
        lifecycle_state TEXT NOT NULL,
        outbound_provider_id TEXT,
        outbound_status TEXT,
        forwarded_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    legacy.close();

    const migrated = new WhatsAppStore(path);
    migrated.recordChannelForwarding({
      providerMessageId: "migration-media-001",
      tenantId: "alpha",
      senderId: "34611111111",
      downstreamDestination: "ring.zenod.dev#tenant:alpha",
      replyText: "bounded reply persisted after migration",
    });
    expect(migrated.channelAudit("migration-media-001")).toMatchObject({
      replyText: "bounded reply persisted after migration",
      lifecycleState: "forwarded",
      timing: {
        mediaDownloadMs: null,
        transcriptionQueueWaitMs: null,
        transcriptionRuntimeMs: null,
        downstreamMs: null,
        outboundSendMs: null,
        totalLifecycleMs: null,
      },
    });
    migrated.recordChannelTiming("migration-media-001", {
      mediaDownloadMs: 11,
      transcriptionQueueWaitMs: 22,
      transcriptionRuntimeMs: 33,
      downstreamMs: 44,
      outboundSendMs: 55,
      totalLifecycleMs: 165,
    });
    expect(migrated.channelAudit("migration-media-001")?.timing).toEqual({
      mediaDownloadMs: 11,
      transcriptionQueueWaitMs: 22,
      transcriptionRuntimeMs: 33,
      downstreamMs: 44,
      outboundSendMs: 55,
      totalLifecycleMs: 165,
    });
    migrated.close();
  });

  it("does not enqueue or notify historical interrupted media during migration", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-recovery-historical-"));
    dirs.push(dataDir);
    const event: WhatsAppInboundEvent = {
      messageId: "historical-interrupted-media",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: "old.ogg",
    };
    const before = new WhatsAppStore(phylaxWhatsAppPaths(dataDir).store);
    before.recordInbound(event);
    before.markMessageStatus(event.messageId, "interrupted");
    before.close();

    const sent: string[] = [];
    let connectionUpdate: ((update: Record<string, unknown>) => void) | undefined;
    const runtime = new PhylaxPortedRuntime(dataDir, new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => null },
    }), {}, {
      whatsappSocketFactory: async () => ({
        ev: {
          on(eventName, listener) {
            if (eventName === "connection.update") connectionUpdate = listener;
          },
        },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: "must-not-send" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    try {
      expect(runtime.whatsappStore.mediaRecovery(event.messageId)).toBeNull();
      await runtime.whatsapp.start();
      connectionUpdate?.({ connection: "open" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sent).toEqual([]);
      expect(runtime.whatsappStore.mediaRecovery(event.messageId)).toBeNull();
    } finally {
      runtime.close();
    }
  });

  it("joins a media provider id to artifact hash, transcript provenance, typed Ring receipt and outbound delivery", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-media-trace-"));
    dirs.push(dataDir);
    const store = new WhatsAppStore(join(dataDir, "whatsapp.sqlite"));
    const event: WhatsAppInboundEvent = {
      messageId: "provider-media-001",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: "provider-media-001.ogg",
    };
    store.recordInbound(event);
    store.markMessageStatus(event.messageId, "processing");
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/token-bearing-path", downstreamToken: "ring-secret" }) },
      transcriber: { async transcribe() { return {
        text_transcript: "strawberry banana",
        transcription_source: "whisper.cpp@large-v3-turbo",
        transcription_usage: { seconds: 1.25 },
        transcription_timing: { queue_wait_ms: 23, runtime_ms: 45 },
      }; } },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/artifacts/${tenantId}/${artifactId}`,
      async callDownstream() {
        return {
          content: [{ type: "text", text: "strawberry banana" }],
          structuredContent: {
            correlation_id: "ring-media-correlation-001",
            receipt: {
              kind: "ring_reply",
              id: "ring-media-receipt-001",
              status: "completed",
              authorization: "Bearer do-not-store",
              evidence: [{ kind: "mailbox", id: "mailbox-001", url: "https://ring.zenod.dev/mcp/secret" }],
            },
          },
        };
      },
    });
    const forwarded = await organ.receive({
      channel: "whatsapp",
      sender: event.senderId,
      chatId: event.chatId,
      messageId: event.messageId,
      media: { bytes: Buffer.from("deterministic-voice-bytes"), mimeType: "audio/ogg", fileName: event.fileName },
    });
    store.recordChannelForwarding({
      providerMessageId: event.messageId,
      tenantId: forwarded.tenantId,
      senderId: forwarded.sender,
      transcriptText: forwarded.handoff.text_transcript,
      transcriptProvenance: forwarded.handoff.transcription_source,
      artifactRef: forwarded.handoff.artifact_ref,
      artifactSha256: forwarded.artifactSha256,
      downstreamDestination: forwarded.downstreamDestination,
      downstreamCorrelationId: forwarded.downstreamCorrelationId,
      downstreamReceipt: forwarded.downstreamReceipt,
      timing: {
        mediaDownloadMs: 12,
        transcriptionQueueWaitMs: forwarded.timing.transcriptionQueueWaitMs,
        transcriptionRuntimeMs: forwarded.timing.transcriptionRuntimeMs,
        downstreamMs: 67,
      },
    });
    store.recordOutboundAudit({
      messageId: event.messageId,
      chatId: event.chatId,
      contactId: event.senderId,
      bodyText: forwarded.replyText,
      status: "sent",
      sentMessageId: "wa-outbound-001",
    });
    store.markMessageStatus(event.messageId, "replied");
    store.recordChannelTiming(event.messageId, { outboundSendMs: 8, totalLifecycleMs: 155 });

    const trace = store.channelAudit(event.messageId);
    expect(trace).toMatchObject({
      providerMessageId: "provider-media-001",
      tenantId: "alpha",
      senderId: "34611111111",
      transcriptText: "strawberry banana",
      transcriptProvenance: "whisper.cpp@large-v3-turbo",
      artifactSha256: "91775098c42b14bb4ffa638c03195ffcf02523fd7b12c64c17d9ea99e817b03a",
      downstreamDestination: "ring.zenod.dev#tenant:alpha",
      downstreamCorrelationId: "ring-media-correlation-001",
      downstreamReceipt: { kind: "ring_reply", id: "ring-media-receipt-001", status: "completed", evidence: [{ kind: "mailbox", id: "mailbox-001" }] },
      lifecycleState: "replied",
      outboundProviderId: "wa-outbound-001",
      outboundStatus: "sent",
      timing: {
        mediaDownloadMs: 12,
        transcriptionQueueWaitMs: 23,
        transcriptionRuntimeMs: 45,
        downstreamMs: 67,
        outboundSendMs: 8,
        totalLifecycleMs: 155,
      },
    });
    expect(trace?.artifactRef).toMatch(/^https:\/\/phylax\.zenod\.dev\/artifacts\/alpha\//);
    expect(JSON.stringify(trace)).not.toMatch(/token-bearing-path|ring-secret|do-not-store|\/mcp\/secret|authorization/i);
    store.close();
  });

  it("reconciles a restart after an audited provider send without sending or forwarding again", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-restart-sent-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const event: WhatsAppInboundEvent = {
      messageId: "wa-media-already-sent",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
    };
    const before = new WhatsAppStore(path);
    before.recordInbound(event);
    before.markMessageStatus(event.messageId, "processing");
    before.recordChannelForwarding({
      providerMessageId: event.messageId,
      tenantId: "alpha",
      senderId: event.senderId,
      downstreamDestination: "ring.zenod.dev#tenant:alpha",
      downstreamCorrelationId: "ring-sent-001",
      replyText: "strawberry banana",
    });
    before.recordOutboundAudit({
      messageId: event.messageId,
      chatId: event.chatId,
      contactId: event.senderId,
      bodyText: "strawberry banana",
      status: "sent",
      sentMessageId: "wa-sent-before-restart",
    });
    before.close();

    const after = new WhatsAppStore(path);
    expect(after.channelAudit(event.messageId)).toMatchObject({
      lifecycleState: "replied",
      outboundProviderId: "wa-sent-before-restart",
      outboundStatus: "sent",
    });
    expect(after.mediaRecovery(event.messageId)).toBeNull();
    expect(after.diagnostics().processingCounts.replied).toBe(1);
    after.close();
  });

  it("recovers a forwarded media reply once after restart without calling Ring again", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-restart-forwarded-"));
    dirs.push(dataDir);
    const event: WhatsAppInboundEvent = {
      messageId: "wa-media-forwarded",
      chatId: "123456789012345@lid",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
    };
    const before = new WhatsAppStore(phylaxWhatsAppPaths(dataDir).store);
    before.recordInbound(event);
    before.markMessageStatus(event.messageId, "processing");
    before.recordChannelForwarding({
      providerMessageId: event.messageId,
      tenantId: "alpha",
      senderId: event.senderId,
      downstreamDestination: "ring.zenod.dev#tenant:alpha",
      downstreamCorrelationId: "ring-forwarded-001",
      downstreamReceipt: { kind: "ring_reply", id: "receipt-forwarded-001" },
      replyText: "strawberry banana",
    });
    before.close();

    let downstreamCalls = 0;
    const sent: Array<{ jid: string; text: string }> = [];
    let connectionUpdate: ((update: Record<string, unknown>) => void) | undefined;
    const runtime = new PhylaxPortedRuntime(dataDir, new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/alpha", downstreamToken: "ring-alpha" }) },
      async callDownstream() {
        downstreamCalls += 1;
        return { content: [{ type: "text", text: "must not happen" }] };
      },
    }), {}, {
      whatsappSocketFactory: async () => ({
        ev: {
          on(eventName, listener) {
            if (eventName === "connection.update") connectionUpdate = listener;
          },
        },
        user: { id: "34999999999@s.whatsapp.net" },
        async sendMessage(jid, content) {
          sent.push({ jid, text: content.text });
          return { key: { id: "wa-recovered-001" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    try {
      await runtime.whatsapp.start();
      connectionUpdate?.({ connection: "open" });
      await vi.waitFor(() => expect(runtime.whatsappStore.mediaRecovery(event.messageId)?.state).toBe("recovered_replied"));
      expect(sent).toEqual([{ jid: event.senderId, text: "strawberry banana" }]);
      expect(downstreamCalls).toBe(0);
      expect(runtime.whatsappStore.channelAudit(event.messageId)).toMatchObject({
        lifecycleState: "replied",
        outboundProviderId: "wa-recovered-001",
        outboundStatus: "recovery_sent",
      });

      connectionUpdate?.({ connection: "open" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sent).toHaveLength(1);
      expect(downstreamCalls).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it("makes a crash-after-claim terminal and does not retry an ambiguous provider send", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-restart-claimed-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const event: WhatsAppInboundEvent = {
      messageId: "wa-media-claimed",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "image",
      mimeType: "image/jpeg",
      fileName: "image.jpg",
    };
    const first = new WhatsAppStore(path);
    first.recordInbound(event);
    first.markMessageStatus(event.messageId, "processing");
    first.close();
    const restarted = new WhatsAppStore(path);
    expect(restarted.claimInterruptedMediaRecovery()).toMatchObject({
      providerMessageId: event.messageId,
      kind: "interrupted_failure",
      state: "claimed",
    });
    restarted.close();

    const sent: string[] = [];
    let connectionUpdate: ((update: Record<string, unknown>) => void) | undefined;
    const runtime = new PhylaxPortedRuntime(dataDir, new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => null },
    }), {}, {
      whatsappSocketFactory: async () => ({
        ev: {
          on(eventName, listener) {
            if (eventName === "connection.update") connectionUpdate = listener;
          },
        },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: "must-not-send" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    try {
      expect(runtime.whatsappStore.mediaRecovery(event.messageId)).toMatchObject({
        state: "provider_notification_failed",
        errorText: "recovery send outcome unknown after restart",
      });
      expect(runtime.whatsappStore.recentTranscript({ messageId: event.messageId, sinceMs: 0 })).toEqual(expect.arrayContaining([
        expect.objectContaining({
          direction: "inbound",
          status: "failed",
          mediaRecovery: expect.objectContaining({ state: "provider_notification_failed" }),
        }),
        expect.objectContaining({
          direction: "outbound",
          status: "recovery_unknown",
        }),
      ]));
      await runtime.whatsapp.start();
      connectionUpdate?.({ connection: "open" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sent).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it("notifies explicitly when restart interrupted media before the Ring boundary", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-restart-notice-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const event: WhatsAppInboundEvent = {
      messageId: "wa-media-before-ring",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
    };
    const before = new WhatsAppStore(path);
    before.recordInbound(event);
    before.markMessageStatus(event.messageId, "processing");
    before.close();

    const sent: Array<{ jid: string; text: string }> = [];
    let connectionUpdate: ((update: Record<string, unknown>) => void) | undefined;
    const runtime = new PhylaxPortedRuntime(dataDir, new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => null },
    }), {}, {
      whatsappSocketFactory: async () => ({
        ev: {
          on(eventName, listener) {
            if (eventName === "connection.update") connectionUpdate = listener;
          },
        },
        async sendMessage(jid, content) {
          sent.push({ jid, text: content.text });
          return { key: { id: "wa-notice-001" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    try {
      await runtime.whatsapp.start();
      connectionUpdate?.({ connection: "open" });
      await vi.waitFor(() => expect(runtime.whatsappStore.mediaRecovery(event.messageId)?.state).toBe("failure_notified"));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ jid: event.senderId });
      expect(sent[0]?.text).toContain("will not retry it automatically to avoid duplicate delivery");
      expect(runtime.whatsappStore.recentTranscript({ messageId: event.messageId, sinceMs: 0 })).toEqual(expect.arrayContaining([
        expect.objectContaining({
          direction: "inbound",
          status: "failed_notified",
          mediaRecovery: expect.objectContaining({ state: "failure_notified", outboundProviderId: "wa-notice-001" }),
        }),
        expect.objectContaining({ direction: "outbound", status: "recovery_notice_sent", sentMessageId: "wa-notice-001" }),
      ]));
    } finally {
      runtime.close();
    }
  });

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
        return {
          content: [{ type: "text", text: "Council: ported reply corr-in-prose-must-not-win" }],
          structuredContent: {
            correlationId: "ring-correlation-001",
            receipt: {
              kind: "ring_reply",
              id: "ring-receipt-001",
              status: "completed",
              downstream_url: "https://ring.zenod.dev/mcp/secret-token",
            },
          },
        };
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
      expect(sent).toEqual([{ jid: "34611111111@s.whatsapp.net", text: "Council: ported reply corr-in-prose-must-not-win" }]);
      expect(runtime.whatsappStore.recentTranscript({ messageId: "wa-1", sinceMs: 0 })).toEqual(expect.arrayContaining([
        expect.objectContaining({ direction: "inbound", status: "replied" }),
        expect.objectContaining({ direction: "outbound", sentMessageId: "sent-1", status: "sent" }),
      ]));
      const trace = runtime.whatsappStore.channelAudit("wa-1");
      expect(trace).toMatchObject({
        providerMessageId: "wa-1",
        tenantId: "alpha",
        senderId: "34611111111",
        transcriptText: "hello council",
        transcriptProvenance: "whatsapp-text",
        downstreamDestination: "ring.zenod.dev#tenant:alpha",
        downstreamCorrelationId: "ring-correlation-001",
        downstreamReceipt: { kind: "ring_reply", id: "ring-receipt-001", status: "completed" },
        lifecycleState: "replied",
        outboundProviderId: "sent-1",
        outboundStatus: "sent",
        timing: {
          mediaDownloadMs: null,
          transcriptionQueueWaitMs: null,
          transcriptionRuntimeMs: null,
          downstreamMs: expect.any(Number),
          outboundSendMs: expect.any(Number),
          totalLifecycleMs: expect.any(Number),
        },
      });
      expect(JSON.stringify(trace)).not.toContain("secret-token");
      expect(trace?.downstreamCorrelationId).not.toBe("corr-in-prose-must-not-win");
      expect(runtime.whatsappStore.recentTranscript({ messageId: "wa-1", sinceMs: 0 })).toEqual(expect.arrayContaining([
        expect.objectContaining({
          direction: "inbound",
          channelAudit: expect.objectContaining({ downstreamCorrelationId: "ring-correlation-001", outboundProviderId: "sent-1" }),
        }),
      ]));
    } finally {
      runtime.close();
    }
  });

  it("sends one truthful slow-voice progress receipt only for the coalescing owner, then one terminal reply", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-progress-"));
    dirs.push(dataDir);
    const sent: Array<{ jid: string; text: string }> = [];
    let transcriptionCalls = 0;
    let downstreamCalls = 0;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.test/mcp/alpha", downstreamToken: "token" }) },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/token/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe() {
          transcriptionCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 180));
          return {
            text_transcript: "strawberry banana",
            transcription_source: "whisper.cpp small",
            transcription_timing: { queue_wait_ms: 0, runtime_ms: 180 },
          };
        },
      },
      async callDownstream() {
        downstreamCalls += 1;
        return { content: [{ type: "text", text: "strawberry banana" }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {
      PHYLAX_MEDIA_COALESCE_WINDOW_MS: "60000",
      PHYLAX_VOICE_PROGRESS_DELAY_MS: "100",
    }, {
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
    const event = (messageId: string): WhatsAppInboundEvent => ({
      messageId,
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: null,
      mediaRaw: { testBytes: "same-voice-bytes" },
    });
    try {
      await Promise.all([
        runtime.whatsapp.handleEvent(event("voice-owner")),
        runtime.whatsapp.handleEvent(event("voice-duplicate")),
      ]);
      expect(transcriptionCalls).toBe(1);
      expect(downstreamCalls).toBe(1);
      expect(sent.map((entry) => entry.text)).toEqual([
        "I received your voice note and I’m still processing it.",
        "strawberry banana",
      ]);
      const outbound = runtime.whatsappStore.recentTranscript({ sinceMs: 0 })
        .filter((entry) => entry.direction === "outbound");
      expect(outbound).toHaveLength(2);
      expect(outbound.map((entry) => entry.status)).toEqual(["processing", "sent"]);
      const traces = ["voice-owner", "voice-duplicate"].map((messageId) => runtime.whatsappStore.channelAudit(messageId));
      expect(traces.filter((trace) => trace?.lifecycleState === "replied")).toHaveLength(1);
      expect(traces.filter((trace) => trace?.lifecycleState === "coalesced")).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });

  it("makes a timed-out voice terminal at the provider with its typed failure and artifact intact", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-timeout-terminal-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const sent: string[] = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      transcriptionDeadlineMs: 100,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.test/mcp/alpha", downstreamToken: "token" }) },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/token/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe({ signal }) {
          await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
          return {};
        },
      },
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: "Please retry that voice note." }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, { PHYLAX_VOICE_PROGRESS_DELAY_MS: "30000" }, {
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: "terminal-timeout-reply" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    const event: WhatsAppInboundEvent = {
      messageId: "voice-timeout-terminal",
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: 1,
      body: "",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: null,
      mediaRaw: { testBytes: "terminal-timeout-audio" },
    };
    try {
      await runtime.whatsapp.handleEvent(event);
      expect(sent).toEqual(["Please retry that voice note."]);
      expect(calls).toHaveLength(1);
      expect(calls[0].handoff.transcription_failed).toMatchObject({ code: "timeout" });
      expect(calls[0].handoff.artifact_ref).toMatch(/^https:\/\/phylax\.zenod\.dev\/mcp\/token\/artifacts\/alpha\//);
      expect(runtime.whatsappStore.channelAudit(event.messageId)).toMatchObject({
        lifecycleState: "replied",
        outboundProviderId: "terminal-timeout-reply",
        outboundStatus: "sent",
      });
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
      mediaRaw: { testBytes: messageId },
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
      const archived = await Promise.all(artifacts.map(async (file) => (await readFile(join(artifactDir, file))).toString()));
      expect(archived.sort()).toEqual(["wa-image-captioned", "wa-image-plain"]);
      expect(runtime.whatsappStore.recentTranscript({ sinceMs: 0 }).filter((entry) => entry.direction === "outbound")).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });

  it("atomically coalesces 20 identical media contenders to one downstream call and one provider reply", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-media-coalescing-"));
    dirs.push(dataDir);
    let downstreamCalls = 0;
    const sent: Array<{ jid: string; text: string }> = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/alpha", downstreamToken: "ring-alpha" }) },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/customer-token/artifacts/${tenantId}/${artifactId}`,
      async callDownstream() {
        downstreamCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          content: [{ type: "text", text: "strawberry banana" }],
          structuredContent: { correlationId: "ring-coalesced-001", receipt: { kind: "ring_reply", id: "receipt-001" } },
        };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, { PHYLAX_MEDIA_COALESCE_WINDOW_MS: "60000" }, {
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
    const event = (index: number): WhatsAppInboundEvent => ({
      messageId: `wa-coalesce-${String(index).padStart(2, "0")}`,
      chatId: "34611111111@s.whatsapp.net",
      senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha",
      chatName: "Alpha",
      isGroup: false,
      timestamp: index + 1,
      body: "",
      hasMedia: true,
      mediaType: "image",
      mimeType: "image/png",
      fileName: "same.png",
      mediaRaw: {},
    });
    try {
      await Promise.all(Array.from({ length: 20 }, (_, index) => runtime.whatsapp.handleEvent(event(index))));
      expect(downstreamCalls).toBe(1);
      expect(sent).toEqual([{ jid: "34611111111@s.whatsapp.net", text: "strawberry banana" }]);
      const traces = Array.from({ length: 20 }, (_, index) =>
        runtime.whatsappStore.recentTranscript({ messageId: event(index).messageId, sinceMs: 0 })
          .find((entry) => entry.direction === "inbound")!,
      );
      const owners = traces.filter((trace) => trace.mediaCoalescing?.role === "owner");
      expect(owners).toHaveLength(1);
      const canonicalId = owners[0].messageId;
      expect(traces.map((trace) => trace.mediaCoalescing)).toEqual(
        expect.arrayContaining(Array.from({ length: 20 }, () => expect.objectContaining({
          canonicalProviderMessageId: canonicalId,
          artifactSha256: "941e94c100343d71b0d41608c8bf1c469eddfc8e1097768348f9a5d7d7a054f3",
          state: "completed",
        }))),
      );
      expect(traces.filter((trace) => trace.channelAudit?.lifecycleState === "coalesced")).toHaveLength(19);
      expect(new Set(traces.map((trace) => trace.channelAudit?.downstreamCorrelationId))).toEqual(new Set(["ring-coalesced-001"]));
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(join(phylaxWhatsAppPaths(dataDir).artifacts, "alpha"))).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });

  it("retains linked failed traces for 20 contenders when the canonical downstream call fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-media-coalescing-failed-"));
    dirs.push(dataDir);
    let downstreamCalls = 0;
    const sent: string[] = [];
    const runtime = new PhylaxPortedRuntime(dataDir, new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.zenod.dev/mcp/alpha", downstreamToken: "ring-alpha" }) },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/customer-token/artifacts/${tenantId}/${artifactId}`,
      async callDownstream() {
        downstreamCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("Ring unavailable");
      },
    }), { PHYLAX_MEDIA_COALESCE_WINDOW_MS: "60000" }, {
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: `sent-${sent.length}` } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    const event = (index: number): WhatsAppInboundEvent => ({
      messageId: `wa-failed-${index}`, chatId: "34611111111@s.whatsapp.net", senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha", chatName: "Alpha", isGroup: false, timestamp: index + 1, body: "", hasMedia: true,
      mediaType: "image", mimeType: "image/png", fileName: "same.png", mediaRaw: {},
    });
    try {
      await Promise.all(Array.from({ length: 20 }, (_, index) => runtime.whatsapp.handleEvent(event(index))));
      expect(downstreamCalls).toBe(1);
      expect(sent).toHaveLength(1);
      const records = Array.from({ length: 20 }, (_, index) => runtime.whatsappStore.mediaCoalescing(event(index).messageId)!);
      const owner = records.find((record) => record.role === "owner")!;
      expect(records).toEqual(expect.arrayContaining(Array.from({ length: 20 }, () => expect.objectContaining({
        canonicalProviderMessageId: owner.providerMessageId,
        state: "failed",
      }))));
      for (let index = 0; index < 20; index += 1) {
        expect(runtime.whatsappStore.recentTranscript({ messageId: event(index).messageId, sinceMs: 0 })[0]?.mediaCoalescing)
          .toMatchObject({ canonicalProviderMessageId: owner.providerMessageId, state: "failed" });
      }
    } finally {
      runtime.close();
    }
  });

  it("scopes payload coalescing by tenant, channel, and a finite window", () => {
    const store = new WhatsAppStore(":memory:");
    const claim = (providerMessageId: string, tenantId: string, channel: "whatsapp" | "telegram", now: number) =>
      store.claimMediaCoalescing({ providerMessageId, tenantId, channel, artifactSha256: "a".repeat(64), windowMs: 1_000, now });
    expect(claim("alpha-wa-owner", "alpha", "whatsapp", 10_000).role).toBe("owner");
    expect(claim("alpha-wa-duplicate", "alpha", "whatsapp", 10_500)).toMatchObject({
      role: "duplicate", canonicalProviderMessageId: "alpha-wa-owner",
    });
    expect(claim("beta-wa-owner", "beta", "whatsapp", 10_500).role).toBe("owner");
    expect(claim("alpha-tg-owner", "alpha", "telegram", 10_500).role).toBe("owner");
    expect(claim("alpha-wa-later-owner", "alpha", "whatsapp", 11_001).role).toBe("owner");
    store.close();
  });

  it("marks restart-orphan followers failed without Ring and preserves their provider-ID trace", () => {
    const path = join(tmpdir(), `phylax-coalescing-orphan-${Date.now()}.sqlite`);
    dirs.push(path);
    const event = (messageId: string): WhatsAppInboundEvent => ({
      messageId, chatId: "34611111111@s.whatsapp.net", senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha", chatName: "Alpha", isGroup: false, timestamp: 1, body: "", hasMedia: true,
      mediaType: "image", mimeType: "image/png", fileName: "same.png",
    });
    const before = new WhatsAppStore(path);
    before.recordInbound(event("orphan-owner"));
    before.markMessageStatus("orphan-owner", "processing");
    before.claimMediaCoalescing({
      providerMessageId: "orphan-owner", tenantId: "alpha", channel: "whatsapp",
      artifactSha256: "b".repeat(64), windowMs: 60_000, now: 10_000,
    });
    before.close();

    const after = new WhatsAppStore(path);
    after.recordInbound(event("orphan-follower"));
    after.markMessageStatus("orphan-follower", "coalesced");
    expect(after.claimMediaCoalescing({
      providerMessageId: "orphan-follower", tenantId: "alpha", channel: "whatsapp",
      artifactSha256: "b".repeat(64), windowMs: 60_000, now: 10_100,
    })).toMatchObject({ role: "duplicate", canonicalProviderMessageId: "orphan-owner", state: "failed" });
    expect(after.recentTranscript({ messageId: "orphan-follower", sinceMs: 0 })[0]).toMatchObject({
      status: "coalesced",
      mediaCoalescing: { canonicalProviderMessageId: "orphan-owner", state: "failed" },
    });
    expect(after.mediaRecovery("orphan-owner")).toMatchObject({ state: "pending", kind: "interrupted_failure" });
    after.close();
  });

  it("reconciles a crash after provider send as completed coalescing on restart", () => {
    const path = join(tmpdir(), `phylax-coalescing-sent-${Date.now()}.sqlite`);
    dirs.push(path);
    const event: WhatsAppInboundEvent = {
      messageId: "sent-owner", chatId: "34611111111@s.whatsapp.net", senderId: "34611111111@s.whatsapp.net",
      senderName: "Alpha", chatName: "Alpha", isGroup: false, timestamp: 1, body: "", hasMedia: true,
      mediaType: "image", mimeType: "image/png", fileName: "same.png",
    };
    const before = new WhatsAppStore(path);
    before.recordInbound(event);
    before.markMessageStatus(event.messageId, "processing");
    before.claimMediaCoalescing({
      providerMessageId: event.messageId, tenantId: "alpha", channel: "whatsapp",
      artifactSha256: "c".repeat(64), windowMs: 60_000,
    });
    before.recordChannelForwarding({
      providerMessageId: event.messageId, tenantId: "alpha", senderId: event.senderId,
      downstreamDestination: "ring.zenod.dev#tenant:alpha", replyText: "done",
    });
    before.recordOutboundAudit({
      messageId: event.messageId, chatId: event.chatId, contactId: event.senderId,
      bodyText: "done", status: "sent", sentMessageId: "wa-sent-before-crash",
    });
    before.close();

    const after = new WhatsAppStore(path);
    expect(after.mediaCoalescing(event.messageId)).toMatchObject({ state: "completed" });
    expect(after.channelAudit(event.messageId)).toMatchObject({ lifecycleState: "replied", outboundProviderId: "wa-sent-before-crash" });
    after.close();
  });
});
