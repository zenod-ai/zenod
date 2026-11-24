import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  PhylaxChannelError,
  PhylaxChannelsOrgan,
  registerPhylaxChannelTools,
  registerPhylaxNumberPairingTools,
  type PhylaxDeliveryReceipt,
  type PhylaxDownstreamCall,
  type PhylaxTenantDelivery,
  type PhylaxWhatsAppNumberView,
} from "../src/phylaxChannels.js";
import { defaultPhylaxTurnBindings } from "../src/phylaxTenantSettings.js";

/** EPIC-20 A9: the number a WhatsApp note was sent TO travels from Phylax to Zenod, and the tools to pair and send from more numbers. */

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

function organWith(dataDir: string, advertisesToNumber: () => boolean, calls: PhylaxDownstreamCall[]) {
  return new PhylaxChannelsOrgan({
    dataDir,
    routes: {
      resolve: () => ({
        tenantId: "jordi",
        downstreamUrl: "https://zenod.test/mcp/memory",
        downstreamToken: "memory-scope-only",
        turnBindings: defaultPhylaxTurnBindings(),
      }),
    },
    artifactUrl: (tenantId, artifactId) => `https://phylax.test/artifacts/${tenantId}/${artifactId}`,
    discoverDownstream: async () => ({
      transport: "connected",
      tools: "ready",
      specs: [{
        as: "memory",
        mcp: "ingest_memory",
        arg: "input",
        description: "Media ingest",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            artifactUrl: { type: "string" },
            mediaType: { type: "string" },
            filename: { type: "string" },
            sourceHint: { type: "string" },
            contentHint: { type: "string" },
            senderTimestamp: { type: "string" },
            idempotencyKey: { type: "string" },
            providedTranscript: { type: "string" },
            transcriptionProvider: { type: "string" },
            audioDurationSeconds: { type: ["number", "null"] },
            transcriptionDisposition: { enum: ["provided", "skip_duration_limit", "skip_unavailable"] },
            ...(advertisesToNumber() ? { toNumber: { type: "string" } } : {}),
          },
        },
      }],
    }),
    async callDownstream(call) {
      calls.push(call);
      if (call.tool === "ingest_memory") {
        return { content: [{ type: "text", text: "queued" }], structuredContent: { ticket_id: "ingest-job", state: "accepted" } };
      }
      return {
        content: [{ type: "text", text: "done" }],
        structuredContent: {
          ticket_id: "ingest-job",
          state: "done",
          result: {
            recap: "Kept.",
            rawArtifact: { archiveUrl: "https://drive.google.com/file/d/kept/view" },
            digest: { pagesTouched: ["Inbox/Voice.md"], githubUrls: [] },
          },
        },
      };
    },
    capturePollIntervalMs: 1,
    sleep: async () => {},
  });
}

function voiceNote(messageId: string) {
  return {
    channel: "whatsapp",
    sender: "34611111111",
    chatId: "chat-jordi",
    messageId,
    senderTimestamp: "2026-11-24T18:00:00.000Z",
    toNumber: "+34600000002",
    media: { bytes: Buffer.from(`voice ${messageId}`), mimeType: "audio/ogg", fileName: `${messageId}.ogg` },
    transcription: { text_transcript: "For the EpicTeam desk.", transcription_source: "test-stt", duration_seconds: 4 },
  } as const;
}

describe("to_number from Phylax to Zenod (EPIC-20 A9)", () => {
  it("passes the number a voice note was sent TO once Zenod advertises toNumber, and never to an older Zenod", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-to-number-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    let advertises = false;
    const organ = organWith(dataDir, () => advertises, calls);

    await organ.receive(voiceNote("before-upgrade"));
    const before = calls.find((call) => call.tool === "ingest_memory")!;
    expect(before.arguments).not.toHaveProperty("toNumber");
    expect(before.arguments.senderTimestamp).toBe("2026-11-24T18:00:00.000Z");

    advertises = true;
    calls.length = 0;
    await organ.receive(voiceNote("after-upgrade"));
    expect(calls.find((call) => call.tool === "ingest_memory")!.arguments).toMatchObject({
      toNumber: "+34600000002",
      idempotencyKey: "jordi:whatsapp:after-upgrade",
    });
    await organ.close();
  });

  it("keeps toNumber through a staged voice note forwarded after transcription", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-to-number-staged-"));
    dirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const organ = organWith(dataDir, () => true, calls);
    const staged = await organ.stageVoice({ ...voiceNote("staged"), transcription: undefined } as never);
    expect(staged.toNumber).toBe("+34600000002");
    await organ.forwardStagedVoice(staged, { text_transcript: "Later.", transcription_source: "test-stt" });
    expect(calls.find((call) => call.tool === "ingest_memory")!.arguments.toNumber).toBe("+34600000002");
    await organ.close();
  });
});

