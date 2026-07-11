import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { createCallisthenesCustomerLayer } from "../src/callisthenesCustomerLayer.js";
import { createCustomerCheckout, type CustomerStripeClient } from "../src/customerBilling.js";
import { signState, type IdentityProvider } from "../src/customerIdentity.js";
import { createMemoryTenantStore, hashToken } from "@zenod/mcp-chassis";

const dirs: string[] = [];
const env = {
  ACCOUNT_STATE_SECRET: "test-state-secret",
  PRICE_MONTHLY: "price_monthly",
  PRICE_YEARLY: "price_yearly",
  STRIPE_MODE: "test",
} as NodeJS.ProcessEnv;

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "calli-customer-"));
  dirs.push(dataDir);
  let checkoutInput: Stripe.Checkout.SessionCreateParams | undefined;
  const identity: IdentityProvider = {
    authorizeUrl: () => "https://github.com/login/oauth/authorize",
    exchangeAndGetUser: async () => ({ id: 42, login: "calli-owner" }),
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
  const layer = createCallisthenesCustomerLayer({ dataDir }, { env, identity, stripe });
  return { dataDir, layer, stripe, checkoutInput: () => checkoutInput };
}

afterEach(() => {
  dirs.length = 0;
});

describe("Callisthenes customer-layer duplicate", () => {
  it("uses GitHub-only identity and has no public token login", async () => {
    const { layer } = fixture();
    const status = await layer.app.request("/api/auth/status");
    expect(await status.json()).toMatchObject({ customerAuth: true, authMethod: "github" });
    expect((await layer.app.request("/api/auth/login", { method: "POST" })).status).toBe(404);
    expect((await layer.app.request("/api/auth/setup", { method: "POST" })).status).toBe(404);
  });

  it("returns GitHub sign-in to the Callisthenes landing", async () => {
    const { layer } = fixture();
    const state = signState({ mode: "signin", rh: "calli.zenod.dev" }, env.ACCOUNT_STATE_SECRET!);
    const response = await layer.app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://calli.zenod.dev/");
  });

  it("binds checkout metadata and account storage to Callisthenes", async () => {
    const { dataDir, layer, stripe, checkoutInput } = fixture();
    const callback = await layer.app.request("/auth/github/callback?code=ok&state=invalid");
    expect(callback.status).toBe(400);

    layer.accounts.upsert("seed", {
      account_id: "github-42",
      github_id: 42,
      github_login: "calli-owner",
    });
    const stored = JSON.parse(readFileSync(join(dataDir, "customer-accounts-callisthenes.json"), "utf8"));
    expect(stored.seed.product).toBe("callisthenes");

    await createCustomerCheckout(
      stripe,
      layer.accounts,
      { domain: "https://calli.zenod.dev", stripeMode: "test", stripeWebhookSecret: "", prices: {} },
      { github_id: 42, login: "calli-owner" },
      { tier: "monthly", price: "price_monthly" },
      { product: "callisthenes", unit: "callisthenes", defaultDomain: "https://calli.zenod.dev" },
    );
    expect(checkoutInput()?.metadata).toMatchObject({ product: "callisthenes", unit: "callisthenes" });
    expect(checkoutInput()?.success_url).toBe(
      "https://calli.zenod.dev/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("turns a signed TEST webhook into a local Callisthenes tenant row", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "calli-webhook-"));
    dirs.push(dataDir);
    const tenantStore = createMemoryTenantStore();
    const session = {
      id: "cs_test_paid",
      client_reference_id: "github-42",
      metadata: {
        product: "callisthenes",
        unit: "callisthenes",
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
    const layer = createCallisthenesCustomerLayer(
      { dataDir },
      { env: { ...env, STRIPE_WEBHOOK_SECRET: "whsec_test" }, stripe, tenantStore },
    );
    layer.accounts.upsert(session.id, {
      account_id: "github-42",
      github_id: 42,
      github_login: "calli-owner",
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
      tenant_slug: "calli-owner-42",
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
