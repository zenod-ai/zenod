import Stripe from "stripe";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Runtime } from "./runtime.js";
import { CustomerAccountStore, customerAccountIdForUser, type CustomerAccount } from "./customerAccounts.js";
import {
  completeCustomerCheckout,
  createCustomerCheckout,
  createCustomerPortalSession,
  applyCustomerInvoiceEvent,
  applyCustomerSubscriptionEvent,
  loadCustomerBillingConfig,
  newCheckoutPolicyForProduct,
  resolveCheckoutTier,
  type CustomerStripeClient,
  type CustomerProductConfig,
} from "./customerBilling.js";
import {
  CustomerIdentityStore,
  GoogleOidcIdentityProvider,
  GithubIdentityProvider,
  signState,
  verifyState,
  type CustomerPrincipal,
  type IdentityProvider,
  type StatePayload,
} from "./customerIdentity.js";
import type { CustomerIdentityProvider } from "./googleDriveVaultContract.js";
import {
  currentGatewayKey,
  projectCustomerUsage,
  type CustomerUsageProjection,
  type GatewayKeyUsage,
} from "./customerMetering.js";
import {
  createOpenRouterManagedAiClient,
  CustomerManagedAiAuditStore,
  CustomerManagedAiLifecycle,
  loadManagedAiConfig,
  type ManagedAiProviderClient,
} from "./customerManagedAi.js";
import { CustomerManagedAiAdmissionQueue } from "./customerManagedAiAdmission.js";
import {
  clearCustomerSession,
  issueCustomerSession,
  readCustomerSession,
  type CustomerSession,
} from "./customerSession.js";
import { createLocalTenantBindingAdapter } from "./customerTenantBinding.js";
import { CustomerTokenVault } from "./customerTokenVault.js";
import { hashToken } from "@zenod/mcp-chassis";
import type { SharedGithubApp } from "./sharedGithubApp.js";
import {
  assertPublicSignupIsReady,
  checkoutEnabledForOwner,
  productionReadinessReport,
} from "./productionReadiness.js";

// Customer HTTP layer transplanted from zenod-ai/cloud services/webhook/src/server.ts
// and services/console/src/api.ts @ 6bdb318.

export interface CustomerLayerOptions {
  env?: NodeJS.ProcessEnv;
  /** Legacy test/integration seam for the GitHub identity provider. */
  identity?: IdentityProvider;
  /** Provider-neutral sign-in seams. Explicit providers override env-backed defaults. */
  identityProviders?: Partial<Record<CustomerIdentityProvider, IdentityProvider>>;
  stripe?: CustomerStripeClient;
  tenantStore?: import("@zenod/mcp-chassis").TenantProvisioningStore;
  onCheckoutCompleted?: (account: CustomerAccount, session: Stripe.Checkout.Session) => Promise<void> | void;
  /** Product-owned sidecar lifecycle; it must durably record desired state before returning. */
  onEntitlementChanged?: (
    account: CustomerAccount,
    input: { entitled: boolean },
  ) => Promise<void> | void;
  /** Product-owned composition of the local usage projection with an independent service. */
  projectUsage?: (
    account: CustomerAccount,
    local: CustomerUsageProjection,
  ) => Promise<CustomerUsageProjection> | CustomerUsageProjection;
  managedAiProvider?: ManagedAiProviderClient;
  product?: CustomerProductConfig;
  /**
   * Optional route capabilities for product-specific customer surfaces.
   *
   * The shared customer layer defaults to the existing Zenod surface. Products
   * that reuse only its account/auth/checkout core must explicitly turn off
   * application capabilities they do not own.
   */
  capabilities?: Partial<CustomerLayerCapabilities>;
  /** Test-only fault seam proving Telegram does not acknowledge before SQLite admission. */
  managedAiAdmissionBeforeJournal?: () => void;
}

export interface CustomerLayerCapabilities {
  productionReadiness: boolean;
  repositoryConnection: boolean;
  managedAiApplication: boolean;
}

export interface CustomerLayerHost {
  dataDir: string;
  runtimeForAccount?: (account: CustomerAccount) => Runtime | null;
  sharedGithubApp?: SharedGithubApp | null;
}

export function customerAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const github = env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET;
  const google = env.GOOGLE_OIDC_CLIENT_ID && env.GOOGLE_OIDC_CLIENT_SECRET;
  return Boolean((github || google) && customerStateSecret(env));
}

