import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import type Stripe from "stripe";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteTenantStore, hashToken } from "@zenod/mcp-chassis";
import {
  customerAccountId,
  customerAccountIdForUser,
  type CustomerAccount,
} from "../src/customerAccounts.js";
import { loadCustomerBillingConfig, type CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer, customerAuthEnabled } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { customerMetering } from "../src/customerMetering.js";
import { Runtime } from "../src/runtime.js";
import { mountTesterApplications } from "../src/testerApplications.js";
import { stripeMinter, TesterFlow, type TesterMail } from "../src/testerFlow.js";
import { WelcomeMailer } from "../src/welcomeMail.js";
import { signedOfferUrl } from "../src/endOfTestOffer.js";
import type { HttpBindings } from "@hono/node-server";

const DESTINATION = "https://cloud.zenod.dev";
const CALLBACK = `${DESTINATION}/auth/github/callback`;
const GITHUB_USER_ID = customerUserId("github", "42");
const NEW_GITHUB_ACCOUNT_ID = customerAccountIdForUser({ user_id: GITHUB_USER_ID });

function checkoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_customer",
    object: "checkout.session",
    client_reference_id: NEW_GITHUB_ACCOUNT_ID,
    customer_details: { email: "customer@example.com" } as Stripe.Checkout.Session.CustomerDetails,
    customer_email: null,
    livemode: false,
    metadata: { product: "zenod", unit: "zenod", tier: "monthly", account_id: NEW_GITHUB_ACCOUNT_ID },
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
  let authoritativeSubscription: Stripe.Subscription;
  let stripe: CustomerStripeClient;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-customer-"));
    runtime = new Runtime(dir);
    tenants = createSqliteTenantStore({ dataDir: dir });
    createdParams = null;
    completed = [];
    session = checkoutSession();
    authoritativeSubscription = {
      id: "sub_test_customer",
      object: "subscription",
      customer: "cus_test_customer",
      status: "active",
      cancel_at_period_end: false,
      current_period_start: 1_797_321_600,
      current_period_end: 1_800_000_000,
      metadata: { account_id: NEW_GITHUB_ACCOUNT_ID },
    } as Stripe.Subscription;
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
      subscriptions: {
        retrieve: vi.fn(async () => authoritativeSubscription),
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

  function customerApp(identityUser: {
    id: number | string;
    login: string;
    email: string | null;
    email_verified?: boolean;
  } = { id: 42, login: "octocat", email: "customer@example.com" }) {
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
    // A first sign-in carries the sign-up marker for the visits counter (ZAL-A13).
    const location = new URL(callback.headers.get("location")!);
    location.searchParams.delete("signed_up");
    expect(location.toString()).toBe(new URL(expectedDestination).toString());
    const cookie = callback.headers.get("set-cookie");
    expect(cookie).toContain("zenod_customer_session=");
    expect(cookie).toContain("Domain=.zenod.dev");
    return cookie!;
  }

  function cookiePair(setCookie: string, name: string): string {
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`));
    if (!match?.[1]) throw new Error(`missing ${name} cookie`);
    return match[1];
  }

  function startIdentityLink(
    app: ReturnType<typeof customerApp>,
    provider: "github" | "google",
    cookie: string,
    origin = DESTINATION,
    intent = "link_identity",
  ) {
    return app.request(`/api/auth/providers/${provider}/link`, {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });
  }

  async function identityLinkUrl(response: Response): Promise<URL> {
    const body = await response.json() as { url?: string };
    if (!body.url) throw new Error("identity link response has no URL");
    return new URL(body.url);
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

  it("reports Google-only identity configuration ready without requiring GitHub", async () => {
    const googleOnlyEnv = {
      ...env,
      GITHUB_OAUTH_CLIENT_ID: "",
      GITHUB_OAUTH_CLIENT_SECRET: "",
      GOOGLE_OIDC_CLIENT_ID: "google-client-id",
      GOOGLE_OIDC_CLIENT_SECRET: "google-client-secret",
      GOOGLE_OIDC_CALLBACK_URL: `${DESTINATION}/auth/google/callback`,
    };
    expect(customerAuthEnabled(googleOnlyEnv)).toBe(true);
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      { env: googleOnlyEnv, stripe, tenantStore: tenants },
    );
    try {
      const status = await layer.app.request("/api/auth/status");
      expect(await status.json()).toMatchObject({
        configured: true,
        customerAuth: true,
        authMethod: "google",
        signInMethods: ["google"],
      });
      const start = await layer.app.request("/auth/google/start");
      expect(start.status).toBe(302);
      expect(new URL(start.headers.get("location")!).searchParams.get("scope")).toBe("openid email profile");
      expect((await layer.app.request("/auth/signin")).status).toBe(503);
    } finally {
      layer.close();
    }
  });

  it("issues a GitHub customer session and removes hosted password/Google entry routes", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    const me = await app.request("/api/me", { headers: { cookie } });
    expect(await me.json()).toEqual({
      user_id: GITHUB_USER_ID,
      provider: "github",
      providers: ["github"],
      display_name: "octocat",
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
    });
    expect((await app.request("/api/auth/login", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/auth/setup", { method: "POST" })).status).toBe(404);
    expect((await app.request("/auth/google")).status).toBe(404);
    expect((await app.request("/claim?session_id=cs_old")).status).toBe(404);
    expect((await app.request("/auth/github?session_id=cs_old")).status).toBe(404);
  });

  it("signs a new and returning customer in with Google without Drive consent", async () => {
    env.ZENOD_LIVE_CHECKOUT_TESTER_GOOGLE_EMAILS = " ADA@EXAMPLE.TEST ";
    const exchange = vi.fn(async (_code: string, proof?: { nonce?: string; codeVerifier?: string }) => {
      expect(proof?.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(proof?.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
      return {
        id: "google-subject-ada",
        login: "Ada Lovelace",
        email: "ada@example.test",
        email_verified: true,
        avatar_url: "https://example.test/ada.png",
        provider: "google" as const,
      };
    });
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identityProviders: {
          google: {
            authorizeUrl: (state, proof) => {
              const params = new URLSearchParams({
                state,
                scope: "openid email profile",
                nonce: proof?.nonce ?? "",
                code_challenge: proof?.codeChallenge ?? "",
              });
              return `https://accounts.google.test/authorize?${params}`;
            },
            exchangeAndGetUser: exchange,
          },
        },
      },
    );
    try {
      const start = await layer.app.request("/auth/google/start");
      expect(start.status).toBe(302);
      const authorization = new URL(start.headers.get("location")!);
      expect(authorization.searchParams.get("scope")).toBe("openid email profile");
      expect(authorization.searchParams.get("scope")).not.toMatch(/drive/i);
      expect(authorization.searchParams.get("nonce")).toBeTruthy();
      expect(authorization.searchParams.get("code_challenge")).toBeTruthy();
      const visibleState = JSON.parse(Buffer.from(
        authorization.searchParams.get("state")!.split(".")[0]!,
        "base64url",
      ).toString("utf8")) as Record<string, unknown>;
      expect(visibleState).not.toHaveProperty("nonce");
      expect(visibleState).not.toHaveProperty("verifier");
      const flowCookie = cookiePair(start.headers.get("set-cookie")!, "zenod_google_oidc_flow");
      expect(start.headers.get("set-cookie")).toContain("HttpOnly");
      const callback = await layer.app.request(
        `/auth/google/callback?code=ok&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
        { headers: { cookie: flowCookie } },
      );
      expect(callback.status).toBe(302);
      const sessionCookie = cookiePair(callback.headers.get("set-cookie")!, "zenod_customer_session");
      const me = await layer.app.request("/api/me", { headers: { cookie: sessionCookie } });
      expect(await me.json()).toEqual({
        user_id: customerUserId("google", "google-subject-ada"),
        provider: "google",
        providers: ["google"],
        display_name: "Ada Lovelace",
        login: "Ada Lovelace",
        avatar_url: "https://example.test/ada.png",
      });

      const returningStart = await layer.app.request("/auth/google/start");
      const returningUrl = new URL(returningStart.headers.get("location")!);
      const returning = await layer.app.request(
        `/auth/google/callback?code=again&state=${encodeURIComponent(returningUrl.searchParams.get("state")!)}`,
        { headers: { cookie: cookiePair(returningStart.headers.get("set-cookie")!, "zenod_google_oidc_flow") } },
      );
      expect(returning.status).toBe(302);
      expect(layer.identities.snapshot().users).toHaveLength(1);
      expect(exchange).toHaveBeenCalledTimes(2);
    } finally {
      layer.close();
    }
  });

  it("blocks unknown Google acquisition by default while preserving returning Google sign-in", async () => {
    const exchange = vi.fn(async () => ({
      id: "returning-google-subject",
      login: "Returning Customer",
      email: "returning@example.test",
      email_verified: true,
      provider: "google" as const,
    }));
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identityProviders: {
          google: {
            authorizeUrl: (state, proof) =>
              `https://google.test/authorize?state=${encodeURIComponent(state)}&nonce=${proof?.nonce}&challenge=${proof?.codeChallenge}`,
            exchangeAndGetUser: exchange,
          },
        },
      },
    );
    try {
      const blockedStart = await layer.app.request("/auth/google/start");
      const blockedUrl = new URL(blockedStart.headers.get("location")!);
      const blocked = await layer.app.request(
        `/auth/google/callback?code=new&state=${encodeURIComponent(blockedUrl.searchParams.get("state")!)}`,
        { headers: { cookie: cookiePair(blockedStart.headers.get("set-cookie")!, "zenod_google_oidc_flow") } },
      );
      expect(blocked.status).toBe(403);
      expect(await blocked.text()).toMatch(/Existing Google customers can still sign in/);
      expect(layer.identities.snapshot().users).toHaveLength(0);

      layer.identities.resolveOrCreate({
        provider: "google",
        provider_subject: "returning-google-subject",
        display_name: "Returning Customer",
        email: "returning@example.test",
        email_verified: true,
      });
      const returningStart = await layer.app.request("/auth/google/start");
      const returningUrl = new URL(returningStart.headers.get("location")!);
      const returning = await layer.app.request(
        `/auth/google/callback?code=returning&state=${encodeURIComponent(returningUrl.searchParams.get("state")!)}`,
        { headers: { cookie: cookiePair(returningStart.headers.get("set-cookie")!, "zenod_google_oidc_flow") } },
      );
      expect(returning.status).toBe(302);
      expect(layer.identities.snapshot().users).toHaveLength(1);
    } finally {
      layer.close();
    }
  });

  it.each(["github", "google"] as const)(
    "requires same-origin explicit POST intent before starting %s identity linking",
    async (provider) => {
      const app = customerApp();
      const cookie = await signInCookie(app);
      expect((await app.request(`/api/auth/providers/${provider}/link`, { headers: { cookie } })).status).toBe(404);
      const crossSite = await startIdentityLink(app, provider, cookie, "https://evil.example");
      expect(crossSite.status).toBe(403);
      expect(crossSite.headers.get("location")).toBeNull();
      expect(crossSite.headers.get("set-cookie")).toBeNull();
      const missingIntent = await startIdentityLink(app, provider, cookie, DESTINATION, "not_link_identity");
      expect(missingIntent.status).toBe(400);
      expect(missingIntent.headers.get("location")).toBeNull();
    },
  );

  it("links Google only from the authenticated user's proof flow and supports safe unlink", async () => {
    let googleSubject = "google-linked-subject";
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "same@example.test" }),
        },
        identityProviders: {
          google: {
            authorizeUrl: (state, proof) => `https://google.test/authorize?state=${encodeURIComponent(state)}&nonce=${proof?.nonce}&challenge=${proof?.codeChallenge}`,
            exchangeAndGetUser: async () => ({
              id: googleSubject,
              login: "Octo Cat",
              email: "same@example.test",
              email_verified: true,
              provider: "google",
            }),
          },
        },
      },
    );
    try {
      const githubCookie = await signInCookie(layer.app);
      expect((await startIdentityLink(layer.app, "google", "")).status).toBe(401);
      const linkStart = await startIdentityLink(layer.app, "google", githubCookie);
      expect(linkStart.status).toBe(200);
      const linkUrl = await identityLinkUrl(linkStart);
      const flowCookie = cookiePair(linkStart.headers.get("set-cookie")!, "zenod_google_oidc_flow");
      const linked = await layer.app.request(
        `/auth/google/callback?code=proof&state=${encodeURIComponent(linkUrl.searchParams.get("state")!)}`,
        { headers: { cookie: `${cookiePair(githubCookie, "zenod_customer_session")}; ${flowCookie}` } },
      );
      expect(linked.status).toBe(302);
      expect(layer.identities.resolve("google", "google-linked-subject")?.user_id).toBe(GITHUB_USER_ID);
      expect(layer.identities.snapshot().users).toHaveLength(1);

      // A stolen/ambient customer session cannot persist a second Google
      // subject as a backdoor alongside the already linked one.
      googleSubject = "google-attacker-subject";
      const attackerStart = await startIdentityLink(layer.app, "google", githubCookie);
      const attackerUrl = await identityLinkUrl(attackerStart);
      const attacker = await layer.app.request(
        `/auth/google/callback?code=attacker&state=${encodeURIComponent(attackerUrl.searchParams.get("state")!)}`,
        {
          headers: {
            cookie: `${cookiePair(githubCookie, "zenod_customer_session")}; ${cookiePair(attackerStart.headers.get("set-cookie")!, "zenod_google_oidc_flow")}`,
          },
        },
      );
      expect(attacker.status).toBe(409);
      expect(await attacker.text()).toMatch(/different Google identity is already linked/);
      expect(layer.identities.resolve("google", "google-attacker-subject")).toBeNull();

      const unlinked = await layer.app.request("/api/auth/providers/google", {
        method: "DELETE",
        headers: { cookie: githubCookie },
      });
      expect(unlinked.status).toBe(200);
      expect(await unlinked.json()).toEqual({ ok: true, providers: ["github"] });
      expect(layer.identities.resolve("google", "google-linked-subject")).toBeNull();
      expect(layer.identities.resolve("google", "google-attacker-subject")).toBeNull();
      const lastIdentity = await layer.app.request("/api/auth/providers/github", {
        method: "DELETE",
        headers: { cookie: cookiePair(unlinked.headers.get("set-cookie")!, "zenod_customer_session") },
      });
      expect(lastIdentity.status).toBe(409);
      expect(await lastIdentity.json()).toEqual({ error: "cannot unlink the last sign-in identity" });
    } finally {
      layer.close();
    }
  });

  it("rejects a second GitHub subject and leaves none behind after unlink", async () => {
    let githubIdentityId: number | string = 7001;
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identityProviders: {
          github: {
            authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
            exchangeAndGetUser: async () => ({ id: githubIdentityId, login: `github-${githubIdentityId}`, email: null }),
          },
          google: {
            authorizeUrl: (state) => `https://google.test/authorize?state=${encodeURIComponent(state)}`,
            exchangeAndGetUser: async () => ({ id: "google-owner", login: "Google Owner", email: null }),
          },
        },
      },
    );
    const googlePrincipal = layer.identities.resolveOrCreate({
      provider: "google",
      provider_subject: "google-owner",
      display_name: "Google Owner",
    });
    const cookieIssuer = new Hono();
    cookieIssuer.get("/", (c) => {
      issueCustomerSession(c, googlePrincipal, env);
      return c.text("ok");
    });
    const googleCookie = (await cookieIssuer.request("/")).headers.get("set-cookie")!;
    try {
      const firstStart = await startIdentityLink(layer.app, "github", googleCookie);
      const firstState = (await identityLinkUrl(firstStart)).searchParams.get("state")!;
      const first = await layer.app.request(
        `/auth/github/callback?code=first&state=${encodeURIComponent(firstState)}`,
        { headers: { cookie: googleCookie } },
      );
      expect(first.status).toBe(302);
      expect(layer.identities.resolve("github", "7001")?.user_id).toBe(googlePrincipal.user_id);

      githubIdentityId = 7002;
      const attackerStart = await startIdentityLink(layer.app, "github", googleCookie);
      const attackerState = (await identityLinkUrl(attackerStart)).searchParams.get("state")!;
      const attacker = await layer.app.request(
        `/auth/github/callback?code=attacker&state=${encodeURIComponent(attackerState)}`,
        { headers: { cookie: googleCookie } },
      );
      expect(attacker.status).toBe(409);
      expect(await attacker.text()).toMatch(/different GitHub identity is already linked/);
      expect(layer.identities.resolve("github", "7002")).toBeNull();

      const unlinked = await layer.app.request("/api/auth/providers/github", {
        method: "DELETE",
        headers: { cookie: googleCookie },
      });
      expect(unlinked.status).toBe(200);
      expect(await unlinked.json()).toEqual({ ok: true, providers: ["google"] });
      expect(layer.identities.resolve("github", "7001")).toBeNull();
      expect(layer.identities.resolve("github", "7002")).toBeNull();
    } finally {
      layer.close();
    }
  });

  it("refuses to unlink the only configured sign-in provider", async () => {
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
      },
    );
    try {
      const githubCookie = await signInCookie(layer.app);
      layer.identities.linkIdentity(GITHUB_USER_ID, {
        provider: "google",
        provider_subject: "unconfigured-google",
      });
      const rejected = await layer.app.request("/api/auth/providers/github", {
        method: "DELETE",
        headers: { cookie: githubCookie },
      });
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toEqual({ error: "cannot unlink the only configured sign-in identity" });
      expect(layer.identities.resolve("github", "42")?.user_id).toBe(GITHUB_USER_ID);
      expect(layer.identities.resolve("google", "unconfigured-google")?.user_id).toBe(GITHUB_USER_ID);
      expect((await layer.app.request("/api/me", { headers: { cookie: githubCookie } })).status).toBe(200);
    } finally {
      layer.close();
    }
  });

  it.each(["9007199254740992", "9007199254740993"])(
    "rejects unsafe GitHub subject %s before identity persistence",
    async (id) => {
      const layer = createCustomerLayer(
        { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
        {
          env,
          stripe,
          tenantStore: tenants,
          identity: {
            authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
            exchangeAndGetUser: async () => ({ id, login: `unsafe-${id}`, email: null }),
          },
        },
      );
      try {
        const start = await layer.app.request("/auth/signin");
        const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
        const callback = await layer.app.request(
          `/auth/github/callback?code=unsafe&state=${encodeURIComponent(state)}`,
        );
        expect(callback.status).toBe(502);
        expect(layer.identities.snapshot().users).toHaveLength(0);
        expect(layer.identities.snapshot().identities).toHaveLength(0);
      } finally {
        layer.close();
      }
    },
  );

  it("rejects a link when the proved provider subject belongs to another account", async () => {
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
        identityProviders: {
          google: {
            authorizeUrl: (state, proof) => `https://google.test/authorize?state=${encodeURIComponent(state)}&nonce=${proof?.nonce}&challenge=${proof?.codeChallenge}`,
            exchangeAndGetUser: async () => ({ id: "owned-google-subject", login: "Other Person", email: null }),
          },
        },
      },
    );
    try {
      layer.identities.resolveOrCreate({
        provider: "google",
        provider_subject: "owned-google-subject",
        display_name: "Other Person",
      });
      const githubCookie = await signInCookie(layer.app);
      const linkStart = await startIdentityLink(layer.app, "google", githubCookie);
      const linkUrl = await identityLinkUrl(linkStart);
      const linked = await layer.app.request(
        `/auth/google/callback?code=proof&state=${encodeURIComponent(linkUrl.searchParams.get("state")!)}`,
        {
          headers: {
            cookie: `${cookiePair(githubCookie, "zenod_customer_session")}; ${cookiePair(linkStart.headers.get("set-cookie")!, "zenod_google_oidc_flow")}`,
          },
        },
      );
      expect(linked.status).toBe(409);
      expect(await linked.text()).toMatch(/already linked to another Zenod account/);
      expect(layer.identities.snapshot().users).toHaveLength(2);
    } finally {
      layer.close();
    }
  });

  it("fails Google callbacks closed when state, flow proof, or current link session is missing", async () => {
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identityProviders: {
          google: {
            authorizeUrl: (state) => `https://google.test/authorize?state=${encodeURIComponent(state)}`,
            exchangeAndGetUser: vi.fn(async () => ({ id: "never", login: "Never", email: null })),
          },
        },
      },
    );
    try {
      const start = await layer.app.request("/auth/google/start");
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      expect((await layer.app.request(`/auth/google/callback?code=ok&state=${encodeURIComponent(state)}`)).status).toBe(400);
      expect((await layer.app.request("/auth/google/callback?code=ok&state=tampered")).status).toBe(400);
      expect(layer.identities.snapshot().users).toHaveLength(0);
    } finally {
      layer.close();
    }
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

  it("marks only a first sign-in as a completed sign-up for the visits counter (ZAL-A13)", async () => {
    const app = customerApp();
    const signIn = async () => {
      const start = await app.request("/auth/signin", { headers: { "x-forwarded-host": "zenod.dev" } });
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      const callback = await app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
      return callback.headers.get("location");
    };
    expect(await signIn()).toBe("https://zenod.dev/?signed_up=1");
    expect(await signIn()).toBe("https://zenod.dev/");
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
      client_reference_id: NEW_GITHUB_ACCOUNT_ID,
      line_items: [{ price: "price_monthly", quantity: 1 }],
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      consent_collection: { terms_of_service: "required" },
      allow_promotion_codes: true,
      payment_method_collection: "if_required",
      custom_text: { submit: { message: expect.stringMatching(/you will not be charged/) } },
      success_url: `${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    });

    const pendingAccount = await app.request("/api/console/account", { headers: { cookie } });
    expect(pendingAccount.status).toBe(404);
    expect(await pendingAccount.json()).toEqual({ error: "no_account" });

  });

  describe("end-of-test offer (EPIC-26 S13)", () => {
    const freeEnds = 1_800_000_000;
    function testerSub(status: Stripe.Subscription.Status, mark: string | null, cancelAtEnd = true): Stripe.Subscription {
      return {
        ...authoritativeSubscription,
        status,
        cancel_at_period_end: cancelAtEnd,
        current_period_end: freeEnds,
        ended_at: status === "canceled" ? freeEnds : null,
        metadata: {
          account_id: NEW_GITHUB_ACCOUNT_ID,
          zenod_tester: "1",
          ...(mark ? { zenod_tester_month_end: mark } : {}),
        },
      } as Stripe.Subscription;
    }

    async function testerAccount(app: ReturnType<typeof customerApp>) {
      const cookie = await signInCookie(app);
      await app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      const done = await app.request(`/checkout/complete?session_id=${session.id}`, { headers: { cookie } });
      expect(done.status).toBe(303);
      createdParams = null;
      return cookie;
    }

    it("offers a tester whose free month the team did not extend one click into the €9 checkout, charged when it ends", async () => {
      authoritativeSubscription = testerSub("active", "ended_free_time");
      const app = customerApp();
      const cookie = await testerAccount(app);

      const account = await (await app.request("/api/console/account", { headers: { cookie } })).json();
      expect(account.end_of_test_offer).toEqual({
        phase: "before",
        free_ends_at: new Date(freeEnds * 1000).toISOString(),
        pay_url: "/keep-zenod",
      });

      const keep = await app.request("/keep-zenod", { headers: { cookie } });
      expect(keep.status).toBe(303);
      expect(keep.headers.get("location")).toBe(session.url);
      expect(createdParams).toMatchObject({
        mode: "subscription",
        client_reference_id: NEW_GITHUB_ACCOUNT_ID,
        line_items: [{ price: "price_monthly", quantity: 1 }],
        subscription_data: { trial_end: freeEnds },
        payment_method_collection: "always",
        custom_text: { submit: { message: expect.stringMatching(/^Nothing is charged today\./) } },
        cancel_url: `${DESTINATION}/app`,
      });
      expect(createdParams).not.toHaveProperty("allow_promotion_codes");
      expect(createdParams).not.toHaveProperty("discounts");
    });

    it("opens the same checkout from the email's signed link without a sign-in, and refuses an altered one", async () => {
      authoritativeSubscription = testerSub("active", "ended_free_time");
      const app = customerApp();
      await testerAccount(app);
      const link = new URL(signedOfferUrl(DESTINATION, NEW_GITHUB_ACCOUNT_ID, Date.now() + 60_000, "test-state-secret"));

      const keep = await app.request(`${link.pathname}${link.search}`);
      expect(keep.status).toBe(303);
      expect(keep.headers.get("location")).toBe(session.url);
      expect(createdParams).toMatchObject({ client_reference_id: NEW_GITHUB_ACCOUNT_ID, subscription_data: { trial_end: freeEnds } });

      createdParams = null;
      link.searchParams.set("a", "acct_someone_else");
      const altered = await app.request(`${link.pathname}${link.search}`);
      expect(altered.status).toBe(303);
      expect(altered.headers.get("location")).toBe(`${DESTINATION}/app`);
      expect(createdParams).toBeNull();
    });

    it("after the free month ended, the button is the plain €9 checkout for the same account", async () => {
      authoritativeSubscription = testerSub("active", "ended_free_time");
      const app = customerApp();
      const cookie = await testerAccount(app);
      authoritativeSubscription = testerSub("canceled", "ended_free_time");
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "customer.subscription.deleted",
        livemode: false,
        data: { object: authoritativeSubscription },
      } as Stripe.Event);
      await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "valid" }, body: "{}" });

      const account = await (await app.request("/api/console/account", { headers: { cookie } })).json();
      expect(account.end_of_test_offer).toMatchObject({ phase: "after", pay_url: "/keep-zenod" });
      const keep = await app.request("/keep-zenod", { headers: { cookie } });
      expect(keep.status).toBe(303);
      expect(createdParams).toMatchObject({ client_reference_id: NEW_GITHUB_ACCOUNT_ID, payment_method_collection: "if_required" });
      expect(createdParams?.subscription_data).not.toHaveProperty("trial_end");
    });

    it("shows no offer while the team extended the month, or to anyone who is not an ending tester", async () => {
      authoritativeSubscription = testerSub("active", "extended_by_us", false);
      const app = customerApp();
      const cookie = await testerAccount(app);
      const account = await (await app.request("/api/console/account", { headers: { cookie } })).json();
      expect(account.end_of_test_offer).toBeNull();
      const keep = await app.request("/keep-zenod", { headers: { cookie } });
      expect(keep.status).toBe(303);
      expect(keep.headers.get("location")).toBe(`${DESTINATION}/app`);
      expect(createdParams).toBeNull();
    });

    it("keeps the notes running when the old free month ends after the tester already paid", async () => {
      authoritativeSubscription = testerSub("active", "ended_free_time");
      const app = locallyBoundCustomerApp();
      const cookie = await testerAccount(app as ReturnType<typeof customerApp>);
      const tenantStatus = () => tenants.snapshot().find((row) => row.tenant.id === NEW_GITHUB_ACCOUNT_ID)?.status;
      expect(tenantStatus()).toBe("active");

      // The tester pays from the offer: a second checkout for the same account, its own subscription.
      const paid = { ...authoritativeSubscription, id: "sub_paid", status: "trialing", cancel_at_period_end: false,
        metadata: { account_id: NEW_GITHUB_ACCOUNT_ID } } as Stripe.Subscription;
      session = checkoutSession({ id: "cs_test_keep", subscription: "sub_paid" });
      await app.request("/keep-zenod", { headers: { cookie } });
      vi.mocked(stripe.subscriptions.retrieve).mockImplementation(async (id: string) =>
        id === "sub_paid" ? paid : testerSub("canceled", "ended_free_time"));
      const done = await app.request(`/checkout/complete?session_id=cs_test_keep`, { headers: { cookie } });
      expect(done.status).toBe(303);

      // Then the old free month ends: the account stays on.
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "customer.subscription.deleted",
        livemode: false,
        data: { object: testerSub("canceled", "ended_free_time") },
      } as Stripe.Event);
      await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "valid" }, body: "{}" });
      expect(tenantStatus()).toBe("active");
      const account = await (await app.request("/api/console/account", { headers: { cookie } })).json();
      expect(account).toMatchObject({ subscription_status: "active", end_of_test_offer: null });
    });
  });

  describe("tester invite link (EPIC-26 T1)", () => {
    let promoLookups: Stripe.PromotionCodeListParams[];

    beforeEach(() => {
      promoLookups = [];
      stripe.promotionCodes = {
        list: vi.fn(async (params: Stripe.PromotionCodeListParams) => {
          promoLookups.push(params);
          return { data: params.code === "TESTER1" ? [{ id: "promo_tester1" } as Stripe.PromotionCode] : [] };
        }),
      };
    });

    async function inviteSignIn(app: ReturnType<typeof customerApp>, returnTo: string) {
      const start = await app.request(`/auth/github/start?return_to=${encodeURIComponent(returnTo)}`, {
        headers: { "x-forwarded-host": "cloud.zenod.dev" },
      });
      expect(start.status).toBe(302);
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      const nonce = cookiePair(start.headers.get("set-cookie")!, "zenod_mcp_signin");
      const callback = await app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`, {
        headers: { cookie: nonce },
      });
      expect(callback.status).toBe(302);
      return { location: callback.headers.get("location")!, cookie: cookiePair(callback.headers.get("set-cookie")!, "zenod_customer_session") };
    }

    it("shows a signed-out visitor what Zenod is and sign-in that keeps the code", async () => {
      const app = customerApp();
      const page = await app.request("/join?code=TESTER1");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("You're invited to try Zenod.");
      expect(html).toContain("A WhatsApp number for your voice notes.");
      expect(html).toContain(`/auth/github/start?return_to=${encodeURIComponent("/join?code=TESTER1")}`);
      expect(html).toContain("TESTER1");
      expect(promoLookups).toEqual([]);
      expect(createdParams).toBeNull();

      const hostile = await (await app.request(`/join?code=${encodeURIComponent("<script>x</script>")}`)).text();
      expect(hostile).not.toContain("<script>x");
      expect(hostile).toContain("Have a code? You can add it at checkout.");
    });

    it("signs a new tester in and goes straight to checkout with the code applied", async () => {
      const app = customerApp();
      const { location, cookie } = await inviteSignIn(app, "/join?code=TESTER1");
      expect(location).toBe(`${DESTINATION}/join?code=TESTER1&signed_up=1`);

      const join = await app.request("/join?code=TESTER1&signed_up=1", { headers: { cookie } });
      expect(join.status).toBe(303);
      expect(join.headers.get("location")).toBe(session.url);
      expect(promoLookups).toEqual([{ code: "TESTER1", active: true, limit: 1 }]);
      expect(createdParams).toMatchObject({
        mode: "subscription",
        client_reference_id: NEW_GITHUB_ACCOUNT_ID,
        discounts: [{ promotion_code: "promo_tester1" }],
        payment_method_collection: "if_required",
        custom_text: { submit: { message: expect.stringMatching(/already applied/) } },
        success_url: `${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}&welcome=1&signed_up=1`,
      });
      expect(createdParams).not.toHaveProperty("allow_promotion_codes");

      const complete = await app.request(`/checkout/complete?session_id=${session.id}&welcome=1&signed_up=1`, {
        headers: { cookie },
      });
      expect(complete.status).toBe(303);
      expect(complete.headers.get("location")).toBe(`${DESTINATION}/welcome?signed_up=1`);
      const welcome = await app.request("/welcome?signed_up=1", { headers: { cookie } });
      const html = await welcome.text();
      expect(html).toContain("You're in.");
      expect(html).toContain('href="/app#vault"');
      expect(html).toContain('href="/app#settings/channels"');
      expect(html).toContain("signup.alpha9.io");

      const again = await app.request("/join?code=TESTER1", { headers: { cookie } });
      expect(again.status).toBe(303);
      expect(again.headers.get("location")).toBe(`${DESTINATION}/app`);
    });

    it("takes a stranger from the apply form to checkout with a code minted only for them (EPIC-26 S2)", async () => {
      // One fake Stripe for both sides: the code the flow mints is the one checkout finds.
      const minted = new Map<string, string>();
      stripe.promotionCodes = {
        list: vi.fn(async (params: Stripe.PromotionCodeListParams) => {
          promoLookups.push(params);
          const id = params.code ? minted.get(params.code) : undefined;
          return { data: id ? [{ id } as Stripe.PromotionCode] : [] };
        }),
        create: vi.fn(async (params: Stripe.PromotionCodeCreateParams) => {
          const id = `promo_${minted.size + 1}`;
          minted.set(params.code!, id);
          return { id, code: params.code } as Stripe.PromotionCode;
        }),
      };
      const mails: TesterMail[] = [];
      const flow = new TesterFlow({
        dataDir: dir,
        mint: stripeMinter(stripe as Parameters<typeof stripeMinter>[0]),
        sendMail: async (mail) => {
          mails.push(mail);
        },
      });
      const site = new Hono<{ Bindings: HttpBindings }>();
      mountTesterApplications(site, { dataDir: dir, clientAddress: () => "203.0.113.5", flow });

      const applied = await site.request("/api/public/testers/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ use: "Voice notes on my walks, and Claude reading them.", contact: "stranger@example.com" }),
      });
      expect(await applied.json()).toEqual({ ok: true, status: "accepted" });
      await flow.process();
      expect(mails.map((mail) => mail.to)).toEqual(["stranger@example.com"]);
      const link = mails[0]!.text.match(/https:\/\/cloud\.zenod\.dev\/join\?code=(ZT-[A-Z2-9]{8})/);
      expect(link).not.toBeNull();
      const code = link![1]!;
      expect(stripe.promotionCodes.create).toHaveBeenCalledWith(expect.objectContaining({ coupon: "ZENOD_TESTER_1M", code, max_redemptions: 1 }));

      const app = customerApp();
      const page = await (await app.request(`/join?code=${code}`)).text();
      expect(page).toContain(code);
      const { cookie } = await inviteSignIn(app, `/join?code=${code}`);
      const join = await app.request(`/join?code=${code}&signed_up=1`, { headers: { cookie } });
      expect(join.status).toBe(303);
      expect(join.headers.get("location")).toBe(session.url);
      expect(createdParams).toMatchObject({ discounts: [{ promotion_code: minted.get(code) }], payment_method_collection: "if_required" });
    });

    it("keeps the code field open when the code is unknown or Stripe will not apply it", async () => {
      const app = customerApp();
      const { cookie } = await inviteSignIn(app, "/join?code=EXPIRED9");
      const unknown = await app.request("/join?code=EXPIRED9", { headers: { cookie } });
      expect(unknown.status).toBe(303);
      expect(createdParams).toMatchObject({ allow_promotion_codes: true });
      expect(createdParams).not.toHaveProperty("discounts");
      expect(createdParams?.success_url).toBe(`${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}&welcome=1`);

      const create = stripe.checkout.sessions.create as ReturnType<typeof vi.fn>;
      create.mockImplementationOnce(async () => {
        throw new Error("This promotion code cannot be redeemed");
      });
      const refused = await app.request("/join?code=TESTER1", { headers: { cookie } });
      expect(refused.status).toBe(303);
      expect(createdParams).toMatchObject({ allow_promotion_codes: true });
      expect(createdParams).not.toHaveProperty("discounts");
    });

    it("shows a plain page instead of JSON when checkout cannot open, and keeps the normal checkout unchanged", async () => {
      env.ZENOD_ALLOW_TEST_CHECKOUT = "0";
      const app = customerApp();
      const { cookie } = await inviteSignIn(app, "/join?code=TESTER1");
      const closed = await app.request("/join?code=TESTER1", { headers: { cookie } });
      expect(closed.status).toBe(503);
      expect(closed.headers.get("content-type")).toMatch(/^text\/html/);
      expect(await closed.text()).toContain("Nothing was charged.");

      env.ZENOD_ALLOW_TEST_CHECKOUT = "1";
      const buy = await app.request("/buy?tier=monthly", { headers: { cookie } });
      expect(buy.status).toBe(303);
      expect(createdParams).toMatchObject({
        allow_promotion_codes: true,
        success_url: `${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
      });
      expect(promoLookups).toEqual([]);
    });

    it("refuses return paths that are neither a consent request nor an invite", async () => {
      const app = customerApp();
      const start = await app.request(`/auth/github/start?return_to=${encodeURIComponent("https://evil.test/join?code=X")}`);
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      const callback = await app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
      expect(new URL(callback.headers.get("location")!).pathname).toBe("/app");
    });
  });

  it("shows browsers a signup-paused page and keeps JSON for API clients when checkout is closed", async () => {
    env.ZENOD_ALLOW_TEST_CHECKOUT = "0";
    const app = customerApp();
    const cookie = await signInCookie(app);

    const browser = await app.request("/buy?tier=monthly", {
      headers: { cookie, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    expect(browser.status).toBe(503);
    expect(browser.headers.get("content-type")).toMatch(/^text\/html/);
    expect(browser.headers.get("retry-after")).toBe("3600");
    const page = await browser.text();
    expect(page).toContain("Signup is paused for a moment");
    expect(page).toContain("try again");
    expect(page).toContain("mailto:");
    expect(page).not.toMatch(/readiness|backup_restore|paid signup is not open/i);

    const api = await app.request("/buy?tier=monthly", { headers: { cookie, accept: "application/json" } });
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "paid signup is not open" });

    const fetchClient = await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    expect(fetchClient.status).toBe(503);
    expect(await fetchClient.json()).toEqual({ error: "paid signup is not open" });
    expect(createdParams).toBeNull();
  });

  it("rejects retired aliases and yearly for new Zenod checkout before calling Stripe", async () => {
    const app = customerApp();
    const cookie = await signInCookie(app);
    const rejected = new Map([
      ["starter", 'unknown tier "starter" (use monthly)'],
      ["pro", 'unknown tier "pro" (use monthly)'],
      ["yearly", 'tier "yearly" is not available for new checkout'],
    ]);

    for (const [tier, error] of rejected) {
      const checkout = await app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      expect(checkout.status).toBe(400);
      expect(await checkout.json()).toEqual({ error });
      expect(createdParams).toBeNull();
    }

    const unknown = await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "enterprise" }),
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: 'unknown tier "enterprise" (use monthly)' });
    expect(createdParams).toBeNull();
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

  it("reports a fully discounted subscription to the console from Stripe's discount, not from who the user is", async () => {
    (authoritativeSubscription as unknown as Record<string, unknown>).discounts = [
      {
        coupon: { id: "c_free_month", object: "coupon", duration: "repeating", percent_off: 100 },
        end: 1_800_000_000,
      },
    ];
    const app = locallyBoundCustomerApp();
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    const completed = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await completed.json()).toEqual({ received: true, result: "completed" });
    expect(stripe.subscriptions!.retrieve).toHaveBeenCalledWith("sub_test_customer", { expand: ["discounts"] });

    const account = await (await app.request("/api/console/account", { headers: { cookie } })).json();
    expect(account).toMatchObject({
      subscription_status: "active",
      fully_discounted: true,
      free_until: new Date(1_800_000_000 * 1000).toISOString(),
    });

    (authoritativeSubscription as unknown as Record<string, unknown>).discounts = [];
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      id: "evt_sub_updated",
      object: "event",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: authoritativeSubscription },
    } as Stripe.Event);
    await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    const paid = await (await app.request("/api/console/account", { headers: { cookie } })).json();
    expect(paid).toMatchObject({ fully_discounted: false, free_until: null });
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
      account_id: NEW_GITHUB_ACCOUNT_ID,
      tier: "monthly",
      subscription_status: "active",
      tenant_id: NEW_GITHUB_ACCOUNT_ID,
      slug: "octocat-42",
      usage: { percentageUsed: null, state: "unavailable", resetsAt: null },
    });
    expect(account).not.toHaveProperty("balance");
    expect(account).not.toHaveProperty("ledger");
    expect(account.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(account.mcp_url).toBe(`${DESTINATION}/mcp`);
    const accountJson = await readFile(join(dir, "customer-accounts.json"), "utf8");
    const tokenVaultJson = await readFile(join(dir, "customer-token-bindings.json"), "utf8");
    expect(accountJson).not.toContain(account.token);
    expect(tokenVaultJson).not.toContain(account.token);

    const tenants = createSqliteTenantStore({ dataDir: dir });
    expect(tenants.snapshot()).toEqual([
      expect.objectContaining({
        tokenHash: hashToken(account.token),
        tenant: { id: NEW_GITHUB_ACCOUNT_ID, name: "octocat", plan: "monthly" },
        status: "active",
      }),
    ]);
    tenants.close();
  });

  it("sends one welcome email per account across the return page and webhook retries (EPIC-26 T2)", async () => {
    const mails: TesterMail[] = [];
    const welcome = new WelcomeMailer({
      dataDir: dir,
      sendMail: async (mail) => {
        mails.push(mail);
      },
    });
    const app = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
        onCheckoutWelcome: (account, email) => {
          welcome.queue(account.account_id, email);
        },
      },
    ).app;
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    const back = await app.request(`/checkout/complete?session_id=${session.id}`, { headers: { cookie } });
    expect(back.status).toBe(303);
    for (let i = 0; i < 2; i += 1) {
      const hook = await app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
        body: "{}",
      });
      expect(hook.status).toBe(200);
    }
    await welcome.process();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "customer@example.com" });
    expect(mails[0]!.subject).toContain("You're in");
    expect(welcome.counts()).toEqual({ enabled: true, queued: 0, sent: 1, failing: 0 });
  });

  it("never fails a checkout when the welcome email cannot be queued (EPIC-26 T2)", async () => {
    const app = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
        onCheckoutWelcome: () => {
          throw new Error("mail store unavailable");
        },
      },
    ).app;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cookie = await signInCookie(app);
    await app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    const hook = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(await hook.json()).toEqual({ received: true, result: "completed" });
  });

  it.each(["paid", "no_payment_required"] as const)("lets a non-GitHub internal identity own checkout, account, Stripe metadata, and tenant records (%s)", async (paymentStatus) => {
    const principal: CustomerPrincipal = {
      user_id: customerUserId("google", "google-subject-ada"),
      provider: "google",
      provider_subject: "google-subject-ada",
      display_name: "Ada Lovelace",
      avatar_url: "https://example.test/ada.png",
      email: "ada@example.test",
      email_verified: true,
      github_id: null,
      github_login: null,
    };
    const accountId = `user-${principal.user_id}`;
    session = checkoutSession({
      payment_status: paymentStatus,
      client_reference_id: accountId,
      metadata: { product: "zenod", unit: "zenod", tier: "monthly", account_id: accountId },
    });
    authoritativeSubscription = {
      ...authoritativeSubscription,
      metadata: { account_id: accountId },
    } as Stripe.Subscription;
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      { env, stripe, tenantStore: tenants },
    );
    const cookieIssuer = new Hono();
    cookieIssuer.get("/", (c) => {
      issueCustomerSession(c, principal, env);
      return c.text("ok");
    });
    const issued = await cookieIssuer.request("/");
    const cookie = issued.headers.get("set-cookie")!;

    try {
      const closedCheckout = await layer.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      expect(closedCheckout.status).toBe(503);
      expect(await closedCheckout.json()).toEqual({ error: "Google signup is not open" });
      expect(createdParams).toBeNull();

      env.ZENOD_PUBLIC_GOOGLE_SIGNUP = "1";
      const checkout = await layer.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      expect(checkout.status).toBe(200);
      expect(createdParams).toMatchObject({
        client_reference_id: accountId,
        metadata: { account_id: accountId },
        subscription_data: { metadata: { account_id: accountId } },
      });
      expect(layer.accounts.get(session.id)).toMatchObject({
        account_id: accountId,
        user_id: principal.user_id,
        github_id: null,
        github_login: null,
      });
      expect(layer.identities.ownerForAccount(accountId)).toBe(principal.user_id);

      layer.identities.linkIdentity(principal.user_id, {
        provider: "github",
        provider_subject: "9001",
        provider_login: "ada-on-github",
      });
      const linkedPrincipal = layer.identities.resolve("github", "9001")!;
      expect(customerAccountIdForUser(linkedPrincipal)).toBe(accountId);

      const completedCheckout = await layer.app.request(`/checkout/complete?session_id=${session.id}`, {
        headers: { cookie },
      });
      expect(completedCheckout.status).toBe(303);
      expect(layer.accounts.resolveActiveTenantForUser(principal.user_id)).toMatchObject({
        account_id: accountId,
        tenant_id: accountId,
        subscription_status: "active",
      });
      expect(tenants.snapshot()).toEqual([
        expect.objectContaining({
          tenant: expect.objectContaining({ id: accountId, name: principal.user_id }),
        }),
      ]);
      expect(layer.identities.snapshot().account_owners).toEqual([
        expect.objectContaining({ user_id: principal.user_id, account_id: accountId }),
      ]);
    } finally {
      layer.close();
    }
  });

  it("adds a GitHub App for tasking to a Drive-authoritative tenant without switching vault authority", async () => {
    const google = customerUserId("google", "drive-owner");
    const layer = createCustomerLayer(
      {
        dataDir: runtime.dataDir,
        runtimeForAccount: () => runtime,
        sharedGithubApp: { id: "123", slug: "zenod-tasking", privateKeyPem: "shared-key" },
      },
      { env, stripe, tenantStore: tenants },
    );
    layer.identities.resolveOrCreate({
      provider: "google",
      provider_subject: "drive-owner",
      display_name: "Drive Owner",
      email: "owner@example.test",
      email_verified: true,
    });
    layer.identities.linkIdentity(google, {
      provider: "github",
      provider_subject: "4242",
      provider_login: "drive-tasker",
    });
    const principal = layer.identities.resolve("google", "drive-owner")!;
    const account = layer.accounts.upsert("drive-account", {
      account_id: "drive-account",
      user_id: google,
      github_id: 4242,
      github_login: "drive-tasker",
      tenant_id: "drive-tenant",
      subscription_status: "active",
      vault_provider: "google_drive",
      vault_binding_id: "drive-binding",
      vault_binding_status: "ready",
      vault_binding_created_at: "2026-08-30T10:00:00.000Z",
      vault_binding_updated_at: "2026-08-30T10:00:00.000Z",
      vault_drive_folder_id: "drive-folder",
      vault_drive_manifest_file_id: "drive-manifest",
    });
    runtime.settings.setRaw("github_app_id", "123");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    runtime.settings.setRaw("github_app_private_key", privateKey.export({ type: "pkcs1", format: "pem" }) as string);
    runtime.settings.setRaw("github_app_slug", "zenod-tasking");
    const githubFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input).replace("https://api.github.com", "");
      if (path === "/app/installations/404") return new Response("Not Found", { status: 404 });
      if (path === "/app/installations/999") {
        return Response.json({ id: 999, account: { id: 999, type: "User", login: "victim" } });
      }
      if (path === "/app/installations/888") {
        return Response.json({ id: 888, account: { id: 4242, type: "Organization", login: "linked-org" } });
      }
      if (path === "/app/installations/777") {
        return Response.json({ id: 777, account: { id: 4242, type: "User", login: "drive-tasker" } });
      }
      return new Response(`unexpected ${path}`, { status: 500 });
    });
    const cookieIssuer = new Hono();
    cookieIssuer.get("/", (c) => {
      issueCustomerSession(c, principal, env);
      return c.text("ok");
    });
    const cookie = (await cookieIssuer.request("/")).headers.get("set-cookie")!;
    try {
      const implicit = await layer.app.request("/api/github/app/start", { headers: { cookie } });
      expect(implicit.status).toBe(400);
      const start = await layer.app.request(
        "/api/github/app/start?intent=connect_github_tasking",
        { headers: { cookie } },
      );
      expect(start.status).toBe(200);
      const installUrl = new URL((await start.json() as { url: string }).url);
      const state = installUrl.searchParams.get("state")!;
      const missing = await layer.app.request(
        `/github/setup?installation_id=404&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ error: { code: "github_connection_required" } });
      expect(runtime.settings.getRaw("github_app_installation_id")).toBeNull();
      const organization = await layer.app.request(
        `/github/setup?installation_id=888&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );
      expect(organization.status).toBe(403);
      expect(await organization.json()).toMatchObject({ error: { code: "github_organization_installation_not_supported" } });
      expect(runtime.settings.getRaw("github_app_installation_id")).toBeNull();
      const victim = await layer.app.request(
        `/github/setup?installation_id=999&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );
      expect(victim.status).toBe(403);
      expect(await victim.json()).toMatchObject({ error: { code: "github_installation_identity_mismatch" } });
      expect(runtime.settings.getRaw("github_app_installation_id")).toBeNull();
      const connected = await layer.app.request(
        `/github/setup?installation_id=777&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      );
      expect(connected.status).toBe(302);
      expect(runtime.settings.getRaw("github_app_installation_id")).toBe("777");
      expect(runtime.settings.githubConnectionConfigured()).toBe(true);
      expect(githubFetch.mock.calls.map(([input]) => String(input))).toEqual([
        "https://api.github.com/app/installations/404",
        "https://api.github.com/app/installations/888",
        "https://api.github.com/app/installations/999",
        "https://api.github.com/app/installations/777",
      ]);
      expect(layer.accounts.get(account.session_id)).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_id: "drive-binding",
        vault_drive_folder_id: "drive-folder",
        vault_drive_manifest_file_id: "drive-manifest",
      });

      const forbiddenSwitch = await layer.app.request("/api/vault/repository", {
        method: "PUT",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ repo: "owner/not-a-vault", branch: "main" }),
      });
      expect(forbiddenSwitch.status).toBe(409);
      expect(layer.accounts.get(account.session_id)?.vault_provider).toBe("google_drive");
    } finally {
      layer.close();
    }
  });

  it("runs the generic sidecar lifecycle after local entitlement and composes one customer usage projection", async () => {
    const lifecycle: Array<{ status: string | null; entitled: boolean; localStatus: string | null }> = [];
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
        async onEntitlementChanged(account, input) {
          const token = account.tenant_id
            ? tenants.snapshot().find((item) => item.tenant.id === account.tenant_id)
            : null;
          lifecycle.push({
            status: account.subscription_status,
            entitled: input.entitled,
            localStatus: token?.status ?? null,
          });
        },
        projectUsage: async () => ({
          percentageUsed: null,
          state: "setting_up",
          resetsAt: "2026-09-27T00:00:00.000Z",
        }),
      },
    );
    try {
      const cookie = await signInCookie(layer.app);
      await layer.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      const checkout = await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(checkout.status).toBe(200);
      expect(lifecycle.at(-1)).toEqual({ status: "active", entitled: true, localStatus: "active" });

      authoritativeSubscription = {
        ...authoritativeSubscription,
        status: "canceled",
      } as Stripe.Subscription;
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "customer.subscription.updated",
        livemode: false,
        data: { object: authoritativeSubscription },
      } as Stripe.Event);
      const canceled = await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(canceled.status).toBe(200);
      expect(lifecycle.at(-1)).toEqual({ status: "canceled", entitled: false, localStatus: "suspended" });

      authoritativeSubscription = {
        ...authoritativeSubscription,
        status: "past_due",
      } as Stripe.Subscription;
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "invoice.payment_failed",
        livemode: false,
        data: { object: { subscription: authoritativeSubscription.id } },
      } as Stripe.Event);
      const grace = await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(grace.status).toBe(200);
      expect(lifecycle.at(-1)).toEqual({ status: "past_due", entitled: true, localStatus: "active" });

      const usage = await layer.app.request("/api/customer-usage", { headers: { cookie } });
      expect(await usage.json()).toEqual({
        percentageUsed: null,
        state: "setting_up",
        resetsAt: "2026-09-27T00:00:00.000Z",
      });
    } finally {
      layer.close();
    }
  });

  it("tells the user once when renewal lapses and again before suspending them (EPIC-7 T2.1 sandbox sequence)", async () => {
    const log: string[] = [];
    const notices: Array<{ kind: string; operationId: string; consoleUrl: string }> = [];
    const localStatus = (account: { tenant_id: string | null }) =>
      tenants.snapshot().find((item) => item.tenant.id === account.tenant_id)?.status ?? null;
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
        },
        async onEntitlementChanged(account, input) {
          log.push(`entitlement:${account.subscription_status}:${input.entitled}`);
        },
        async onBillingNotice(account, notice) {
          log.push(`notice:${notice.kind}:tenant-${localStatus(account)}`);
          notices.push(notice);
        },
      },
    );
    const deliver = async (type: string, status: Stripe.Subscription.Status, periodEnd = 1_800_000_000) => {
      authoritativeSubscription = { ...authoritativeSubscription, status, current_period_end: periodEnd };
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type,
        livemode: false,
        data: {
          // Both Stripe accounts render events at 2026-06-24.dahlia: no top-level invoice.subscription.
          object: type.startsWith("invoice.")
            ? { parent: { subscription_details: { subscription: authoritativeSubscription.id } } }
            : authoritativeSubscription,
        },
      } as Stripe.Event);
      const response = await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, result: status === "canceled" ? "canceled" : status });
    };
    try {
      const cookie = await signInCookie(layer.app);
      await layer.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      await layer.app.request("/webhook", { method: "POST", headers: { "stripe-signature": "valid" }, body: "{}" });
      expect(notices).toEqual([]);

      // Renewal with no card and no extension: Stripe finalizes €9, the charge fails, it retries for ~2 weeks.
      await deliver("customer.subscription.updated", "past_due");
      await deliver("invoice.payment_failed", "past_due");
      await deliver("invoice.payment_failed", "past_due");
      // The operator recovers it (fresh coupon + void the open invoice): no notice for going back to active.
      await deliver("customer.subscription.updated", "active");
      // Next month lapses again, and this time the retries run out and Stripe cancels.
      await deliver("invoice.payment_failed", "past_due", 1_802_678_400);
      await deliver("customer.subscription.deleted", "canceled", 1_802_678_400);
      await deliver("customer.subscription.deleted", "canceled", 1_802_678_400);

      expect(notices.map((notice) => notice.kind)).toEqual([
        "payment_past_due",
        "payment_past_due",
        "access_suspended",
      ]);
      expect(new Set(notices.map((notice) => notice.operationId)).size).toBe(3);
      expect(notices[0]).toMatchObject({
        operationId: `billing-notice:payment_past_due:${NEW_GITHUB_ACCOUNT_ID}:1800000000`,
        consoleUrl: `${DESTINATION}/app`,
      });
      // The suspension notice goes out while the tenant is still active, before local and sidecar suspension.
      const suspendedNotice = log.indexOf("notice:access_suspended:tenant-active");
      expect(suspendedNotice).toBeGreaterThan(-1);
      expect(log.indexOf("entitlement:canceled:false")).toBeGreaterThan(suspendedNotice);
      expect(tenants.snapshot().find((row) => row.tenant.id === NEW_GITHUB_ACCOUNT_ID)?.status).toBe("suspended");
    } finally {
      layer.close();
    }
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

  it("keeps a historical yearly account readable, portal-manageable, and webhook-reconciled", async () => {
    const layer = createCustomerLayer(
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
    );
    try {
      const cookie = await signInCookie(layer.app);
      layer.accounts.upsert("cs_legacy_yearly", {
        account_id: customerAccountId(42),
        github_id: 42,
        github_login: "octocat",
        tier: "yearly",
        stripe_customer_id: "cus_legacy_yearly",
        stripe_subscription_id: "sub_legacy_yearly",
        subscription_status: "active",
      });

      const account = await layer.app.request("/api/console/account", { headers: { cookie } });
      expect(account.status).toBe(200);
      expect(await account.json()).toMatchObject({ tier: "yearly", subscription_status: "active" });
      expect(layer.identities.ownerForAccount(customerAccountId(42))).toBe(
        layer.accounts.get("cs_legacy_yearly")?.user_id,
      );

      const portal = await layer.app.request("/api/billing/portal", { method: "POST", headers: { cookie } });
      expect(portal.status).toBe(200);
      expect(await portal.json()).toEqual({ url: "https://billing.stripe.test/session" });

      authoritativeSubscription = {
        ...authoritativeSubscription,
        id: "sub_legacy_yearly",
        customer: "cus_legacy_yearly",
        status: "past_due",
      } as Stripe.Subscription;
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "customer.subscription.updated",
        livemode: false,
        data: { object: authoritativeSubscription },
      } as Stripe.Event);
      const webhook = await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(await webhook.json()).toEqual({ received: true, result: "past_due" });
      expect(layer.accounts.get("cs_legacy_yearly")).toMatchObject({
        tier: "yearly",
        subscription_status: "past_due",
      });
    } finally {
      layer.close();
    }
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
      current_period_start: 1_797_321_600,
      current_period_end: 1_800_000_000,
    }) as Stripe.Subscription;

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscription("past_due", true) },
    } as Stripe.Event);
    authoritativeSubscription = subscription("past_due", true);
    const pastDue = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(await pastDue.json()).toEqual({ received: true, result: "past_due" });
    expect(tenants.snapshot().find((row) => row.tenant.id === NEW_GITHUB_ACCOUNT_ID)?.status).toBe("active");

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
    authoritativeSubscription = subscription("active");
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
    authoritativeSubscription = subscription("canceled");
    const canceled = await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(await canceled.json()).toEqual({ received: true, result: "canceled" });
    expect(tenants.snapshot().find((row) => row.tenant.id === NEW_GITHUB_ACCOUNT_ID)?.status).toBe("suspended");

    vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
      type: "invoice.payment_failed",
      livemode: false,
      data: { object: invoice },
    } as Stripe.Event);
    authoritativeSubscription = subscription("canceled");
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
    authoritativeSubscription = subscription("active");
    await app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    });
    expect(tenants.snapshot().find((row) => row.tenant.id === NEW_GITHUB_ACCOUNT_ID)?.status).toBe("active");
  });

  it("uses authoritative Stripe state for webhook entitlement reconciliation and suspend", async () => {
    const layer = createCustomerLayer(
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
    );
    try {
      const cookie = await signInCookie(layer.app);
      await layer.app.request("/create-checkout-session", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "monthly" }),
      });
      await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });

      const staleDelivered = {
        ...authoritativeSubscription,
        status: "active",
      } as Stripe.Subscription;
      authoritativeSubscription = {
        ...authoritativeSubscription,
        status: "past_due",
      } as Stripe.Subscription;
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "customer.subscription.updated",
        livemode: false,
        data: { object: staleDelivered },
      } as Stripe.Event);
      const webhook = await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(await webhook.json()).toEqual({ received: true, result: "past_due" });
      expect(layer.accounts.resolveForSubscription("sub_test_customer")?.subscription_status).toBe("past_due");

      authoritativeSubscription = {
        ...authoritativeSubscription,
        status: "canceled",
      } as Stripe.Subscription;
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: "customer.subscription.updated",
        livemode: false,
        data: { object: staleDelivered },
      } as Stripe.Event);
      await layer.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(layer.accounts.resolveForSubscription("sub_test_customer")?.subscription_status).toBe("canceled");
      expect(tenants.snapshot().find((row) => row.tenant.id === NEW_GITHUB_ACCOUNT_ID)?.status).toBe("suspended");
    } finally {
      layer.close();
    }
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

  it("refreshes legacy billing periods authoritatively with per-account isolation and no provisioning side effects", async () => {
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        onEntitlementChanged: vi.fn(),
      },
    );
    const monthly = layer.accounts.upsert("legacy-monthly", {
      account_id: "legacy-monthly",
      github_id: 101,
      github_login: "monthly",
      tenant_id: "legacy-monthly",
      stripe_subscription_id: "sub-monthly",
      subscription_status: "active",
    });
    const yearly = layer.accounts.upsert("legacy-yearly", {
      account_id: "legacy-yearly",
      github_id: 102,
      github_login: "yearly",
      tenant_id: "legacy-yearly",
      stripe_subscription_id: "sub-yearly",
      subscription_status: "active",
    });
    layer.accounts.upsert("legacy-failed", {
      account_id: "legacy-failed",
      github_id: 103,
      github_login: "failed",
      tenant_id: "legacy-failed",
      stripe_subscription_id: "sub-failed",
      subscription_status: "active",
    });
    vi.mocked(stripe.subscriptions!.retrieve).mockImplementation(async (id) => {
      if (id === "sub-failed") throw new Error("Stripe unavailable for one account");
      const yearlyPeriod = id === "sub-yearly";
      return {
        ...authoritativeSubscription,
        id,
        metadata: { account_id: id === "sub-monthly" ? monthly.account_id : yearly.account_id },
        current_period_start: yearlyPeriod ? 1_798_761_600 : 1_797_321_600,
        current_period_end: yearlyPeriod ? 1_830_297_600 : 1_800_000_000,
      } as Stripe.Subscription;
    });
    const beforeTenants = tenants.snapshot();

    const first = await layer.refreshAuthoritativeSubscriptions();
    const second = await layer.refreshAuthoritativeSubscriptions();

    expect(first).toEqual({
      refreshedAccountIds: ["legacy-monthly", "legacy-yearly"],
      failedAccountIds: ["legacy-failed"],
    });
    expect(second).toEqual(first);
    expect(layer.accounts.get("legacy-monthly")).toMatchObject({
      current_period_start: new Date(1_797_321_600 * 1000).toISOString(),
      current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
    });
    expect(layer.accounts.get("legacy-yearly")).toMatchObject({
      current_period_start: new Date(1_798_761_600 * 1000).toISOString(),
      current_period_end: new Date(1_830_297_600 * 1000).toISOString(),
    });
    expect(layer.accounts.get("legacy-failed")?.current_period_start).toBeNull();
    expect(tenants.snapshot()).toEqual(beforeTenants);
    expect(layer.tokenVault.get("legacy-monthly")).toBeNull();
    layer.close();
  });

  it("reports unavailable usage and refreshes a non-Stripe account to the UTC month without a platform key", async () => {
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      { env, stripe, tenantStore: tenants },
    );
    const account = layer.accounts.upsert("self-comped", {
      account_id: "self-comped",
      github_id: 106,
      github_login: "self-comped",
      tenant_id: "self-comped",
      subscription_status: "active",
    });
    expect(await layer.usageForAccount(account)).toMatchObject({ percentageUsed: null, state: "unavailable" });
    expect(await layer.refreshAuthoritativeSubscriptions()).toEqual({
      refreshedAccountIds: ["self-comped"],
      failedAccountIds: [],
    });
    const start = new Date();
    expect(layer.accounts.get("self-comped")?.current_period_start).toBe(
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString(),
    );
    layer.close();
  });

  it("platform-key mode skips the per-tenant key check and reports ledger usage; shadow mode never pauses", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("no OpenRouter call expected in platform-key mode");
    });
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env: {
          ...env,
          ZENOD_PLATFORM_OPENROUTER_KEY: "platform-key",
          ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "10",
          ZENOD_TENANT_ALLOWANCE_MODE: "shadow",
        },
        stripe,
        tenantStore: tenants,
      },
    );
    const account = layer.accounts.upsert("platform-comped", {
      account_id: "platform-comped",
      github_id: 107,
      github_login: "platform-comped",
      tenant_id: "platform-comped",
      subscription_status: "active",
    });
    runtime.usageStore.record({
      operation: "answer",
      provider: "openrouter",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerCostUsd: 12,
    });
    expect(await layer.refreshAuthoritativeSubscriptions()).toEqual({
      refreshedAccountIds: ["platform-comped"],
      failedAccountIds: [],
    });
    expect(layer.accounts.get("platform-comped")?.current_period_start).not.toBeNull();
    expect(await layer.usageForAccount(account)).toMatchObject({ state: "warn", percentageUsed: 100, monthSpendUsd: 12 });
    expect(request).not.toHaveBeenCalled();
    layer.close();

    // EPIC-7 T3: with the allowance enforced (the default), the same overrun reads as paused.
    const enforced = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env: { ...env, ZENOD_PLATFORM_OPENROUTER_KEY: "platform-key", ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "10" },
        stripe,
        tenantStore: tenants,
      },
    );
    expect(await enforced.usageForAccount(account)).toMatchObject({ state: "paused", percentageUsed: 100, allowanceUsd: 10 });
    enforced.close();
  });

  it("leaves a legacy row unchanged when no authoritative Stripe provider exists", async () => {
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env: {
          ...env,
          STRIPE_SECRET_KEY: "",
          STRIPE_WEBHOOK_SECRET: "",
        },
        tenantStore: tenants,
      },
    );
    layer.accounts.upsert("legacy-no-provider", {
      account_id: "legacy-no-provider",
      github_id: 104,
      github_login: "no-provider",
      tenant_id: "legacy-no-provider",
      stripe_subscription_id: "sub-no-provider",
      subscription_status: "active",
    });
    expect(await layer.refreshAuthoritativeSubscriptions()).toEqual({
      refreshedAccountIds: [],
      failedAccountIds: ["legacy-no-provider"],
    });
    expect(layer.accounts.get("legacy-no-provider")?.current_period_start).toBeNull();
    expect(layer.tokenVault.get("legacy-no-provider")).toBeNull();
    layer.close();
  });

  it("keeps the established MCP token valid when account binding is reconciled after a secret change", async () => {
    const layerOptions = () => ({
      env,
      stripe,
      tenantStore: tenants,
      identity: {
        authorizeUrl: (state: string) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
        exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "customer@example.com" }),
      },
    });
    const first = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      layerOptions(),
    );
    const firstCookie = await signInCookie(first.app);
    await first.app.request("/create-checkout-session", {
      method: "POST",
      headers: { cookie: firstCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "monthly" }),
    });
    expect((await first.app.request("/webhook", {
      method: "POST",
      headers: { "stripe-signature": "valid" },
      body: "{}",
    })).status).toBe(200);
    const establishedToken = first.tokenVault.get(NEW_GITHUB_ACCOUNT_ID);
    expect(establishedToken).toMatch(/^zenod_[a-f0-9]{48}$/);
    await first.close();

    env = { ...env, ACCOUNT_STATE_SECRET: "replacement-state-secret" };
    session = checkoutSession({
      id: "cs_reconciled_customer",
      subscription: "sub_reconciled_customer",
    });
    authoritativeSubscription = {
      ...authoritativeSubscription,
      id: "sub_reconciled_customer",
    } as Stripe.Subscription;
    const reconciled = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      layerOptions(),
    );
    try {
      const reconciledCookie = await signInCookie(reconciled.app);
      reconciled.accounts.upsert(session.id, {
        account_id: NEW_GITHUB_ACCOUNT_ID,
        github_id: 42,
        github_login: "octocat",
        tier: "monthly",
        stripe_client_reference_id: NEW_GITHUB_ACCOUNT_ID,
        subscription_status: "checkout_pending",
        claimed_at: new Date(Date.now() + 1_000).toISOString(),
      });
      const webhook = await reconciled.app.request("/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid" },
        body: "{}",
      });
      expect(await webhook.json()).toEqual({ received: true, result: "completed" });

      const reconciledToken = reconciled.tokenVault.get(NEW_GITHUB_ACCOUNT_ID);
      expect(reconciledToken).toMatch(/^zenod_[a-f0-9]{48}$/);
      expect(reconciledToken).not.toBe(establishedToken);
      const establishedRecord = tenants.resolveTokenHash(hashToken(establishedToken!));
      expect(establishedRecord).toMatchObject({
        tenant: { id: NEW_GITHUB_ACCOUNT_ID },
        status: "active",
      });
      expect(establishedRecord?.profile ?? null).toBeNull();
      const reconciledRecord = tenants.resolveTokenHash(hashToken(reconciledToken!));
      expect(reconciledRecord).toMatchObject({
        tenant: { id: NEW_GITHUB_ACCOUNT_ID },
        status: "active",
      });
      expect(reconciledRecord?.profile ?? null).toBeNull();
      const account = await reconciled.app.request("/api/console/account", {
        headers: { cookie: reconciledCookie },
      });
      expect(await account.json()).toMatchObject({
        token: reconciledToken,
        mcp_url: `${DESTINATION}/mcp`,
      });
    } finally {
      await reconciled.close();
    }
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