describe("pairing and from-number tools (EPIC-20 A9)", () => {
  async function connect(delivery: PhylaxTenantDelivery, pairing = true) {
    const server = new McpServer({ name: "phylax-test", version: "1" });
    registerPhylaxChannelTools(server, delivery);
    if (pairing) registerPhylaxNumberPairingTools(server, delivery);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  function fakeDelivery() {
    const sends: Array<{ text: string; from?: string }> = [];
    const numbers: PhylaxWhatsAppNumberView[] = [{ sessionId: null, label: "Zenod", state: "connected", number: "+34600000001", isDefault: true }];
    const receipt = (from: string | null): PhylaxDeliveryReceipt => ({ channel: "whatsapp", recipient: "+34611111111", sentMessageId: `s${sends.length}`, status: "sent", at: "2026-11-24T18:00:00.000Z", from });
    const delivery: PhylaxTenantDelivery = {
      send: async () => receipt(null),
      status: () => ({}),
      async notify(text, _image, from) {
        if (from && !numbers.some((n) => n.number === from || n.sessionId === from)) {
          throw new PhylaxChannelError("invalid_input", "That WhatsApp number is not paired to this Zenod account.");
        }
        sends.push({ text, ...(from ? { from } : {}) });
        return [receipt(from ? numbers.find((n) => n.number === from || n.sessionId === from)!.number : "+34600000001")];
      },
      whatsappNumbers: {
        list: () => numbers,
        async pair(input) {
          const view: PhylaxWhatsAppNumberView = { sessionId: "wa_0123456789ab", label: input.label ?? null, state: "pairing", number: null, qr: "2@qr-payload", isDefault: false };
          numbers.push(view);
          return view;
        },
        async remove(sessionId) {
          const index = numbers.findIndex((n) => n.sessionId === sessionId);
          if (index < 0) throw new PhylaxChannelError("invalid_input", "That WhatsApp number is not paired to this Zenod account.");
          numbers.splice(index, 1);
        },
      },
    };
    return { delivery, sends, numbers };
  }

  it("returns a QR for a new number, lists it, notifies from it and unpairs it", async () => {
    const { delivery, sends, numbers } = fakeDelivery();
    const client = await connect(delivery);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(["whatsapp_numbers", "pair_whatsapp_number", "unpair_whatsapp_number"]));
    expect((await client.listTools()).tools.find((tool) => tool.name === "notify")!.inputSchema.properties).toHaveProperty("from");

    const paired = await client.callTool({ name: "pair_whatsapp_number", arguments: { label: "EpicTeam desk" } });
    expect(paired.structuredContent).toMatchObject({ number: { sessionId: "wa_0123456789ab", state: "pairing", qr: "2@qr-payload", label: "EpicTeam desk" } });

    numbers[1]!.state = "connected";
    numbers[1]!.number = "+34600000002";
    numbers[1]!.qr = null;
    const listed = await client.callTool({ name: "whatsapp_numbers", arguments: {} });
    expect((listed.structuredContent as { numbers: PhylaxWhatsAppNumberView[] }).numbers.map((n) => [n.isDefault, n.number])).toEqual([[true, "+34600000001"], [false, "+34600000002"]]);

    const fromDesk = await client.callTool({ name: "notify", arguments: { text: "Desk here", from: "+34600000002" } });
    expect(fromDesk.structuredContent).toMatchObject({ receipts: [{ from: "+34600000002" }] });
    const fromDefault = await client.callTool({ name: "notify", arguments: { text: "Zenod here" } });
    expect(fromDefault.structuredContent).toMatchObject({ receipts: [{ from: "+34600000001" }] });
    expect(sends).toEqual([{ text: "Desk here", from: "+34600000002" }, { text: "Zenod here" }]);

    const unknown = await client.callTool({ name: "notify", arguments: { text: "x", from: "+34600000077" } });
    expect(unknown.isError).toBe(true);
    expect(unknown.structuredContent).toMatchObject({ error: { code: "invalid_input" } });

    await client.callTool({ name: "unpair_whatsapp_number", arguments: { sessionId: "wa_0123456789ab" } });
    expect(numbers).toHaveLength(1);
  });

  it("keeps pairing off the notify-only surface", async () => {
    const { delivery } = fakeDelivery();
    const client = await connect(delivery, false);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("whatsapp_numbers");
    expect(tools).not.toContain("pair_whatsapp_number");
    expect(tools).not.toContain("unpair_whatsapp_number");
  });
});