function customerStateSecret(env: NodeJS.ProcessEnv): string {
  return env.ACCOUNT_STATE_SECRET || env.STRIPE_WEBHOOK_SECRET || "";
}

function trustedReturnHost(value: string | undefined): string | null {
  const host = value?.split(",")[0]?.trim().split(":")[0]?.toLowerCase();
  return host && (host === "zenod.dev" || /^[a-z0-9.-]+\.zenod\.dev$/.test(host)) ? host : null;
}

function customerDestination(env: NodeJS.ProcessEnv, defaultDomain = "https://cloud.zenod.dev"): string {
  return (env.CUSTOMER_APP_URL || env.DOMAIN || defaultDomain).replace(/\/$/, "");
}

function githubCallbackUrl(env: NodeJS.ProcessEnv, defaultDomain?: string): string {
  return env.GITHUB_OAUTH_CALLBACK_URL || `${customerDestination(env, defaultDomain)}/auth/github/callback`;
}

function googleCallbackUrl(env: NodeJS.ProcessEnv, defaultDomain?: string): string {
  return env.GOOGLE_OIDC_CALLBACK_URL || `${customerDestination(env, defaultDomain)}/auth/google/callback`;
}

const GOOGLE_OIDC_FLOW_COOKIE = "zenod_google_oidc_flow";

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function setGoogleFlowCookie(c: Context, proof: string, env: NodeJS.ProcessEnv): void {
  setCookie(c, GOOGLE_OIDC_FLOW_COOKIE, proof, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/auth/google/callback",
    maxAge: 10 * 60,
  });
}

function clearGoogleFlowCookie(c: Context, env: NodeJS.ProcessEnv): void {
  deleteCookie(c, GOOGLE_OIDC_FLOW_COOKIE, {
    path: "/auth/google/callback",
    secure: env.NODE_ENV === "production",
  });
}

function signedReturnDestination(
  returnHost: string | undefined,
  env: NodeJS.ProcessEnv,
  product: CustomerProductConfig,
): string {
  const trusted = trustedReturnHost(returnHost);
  if (trusted === "zenod.dev") return "https://zenod.dev/";
  if (trusted && product.signInToLanding && trusted === new URL(product.defaultDomain).hostname) {
    return `${product.defaultDomain.replace(/\/$/, "")}/`;
  }
  if (trusted) return `https://${trusted}/app`;
  return `${customerDestination(env, product.defaultDomain)}/app`;
}

