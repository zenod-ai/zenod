import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SqliteTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";

const peerMocks = vi.hoisted(() => ({
  discoverPeerTools: vi.fn(),
  callPeerTool: vi.fn(),
}));

vi.mock("../src/peerClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/peerClient.js")>()),
  discoverPeerTools: peerMocks.discoverPeerTools,
  callPeerTool: peerMocks.callPeerTool,
}));

import {
  PHYLAX_TRANSPORT_PROTOCOL,
  PHYLAX_TRANSPORT_VERSION,
  type PhylaxFixedProductAdapter,
} from "../src/phylaxChannels.js";
import {
  PHYLAX_MANAGEMENT_PROFILES,
  PHYLAX_MANAGEMENT_TOOL_NAMES,
} from "../src/phylaxManagementMcp.js";
import {
  assertCustomerDownstreamMutationAllowed,
  type PhylaxInstanceMode,
} from "../src/phylaxInstance.js";
import { createPhylaxUnit, resolvePhylaxRuntimeRoute } from "../src/phylaxUnit.js";

const dirs: string[] = [];
const servers: ServerType[] = [];
const TENANT_ID = "shared-tenant";
const PROVIDER_EVENT_ID = "shared-provider-event-001";
const PERIOD_ID = "zpf9-test-period";
const GRANT_EVENT_ID = "zpf9-shared-grant-event";
const TARIFF_VERSION = "zpf9-test-tariff-v1";

type Island = {
  mode: PhylaxInstanceMode;
  dataDir: string;
  masterKey: string;
  instanceId: string;
  serviceNumberId: string;
  phone: string;
  sender: string;
  downstreamUrl: string;
  downstreamToken: string;
  profile: string;
  serviceToken: string;
  wrongProfileToken: string;
  ordinaryToken: string;
  tenantStore: SqliteTenantStore;
  unit: ReturnType<typeof createPhylaxUnit>;
  server: ServerType;
  base: string;
  sessionPath: string;
  sessionSentinel: string;
};

