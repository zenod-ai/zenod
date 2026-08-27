import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SqliteTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import {
  PHYLAX_MANAGEMENT_PROFILES,
  PHYLAX_MANAGEMENT_TOOL_NAMES,
} from "../src/phylaxManagementMcp.js";
import type { PhylaxInstanceMode } from "../src/phylaxInstance.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";

const dirs: string[] = [];
const servers: ServerType[] = [];
const MASTER_KEY = "76".repeat(32);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function startUnit(
  dataDir: string,
  tenants: SqliteTenantStore,
  mode: PhylaxInstanceMode = "standalone",
) {
  const unit = createPhylaxUnit({
    dataDir,
    tenantStore: tenants,
    env: {
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
      PHYLAX_PREWARM_LOCAL_MODEL: "0",
      PHYLAX_INSTANCE_MODE: mode,
      PHYLAX_INSTANCE_ID: `management-${mode}`,
      PHYLAX_SERVICE_NUMBER_ID: `${mode}-management-test`,
    },
  });
  const server = await new Promise<ServerType>((resolve) => {
    const active = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(active));
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { unit, base: `http://127.0.0.1:${address.port}` };
}

async function clientFor(base: string, token: string) {
  const client = new Client({ name: "phylax-management-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
  return client;
}

function structured(call: Awaited<ReturnType<Client["callTool"]>>) {
  return call.structuredContent as Record<string, any>;
}

function ensureServiceToken(
  tenants: SqliteTenantStore,
  tenantId: string,
  profile: string,
): string {
  const token = `zenod_${createHash("sha256").update(`${tenantId}\0${profile}`).digest("hex").slice(0, 48)}`;
  const ensured = tenants.ensureTenantToken(tenantId, profile, token);
  expect(ensured?.outcome).toMatch(/created|replayed/);
  return token;
}

describe("tenant-safe Phylax management MCP", () => {
  it("keeps browser, ordinary bearer, service profile and owner/admin authorities separate", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-authority-"));
    dirs.push(dataDir);
    const tenants = new SqliteTenantStore({ dataDir });
    const primary = tenants.provisionTenant({ tenant: { id: "alpha" } });
    const serviceToken = ensureServiceToken(tenants, "alpha", PHYLAX_MANAGEMENT_PROFILES.zenod);
    const { unit, base } = await startUnit(dataDir, tenants, "zenod");

    expect((await fetch(`${base}/mcp`)).status).toBe(401);
    expect((await fetch(`${base}/mcp`, { headers: { cookie: "zenod_customer=fake" } })).status).toBe(401);
    expect((await fetch(`${base}/api/phylax/settings`, {
      headers: { authorization: `Bearer ${serviceToken}` },
    })).status).toBe(404);
    expect((await fetch(`${base}/api/whatsapp/status`, {
      headers: { authorization: `Bearer ${serviceToken}` },
    })).status).toBe(404);

    const ordinary = await clientFor(base, primary.token);
    const managed = await clientFor(base, serviceToken);
    try {
      const ordinaryNames = (await ordinary.listTools()).tools.map((tool) => tool.name);
      expect(ordinaryNames).not.toEqual(expect.arrayContaining([...PHYLAX_MANAGEMENT_TOOL_NAMES]));

      const managedTools = (await managed.listTools()).tools;
      const managedNames = managedTools.map((tool) => tool.name);
      expect(managedNames.sort()).toEqual([...PHYLAX_MANAGEMENT_TOOL_NAMES].sort());
      expect(managedNames).not.toEqual(expect.arrayContaining([
        "send_message",
        "pair_whatsapp",
        "reset_whatsapp",
        "replace_credentials",
        "delivery_journal",
        "transport_capacity",
      ]));
      expect(JSON.stringify(managedTools)).not.toContain("tenantId");

      const capabilities = structured(await managed.callTool({
        name: "phylax_management_v1_capabilities",
        arguments: { clientVersions: ["1.0"] },
      }));
      expect(capabilities).toMatchObject({
        protocol: "phylax.management",
        selectedVersion: "1.0",
        owner: "zenod",
        tenantScoped: true,
        ownerAdminSurface: false,
        capturePolicy: { archiveRawAudio: "always", maxTranscriptionSeconds: 7_200 },
      });
      const skew = await managed.callTool({
        name: "phylax_management_v1_capabilities",
        arguments: { clientVersions: ["2.0"] },
      });
      expect(skew.isError).toBe(true);
      expect(structured(skew)).toMatchObject({ error: { code: "unsupported_version" } });
    } finally {
      await ordinary.close();
      await managed.close();
      await unit.close();
    }
  });

  it("binds one owner/tenant, denies owner collision, and survives restart without rotating the service token", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-binding-"));
    dirs.push(dataDir);
    let tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    const zenodToken = ensureServiceToken(tenants, "alpha", PHYLAX_MANAGEMENT_PROFILES.zenod);
    const pmToken = ensureServiceToken(tenants, "alpha", PHYLAX_MANAGEMENT_PROFILES.pm);
    let started = await startUnit(dataDir, tenants, "zenod");
    let zenodClient = await clientFor(started.base, zenodToken);
    try {
      const ensured = await zenodClient.callTool({
        name: "phylax_management_v1_ensure_binding",
        arguments: {
          operationId: "ensure-alpha-0001",
          expectedRevision: "0",
          externalTenantId: "zenod-customer-42",
          downstreamUrl: "https://cloud.zenod.dev/mcp/tenant-alpha",
          downstreamToken: "downstream-alpha-secret",
        },
      });
      expect(ensured.isError).not.toBe(true);
      expect(structured(ensured)).toMatchObject({
        binding: { commercialOwner: "zenod", externalTenantId: "zenod-customer-42", downstreamConfigured: true },
        replayed: false,
      });
      expect(JSON.stringify(structured(ensured))).not.toContain("downstream-alpha-secret");
      const replay = await zenodClient.callTool({
        name: "phylax_management_v1_ensure_binding",
        arguments: {
          operationId: "ensure-alpha-0001",
          expectedRevision: "0",
          externalTenantId: "zenod-customer-42",
          downstreamUrl: "https://cloud.zenod.dev/mcp/tenant-alpha",
          downstreamToken: "downstream-alpha-secret",
        },
      });
      expect(replay.isError).not.toBe(true);
      expect(structured(replay)).toEqual(structured(ensured));

      const pmClient = await clientFor(started.base, pmToken);
      try {
        expect((await pmClient.listTools()).tools).toEqual([]);
      } finally {
        await pmClient.close();
      }
      expect(() => started.unit.phylaxTenantSettings.ensureManagementBinding({
        tenantId: "alpha",
        commercialOwner: "pm",
        externalTenantId: "pm-customer-42",
        downstreamUrl: "https://pm.example/mcp/alpha",
        downstreamToken: "pm-secret",
        expectedRevision: structured(ensured).binding.revision,
      })).toThrow("commercial owner");
    } finally {
      await zenodClient.close();
      await started.unit.close();
      await new Promise<void>((resolve) => servers.shift()!.close(() => resolve()));
    }

    tenants = new SqliteTenantStore({ dataDir });
    started = await startUnit(dataDir, tenants, "zenod");
    zenodClient = await clientFor(started.base, zenodToken);
    try {
      const status = await zenodClient.callTool({
        name: "phylax_management_v1_channel_status",
        arguments: {},
      });
      expect(status.isError).not.toBe(true);
      expect(structured(status)).toMatchObject({
        binding: { commercialOwner: "zenod", externalTenantId: "zenod-customer-42", downstreamConfigured: true },
      });
    } finally {
      await zenodClient.close();
      await started.unit.close();
    }
  });

  it("provides revision-bound exactly-once credit/control mutations with tenant isolation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-ledger-"));
    dirs.push(dataDir);
    const tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    tenants.provisionTenant({ tenant: { id: "beta" } });
    const alphaToken = ensureServiceToken(tenants, "alpha", PHYLAX_MANAGEMENT_PROFILES.zenod);
    const betaToken = ensureServiceToken(tenants, "beta", PHYLAX_MANAGEMENT_PROFILES.zenod);
    const { unit, base } = await startUnit(dataDir, tenants, "zenod");
    const alpha = await clientFor(base, alphaToken);
    const beta = await clientFor(base, betaToken);
    const ensure = async (client: Client, id: string) => client.callTool({
      name: "phylax_management_v1_ensure_binding",
      arguments: {
        operationId: `ensure-${id}-0001`,
        expectedRevision: "0",
        externalTenantId: `host-${id}`,
        downstreamUrl: `https://example.com/mcp/${id}`,
        downstreamToken: `secret-${id}`,
      },
    });
    try {
      await ensure(alpha, "alpha");
      await ensure(beta, "beta");
      unit.phylaxUsageMeter.recordInboundMessage({
        tenantId: "alpha",
        providerMessageId: "mixed-version-before-grant",
        channel: "whatsapp",
      });
      expect(unit.phylaxUsageMeter.pending("alpha")).toBe(1);
      let allowanceWakes = 0;
      unit.phylaxRuntime.wakeAllowanceWork = () => { allowanceWakes += 1; };
      const now = Date.now();
      const grantArgs = {
        operationId: "grant-alpha-0001",
        expectedRevision: "0",
        periodId: "2026-08",
        startsAt: now - 1_000,
        endsAt: now + 60_000,
        amountUnits: 500,
        tariffVersion: "v1",
        auditReason: "integrated subscription allowance",
      };
      const grant = await alpha.callTool({ name: "phylax_management_v1_credit_grant", arguments: grantArgs });
      expect(grant.isError).not.toBe(true);
      expect(structured(grant)).toMatchObject({ replayed: false, revision: "2", allowance: { remainingUnits: 499 } });
      expect(unit.phylaxUsageMeter.pending("alpha")).toBe(0);
      expect(allowanceWakes).toBe(1);
      const lostResponseReplay = await alpha.callTool({ name: "phylax_management_v1_credit_grant", arguments: grantArgs });
      expect(structured(lostResponseReplay)).toEqual(structured(grant));

      const collision = await alpha.callTool({
        name: "phylax_management_v1_credit_grant",
        arguments: { ...grantArgs, amountUnits: 700 },
      });
      expect(collision.isError).toBe(true);
      expect(structured(collision)).toMatchObject({ error: { code: "operation_conflict" } });

      const stale = await alpha.callTool({
        name: "phylax_management_v1_credit_adjust",
        arguments: {
          operationId: "adjust-alpha-01",
          expectedRevision: "0",
          periodId: "2026-08",
          amountUnits: 25,
          tariffVersion: "v1",
          auditReason: "manual correction",
        },
      });
      expect(stale.isError).toBe(true);
      expect(structured(stale)).toMatchObject({ error: { code: "stale_revision" } });

      const suspended = await alpha.callTool({
        name: "phylax_management_v1_suspend",
        arguments: {
          operationId: "suspend-alpha-1",
          expectedRevision: "2",
          auditReason: "subscription paused",
        },
      });
      expect(structured(suspended)).toMatchObject({ revision: "3", allowance: { state: "suspended" } });
      const resumed = await alpha.callTool({
        name: "phylax_management_v1_resume",
        arguments: {
          operationId: "resume-alpha-001",
          expectedRevision: "3",
          auditReason: "subscription restored",
        },
      });
      expect(structured(resumed)).toMatchObject({ revision: "4", allowance: { state: "active", remainingUnits: 499 } });

      const betaProjection = await beta.callTool({ name: "phylax_management_v1_credit_query", arguments: {} });
      expect(structured(betaProjection)).toMatchObject({
        revision: "0",
        allowance: { tenantId: "beta", remainingUnits: 0, state: "unavailable" },
      });
      expect(JSON.stringify(structured(betaProjection))).not.toContain("alpha");
    } finally {
      await alpha.close();
      await beta.close();
      await unit.close();
    }
  });

  it("reuses durable channel audit for challenge replay, revision collision and disconnect", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-channel-"));
    dirs.push(dataDir);
    const tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    const token = ensureServiceToken(tenants, "alpha", PHYLAX_MANAGEMENT_PROFILES.phylax);
    const { unit, base } = await startUnit(dataDir, tenants);
    const client = await clientFor(base, token);
    try {
      await client.callTool({
        name: "phylax_management_v1_ensure_binding",
        arguments: {
          operationId: "ensure-native-01",
          expectedRevision: "0",
          externalTenantId: "native-alpha",
          downstreamUrl: "https://memory.example/mcp/alpha",
          downstreamToken: "native-secret",
        },
      });
      const connectArgs = {
        operationId: "connect-telegram-1",
        expectedRevision: "0",
        channel: "telegram",
        identity: "alpha_user",
      };
      const connected = await client.callTool({ name: "phylax_management_v1_channel_connect", arguments: connectArgs });
      expect(connected.isError).not.toBe(true);
      expect(structured(connected)).toMatchObject({
        channels: { telegram: { state: "awaiting_code" } },
        challenge: { code: expect.stringMatching(/^\d{2}-[a-z]+$/) },
      });
      const replay = await client.callTool({ name: "phylax_management_v1_channel_connect", arguments: connectArgs });
      expect(structured(replay)).toEqual(structured(connected));
      const channelRevision = structured(connected).channels.telegram.revision;
      const staleDisconnect = await client.callTool({
        name: "phylax_management_v1_channel_disconnect",
        arguments: { operationId: "disconnect-tg-01", expectedRevision: "0", channel: "telegram" },
      });
      expect(staleDisconnect.isError).toBe(true);
      expect(structured(staleDisconnect)).toMatchObject({ error: { code: "stale_revision" } });
      const disconnected = await client.callTool({
        name: "phylax_management_v1_channel_disconnect",
        arguments: { operationId: "disconnect-tg-02", expectedRevision: channelRevision, channel: "telegram" },
      });
      expect(disconnected.isError).not.toBe(true);
      expect(structured(disconnected)).toMatchObject({ channels: { telegram: { state: "off" } } });
    } finally {
      await client.close();
      await unit.close();
    }
  });
});
