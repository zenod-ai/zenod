import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SqliteTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import {
  HostedChannelMutationAuditStore,
  type HostedChannelMutationName,
} from "../src/hostedChannels.js";
import { PHYLAX_MANAGEMENT_PROFILES } from "../src/phylaxManagementMcp.js";
import type { PhylaxDeliveryReceipt, PhylaxTenantDelivery } from "../src/phylaxChannels.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";

const dirs: string[] = [];
const servers: ServerType[] = [];
const MASTER_KEY = "77".repeat(32);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function startUnit(dataDir: string, tenants: SqliteTenantStore) {
  const unit = createPhylaxUnit({
    dataDir,
    tenantStore: tenants,
    env: {
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
      PHYLAX_PREWARM_LOCAL_MODEL: "0",
      PHYLAX_INSTANCE_MODE: "zenod",
      PHYLAX_INSTANCE_ID: "management-recovery-zenod",
      PHYLAX_SERVICE_NUMBER_ID: "zenod-management-recovery",
    },
  });
  const server = await new Promise<ServerType>((resolve) => {
    const active = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(active));
  });
  servers.push(server);
  return {
    unit,
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

async function clientFor(base: string, token: string) {
  const client = new Client({ name: "management-recovery-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
  return client;
}

function structured(call: Awaited<ReturnType<Client["callTool"]>>) {
  return call.structuredContent as Record<string, any>;
}

function configureConnectedTenant(
  unit: ReturnType<typeof createPhylaxUnit>,
  tenantId = "alpha",
) {
  unit.phylaxTenantSettings.ensureManagementBinding({
    tenantId,
    commercialOwner: "zenod",
    externalTenantId: "zenod-alpha",
    downstreamUrl: "https://cloud.zenod.dev/mcp/alpha",
    downstreamToken: "downstream-secret",
    expectedRevision: "0",
  });
  unit.phylaxTenantSettings.registerPhone(
    tenantId,
    "+34 611 111 111",
    "primary",
    Date.now(),
    "12-alpha",
  );
  expect(unit.phylaxTenantSettings.verifyInboundReceipt(
    "+34 611 111 111",
    "12-alpha",
  )).not.toBeNull();
  return unit.phylaxTenantSettings.bindingRevision(tenantId, "whatsapp");
}

function stubDelivery(
  unit: ReturnType<typeof createPhylaxUnit>,
  send: PhylaxTenantDelivery["send"],
) {
  Object.defineProperty(unit.phylaxRuntime, "delivery", {
    configurable: true,
    value: (): PhylaxTenantDelivery => ({ send }),
  });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("Phylax management mutation recovery", () => {
  it("reconciles an applied binding after restart without rotating its revision", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-binding-crash-"));
    dirs.push(dataDir);
    let tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    const token = tenants.provisionTenantToken(
      "alpha",
      PHYLAX_MANAGEMENT_PROFILES.zenod,
    )!.token;
    let started = await startUnit(dataDir, tenants);
    const args = {
      operationId: "ensure-binding-crash-01",
      expectedRevision: "0",
      externalTenantId: "zenod-alpha",
      downstreamUrl: "https://cloud.zenod.dev/mcp/alpha",
      downstreamToken: "downstream-secret",
    };
    const operation = "management.ensure_binding" as const;
    expect(started.unit.hostedChannelAudit.claim({
      operationId: args.operationId,
      tenantId: "alpha",
      authorityScope: "management:zenod",
      operation,
      requestHash: digest(JSON.stringify({ operation, body: args })),
      targetHash: digest("zenod:zenod-alpha"),
      bindingRevision: "0",
      at: Date.now(),
    })).toEqual({ kind: "claimed" });
    started.unit.phylaxTenantSettings.ensureManagementBinding({
      tenantId: "alpha",
      commercialOwner: "zenod",
      externalTenantId: args.externalTenantId,
      downstreamUrl: args.downstreamUrl,
      downstreamToken: args.downstreamToken,
      expectedRevision: args.expectedRevision,
    });
    const appliedRevision = started.unit.phylaxTenantSettings.get("alpha").managementBindingRevision;
    expect(appliedRevision).not.toBe("0");
    await started.unit.close();
    await new Promise<void>((resolve) => servers.shift()!.close(() => resolve()));
    const db = new DatabaseSync(join(dataDir, "hosted-channel-mutations.sqlite"));
    db.exec("UPDATE hosted_channel_mutations SET claim_expires_at=0 WHERE state='claimed'");
    db.close();

    tenants = new SqliteTenantStore({ dataDir });
    started = await startUnit(dataDir, tenants);
    const client = await clientFor(started.base, token);
    try {
      const recovered = await client.callTool({
        name: "phylax_management_v1_ensure_binding",
        arguments: args,
      });
      expect(recovered.isError).not.toBe(true);
      expect(structured(recovered)).toMatchObject({
        binding: { revision: appliedRevision },
        replayed: true,
        mutation: { operationId: args.operationId, outcome: "succeeded" },
      });
      expect(started.unit.phylaxTenantSettings.get("alpha").managementBindingRevision)
        .toBe(appliedRevision);
      expect(JSON.stringify(structured(recovered))).not.toContain(args.downstreamToken);
    } finally {
      await client.close();
      await started.unit.close();
    }
  });

  it("returns and terminal-replays the exact customer-safe provider receipt", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-receipt-"));
    dirs.push(dataDir);
    const tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    const token = tenants.provisionTenantToken(
      "alpha",
      PHYLAX_MANAGEMENT_PROFILES.zenod,
    )!.token;
    const { unit, base } = await startUnit(dataDir, tenants);
    const revision = configureConnectedTenant(unit);
    let sends = 0;
    const receipt: PhylaxDeliveryReceipt = {
      channel: "whatsapp",
      recipient: "+34611111111",
      sentMessageId: "wamid.management-test-001",
      status: "sent",
      at: "2026-08-27T15:30:00.000Z",
    };
    stubDelivery(unit, async () => {
      sends += 1;
      return receipt;
    });
    const client = await clientFor(base, token);
    const args = {
      operationId: "management-test-receipt-01",
      expectedRevision: revision,
      channel: "whatsapp",
    };
    try {
      const sent = await client.callTool({
        name: "phylax_management_v1_channel_test",
        arguments: args,
      });
      expect(sent.isError).not.toBe(true);
      expect(structured(sent)).toMatchObject({ receipt });
      expect(Object.keys(structured(sent).receipt).sort()).toEqual([
        "at",
        "channel",
        "recipient",
        "sentMessageId",
        "status",
      ]);
      const replay = await client.callTool({
        name: "phylax_management_v1_channel_test",
        arguments: args,
      });
      expect(structured(replay)).toEqual(structured(sent));
      expect(sends).toBe(1);
    } finally {
      await client.close();
      await unit.close();
    }
  });

  it("does not reconstruct success or resend when a test-send receipt was lost before terminal persistence", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-management-send-crash-"));
    dirs.push(dataDir);
    let tenants = new SqliteTenantStore({ dataDir });
    tenants.provisionTenant({ tenant: { id: "alpha" } });
    const token = tenants.provisionTenantToken(
      "alpha",
      PHYLAX_MANAGEMENT_PROFILES.zenod,
    )!.token;
    let started = await startUnit(dataDir, tenants);
    const revision = configureConnectedTenant(started.unit);
    const target = started.unit.phylaxTenantSettings.get("alpha").phoneNumber!;
    await started.unit.close();
    await new Promise<void>((resolve) => servers.shift()!.close(() => resolve()));

    const operationId = "management-test-crash-01";
    const operation = "whatsapp.test" as HostedChannelMutationName;
    const requestBody = { channel: "whatsapp", expectedRevision: revision };
    const audit = new HostedChannelMutationAuditStore(dataDir, {
      executorId: "crashed-management-send",
      claimLeaseMs: 0,
    });
    expect(audit.claim({
      operationId,
      tenantId: "alpha",
      authorityScope: "management:zenod",
      operation,
      requestHash: digest(JSON.stringify({ operation, body: requestBody })),
      targetHash: digest(target),
      bindingRevision: revision,
      at: Date.now(),
    })).toEqual({ kind: "claimed" });
    // The provider accepted one send, then the process died before persisting
    // its exact receipt. A restart must not infer success from channel state.
    let sends = 1;
    audit.close();

    tenants = new SqliteTenantStore({ dataDir });
    started = await startUnit(dataDir, tenants);
    stubDelivery(started.unit, async () => {
      sends += 1;
      return {
        channel: "whatsapp",
        recipient: "+34611111111",
        sentMessageId: "must-not-be-sent",
        status: "sent",
        at: new Date().toISOString(),
      };
    });
    const client = await clientFor(started.base, token);
    const args = { operationId, expectedRevision: revision, channel: "whatsapp" };
    try {
      const unknown = await client.callTool({
        name: "phylax_management_v1_channel_test",
        arguments: args,
      });
      expect(unknown.isError).toBe(true);
      expect(structured(unknown)).toMatchObject({
        error: {
          code: "operation_outcome_unknown",
          retryDisposition: "do_not_retry",
        },
        mutation: { operationId, operation: "whatsapp.test", outcome: "failed" },
      });
      const replay = await client.callTool({
        name: "phylax_management_v1_channel_test",
        arguments: args,
      });
      expect(structured(replay)).toEqual(structured(unknown));
      expect(sends).toBe(1);
    } finally {
      await client.close();
      await started.unit.close();
    }
  });
});