afterEach(async () => {
  peerMocks.discoverPeerTools.mockReset();
  peerMocks.callPeerTool.mockReset();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function serviceTokenFor(tenantId: string, profile: string, island: string): string {
  return `zenod_${createHash("sha256").update(`${island}\0${tenantId}\0${profile}`).digest("hex").slice(0, 48)}`;
}

function structured(call: Awaited<ReturnType<Client["callTool"]>>) {
  return call.structuredContent as Record<string, any>;
}

async function clientFor(base: string, token: string) {
  const client = new Client({ name: "phylax-three-island-conformance", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
  return client;
}

async function startIsland(input: {
  mode: PhylaxInstanceMode;
  suffix: string;
  phone: string;
  masterByte: string;
  fixedProductAdapter?: PhylaxFixedProductAdapter;
}): Promise<Island> {
  const dataDir = await mkdtemp(join(tmpdir(), `phylax-zpf9-${input.suffix}-`));
  dirs.push(dataDir);
  const instanceId = `zpf9-${input.suffix}-instance`;
  const serviceNumberId = `zpf9-${input.suffix}-number`;
  const masterKey = input.masterByte.repeat(32);
  const sessionPath = join(dataDir, "whatsapp", "session", "owner.sentinel");
  const sessionSentinel = `session-${input.suffix}-must-survive`;
  await mkdir(join(dataDir, "whatsapp", "session"), { recursive: true });
  await writeFile(sessionPath, sessionSentinel);

  const tenantStore = new SqliteTenantStore({ dataDir });
  const ordinary = tenantStore.provisionTenant({ tenant: { id: TENANT_ID } });
  const profile = PHYLAX_MANAGEMENT_PROFILES[input.mode === "standalone" ? "phylax" : input.mode];
  const wrongProfile = input.mode === "zenod"
    ? PHYLAX_MANAGEMENT_PROFILES.pm
    : PHYLAX_MANAGEMENT_PROFILES.zenod;
  const serviceToken = serviceTokenFor(TENANT_ID, profile, input.suffix);
  const wrongProfileToken = serviceTokenFor(TENANT_ID, wrongProfile, input.suffix);
  expect(tenantStore.ensureTenantToken(TENANT_ID, profile, serviceToken)?.outcome).toMatch(/created|replayed/);
  expect(tenantStore.ensureTenantToken(TENANT_ID, wrongProfile, wrongProfileToken)?.outcome).toMatch(/created|replayed/);

  const unit = createPhylaxUnit({
    dataDir,
    tenantStore,
    ...(input.fixedProductAdapter ? { fixedProductAdapter: input.fixedProductAdapter } : {}),
    env: {
      CHASSIS_VAULT_MASTER_KEY: masterKey,
      PHYLAX_PREWARM_LOCAL_MODEL: "0",
      PHYLAX_INSTANCE_MODE: input.mode,
      PHYLAX_INSTANCE_ID: instanceId,
      PHYLAX_SERVICE_NUMBER_ID: serviceNumberId,
    },
  });
  const server = await new Promise<ServerType>((resolve) => {
    const active = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(active));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    mode: input.mode,
    dataDir,
    masterKey,
    instanceId,
    serviceNumberId,
    phone: input.phone,
    sender: `${input.phone}@s.whatsapp.net`,
    downstreamUrl: `https://${input.suffix}.downstream.test/mcp/${TENANT_ID}`,
    downstreamToken: `${input.suffix}-downstream-secret`,
    profile,
    serviceToken,
    wrongProfileToken,
    ordinaryToken: ordinary.token,
    tenantStore,
    unit,
    server,
    base,
    sessionPath,
    sessionSentinel,
  };
}

async function stopIsland(island: Island) {
  await island.unit.close();
  const index = servers.indexOf(island.server);
  if (index >= 0) servers.splice(index, 1);
  await new Promise<void>((resolve) => island.server.close(() => resolve()));
}

function sqliteTableNames(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>)
      .map((row) => row.name);
  } finally {
    db.close();
  }
}

describe("Phylax three-island conformance", () => {
  it("runs fixed Zenod, fixed neutral-PM and native standalone islands from one core without crossing authority or state", async () => {
    const observedPmEnvelopes: Array<Record<string, any>> = [];
    const pmAdapter: PhylaxFixedProductAdapter = {
      mode: "pm",
      adapterId: "zpf9-neutral-pm-contract-fixture-v1",
      createCall(envelope) {
        observedPmEnvelopes.push(envelope as unknown as Record<string, any>);
        return { tool: "pm_channel_fixture_v1", arguments: { envelope } };
      },
    };

    peerMocks.discoverPeerTools.mockImplementation(async (peer: { token: string }) => ({
      transport: "connected",
      tools: "ready",
      specs: peer.token.startsWith("pm-")
        ? [{
            as: "pm-fixture",
            mcp: "pm_channel_fixture_v1",
            arg: "input",
            description: "Test-only neutral bounded transport fixture",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              required: ["envelope"],
              properties: { envelope: { type: "object" } },
            },
          }]
        : peer.token.startsWith("native-")
          ? [{
              as: "native-fixture",
              mcp: "native_channel_fixture_v1",
              arg: "input",
              description: "Test-only native destination",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["message", "providerMessageId"],
                properties: { message: { type: "string" }, providerMessageId: { type: "string" } },
              },
            }]
          : [{
              as: "zenod-chat",
              mcp: "chat_with_zenod",
              arg: "input",
              description: "Zenod chat",
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
            }],
    }));
    peerMocks.callPeerTool.mockImplementation(async (
      peer: { url: string },
      tool: string,
    ) => ({
      content: [{ type: "text", text: `${tool} terminal reply` }],
      structuredContent: {
        receipt: {
          protocol: PHYLAX_TRANSPORT_PROTOCOL,
          version: PHYLAX_TRANSPORT_VERSION,
          kind: tool === "pm_channel_fixture_v1" ? "pm_transport_fixture" : "terminal_transport",
          receipt_id: `${tool}-${new URL(peer.url).hostname}`,
          status: "completed",
        },
      },
    }));

    const [zenod, pm, standalone] = await Promise.all([
      startIsland({ mode: "zenod", suffix: "zenod", phone: "34611111111", masterByte: "1a" }),
      startIsland({ mode: "pm", suffix: "pm", phone: "34622222222", masterByte: "2b", fixedProductAdapter: pmAdapter }),
      startIsland({ mode: "standalone", suffix: "native", phone: "34633333333", masterByte: "3c" }),
    ]);
    const islands = [zenod, pm, standalone];
    const clients: Client[] = [];

    try {
      expect(new Set(islands.map((island) => island.dataDir)).size).toBe(3);
      expect(new Set(islands.map((island) => island.instanceId)).size).toBe(3);
      expect(new Set(islands.map((island) => island.serviceNumberId)).size).toBe(3);
      expect(new Set(islands.map((island) => island.masterKey)).size).toBe(3);
      expect(new Set(islands.map((island) => island.downstreamToken)).size).toBe(3);
      expect(new Set(islands.map((island) => island.tenantStore)).size).toBe(3);
      expect(new Set(islands.map((island) => island.unit.phylaxTenantSettings)).size).toBe(3);
      expect(new Set(islands.map((island) => island.unit.phylaxAllowanceLedger)).size).toBe(3);
      expect(new Set(islands.map((island) => island.unit.phylaxRuntime.constructor))).toHaveLength(1);
      expect(new Set(islands.map((island) => island.unit.phylaxRuntime.organ.constructor))).toHaveLength(1);
      expect(islands.map((island) => island.unit.phylaxInstance.mode)).toEqual(["zenod", "pm", "standalone"]);

      // PM remains fail-closed without a server-owned adapter, and an adapter
      // cannot be injected into the wrong fixed-product island.
      const mismatchDir = await mkdtemp(join(tmpdir(), "phylax-zpf9-adapter-mismatch-"));
      dirs.push(mismatchDir);
      expect(() => createPhylaxUnit({
        dataDir: mismatchDir,
        fixedProductAdapter: pmAdapter,
        env: {
          CHASSIS_VAULT_MASTER_KEY: "4d".repeat(32),
          PHYLAX_INSTANCE_MODE: "zenod",
          PHYLAX_INSTANCE_ID: "adapter-mismatch",
          PHYLAX_SERVICE_NUMBER_ID: "adapter-mismatch",
        },
      })).toThrow("targets pm; refusing zenod instance");

      for (const island of islands) {
        const managed = await clientFor(island.base, island.serviceToken);
        const wrong = await clientFor(island.base, island.wrongProfileToken);
        const ordinary = await clientFor(island.base, island.ordinaryToken);
        clients.push(managed, wrong, ordinary);
        expect((await managed.listTools()).tools.map((tool) => tool.name).sort())
          .toEqual([...PHYLAX_MANAGEMENT_TOOL_NAMES].sort());
        expect((await wrong.listTools()).tools).toEqual([]);
        expect((await ordinary.listTools()).tools.map((tool) => tool.name))
          .not.toEqual(expect.arrayContaining([...PHYLAX_MANAGEMENT_TOOL_NAMES]));
        const capabilities = structured(await managed.callTool({
          name: "phylax_management_v1_capabilities",
          arguments: { clientVersions: ["1.0"] },
        }));
        expect(capabilities).toMatchObject({ owner: island.mode === "standalone" ? "phylax" : island.mode });

        const binding = await managed.callTool({
          name: "phylax_management_v1_ensure_binding",
          arguments: {
            operationId: "zpf9-shared-binding-event",
            expectedRevision: "0",
            externalTenantId: "same-external-tenant-id",
            downstreamUrl: island.downstreamUrl,
            downstreamToken: island.downstreamToken,
          },
        });
        expect(binding.isError).not.toBe(true);

        const registration = island.unit.phylaxTenantSettings.registerPhone(
          TENANT_ID,
          island.phone,
          island.serviceNumberId,
          Date.now(),
          "42-otter",
        );
        expect(island.unit.phylaxTenantSettings.verifyInbound(island.sender, registration.keyword))
          .toMatchObject({ tenantId: TENANT_ID, verified: true });
      }

      expect(resolvePhylaxRuntimeRoute(
        pm.unit.phylaxInstance,
        pm.unit.phylaxTenantSettings,
        "whatsapp",
        pm.sender,
      )).toBeNull();
      expect(resolvePhylaxRuntimeRoute(
        pm.unit.phylaxInstance,
        pm.unit.phylaxTenantSettings,
        "whatsapp",
        pm.sender,
        pmAdapter,
      )).toMatchObject({
        tenantId: TENANT_ID,
        downstreamUrl: pm.downstreamUrl,
        downstreamToken: pm.downstreamToken,
        turnBindings: undefined,
      });

      for (let source = 0; source < islands.length; source += 1) {
        for (let target = 0; target < islands.length; target += 1) {
          if (source === target) continue;
          for (const foreignToken of [islands[source]!.serviceToken, islands[source]!.ordinaryToken]) {
            expect((await fetch(`${islands[target]!.base}/mcp/${foreignToken}`)).status).toBe(401);
          }
        }
      }

      const now = Date.now();
      // In the standalone case this same reviewed management contract acts as
      // a test-only native issuer adapter. It does not define a browser flow,
      // public pricing decision, or a second allowance path.
      for (const island of islands) {
        const managed = clients[islands.indexOf(island) * 3]!;
        const grantArguments = {
          operationId: GRANT_EVENT_ID,
          expectedRevision: "0",
          periodId: PERIOD_ID,
          startsAt: now - 1_000,
          endsAt: now + 60_000,
          amountUnits: 1_000,
          tariffVersion: TARIFF_VERSION,
          auditReason: "ZPF-9 test-only issuer grant; no pricing decision",
        };
        const grant = await managed.callTool({
          name: "phylax_management_v1_credit_grant",
          arguments: grantArguments,
        });
        expect(grant.isError).not.toBe(true);
        expect(structured(grant)).toMatchObject({
          replayed: false,
          allowance: { tenantId: TENANT_ID, remainingUnits: 1_000, state: "active" },
        });
        const replay = await managed.callTool({
          name: "phylax_management_v1_credit_grant",
          arguments: grantArguments,
        });
        expect(structured(replay)).toEqual(structured(grant));
        const projection = structured(await managed.callTool({
          name: "phylax_management_v1_credit_query",
          arguments: {},
        }));
        expect(projection).toMatchObject({
          revision: "1",
          allowance: { tenantId: TENANT_ID, remainingUnits: 1_000, state: "active" },
        });
        expect(JSON.stringify(projection)).not.toMatch(/commercial-owner|auditReason|tariffVersion/i);
      }
      expect(islands.map((island) => island.unit.phylaxAllowanceLedger.operatorProjection(TENANT_ID, PERIOD_ID)
        .entries.find((entry) => entry.idempotencyKey === GRANT_EVENT_ID)?.source))
        .toEqual(["commercial-owner:zenod", "commercial-owner:pm", "commercial-owner:phylax"]);

      const hostileBindings = {
        voice_note: { tool: "hostile_persisted_route", argumentMappings: { message: { source: "message" as const } } },
        text: { tool: "hostile_persisted_route", argumentMappings: { message: { source: "message" as const } } },
        media: { tool: "hostile_persisted_route", argumentMappings: { message: { source: "message" as const } } },
      };
      zenod.unit.phylaxTenantSettings.update(TENANT_ID, { turnBindings: hostileBindings });
      pm.unit.phylaxTenantSettings.update(TENANT_ID, { turnBindings: hostileBindings });
      standalone.unit.phylaxTenantSettings.update(TENANT_ID, {
        turnBindings: {
          ...hostileBindings,
          text: {
            tool: "native_channel_fixture_v1",
            argumentMappings: {
              message: { source: "message" },
              providerMessageId: { source: "providerMessageId" },
            },
          },
        },
      });
      expect(() => assertCustomerDownstreamMutationAllowed(zenod.unit.phylaxInstance, {
        downstreamUrl: "https://attacker.test/mcp",
      })).toThrow("fixed zenod adapter");
      expect(() => assertCustomerDownstreamMutationAllowed(pm.unit.phylaxInstance, {
        turnBindings: hostileBindings,
      })).toThrow("fixed pm adapter");
      expect(() => assertCustomerDownstreamMutationAllowed(standalone.unit.phylaxInstance, {
        turnBindings: hostileBindings,
      })).not.toThrow();
      expect((await zenod.unit.app.request("/api/phylax/settings", {
        headers: { authorization: `Bearer ${zenod.serviceToken}` },
      })).status).toBe(404);
      expect((await pm.unit.app.request("/api/phylax/settings", {
        headers: { authorization: `Bearer ${pm.serviceToken}` },
      })).status).toBe(404);

      const zenodReceipt = await zenod.unit.phylaxRuntime.organ.receive({
        channel: "whatsapp",
        sender: zenod.sender,
        chatId: zenod.sender,
        messageId: PROVIDER_EVENT_ID,
        senderTimestamp: "2026-08-27T12:00:00.000Z",
        text: "remember the launch constraint",
      });
      const pmReceipt = await pm.unit.phylaxRuntime.organ.receive({
        channel: "whatsapp",
        sender: pm.sender,
        chatId: pm.sender,
        messageId: PROVIDER_EVENT_ID,
        senderTimestamp: "2026-08-27T12:00:00.000Z",
        text: "neutral PM transport payload",
        media: {
          artifactRef: "https://custody.test/media/pm-001",
          mimeType: "application/pdf",
          fileName: "brief.pdf",
        },
      });
      const nativeReceipt = await standalone.unit.phylaxRuntime.organ.receive({
        channel: "whatsapp",
        sender: standalone.sender,
        chatId: standalone.sender,
        messageId: PROVIDER_EVENT_ID,
        senderTimestamp: "2026-08-27T12:00:00.000Z",
        text: "standalone custom destination",
      });
      expect([zenodReceipt.replyText, pmReceipt.replyText, nativeReceipt.replyText]).toEqual([
        "chat_with_zenod terminal reply",
        "pm_channel_fixture_v1 terminal reply",
        "native_channel_fixture_v1 terminal reply",
      ]);
      expect(peerMocks.callPeerTool.mock.calls.map((call) => call[1])).toEqual([
        "chat_with_zenod",
        "pm_channel_fixture_v1",
        "native_channel_fixture_v1",
      ]);
      expect(peerMocks.callPeerTool.mock.calls.map((call) => (call[0] as { url: string }).url)).toEqual(
        islands.map((island) => island.downstreamUrl),
      );
      expect(peerMocks.callPeerTool.mock.calls.map((call) => (call[0] as { token: string }).token)).toEqual(
        islands.map((island) => island.downstreamToken),
      );
      expect(JSON.stringify(peerMocks.callPeerTool.mock.calls)).not.toContain("hostile_persisted_route");
      expect(peerMocks.callPeerTool.mock.calls[0]?.[2]).toEqual({
        message: "remember the launch constraint",
        surface: "whatsapp",
        conversationKey: `whatsapp:${zenod.phone}`,
      });
      expect(peerMocks.callPeerTool.mock.calls[2]?.[2]).toEqual({
        message: "standalone custom destination",
        providerMessageId: PROVIDER_EVENT_ID,
      });
      const pmEnvelope = (peerMocks.callPeerTool.mock.calls[1]?.[2] as Record<string, any>).envelope;
      expect(pmEnvelope).toEqual({
        protocol: PHYLAX_TRANSPORT_PROTOCOL,
        version: PHYLAX_TRANSPORT_VERSION,
        tenantId: TENANT_ID,
        channel: "whatsapp",
        providerMessageId: PROVIDER_EVENT_ID,
        providerMessageIdSource: "provider",
        idempotencyKey: `${TENANT_ID}:whatsapp:${PROVIDER_EVENT_ID}`,
        sender: pm.phone,
        chatId: pm.sender,
        conversationKey: `whatsapp:${pm.phone}`,
        senderTimestamp: "2026-08-27T12:00:00.000Z",
        replyToProviderMessageId: null,
        content: {
          text: "neutral PM transport payload",
          mediaType: "pdf",
          artifact: {
            ref: "https://custody.test/media/pm-001",
            mimeType: "application/pdf",
            fileName: "brief.pdf",
          },
          transcription: {
            text: "neutral PM transport payload",
            provider: null,
            durationSeconds: null,
            durationSecondsReported: false,
            timing: null,
            disposition: "not_applicable",
            failure: null,
          },
          replyContext: null,
        },
      });
      expect(JSON.stringify(pmEnvelope)).not.toMatch(/proposal|revision|accept|reject|zenod|vault/i);
      expect(Object.keys(pmReceipt.downstreamReceipt ?? {})).not.toEqual(expect.arrayContaining([
        "proposal", "revision", "accept", "reject", "zenod", "vault",
      ]));
      expect(pmReceipt.downstreamReceipt).toEqual({
        protocol: PHYLAX_TRANSPORT_PROTOCOL,
        version: PHYLAX_TRANSPORT_VERSION,
        kind: "pm_transport_fixture",
        receipt_id: "pm_channel_fixture_v1-pm.downstream.test",
        status: "completed",
      });

      peerMocks.callPeerTool
        .mockResolvedValueOnce({ content: [{ type: "text", text: "prose-only success" }] })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "malformed typed success" }],
          structuredContent: {
            receipt: {
              protocol: PHYLAX_TRANSPORT_PROTOCOL,
              version: PHYLAX_TRANSPORT_VERSION,
              kind: "pm_transport_fixture",
              receipt_id: "pm-malformed-receipt",
              status: "accepted",
            },
          },
        });
      const malformedInput = {
        channel: "whatsapp" as const,
        sender: pm.sender,
        chatId: pm.sender,
        messageId: "pm-malformed-terminal-001",
        senderTimestamp: "2026-08-27T12:01:00.000Z",
        text: "typed terminal receipt required",
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(pm.unit.phylaxRuntime.organ.receive(malformedInput)).rejects.toMatchObject({
          code: "downstream_error",
          retryDisposition: "idempotent_capture",
          audit: { failureCode: "downstream_schema_drift" },
        });
      }
      expect(observedPmEnvelopes.slice(-2).map((envelope) => envelope.idempotencyKey)).toEqual([
        `${TENANT_ID}:whatsapp:pm-malformed-terminal-001`,
        `${TENANT_ID}:whatsapp:pm-malformed-terminal-001`,
      ]);
      expect(observedPmEnvelopes.at(-2)).toEqual(observedPmEnvelopes.at(-1));

      for (const island of islands) {
        island.unit.phylaxRuntime.whatsappStore.recordChannelForwarding({
          providerMessageId: PROVIDER_EVENT_ID,
          tenantId: TENANT_ID,
          senderId: island.sender,
          transcriptText: `${island.mode}-journal`,
          downstreamDestination: `${island.mode}.downstream.test#tenant:${TENANT_ID}`,
          downstreamReceipt: { kind: `${island.mode}_receipt`, status: "accepted" },
          replyText: `${island.mode}-reply`,
        });
      }
      expect(islands.map((island) => island.unit.phylaxRuntime.whatsappStore.channelAudit(PROVIDER_EVENT_ID)?.transcriptText))
        .toEqual(["zenod-journal", "pm-journal", "standalone-journal"]);
      expect(islands.map((island) => island.unit.phylaxTenantSettings.get(TENANT_ID).numberId))
        .toEqual(islands.map((island) => island.serviceNumberId));
      expect(await Promise.all(islands.map((island) => readFile(island.sessionPath, "utf8"))))
        .toEqual(islands.map((island) => island.sessionSentinel));

      for (const island of islands) {
        const tables = [
          ...sqliteTableNames(join(island.dataDir, "phylax-allowance.sqlite")),
          ...sqliteTableNames(join(island.dataDir, "whatsapp", "whatsapp.sqlite")),
        ];
        if (island.mode === "pm") {
          expect(tables.join(" ")).not.toMatch(/proposal|revision|accept|reject|zenod|vault/i);
        }
        expect((await readdir(island.dataDir)).filter((name) => name === "phylax-tenant-settings.json"))
          .toEqual(["phylax-tenant-settings.json"]);
      }

      for (const client of clients.splice(0)) await client.close();
      await Promise.all(islands.map(stopIsland));

      const restarted = await Promise.all(islands.map(async (island) => {
        const tenantStore = new SqliteTenantStore({ dataDir: island.dataDir });
        const unit = createPhylaxUnit({
          dataDir: island.dataDir,
          tenantStore,
          ...(island.mode === "pm" ? { fixedProductAdapter: pmAdapter } : {}),
          env: {
            CHASSIS_VAULT_MASTER_KEY: island.masterKey,
            PHYLAX_PREWARM_LOCAL_MODEL: "0",
            PHYLAX_INSTANCE_MODE: island.mode,
            PHYLAX_INSTANCE_ID: island.instanceId,
            PHYLAX_SERVICE_NUMBER_ID: island.serviceNumberId,
          },
        });
        return { island, unit, tenantStore };
      }));
      try {
        for (const { island, unit } of restarted) {
          expect(unit.phylaxTenantSettings.view(TENANT_ID)).toMatchObject({
            verified: true,
            numberId: island.serviceNumberId,
            downstreamTokenConfigured: true,
          });
          expect(unit.phylaxAllowanceLedger.operatorProjection(TENANT_ID, PERIOD_ID).entries
            .some((entry) => entry.idempotencyKey === GRANT_EVENT_ID)).toBe(true);
          expect(unit.phylaxRuntime.whatsappStore.channelAudit(PROVIDER_EVENT_ID)?.transcriptText)
            .toBe(`${island.mode}-journal`);
          expect(await readFile(island.sessionPath, "utf8")).toBe(island.sessionSentinel);
          if (island.mode === "standalone") {
            expect(unit.phylaxTenantSettings.view(TENANT_ID).turnBindings.text.tool)
              .toBe("native_channel_fixture_v1");
          }
        }
        const before = (await readdir(zenod.dataDir)).sort();
        expect(() => createPhylaxUnit({
          dataDir: zenod.dataDir,
          env: {
            CHASSIS_VAULT_MASTER_KEY: zenod.masterKey,
            PHYLAX_INSTANCE_MODE: "pm",
            PHYLAX_INSTANCE_ID: zenod.instanceId,
            PHYLAX_SERVICE_NUMBER_ID: zenod.serviceNumberId,
          },
          fixedProductAdapter: pmAdapter,
        })).toThrow(`refusing requested ${zenod.instanceId}/pm/${zenod.serviceNumberId}`);
        expect((await readdir(zenod.dataDir)).sort()).toEqual(before);
      } finally {
        await Promise.all(restarted.map(({ unit }) => unit.close()));
      }
    } finally {
      for (const client of clients.splice(0)) await client.close().catch(() => undefined);
      for (const island of islands) {
        if (servers.includes(island.server)) await stopIsland(island).catch(() => undefined);
      }
    }
  });
});
