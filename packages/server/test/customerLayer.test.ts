import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteTenantStore, hashToken } from "@zenod/mcp-chassis";
import { customerAccountId } from "../src/customerAccounts.js";
import { loadCustomerBillingConfig, type CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerMetering } from "../src/customerMetering.js";
import type { ManagedAiProviderClient } from "../src/customerManagedAi.js";
import { Runtime } from "../src/runtime.js";

const DESTINATION = "https://cloud.zenod.dev";
const CALLBACK = `${DESTINATION}/auth/github/callback`;

function checkoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_customer",
    object: "checkout.session",
    client_reference_id: customerAccountId(42),
    customer_details: { email: "customer@example.com" } as Stripe.Checkout.Session.CustomerDetails,
    customer_email: null,
    livemode: false,
    metadata: { product: "zenod", unit: "zenod", tier: "monthly", account_id: customerAccountId(42) },
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    subscription: "sub_test_customer",
    customer: "cus_test_customer",
    url: "https://checkout.stripe.test/session",
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe("hosted customer layer", () => {
  let dir: string;
  let runtime: Runtime;
  let tenants: ReturnType<typeof createSqliteTenantStore>;
  let createdParams: Stripe.Checkout.SessionCreateParams | null;
  let completed: string[];
  let session: Stripe.Checkout.Session;
  let stripe: CustomerStripeClient;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-customer-"));
    runtime = new Runtime(dir);
    tenants = createSqliteTenantStore({ dataDir: dir });
    createdParams = null;
    completed = [];
    session = checkoutSession();
    stripe = {
      checkout: {
        sessions: {
          create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
            createdParams = params;
            return session;
          }),
          retrieve: vi.fn(async () => session),
        },
      },
      billingPortal: {
        sessions: {
          create: vi.fn(async () => ({
            id: "bps_test_customer",
            object: "billing_portal.session",
            configuration: "bpc_test",
            created: 1,
            customer: "cus_test_customer",
            livemode: false,
            locale: null,
            on_behalf_of: null,
            return_url: `${DESTINATION}/app/account`,
            url: "https://billing.stripe.test/session",
          }) as Stripe.BillingPortal.Session),
        },
      },
      webhooks: {
        constructEvent: vi.fn(
          () =>
            ({
              id: "evt_test_customer",
              object: "event",
              type: "checkout.session.completed",
              livemode: false,
              data: { object: session },
            }) as Stripe.Event,
        ),
      },
    };
    env = {
      NODE_ENV: "test",
      GITHUB_OAUTH_CLIENT_ID: "public-client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "test-only-secret",
      GITHUB_OAUTH_CALLBACK_URL: CALLBACK,
      CUSTOMER_APP_URL: DESTINATION,
      ZC_COOKIE_DOMAIN: ".zenod.dev",
      ACCOUNT_STATE_SECRET: "test-state-secret",
      STRIPE_SECRET_KEY: "sk_test_not-used",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_MODE: "test",
      ZENOD_ALLOW_TEST_CHECKOUT: "1",
      PRICE_MONTHLY: "price_monthly",
      PRICE_YEARLY: "price_yearly",
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    tenants.close();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  function customerApp(identityUser = { id: 42, login: "octocat", email: "customer@example.com" }) {
    return createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => identityUser,
        },
        onCheckoutCompleted: (account) => {
          completed.push(account.session_id);
        },
      },
    ).app;
  }

  function locallyBoundCustomerApp() {
    return createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
      },
    ).app;
  }

  async function signInCookie(
    app: ReturnType<typeof customerApp>,
    returnHost = "cloud.zenod.dev",
    expectedDestination = `${DESTINATION}/app`,
  ): Promise<string> {
    const start = await app.request("/auth/signin", { headers: { "x-forwarded-host": returnHost } });
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    expect(state).toBeTruthy();
    const callback = await app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(expectedDestination);
    const cookie = callback.headers.get("set-cookie");
    expect(cookie).toContain("zenod_customer_session=");
    expect(cookie).toContain("Domain=.zenod.dev");
    return cookie!;
  }

  it("keeps the registered callback independent from the customer destination", async () => {
    const app = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      { env, stripe, tenantStore: tenants },
    ).app;
    const response = await app.request("/auth/signin");
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("public-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(CALLBACK);
  });

  it("issues a GitHub customer session and removes hosted password/Google entry routes", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    const me = await app.request("/api/me", { headers: { cookie } });
    expect(await me.json()).toEqual({ login: "octocat", avatar_url: "https://github.com/octocat.png" });
    expect((await app.request("/api/auth/login", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/auth/setup", { method: "POST" })).status).toBe(404);
    expect((await app.request("/auth/google")).status).toBe(404);
    expect((await app.request("/claim?session_id=cs_old")).status).toBe(404);
    expect((await app.request("/auth/github?session_id=cs_old")).status).toBe(404);
  });

  it("logs the hosted dashboard out through its API route", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(200);
    const clearedCookie = logout.headers.get("set-cookie")!;
    expect(clearedCookie).toContain("zenod_customer_session=");
    expect(clearedCookie).toContain("Max-Age=0");
    const me = await app.request("/api/me", {
      headers: { cookie: clearedCookie.split(";")[0]! },
    });
    expect(me.status).toBe(401);
  });

  it("supports a navigation-safe customer signout", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    const logout = await app.request("/auth/signout", { headers: { cookie } });
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("returns apex sign-in to the landing and direct cloud sign-in to the app", async () => {
    const app = customerApp();
    await signInCookie(app, "zenod.dev", "https://zenod.dev/");
    await signInCookie(app, "cloud.zenod.dev", "https://cloud.zenod.dev/app");
  });

  it("binds checkout to the stable account id", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    const checkout = await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    expect(checkout.status).toBe(200);
    expect(await checkout.json()).toMatchObject({ id: session.id, tier: "monthly", product: "zenod" });
    expect(createdParams).toMatchObject({
      mode: "subscription",
      client_reference_id: customerAccountId(42),
      line_items: [{ price: "price_monthly", quantity: 1 }],
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      consent_collection: { terms_of_service: "required" },
      success_url: `${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    });

    const pendingAccount = await app.request("/api/console/account", { headers: { cookie } });
    expect(pendingAccount.status).toBe(404);
    expect(await pendingAccount.json()).toEqual({ error: "no_account" });

  });

  it("uses only the deployed PRICE_MONTHLY and PRICE_YEARLY env names", () => {
    const config = loadCustomerBillingConfig({
      PRICE_MONTHLY: "price_1TrjPC76yJ3p1J6XqXl1QwN8",
      PRICE_YEARLY: "price_1TrjPD76yJ3p1J6XZGkcIQ56",
      PRICE_STARTER: "legacy_monthly",
      PRICE_PRO: "legacy_yearly",
    });
    expect(config.prices).toEqual({
      monthly: "price_1TrjPC76yJ3p1J6XqXl1QwN8",
      yearly: "price_1TrjPD76yJ3p1J6XZGkcIQ56",
    });
  });

  it("inserts and binds one active local tenant row across webhook retries", async () => {
    const app = locallyBoundCustomerApp();
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });

    const first = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await first.json()).toEqual({ received: true, result: "completed" });
    const second = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await second.json()).toEqual({ received: true, result: "duplicate" });

    const accountResponse = await app.request("/api/console/account", { headers: { cookie } });
    expect(accountResponse.status).toBe(200);
    const account = await accountResponse.json();
    expect(account).toMatchObject({
      account_id: customerAccountId(42),
      tier: "monthly",
      subscription_status: "active",
      tenant_id: customerAccountId(42),
      slug: "octocat-42",
      usage: { percentageUsed: null, state: "unavailable", resetsAt: null },
    });
    expect(account).not.toHaveProperty("balance");
    expect(account).not.toHaveProperty("ledger");
    expect(account.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(account.mcp_url).toBe(`${DESTINATION}/mcp/${account.token}`);
    const accountJson = await readFile(join(dir, "customer-accounts.json"), "utf8");
    const tokenVaultJson = await readFile(join(dir, "customer-token-bindings.json"), "utf8");
    expect(accountJson).not.toContain(account.token);
    expect(tokenVaultJson).not.toContain(account.token);

    const tenants = createSqliteTenantStore({ dataDir: dir });
    expect(tenants.snapshot()).toEqual([
      expect.objectContaining({
        tokenHash: hashToken(account.token),
        tenant: { id: customerAccountId(42), name: "octocat", plan: "monthly" },
        status: "active",
      }),
    ]);
    tenants.close();
  });

  it("opens the Stripe customer portal for the signed-in billing owner", async () => {
    const app = locallyBoundCustomerApp();
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });

    const portal = await app.request("/api/billing/portal", { method: "POST", headers: { cookie } });
    expect(portal.status).toBe(200);
    expect(await portal.json()).toEqual({ url: "https://billing.stripe.test/session" });
    expect(stripe.billingPortal?.sessions.create).toHaveBeenCalledWith({
      customer: "cus_test_customer",
      return_url: `${DESTINATION}/app/account`,
    });

    const duplicate = await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "an active subscription already exists" });
  });

  it("provisions one managed child key after tenant binding and projects customer-safe usage", async () => {
    env.ZENOD_MANAGED_AI_ENABLED = "1";
    env.ZENOD_MANAGED_AI_LIMIT_USD = "2";
    env.OPENROUTER_PROVISIONING_KEY = "provisioning-test";
    const keys: Awaited<ReturnType<ManagedAiProviderClient["listKeys"]>> = [];
    const provider: ManagedAiProviderClient = {
      listKeys: vi.fn(async () => keys.map((key) => ({ ...key }))),
      createKey: vi.fn(async (input) => {
        keys.push({
          name: input.name,
          slug: "octocat-42",
          hash: "managed-hash",
          limit: input.limit,
          usage: 0.33,
          limit_remaining: 1.67,
          disabled: false,
          limit_reset: input.limitReset,
          include_byok_in_limit: input.includeByokInLimit,
          reset_at: "2026-09-01T00:00:00.000Z",
        });
        return {
          key: "sk-or-managed-test",
          hash: "managed-hash",
          name: input.name,
          limit: input.limit,
          limitReset: input.limitReset,
        };
      }),
      updateKey: vi.fn(async () => undefined),
    };
    const app = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        managedAiProvider: provider,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
      },
    ).app;
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });

    const first = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    const duplicate = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await first.json()).toEqual({ received: true, result: "completed" });
    expect(await duplicate.json()).toEqual({ received: true, result: "duplicate" });
    expect(provider.createKey).toHaveBeenCalledTimes(1);
    expect(provider.createKey).toHaveBeenCalledWith({
      name: "zenod-tenant:octocat-42",
      limit: 2,
      limitReset: "monthly",
      includeByokInLimit: true,
    });
    expect(runtime.settings.get("openrouter_api_key")).toBe("sk-or-managed-test");

    const usage = await app.request("/api/customer-usage", { headers: { cookie } });
    expect(await usage.json()).toEqual({
      percentageUsed: 17,
      state: "normal",
      resetsAt: "2026-09-01T00:00:00.000Z",
    });
    const accountResponse = await app.request("/api/console/account", { headers: { cookie } });
    const accountPayload = await accountResponse.json();
    expect(accountPayload.usage).toEqual({
      percentageUsed: 17,
      state: "normal",
      resetsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(accountPayload).not.toHaveProperty("balance");
    expect(accountPayload).not.toHaveProperty("ledger");
  });

  it("tracks recurring billing state and suspends only terminal subscriptions", async () => {
    const app = locallyBoundCustomerApp();
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });

    const subscription = (status: Stripe.Subscription.Status, cancelAtPeriodEnd = false) => ({
      id: "sub_test_customer",
      object: "subscription",
      customer: "cus_test_customer",
      status,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: 1_800_000_000,
    }) as Stripe.Subscription;

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscription("past_due", true) },
    } as Stripe.Event);
    const pastDue = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(await pastDue.json()).toEqual({ received: true, result: "past_due" });
    expect(tenants.snapshot().find((row) => row.tenant.id === customerAccountId(42))?.status).toBe("active");

    const invoice = {
      id: "in_test_customer",
      object: "invoice",
      customer: "cus_test_customer",
      subscription: "sub_test_customer",
    } as Stripe.Invoice;
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "invoice.paid",
      livemode: false,
      data: { object: invoice },
    } as Stripe.Event);
    const paid = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(await paid.json()).toEqual({ received: true, result: "active" });

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "customer.subscription.deleted",
      livemode: false,
      data: { object: subscription("canceled") },
    } as Stripe.Event);
    const canceled = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(await canceled.json()).toEqual({ received: true, result: "canceled" });
    expect(tenants.snapshot().find((row) => row.tenant.id === customerAccountId(42))?.status).toBe("suspended");

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "invoice.payment_failed",
      livemode: false,
      data: { object: invoice },
    } as Stripe.Event);
    const terminalInvoice = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(await terminalInvoice.json()).toEqual({ received: true, result: "canceled" });

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscription("active") },
    } as Stripe.Event);
    await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(tenants.snapshot().find((row) => row.tenant.id === customerAccountId(42))?.status).toBe("active");
  });

  it("leaves existing pilot tenant rows untouched", async () => {
    const tenants = createSqliteTenantStore({ dataDir: dir });
    tenants.provisionTenant({
      tenantId: "pilot-tenant",
      name: "Pilot Tenant",
      plan: "pilot",
      token: "pilot-token-must-survive",
    });
    tenants.close();

    const app = locallyBoundCustomerApp();
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    const response = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);

    const reopened = createSqliteTenantStore({ dataDir: dir });
    const snapshot = reopened.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.find((record) => record.tenant.id === "pilot-tenant")).toMatchObject({
      tokenHash: hashToken("pilot-token-must-survive"),
      tenant: { id: "pilot-tenant", name: "Pilot Tenant", plan: "pilot" },
    });
    reopened.close();
  });

  it("rejects invalid signatures and live events in TEST webhook mode", async () => {
    const app = customerApp();
    vi.mocked(stripe.webhooks.constructEvent).mockImplementationOnce(() => {
      throw new Error("invalid signature");
    });
    const invalid = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "invalid" },
      body: "{}",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid Stripe signature" });

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({ livemode: true } as Stripe.Event);
    const wrongMode = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(wrongMode.status).toBe(400);
    expect(await wrongMode.json()).toEqual({ error: "stripe mode mismatch" });
  });

  it("verifies the webhook, records billing once, and invokes only the local tenant adapter", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });

    const first = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await first.json()).toEqual({ received: true, result: "completed" });
    const second = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await second.json()).toEqual({ received: true, result: "duplicate" });
    expect(completed).toEqual([session.id]);

    const accountResponse = await app.request("/api/console/account", { headers: { cookie } });
    expect(accountResponse.status).toBe(200);
    expect(await accountResponse.json()).toMatchObject({
      subscription_status: "active",
      mcp_url: null,
      token: null,
    });

    const persisted = await readFile(join(dir, "customer-accounts.json"), "utf8");
    expect(persisted).not.toMatch(/dokploy|watchdog|claim_url|domain_host|console_password/i);
  });

  it("does not resolve a paid account through a reused GitHub login", async () => {
    const ownerApp = customerApp();
    const ownerCookie = await signInCookie(ownerApp);
    await ownerApp.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    await ownerApp.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });

    const reusedLoginApp = customerApp({ id: 99, login: "octocat", email: "other@example.com" });
    const reusedLoginCookie = await signInCookie(reusedLoginApp);
    const account = await reusedLoginApp.request("/api/console/account", {
      headers: { cookie: reusedLoginCookie },
    });
    expect(account.status).toBe(404);
    expect(await account.json()).toEqual({ error: "no_account" });
  });

  it("keeps OpenRouter gateway credit as balance truth and local usage as the ledger", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ name: "zenod-tenant:octocat", limit: 20, usage: 18, disabled: false }],
        }),
        { status: 200 },
      ),
    );
    const metering = await customerMetering(
      {
        since: 0,
        calls: 3,
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 20,
        cacheCreationInputTokens: 10,
        costUsd: 1.25,
        byOperation: [],
        byModel: [],
      },
      "or-provisioning-key",
      "octocat",
    );
    expect(metering).toEqual({
      balance: { limitUsd: 20, usageUsd: 18, remainingUsd: 2, state: "warn" },
      ledger: { calls: 3, tokens: 180, costUsd: 1.25 },
    });
  });
});
