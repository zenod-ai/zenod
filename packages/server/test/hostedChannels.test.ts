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
import {
  createPhylaxUnit,
  ZENOD_TELEGRAM_VERIFICATION_REPLY,
  ZENOD_WHATSAPP_VERIFICATION_REPLY,
} from "../src/phylaxUnit.js";
import type { TelegramPortedInboundHandler } from "../src/telegramGateway.js";
import type { WhatsAppPortedInboundHandler } from "../src/whatsappGateway.js";

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
  it("projects the integrated backend transport at the Zenod browser boundary", async () => {
    const app = new Hono();
    const transport = {
      request: vi.fn(async (_tenant, action) => ({
        status: 200,
        body: action
          ? {
              channels: {
                whatsapp: {
                  state: "awaiting_code",
                  senderHint: "••••1111",
                  sharedNumber: "+34 699 000 111",
                  verificationExpiresAt: 1_800_000_000_000,
                  lastInboundAt: null,
                  lastReceiptAt: null,
                  revision: "wa:1",
                },
                telegram: {
                  state: "off",
                  identityHint: null,
                  verificationExpiresAt: null,
                  revision: "tg:0",
                },
              },
              challenge: {
                code: "42-otter",
                sharedNumber: "+34 699 000 111",
                expiresAt: 1_800_000_000_000,
              },
              mutation: {
                operationId: action.operationId,
                operation: action.operation,
                outcome: "succeeded",
                at: 1_790_000_000_000,
              },
              evidence: [{ secret: "must-not-reach-browser" }],
              binding: { downstreamToken: "must-not-reach-browser" },
            }
          : {},
      })),
    };
    mountHostedChannelsCustomerRoutes(app, {
      env: {},
      transport,
      resolveTenant: () => ({
        tenantId: "tenant-alpha",
        downstreamToken: "memory-secret",
      }),
    });
    const response = await app.request("/api/channels/whatsapp/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationId: "integrated-challenge-0001",
        sender: "+34 611 111 111",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["challenge", "channels", "mutation"]);
    expect(JSON.stringify(body)).not.toMatch(/must-not-reach-browser|downstreamToken|evidence|binding/);
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-alpha" }),
      expect.objectContaining({
        operation: "whatsapp.challenge",
        operationId: "integrated-challenge-0001",
      }),
    );
  });

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
      const telegramConnectBody = await telegramConnect.json();
      expect(telegramConnectBody).toMatchObject({
        channels: {
          telegram: { state: "awaiting_code", identityHint: "@jordi_test" },
        },
        challenge: { code: expect.stringMatching(/^\d{2}-[a-z]+$/) },
        mutation: { operation: "telegram.connect", outcome: "succeeded" },
      });
      expect(
        unit.phylaxTenantSettings.resolve("telegram", "@jordi_test"),
      ).toBeNull();
      expect(
        unit.phylaxTenantSettings.verifyTelegramInbound(
          "700000001",
          telegramConnectBody.challenge.code,
          "@someone_else",
        ),
      ).toBeNull();
      expect(
        unit.phylaxTenantSettings.verifyTelegramInbound(
          "733333333",
          telegramConnectBody.challenge.code,
          "@jordi_test",
        ),
      ).toMatchObject({
        settings: {
          tenantId: "tenant-alpha",
          telegramBinding: "733333333",
          telegramIdentityHint: "jordi_test",
        },
        replayed: false,
      });
      expect(
        unit.phylaxTenantSettings.resolve("telegram", "@jordi_test"),
      ).toBeNull();
      expect(
        unit.phylaxTenantSettings.resolve("telegram", "733333333"),
      ).toMatchObject({ tenantId: "tenant-alpha" });
      const telegramTest = await unit.app.request(
        "/internal/zenod/channels/tenant-alpha/telegram/test",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({ operationId: "telegram-test-alpha" }),
        },
      );
      expect(telegramTest.status).toBe(200);
      expect(await telegramTest.json()).toMatchObject({
        channels: {
          telegram: {
            state: "degraded",
            identityHint: "@jordi_test",
          },
        },
      });
      expect(send).toHaveBeenLastCalledWith(
        "telegram",
        "733333333",
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
          expect.objectContaining({
            operationId: "telegram-disconnect-alpha",
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
            sharedNumber: "••••0219",
            verificationExpiresAt: null,
            lastInboundAt: null,
            lastReceiptAt: null,
            revision: "wa-revision-1",
          },
          telegram: {
            state: "off",
            identityHint: null,
            verificationExpiresAt: null,
            revision: "tg-revision-1",
          },
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

    const beta = await app.request("/api/channels", {
      headers: { "x-test-tenant": "beta" },
    });
    expect(beta.status).toBe(200);
    expect(await beta.json()).toMatchObject({
      whatsapp: { sharedNumber: "••••0219" },
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
        retryDisposition: "retry_same_operation",
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
        retryDisposition: "retry_new_operation",
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

  it.each([
    [
      "WhatsApp",
      "/api/channels/whatsapp/challenge",
      "/whatsapp/challenge",
      { operationId: "proxy-lost-whatsapp", sender: "+34 611 111 111" },
      "registerPhone",
    ],
    [
      "Telegram",
      "/api/channels/telegram/connect",
      "/telegram/connect",
      { operationId: "proxy-lost-telegram", identity: "@proxy_owner" },
      "registerTelegram",
    ],
  ] as const)(
    "replays the same %s operation after a proxy-lost private response with one side effect",
    async (_label, publicPath, privateSuffix, body, sideEffect) => {
      const dataDir = await mkdtemp(join(tmpdir(), "hosted-proxy-lost-"));
      dirs.push(dataDir);
      const unit = createPhylaxUnit({
        dataDir,
        tenantStore: createMemoryTenantStore(),
        env: {
          CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
          ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
        },
      });
      vi.spyOn(unit.phylaxRuntime.whatsapp, "status").mockReturnValue(
        connectedTransportStatus(unit.phylaxRuntime.whatsapp.status()),
      );
      const effect = vi.spyOn(unit.phylaxTenantSettings, sideEffect);
      const app = new Hono();
      mountHostedChannelsCustomerRoutes(app, {
        env: {
          CUSTOMER_APP_URL: "https://cloud.zenod.dev",
          ZENOD_CHANNELS_URL: "http://private-channels:8080",
          ZENOD_CHANNELS_ALLOWED_ORIGINS: "http://private-channels:8080",
          ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
        },
        resolveTenant: () => ({
          tenantId: "tenant-proxy-lost",
          downstreamToken: "tenant-memory-token",
        }),
      });
      let loseResponse = true;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
          const response = await unit.app.request(String(url), init);
          if (loseResponse && String(url).endsWith(privateSuffix)) {
            loseResponse = false;
            await response.arrayBuffer();
            throw new Error("proxy response was lost after private commit");
          }
          return response;
        }),
      );
      try {
        const request = () =>
          app.request(publicPath, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-test-tenant": "alpha",
            },
            body: JSON.stringify(body),
          });
        const lost = await request();
        expect(lost.status).toBe(503);
        expect(await lost.json()).toMatchObject({
          error: {
            code: "channels_unavailable",
            retryDisposition: "retry_same_operation",
          },
          mutation: { operationId: body.operationId },
        });

        const replay = await request();
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({
          mutation: { operationId: body.operationId, outcome: "succeeded" },
          challenge: { code: expect.stringMatching(/^\d{2}-[a-z]{2,24}$/) },
        });
        expect(effect).toHaveBeenCalledTimes(1);
      } finally {
        await unit.close();
      }
    },
  );

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
          revision: "wa-paused-revision",
        },
        telegram: {
          state: "connected",
          identityHint: "@jordi",
          verificationExpiresAt: null,
          revision: "tg-paused-revision",
        },
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
        revision: "wa-paused-revision",
      },
      telegram: {
        state: "connected",
        identityHint: "@jordi",
        verificationExpiresAt: null,
        revision: "tg-paused-revision",
      },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("rejects stale terminal snapshots across disconnect and reconnect lifecycles", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hosted-channel-lifecycles-"));
    dirs.push(dataDir);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      },
    });
    vi.spyOn(unit.phylaxRuntime.whatsapp, "status").mockReturnValue(
      connectedTransportStatus(unit.phylaxRuntime.whatsapp.status()),
    );
    const challenge = async (operationId: string) => {
      const response = await unit.app.request(
        "/internal/zenod/channels/tenant-life/whatsapp/challenge",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId,
            sender: "+34 644 444 444",
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "memory-token",
          }),
        },
      );
      return { response, body: await response.json() };
    };
    const disconnect = (operationId: string) =>
      unit.app.request(
        "/internal/zenod/channels/tenant-life/whatsapp/disconnect",
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({ operationId }),
        },
      );
    try {
      const firstConnect = await challenge("lifecycle-connect-first");
      expect(firstConnect.response.status).toBe(200);
      unit.phylaxTenantSettings.verifyInbound(
        "34644444444",
        firstConnect.body.challenge.code,
      );

      const lostDisconnect = await disconnect("lifecycle-disconnect-lost");
      expect(lostDisconnect.status).toBe(200);
      const disconnectReplay = await disconnect("lifecycle-disconnect-lost");
      expect(disconnectReplay.status).toBe(200);
      expect(await disconnectReplay.json()).toEqual(
        await lostDisconnect.json(),
      );

      const secondConnect = await challenge("lifecycle-connect-second");
      expect(secondConnect.response.status).toBe(200);
      unit.phylaxTenantSettings.verifyInbound(
        "34644444444",
        secondConnect.body.challenge.code,
      );
      const staleDisconnect = await disconnect("lifecycle-disconnect-lost");
      expect(staleDisconnect.status).toBe(409);
      expect(await staleDisconnect.json()).toMatchObject({
        error: { code: "operation_conflict" },
      });
      expect(unit.phylaxTenantSettings.get("tenant-life").verified).toBe(true);

      expect((await disconnect("lifecycle-disconnect-current")).status).toBe(
        200,
      );
      const lostConnect = await challenge("lifecycle-connect-lost");
      expect(lostConnect.response.status).toBe(200);
      const connectReplay = await challenge("lifecycle-connect-lost");
      expect(connectReplay.response.status).toBe(200);
      expect(connectReplay.body.challenge.code).toBe(
        lostConnect.body.challenge.code,
      );
      expect((await disconnect("lifecycle-cancel-current")).status).toBe(200);
      const currentConnect = await challenge("lifecycle-connect-current");
      expect(currentConnect.response.status).toBe(200);
      const staleConnect = await challenge("lifecycle-connect-lost");
      expect(staleConnect.response.status).toBe(409);
      expect(staleConnect.body).toMatchObject({
        error: { code: "operation_conflict" },
      });
      expect(unit.phylaxTenantSettings.get("tenant-life")).toMatchObject({
        verified: false,
        phoneNumber: "34644444444",
      });
    } finally {
      await unit.close();
    }
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
    const telegramBody = JSON.stringify({
      operationId: "restart-safe-telegram-connect",
      identity: "@jordi_restart",
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
    const initialTelegram = await first.app.request(
      "/internal/zenod/channels/tenant-telegram-restart/telegram/connect",
      { method: "POST", headers: authorization(), body: telegramBody },
    );
    expect(initialTelegram.status).toBe(200);
    const telegramCode = (await initialTelegram.json()).challenge
      .code as string;
    expect(
      first.phylaxTenantSettings.resolve("telegram", "@jordi_restart"),
    ).toBeNull();
    await first.close();

    expect(
      (
        await readFile(join(dataDir, "hosted-channel-mutations.sqlite"))
      ).toString(),
    ).not.toContain(code);
    expect(
      (await readFile(join(dataDir, "phylax-tenant-settings.json"))).toString(),
    ).not.toContain(code);
    expect(
      (
        await readFile(join(dataDir, "hosted-channel-mutations.sqlite"))
      ).toString(),
    ).not.toContain(telegramCode);
    expect(
      (await readFile(join(dataDir, "phylax-tenant-settings.json"))).toString(),
    ).not.toContain(telegramCode);

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
      const telegramReplay = await second.app.request(
        "/internal/zenod/channels/tenant-telegram-restart/telegram/connect",
        { method: "POST", headers: authorization(), body: telegramBody },
      );
      expect(telegramReplay.status).toBe(200);
      expect((await telegramReplay.json()).challenge.code).toBe(telegramCode);
      expect(
        second.phylaxTenantSettings.resolve("telegram", "@jordi_restart"),
      ).toBeNull();
    } finally {
      await second.close();
    }
  });

  it("replays terminal inbound verification after concurrency and restart without Zenod dispatch", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "hosted-verification-replay-"),
    );
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
    const first = create();
    vi.spyOn(first.phylaxRuntime.whatsapp, "status").mockReturnValue(
      connectedTransportStatus(first.phylaxRuntime.whatsapp.status()),
    );
    const whatsappChallenge = await first.app.request(
      "/internal/zenod/channels/tenant-replay/whatsapp/challenge",
      {
        method: "POST",
        headers: authorization(),
        body: JSON.stringify({
          operationId: "whatsapp-verify-replay",
          sender: "+34 633 333 333",
          downstreamUrl: "https://cloud.zenod.dev/mcp",
          downstreamToken: "memory-token",
        }),
      },
    );
    const whatsappCode = (await whatsappChallenge.json()).challenge
      .code as string;
    const telegramChallenge = await first.app.request(
      "/internal/zenod/channels/tenant-replay/telegram/connect",
      {
        method: "POST",
        headers: authorization(),
        body: JSON.stringify({
          operationId: "telegram-verify-replay",
          identity: "@jordi_replay",
          downstreamUrl: "https://cloud.zenod.dev/mcp",
          downstreamToken: "memory-token",
        }),
      },
    );
    const telegramCode = (await telegramChallenge.json()).challenge
      .code as string;
    const receive = vi.spyOn(first.phylaxRuntime.organ, "receive");
    const whatsappHandler = (
      first.phylaxRuntime.whatsapp as unknown as {
        options: { portedInboundHandler: WhatsAppPortedInboundHandler };
      }
    ).options.portedInboundHandler;
    const telegramHandler = (
      first.phylaxRuntime.telegram as unknown as {
        options: { portedInboundHandler: TelegramPortedInboundHandler };
      }
    ).options.portedInboundHandler;
    const whatsappInput = (messageId: string) => ({
      event: {
        messageId,
        chatId: "34633333333@s.whatsapp.net",
        senderId: "34633333333@s.whatsapp.net",
        senderName: "",
        chatName: "",
        isGroup: false,
        timestamp: Date.now(),
        body: whatsappCode,
        hasMedia: false,
        mediaType: null,
        mimeType: null,
        fileName: null,
      },
      text: whatsappCode,
      timing: { lifecycleStartedAt: Date.now(), mediaDownloadMs: null },
      progress: async () => {},
    });
    const telegramInput = (messageId: string) => ({
      sender: "733333333",
      username: "@jordi_replay",
      chatId: "733333333",
      messageId,
      text: telegramCode,
    });
    const [waFirst, waDuplicate, tgFirst, tgDuplicate] = await Promise.all([
      whatsappHandler(whatsappInput("wa-verify-1")),
      whatsappHandler(whatsappInput("wa-verify-2")),
      telegramHandler(telegramInput("tg-verify-1")),
      telegramHandler(telegramInput("tg-verify-2")),
    ]);
    expect([waFirst.replyText, waDuplicate.replyText]).toEqual([
      ZENOD_WHATSAPP_VERIFICATION_REPLY,
      ZENOD_WHATSAPP_VERIFICATION_REPLY,
    ]);
    expect([tgFirst.replyText, tgDuplicate.replyText]).toEqual([
      ZENOD_TELEGRAM_VERIFICATION_REPLY,
      ZENOD_TELEGRAM_VERIFICATION_REPLY,
    ]);
    expect(receive).not.toHaveBeenCalled();
    expect(
      first.hostedChannelAudit
        .recent("tenant-replay")
        .filter((entry) => entry.operation.endsWith(".verify")),
    ).toHaveLength(2);
    await first.close();

    const persisted = await readFile(
      join(dataDir, "phylax-tenant-settings.json"),
      "utf8",
    );
    expect(persisted).not.toContain(whatsappCode);
    expect(persisted).not.toContain(telegramCode);

    const second = create();
    try {
      const receiveAfterRestart = vi.spyOn(
        second.phylaxRuntime.organ,
        "receive",
      );
      const whatsappAfterRestart = (
        second.phylaxRuntime.whatsapp as unknown as {
          options: { portedInboundHandler: WhatsAppPortedInboundHandler };
        }
      ).options.portedInboundHandler;
      const telegramAfterRestart = (
        second.phylaxRuntime.telegram as unknown as {
          options: { portedInboundHandler: TelegramPortedInboundHandler };
        }
      ).options.portedInboundHandler;
      await expect(
        whatsappAfterRestart(whatsappInput("wa-verify-redelivery")),
      ).resolves.toMatchObject({
        replyText: ZENOD_WHATSAPP_VERIFICATION_REPLY,
      });
      await expect(
        telegramAfterRestart(telegramInput("tg-verify-redelivery")),
      ).resolves.toMatchObject({
        replyText: ZENOD_TELEGRAM_VERIFICATION_REPLY,
      });
      expect(receiveAfterRestart).not.toHaveBeenCalled();
      expect(
        second.hostedChannelAudit
          .recent("tenant-replay")
          .filter((entry) => entry.operation.endsWith(".verify")),
      ).toHaveLength(2);
    } finally {
      await second.close();
    }
  });

  it("accepts Hosted Telegram verification and routing only from an identity-matched private DM", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hosted-telegram-dm-only-"));
    dirs.push(dataDir);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        ZENOD_CHANNELS_PRIVATE_TOKEN: PRIVATE_TOKEN,
      },
    });
    unit.phylaxRuntime.settings.setTelegramSettings({
      acceptAll: true,
      allowedUsers: [],
    });
    const connect = async (
      tenantId: string,
      operationId: string,
      identity: string,
    ) => {
      const response = await unit.app.request(
        `/internal/zenod/channels/${tenantId}/telegram/connect`,
        {
          method: "POST",
          headers: authorization(),
          body: JSON.stringify({
            operationId,
            identity,
            downstreamUrl: "https://cloud.zenod.dev/mcp",
            downstreamToken: "memory-token",
          }),
        },
      );
      expect(response.status).toBe(200);
      return (await response.json()).challenge.code as string;
    };
    const usernameCode = await connect(
      "tenant-dm-username",
      "telegram-dm-username",
      "@private_owner",
    );
    const numericCode = await connect(
      "tenant-dm-numeric",
      "telegram-dm-numeric",
      "744444444",
    );
    const gateway = unit.phylaxRuntime.telegram as unknown as {
      handleMessage(message: Record<string, unknown>, updateId: number): Promise<void>;
      sendChatAction(chatId: number, action: string): Promise<void>;
      sendReply(chatId: number, text: string): Promise<void>;
    };
    const sendChatAction = vi
      .spyOn(gateway, "sendChatAction")
      .mockResolvedValue();
    const sendReply = vi.spyOn(gateway, "sendReply").mockResolvedValue();
    const receive = vi
      .spyOn(unit.phylaxRuntime.organ, "receive")
      .mockImplementation(async (input) =>
        ({
          tenantId: "tenant-dm-username",
          sender: input.sender,
          replyText: "stored privately",
          downstream: { structuredContent: null },
          handoff: null,
          artifactSha256: null,
          downstreamDestination: "https://cloud.zenod.dev/mcp",
          downstreamCorrelationId: null,
          downstreamReceipt: null,
          timing: {
            transcriptionQueueWaitMs: null,
            transcriptionRuntimeMs: null,
            downstreamMs: 1,
          },
          evidence: [],
        }) as never,
      );
    const message = (
      text: string,
      fromId: number,
      username: string,
      chatId: number,
      chatType: string,
      messageId: number,
    ) => ({
      message_id: messageId,
      date: 1_700_000_000,
      from: { id: fromId, username },
      chat: { id: chatId, type: chatType },
      text,
    });
    try {
      await gateway.handleMessage(
        message(usernameCode, 733333333, "private_owner", -1001, "supergroup", 1),
        1,
      );
      await gateway.handleMessage(
        message(numericCode, 744444444, "numeric_owner", -1002, "group", 2),
        2,
      );
      expect(
        unit.phylaxTenantSettings.get("tenant-dm-username").telegramBinding,
      ).toBeNull();
      expect(
        unit.phylaxTenantSettings.get("tenant-dm-numeric").telegramBinding,
      ).toBeNull();
      expect(receive).not.toHaveBeenCalled();
      expect(sendReply).not.toHaveBeenCalled();

      await gateway.handleMessage(
        message(usernameCode, 733333333, "private_owner", 733333333, "private", 3),
        3,
      );
      expect(
        unit.phylaxTenantSettings.get("tenant-dm-username").telegramBinding,
      ).toBe("733333333");
      expect(sendReply).toHaveBeenCalledWith(
        733333333,
        ZENOD_TELEGRAM_VERIFICATION_REPLY,
      );
      expect(receive).not.toHaveBeenCalled();

      await gateway.handleMessage(
        message("group task", 733333333, "private_owner", -1001, "channel", 4),
        4,
      );
      await gateway.handleMessage(
        message("mismatch task", 733333333, "private_owner", 799999999, "private", 5),
        5,
      );
      expect(receive).not.toHaveBeenCalled();
      expect(sendReply).toHaveBeenCalledTimes(1);

      await gateway.handleMessage(
        message("private task", 733333333, "renamed_owner", 733333333, "private", 6),
        6,
      );
      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "telegram",
          sender: "733333333",
          chatId: "733333333",
          text: "private task",
        }),
      );
      expect(sendReply).toHaveBeenLastCalledWith(733333333, "stored privately", {
        tenantId: "tenant-dm-username",
        providerMessageId: "6:reply",
      });
      expect(sendChatAction).toHaveBeenCalledWith(733333333, "typing");
    } finally {
      await unit.close();
    }
  });
});
