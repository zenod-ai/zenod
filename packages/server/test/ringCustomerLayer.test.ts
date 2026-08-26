import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { createRingCustomerLayer } from "../src/ringCustomerLayer.js";
import { createCustomerCheckout, type CustomerStripeClient } from "../src/customerBilling.js";
import { signState, type IdentityProvider } from "../src/customerIdentity.js";
import { createMemoryTenantStore, hashToken } from "@zenod/mcp-chassis";

const dirs: string[] = [];
const env = {
  ACCOUNT_STATE_SECRET: "test-state-secret",
  PRICE_MONTHLY: "price_monthly",
  PRICE_YEARLY: "price_yearly",
  STRIPE_MODE: "test",
  ZENOD_ALLOW_TEST_CHECKOUT: "1",
} as NodeJS.ProcessEnv;

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "ring-customer-"));
  dirs.push(dataDir);
  let checkoutInput: Stripe.Checkout.SessionCreateParams | undefined;
  const identity: IdentityProvider = {
    authorizeUrl: () => "https://github.com/login/oauth/authorize",
    exchangeAndGetUser: async () => ({ id: 42, login: "ring-owner" }),
  };
  const stripe = {
    checkout: {
      sessions: {
        create: async (input: Stripe.Checkout.SessionCreateParams) => {
          checkoutInput = input;
          return {
            id: "cs_test",
            url: "https://checkout.stripe.test/cs_test",
            metadata: input.metadata,
            client_reference_id: input.client_reference_id,
          } as Stripe.Checkout.Session;
        },
        retrieve: async () => ({ id: "unused" }) as Stripe.Checkout.Session,
      },
    },
    webhooks: { constructEvent: () => ({}) as Stripe.Event },
  } as CustomerStripeClient;
  const layer = createRingCustomerLayer({ dataDir }, { env, identity, stripe });
  return { dataDir, layer, stripe, checkoutInput: () => checkoutInput };
}

afterEach(() => {
  dirs.length = 0;
});

describe("Ring customer-layer duplicate", () => {
  it("uses GitHub-only identity and has no public token login", async () => {
    const { layer } = fixture();
    const status = await layer.app.request("/api/auth/status");
    expect(await status.json()).toMatchObject({ customerAuth: true, authMethod: "github" });
    expect((await layer.app.request("/api/auth/login", { method: "POST" })).status).toBe(404);
    expect((await layer.app.request("/api/auth/setup", { method: "POST" })).status).toBe(404);
  });

  it("returns GitHub sign-in to the Ring landing", async () => {
    const { layer } = fixture();
    const state = signState({ mode: "signin", rh: "ring.zenod.dev" }, env.ACCOUNT_STATE_SECRET!);
    const response = await layer.app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://ring.zenod.dev/");
  });

  it("binds checkout metadata and account storage to Ring", async () => {
    const { dataDir, layer, stripe, checkoutInput } = fixture();
    const callback = await layer.app.request("/auth/github/callback?code=ok&state=invalid");
    expect(callback.status).toBe(400);

    layer.accounts.upsert("seed", {
      account_id: "github-42",
      github_id: 42,
      github_login: "ring-owner",
    });
    const stored = JSON.parse(readFileSync(join(dataDir, "customer-accounts-ring.json"), "utf8"));
    expect(stored.seed.product).toBe("ring");

    await createCustomerCheckout(
      stripe,
      layer.accounts,
      { domain: "https://ring.zenod.dev", stripeMode: "test", stripeWebhookSecret: "", prices: {} },
      { github_id: 42, login: "ring-owner" },
      { tier: "monthly", price: "price_monthly" },
      { product: "ring", unit: "ring", defaultDomain: "https://ring.zenod.dev" },
    );
    expect(checkoutInput()?.metadata).toMatchObject({ product: "ring", unit: "ring" });
    expect(checkoutInput()?.client_reference_id).toBe("github-42");
    expect(checkoutInput()?.line_items).toEqual([{ price: "price_monthly", quantity: 1 }]);
    expect(checkoutInput()?.success_url).toBe(
      "https://ring.zenod.dev/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("preserves Ring yearly checkout while Zenod moves to one new-customer interval", async () => {
    const { layer, checkoutInput } = fixture();
    const state = signState({ mode: "signin", rh: "ring.zenod.dev" }, env.ACCOUNT_STATE_SECRET!);
    const callback = await layer.app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
    const cookie = callback.headers.get("set-cookie")!;
    const checkout = await layer.app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "yearly" }),
    });
    expect(checkout.status).toBe(200);
    expect(await checkout.json()).toMatchObject({ product: "ring", tier: "yearly" });
    expect(checkoutInput()?.line_items).toEqual([{ price: "price_yearly", quantity: 1 }]);
  });

  it("turns a signed TEST webhook into a local Ring tenant row", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ring-webhook-"));
    dirs.push(dataDir);
    const tenantStore = createMemoryTenantStore();
    const session = {
      id: "cs_test_paid",
      client_reference_id: "github-42",
      metadata: {
        product: "ring",
        unit: "ring",
        tier: "monthly",
        account_id: "github-42",
      },
      subscription: "sub_test",
      customer_details: { email: "owner@example.test" },
      payment_status: "paid",
      status: "complete",
    } as Stripe.Checkout.Session;
    const stripe = {
      checkout: { sessions: { create: async () => session, retrieve: async () => session } },
      webhooks: {
        constructEvent: () => ({
          id: "evt_test",
          livemode: false,
          type: "checkout.session.completed",
          data: { object: session },
        }) as Stripe.Event,
      },
    } as CustomerStripeClient;
    const layer = createRingCustomerLayer(
      { dataDir },
      { env: { ...env, STRIPE_WEBHOOK_SECRET: "whsec_test" }, stripe, tenantStore },
    );
    layer.accounts.upsert(session.id, {
      account_id: "github-42",
      github_id: 42,
      github_login: "ring-owner",
      tier: "monthly",
      stripe_client_reference_id: "github-42",
      subscription_status: "checkout_pending",
    });

    const response = await layer.app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "signed-test-event" },
      body: "signed payload",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, result: "completed" });
    const account = layer.accounts.get(session.id);
    expect(account).toMatchObject({
      tenant_id: "github-42",
      tenant_slug: "ring-owner-42",
      subscription_status: "active",
    });
    const token = layer.tokenVault.get("github-42");
    expect(token).toBeTruthy();
    expect(await tenantStore.resolveTokenHash(hashToken(token!))).toMatchObject({
      tenant: { id: "github-42" },
      status: "active",
    });
  });
});
