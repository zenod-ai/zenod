import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ChassisStorage, createMemoryTenantStore, createUnit } from "@zenod/mcp-chassis";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PhylaxChannelError,
  PhylaxChannelsOrgan,
  normalizePhylaxVoiceJobDeadlineMs,
  phylaxWhatsAppPaths,
  registerPhylaxChannelTools,
  type PhylaxDownstreamCall,
} from "../src/phylaxChannels.js";
import type { PeerToolResult } from "../src/peerClient.js";
import { PhylaxPortedRuntime } from "../src/phylaxPortedRuntime.js";
import { PhylaxTenantSettingsStore } from "../src/phylaxTenantSettings.js";
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
  it("normalizes the durable voice safety bound to a two-hour default and four-hour maximum", () => {
    expect(normalizePhylaxVoiceJobDeadlineMs(undefined)).toBe(2 * 60 * 60_000);
    expect(normalizePhylaxVoiceJobDeadlineMs(Number.NaN)).toBe(2 * 60 * 60_000);
    expect(normalizePhylaxVoiceJobDeadlineMs(8 * 60 * 60_000)).toBe(4 * 60 * 60_000);
    expect(normalizePhylaxVoiceJobDeadlineMs(30 * 60_000)).toBe(30 * 60_000);
  });

  it("dispatches a tenant voice binding mechanically, validates its live schema, and polls to a terminal receipt", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-binding-dispatch-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const route = {
      tenantId: "alpha",
      downstreamUrl: "https://zenod.test/mcp/memory",
      downstreamToken: "memory-scope-only",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: {
            content: { source: "transcript" as const },
            source: { source: "constant" as const, value: "whatsapp" },
          },
        },
        text: {
          tool: "chat_with_ring",
          argumentMappings: { message: { source: "message" as const } },
        },
        media: {
          tool: "chat_with_ring",
          argumentMappings: { message: { source: "message" as const } },
        },
      },
    };
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => route },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["content", "source", "idempotencyKey"],
            properties: {
              content: { type: "string", minLength: 1 },
              source: { const: "whatsapp" },
              idempotencyKey: { type: "string", minLength: 1 },
            },
          },
          description: "Store memory",
        }],
      }),
      async callDownstream(call) {
        calls.push(call);
        if (call.tool === "store_memory") {
          return {
            content: [{ type: "text", text: "queued" }],
            structuredContent: { ticket_id: "job-alpha-1", state: "accepted", status: "queued" },
          };
        }
        const db = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"), { readOnly: true });
        const persisted = db.prepare(
          "SELECT job_id FROM phylax_capture_jobs WHERE tenant_id = ? AND provider_message_id = ?",
        ).get("alpha", "provider-voice-1") as { job_id?: string } | undefined;
        db.close();
        expect(persisted?.job_id).toBe("job-alpha-1");
        expect(call).toMatchObject({
          tool: "get_task_result",
          arguments: { ticket_id: "job-alpha-1" },
        });
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: "job-alpha-1",
            state: "done",
            status: "done",
            result: {
              recap: "Remember the launch checklist.",
              evidenceRef: "Log/2026-07-29.md#^voice-1",
              evidenceUrl: "https://github.test/log#voice-1",
              pagesTouched: ["Projects/Launch.md"],
              pageUrls: ["https://github.test/projects/launch"],
              commitSha: "abc1234",
              githubUrls: ["https://github.test/commit/abc1234"],
              question: "Which owner should be listed?",
            },
          },
        };
      },
      capturePollIntervalMs: 1,
    });

    const receipt = await organ.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat-alpha",
      messageId: "provider-voice-1",
      transcription: { text_transcript: "Remember the launch checklist." },
    });

    expect(calls[0]).toMatchObject({
      tool: "store_memory",
      arguments: {
        content: "Remember the launch checklist.",
        source: "whatsapp",
        idempotencyKey: "alpha:whatsapp:provider-voice-1",
      },
    });
    expect(receipt.replyText).toContain("Saved ✓");
    expect(receipt.replyText).toContain("Projects/Launch.md");
    expect(receipt.replyText).toContain("abc1234");
    expect(receipt.replyText).toContain("Which owner should be listed?");
    expect(organ.lastCaptureEvidenceRef("alpha", "whatsapp:34611111111"))
      .toBe("Log/2026-07-29.md#^voice-1");
    await organ.close();
  });

  it("persists receipt refs across restart and routes only same-tenant WhatsApp text or voice replies to Ring", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-receipt-reply-"));
    dirs.push(dataDir);
    const captureRoute = {
      tenantId: "alpha",
      downstreamUrl: "https://zenod.test/mcp/alpha",
      downstreamToken: "alpha-memory-scope",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: { content: { source: "transcript" as const } },
        },
        text: {
          tool: "ring_reply",
          argumentMappings: { message: { source: "message" as const } },
        },
        media: {
          tool: "media_ingest",
          argumentMappings: { artifact: { source: "artifactUrl" as const } },
        },
      },
    };
    const first = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => captureRoute },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          inputSchema: {
            type: "object",
            required: ["content", "idempotencyKey"],
            properties: {
              content: { type: "string" },
              idempotencyKey: { type: "string" },
            },
          },
          description: "Store memory",
        }],
      }),
      capturePollIntervalMs: 1,
      async callDownstream(call) {
        if (call.tool === "store_memory") {
          return {
            content: [{ type: "text", text: "queued" }],
            structuredContent: { ticket_id: "receipt-seed-job", state: "accepted" },
          };
        }
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: "receipt-seed-job",
            state: "done",
            result: {
              evidenceRef: "Log/2026-07-29.md#^receipt-seed",
              pagesTouched: ["Inbox/Receipt seed.md"],
              commitSha: "abc1234",
              githubUrls: [],
            },
          },
        };
      },
    });
    await first.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "alpha-chat",
      messageId: "capture-provider-1",
      transcription: { text_transcript: "Remember the receipt seed." },
    });
    expect(first.recordCaptureReceiptDelivery(
      "whatsapp",
      "alpha",
      "capture-provider-1",
      "receipt-provider-1",
    )).toBe(true);
    await first.close();

    const calls: PhylaxDownstreamCall[] = [];
    const restarted = new PhylaxChannelsOrgan({
      dataDir,
      artifactUrl: (tenantId, artifactId) =>
        `https://phylax.test/artifacts/${tenantId}/${artifactId}`,
      routes: {
        resolve(_channel, sender) {
          const tenantId = sender.endsWith("111") ? "alpha" : "beta";
          return {
            tenantId,
            downstreamUrl: `https://zenod.test/mcp/${tenantId}`,
            downstreamToken: `${tenantId}-memory-scope`,
            turnBindings: {
              voice_note: {
                tool: "capture_voice",
                argumentMappings: { content: { source: "transcript" } },
              },
              text: {
                tool: "ring_reply",
                argumentMappings: { message: { source: "transcript" } },
              },
              media: {
                tool: "media_ingest",
                argumentMappings: { artifact: { source: "artifactUrl" } },
              },
            },
          };
        },
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [
          {
            as: "ring",
            mcp: "ring_reply",
            arg: "input",
            inputSchema: {
              type: "object",
              required: ["message"],
              properties: { message: { type: "string" } },
            },
            description: "Reply with Ring",
          },
          {
            as: "memory",
            mcp: "capture_voice",
            arg: "input",
            inputSchema: {
              type: "object",
              required: ["content"],
              properties: { content: { type: "string" } },
            },
            description: "Capture voice",
          },
          {
            as: "memory",
            mcp: "media_ingest",
            arg: "input",
            inputSchema: {
              type: "object",
              required: ["artifact"],
              properties: { artifact: { type: "string" } },
            },
            description: "Ingest media",
          },
        ],
      }),
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: `called ${call.tool}` }] };
      },
    });

    await restarted.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "alpha-chat",
      messageId: "reply-text-1",
      replyToMessageId: "receipt-provider-1",
      text: "What were the open questions?",
    });
    expect(calls.at(-1)).toMatchObject({
      route: { tenantId: "alpha" },
      tool: "ring_reply",
      handoff: {
        reply_context: { evidenceRef: "Log/2026-07-29.md#^receipt-seed" },
      },
    });
    expect(calls.at(-1)?.arguments.message).toContain("Log/2026-07-29.md#^receipt-seed");

    await restarted.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "alpha-chat",
      messageId: "reply-voice-1",
      replyToMessageId: "receipt-provider-1",
      transcription: { text_transcript: "Draft a tweet from that." },
    });
    expect(calls.at(-1)).toMatchObject({
      route: { tenantId: "alpha" },
      tool: "ring_reply",
      handoff: {
        text_transcript: "Draft a tweet from that.",
        reply_context: { evidenceRef: "Log/2026-07-29.md#^receipt-seed" },
      },
    });

    await restarted.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "alpha-chat",
      messageId: "unknown-reply-voice",
      replyToMessageId: "not-a-known-receipt",
      transcription: { text_transcript: "Capture this standalone voice note." },
    });
    expect(calls.at(-1)).toMatchObject({
      route: { tenantId: "alpha" },
      tool: "capture_voice",
      arguments: { content: "Capture this standalone voice note." },
    });
    expect(calls.at(-1)?.handoff.reply_context).toBeUndefined();

    await restarted.receive({
      channel: "whatsapp",
      sender: "34622222222",
      chatId: "beta-chat",
      messageId: "cross-tenant-reply-voice",
      replyToMessageId: "receipt-provider-1",
      transcription: { text_transcript: "Do not leak alpha evidence." },
    });
    expect(calls.at(-1)).toMatchObject({
      route: { tenantId: "beta" },
      tool: "capture_voice",
    });
    expect(JSON.stringify(calls.at(-1))).not.toContain("receipt-seed");

    await restarted.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "alpha-chat",
      messageId: "reply-image-1",
      replyToMessageId: "receipt-provider-1",
      text: "Screenshot caption",
      media: {
        bytes: Buffer.from("standalone-image"),
        mimeType: "image/png",
        fileName: "screenshot.png",
      },
    });
    expect(calls.at(-1)).toMatchObject({
      route: { tenantId: "alpha" },
      tool: "media_ingest",
    });
    expect(calls.at(-1)?.handoff.reply_context).toBeUndefined();
    await restarted.close();
  });

  it("keeps an accepted capture polling through a transient result outage and records only the later terminal success", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-binding-transient-poll-"));
    dirs.push(dataDir);
    let pollAttempts = 0;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://zenod.test/mcp/memory",
          downstreamToken: "memory-scope-only",
          turnBindings: {
            voice_note: {
              tool: "store_memory",
              argumentMappings: { content: { source: "transcript" } },
            },
            text: { tool: "chat_with_ring", argumentMappings: {} },
            media: { tool: "chat_with_ring", argumentMappings: {} },
          },
        }),
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          description: "Store memory",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["content", "idempotencyKey"],
            properties: {
              content: { type: "string", minLength: 1 },
              idempotencyKey: { type: "string", minLength: 1 },
            },
          },
        }],
      }),
      async callDownstream(call) {
        if (call.tool === "store_memory") {
          return {
            content: [{ type: "text", text: "queued" }],
            structuredContent: {
              ticket_id: "job-transient-1",
              state: "accepted",
            },
          };
        }
        pollAttempts += 1;
        const db = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"), { readOnly: true });
        const persisted = db.prepare(
          "SELECT state, receipt_text FROM phylax_capture_jobs WHERE job_id = ?",
        ).get("job-transient-1") as { state?: string; receipt_text?: string | null } | undefined;
        db.close();
        expect(persisted).toMatchObject({ state: "polling", receipt_text: null });
        if (pollAttempts === 1) {
          return {
            content: [{
              type: "text",
              text: 'Could not reach peer agent "phylax-memory-alpha": fetch failed',
            }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: "job-transient-1",
            state: "done",
            result: {
              recap: "Recovered after a transient poll outage.",
              evidenceRef: "Log/2026-07-29.md#^transient-poll",
              pagesTouched: ["Inbox/Recovered.md"],
              commitSha: "cab1234",
              githubUrls: [],
            },
          },
        };
      },
      capturePollIntervalMs: 1,
      sleep: async () => {},
    });

    const receipt = await organ.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat-alpha",
      messageId: "provider-transient-1",
      transcription: { text_transcript: "Remember this despite a brief outage." },
    });

    expect(pollAttempts).toBe(2);
    expect(receipt.replyText).toContain("Saved ✓");
    expect(receipt.replyText).toContain("Recovered after a transient poll outage.");
    expect(receipt.replyText).not.toContain("could not save");
    expect(organ.lastCaptureEvidenceRef("alpha", "whatsapp:34611111111"))
      .toBe("Log/2026-07-29.md#^transient-poll");
    await organ.close();
  });

  it("returns the honest pending receipt at the foreground deadline while a poll call remains stalled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T17:00:00.000Z"));
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-binding-stalled-poll-"));
    dirs.push(dataDir);
    let pollCalls = 0;
    const stalledForegroundPoll = new Promise<PeerToolResult>(() => {});
    let resolveBackgroundPoll!: (result: PeerToolResult) => void;
    const backgroundPoll = new Promise<PeerToolResult>((resolve) => {
      resolveBackgroundPoll = resolve;
    });
    const terminalResult: PeerToolResult = {
      content: [{ type: "text", text: "done" }],
      structuredContent: {
        ticket_id: "job-stalled-1",
        state: "done",
        result: {
          recap: "Recovered in the durable background poll.",
          evidenceRef: "Log/2026-07-29.md#^stalled-poll",
          pagesTouched: ["Inbox/Recovered.md"],
          commitSha: "dad1234",
          githubUrls: [],
        },
      },
    };
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://zenod.test/mcp/memory",
          downstreamToken: "memory-scope-only",
          turnBindings: {
            voice_note: {
              tool: "store_memory",
              argumentMappings: { content: { source: "transcript" } },
            },
            text: { tool: "chat_with_ring", argumentMappings: {} },
            media: { tool: "chat_with_ring", argumentMappings: {} },
          },
        }),
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          description: "Store memory",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["content", "idempotencyKey"],
            properties: {
              content: { type: "string", minLength: 1 },
              idempotencyKey: { type: "string", minLength: 1 },
            },
          },
        }],
      }),
      async callDownstream(call) {
        if (call.tool === "store_memory") {
          return {
            content: [{ type: "text", text: "queued" }],
            structuredContent: {
              ticket_id: "job-stalled-1",
              state: "accepted",
            },
          };
        }
        pollCalls += 1;
        return pollCalls === 1 ? stalledForegroundPoll : backgroundPoll;
      },
      captureForegroundDeadlineMs: 100,
      capturePollIntervalMs: 1,
    });

    try {
      let foregroundSettled = false;
      const receiptPromise = organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat-alpha",
        messageId: "provider-stalled-1",
        transcription: { text_transcript: "Remember this despite a stalled poll." },
      }).then((receipt) => {
        foregroundSettled = true;
        return receipt;
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(foregroundSettled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const receipt = await receiptPromise;

      expect(receipt.replyText).toBe(
        "I’m still filing this memory — I’ll confirm here when it is saved.",
      );
      expect(pollCalls).toBeGreaterThanOrEqual(1);
      const db = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"), { readOnly: true });
      const persisted = db.prepare(
        "SELECT state, receipt_text FROM phylax_capture_jobs WHERE job_id = ?",
      ).get("job-stalled-1") as { state?: string; receipt_text?: string | null } | undefined;
      db.close();
      expect(persisted).toMatchObject({ state: "polling", receipt_text: null });

      receipt.afterReply?.();
      for (let index = 0; index < 10 && pollCalls < 2; index += 1) {
        await Promise.resolve();
      }
      expect(pollCalls).toBe(2);
      resolveBackgroundPoll(terminalResult);
      await vi.advanceTimersByTimeAsync(0);
      expect(organ.lastCaptureEvidenceRef("alpha", "whatsapp:34611111111"))
        .toBe("Log/2026-07-29.md#^stalled-poll");
    } finally {
      resolveBackgroundPoll(terminalResult);
      await vi.advanceTimersByTimeAsync(0);
      await organ.close();
      vi.useRealTimers();
    }
  });

  it("maps structural artifact fields and derives every ingest media class without envelope fallback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-structural-media-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const structuralBinding = {
      tool: "inspect_media",
      argumentMappings: {
        artifactUrl: { source: "artifactUrl" as const },
        mediaType: { source: "mediaType" as const },
        filename: { source: "filename" as const },
      },
    };
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://zenod.test/mcp/memory",
          downstreamToken: "memory-scope-only",
          turnBindings: {
            voice_note: structuralBinding,
            text: structuralBinding,
            media: structuralBinding,
          },
        }),
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "inspect",
          mcp: "inspect_media",
          arg: "input",
          description: "Inspect structural media arguments",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["artifactUrl", "mediaType", "filename"],
            properties: {
              artifactUrl: { type: "string", minLength: 1 },
              mediaType: {
                enum: ["audio", "screenshot", "image", "pdf", "document", "link"],
              },
              filename: { type: "string", minLength: 1 },
            },
          },
        }],
      }),
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: "inspected" }] };
      },
    });
    const cases = [
      { mimeType: "audio/ogg", fileName: "memo.ogg", expected: "audio" },
      { mimeType: "image/png", fileName: "Screenshot 2026.png", expected: "screenshot" },
      { mimeType: "image/jpeg", fileName: "holiday.jpg", expected: "image" },
      { mimeType: "application/octet-stream", fileName: "brief.pdf", expected: "pdf" },
      { mimeType: "text/uri-list", fileName: "reference.url", expected: "link" },
      { mimeType: "application/zip", fileName: "archive.zip", expected: "document" },
    ] as const;

    for (const [index, mediaCase] of cases.entries()) {
      const receipt = await organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat-alpha",
        messageId: `structural-${index}`,
        media: {
          artifactRef: `https://phylax.test/artifacts/${index}`,
          mimeType: mediaCase.mimeType,
          fileName: mediaCase.fileName,
        },
      });
      expect(receipt.replyText).toBe("inspected");
      expect(calls[index]?.arguments).toEqual({
        artifactUrl: `https://phylax.test/artifacts/${index}`,
        mediaType: mediaCase.expected,
        filename: mediaCase.fileName,
      });
      expect(calls[index]?.arguments).not.toHaveProperty("message");
    }

    await expect(organ.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat-alpha",
      messageId: "structural-missing-filename",
      media: {
        artifactRef: "https://phylax.test/artifacts/missing-filename",
        mimeType: "image/png",
      },
    })).rejects.toMatchObject({
      code: "invalid_input",
      message: 'binding source "filename" is unavailable for field "filename"',
    });
    expect(calls).toHaveLength(cases.length);
    await organ.close();
  });

  it("fails loudly before dispatch when a tenant binding drifts from the discovered schema", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-binding-schema-drift-"));
    dirs.push(dataDir);
    let called = false;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://zenod.test/mcp/memory",
          downstreamToken: "memory-scope-only",
          turnBindings: {
            voice_note: {
              tool: "store_memory",
              argumentMappings: { wrongField: { source: "transcript" } },
            },
            text: { tool: "chat_with_ring", argumentMappings: {} },
            media: { tool: "chat_with_ring", argumentMappings: {} },
          },
        }),
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["content", "idempotencyKey"],
            properties: {
              content: { type: "string" },
              idempotencyKey: { type: "string" },
            },
          },
          description: "Store memory",
        }],
      }),
      async callDownstream() {
        called = true;
        return { content: [{ type: "text", text: "must not run" }] };
      },
    });

    await expect(organ.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat-alpha",
      messageId: "provider-drift-1",
      transcription: { text_transcript: "capture me" },
    })).rejects.toMatchObject({
      code: "downstream_error",
      audit: { failureCode: "downstream_schema_drift" },
    });
    expect(called).toBe(false);
    await organ.close();
  });

  it("reconciles a crash after terminal provider send without duplicate delivery or lost reply context", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-binding-restart-"));
    dirs.push(dataDir);
    const route = {
      tenantId: "alpha",
      downstreamUrl: "https://zenod.test/mcp/memory",
      downstreamToken: "memory-scope-only",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: { content: { source: "transcript" as const } },
        },
        text: {
          tool: "chat_with_ring",
          argumentMappings: {
            message: { source: "message" as const },
            surface: { source: "surface" as const },
            conversationKey: { source: "conversationKey" as const },
          },
        },
        media: { tool: "chat_with_ring", argumentMappings: {} },
      },
    };
    const discovery = async () => ({
      transport: "connected" as const,
      tools: "ready" as const,
      specs: [
        {
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["content", "idempotencyKey"],
            properties: {
              content: { type: "string" },
              idempotencyKey: { type: "string" },
            },
          },
          description: "Store memory",
        },
        {
          as: "ring",
          mcp: "chat_with_ring",
          arg: "input",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["message", "surface", "conversationKey"],
            properties: {
              message: { type: "string" },
              surface: { type: "string" },
              conversationKey: { type: "string" },
            },
          },
          description: "Chat with Ring",
        },
      ],
    });
    const first = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => route },
      discoverDownstream: discovery,
      captureForegroundDeadlineMs: 2,
      capturePollIntervalMs: 1,
      async callDownstream(call) {
        return call.tool === "store_memory"
          ? {
              content: [{ type: "text", text: "queued" }],
              structuredContent: { ticket_id: "job-restart-1", state: "accepted" },
            }
          : {
              content: [{ type: "text", text: "running" }],
              structuredContent: { ticket_id: "job-restart-1", state: "running" },
            };
      },
    });
    const pending = await first.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat-alpha",
      messageId: "provider-restart-1",
      transcription: { text_transcript: "capture across restart" },
    });
    expect(pending.replyText).toContain("still filing");
    expect(pending.replyText).not.toContain("Saved");
    await first.close();

    const delivered: string[] = [];
    const durableProviderAudit = new Map<string, string>();
    const restarted = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => route },
      discoverDownstream: discovery,
      capturePollIntervalMs: 1,
      async callDownstream(call) {
        expect(call.tool).toBe("get_task_result");
        expect(call.arguments).toEqual({ ticket_id: "job-restart-1" });
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: "job-restart-1",
            state: "done",
            result: {
              recap: "Restart-safe capture.",
              evidenceRef: "Log/2026-07-29.md#^restart-1",
              pagesTouched: ["Inbox/Restart.md"],
              commitSha: "def5678",
              githubUrls: [],
            },
          },
        };
      },
    });
    restarted.setTerminalReceiptDelivery(async (_channel, _recipient, text, captureProviderMessageId) => {
      delivered.push(text);
      durableProviderAudit.set(captureProviderMessageId, "wa-restart-receipt-1");
      throw new Error("simulated crash after provider send and durable audit");
    });
    await restarted.resumePendingCaptures();
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0]).toContain("Saved ✓");
    expect(restarted.lastCaptureEvidenceRef("alpha", "whatsapp:34611111111"))
      .toBe("Log/2026-07-29.md#^restart-1");
    await restarted.close();

    const recoveredCalls: PhylaxDownstreamCall[] = [];
    const recovered = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => route },
      discoverDownstream: discovery,
      async callDownstream(call) {
        recoveredCalls.push(call);
        return { content: [{ type: "text", text: "grounded Ring reply" }] };
      },
    });
    recovered.setTerminalReceiptRecovery((_channel, tenantId, captureProviderMessageId) => {
      expect(tenantId).toBe("alpha");
      return durableProviderAudit.get(captureProviderMessageId) ?? null;
    });
    recovered.setTerminalReceiptDelivery(async () => {
      delivered.push("duplicate");
      return { sentMessageId: "must-not-send" };
    });
    await recovered.resumePendingCaptures();
    await recovered.resumePendingCaptures();
    expect(delivered).toHaveLength(1);

    const reply = await recovered.receive({
      channel: "whatsapp",
      sender: "34611111111",
      chatId: "chat-alpha",
      messageId: "provider-restart-follow-up-1",
      text: "What did that captured note say?",
      replyToMessageId: "wa-restart-receipt-1",
    });
    expect(reply.replyText).toBe("grounded Ring reply");
    expect(recoveredCalls).toHaveLength(1);
    expect(recoveredCalls[0]).toMatchObject({
      tool: "chat_with_ring",
      handoff: {
        reply_context: { evidenceRef: "Log/2026-07-29.md#^restart-1" },
      },
    });
    expect(JSON.stringify(recoveredCalls[0]?.handoff)).not.toContain("memory-scope-only");
    await recovered.close();
  });

  it("re-enters a claimed terminal delivery with no outbox and preserves one provider ID across the next crash", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-terminal-pre-outbox-crash-"));
    dirs.push(dataDir);
    const sourceMessageId = "provider-terminal-pre-outbox-1";
    const receiptText = [
      "Saved ✓",
      "Recap: Restart the claimed receipt.",
      "Evidence: Log/2026-07-29.md#^terminal-pre-outbox-1",
    ].join("\n");
    const route = {
      tenantId: "alpha",
      downstreamUrl: "https://zenod.test/mcp/memory",
      downstreamToken: "memory-scope-only",
    };

    // Persist the exact stranded boundary: the capture is terminal and the old
    // provider claim is set, but the WhatsApp outbound intent does not exist.
    const schema = new PhylaxChannelsOrgan({
      dataDir,
      routes: { resolve: () => route },
    });
    await schema.close();
    const journal = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"));
    const now = Date.now();
    journal.prepare(
      `INSERT INTO phylax_capture_jobs (
         tenant_id, channel, provider_message_id, sender, chat_id,
         conversation_key, tool, job_id, state, receipt_text, evidence_ref,
         delivered_at, created_at, updated_at
       ) VALUES (?, 'whatsapp', ?, ?, ?, ?, 'store_memory', ?, 'done', ?, ?, ?, ?, ?)`,
    ).run(
      "alpha",
      sourceMessageId,
      "34611111111",
      "34611111111@s.whatsapp.net",
      "whatsapp:34611111111",
      "job-terminal-pre-outbox-1",
      receiptText,
      "Log/2026-07-29.md#^terminal-pre-outbox-1",
      now,
      now,
      now,
    );
    journal.close();
    const seededWhatsApp = new WhatsAppStore(phylaxWhatsAppPaths(dataDir).store);
    seededWhatsApp.recordChannelForwarding({
      providerMessageId: sourceMessageId,
      tenantId: "alpha",
      senderId: "34611111111",
      downstreamDestination: "zenod.test#tenant:alpha",
      replyText: receiptText,
    });
    expect(seededWhatsApp.recoverableReceiptIntent("alpha", sourceMessageId)).toBeNull();
    seededWhatsApp.close();

    const attempts: string[] = [];
    const accepted = new Set<string>();
    const firstRuntime = new PhylaxPortedRuntime(
      dataDir,
      new PhylaxChannelsOrgan({
        dataDir,
        routes: { resolve: () => route },
      }),
      {},
      {
        whatsappSocketFactory: async () => ({
          ev: { on() {} },
          user: { id: "34999999999@s.whatsapp.net" },
          async sendMessage(_jid, _content, options) {
            const id = options?.messageId ?? "";
            attempts.push(id);
            accepted.add(id);
            return { key: { id } };
          },
        }),
      },
    );
    firstRuntime.settings.setWhatsAppSettings({
      enabled: true,
      providerMode: "self_host_dev",
      acceptAll: true,
    });
    vi.spyOn(firstRuntime.whatsappStore, "completeOutboundIntent")
      .mockImplementationOnce(() => {
        throw new Error("simulated crash after provider success before outbound audit");
      });
    await firstRuntime.start();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).not.toBe("");
    expect(firstRuntime.whatsappStore.recoverableReceiptIntent("alpha", sourceMessageId))
      .toMatchObject({
        providerMessageId: attempts[0],
        state: "pending",
        receiptEligible: true,
      });
    await firstRuntime.close();

    const afterFirstCrash = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"));
    expect((afterFirstCrash.prepare(
      `SELECT COUNT(*) AS count FROM phylax_capture_receipts
       WHERE tenant_id = 'alpha' AND channel = 'whatsapp'
         AND capture_provider_message_id = ?`,
    ).get(sourceMessageId) as { count: number }).count).toBe(0);
    afterFirstCrash.close();

    const restarted = new PhylaxPortedRuntime(
      dataDir,
      new PhylaxChannelsOrgan({
        dataDir,
        routes: { resolve: () => route },
      }),
      {},
      {
        whatsappSocketFactory: async () => ({
          ev: { on() {} },
          user: { id: "34999999999@s.whatsapp.net" },
          async sendMessage(_jid, _content, options) {
            const id = options?.messageId ?? "";
            attempts.push(id);
            accepted.add(id);
            return { key: { id } };
          },
        }),
      },
    );
    try {
      await restarted.start();
      expect(attempts).toEqual([attempts[0], attempts[0]]);
      expect(accepted).toEqual(new Set([attempts[0]!]));
      expect(restarted.whatsappStore.channelAudit(sourceMessageId)).toMatchObject({
        tenantId: "alpha",
        outboundProviderId: attempts[0],
        outboundStatus: "sent",
      });
      const mapped = new DatabaseSync(join(dataDir, "phylax-capture-jobs.sqlite"));
      expect(mapped.prepare(
        `SELECT provider_receipt_message_id AS providerReceiptMessageId,
           evidence_ref AS evidenceRef
         FROM phylax_capture_receipts
         WHERE tenant_id = 'alpha' AND channel = 'whatsapp'
           AND capture_provider_message_id = ?`,
      ).all(sourceMessageId)).toEqual([{
        providerReceiptMessageId: attempts[0],
        evidenceRef: "Log/2026-07-29.md#^terminal-pre-outbox-1",
      }]);
      mapped.close();

      await restarted.organ.resumePendingCaptures();
      expect(await restarted.whatsapp.recoverPortedReceipt("alpha", sourceMessageId))
        .toBe(attempts[0]);
      expect(await restarted.whatsapp.recoverPortedReceipt("beta", sourceMessageId))
        .toBeNull();
      expect(attempts).toHaveLength(2);
    } finally {
      await restarted.close();
    }
  });

  it("coalesces a repeated provider message per tenant without crossing same-id tenant jobs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-binding-multitenant-"));
    dirs.push(dataDir);
    const binding = {
      voice_note: {
        tool: "store_memory",
        argumentMappings: { content: { source: "transcript" as const } },
      },
      text: { tool: "chat_with_ring", argumentMappings: {} },
      media: { tool: "chat_with_ring", argumentMappings: {} },
    };
    const storeCalls: PhylaxDownstreamCall[] = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve(_channel, sender) {
          const tenantId = sender.endsWith("111") ? "alpha" : "beta";
          return {
            tenantId,
            downstreamUrl: `https://zenod.test/mcp/${tenantId}`,
            downstreamToken: `${tenantId}-memory-scope`,
            turnBindings: binding,
          };
        },
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          inputSchema: {
            type: "object",
            required: ["content", "idempotencyKey"],
            properties: {
              content: { type: "string" },
              idempotencyKey: { type: "string" },
            },
          },
          description: "Store memory",
        }],
      }),
      async callDownstream(call) {
        if (call.tool === "store_memory") {
          storeCalls.push(call);
          return {
            content: [{ type: "text", text: "queued" }],
            structuredContent: {
              ticket_id: `job-${call.route.tenantId}`,
              state: "accepted",
            },
          };
        }
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: `job-${call.route.tenantId}`,
            state: "done",
            result: {
              evidenceRef: `Log/2026-07-29.md#^${call.route.tenantId}`,
              pagesTouched: [`Inbox/${call.route.tenantId}.md`],
              commitSha: call.route.tenantId === "alpha" ? "aaaaaaa" : "bbbbbbb",
              githubUrls: [],
            },
          },
        };
      },
      capturePollIntervalMs: 1,
    });
    const inbound = (sender: string) => ({
      channel: "whatsapp" as const,
      sender,
      chatId: `chat-${sender}`,
      messageId: "same-provider-id",
      transcription: { text_transcript: `memory from ${sender}` },
    });

    const [alpha, beta] = await Promise.all([
      organ.receive(inbound("34611111111")),
      organ.receive(inbound("34622222222")),
    ]);
    const alphaDuplicate = await organ.receive(inbound("34611111111"));

    expect(alpha.replyText).toContain("Saved ✓");
    expect(beta.replyText).toContain("Saved ✓");
    expect(alphaDuplicate.replyText).toBe(alpha.replyText);
    expect(storeCalls.map((call) => call.arguments.idempotencyKey)).toEqual([
      "alpha:whatsapp:same-provider-id",
      "beta:whatsapp:same-provider-id",
    ]);
    expect(organ.lastCaptureEvidenceRef("alpha", "whatsapp:34611111111"))
      .toBe("Log/2026-07-29.md#^alpha");
    expect(organ.lastCaptureEvidenceRef("beta", "whatsapp:34622222222"))
      .toBe("Log/2026-07-29.md#^beta");
    await organ.close();
  });

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

  it("marks thrown and typed authentication rejections without echoing credential-bearing errors", async () => {
    const statuses: Array<[string, string, string]> = [];
    let failure: "thrown" | "typed" = "thrown";
    const organ = new PhylaxChannelsOrgan({
      dataDir: "/tmp/unused-phylax-auth-rejection",
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://ring.test/mcp/path-secret",
          downstreamToken: "bearer-secret",
          credentialRevision: "credential-revision-1",
        }),
        reportDownstreamCredentialStatus(tenantId, credentialRevision, status) {
          statuses.push([tenantId, credentialRevision, status]);
        },
      },
      async callDownstream() {
        if (failure === "thrown") {
          throw new Error('POSTing to endpoint with bearer-secret: {"error":"Unauthorized"}');
        }
        return {
          isError: true,
          content: [{ type: "text", text: "403 forbidden for token bearer-secret" }],
        };
      },
    });

    for (const kind of ["thrown", "typed"] as const) {
      failure = kind;
      const rejected = await organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat",
        text: "hello",
      }).catch((error: unknown) => error);
      expect(rejected).toMatchObject({
        code: "downstream_error",
        audit: { failureCode: "downstream_unauthorized" },
      });
      expect(String(rejected)).toContain("replace the Ring MCP URL and bearer token");
      expect(String(rejected)).not.toContain("bearer-secret");
      expect(String(rejected)).not.toContain("path-secret");
    }
    expect(statuses).toEqual([
      ["alpha", "credential-revision-1", "rejected"],
      ["alpha", "credential-revision-1", "rejected"],
    ]);
  });

  it("marks the configured downstream credential healthy after a successful reply", async () => {
    const statuses: Array<[string, string, string]> = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir: "/tmp/unused-phylax-auth-healthy",
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://ring.test/mcp/alpha",
          downstreamToken: "secret",
          credentialRevision: "credential-revision-2",
        }),
        reportDownstreamCredentialStatus(tenantId, credentialRevision, status) {
          statuses.push([tenantId, credentialRevision, status]);
        },
      },
      async callDownstream() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    });

    await organ.receive({ channel: "whatsapp", sender: "34611111111", chatId: "chat", text: "hello" });
    expect(statuses).toEqual([["alpha", "credential-revision-2", "healthy"]]);
  });

  it("ignores a stale in-flight success after the tenant replaces downstream credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-stale-success-"));
    dirs.push(dataDir);
    const settings = new PhylaxTenantSettingsStore(
      dataDir,
      new ChassisStorage({ dataDir, vaultEncryptionKey: "41".repeat(32) }),
    );
    const registration = settings.registerPhone("alpha", "+34 611 111 111");
    settings.update("alpha", {
      downstreamUrl: "https://ring.test/mcp/old-path",
      downstreamToken: "old-bearer",
    });
    settings.verifyInbound("34611111111", registration.keyword);
    let callStarted!: () => void;
    const started = new Promise<void>((resolve) => { callStarted = resolve; });
    let complete!: (value: { content: Array<{ type: "text"; text: string }> }) => void;
    const completion = new Promise<{ content: Array<{ type: "text"; text: string }> }>((resolve) => {
      complete = resolve;
    });
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: (channel, sender) => settings.resolve(channel, sender),
        reportDownstreamCredentialStatus: (tenantId, revision, status) =>
          settings.reportDownstreamCredentialStatus(tenantId, revision, status),
      },
      callDownstream() {
        callStarted();
        return completion;
      },
    });

    const pending = organ.receive({ channel: "whatsapp", sender: "34611111111", chatId: "chat", text: "hello" });
    await started;
    settings.update("alpha", {
      downstreamUrl: "https://ring.test/mcp/new-path",
      downstreamToken: "new-bearer",
    });
    complete({ content: [{ type: "text", text: "old call completed" }] });
    await pending;

    expect(settings.view("alpha")).toMatchObject({
      downstreamUrl: "https://ring.test/mcp/new-path",
      downstreamCredentialStatus: "unknown",
      downstreamCredentialCheckedAt: null,
    });
  });

  it("ignores a stale in-flight rejection after the tenant replaces downstream credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-stale-rejection-"));
    dirs.push(dataDir);
    const settings = new PhylaxTenantSettingsStore(
      dataDir,
      new ChassisStorage({ dataDir, vaultEncryptionKey: "42".repeat(32) }),
    );
    const registration = settings.registerPhone("alpha", "+34 611 111 111");
    settings.update("alpha", {
      downstreamUrl: "https://ring.test/mcp/old-path",
      downstreamToken: "old-bearer",
    });
    settings.verifyInbound("34611111111", registration.keyword);
    let callStarted!: () => void;
    const started = new Promise<void>((resolve) => { callStarted = resolve; });
    let rejectCall!: (error: Error) => void;
    const completion = new Promise<never>((_resolve, reject) => { rejectCall = reject; });
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: (channel, sender) => settings.resolve(channel, sender),
        reportDownstreamCredentialStatus: (tenantId, revision, status) =>
          settings.reportDownstreamCredentialStatus(tenantId, revision, status),
      },
      callDownstream() {
        callStarted();
        return completion;
      },
    });

    const pending = organ.receive({ channel: "whatsapp", sender: "34611111111", chatId: "chat", text: "hello" });
    await started;
    settings.update("alpha", {
      downstreamUrl: "https://ring.test/mcp/new-path",
      downstreamToken: "new-bearer",
    });
    rejectCall(new Error('{"error":"Unauthorized"} old-bearer'));
    const rejected = await pending.catch((error: unknown) => error);

    expect(rejected).toMatchObject({ audit: { failureCode: "downstream_unauthorized" } });
    expect(settings.view("alpha")).toMatchObject({
      downstreamUrl: "https://ring.test/mcp/new-path",
      downstreamCredentialStatus: "unknown",
      downstreamCredentialCheckedAt: null,
    });
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
      model: "base",
      groqApiKey: "",
      openaiApiKey: "",
      openrouterApiKey: "",
      allowLocalFallback: true,
      includeTiming: true,
    });
    expect(phylaxTranscriptionOptions(
      { provider: "local", model: "small", key: null },
      {},
      signal,
    ).model).toBe("small");
    expect(phylaxTranscriptionConfigurationError({ provider: "local", model: "not-a-model", key: null }))
      .toContain("unsupported local transcription model");
    expect(phylaxTranscriptionOptions(
      { provider: "local", model: "not-a-model", key: null },
      { PHYLAX_LOCAL_WHISPER_MODEL: "also-invalid" },
      signal,
    ).model).toBe("base");
    expect(phylaxTranscriptionConfigurationError({ provider: "groq", model: null, key: null }))
      .toBe("groq transcription requires a tenant-configured provider key");
    expect(phylaxTranscriptionOptions(
      { provider: "openrouter", model: "openai/whisper-large-v3-turbo", key: "tenant-key" },
      { OPENROUTER_API_KEY: "must-not-leak" },
      signal,
    )).toMatchObject({
      groqApiKey: "",
      openaiApiKey: "",
      openrouterApiKey: "tenant-key",
      allowLocalFallback: false,
    });
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
    migrated.recordChannelFailure({
      providerMessageId: "migration-failure-001",
      tenantId: "alpha",
      senderId: "34611111111",
      downstreamDestination: "ring.zenod.dev#tenant:alpha",
      failureStage: "downstream",
      failureCode: "downstream_unauthorized",
      transcriptionFailureCode: "timeout",
      timing: { downstreamMs: 9, totalLifecycleMs: 12 },
    });
    expect(migrated.channelAudit("migration-failure-001")).toMatchObject({
      lifecycleState: "failed",
      failureStage: "downstream",
      failureCode: "downstream_unauthorized",
      transcriptionFailureCode: "timeout",
      timing: { downstreamMs: 9, totalLifecycleMs: 12 },
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

  it("queues one coalescing owner immediately, then sends one persisted Ring reply", async () => {
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
      probeVoiceDuration: async () => 60,
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
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("voice-owner")?.state).toBe("completed"));
      expect(transcriptionCalls).toBe(1);
      expect(downstreamCalls).toBe(1);
      expect(sent.map((entry) => entry.text)).toEqual([
        'I received your voice note and queued it for transcription. It may take a while. Send “cancel transcription” to cancel the latest pending voice note in this conversation.',
        "strawberry banana",
      ]);
      const outbound = runtime.whatsappStore.recentTranscript({ sinceMs: 0 })
        .filter((entry) => entry.direction === "outbound");
      expect(outbound).toHaveLength(2);
      expect(outbound.map((entry) => entry.status)).toEqual(["processing", "recovery_sent"]);
      const traces = ["voice-owner", "voice-duplicate"].map((messageId) => runtime.whatsappStore.channelAudit(messageId));
      expect(traces.filter((trace) => trace?.lifecycleState === "replied")).toHaveLength(1);
      expect(traces.filter((trace) => trace?.lifecycleState === "coalesced")).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });

  it("does not strand a durable voice job when its queued acknowledgement send fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-ack-failure-"));
    dirs.push(dataDir);
    let sends = 0;
    let downstreamCalls = 0;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://ring.test/mcp/alpha",
          downstreamToken: "alpha-token",
        }),
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.test/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe() {
          return { text_transcript: "ack failed but transcript persisted", transcription_source: "whisper.cpp base" };
        },
      },
      async callDownstream() {
        downstreamCalls += 1;
        return { content: [{ type: "text", text: "Terminal reply after ack failure." }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {}, {
      probeVoiceDuration: async () => 60,
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage() {
          sends += 1;
          if (sends === 1) throw new Error("ack provider failure");
          return { key: { id: `ack-recovery-${sends}` } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    try {
      await runtime.whatsapp.handleEvent({
        messageId: "voice-ack-failure",
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
        mediaRaw: { testBytes: "ack-failure-audio" },
      });
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("voice-ack-failure")?.state).toBe("completed"));
      expect(downstreamCalls).toBe(1);
      expect(sends).toBeGreaterThanOrEqual(2);
    } finally {
      await runtime.close();
    }
  });

  it("lets a long local voice complete beyond the old synchronous deadline", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-timeout-terminal-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const sent: string[] = [];
    let aborted = false;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      transcriptionDeadlineMs: 100,
      routes: { resolve: () => ({ tenantId: "alpha", downstreamUrl: "https://ring.test/mcp/alpha", downstreamToken: "token" }) },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/token/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe({ signal }) {
          signal.addEventListener("abort", () => { aborted = true; }, { once: true });
          await new Promise((resolve) => setTimeout(resolve, 180));
          return {
            text_transcript: "long voice completed",
            transcription_source: "whisper.cpp base",
          };
        },
      },
      async callDownstream(call) {
        calls.push(call);
        return { content: [{ type: "text", text: "Long voice saved." }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, { PHYLAX_VOICE_PROGRESS_DELAY_MS: "30000" }, {
      probeVoiceDuration: async () => 20 * 60,
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
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob(event.messageId)?.state).toBe("completed"));
      expect(aborted).toBe(false);
      expect(sent).toEqual([
        'I received your voice note and queued it for transcription. It may take a while. Send “cancel transcription” to cancel the latest pending voice note in this conversation.',
        "Long voice saved.",
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].handoff.text_transcript).toBe("long voice completed");
      expect(calls[0].handoff.artifact_ref).toMatch(/^https:\/\/phylax\.zenod\.dev\/mcp\/token\/artifacts\/alpha\//);
      expect(runtime.whatsappStore.channelAudit(event.messageId)).toMatchObject({
        lifecycleState: "replied",
        outboundProviderId: "terminal-timeout-reply",
        outboundStatus: "recovery_sent",
      });
    } finally {
      runtime.close();
    }
  });

  it("holds over-30-minute audio for scoped confirmation and supports exact scoped cancellation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-controls-"));
    dirs.push(dataDir);
    const sent: string[] = [];
    let transcriptionCalls = 0;
    let downstreamCalls = 0;
    let durationSeconds: number | null = null;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve(_channel, sender) {
          if (sender === "34611111111") {
            return { tenantId: "alpha", downstreamUrl: "https://ring.test/mcp/alpha", downstreamToken: "alpha-token" };
          }
          return { tenantId: "beta", downstreamUrl: "https://ring.test/mcp/beta", downstreamToken: "beta-token" };
        },
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.test/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe({ signal }) {
          transcriptionCalls += 1;
          if (durationSeconds < 30 * 60) {
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
            throw new Error("cancelled");
          }
          return { text_transcript: "confirmed transcript", transcription_source: "whisper.cpp base" };
        },
      },
      async callDownstream() {
        downstreamCalls += 1;
        return { content: [{ type: "text", text: "Confirmed voice handled." }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {}, {
      probeVoiceDuration: async () => durationSeconds,
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: `voice-control-${sent.length}` } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    const event = (
      messageId: string,
      sender: string,
      body: string,
      voice = false,
    ): WhatsAppInboundEvent => ({
      messageId,
      chatId: `${sender}@s.whatsapp.net`,
      senderId: `${sender}@s.whatsapp.net`,
      senderName: sender,
      chatName: sender,
      isGroup: false,
      timestamp: 1,
      body,
      hasMedia: voice,
      mediaType: voice ? "ptt" : null,
      mimeType: voice ? "audio/ogg" : null,
      fileName: null,
      ...(voice ? { mediaRaw: { testBytes: messageId } } : {}),
    });
    try {
      await runtime.whatsapp.handleEvent(event("alpha-unknown-duration", "34611111111", "", true));
      expect(runtime.whatsappStore.voiceJob("alpha-unknown-duration")?.state).toBe("awaiting_confirmation");
      expect(transcriptionCalls).toBe(0);
      expect(sent).toContain(
        'I could not determine this voice note’s length safely. Reply “confirm transcription” to start it, or “cancel transcription” to cancel it.',
      );
      await runtime.whatsapp.handleEvent(event("alpha-cancel-unknown", "34611111111", "cancel transcription"));
      expect(runtime.whatsappStore.voiceJob("alpha-unknown-duration")?.state).toBe("cancelled");

      durationSeconds = 31 * 60;
      await runtime.whatsapp.handleEvent(event("alpha-long", "34611111111", "", true));
      expect(runtime.whatsappStore.voiceJob("alpha-long")?.state).toBe("awaiting_confirmation");
      expect(transcriptionCalls).toBe(0);
      await runtime.whatsapp.handleEvent(event("beta-confirm", "34622222222", "confirm transcription"));
      expect(runtime.whatsappStore.voiceJob("alpha-long")?.state).toBe("awaiting_confirmation");
      expect(transcriptionCalls).toBe(0);
      await runtime.whatsapp.handleEvent(event("alpha-confirm", "34611111111", "confirm transcription"));
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("alpha-long")?.state).toBe("completed"));
      expect(transcriptionCalls).toBe(1);
      expect(downstreamCalls).toBe(1);

      durationSeconds = 60;
      await runtime.whatsapp.handleEvent(event("alpha-cancel", "34611111111", "", true));
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("alpha-cancel")?.state).toBe("transcribing"));
      await runtime.whatsapp.handleEvent(event("alpha-cancel-command", "34611111111", "cancel transcription"));
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("alpha-cancel")?.state).toBe("cancelled"));
      expect(downstreamCalls).toBe(1);
      expect(sent).toEqual(expect.arrayContaining([
        'This voice note is longer than 30 minutes. Reply “confirm transcription” to start it, or “cancel transcription” to cancel it.',
        "No voice transcription is waiting for confirmation in this conversation.",
        "Confirmed voice handled.",
        "Cancelled transcription alpha-cancel. Nothing was sent to Ring.",
      ]));
    } finally {
      runtime.close();
    }
  });

  it("ends a stuck transcription at the dedicated finite safety bound without calling Ring", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-safety-bound-"));
    dirs.push(dataDir);
    const sent: string[] = [];
    let downstreamCalls = 0;
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      voiceJobDeadlineMs: 100,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://ring.test/mcp/alpha",
          downstreamToken: "alpha-token",
        }),
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.test/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe({ signal }) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
          return {};
        },
      },
      async callDownstream() {
        downstreamCalls += 1;
        return { content: [{ type: "text", text: "must not be called" }] };
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {}, {
      probeVoiceDuration: async () => 60,
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: `safety-${sent.length}` } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    try {
      await runtime.whatsapp.handleEvent({
        messageId: "voice-safety-bound",
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
        mediaRaw: { testBytes: "stuck-audio" },
      });
      await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("voice-safety-bound")?.state).toBe("failed"));
      expect(downstreamCalls).toBe(0);
      expect(sent[0]).toContain("queued it for transcription");
      expect(sent[1]).toContain("100ms safety deadline");
    } finally {
      await runtime.close();
    }
  });

  it("waits for worker shutdown and leaves an interrupted transcription resumable", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-close-"));
    dirs.push(dataDir);
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://ring.test/mcp/alpha",
          downstreamToken: "alpha-token",
        }),
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.test/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe({ signal }) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true });
          });
          return {};
        },
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, {}, {
      probeVoiceDuration: async () => 60,
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage() {
          return { key: { id: "close-ack" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    await runtime.whatsapp.handleEvent({
      messageId: "voice-close",
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
      mediaRaw: { testBytes: "close-audio" },
    });
    await vi.waitFor(() => expect(runtime.whatsappStore.voiceJob("voice-close")?.state).toBe("transcribing"));
    await runtime.close();

    const restarted = new WhatsAppStore(phylaxWhatsAppPaths(dataDir).store);
    expect(restarted.voiceJob("voice-close")?.state).toBe("queued");
    expect(restarted.mediaRecovery("voice-close")).toBeNull();
    restarted.close();
  });

  it("does not retry or fabricate success when the Ring handoff outcome is unsafe", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-timeout-unauthorized-"));
    dirs.push(dataDir);
    const sent: string[] = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      transcriptionDeadlineMs: 100,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://ring.zenod.dev/mcp/token-bearing-path",
          downstreamToken: "ring-secret-must-not-persist",
        }),
      },
      artifactUrl: (tenantId, artifactId) => `https://phylax.zenod.dev/mcp/unit-token/artifacts/${tenantId}/${artifactId}`,
      transcriber: {
        async transcribe() {
          return { text_transcript: "durable before Ring", transcription_source: "whisper.cpp base" };
        },
      },
      async callDownstream() {
        throw new Error('Streamable HTTP error: Error POSTing to endpoint: {"error":"Unauthorized"}');
      },
    });
    const runtime = new PhylaxPortedRuntime(dataDir, organ, { PHYLAX_VOICE_PROGRESS_DELAY_MS: "30000" }, {
      probeVoiceDuration: async () => 60,
      whatsappSocketFactory: async () => ({
        ev: { on() {} },
        async sendMessage(_jid, content) {
          sent.push(content.text);
          return { key: { id: "terminal-unauthorized-reply" } };
        },
      }),
    });
    runtime.settings.setWhatsAppSettings({ enabled: true, providerMode: "self_host_dev", acceptAll: true });
    await runtime.whatsapp.start();
    const event: WhatsAppInboundEvent = {
      messageId: "3BA091E37C168738F529",
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
      mediaRaw: { testBytes: "deterministic-timeout-audio" },
    };
    try {
      await runtime.whatsapp.handleEvent(event);
      await vi.waitFor(() =>
        expect(runtime.whatsappStore.voiceJob(event.messageId)?.state).toBe("ring_outcome_unknown"));
      expect(sent).toEqual([
        'I received your voice note and queued it for transcription. It may take a while. Send “cancel transcription” to cancel the latest pending voice note in this conversation.',
        "⚠️ Your voice note was transcribed, but Ring’s handoff outcome is unknown. I will not retry it automatically because that could perform the request twice.",
      ]);
      expect(runtime.whatsappStore.channelAudit(event.messageId)).toBeNull();
      expect(JSON.stringify(runtime.whatsappStore.voiceJob(event.messageId))).not.toContain("ring-secret-must-not-persist");
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

  it("persists voice custody, schedules tenants fairly, and scopes confirmation/cancellation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-jobs-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const store = new WhatsAppStore(path);
    const create = (
      providerMessageId: string,
      tenantId: string,
      conversationKey: string,
      state: "queued" | "awaiting_confirmation",
      createdAt: number,
      replyToMessageId?: string,
    ) => store.createVoiceJob({
      providerMessageId,
      replyToMessageId,
      tenantId,
      conversationKey,
      senderId: `${tenantId}-sender`,
      chatId: `${tenantId}-chat`,
      artifactRef: `https://phylax.test/artifacts/${tenantId}/${providerMessageId}.ogg`,
      artifactPath: join(dataDir, `${providerMessageId}.ogg`),
      artifactSha256: providerMessageId.padEnd(64, "a").slice(0, 64),
      mimeType: "audio/ogg",
      fileName: `${providerMessageId}.ogg`,
      captionText: "",
      durationSeconds: 10,
      state,
    }, createdAt);

    create("alpha-first", "alpha", "whatsapp:alpha", "queued", 1, "receipt-provider-1");
    create("alpha-second", "alpha", "whatsapp:alpha", "queued", 2);
    create("beta-first", "beta", "whatsapp:beta", "queued", 3);
    create("alpha-long", "alpha", "whatsapp:alpha", "awaiting_confirmation", 4);
    create("beta-long", "beta", "whatsapp:beta", "awaiting_confirmation", 5);

    expect(store.claimNextVoiceJob(null)?.providerMessageId).toBe("alpha-first");
    expect(store.claimNextVoiceJob("alpha")?.providerMessageId).toBe("beta-first");
    expect(store.confirmLatestVoiceJob("alpha", "whatsapp:beta")).toBeNull();
    expect(store.confirmLatestVoiceJob("alpha", "whatsapp:alpha")?.providerMessageId).toBe("alpha-long");
    expect(store.cancelLatestVoiceJob("beta", "whatsapp:beta")?.providerMessageId).toBe("beta-long");
    expect(store.cancelLatestVoiceJob("alpha", "whatsapp:alpha")?.providerMessageId).toBe("alpha-long");
    store.queueVoiceFailureReply("alpha-long", "must not follow cancellation");
    expect(store.voiceJob("alpha-long")?.state).toBe("cancelled");
    expect(store.voiceJob("beta-long")?.state).toBe("cancelled");
    expect(store.mediaRecovery("alpha-long")).toBeNull();
    store.close();

    const restarted = new WhatsAppStore(path);
    expect(restarted.voiceJob("alpha-first")).toMatchObject({
      state: "queued",
      attempts: 1,
      replyToMessageId: "receipt-provider-1",
    });
    expect(restarted.voiceJob("beta-first")).toMatchObject({ state: "queued", attempts: 1 });
    expect(restarted.voiceJob("beta-long")?.state).toBe("cancelled");
    restarted.close();
  });

  it("resumes a persisted transcript at the Ring boundary without retranscribing it", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-transcribed-resume-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const store = new WhatsAppStore(path);
    store.createVoiceJob({
      providerMessageId: "voice-transcribed-resume",
      tenantId: "alpha",
      conversationKey: "whatsapp:alpha",
      senderId: "alpha",
      chatId: "alpha-chat",
      artifactRef: "https://phylax.test/artifacts/alpha/resume.ogg",
      artifactPath: join(dataDir, "resume.ogg"),
      artifactSha256: "c".repeat(64),
      mimeType: "audio/ogg",
      fileName: "resume.ogg",
      captionText: "",
      durationSeconds: 60,
      state: "queued",
    });
    store.claimNextVoiceJob(null);
    store.persistVoiceTranscript("voice-transcribed-resume", {
      text_transcript: "already durable",
      transcription_source: "whisper.cpp base",
    });
    store.close();

    const restarted = new WhatsAppStore(path);
    const resumed = restarted.claimNextVoiceJob(null);
    expect(resumed).toMatchObject({
      providerMessageId: "voice-transcribed-resume",
      state: "transcribed",
      attempts: 1,
      transcription: { text_transcript: "already durable" },
    });
    expect(restarted.claimVoiceRingHandoff("voice-transcribed-resume")).toBe(true);
    restarted.close();
  });

  it("persists transcript before Ring claim and never retries an ambiguous Ring handoff after restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-ring-boundary-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const store = new WhatsAppStore(path);
    store.createVoiceJob({
      providerMessageId: "voice-ring-boundary",
      tenantId: "alpha",
      conversationKey: "whatsapp:34611111111",
      senderId: "34611111111",
      chatId: "34611111111@s.whatsapp.net",
      artifactRef: "https://phylax.test/artifacts/alpha/voice.ogg",
      artifactPath: join(dataDir, "voice.ogg"),
      artifactSha256: "a".repeat(64),
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
      captionText: "",
      durationSeconds: 1_200,
      state: "queued",
    });
    expect(store.claimNextVoiceJob(null)?.state).toBe("transcribing");
    expect(store.persistVoiceTranscript("voice-ring-boundary", {
      text_transcript: "durable transcript",
      transcription_source: "whisper.cpp base",
    })).toBe(true);
    expect(store.claimVoiceRingHandoff("voice-ring-boundary")).toBe(true);
    store.close();

    const restarted = new WhatsAppStore(path);
    expect(restarted.voiceJob("voice-ring-boundary")).toMatchObject({
      state: "ring_outcome_unknown",
      transcription: {
        text_transcript: "durable transcript",
        transcription_source: "whisper.cpp base",
      },
    });
    expect(restarted.claimNextVoiceJob(null)).toBeNull();
    restarted.close();
  });

  it("recovers a persisted post-Ring reply after restart instead of marking the handoff unknown", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-voice-known-reply-"));
    dirs.push(dataDir);
    const path = phylaxWhatsAppPaths(dataDir).store;
    const event: WhatsAppInboundEvent = {
      messageId: "voice-known-reply",
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
    const store = new WhatsAppStore(path);
    store.recordInbound(event);
    store.markMessageStatus(event.messageId, "processing");
    store.createVoiceJob({
      providerMessageId: event.messageId,
      tenantId: "alpha",
      conversationKey: "whatsapp:34611111111",
      senderId: "34611111111",
      chatId: event.chatId,
      artifactRef: "https://phylax.test/artifacts/alpha/voice.ogg",
      artifactPath: join(dataDir, "voice.ogg"),
      artifactSha256: "b".repeat(64),
      mimeType: "audio/ogg",
      fileName: "voice.ogg",
      captionText: "",
      durationSeconds: 60,
      state: "queued",
    });
    store.claimNextVoiceJob(null);
    store.persistVoiceTranscript(event.messageId, { text_transcript: "known transcript" });
    store.claimVoiceRingHandoff(event.messageId);
    store.recordChannelForwarding({
      providerMessageId: event.messageId,
      tenantId: "alpha",
      senderId: "34611111111",
      transcriptText: "known transcript",
      transcriptProvenance: "whisper.cpp base",
      artifactRef: "https://phylax.test/artifacts/alpha/voice.ogg",
      artifactSha256: "b".repeat(64),
      downstreamDestination: "ring.test#tenant:alpha",
      downstreamCorrelationId: "ring-known-reply",
      replyText: "Persisted Ring reply.",
    });
    store.close();

    const restarted = new WhatsAppStore(path);
    expect(restarted.voiceJob(event.messageId)).toMatchObject({
      state: "reply_ready",
      replyText: "Persisted Ring reply.",
    });
    expect(restarted.claimNextVoiceJob(null)).toBeNull();
    const recovery = restarted.claimInterruptedMediaRecovery();
    expect(recovery).toMatchObject({
      providerMessageId: event.messageId,
      kind: "forwarded_reply",
      replyText: "Persisted Ring reply.",
    });
    restarted.completeInterruptedMediaRecovery(recovery!, { sentMessageId: "wa-known-reply" });
    expect(restarted.voiceJob(event.messageId)?.state).toBe("completed");
    restarted.close();
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
