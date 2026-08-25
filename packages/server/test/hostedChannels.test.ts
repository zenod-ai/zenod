import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountHostedChannelsCustomerRoutes,
  type HostedChannelsView,
} from "../src/hostedChannels.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";

const dirs: string[] = [];
const MASTER_KEY = "33".repeat(32);
const PRIVATE_TOKEN = "private-zenod-channels-token";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function authorization() {
  return {
    authorization: `Bearer ${PRIVATE_TOKEN}`,
    "content-type": "application/json",
  };
}

function connectedTransportStatus<
  T extends { state: string; linkedNumber: string | null },
>(status: T): T {
  return {
    ...status,
    enabled: true,
    state: "connected",
    linkedNumber: "+34 699 000 111",
  };
}

describe("Hosted Zenod channel adapter", () => {
  it("reports an unavailable transport as a typed failure without partially binding the tenant", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "hosted-channels-unavailable-"),
    );
    dirs.push(dataDir);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      },
    });
    try {
      const response = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/whatsapp/challenge",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId: "challenge-unavailable",
            sender: "+34 611 111 111",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "must-not-be-persisted",
          }),
        },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "channels_unavailable" },
        mutation: {
          operationId: "challenge-unavailable",
          operation: "whatsapp.challenge",
          outcome: "failed",
        },
      });
      expect(unit.phylaxTenantSettings.view("tenant-alpha")).toMatchObject({
        phoneNumber: null,
        verified: false,
        downstreamTokenConfigured: false,
      });
    } finally {
      await unit.close();
    }
  });

  it("keeps tenant sender activation typed, isolated, audited, and separate from the shared session", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hosted-channels-private-"));
    dirs.push(dataDir);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      },
    });
    const transportStatus = vi.spyOn(unit.phylaxRuntime.whatsapp, "status");
    const baseline = unit.phylaxRuntime.whatsapp.status();
    transportStatus.mockReturnValue(connectedTransportStatus(baseline));
    const sharedDisconnect = vi.spyOn(
      unit.phylaxRuntime.whatsapp,
      "disconnect",
    );
    try {
      expect(
        (await unit.app.request("/internal/zenod/channels/tenant-alpha"))
          .status,
      ).toBe(404);
      expect(
        (
          await unit.app.request("/internal/zenod/channels/tenant-alpha", {
            headers: { authorization: "Bearer wrong" },
          })
        ).status,
      ).toBe(404);

      const challenge = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/whatsapp/challenge",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId: "challenge-alpha",
            sender: "+34 611 111 111",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "alpha-memory-token",
          }),
        },
      );
      expect(challenge.status).toBe(200);
      const challengeBody = (await challenge.json()) as {
        channels: HostedChannelsView;
        challenge: { code: string; sharedNumber: string };
        mutation: { operation: string; outcome: string; operationId: string };
      };
      expect(challengeBody).toMatchObject({
        channels: {
          whatsapp: {
            state: "awaiting_code",
            senderHint: "••••1111",
            sharedNumber: "+34 699 000 111",
          },
        },
        mutation: {
          operationId: "challenge-alpha",
          operation: "whatsapp.challenge",
          outcome: "succeeded",
        },
      });
      const serialized = JSON.stringify(challengeBody);
      expect(serialized).not.toContain("alpha-memory-token");
      expect(serialized).not.toMatch(
        /Phylax|Ring|downstream|provider|session|QR/i,
      );

      const collision = await unit.app.request(
        "/internal/zenod/channels/tenant-beta/whatsapp/challenge",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId: "challenge-beta-collision",
            sender: "+34 611 111 111",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "beta-memory-token",
          }),
        },
      );
      expect(collision.status).toBe(409);
      expect(await collision.json()).toMatchObject({
        error: { code: "sender_in_use" },
        mutation: { outcome: "rejected" },
      });
      const betaStatus = await unit.app.request(
        "/internal/zenod/channels/tenant-beta",
        { headers: authorization() },
      );
      expect(await betaStatus.json()).toMatchObject({
        whatsapp: { state: "off", senderHint: null },
      });

      expect(
        unit.phylaxTenantSettings.verifyInbound(
          "34611111111@s.whatsapp.net",
          challengeBody.challenge.code,
        ),
      ).toMatchObject({ tenantId: "tenant-alpha", verified: true });

      const send = vi.fn().mockResolvedValue({
        channel: "whatsapp",
        recipient: "34611111111",
        sentMessageId: "provider-id-hidden",
        status: "sent",
        at: new Date().toISOString(),
      });
      vi.spyOn(unit.phylaxRuntime, "delivery").mockReturnValue({
        send,
        status: () => ({
          whatsapp: connectedTransportStatus(baseline),
          telegram: unit.phylaxRuntime.telegram.status(),
        }),
      });
      const test = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/whatsapp/test",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({ operationId: "test-alpha" }),
        },
      );
      expect(test.status).toBe(200);
      expect(send).toHaveBeenCalledWith(
        "whatsapp",
        "34611111111",
        "Zenod WhatsApp test: this sender is connected to your memory.",
      );
      const testBody = await test.json();
      expect(testBody).toMatchObject({
        mutation: { operation: "whatsapp.test", outcome: "succeeded" },
        channels: { whatsapp: { state: "verified" } },
      });
      expect(JSON.stringify(testBody)).not.toContain("provider-id-hidden");

      const disconnected = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/whatsapp/disconnect",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({ operationId: "disconnect-alpha" }),
        },
      );
      expect(disconnected.status).toBe(200);
      expect(await disconnected.json()).toMatchObject({
        channels: { whatsapp: { state: "off", senderHint: null } },
        mutation: { operation: "whatsapp.disconnect", outcome: "succeeded" },
      });
      expect(sharedDisconnect).not.toHaveBeenCalled();
      expect(unit.phylaxTenantSettings.view("tenant-alpha")).toMatchObject({
        phoneNumber: null,
        verified: false,
        downstreamTokenConfigured: true,
        turnBindings: { text: { tool: "chat_with_zenod" } },
      });

      expect(unit.hostedChannelAudit.recent("tenant-alpha")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationId: "challenge-alpha",
            outcome: "succeeded",
          }),
          expect.objectContaining({
            operationId: "test-alpha",
            outcome: "succeeded",
          }),
          expect.objectContaining({
            operationId: "disconnect-alpha",
            outcome: "succeeded",
          }),
        ]),
      );
      expect(unit.hostedChannelAudit.recent("tenant-beta")).toEqual([
        expect.objectContaining({
          operationId: "challenge-beta-collision",
          outcome: "rejected",
          errorCode: "sender_in_use",
        }),
      ]);
    } finally {
      await unit.close();
    }
  });

  it("proxies only the authenticated customer's tenant and maps transport failures to Zenod-safe copy", async () => {
    const app = new Hono();
    mountHostedChannelsCustomerRoutes(app, {
      env: {
        CUSTOMER_APP_URL: "https://cloud.zenod.dev",
        ZENOD_CHANNELS_URL: "http://private-channels:8080",
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      },
      resolveTenant(c) {
        const tenant = c.req.header("x-test-tenant");
        return tenant === "alpha" || tenant === "beta"
          ? {
              tenantId: `tenant-${tenant}`,
              downstreamToken: `${tenant}-memory-token`,
            }
          : null;
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        const path = String(url);
        const tenantId = path.includes("tenant-alpha")
          ? "tenant-alpha"
          : "tenant-beta";
        return Response.json({
          whatsapp: {
            state: "off",
            senderHint: null,
            sharedNumber: "+34 699 000 111",
            verificationExpiresAt: null,
            lastInboundAt: null,
            lastReceiptAt: null,
          },
          telegram: { state: "off", identityHint: null },
          tenantForTest: tenantId,
          requestBodyForTest: init?.body ? JSON.parse(String(init.body)) : null,
        });
      });
    vi.stubGlobal("fetch", fetchImpl);

    expect((await app.request("/api/channels")).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();

    const alpha = await app.request("/api/channels/whatsapp/challenge", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-tenant": "alpha" },
      body: JSON.stringify({ sender: "+34 611 111 111" }),
    });
    expect(alpha.status).toBe(200);
    expect(await alpha.json()).toMatchObject({
      tenantForTest: "tenant-alpha",
      requestBodyForTest: {
        sender: "+34 611 111 111",
        downstreamUrl: "https://cloud.zenod.dev/mcp",
        downstreamToken: "alpha-memory-token",
      },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/internal/zenod/channels/tenant-alpha/whatsapp/challenge",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${PRIVATE_TOKEN}`,
    });

    await app.request("/api/channels", {
      headers: { "x-test-tenant": "beta" },
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "/internal/zenod/channels/tenant-beta",
    );

    fetchImpl.mockRejectedValueOnce(
      new Error("socket leaked internal-host:8080"),
    );
    const unavailable = await app.request("/api/channels", {
      headers: { "x-test-tenant": "alpha" },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: {
        code: "channels_unavailable",
        message: "WhatsApp is temporarily unavailable. Try again shortly.",
      },
    });
  });
});
