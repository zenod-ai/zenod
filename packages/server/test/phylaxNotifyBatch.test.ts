// EPIC-7 E7-S38: notify `urgency: "batch"` holds a message and sends one combined message per window.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { registerPhylaxChannelTools, type PhylaxDeliveryReceipt, type PhylaxTenantDelivery } from "../src/phylaxChannels.js";
import {
  composeNotifyBatch,
  DEFAULT_NOTIFY_BATCH_MINUTES,
  inQuietHours,
  localHour,
  notifyBatchOptionsFromEnv,
  PhylaxNotifyBatch,
} from "../src/phylaxNotifyBatch.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function batchDir() {
  const dir = await mkdtemp(join(tmpdir(), "phylax-notify-batch-"));
  dirs.push(dir);
  return dir;
}

// 2026-11-25 18:00 UTC is 12:00 in Mexico City (outside quiet hours); 2026-11-26 06:00 UTC is 00:00 there.
const NOON_MX = Date.parse("2026-11-25T18:00:00Z");
const MIDNIGHT_MX = Date.parse("2026-11-26T06:00:00Z");
const HOUR = 3_600_000;

describe("notify batch (E7-S38)", () => {
  it("reads the window, quiet hours and zone from the environment", () => {
    expect(notifyBatchOptionsFromEnv({})).toEqual({ windowMs: DEFAULT_NOTIFY_BATCH_MINUTES * 60_000, quietHours: [22, 8], timeZone: "America/Mexico_City" });
    expect(notifyBatchOptionsFromEnv({ PHYLAX_NOTIFY_BATCH_MINUTES: "60", PHYLAX_NOTIFY_BATCH_QUIET: "23-7", PHYLAX_NOTIFY_BATCH_TZ: "Europe/Madrid" }))
      .toEqual({ windowMs: 60 * 60_000, quietHours: [23, 7], timeZone: "Europe/Madrid" });
    expect(notifyBatchOptionsFromEnv({ PHYLAX_NOTIFY_BATCH_MINUTES: "1", PHYLAX_NOTIFY_BATCH_QUIET: "off", PHYLAX_NOTIFY_BATCH_TZ: "Not/AZone" }))
      .toEqual({ windowMs: DEFAULT_NOTIFY_BATCH_MINUTES * 60_000, quietHours: [0, 0], timeZone: "America/Mexico_City" });
  });

  it("knows quiet hours across midnight", () => {
    expect(localHour(NOON_MX, "America/Mexico_City")).toBe(12);
    expect(localHour(MIDNIGHT_MX, "America/Mexico_City")).toBe(0);
    expect(inQuietHours(23, [22, 8])).toBe(true);
    expect(inQuietHours(7, [22, 8])).toBe(true);
    expect(inQuietHours(8, [22, 8])).toBe(false);
    expect(inQuietHours(12, [0, 0])).toBe(false);
  });

  it("composes one message, oldest first, with a count and an overflow line", () => {
    expect(composeNotifyBatch([{ text: "A ready card", at: 1 }])).toBe("1 update, held so it would not interrupt you:\n\n1. A ready card");
    const many = composeNotifyBatch([{ text: "x".repeat(50), at: 1 }, { text: "y".repeat(50), at: 2 }, { text: "z".repeat(50), at: 3 }], 120);
    expect(many.startsWith("3 updates")).toBe(true);
    expect(many).toContain("1. xxx");
    expect(many).toContain("+ 2 more on your team page.");
  });

  it("holds messages until the window has passed, never sends at night, and keeps them when the send fails", async () => {
    const batch = new PhylaxNotifyBatch(await batchDir(), { windowMs: 3 * HOUR });
    expect(batch.add("t1", "first", NOON_MX - 4 * HOUR).waiting).toBe(1);
    expect(batch.add("t1", "second", NOON_MX - HOUR).waiting).toBe(2);
    batch.add("t2", "young", NOON_MX - HOUR);
    expect(batch.due(NOON_MX)).toEqual(["t1"]);

    const sent: string[] = [];
    expect(await batch.flushDue(async () => false, NOON_MX)).toBe(0);
    expect(batch.pending("t1").map((item) => item.text)).toEqual(["first", "second"]);

    expect(await batch.flushDue(async (_tenant, text) => (sent.push(text), true), NOON_MX)).toBe(1);
    expect(sent).toEqual(["2 updates, held so they would not interrupt you:\n\n1. first\n\n2. second"]);
    expect(batch.pending("t1")).toEqual([]);
    expect(batch.pending("t2")).toHaveLength(1);

    batch.add("t3", "late", MIDNIGHT_MX - 5 * HOUR);
    expect(batch.due(MIDNIGHT_MX)).toEqual([]);
  });

  it("survives a restart: held messages are on disk", async () => {
    const dir = await batchDir();
    new PhylaxNotifyBatch(dir).add("t1", "kept", NOON_MX);
    expect(new PhylaxNotifyBatch(dir).pending("t1").map((item) => item.text)).toEqual(["kept"]);
  });

  it("the notify tool queues urgency batch, and sends now by default, with a picture or from a number", async () => {
    const sends: string[] = [];
    const queued: string[] = [];
    const receipt = (status: PhylaxDeliveryReceipt["status"]): PhylaxDeliveryReceipt => ({ channel: "whatsapp", recipient: "+34611111111", sentMessageId: status === "queued" ? "" : `s${sends.length}`, status, at: "2026-11-25T18:00:00.000Z" });
    const delivery: PhylaxTenantDelivery = {
      send: async () => receipt("sent"),
      status: () => ({}),
      async notify(text) {
        sends.push(text);
        return [receipt("sent")];
      },
      async queue(text) {
        queued.push(text);
        return [receipt("queued")];
      },
    };
    const server = new McpServer({ name: "phylax-test", version: "1" });
    registerPhylaxChannelTools(server, delivery);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    expect((await client.listTools()).tools.find((tool) => tool.name === "notify")!.inputSchema.properties).toHaveProperty("urgency");
    const held = await client.callTool({ name: "notify", arguments: { text: "A card is ready", urgency: "batch" } });
    expect(held.content).toEqual([{ type: "text", text: "whatsapp::queued" }]);
    await client.callTool({ name: "notify", arguments: { text: "Morning briefing" } });
    await client.callTool({ name: "notify", arguments: { text: "Alarm", urgency: "now" } });
    await client.callTool({ name: "notify", arguments: { text: "Lights", urgency: "batch", imageBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") } });
    expect(queued).toEqual(["A card is ready"]);
    expect(sends).toEqual(["Morning briefing", "Alarm", "Lights"]);
  });
});
