import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { customerAccountId } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { customerMetering } from "../src/customerMetering.js";
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
    url: "https://checkout.stripe.test/session",
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe("hosted customer layer", () => {
  let dir: string;
  let runtime: Runtime;
  let createdParams: Stripe.Checkout.SessionCreateParams | null;
  let completed: string[];
  let session: Stripe.Checkout.Session;
  let stripe: CustomerStripeClient;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-customer-"));
    runtime = new Runtime(dir);
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
      PRICE_MONTHLY: "price_monthly",
      PRICE_YEARLY: "price_yearly",
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  function customerApp() {
    return createApp(runtime, {
      customer: {
        env,
        stripe,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
        onCheckoutCompleted: (account) => {
          completed.push(account.session_id);
        },
      },
    });
  }

  async function signInCookie(
    app: ReturnType<typeof createApp>,
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
    const app = createApp(runtime, { customer: { env, stripe } });
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

  it("returns apex sign-in to the landing and direct cloud sign-in to the app", async () => {
    const app = customerApp();
    await signInCookie(app, "zenod.dev", "https://zenod.dev/");
    await signInCookie(app, "cloud.zenod.dev", "https://cloud.zenod.dev/app");
  });

  it("binds checkout to the stable account id and leaves repo-picker routes unchanged", async () => {
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
      success_url: `${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    });

    const picker = await app.request("/api/github/app/start", {
      headers: { cookie, host: "cloud.zenod.dev" },
    });
    expect(picker.status).toBe(200);
    const pickerBody = await picker.json();
    expect(pickerBody.manifest.redirect_url).toBe("http://cloud.zenod.dev/api/github/app/callback");
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
    expect(await accountResponse.json()).toMatchObject({
      account_id: customerAccountId(42),
      tier: "monthly",
      subscription_status: "active",
      balance: null,
      ledger: { calls: 0, tokens: 0, costUsd: 0 },
    });

    const persisted = await readFile(join(dir, "customer-accounts.json"), "utf8");
    expect(persisted).not.toMatch(/dokploy|watchdog|claim_url|domain_host|console_password/i);
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
