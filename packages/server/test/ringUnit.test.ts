import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type Stripe from "stripe";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_AGENT, RING_AGENT } from "../src/agent.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createRingUnit } from "../src/ringUnit.js";
import { resolveServerMode } from "../src/serverMode.js";

const dirs: string[] = [];
const MASTER_KEY = "22".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Ring council unit", () => {
  it("ports the Console persona and selects Ring mode explicitly", () => {
    expect(RING_AGENT.persona).toBe(CONSOLE_AGENT.persona);
    expect(resolveServerMode({ ZENOD_UNIT: "ring" }, RING_AGENT.name)).toBe("ring");
  });

  it("keeps Council keys, settings and overview tenant-scoped", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ring-unit-"));
    dirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "alpha-token", tenant: { id: "tenant-alpha", name: "Alpha" } },
      { token: "beta-token", tenant: { id: "tenant-beta", name: "Beta" } },
    ]);
    const unit = createRingUnit({
      dataDir,
      tenantStore: tenants,
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    try {
      const save = await unit.app.request("/api/settings", {
        method: "PUT",
        headers: {
          authorization: "Bearer alpha-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: "openrouter", openrouter_api_key: "sk-or-alpha" }),
      });
      expect(save.status).toBe(200);

      const alpha = await unit.app.request("/api/settings?tenantId=tenant-beta", {
        headers: { authorization: "Bearer alpha-token" },
      });
      const beta = await unit.app.request("/api/settings", {
        headers: { authorization: "Bearer beta-token" },
      });
      expect(await alpha.json()).toMatchObject({
        settings: { provider: "openrouter", openrouter_api_key: expect.stringContaining("•") },
      });
      expect(JSON.stringify(await beta.json())).not.toContain("sk-or-alpha");

      const overview = await unit.app.request("/api/overview", {
        headers: { authorization: "Bearer alpha-token" },
      });
      expect(await overview.json()).toMatchObject({
        tenant: { id: "tenant-alpha" },
        unit: { name: "ring" },
        panels: ["chat", "keys", "connections", "costs", "mcp"],
      });

      const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
        const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
      });
      const address = server.address() as AddressInfo;
      const initialize = await fetch(`http://127.0.0.1:${address.port}/mcp/alpha-token`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "ring-test", version: "1" },
          },
        }),
      });
      expect(initialize.status).toBe(200);
      expect(await initialize.json()).toMatchObject({
        result: { serverInfo: { name: "ring" } },
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      unit.close();
    }
  });

  it("uses the Ring namespace, checkout metadata, domain and default OAuth callback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ring-customer-"));
    dirs.push(dataDir);
    let created: Stripe.Checkout.SessionCreateParams | null = null;
    const checkoutSession = {
      id: "cs_ring",
      object: "checkout.session",
      client_reference_id: "github-42",
      metadata: { product: "ring", unit: "ring" },
      mode: "subscription",
      payment_status: "unpaid",
      status: "open",
      url: "https://checkout.stripe.test/ring",
    } as Stripe.Checkout.Session;
    const stripe: CustomerStripeClient = {
      checkout: {
        sessions: {
          create: vi.fn(async (params) => {
            created = params;
            return checkoutSession;
          }),
          retrieve: vi.fn(async () => checkoutSession),
        },
      },
      webhooks: { constructEvent: vi.fn() },
    };
    const env = {
      NODE_ENV: "test",
      ACCOUNT_STATE_SECRET: "ring-state-secret",
      GITHUB_OAUTH_CLIENT_ID: "ring-client",
      GITHUB_OAUTH_CLIENT_SECRET: "ring-client-secret",
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
      PRICE_MONTHLY: "price_ring_monthly",
    };
    const tenants = createMemoryTenantStore();
    const unit = createRingUnit({
      dataDir,
      tenantStore: tenants,
      env,
      customer: {
        stripe,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "ring-owner", email: null }),
        },
      },
    });
    try {
      expect(unit.customerAccounts.path).toBe(join(dataDir, "customer-accounts-ring.json"));
      const signIn = await unit.app.request("/auth/signin", {
        headers: { host: "ring.zenod.dev" },
      });
      const state = new URL(signIn.headers.get("location")!).searchParams.get("state")!;
      const callback = await unit.app.request(
        `/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`,
      );
      expect(callback.headers.get("location")).toBe("https://ring.zenod.dev/");
      const cookie = callback.headers.get("set-cookie")!.split(";")[0]!;
      const checkout = await unit.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      expect(checkout.status).toBe(200);
      expect(created).toMatchObject({
        client_reference_id: "github-42",
        metadata: { product: "ring", unit: "ring" },
        success_url: "https://ring.zenod.dev/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://ring.zenod.dev/pricing?checkout=cancelled",
      });
    } finally {
      unit.close();
    }

    const callbackUnit = createRingUnit({ dataDir: `${dataDir}-callback`, env });
    dirs.push(`${dataDir}-callback`);
    try {
      const signIn = await callbackUnit.app.request("/auth/signin");
      const location = new URL(signIn.headers.get("location")!);
      expect(location.searchParams.get("redirect_uri")).toBe(
        "https://ring.zenod.dev/auth/github/callback",
      );
    } finally {
      callbackUnit.close();
    }
  });
});
