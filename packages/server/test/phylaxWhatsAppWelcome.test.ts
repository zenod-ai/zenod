// E26-S26: the tester welcome is the WhatsApp verification reply when Zenod arms it with the code.
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SqliteTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHYLAX_MANAGEMENT_PROFILES, phylaxAccountNoticeText } from "../src/phylaxManagementMcp.js";
import { createPhylaxUnit, ZENOD_WHATSAPP_VERIFICATION_REPLY } from "../src/phylaxUnit.js";
import { PhylaxWhatsAppWelcome, ZENOD_WHATSAPP_TESTER_WELCOME, WHATSAPP_WELCOME_ARM_TTL_MS } from "../src/phylaxWhatsAppWelcome.js";
import type { WhatsAppPortedInboundHandler } from "../src/whatsappGateway.js";

const dirs: string[] = [];
const servers: ServerType[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PhylaxWhatsAppWelcome", () => {
  it("arms once, consumes on take, disarms, and ignores a stale arm", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phylax-welcome-"));
    dirs.push(dir);
    const store = new PhylaxWhatsAppWelcome(dir);
    expect(store.take("t1")).toBeNull();
    store.set("t1", "tester", 1_000);
    expect(store.take("t1", 2_000)).toBe(ZENOD_WHATSAPP_TESTER_WELCOME);
    expect(store.take("t1", 3_000)).toBeNull();
    store.set("t1", "tester", 1_000);
    store.set("t1", null);
    expect(store.take("t1", 2_000)).toBeNull();
    store.set("t2", "tester", 0);
    expect(store.take("t2", WHATSAPP_WELCOME_ARM_TTL_MS + 1)).toBeNull();
  });

  it("is the proposal's text with the zenod.dev/start link, also as the account notice", () => {
    expect(ZENOD_WHATSAPP_TESTER_WELCOME).toContain("Your WhatsApp is linked. Thank you for testing Zenod!");
    expect(ZENOD_WHATSAPP_TESTER_WELCOME).toContain("https://zenod.dev/start");
    expect(phylaxAccountNoticeText("zenod", "tester_welcome", "https://zenod.dev/start")).toBe(ZENOD_WHATSAPP_TESTER_WELCOME);
  });
});

describe("tester welcome through the management surface", () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-welcome-unit-"));
    dirs.push(dataDir);
    const tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    const token = `zenod_${createHash("sha256").update("alpha\0zenod").digest("hex").slice(0, 48)}`;
    tenants.ensureTenantToken("alpha", PHYLAX_MANAGEMENT_PROFILES.zenod, token);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        CHASSIS_VAULT_MASTER_KEY: "76".repeat(32),
        PHYLAX_PREWARM_LOCAL_MODEL: "0",
        PHYLAX_INSTANCE_MODE: "zenod",
        PHYLAX_INSTANCE_ID: "welcome-test",
        PHYLAX_SERVICE_NUMBER_ID: "welcome-test",
      },
    });
    const whatsapp = unit.phylaxRuntime.whatsapp;
    const status = whatsapp.status();
    vi.spyOn(whatsapp, "status").mockReturnValue({ ...status, enabled: true, state: "connected", linkedNumber: "••••0111" } as never);
    vi.spyOn(whatsapp, "sharedNumber").mockReturnValue("+34 699 000 111");
    const server = await new Promise<ServerType>((resolve) => {
      const active = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(active));
    });
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const first = new Client({ name: "welcome-test", version: "1" });
    await first.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
    const ensured = await first.callTool({
      name: "phylax_management_v1_ensure_binding",
      arguments: {
        operationId: "ensure-welcome-01",
        expectedRevision: "0",
        externalTenantId: "acct-alpha",
        downstreamUrl: "https://memory.example/mcp/alpha",
        downstreamToken: "native-secret",
      },
    });
    if (ensured.isError) throw new Error(JSON.stringify(ensured.content));
    await first.close();
    // The channel tools are listed for a bound tenant, so a fresh session after the binding.
    const client = new Client({ name: "welcome-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
    const handler = (whatsapp as unknown as { options: { portedInboundHandler: WhatsAppPortedInboundHandler } })
      .options.portedInboundHandler;
    const send = (code: string, messageId: string) => handler({
      event: {
        messageId,
        chatId: "34644444444@s.whatsapp.net",
        senderId: "34644444444@s.whatsapp.net",
        senderName: "",
        chatName: "",
        isGroup: false,
        timestamp: Date.now(),
        body: code,
        hasMedia: false,
        mediaType: null,
        mimeType: null,
        fileName: null,
      },
      text: code,
      timing: { lifecycleStartedAt: Date.now(), mediaDownloadMs: null },
      progress: async () => {},
    });
    const connect = async (operationId: string, welcome?: "tester") => {
      const status = await client.callTool({ name: "phylax_management_v1_channel_status", arguments: {} });
      if (status.isError) throw new Error(JSON.stringify(status.content));
      const revision = (status.structuredContent as any).channels.whatsapp.revision as string;
      const call = await client.callTool({
        name: "phylax_management_v1_channel_connect",
        arguments: { operationId, expectedRevision: revision, channel: "whatsapp", identity: "+34 644 444 444", ...(welcome ? { welcome } : {}) },
      });
      expect(call.isError).not.toBe(true);
      return (call.structuredContent as any).challenge.code as string;
    };
    return { unit, client, send, connect };
  }

  it("replies with the welcome once when armed, the old reply otherwise", async () => {
    const { client, send, connect } = await setup();
    try {
      const code = await connect("connect-welcome-1", "tester");
      await expect(send(code, "m1")).resolves.toMatchObject({ replyText: ZENOD_WHATSAPP_TESTER_WELCOME });
      // The same code again is a replay: today's reply, no second welcome.
      await expect(send(code, "m2")).resolves.toMatchObject({ replyText: ZENOD_WHATSAPP_VERIFICATION_REPLY });
    } finally {
      await client.close();
    }
  });

  it("a code asked without the welcome disarms an earlier arm (the switch went off)", async () => {
    const { client, send, connect } = await setup();
    try {
      await connect("connect-welcome-a", "tester");
      const code = await connect("connect-welcome-b");
      await expect(send(code, "m1")).resolves.toMatchObject({ replyText: ZENOD_WHATSAPP_VERIFICATION_REPLY });
    } finally {
      await client.close();
    }
  });
});
