import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostedChannelsConfigured,
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

      const replay = await unit.app.request(
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
      expect(replay.status).toBe(200);
      expect((await replay.json()).challenge.code).toBe(
        challengeBody.challenge.code,
      );

      const invalidPhone = await unit.app.request(
        "/internal/zenod/channels/tenant-beta/whatsapp/challenge",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId: "challenge-invalid-phone",
            sender: "call me maybe",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "beta-memory-token",
          }),
        },
      );
      expect(invalidPhone.status).toBe(400);
      expect(await invalidPhone.json()).toMatchObject({
        error: { code: "invalid_request" },
        mutation: { outcome: "rejected" },
      });

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

      transportStatus.mockReturnValueOnce(baseline);
      const degraded = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha",
        { headers: authorization() },
      );
      expect(await degraded.json()).toMatchObject({
        whatsapp: { state: "degraded", senderHint: "••••1111" },
      });
      const forbiddenRebind = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/whatsapp/challenge",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId: "challenge-alpha-rebind",
            sender: "+34 633 333 333",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "alpha-memory-token",
          }),
        },
      );
      expect(forbiddenRebind.status).toBe(409);
      expect(await forbiddenRebind.json()).toMatchObject({
        error: { code: "already_connected" },
      });
      expect(unit.phylaxTenantSettings.view("tenant-alpha")).toMatchObject({
        phoneNumber: "34611111111",
        verified: true,
      });

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
      const [test, concurrentReplay] = await Promise.all([
        unit.app.request(
          "/internal/zenod/channels/tenant-alpha/whatsapp/test",
          {
            method: "POST",
            headers: authorization(),
            body: JSON.stringify({ operationId: "test-alpha" }),
          },
        ),
        unit.app.request(
          "/internal/zenod/channels/tenant-alpha/whatsapp/test",
          {
            method: "POST",
            headers: authorization(),
            body: JSON.stringify({ operationId: "test-alpha" }),
          },
        ),
      ]);
      expect(test.status).toBe(200);
      expect(concurrentReplay.status).toBe(200);
      expect(send).toHaveBeenCalledWith(
        "whatsapp",
        "34611111111",
        "Zenod WhatsApp test: this sender is connected to your memory.",
      );
      expect(send).toHaveBeenCalledTimes(1);
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

      const telegramConnect = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/telegram/connect",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId: "telegram-connect-alpha",
            identity: "@jordi_test",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "alpha-memory-token",
          }),
        },
      );
      expect(telegramConnect.status).toBe(200);
      expect(await telegramConnect.json()).toMatchObject({
        channels: {
          telegram: { state: "degraded", identityHint: "@jordi_test" },
        },
        mutation: { operation: "telegram.connect", outcome: "succeeded" },
      });
      const telegramTest = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/telegram/test",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({ operationId: "telegram-test-alpha" }),
        },
      );
      expect(telegramTest.status).toBe(200);
      expect(send).toHaveBeenLastCalledWith(
        "telegram",
        "jordi_test",
        "Zenod Telegram test: this identity is connected to your memory.",
      );
      const telegramDisconnect = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/telegram/disconnect",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({ operationId: "telegram-disconnect-alpha" }),
        },
      );
      expect(telegramDisconnect.status).toBe(200);
      expect(await telegramDisconnect.json()).toMatchObject({
        channels: { telegram: { state: "off", identityHint: null } },
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
          expect.objectContaining({
            operationId: "telegram-connect-alpha",
            outcome: "succeeded",
          }),
          expect.objectContaining({
            operationId: "telegram-test-alpha",
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
        ZENOD_CHANNELS_ALLOWED_ORIGINS: "http://private-channels:8080",
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
        const channels = {
          whatsapp: {
            state: "off",
            senderHint: null,
            sharedNumber: "+34 699 000 111",
            verificationExpiresAt: null,
            lastInboundAt: null,
            lastReceiptAt: null,
          },
          telegram: { state: "off", identityHint: null },
        } as const;
        if (init?.method === "POST") {
          const request = JSON.parse(String(init.body)) as {
            operationId: string;
          };
          return Response.json({
            channels,
            challenge: {
              code: "42-otter",
              sharedNumber: "+34 699 000 111",
              expiresAt: Date.now() + 60_000,
              privateToken: "must-not-leak",
            },
            mutation: {
              operationId: request.operationId,
              operation: "whatsapp.challenge",
              outcome: "succeeded",
              at: Date.now(),
              privateAudit: "must-not-leak",
            },
            tenantForTest: tenantId,
            requestBodyForTest: request,
          });
        }
        return Response.json({
          ...channels,
          tenantForTest: tenantId,
          downstreamToken: "must-not-leak",
        });
      });
    vi.stubGlobal("fetch", fetchImpl);

    expect((await app.request("/api/channels")).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();

    const alpha = await app.request("/api/channels/whatsapp/challenge", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-tenant": "alpha" },
      body: JSON.stringify({
        operationId: "public-challenge-alpha",
        sender: "+34 611 111 111",
      }),
    });
    expect(alpha.status).toBe(200);
    const alphaBody = await alpha.json();
    expect(alphaBody).toMatchObject({
      channels: { whatsapp: { state: "off" } },
      challenge: { code: "42-otter" },
      mutation: { operationId: "public-challenge-alpha" },
    });
    expect(Object.keys(alphaBody).sort()).toEqual([
      "challenge",
      "channels",
      "mutation",
    ]);
    expect(JSON.stringify(alphaBody)).not.toMatch(
      /must-not-leak|tenantForTest|requestBodyForTest|downstreamToken|privateAudit/i,
    );
    const privateRequest = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    );
    expect(privateRequest).toEqual({
      operationId: "public-challenge-alpha",
      sender: "+34 611 111 111",
      downstreamUrl: "https://cloud.zenod.dev/mcp",
      downstreamToken: "alpha-memory-token",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "/internal/zenod/channels/tenant-alpha/whatsapp/challenge",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${PRIVATE_TOKEN}`,
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("error");

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
        message: "Channels are temporarily unavailable. Try again shortly.",
      },
    });

    fetchImpl.mockResolvedValueOnce(
      Response.json({
        whatsapp: { state: "verified", downstreamToken: "leak" },
        telegram: { state: "connected" },
      }),
    );
    const malformed = await app.request("/api/channels", {
      headers: { "x-test-tenant": "alpha" },
    });
    expect(malformed.status).toBe(503);
    expect(JSON.stringify(await malformed.json())).not.toContain("leak");

    fetchImpl.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "channels_unavailable",
            message: "Bearer private-token at private-channels:8080",
          },
          mutation: {
            operationId: "public-test-hostile",
            operation: "whatsapp.test",
            outcome: "failed",
            at: Date.now(),
          },
          stack: "internal stack",
        },
        { status: 503 },
      ),
    );
    const hostile = await app.request("/api/channels/whatsapp/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-tenant": "alpha",
      },
      body: JSON.stringify({ operationId: "public-test-hostile" }),
    });
    expect(await hostile.json()).toEqual({
      error: {
        code: "channels_unavailable",
        message: "Channels are temporarily unavailable. Try again shortly.",
      },
      mutation: {
        operationId: "public-test-hostile",
        operation: "whatsapp.test",
        outcome: "failed",
        at: expect.any(Number),
      },
    });
  });

  it("requires an exact private-origin allowlist before the Hosted route can be enabled", () => {
    expect(
      hostedChannelsConfigured({
        ZENOD_CHANNELS_URL: "https://attacker.example",
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      }),
    ).toBe(false);
    expect(
      hostedChannelsConfigured({
        ZENOD_CHANNELS_URL: "https://attacker.example",
        ZENOD_CHANNELS_ALLOWED_ORIGINS: "https://channels.internal",
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      }),
    ).toBe(false);
    expect(
      hostedChannelsConfigured({
        ZENOD_CHANNELS_URL: "https://channels.internal/path",
        ZENOD_CHANNELS_ALLOWED_ORIGINS: "https://channels.internal",
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      }),
    ).toBe(false);
    expect(
      hostedChannelsConfigured({
        ZENOD_CHANNELS_URL: "https://channels.internal",
        ZENOD_CHANNELS_ALLOWED_ORIGINS: "https://channels.internal",
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      }),
    ).toBe(true);
  });

  it("projects a managed usage pause without dropping the verified sender binding", async () => {
    const app = new Hono();
    mountHostedChannelsCustomerRoutes(app, {
      env: {
        ZENOD_CHANNELS_URL: "https://channels.internal",
        ZENOD_CHANNELS_ALLOWED_ORIGINS: "https://channels.internal",
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      },
      resolveTenant: () => ({
        tenantId: "tenant-paused",
        downstreamToken: "memory-token",
        processingPaused: true,
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        whatsapp: {
          state: "verified",
          senderHint: "••••111",
          sharedNumber: "+34 699 000 111",
          verificationExpiresAt: null,
          lastInboundAt: 1_787_000_000_000,
          lastReceiptAt: 1_787_000_001_000,
        },
        telegram: { state: "connected", identityHint: "@jordi" },
        downstreamToken: "must-not-leak",
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const response = await app.request("/api/channels");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      whatsapp: {
        state: "paused",
        senderHint: "••••111",
        sharedNumber: "+34 699 000 111",
        verificationExpiresAt: null,
        lastInboundAt: 1_787_000_000_000,
        lastReceiptAt: 1_787_000_001_000,
      },
      telegram: { state: "connected", identityHint: "@jordi" },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("replays a challenge after restart without persisting its plaintext code", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hosted-channels-replay-"));
    dirs.push(dataDir);
    const create = () =>
      createPhylaxUnit({
        dataDir,
        tenantStore: createMemoryTenantStore(),
        env: {
          CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
          ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
        },
      });
    const body = JSON.stringify({
      operationId: "restart-safe-challenge",
      sender: "+34 622 222 222",
      downstreamUrl: "https://cloud.zenod.dev/mcp",
      downstreamToken: "alpha-memory-token",
    });
    const first = create();
    vi.spyOn(first.phylaxRuntime.whatsapp, "status").mockReturnValue(
      connectedTransportStatus(first.phylaxRuntime.whatsapp.status()),
    );
    const initial = await first.app.request(
      "/internal/zenod/channels/tenant-restart/whatsapp/challenge",
      { method: "POST", headers: authorization(), body },
    );
    const initialBody = await initial.json();
    const code = initialBody.challenge.code as string;
    await first.close();

    expect(
      (
        await readFile(join(dataDir, "hosted-channel-mutations.sqlite"))
      ).toString(),
    ).not.toContain(code);
    expect(
      (await readFile(join(dataDir, "phylax-tenant-settings.json"))).toString(),
    ).not.toContain(code);

    const second = create();
    try {
      vi.spyOn(second.phylaxRuntime.whatsapp, "status").mockReturnValue(
        connectedTransportStatus(second.phylaxRuntime.whatsapp.status()),
      );
      const replay = await second.app.request(
        "/internal/zenod/channels/tenant-restart/whatsapp/challenge",
        { method: "POST", headers: authorization(), body },
      );
      expect(replay.status).toBe(200);
      expect((await replay.json()).challenge.code).toBe(code);
    } finally {
      await second.close();
    }
  });
});
