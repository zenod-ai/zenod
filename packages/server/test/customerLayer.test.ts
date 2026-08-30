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
import type { ManagedAiProviderClient } from "../src/customerManagedAi.js";
import { Runtime } from "../src/runtime.js";

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
    expect(callback.headers.get("location")).toBe(expectedDestination);
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
      success_url: `${DESTINATION}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    });

    const pendingAccount = await app.request("/api/console/account", { headers: { cookie } });
    expect(pendingAccount.status).toBe(404);
    expect(await pendingAccount.json()).toEqual({ error: "no_account" });

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
    expect(account.mcp_url).toBe(`${DESTINATION}/mcp/${account.token}`);
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

  it("lets a non-GitHub internal identity own checkout, account, Stripe metadata, and tenant records", async () => {
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
          usage_monthly: 0.33,
          byok_usage_monthly: 0,
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

  it("uses authoritative Stripe state for webhook and periodic entitlement reconciliation", async () => {
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
      await layer.reconcileManagedAiAccounts();
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

  it("uses an existing tenant OpenRouter key as the authoritative capped monthly usage source", async () => {
    runtime.settings.set("provider", "openrouter");
    runtime.settings.set("openrouter_api_key", "tenant-key-kept-in-vault");
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        data: {
          label: "existing-tenant-key",
          limit: 2,
          limit_remaining: 1.4,
          limit_reset: "monthly",
          usage: 0.6,
          usage_monthly: 0.6,
          byok_usage_monthly: 0,
          include_byok_in_limit: true,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const projectedAccounts: CustomerAccount[] = [];
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      {
        env,
        stripe,
        tenantStore: tenants,
        projectUsage(account, local) {
          projectedAccounts.push(account);
          return local;
        },
      },
    );
    const account = layer.accounts.upsert("legacy-current-key", {
      account_id: "legacy-current-key",
      github_id: 105,
      github_login: "current-key",
      tenant_id: "legacy-current-key",
      subscription_status: "active",
    });
    const expectedStart = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      1,
    )).toISOString();
    const expectedEnd = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth() + 1,
      1,
    )).toISOString();

    expect(await layer.refreshAuthoritativeSubscriptions()).toEqual({
      refreshedAccountIds: ["legacy-current-key"],
      failedAccountIds: [],
    });
    expect(await layer.usageForAccount(account)).toEqual({
      percentageUsed: 30,
      state: "normal",
      resetsAt: expectedEnd,
    });
    expect(layer.accounts.get("legacy-current-key")).toMatchObject({
      managed_ai_limit_usd: 2,
      managed_ai_status: "active",
      current_period_start: expectedStart,
      current_period_end: expectedEnd,
    });
    expect(projectedAccounts.at(-1)).toMatchObject({
      managed_ai_limit_usd: 2,
      current_period_start: expectedStart,
      current_period_end: expectedEnd,
    });
    expect(request).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: "Bearer tenant-key-kept-in-vault" },
    });
    expect(layer.tokenVault.get("legacy-current-key")).toBeNull();
    layer.close();
  });

  it("fails closed when an existing tenant key does not match the hosted monthly cap", async () => {
    runtime.settings.set("provider", "openrouter");
    runtime.settings.set("openrouter_api_key", "tenant-key-kept-in-vault");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        data: {
          label: "wrong-policy-key",
          limit: 5,
          limit_remaining: 5,
          limit_reset: "monthly",
          usage_monthly: 0,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const layer = createCustomerLayer(
      { dataDir: runtime.dataDir, runtimeForAccount: () => runtime },
      { env, stripe, tenantStore: tenants },
    );
    const account = layer.accounts.upsert("legacy-wrong-key-policy", {
      account_id: "legacy-wrong-key-policy",
      github_id: 106,
      github_login: "wrong-key-policy",
      tenant_id: "legacy-wrong-key-policy",
      subscription_status: "active",
    });

    expect(await layer.refreshAuthoritativeSubscriptions()).toEqual({
      refreshedAccountIds: [],
      failedAccountIds: ["legacy-wrong-key-policy"],
    });
    expect(await layer.usageForAccount(account)).toMatchObject({
      percentageUsed: null,
      state: "unavailable",
    });
    expect(layer.accounts.get("legacy-wrong-key-policy")).toMatchObject({
      managed_ai_limit_usd: null,
      current_period_start: null,
      current_period_end: null,
    });
    layer.close();
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
        mcp_url: `${DESTINATION}/mcp/${reconciledToken}`,
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
