import Stripe from "stripe";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { Runtime } from "./runtime.js";
import { CustomerAccountStore, customerAccountId, type CustomerAccount } from "./customerAccounts.js";
import {
  completeCustomerCheckout,
  createCustomerCheckout,
  loadCustomerBillingConfig,
  resolveCheckoutTier,
  type CustomerStripeClient,
} from "./customerBilling.js";
import { GithubIdentityProvider, signState, verifyState, type IdentityProvider } from "./customerIdentity.js";
import { customerMetering } from "./customerMetering.js";
import { clearCustomerSession, issueCustomerSession, readCustomerSession } from "./customerSession.js";
import { createLocalTenantBindingAdapter } from "./customerTenantBinding.js";
import { CustomerTokenVault } from "./customerTokenVault.js";
import { hashToken } from "@zenod/mcp-chassis";

// Customer HTTP layer transplanted from zenod-ai/cloud services/webhook/src/server.ts
// and services/console/src/api.ts @ 6bdb318.

export interface CustomerLayerOptions {
  env?: NodeJS.ProcessEnv;
  identity?: IdentityProvider;
  stripe?: CustomerStripeClient;
  tenantStore?: import("@zenod/mcp-chassis").TenantProvisioningStore;
  onCheckoutCompleted?: (account: CustomerAccount, session: Stripe.Checkout.Session) => Promise<void> | void;
}

export interface CustomerLayerHost {
  dataDir: string;
  runtimeForAccount?: (account: CustomerAccount) => Runtime | null;
}

export function customerAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET && customerStateSecret(env));
}

function customerStateSecret(env: NodeJS.ProcessEnv): string {
  return env.ACCOUNT_STATE_SECRET || env.STRIPE_WEBHOOK_SECRET || "";
}

function trustedReturnHost(value: string | undefined): string | null {
  const host = value?.split(",")[0]?.trim().split(":")[0]?.toLowerCase();
  return host && (host === "zenod.dev" || /^[a-z0-9.-]+\.zenod\.dev$/.test(host)) ? host : null;
}

function customerDestination(env: NodeJS.ProcessEnv): string {
  return (env.CUSTOMER_APP_URL || env.DOMAIN || "https://cloud.zenod.dev").replace(/\/$/, "");
}

function callbackUrl(env: NodeJS.ProcessEnv): string {
  return env.GITHUB_OAUTH_CALLBACK_URL || `${customerDestination(env)}/auth/github/callback`;
}

function signedReturnDestination(returnHost: string | undefined, env: NodeJS.ProcessEnv): string {
  const trusted = trustedReturnHost(returnHost);
  if (trusted === "zenod.dev") return "https://zenod.dev/";
  if (trusted) return `https://${trusted}/app`;
  return `${customerDestination(env)}/app`;
}