export function createCustomerLayer(host: CustomerLayerHost, options: CustomerLayerOptions = {}) {
  const env = options.env ?? process.env;
  const product = options.product ?? { product: "zenod", unit: "zenod", defaultDomain: "https://cloud.zenod.dev" };
  const capabilities: CustomerLayerCapabilities = {
    productionReadiness: options.capabilities?.productionReadiness ?? true,
    repositoryConnection: options.capabilities?.repositoryConnection ?? true,
    managedAiApplication: options.capabilities?.managedAiApplication ?? true,
  };
  const identities = new CustomerIdentityStore(host.dataDir, product.product);
  const accounts = new CustomerAccountStore(host.dataDir, product.product, identities);
  const principalForSession = (session: CustomerSession): CustomerPrincipal => {
    const principal = identities.resolve(session.provider, session.provider_subject) ?? identities.resolveOrCreate({
      provider: session.provider,
      provider_subject: session.provider_subject,
      display_name: session.display_name,
      provider_login: session.provider === "github" ? session.login : null,
      avatar_url: session.avatar_url,
    });
    if (principal.user_id !== session.user_id) {
      throw new Error("customer session identity does not match its provider binding");
    }
    // Lazy projection keeps legacy account/session identifiers byte-for-byte
    // stable while making the new ownership join authoritative for new code.
    for (const account of accounts.list()) {
      if (account.user_id === principal.user_id) identities.bindAccount(principal.user_id, account.account_id);
    }
    return principal;
  };
  const billing = loadCustomerBillingConfig(env, product);
  assertPublicSignupIsReady(env);
  const tokenVault = new CustomerTokenVault(host.dataDir, customerStateSecret(env));
  if (env.STRIPE_SECRET_KEY) {
    const expectedMarker = billing.stripeMode === "live" ? "_live_" : "_test_";
    if (!env.STRIPE_SECRET_KEY.includes(expectedMarker)) {
      throw new Error(`STRIPE_MODE=${billing.stripeMode} requires a matching Stripe key`);
    }
  }
  const githubIdentity =
    options.identityProviders?.github ??
    options.identity ??
    (env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET
      ? new GithubIdentityProvider(
          env.GITHUB_OAUTH_CLIENT_ID,
          env.GITHUB_OAUTH_CLIENT_SECRET,
          githubCallbackUrl(env, product.defaultDomain),
        )
      : null);
  const googleIdentity =
    options.identityProviders?.google ??
    (product.product === "zenod" && env.GOOGLE_OIDC_CLIENT_ID && env.GOOGLE_OIDC_CLIENT_SECRET
      ? new GoogleOidcIdentityProvider(
          env.GOOGLE_OIDC_CLIENT_ID,
          env.GOOGLE_OIDC_CLIENT_SECRET,
          googleCallbackUrl(env, product.defaultDomain),
        )
      : null);
  const identityProviders: Partial<Record<CustomerIdentityProvider, IdentityProvider>> = {
    ...(githubIdentity ? { github: githubIdentity } : {}),
    ...(googleIdentity ? { google: googleIdentity } : {}),
  };
  const stripe =
    options.stripe ??
    (env.STRIPE_SECRET_KEY
      ? (new Stripe(env.STRIPE_SECRET_KEY, {
          appInfo: { name: `${product.product}/customer-layer`, version: "0.1.0" },
        }) as CustomerStripeClient)
      : null);
  const bindCheckout =
    options.onCheckoutCompleted ??
    createLocalTenantBindingAdapter({
      dataDir: host.dataDir,
      accounts,
      tenantStore: options.tenantStore,
      tokenVault,
    });
  const managedAiConfig = loadManagedAiConfig(env);
  const managedAiProvider =
    product.product === "zenod" && managedAiConfig.enabled && managedAiConfig.provisioningKey
      ? options.managedAiProvider ?? createOpenRouterManagedAiClient(managedAiConfig.provisioningKey)
      : null;
  const managedAi = new CustomerManagedAiLifecycle({
    accounts,
    runtimeForAccount: (account) => host.runtimeForAccount?.(account) ?? null,
    config: managedAiConfig,
    provider: managedAiProvider,
    audit: new CustomerManagedAiAuditStore(host.dataDir),
  });
  const managedAiAdmissions = new CustomerManagedAiAdmissionQueue(
    join(host.dataDir, "customer-managed-ai-admission.sqlite"),
    Date.now,
    undefined,
    options.managedAiAdmissionBeforeJournal,
  );
  const refreshCurrentTenantKeyAuthority = async (
    account: CustomerAccount,
  ): Promise<{ account: CustomerAccount; gateway: GatewayKeyUsage } | null> => {
    if (product.product !== "zenod" || managedAiProvider) return null;
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime || runtime.settings.provider() !== "openrouter") return null;
    const apiKey = runtime.settings.activeApiKey();
    if (!apiKey) return null;
    const gateway = await currentGatewayKey(apiKey);
    if (
      gateway.limit_reset !== "monthly" ||
      gateway.limit === null ||
      gateway.limit <= 0 ||
      Math.abs(gateway.limit - managedAiConfig.monthlyLimitUsd) > 1e-9
    ) {
      throw new Error("existing OpenRouter key does not match the hosted monthly allowance policy");
    }
    const now = new Date();
    const currentPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const currentPeriodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const refreshed = accounts.upsert(account.session_id, {
      managed_ai_limit_usd: gateway.limit,
      managed_ai_status: gateway.disabled ? "paused" : "active",
      managed_ai_updated_at: now.toISOString(),
      managed_ai_last_reconciled_at: now.toISOString(),
      managed_ai_error_code: null,
      ...(!account.stripe_subscription_id
        ? {
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
          }
        : {}),
    });
    return { account: refreshed, gateway };
  };
  const onCheckoutCompleted = async (account: CustomerAccount, session: Stripe.Checkout.Session) => {
    await bindCheckout(account, session);
  };
  const reconcileEntitlement = async (account: CustomerAccount | null): Promise<CustomerAccount | null> => {
    if (!account?.tenant_id || account.subscription_status === "checkout_pending" || account.subscription_status === null) {
      return account;
    }
    const entitled = account.subscription_status === "active" || account.subscription_status === "past_due";
    if (options.tenantStore) {
      await options.tenantStore.setTenantStatus(account.tenant_id, entitled ? "active" : "suspended");
    }
    const managedOutcome = await managedAi.setSubscriptionAccess(account, entitled);
    if (managedOutcome.state === "orphaned") throw new Error("managed AI child key requires operator recovery");
    const reconciled = accounts.get(account.session_id) ?? account;
    await options.onEntitlementChanged?.(reconciled, { entitled });
    return accounts.get(account.session_id) ?? reconciled;
  };
  const refreshAuthoritativeSubscription = async (
    account: CustomerAccount | null,
    subscriptionId?: string | null,
  ): Promise<CustomerAccount | null> => {
    const id = subscriptionId ?? account?.stripe_subscription_id ?? null;
    if (!id) return account;
    if (!stripe?.subscriptions) {
      if (product.product !== "zenod") return account;
      throw new Error("authoritative Stripe subscription retrieval is unavailable");
    }
    return applyCustomerSubscriptionEvent(accounts, await stripe.subscriptions.retrieve(id));
  };
  const reconcileBillingEntitlement = async (
    account: CustomerAccount | null,
    subscriptionId?: string | null,
  ): Promise<CustomerAccount | null> => reconcileEntitlement(
    await refreshAuthoritativeSubscription(account, subscriptionId),
  );
  const localUsageForAccount = async (account: CustomerAccount) => {
    if (!managedAiProvider || !account.tenant_slug) {
      try {
        const current = await refreshCurrentTenantKeyAuthority(account);
        return projectCustomerUsage(current?.gateway ?? null, managedAiConfig.warnPercent);
      } catch {
        return projectCustomerUsage(null, managedAiConfig.warnPercent);
      }
    }
    try {
      const keys = await managedAiProvider.listKeys();
      const key = account.managed_ai_key_hash
        ? keys.find((candidate) => candidate.hash === account.managed_ai_key_hash) ?? null
        : keys.find((candidate) => candidate.slug === account.tenant_slug) ?? null;
      return projectCustomerUsage(
        key,
        managedAiConfig.warnPercent,
      );
    } catch {
      return projectCustomerUsage(null, managedAiConfig.warnPercent);
    }
  };
  const usageForAccount = async (account: CustomerAccount) => {
    const local = await localUsageForAccount(account);
    const refreshedAccount = accounts.get(account.session_id) ?? account;
    return options.projectUsage ? options.projectUsage(refreshedAccount, local) : local;
  };
  const reconcileManagedAiAccounts = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const account of accounts.list()) {
      if (!account.tenant_id || account.subscription_status === null || account.subscription_status === "checkout_pending") {
        continue;
      }
      try {
        const authoritative = account.stripe_subscription_id && stripe?.subscriptions
          ? await refreshAuthoritativeSubscription(account)
          : account;
        await reconcileEntitlement(authoritative);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "managed AI periodic reconciliation failed");
  };
  const refreshAuthoritativeSubscriptions = async (): Promise<{
    refreshedAccountIds: string[];
    failedAccountIds: string[];
  }> => {
    const refreshedAccountIds: string[] = [];
    const failedAccountIds: string[] = [];
    for (const account of accounts.list()) {
      if (
        !account.tenant_id ||
        account.subscription_status === null ||
        account.subscription_status === "checkout_pending"
      ) continue;
      if (!account.stripe_subscription_id) {
        try {
          const refreshed = await refreshCurrentTenantKeyAuthority(account);
          if (refreshed) refreshedAccountIds.push(account.account_id);
          else failedAccountIds.push(account.account_id);
        } catch {
          failedAccountIds.push(account.account_id);
        }
        continue;
      }
      if (!stripe?.subscriptions) {
        failedAccountIds.push(account.account_id);
        continue;
      }
      try {
        await refreshAuthoritativeSubscription(account);
        refreshedAccountIds.push(account.account_id);
      } catch {
        failedAccountIds.push(account.account_id);
      }
    }
    return { refreshedAccountIds, failedAccountIds };
  };
  const reconcileIntervalRaw = Number(env.ZENOD_MANAGED_AI_RECONCILE_INTERVAL_MS);
  const reconcileIntervalMs = Number.isFinite(reconcileIntervalRaw) && reconcileIntervalRaw > 0
    ? reconcileIntervalRaw
    : 5 * 60_000;
  const reconcileTimer = managedAiProvider
    ? setInterval(() => {
        void reconcileManagedAiAccounts().catch((error) => {
          console.error("[managed-ai] periodic reconciliation failed:", error);
        });
      }, reconcileIntervalMs)
    : null;
  reconcileTimer?.unref?.();
  const app = new Hono<{ Bindings: HttpBindings }>();

  if (capabilities.productionReadiness) {
    app.get("/api/public/production-readiness", (c) => {
      const report = productionReadinessReport(env);
      return c.json(report, report.ready ? 200 : 503);
    });
  }

  const startIdentityFlow = (
    c: Context,
    provider: CustomerIdentityProvider,
    mode: "signin" | "link_identity",
  ) => {
    const identity = identityProviders[provider];
    const stateSecret = customerStateSecret(env);
    if (!identity || !stateSecret) return c.text("Sign-in is not configured.", 503);
    const session = mode === "link_identity" ? readCustomerSession(c, env) : null;
    if (mode === "link_identity" && !session) return c.json({ error: "unauthorized" }, 401);
    if (session) principalForSession(session);
    const requestedHost = trustedReturnHost(c.req.header("x-forwarded-host") || c.req.header("host"));
    const flow = randomBytes(24).toString("base64url");
    const statePayload: StatePayload = {
      mode,
      provider,
      flow,
      ...(mode === "signin" && requestedHost ? { rh: requestedHost } : {}),
      ...(session ? { uid: session.user_id } : {}),
    };
    const state = signState(statePayload, stateSecret);
    if (provider === "google") {
      const nonce = randomBytes(24).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      setGoogleFlowCookie(c, signState({ ...statePayload, nonce, verifier }, stateSecret), env);
      return c.redirect(identity.authorizeUrl(state, {
        nonce,
        codeChallenge: pkceChallenge(verifier),
      }), 302);
    }
    return c.redirect(identity.authorizeUrl(state), 302);
  };

  const completeIdentityFlow = async (c: Context, provider: CustomerIdentityProvider) => {
    const identity = identityProviders[provider];
    if (!identity) return c.text("Sign-in is not configured.", 503);
    const code = c.req.query("code") ?? "";
    const state = verifyState(c.req.query("state") ?? "", customerStateSecret(env));
    const legacyGithubSignin = provider === "github" && state?.mode === "signin" && !state.provider && !state.flow;
    if (
      !code ||
      !state ||
      (state.mode !== "signin" && state.mode !== "link_identity") ||
      (!legacyGithubSignin && (state.provider !== provider || !state.flow))
    ) {
      return c.text("Invalid or expired sign-in. Please retry.", 400);
    }
    let nonce: string | undefined;
    let codeVerifier: string | undefined;
    if (provider === "google") {
      const proof = verifyState(getCookie(c, GOOGLE_OIDC_FLOW_COOKIE) ?? "", customerStateSecret(env));
      clearGoogleFlowCookie(c, env);
      if (
        !proof ||
        proof.provider !== provider ||
        proof.mode !== state.mode ||
        proof.flow !== state.flow ||
        proof.uid !== state.uid ||
        !proof.nonce ||
        !proof.verifier
      ) {
        return c.text("Invalid or expired Google sign-in. Please retry.", 400);
      }
      nonce = proof.nonce;
      codeVerifier = proof.verifier;
    }
    const currentSession = state.mode === "link_identity" ? readCustomerSession(c, env) : null;
    if (state.mode === "link_identity" && (!currentSession || currentSession.user_id !== state.uid)) {
      return c.text("An authenticated session is required to link this identity.", 401);
    }
    if (currentSession) {
      try {
        principalForSession(currentSession);
      } catch {
        return c.text("An authenticated session is required to link this identity.", 401);
      }
    }
    try {
      const user = await identity.exchangeAndGetUser(code, { nonce, codeVerifier });
      const providerSubject = provider === "github"
        ? String(typeof user.id === "number" ? user.id : Number(user.id))
        : String(user.id).trim();
      if (
        !providerSubject ||
        (provider === "github" && (!/^\d+$/.test(providerSubject) || Number(providerSubject) <= 0))
      ) {
        throw new Error(`${provider} returned an invalid user id`);
      }
      const identityInput = {
        provider,
        provider_subject: providerSubject,
        display_name: user.login,
        provider_login: provider === "github" ? user.login : null,
        avatar_url: user.avatar_url ?? (provider === "github" ? `https://github.com/${user.login}.png` : null),
        // Preserve GitHub's established metadata behavior. Google email is an
        // attribute only after the OIDC token marks it verified.
        email: provider === "google" && user.email_verified !== true ? null : user.email,
        email_verified: user.email_verified === true,
      };
      if (state.mode === "link_identity") {
        identities.linkIdentity(currentSession!.user_id, identityInput);
        return c.redirect(`${customerDestination(env, product.defaultDomain)}/app/account?identity=${provider}-linked`, 302);
      }
      const principal = identities.resolveOrCreate(identityInput);
      issueCustomerSession(c, principal, env);
      return c.redirect(signedReturnDestination(state.rh, env, product), 302);
    } catch (error) {
      console.error(`${provider} callback failed:`, error);
      const collision = error instanceof Error && error.message.includes("already linked to another user");
      return c.text(
        collision
          ? "This sign-in identity is already linked to another Zenod account."
          : `Could not complete ${provider === "google" ? "Google" : "GitHub"} sign-in. Please retry.`,
        collision ? 409 : 502,
      );
    }
  };

  // Preserve the established GitHub entry point while exposing provider-specific starts.
  app.get("/auth/signin", (c) => startIdentityFlow(c, "github", "signin"));
  app.get("/auth/github/start", (c) => startIdentityFlow(c, "github", "signin"));
  app.get("/auth/google/start", (c) => startIdentityFlow(c, "google", "signin"));
  app.get("/auth/github/callback", (c) => completeIdentityFlow(c, "github"));
  app.get("/auth/google/callback", (c) => completeIdentityFlow(c, "google"));

  app.get("/api/auth/providers/:provider/link", (c) => {
    const provider = c.req.param("provider");
    if (provider !== "github" && provider !== "google") return c.json({ error: "unknown identity provider" }, 404);
    return startIdentityFlow(c, provider, "link_identity");
  });

  app.delete("/api/auth/providers/:provider", (c) => {
    const provider = c.req.param("provider");
    if (provider !== "github" && provider !== "google") return c.json({ error: "unknown identity provider" }, 404);
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    principalForSession(session);
    try {
      const remaining = identities.unlinkIdentity(session.user_id, provider);
      issueCustomerSession(c, remaining, env);
      return c.json({ ok: true, providers: identities.providersForUser(session.user_id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not unlink identity";
      return c.json({ error: message }, message.includes("last sign-in identity") ? 409 : 404);
    }
  });

  app.post("/auth/signout", (c) => {
    clearCustomerSession(c, env);
    return c.json({ ok: true });
  });
  app.get("/auth/signout", (c) => {
    clearCustomerSession(c, env);
    return c.redirect("/");
  });

  app.get("/api/me", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const principal = principalForSession(session);
    return c.json({
      user_id: principal.user_id,
      provider: principal.provider,
      providers: identities.providersForUser(principal.user_id),
      display_name: principal.display_name,
      login: principal.provider === "github" ? principal.github_login ?? session.login : principal.display_name,
      avatar_url: principal?.avatar_url ?? session.avatar_url,
    });
  });

  app.get("/api/auth/status", (c) =>
    c.json({
      needsSetup: false,
      configured: Object.keys(identityProviders).length > 0,
      customerAuth: true,
      authMethod: githubIdentity ? "github" : "google",
      signInMethods: [
        ...(githubIdentity ? ["github"] : []),
        ...(googleIdentity ? ["google"] : []),
      ],
    }),
  );
  app.all("/api/auth/login", (c) => c.json({ error: "not found" }, 404));
  app.all("/api/auth/setup", (c) => c.json({ error: "not found" }, 404));
  app.post("/api/auth/logout", (c) => {
    clearCustomerSession(c, env);
    return c.json({ ok: true });
  });
  app.all("/api/auth/logout", (c) => c.json({ error: "not found" }, 404));

  if (capabilities.repositoryConnection) {
    app.get("/api/github/app/start", (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const principal = principalForSession(session);
      if (!principal?.github_id || !principal.github_login) {
        return c.json({ error: "GitHub identity is not connected" }, 409);
      }
      const account = accounts.resolveActiveTenantForUser(session.user_id);
      if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
      const sharedApp = host.sharedGithubApp;
      if (!sharedApp) return c.json({ error: "GitHub repository connection is not configured" }, 503);
      const state = signState(
        { mode: "connect_repo", uid: session.user_id, gid: principal.github_id, login: principal.github_login },
        customerStateSecret(env),
      );
      return c.json({
        url: `https://github.com/apps/${encodeURIComponent(sharedApp.slug)}/installations/new?state=${encodeURIComponent(state)}`,
      });
    });

    // The existing Zenod Memory GitHub App is configured to return here after the
    // customer grants it access to their brain repository.
    app.get("/github/setup", (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.redirect("/auth/signin", 302);
      const principal = principalForSession(session);
      if (!principal?.github_id) return c.text("A connected GitHub identity is required.", 409);
      const stateRaw = c.req.query("state") ?? "";
      const state = stateRaw ? verifyState(stateRaw, customerStateSecret(env)) : null;
      if (state?.mode !== "connect_repo" || (state.uid ? state.uid !== session.user_id : state.gid !== principal.github_id)) {
        return c.text("This repository connection link is invalid or expired.", 400);
      }
      const installationId = c.req.query("installation_id");
      if (!installationId || !/^\d+$/.test(installationId)) return c.redirect("/app", 302);
      const account = accounts.resolveActiveTenantForUser(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      if (!account?.tenant_id || !runtime) return c.text("Tenant runtime is unavailable.", 409);
      runtime.settings.setRaw("github_app_installation_id", installationId);
      runtime.invalidate();
      return c.redirect("/app?github=connected", 302);
    });

    app.put("/api/vault/repository", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const account = accounts.resolveActiveTenantForUser(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      if (!account?.tenant_id || !runtime) return c.json({ error: "tenant unavailable" }, 409);
      const body = await c.req
        .json<{ repo?: string; branch?: string }>()
        .catch((): { repo?: string; branch?: string } => ({}));
      const repo = body.repo?.trim() ?? "";
      const branch = body.branch?.trim() || "main";
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return c.json({ error: "invalid repository" }, 400);
      runtime.settings.set("vault_repo", repo);
      runtime.settings.set("vault_branch", branch);
      runtime.invalidate();
      accounts.upsert(account.session_id, {
        vault_repo: repo,
        vault_repo_url: `https://github.com/${repo}`,
      });
      return c.json({ repo, branch });
    });
  }

  app.get("/api/console/account", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveForUser(session.user_id);
    if (!account || account.subscription_status === "checkout_pending") {
      return c.json({ error: "no_account" }, 404);
    }
    const token = account ? tokenVault.get(account.account_id) : null;
    const tenantRecord = token ? await options.tenantStore?.resolveTokenHash(hashToken(token)) : null;
    const hasAccess = Boolean(
      account.tenant_id &&
        token &&
        tenantRecord &&
        tenantRecord.tenant.id === account.tenant_id &&
        (tenantRecord.status ?? "active") === "active" &&
        (account.subscription_status === "active" || account.subscription_status === "past_due"),
    );
    const runtime = hasAccess ? host.runtimeForAccount?.(account) ?? null : null;
    const usage = await usageForAccount(account);
    return c.json({
      account_id: account.account_id,
      tier: account.tier,
      subscription_status: account.subscription_status,
      cancel_at_period_end: account.cancel_at_period_end,
      current_period_end: account.current_period_end,
      tenant_id: account.tenant_id,
      slug: account.tenant_slug,
      mcp_url: hasAccess && token ? `${billing.domain}/mcp/${token}` : null,
      token: hasAccess ? token : null,
      token_hint: hasAccess && token ? token.slice(-4) : null,
      vault_repo: account.vault_repo ?? runtime?.settings.get("vault_repo") ?? null,
      vault_repo_url: account.vault_repo_url,
      usage,
    });
  });

  if (capabilities.managedAiApplication) {
    app.get("/api/customer-usage", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const account = accounts.resolveActiveTenantForUser(session.user_id);
      if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
      return c.json(await usageForAccount(account));
    });

    app.get("/api/customer-managed-ai/jobs/:id", async (c, next) => {
      const session = readCustomerSession(c, env);
      // Bearer-authenticated channel/MCP callers are resolved by the Zenod unit,
      // which owns the tenant token store. Cookie customers stay on this seam.
      if (!session) return next();
      const account = accounts.resolveActiveTenantForUser(session.user_id);
      if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
      const job = managedAiAdmissions.getForTenant(c.req.param("id"), account.tenant_id);
      return job ? c.json({ job }) : c.json({ error: "job not found" }, 404);
    });
  }

  app.post("/api/token/regenerate", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
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
    const principal = principalForSession(owner);
    if (!checkoutEnabledForOwner(principal, env)) {
      return c.json({ error: "paid signup is not open" }, 503);
    }
    const existing = accounts.resolveForUser(owner.user_id);
    if (existing?.subscription_status === "active" || existing?.subscription_status === "past_due") {
      return c.json({ error: "an active subscription already exists" }, 409);
    }
    if (!stripe) return c.json({ error: "checkout is not configured" }, 503);
    const resolved = resolveCheckoutTier(tierInput, billing, newCheckoutPolicyForProduct(product));
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);
    const accountId = existing?.account_id ?? customerAccountIdForUser(principal);
    identities.bindAccount(principal.user_id, accountId);
    const session = await createCustomerCheckout(stripe, accounts, billing, {
      user_id: principal.user_id,
      display_name: principal.display_name,
      account_id: accountId,
      github_id: principal.github_id,
      github_login: principal.github_login,
      email: principal.email,
    }, resolved, product);
    return c.json({ id: session.id, url: session.url, product: product.product, tier: resolved.tier });
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

  app.post("/api/billing/portal", async (c) => {
    const owner = readCustomerSession(c, env);
    if (!owner) return c.json({ error: "unauthorized" }, 401);
    if (!stripe) return c.json({ error: "billing is not configured" }, 503);
    const account = accounts.resolveForUser(owner.user_id);
    if (!account?.stripe_customer_id) return c.json({ error: "billing account unavailable" }, 409);
    try {
      return c.json({ url: await createCustomerPortalSession(stripe, billing, account) });
    } catch (error) {
      console.error("billing portal session failed:", error);
      return c.json({ error: "billing portal unavailable" }, 503);
    }
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
    const principal = principalForSession(owner);
    const pendingAccount = accounts.get(sessionId);
    if (
      !pendingAccount ||
      identities.ownerForAccount(pendingAccount.account_id) !== principal.user_id ||
      session.client_reference_id !== pendingAccount.account_id
    ) {
      return c.text("Checkout account binding mismatch.", 403);
    }
    if (session.payment_status !== "paid" && session.status !== "complete") {
      return c.text("Checkout is not complete.", 409);
    }
    await completeCustomerCheckout(session, accounts, onCheckoutCompleted, product.product);
    const subscriptionId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
    await reconcileBillingEntitlement(accounts.get(session.id), subscriptionId);
    return c.redirect(`${customerDestination(env, product.defaultDomain)}/app`, 303);
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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = await completeCustomerCheckout(
        session,
        accounts,
        onCheckoutCompleted,
        product.product,
      );
      const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
      await reconcileBillingEntitlement(accounts.get(session.id), subscriptionId);
      return c.json({ received: true, result });
    }
    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const delivered = event.data.object as Stripe.Subscription;
      const existing = accounts.resolveForSubscription(delivered.id) ??
        accounts.resolveForAccountId(delivered.metadata.account_id ?? "");
      const account = !stripe.subscriptions && product.product !== "zenod"
        ? applyCustomerSubscriptionEvent(accounts, delivered)
        : await refreshAuthoritativeSubscription(existing, delivered.id);
      await reconcileEntitlement(account);
      return c.json({ received: true, result: account ? account.subscription_status : "unmatched" });
    }
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id;
      const account = subscriptionId && (!stripe.subscriptions && product.product !== "zenod")
        ? applyCustomerInvoiceEvent(accounts, invoice, event.type === "invoice.paid")
        : subscriptionId
          ? await refreshAuthoritativeSubscription(accounts.resolveForSubscription(subscriptionId), subscriptionId)
          : null;
      await reconcileEntitlement(account);
      return c.json({ received: true, result: account ? account.subscription_status : "unmatched" });
    }
    return c.json({ received: true, result: "ignored" });
  });

  return {
    app,
    accounts,
    identities,
    principalForSession,
    tokenVault,
    managedAi,
    usageForAccount,
    managedAiAdmissions,
    reconcileEntitlement,
    reconcileManagedAiAccounts,
    refreshAuthoritativeSubscriptions,
    close() {
      if (reconcileTimer) clearInterval(reconcileTimer);
      managedAiAdmissions.close();
      managedAi.close();
    },
  };
}