export function createCustomerLayer(host: CustomerLayerHost, options: CustomerLayerOptions = {}) {
  const env = options.env ?? process.env;
  const accounts = new CustomerAccountStore(host.dataDir);
  const billing = loadCustomerBillingConfig(env);
  const tokenVault = new CustomerTokenVault(host.dataDir, customerStateSecret(env));
  if (env.STRIPE_SECRET_KEY) {
    const expectedMarker = billing.stripeMode === "live" ? "_live_" : "_test_";
    if (!env.STRIPE_SECRET_KEY.includes(expectedMarker)) {
      throw new Error(`STRIPE_MODE=${billing.stripeMode} requires a matching Stripe key`);
    }
  }
  const identity =
    options.identity ??
    (env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET
      ? new GithubIdentityProvider(env.GITHUB_OAUTH_CLIENT_ID, env.GITHUB_OAUTH_CLIENT_SECRET, callbackUrl(env))
      : null);
  const stripe =
    options.stripe ??
    (env.STRIPE_SECRET_KEY
      ? (new Stripe(env.STRIPE_SECRET_KEY, {
          appInfo: { name: "zenod/customer-layer", version: "0.1.0" },
        }) as CustomerStripeClient)
      : null);
  const onCheckoutCompleted =
    options.onCheckoutCompleted ??
    createLocalTenantBindingAdapter({
      dataDir: host.dataDir,
      accounts,
      tenantStore: options.tenantStore,
      tokenVault,
    });
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/auth/signin", (c) => {
    if (!identity || !customerStateSecret(env)) return c.text("Sign-in is not configured.", 503);
    const requestedHost = trustedReturnHost(c.req.header("x-forwarded-host") || c.req.header("host"));
    const state = signState({ mode: "signin", ...(requestedHost ? { rh: requestedHost } : {}) }, customerStateSecret(env));
    return c.redirect(identity.authorizeUrl(state), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    if (!identity) return c.text("Sign-in is not configured.", 503);
    const code = c.req.query("code") ?? "";
    const state = verifyState(c.req.query("state") ?? "", customerStateSecret(env));
    if (!code || !state || state.mode !== "signin") {
      return c.text("Invalid or expired sign-in. Please retry.", 400);
    }
    try {
      const user = await identity.exchangeAndGetUser(code);
      const githubId = typeof user.id === "number" ? user.id : Number(user.id);
      if (!Number.isSafeInteger(githubId) || githubId <= 0) throw new Error("GitHub returned an invalid user id");
      issueCustomerSession(c, { id: githubId, login: user.login }, env);
      return c.redirect(signedReturnDestination(state.rh, env), 302);
    } catch (error) {
      console.error("github callback failed:", error);
      return c.text("Could not complete GitHub sign-in. Please retry.", 502);
    }
  });

  app.post("/auth/signout", (c) => {
    clearCustomerSession(c, env);
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    return c.json({
      login: session.login,
      avatar_url: `https://github.com/${session.login}.png`,
    });
  });

  app.get("/api/auth/status", (c) =>
    c.json({ needsSetup: false, configured: true, customerAuth: true, authMethod: "github" }),
  );
  app.all("/api/auth/login", (c) => c.json({ error: "not found" }, 404));
  app.all("/api/auth/setup", (c) => c.json({ error: "not found" }, 404));
  app.post("/api/auth/logout", (c) => {
    clearCustomerSession(c, env);
    return c.json({ ok: true });
  });
  app.all("/api/auth/logout", (c) => c.json({ error: "not found" }, 404));

  app.get("/api/console/account", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.github_id);
    const token = account ? tokenVault.get(account.account_id) : null;
    const tenantRecord = token ? await options.tenantStore?.resolveTokenHash(hashToken(token)) : null;
    if (
      !account ||
      !account.tenant_id ||
      !token ||
      !tenantRecord ||
      tenantRecord.tenant.id !== account.tenant_id ||
      (tenantRecord.status ?? "active") !== "active"
    ) {
      return c.json({ error: "no_account" }, 404);
    }
    const runtime = host.runtimeForAccount?.(account) ?? null;
    const summary = runtime?.usageStore.summary(Date.now() - 7 * 24 * 60 * 60_000) ?? {
      since: Date.now() - 7 * 24 * 60 * 60_000,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
      byOperation: [],
      byModel: [],
    };
    const metering = await customerMetering(summary, env.OPENROUTER_PROVISIONING_KEY, account.tenant_slug);
    return c.json({
      account_id: account.account_id,
      tier: account.tier,
      subscription_status: account.subscription_status,
      tenant_id: account.tenant_id,
      slug: account.tenant_slug,
      mcp_url: `${billing.domain}/mcp/${token}`,
      token,
      token_hint: token.slice(-4),
      vault_repo: account.vault_repo ?? runtime?.settings.get("vault_repo") ?? null,
      vault_repo_url: account.vault_repo_url,
      ...metering,
    });
  });

  app.post("/api/token/regenerate", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.github_id);
    if (!account?.tenant_id || !options.tenantStore) return c.json({ error: "no_account" }, 404);
    const currentToken = tokenVault.get(account.account_id);
    const current = currentToken ? await options.tenantStore.resolveTokenHash(hashToken(currentToken)) : null;
    if (
      !current ||
      current.tenant.id !== account.tenant_id ||
      (current.status ?? "active") !== "active"
    ) {
      return c.json({ error: "tenant unavailable" }, 409);
    }
    const rotated = await options.tenantStore.rotateTenantToken(account.tenant_id);
    if (!rotated || (rotated.record.status ?? "active") !== "active") {
      return c.json({ error: "tenant unavailable" }, 409);
    }
    tokenVault.put(account.account_id, rotated.token);
    return c.json({
      token: rotated.token,
      mcpPath: `/mcp/${rotated.token}`,
      mcp_url: `${billing.domain}/mcp/${rotated.token}`,
    });
  });

  async function startCheckout(c: Context<{ Bindings: HttpBindings }>, tierInput: unknown) {
    const owner = readCustomerSession(c, env);
    if (!owner) return c.json({ error: "sign in before subscribing" }, 401);
    if (!stripe) return c.json({ error: "checkout is not configured" }, 503);
    const resolved = resolveCheckoutTier(tierInput, billing);
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);
    const session = await createCustomerCheckout(stripe, accounts, billing, owner, resolved);
    return c.json({ id: session.id, url: session.url, product: "zenod", tier: resolved.tier });
  }

  app.get("/buy", async (c) => {
    const response = await startCheckout(c, c.req.query("tier"));
    if (response.status !== 200) return response;
    const payload = (await response.clone().json()) as { url: string };
    return c.redirect(payload.url, 303);
  });

  app.post("/create-checkout-session", async (c) => {
    const body = await c.req.json<{ tier?: string }>().catch((): { tier?: string } => ({}));
    return startCheckout(c, body.tier);
  });

  app.get("/checkout/complete", async (c) => {
    const owner = readCustomerSession(c, env);
    if (!owner) return c.redirect("/auth/signin", 303);
    if (!stripe) return c.text("Checkout is not configured.", 503);
    const sessionId = c.req.query("session_id");
    if (!sessionId) return c.text("Missing session_id.", 400);
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      return c.text("Checkout session not found.", 404);
    }
    if (session.client_reference_id !== customerAccountId(owner.github_id)) {
      return c.text("Checkout account binding mismatch.", 403);
    }
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return c.text("Checkout is not complete.", 409);
    }
    await completeCustomerCheckout(session, accounts, onCheckoutCompleted);
    return c.redirect(`${customerDestination(env)}/app`, 303);
  });

  app.post("/webhook", async (c) => {
    if (!stripe || !billing.stripeWebhookSecret) return c.json({ error: "webhook is not configured" }, 503);
    const signature = c.req.header("stripe-signature");
    if (!signature) return c.json({ error: "missing Stripe signature" }, 400);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(await c.req.text(), signature, billing.stripeWebhookSecret);
    } catch {
      return c.json({ error: "invalid Stripe signature" }, 400);
    }
    if (event.livemode !== (billing.stripeMode === "live")) return c.json({ error: "stripe mode mismatch" }, 400);
    if (event.type !== "checkout.session.completed") return c.json({ received: true });
    const result = await completeCustomerCheckout(
      event.data.object as Stripe.Checkout.Session,
      accounts,
      onCheckoutCompleted,
    );
    return c.json({ received: true, result });
  });

  return { app, accounts, tokenVault };
}
