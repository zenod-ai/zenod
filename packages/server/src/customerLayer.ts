import Stripe from "stripe";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { stream } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { tenantAllowanceEnforcedFromEnv, tenantMonthlyAllowanceFromEnv } from "./settings.js";
import type { Runtime } from "./runtime.js";
import { McpTokenStore, type McpTokenRecord } from "./mcpTokens.js";
import { CustomerAccountStore, customerAccountIdForUser, customerVaultBinding, type CustomerAccount } from "./customerAccounts.js";
import {
  completeCustomerCheckout,
  createCustomerCheckout,
  createCustomerPortalSession,
  findActivePromotionCode,
  applyCustomerInvoiceEvent,
  applyCustomerSubscriptionEvent,
  invoiceSubscriptionId,
  loadCustomerBillingConfig,
  newCheckoutPolicyForProduct,
  resolveCheckoutTier,
  type CheckoutInvite,
  type CustomerStripeClient,
  type CustomerProductConfig,
} from "./customerBilling.js";
import {
  JOIN_PATH,
  WELCOME_PATH,
  joinPage,
  joinPath,
  joinProblemPage,
  joinReturnPath,
  normalizeInviteCode,
  welcomePage,
} from "./testerInvite.js";
import {
  CustomerIdentityStore,
  GoogleOidcIdentityProvider,
  GithubIdentityProvider,
  customerUserId,
  signState,
  verifyState,
  type CustomerPrincipal,
  type IdentityProvider,
  type StatePayload,
} from "./customerIdentity.js";
import type { CustomerIdentityProvider } from "./googleDriveVaultContract.js";
import { projectVaultCapabilities } from "./googleDriveVaultContract.js";
import {
  nextUtcMonthlyReset,
  projectLedgerUsage,
  projectCustomerUsage,
  type CustomerUsageProjection,
} from "./customerMetering.js";
import {
  clearCustomerSession,
  issueCustomerSession,
  readCustomerSession,
  type CustomerSession,
} from "./customerSession.js";
import { createLocalTenantBindingAdapter } from "./customerTenantBinding.js";
import { CustomerTokenVault } from "./customerTokenVault.js";
import { cleanupLegacyManagedAi } from "./legacyManagedAiCleanup.js";
import { hashToken, type TenantTokenRecord } from "@zenod/mcp-chassis";
import type { SharedGithubApp } from "./sharedGithubApp.js";
import { RECENT_SAVES_DEFAULT_LIMIT, recentSaves } from "./recentSaves.js";
import { rankMemories, RANKED_MEMORY_DEFAULT_LIMIT } from "./rankedMemory.js";
/** Nodes per graph view (E12-S2): what the app draws legibly; core caps a request at 120. */
const MEMORY_GRAPH_LIMIT = 21;
/** A lit answer (E12-S13): up to 12 memories, the pages between them and their parents. */
const MEMORY_GRAPH_LIT_LIMIT = 24;
const MEMORY_GRAPH_LIT_MAX = 12;
import { projectCapture, projectRecentSave } from "./recentSaves.js";
import {
  answerFromMemory,
  isMemoryKeepJobKey,
  isVoiceNoteJobKey,
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MAX_SECONDS,
  voiceNoteIdempotencyKey,
  voiceNoteIngestInput,
  voiceNoteMediaType,
  streamAnswerFromMemory,
  MEMORY_CHAT_MAX_QUESTION_CHARS,
  memoryKeepContent,
  memoryKeepIdempotencyKey,
  parseMemoryKeep,
  routeSendMessage,
  appSendRoute,
  isFollowUp,
} from "./memoryChat.js";
import { ConsoleMemoryTreeCache } from "./consoleMemoryTree.js";
import { readAsLine } from "./quickIndexRead.js";
import { parseTalkRequest, streamTalk, talkPersona } from "./memoryTalk.js";
import { parseModeSwitch, recordModeSwitch } from "./modeSwitches.js";
import { memoryGlance, MemoryGlanceCache } from "./memoryGlance.js";
import { registerInboxRoutes } from "./inboxRoutes.js";
import { transcribeAudio } from "./transcribe.js";
import { registerPersonaRoutes } from "./personaRoutes.js";
import { registerMemoryCallRoutes } from "./memoryCallRoutes.js";
import { CALL_BASE_ENV, callKey, callMeterFor, callsFor, openAiMinter, OPENAI_BASE_URL, platformMeter } from "./memoryCall.js";
import { inboxFor } from "./inboxStore.js";
import { DeskLimitError, startDeskJob } from "./memoryDesk.js";
import { usageView, withFeature } from "./limits.js";
import {
  checkoutEnabledForOwner,
  checkoutOwnerAllowlisted,
  productionReadinessReport,
  reportPublicSignupReadiness,
} from "./productionReadiness.js";
import { opsAlert } from "./opsAlert.js";

// Customer HTTP layer transplanted from zenod-ai/cloud services/webhook/src/server.ts
// and services/console/src/api.ts @ 6bdb318.

export interface CustomerBillingNotice {
  kind: "payment_past_due" | "access_suspended";
  /** Stable per account, kind and billing period, so retried webhooks send one notice. */
  operationId: string;
  consoleUrl: string;
}

export interface CustomerLayerOptions {
  env?: NodeJS.ProcessEnv;
  /** Legacy test/integration seam for the GitHub identity provider. */
  identity?: IdentityProvider;
  /** Provider-neutral sign-in seams. Explicit providers override env-backed defaults. */
  identityProviders?: Partial<Record<CustomerIdentityProvider, IdentityProvider>>;
  stripe?: CustomerStripeClient;
  tenantStore?: import("@zenod/mcp-chassis").TenantProvisioningStore;
  onCheckoutCompleted?: (account: CustomerAccount, session: Stripe.Checkout.Session) => Promise<void> | void;
  /**
   * EPIC-26 T2: after the tenant bind succeeded, hand the account and the buyer's email to
   * the welcome email. Called on both completion paths; the receiver keeps it to one mail.
   * Its errors never fail a checkout.
   */
  onCheckoutWelcome?: (account: CustomerAccount, email: string | null) => Promise<void> | void;
  /** Product-owned sidecar lifecycle; it must durably record desired state before returning. */
  onEntitlementChanged?: (
    account: CustomerAccount,
    input: { entitled: boolean },
  ) => Promise<void> | void;
  /**
   * Product-owned user notice for a billing lapse (EPIC-7 T2.1): once when a subscription first turns
   * past_due (it stays entitled while Stripe retries), and once more, before local and sidecar suspension,
   * when it stops being entitled. Best effort: a failed notice never blocks billing reconciliation.
   */
  onBillingNotice?: (account: CustomerAccount, notice: CustomerBillingNotice) => Promise<void> | void;
  /** Product-owned composition of the local usage projection with an independent service. */
  projectUsage?: (
    account: CustomerAccount,
    local: CustomerUsageProjection,
  ) => Promise<CustomerUsageProjection> | CustomerUsageProjection;
  /** Product-owned Google Drive consent adapter; omitted by units that do not own Drive vaults. */
  driveVaultOAuth?: {
    authorizationUrl(input: {
      clientId: string;
      redirectUri: string;
      state: string;
      mode: "hosted-managed";
      codeChallenge: string;
    }): string;
    exchangeCode(input: {
      clientId: string;
      clientSecret: string;
      code: string;
      redirectUri: string;
      codeVerifier: string;
    }): Promise<{ refreshToken: string; email: string | null }>;
  };
  product?: CustomerProductConfig;
  /**
   * Optional route capabilities for product-specific customer surfaces.
   *
   * The shared customer layer defaults to the existing Zenod surface. Products
   * that reuse only its account/auth/checkout core must explicitly turn off
   * application capabilities they do not own.
   */
  capabilities?: Partial<CustomerLayerCapabilities>;
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

type DriveVaultCallbackError =
  | "drive_denied"
  | "drive_expired"
  | "drive_session"
  | "drive_tenant"
  | "drive_config"
  | "drive_exchange"
  | "drive_bootstrap";

function driveVaultCallbackFailure(c: Context, env: NodeJS.ProcessEnv, product: CustomerProductConfig, error: DriveVaultCallbackError) {
  const destination = new URL("/app", `${customerDestination(env, product.defaultDomain)}/`);
  destination.searchParams.set("vault", error);
  destination.hash = "vault";
  clearGoogleDriveVaultFlowCookie(c, env);
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(destination.toString(), 303);
}

function customerMutationOriginAllowed(
  c: Context,
  env: NodeJS.ProcessEnv,
  product: CustomerProductConfig,
): boolean {
  const source = c.req.header("origin") || c.req.header("referer");
  if (!source) return false;
  try {
    const origin = new URL(source).origin;
    return new Set([
      new URL(customerDestination(env, product.defaultDomain)).origin,
      new URL(product.defaultDomain).origin,
    ]).has(origin);
  } catch {
    return false;
  }
}

function githubCallbackUrl(env: NodeJS.ProcessEnv, defaultDomain?: string): string {
  return env.GITHUB_OAUTH_CALLBACK_URL || `${customerDestination(env, defaultDomain)}/auth/github/callback`;
}

function googleCallbackUrl(env: NodeJS.ProcessEnv, defaultDomain?: string): string {
  return env.GOOGLE_OIDC_CALLBACK_URL || `${customerDestination(env, defaultDomain)}/auth/google/callback`;
}

function googleDriveVaultCallbackUrl(env: NodeJS.ProcessEnv, defaultDomain?: string): string {
  return env.GOOGLE_DRIVE_VAULT_OAUTH_CALLBACK_URL ||
    `${customerDestination(env, defaultDomain)}/api/vault/drive/oauth/callback`;
}

const GOOGLE_OIDC_FLOW_COOKIE = "zenod_google_oidc_flow";
const GOOGLE_DRIVE_VAULT_FLOW_COOKIE = "zenod_google_drive_vault_flow";
const GOOGLE_DRIVE_VAULT_FLOW_SETTING = "google_drive_vault_oauth_flow";

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

function setGoogleDriveVaultFlowCookie(c: Context, proof: string, env: NodeJS.ProcessEnv): void {
  setCookie(c, GOOGLE_DRIVE_VAULT_FLOW_COOKIE, proof, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/vault/drive/oauth/callback",
    maxAge: 10 * 60,
  });
}

function clearGoogleDriveVaultFlowCookie(c: Context, env: NodeJS.ProcessEnv): void {
  deleteCookie(c, GOOGLE_DRIVE_VAULT_FLOW_COOKIE, {
    path: "/api/vault/drive/oauth/callback",
    secure: env.NODE_ENV === "production",
  });
}

function mcpConsentReturnPath(value: string | undefined): string | null {
  if (!value || !value.startsWith("/oauth/authorize") || /[\\\r\n]/.test(value)) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" && url.pathname === "/oauth/authorize" && !url.hash
      ? `${url.pathname}${url.search}`
      : null;
  } catch {
    return null;
  }
}

/** Where a sign-in may return to: an MCP consent request, or a tester invite link (EPIC-26 T1). */
function signInReturnPath(value: string | undefined): string | null {
  return mcpConsentReturnPath(value) ?? joinReturnPath(value);
}

const MCP_SIGNIN_COOKIE = "zenod_mcp_signin";

function mcpSignInCookieOptions(env: NodeJS.ProcessEnv) {
  const domain = env.ZC_COOKIE_DOMAIN || (env.NODE_ENV === "production" ? ".zenod.dev" : undefined);
  return { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "Lax" as const, path: "/auth", ...(domain ? { domain } : {}) };
}

export const SIGNUP_MARKER_PARAM = "signed_up";

export function withSignupMarker(destination: string): string {
  const url = new URL(destination);
  url.searchParams.set(SIGNUP_MARKER_PARAM, "1");
  return url.toString();
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
  const resolveActiveVaultAccount = (userId: string): CustomerAccount | null => {
    const active = accounts.resolveActiveTenantForUser(userId);
    if (!active?.tenant_id) return active;
    const authority = accounts.resolveVaultAuthorityForTenantId(active.tenant_id);
    return authority?.binding ? authority.account : active;
  };
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
  reportPublicSignupReadiness(env);
  const tokenVault = new CustomerTokenVault(host.dataDir, customerStateSecret(env));
  const mcpTokens = new McpTokenStore(host.dataDir, customerStateSecret(env));
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
  // Platform-key mode (D30): one host OpenRouter key serves every tenant, so there is no per-tenant key to
  // police and usage comes from each tenant's own ledger against its AI allowance.
  const platformKeyMode = product.product === "zenod" && Boolean(env.ZENOD_PLATFORM_OPENROUTER_KEY?.trim());
  const tenantAllowanceUsd = tenantMonthlyAllowanceFromEnv(env);
  const tenantAllowanceEnforced = tenantAllowanceEnforcedFromEnv(env);
  /** Non-Stripe accounts follow the current UTC month as their billing window (comped accounts use a fixed one in Phylax). */
  const refreshNonStripePeriod = (account: CustomerAccount): CustomerAccount => {
    if (account.stripe_subscription_id) return account;
    const now = new Date();
    return accounts.upsert(account.session_id, {
      current_period_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      current_period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    });
  };
  const onCheckoutCompleted = async (account: CustomerAccount, session: Stripe.Checkout.Session) => {
    await bindCheckout(account, session);
    if (!options.onCheckoutWelcome) return;
    try {
      await options.onCheckoutWelcome(
        account,
        session.customer_details?.email ?? session.customer_email ?? account.github_email ?? null,
      );
    } catch (error) {
      console.warn("[welcome] could not queue the welcome email:", error instanceof Error ? error.message : "error");
    }
  };
  const isEntitledStatus = (status: CustomerAccount["subscription_status"]) =>
    status === "active" || status === "past_due";
  const reconcileEntitlement = async (account: CustomerAccount | null): Promise<CustomerAccount | null> => {
    if (!account?.tenant_id || account.subscription_status === "checkout_pending" || account.subscription_status === null) {
      return account;
    }
    const entitled = isEntitledStatus(account.subscription_status);
    if (options.tenantStore) {
      await options.tenantStore.setTenantStatus(account.tenant_id, entitled ? "active" : "suspended");
    }
    await options.onEntitlementChanged?.(account, { entitled });
    return accounts.get(account.session_id) ?? account;
  };
  const sendBillingNotice = async (
    previousStatus: CustomerAccount["subscription_status"],
    account: CustomerAccount | null,
  ): Promise<void> => {
    if (!options.onBillingNotice || !account?.tenant_id || !isEntitledStatus(previousStatus)) return;
    const kind = !isEntitledStatus(account.subscription_status)
      ? "access_suspended"
      : previousStatus === "active" && account.subscription_status === "past_due"
        ? "payment_past_due"
        : null;
    if (!kind) return;
    const period = account.current_period_end ? Date.parse(account.current_period_end) / 1000 : 0;
    try {
      await options.onBillingNotice(account, {
        kind,
        operationId: `billing-notice:${kind}:${account.account_id}:${period}`.slice(0, 160),
        consoleUrl: `${customerDestination(env, product.defaultDomain)}/app`,
      });
    } catch (error) {
      console.error(`[customer] ${kind} notice failed for account ${account.account_id}:`, error);
    }
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
    const previousStatus = account?.subscription_status ?? null;
    const refreshed = applyCustomerSubscriptionEvent(
      accounts,
      await stripe.subscriptions.retrieve(id, { expand: ["discounts"] }),
    );
    await sendBillingNotice(previousStatus, refreshed);
    return refreshed;
  };
  const reconcileBillingEntitlement = async (
    account: CustomerAccount | null,
    subscriptionId?: string | null,
  ): Promise<CustomerAccount | null> => reconcileEntitlement(
    await refreshAuthoritativeSubscription(account, subscriptionId),
  );
  const localUsageForAccount = async (account: CustomerAccount) => {
    if (!platformKeyMode) {
      // Self-hosted or no platform key: there is no per-tenant provider authority to read.
      return projectCustomerUsage(null);
    }
    const runtime = host.runtimeForAccount?.(account) ?? null;
    let spend: number | null = null;
    try {
      spend = runtime ? runtime.monthToDateSpendUsd() : null;
    } catch {
      spend = null;
    }
    return projectLedgerUsage(spend, tenantAllowanceUsd, undefined, undefined, tenantAllowanceEnforced);
  };
  const usageForAccount = async (account: CustomerAccount) => {
    const local = await localUsageForAccount(account);
    const refreshedAccount = accounts.get(account.session_id) ?? account;
    return options.projectUsage ? options.projectUsage(refreshedAccount, local) : local;
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
          refreshNonStripePeriod(account);
          refreshedAccountIds.push(account.account_id);
        } catch (error) {
          console.error(`[customer] period refresh failed for account ${account.account_id}:`, error);
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
    response: "redirect" | "json" = "redirect",
  ) => {
    const identity = identityProviders[provider];
    const stateSecret = customerStateSecret(env);
    if (!identity || !stateSecret) {
      opsAlert("signin", "not_configured", { provider });
      return c.text("Sign-in is not configured.", 503);
    }
    const session = mode === "link_identity" ? readCustomerSession(c, env) : null;
    if (mode === "link_identity" && !session) return c.json({ error: "unauthorized" }, 401);
    if (session) principalForSession(session);
    const requestedHost = trustedReturnHost(c.req.header("x-forwarded-host") || c.req.header("host"));
    const returnTo = mode === "signin" ? signInReturnPath(c.req.query("return_to")) : null;
    const browserNonce = returnTo ? randomBytes(32).toString("base64url") : undefined;
    if (browserNonce) setCookie(c, MCP_SIGNIN_COOKIE, browserNonce, { ...mcpSignInCookieOptions(env), maxAge: 600 });
    const flow = randomBytes(24).toString("base64url");
    const statePayload: StatePayload = {
      mode,
      provider,
      flow,
      ...(returnTo ? { rt: returnTo, browserNonce } : {}),
      ...(mode === "signin" && requestedHost ? { rh: requestedHost } : {}),
      ...(session ? { uid: session.user_id } : {}),
    };
    const state = signState(statePayload, stateSecret);
    if (provider === "google") {
      const nonce = randomBytes(24).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      setGoogleFlowCookie(c, signState({ ...statePayload, nonce, verifier }, stateSecret), env);
      const url = identity.authorizeUrl(state, {
        nonce,
        codeChallenge: pkceChallenge(verifier),
      });
      return response === "json" ? c.json({ url }) : c.redirect(url, 302);
    }
    const url = identity.authorizeUrl(state);
    return response === "json" ? c.json({ url }) : c.redirect(url, 302);
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
      // A request with no code is a bot or a stray click, not a person's failed sign-in (EPIC-24 M2).
      if (code) opsAlert("signin", "invalid_state", { provider });
      return c.text("Invalid or expired sign-in. Please retry.", 400);
    }
    if (state.rt) {
      const expected = Buffer.from(state.browserNonce ?? "");
      const actual = Buffer.from(getCookie(c, MCP_SIGNIN_COOKIE) ?? "");
      if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        opsAlert("signin", "other_browser", { provider });
        return c.text(
          joinReturnPath(state.rt)
            ? "This sign-in was started in another browser or has expired. Open your invite link again in this browser."
            : "This sign-in was started in another browser or has expired. Reopen the connection from your agent.",
          400,
        );
      }
      deleteCookie(c, MCP_SIGNIN_COOKIE, mcpSignInCookieOptions(env));
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
        opsAlert("signin", "google_flow_expired", { provider });
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
      const githubId = provider === "github"
        ? typeof user.id === "number" ? user.id : Number(user.id)
        : null;
      if (provider === "github" && (githubId === null || !Number.isSafeInteger(githubId) || githubId <= 0)) {
        throw new Error(`${provider} returned an invalid user id`);
      }
      const providerSubject = provider === "github" ? String(githubId) : String(user.id).trim();
      if (!providerSubject) throw new Error(`${provider} returned an invalid user id`);
      if (
        provider === "google" &&
        state.mode === "signin" &&
        !identities.resolve("google", providerSubject) &&
        env.ZENOD_PUBLIC_GOOGLE_SIGNUP !== "1" &&
        !checkoutOwnerAllowlisted({
          user_id: customerUserId("google", providerSubject),
          provider: "google",
          github_id: null,
          email: user.email,
          email_verified: user.email_verified,
        }, env)
      ) {
        opsAlert("signin", "signup_closed", { provider });
        return c.text("Google signup is not open. Existing Google customers can still sign in.", 403);
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
      const isNewCustomer = !identities.resolve(provider, providerSubject);
      const principal = identities.resolveOrCreate(identityInput);
      issueCustomerSession(c, principal, env);
      const destination = signedReturnDestination(state.rh, env, product);
      const consentReturn = mcpConsentReturnPath(state.rt);
      if (consentReturn) return c.redirect(new URL(consentReturn, destination).toString(), 302);
      // EPIC-26 T1: an invite link goes on to checkout on this host, keeping the sign-up marker.
      const inviteReturn = joinReturnPath(state.rt);
      if (inviteReturn) {
        const invite = new URL(inviteReturn, "https://local.invalid");
        const path = joinPath(
          normalizeInviteCode(invite.searchParams.get("code")),
          isNewCustomer && product.product === "zenod",
        );
        return c.redirect(new URL(path, `${customerDestination(env, product.defaultDomain)}/`).toString(), 302);
      }
      // ZAL-A13: a first sign-in is a completed sign-up. The page it lands on
      // tells the alpha9 counter once (no cookie, nothing about the person).
      return c.redirect(isNewCustomer && product.product === "zenod" ? withSignupMarker(destination) : destination, 302);
    } catch (error) {
      console.error(`${provider} callback failed:`, error);
      const errorMessage = error instanceof Error ? error.message : "";
      const ownedByAnotherUser = errorMessage.includes("already linked to another user");
      const providerAlreadyLinked = errorMessage.includes("already linked to this user with a different subject");
      const collision = ownedByAnotherUser || providerAlreadyLinked;
      opsAlert("signin", collision ? "identity_collision" : "callback_failed", { provider, name: error instanceof Error ? error.name : "Error" });
      return c.text(
        ownedByAnotherUser
          ? "This sign-in identity is already linked to another Zenod account."
          : providerAlreadyLinked
            ? `A different ${provider === "google" ? "Google" : "GitHub"} identity is already linked to this account.`
          : `Could not complete ${provider === "google" ? "Google" : "GitHub"} sign-in. Please retry.`,
        collision ? 409 : 502,
      );
    }
  };

  app.get("/auth/mcp/signin", (c) => {
    const returnTo = mcpConsentReturnPath(c.req.query("return_to"));
    if (!returnTo) return c.text("Invalid connection request. Reopen Zenod from your agent.", 400);
    const buttons = (["github", "google"] as const).filter((provider) => identityProviders[provider]).map((provider) =>
      `<a href="/auth/${provider}/start?return_to=${encodeURIComponent(returnTo)}">Continue with ${provider === "github" ? "GitHub" : "Google"}</a>`).join("");
    if (!buttons) return c.text("Sign-in is not configured.", 503);
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Zenod</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fafafa;font:16px system-ui}.card{max-width:420px;padding:28px;background:#141414;border:1px solid #303030;border-radius:12px}h1{font-size:24px}p{color:#aaa}a{display:block;margin-top:16px;padding:12px;background:#fafafa;color:#111;text-align:center;text-decoration:none;border-radius:8px}</style></head><body><main class="card"><h1>Sign in to Zenod</h1><p>Sign in to choose your workspace and approve your agent's connection.</p>${buttons}</main></body></html>`);
  });

  // Preserve the established GitHub entry point while exposing provider-specific starts.
  app.get("/auth/signin", (c) => startIdentityFlow(c, "github", "signin"));
  app.get("/auth/github/start", (c) => startIdentityFlow(c, "github", "signin"));
  app.get("/auth/google/start", (c) => startIdentityFlow(c, "google", "signin"));
  app.get("/auth/github/callback", (c) => completeIdentityFlow(c, "github"));
  app.get("/auth/google/callback", (c) => completeIdentityFlow(c, "google"));

  app.post("/api/auth/providers/:provider/link", async (c) => {
    const provider = c.req.param("provider");
    if (provider !== "github" && provider !== "google") return c.json({ error: "unknown identity provider" }, 404);
    if (!customerMutationOriginAllowed(c, env, product)) return c.json({ error: "invalid request origin" }, 403);
    if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
      return c.json({ error: "explicit link intent is required" }, 400);
    }
    const body = await c.req.json<{ intent?: string }>().catch(() => ({} as { intent?: string }));
    if (body.intent !== "link_identity") return c.json({ error: "explicit link intent is required" }, 400);
    return startIdentityFlow(c, provider, "link_identity", "json");
  });

  app.delete("/api/auth/providers/:provider", (c) => {
    const provider = c.req.param("provider");
    if (provider !== "github" && provider !== "google") return c.json({ error: "unknown identity provider" }, 404);
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    principalForSession(session);
    const linkedProviders = identities.providersForUser(session.user_id);
    const remainingProviders = linkedProviders.filter((candidate) => candidate !== provider);
    if (remainingProviders.length === 0) {
      return c.json({ error: "cannot unlink the last sign-in identity" }, 409);
    }
    if (!remainingProviders.some((candidate) => Boolean(identityProviders[candidate]))) {
      return c.json({ error: "cannot unlink the only configured sign-in identity" }, 409);
    }
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
    app.get("/api/vault/drive/oauth/start", (c) =>
      c.json({ error: "explicit same-origin Drive vault connection intent is required" }, 405));
    app.post("/api/vault/drive/oauth/start", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (!customerMutationOriginAllowed(c, env, product)) return c.json({ error: "invalid request origin" }, 403);
      if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
        return c.json({ error: "explicit Drive vault connection intent is required" }, 400);
      }
      const body = await c.req.json<{ intent?: string }>().catch(() => ({} as { intent?: string }));
      if (body.intent !== "connect_drive_vault") {
        return c.json({ error: "explicit Drive vault connection intent is required" }, 400);
      }
      principalForSession(session);
      const activeAccount = accounts.resolveActiveTenantForUser(session.user_id);
      const vaultAuthority = activeAccount?.tenant_id
        ? accounts.resolveVaultAuthorityForTenantId(activeAccount.tenant_id)
        : null;
      const account = vaultAuthority?.binding ? vaultAuthority.account : activeAccount;
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      const token = account ? tokenVault.get(account.account_id) : null;
      const tenantRecord = token && options.tenantStore
        ? await options.tenantStore.resolveTokenHash(hashToken(token))
        : null;
      if (
        !account?.tenant_id ||
        !runtime ||
        !tenantRecord ||
        tenantRecord.tenant.id !== account.tenant_id ||
        (tenantRecord.status ?? "active") !== "active"
      ) {
        return c.json({ error: "tenant unavailable" }, 409);
      }
      if (account.vault_provider && account.vault_provider !== "google_drive") {
        return c.json({ error: "an authoritative vault provider is already selected" }, 409);
      }
      if (
        account.vault_provider === "google_drive" &&
        account.vault_binding_status !== "revoked" &&
        account.vault_binding_status !== "error"
      ) {
        return c.json({ error: "Google Drive vault connection is already active or in progress" }, 409);
      }
      const authority = runtime.settings.googleDriveOAuthAuthority();
      if (authority.mode !== "hosted-managed" || !authority.credentials || !options.driveVaultOAuth) {
        return c.json({ error: "Google Drive vault authorization is not configured" }, 503);
      }
      const bindingId = account.vault_binding_id ?? randomBytes(24).toString("base64url");
      const nonce = randomBytes(24).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const flow = randomBytes(24).toString("base64url");
      const state = signState({
        mode: "connect_drive_vault",
        uid: session.user_id,
        aid: activeAccount!.account_id,
        sid: activeAccount!.session_id,
        tid: account.tenant_id,
        bid: bindingId,
        epoch: account.vault_authorization_epoch ?? 0,
        flow,
        nonce,
      }, customerStateSecret(env));
      runtime.settings.setRaw(GOOGLE_DRIVE_VAULT_FLOW_SETTING, createHash("sha256").update(state).digest("hex"));
      setGoogleDriveVaultFlowCookie(c, signState({
        mode: "connect_drive_vault",
        uid: session.user_id,
        aid: activeAccount!.account_id,
        sid: activeAccount!.session_id,
        tid: account.tenant_id,
        bid: bindingId,
        epoch: account.vault_authorization_epoch ?? 0,
        flow,
        nonce,
        verifier,
      }, customerStateSecret(env)), env);
      return c.json({ url: options.driveVaultOAuth.authorizationUrl({
        clientId: authority.credentials.clientId,
        redirectUri: googleDriveVaultCallbackUrl(env, product.defaultDomain),
        state,
        mode: "hosted-managed",
        codeChallenge: pkceChallenge(verifier),
      }) });
    });

    app.get("/api/vault/drive/oauth/callback", async (c) => {
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      let failureCode: DriveVaultCallbackError = "drive_session";
      let safelyIdentifiedAccount: CustomerAccount | null = null;
      let validatedFlowRuntime: Runtime | null = null;
      try {
        const session = readCustomerSession(c, env);
        if (!session) return driveVaultCallbackFailure(c, env, product, "drive_session");
        failureCode = "drive_expired";
        principalForSession(session);
        const state = verifyState(c.req.query("state") ?? "", customerStateSecret(env));
        const proof = verifyState(getCookie(c, GOOGLE_DRIVE_VAULT_FLOW_COOKIE) ?? "", customerStateSecret(env));
        clearGoogleDriveVaultFlowCookie(c, env);
        const sessionAccount = state?.sid ? accounts.get(state.sid) : null;
        const activeAccount = accounts.resolveActiveTenantForUser(session.user_id);
        let account = sessionAccount;
        const vaultAuthority = state?.tid ? accounts.resolveVaultAuthorityForTenantId(state.tid) : null;
        if (vaultAuthority?.binding) account = vaultAuthority.account;
        if (
          !state ||
          state.mode !== "connect_drive_vault" ||
          !state.flow ||
          !state.nonce ||
          !state.aid ||
          !state.sid ||
          !state.tid ||
          !state.bid ||
          state.epoch === undefined ||
          state.uid !== session.user_id ||
          !sessionAccount?.tenant_id ||
          sessionAccount.session_id !== state.sid ||
          sessionAccount.account_id !== state.aid ||
          sessionAccount.user_id !== state.uid ||
          sessionAccount.tenant_id !== state.tid ||
          !account?.tenant_id ||
          account.account_id !== state.aid ||
          account.user_id !== state.uid ||
          account.tenant_id !== state.tid ||
          (account.vault_authorization_epoch ?? 0) !== state.epoch ||
          !activeAccount ||
          activeAccount.session_id !== state.sid ||
          activeAccount.account_id !== state.aid ||
          activeAccount.user_id !== state.uid ||
          activeAccount.tenant_id !== state.tid ||
          (activeAccount.subscription_status !== "active" && activeAccount.subscription_status !== "past_due") ||
          (account.vault_provider !== null && account.vault_provider !== "google_drive") ||
          (account.vault_binding_id !== null && account.vault_binding_id !== state.bid) ||
          !proof ||
          proof.mode !== "connect_drive_vault" ||
          proof.uid !== state.uid ||
          proof.aid !== state.aid ||
          proof.sid !== state.sid ||
          proof.tid !== state.tid ||
          proof.bid !== state.bid ||
          proof.epoch !== state.epoch ||
          proof.flow !== state.flow ||
          proof.nonce !== state.nonce ||
          !proof.verifier ||
          (account.vault_provider === "google_drive" &&
            account.vault_binding_status !== "revoked" &&
            account.vault_binding_status !== "error")
        ) {
          return driveVaultCallbackFailure(c, env, product, "drive_expired");
        }
        safelyIdentifiedAccount = account;
        const runtime = host.runtimeForAccount?.(account) ?? null;
        const expectedFlow = createHash("sha256").update(c.req.query("state") ?? "").digest("hex");
        if (!runtime || runtime.settings.getRaw(GOOGLE_DRIVE_VAULT_FLOW_SETTING) !== expectedFlow) {
          return driveVaultCallbackFailure(c, env, product, "drive_expired");
        }
        // Consume before any error handling or exchange so every accepted callback is one-shot.
        validatedFlowRuntime = runtime;
        runtime.settings.setRaw(GOOGLE_DRIVE_VAULT_FLOW_SETTING, "");
        failureCode = "drive_tenant";
        const token = tokenVault.get(account.account_id);
        const tenantRecord = token && options.tenantStore
          ? await options.tenantStore.resolveTokenHash(hashToken(token))
          : null;
        if (!tenantRecord || tenantRecord.tenant.id !== account.tenant_id || (tenantRecord.status ?? "active") !== "active") {
          return driveVaultCallbackFailure(c, env, product, "drive_tenant");
        }
        if (c.req.query("error")) {
          failureCode = "drive_denied";
          if (account.vault_provider === "google_drive") {
            accounts.upsert(account.session_id, {
              vault_binding_status: "revoked",
              vault_binding_updated_at: new Date().toISOString(),
            });
          }
          return driveVaultCallbackFailure(c, env, product, "drive_denied");
        }
        failureCode = "drive_config";
        const code = c.req.query("code") ?? "";
        const authority = runtime.settings.googleDriveOAuthAuthority();
        if (!code || authority.mode !== "hosted-managed" || !authority.credentials) {
          return driveVaultCallbackFailure(c, env, product, "drive_config");
        }
        let callbackStage: "exchange" | "bootstrap" = "exchange";
        try {
          failureCode = "drive_exchange";
          const now = new Date().toISOString();
          accounts.upsert(account.session_id, {
            vault_provider: "google_drive",
            vault_binding_id: state.bid,
            vault_binding_status: "authorizing",
            vault_binding_created_at: account.vault_binding_created_at ?? now,
            vault_binding_updated_at: now,
          });
          if (!options.driveVaultOAuth) throw new Error("Google Drive vault authorization is unavailable");
          const result = await options.driveVaultOAuth.exchangeCode({
            clientId: authority.credentials.clientId,
            clientSecret: authority.credentials.clientSecret,
            code,
            redirectUri: googleDriveVaultCallbackUrl(env, product.defaultDomain),
            codeVerifier: proof.verifier,
          });
          const currentTenantRecord = token && options.tenantStore
            ? await options.tenantStore.resolveTokenHash(hashToken(token))
            : null;
          if (
            !currentTenantRecord ||
            currentTenantRecord.tenant.id !== account.tenant_id ||
            (currentTenantRecord.status ?? "active") !== "active"
          ) {
            throw new Error("tenant became unavailable during Google Drive authorization");
          }
          const currentAccount = accounts.get(account.session_id);
          if (
            !currentAccount ||
            currentAccount.vault_provider !== "google_drive" ||
            currentAccount.vault_binding_id !== state.bid ||
            currentAccount.vault_binding_status !== "authorizing" ||
            (currentAccount.vault_authorization_epoch ?? 0) !== (account.vault_authorization_epoch ?? 0)
          ) {
            throw new Error("Drive vault authorization changed during callback");
          }
          runtime.settings.setRaw("google_drive_vault_oauth_refresh_token", result.refreshToken);
          runtime.settings.setRaw("google_drive_vault_oauth_email", result.email ?? "");
          const authorizationEpoch = (currentAccount.vault_authorization_epoch ?? 0) + 1;
          accounts.upsert(account.session_id, {
            vault_binding_status: "recovering",
            vault_authorization_epoch: authorizationEpoch,
            vault_binding_updated_at: new Date().toISOString(),
          });
          callbackStage = "bootstrap";
          failureCode = "drive_bootstrap";
          runtime.invalidate();
          const repo = await runtime.getRepo({ allowRecovering: true });
          const revision = await repo.currentRevision();
          return c.redirect(`${customerDestination(env, product.defaultDomain)}/app?vault=google-drive&revision=${encodeURIComponent(revision.id)}`, 303);
        } catch (error) {
          const latest = accounts.get(account.session_id);
          if (
            latest?.vault_provider === "google_drive" &&
            latest.vault_binding_id === state.bid &&
            latest.vault_binding_status !== "revoked"
          ) {
            accounts.upsert(account.session_id, {
              vault_binding_status: "error",
              vault_binding_updated_at: new Date().toISOString(),
            });
          }
          console.error("Google Drive vault callback failed:", error instanceof Error ? error.message : "unknown error");
          return driveVaultCallbackFailure(
            c,
            env,
            product,
            callbackStage === "exchange" ? "drive_exchange" : "drive_bootstrap",
          );
        }
      } catch (error) {
        if (validatedFlowRuntime) {
          try {
            validatedFlowRuntime.settings.setRaw(GOOGLE_DRIVE_VAULT_FLOW_SETTING, "");
          } catch {
            // Cookie clearing still prevents browser replay while a failed settings authority remains unavailable.
          }
        }
        if (
          safelyIdentifiedAccount?.vault_provider === "google_drive" &&
          safelyIdentifiedAccount.vault_binding_id
        ) {
          try {
            const latest = accounts.get(safelyIdentifiedAccount.session_id);
            if (
              latest?.account_id === safelyIdentifiedAccount.account_id &&
              latest.vault_binding_id === safelyIdentifiedAccount.vault_binding_id &&
              latest.vault_binding_status !== "revoked"
            ) {
              accounts.upsert(safelyIdentifiedAccount.session_id, {
                vault_binding_status: "error",
                vault_binding_updated_at: new Date().toISOString(),
              });
            }
          } catch {
            // The scrubbed redirect remains the terminal boundary when the account store itself is unavailable.
          }
        }
        console.error("Google Drive vault callback failed before exchange:", error instanceof Error ? error.message : "unknown error");
        return driveVaultCallbackFailure(c, env, product, failureCode);
      }
    });

    app.post("/api/vault/drive/recover", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (!customerMutationOriginAllowed(c, env, product)) return c.json({ error: "invalid request origin" }, 403);
      const account = resolveActiveVaultAccount(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      const token = account ? tokenVault.get(account.account_id) : null;
      const tenantRecord = token && options.tenantStore
        ? await options.tenantStore.resolveTokenHash(hashToken(token))
        : null;
      if (
        !account?.tenant_id ||
        account.vault_provider !== "google_drive" ||
        !runtime ||
        !tenantRecord ||
        tenantRecord.tenant.id !== account.tenant_id ||
        (tenantRecord.status ?? "active") !== "active"
      ) {
        return c.json({ error: "Google Drive vault is not selected" }, 409);
      }
      accounts.upsert(account.session_id, {
        vault_binding_status: "recovering",
        vault_binding_updated_at: new Date().toISOString(),
      });
      runtime.invalidate();
      try {
        const repo = await runtime.getRepo({ allowRecovering: true });
        return c.json({ ok: true, revision: await repo.currentRevision() });
      } catch (error) {
        const latest = accounts.get(account.session_id);
        if (latest?.vault_binding_status !== "revoked") {
          accounts.upsert(account.session_id, {
            vault_binding_status: "error",
            vault_binding_updated_at: new Date().toISOString(),
          });
        }
        return c.json({ error: "Google Drive vault recovery failed" }, 503);
      }
    });

    app.post("/api/vault/drive/disconnect", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (!customerMutationOriginAllowed(c, env, product)) return c.json({ error: "invalid request origin" }, 403);
      const account = resolveActiveVaultAccount(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      if (!account?.tenant_id || account.vault_provider !== "google_drive" || !runtime) {
        return c.json({ error: "Google Drive vault is not selected" }, 409);
      }
      accounts.upsert(account.session_id, {
        vault_binding_status: "revoked",
        vault_binding_updated_at: new Date().toISOString(),
      });
      runtime.invalidate();
      try {
        runtime.settings.setRaw("google_drive_vault_oauth_refresh_token", "");
        runtime.settings.setRaw("google_drive_vault_oauth_email", "");
      } catch (error) {
        console.error("Google Drive vault credential cleanup failed:", error instanceof Error ? error.message : "unknown error");
        return c.json({ error: "Google Drive vault disconnected but credential cleanup must be retried" }, 503);
      }
      return c.json({ ok: true, filesDeleted: false });
    });

    app.get("/api/vault/provider", (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const principal = principalForSession(session);
      const account = resolveActiveVaultAccount(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      const binding = account ? customerVaultBinding(account) : null;
      return c.json(projectVaultCapabilities({
        binding,
        githubConnectionReady: Boolean(
          principal.github_id && runtime && (runtime.settings.hasGithubApp() || runtime.settings.get("github_token")),
        ),
      }));
    });

    app.get("/api/github/app/start", (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const principal = principalForSession(session);
      if (!principal?.github_id || !principal.github_login) {
        return c.json({ error: "GitHub identity is not connected" }, 409);
      }
      const account = resolveActiveVaultAccount(session.user_id);
      if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
      const taskingOnly = account.vault_provider === "google_drive";
      const driveBindingId = taskingOnly ? account.vault_binding_id : null;
      if (account.vault_provider && account.vault_provider !== "github" && !taskingOnly) {
        return c.json({ error: "an authoritative vault provider is already selected" }, 409);
      }
      if (taskingOnly && !driveBindingId) {
        return c.json({ error: "the authoritative Drive vault binding is incomplete" }, 409);
      }
      if (taskingOnly && c.req.query("intent") !== "connect_github_tasking") {
        return c.json({ error: "explicit GitHub tasking connection intent is required" }, 400);
      }
      const sharedApp = host.sharedGithubApp;
      if (!sharedApp) return c.json({ error: "GitHub repository connection is not configured" }, 503);
      const state = signState(
        {
          mode: taskingOnly ? "connect_github_tasking" : "connect_repo",
          uid: session.user_id,
          gid: principal.github_id,
          login: principal.github_login,
          ...(taskingOnly ? { tid: account.tenant_id, bid: driveBindingId! } : {}),
        },
        customerStateSecret(env),
      );
      return c.json({
        url: `https://github.com/apps/${encodeURIComponent(sharedApp.slug)}/installations/new?state=${encodeURIComponent(state)}`,
      });
    });

    // The existing Zenod Memory GitHub App is configured to return here after the
    // customer grants it access to their brain repository.
    app.get("/github/setup", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.redirect("/auth/signin", 302);
      const principal = principalForSession(session);
      if (!principal?.github_id) return c.text("A connected GitHub identity is required.", 409);
      const stateRaw = c.req.query("state") ?? "";
      const state = stateRaw ? verifyState(stateRaw, customerStateSecret(env)) : null;
      if (
        (state?.mode !== "connect_repo" && state?.mode !== "connect_github_tasking") ||
        (state.uid ? state.uid !== session.user_id : state.gid !== principal.github_id)
      ) {
        return c.text("This repository connection link is invalid or expired.", 400);
      }
      const installationId = c.req.query("installation_id");
      if (!installationId || !/^\d+$/.test(installationId)) return c.redirect("/app", 302);
      const account = resolveActiveVaultAccount(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      if (!account?.tenant_id || !runtime) return c.text("Tenant runtime is unavailable.", 409);
      const taskingOnly = state.mode === "connect_github_tasking";
      if (
        taskingOnly
          ? account.vault_provider !== "google_drive" ||
            account.tenant_id !== state.tid ||
            account.vault_binding_id !== state.bid
          : Boolean(account.vault_provider && account.vault_provider !== "github")
      ) {
        return c.text("An authoritative vault provider is already selected.", 409);
      }
      if (taskingOnly) {
        let verified;
        try {
          verified = await runtime.inspectGithubAppInstallation(installationId);
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
            ? error.status
            : null;
          const reconnectRequired = status === 401 || status === 404;
          return c.json({
            error: {
              code: reconnectRequired ? "github_connection_required" : "github_installation_verification_failed",
              message: status === 404
                ? "That GitHub App installation no longer exists. Reinstall the App from Zenod settings."
                : "Zenod could not verify that GitHub App installation. Try connecting it again.",
            },
          }, status === 404 ? 409 : 502);
        }
        if (verified.accountType !== "User") {
          return c.json({
            error: {
              code: "github_organization_installation_not_supported",
              message: "Drive tasking currently supports personal GitHub App installations only; organization authorization is not yet available.",
            },
          }, 403);
        }
        if (verified.accountId !== principal.github_id) {
          return c.json({
            error: {
              code: "github_installation_identity_mismatch",
              message: "Install the GitHub App on the same personal GitHub account linked to this Zenod account.",
            },
          }, 403);
        }
      }
      runtime.settings.replaceGithubInstallationAuthorization(installationId);
      runtime.invalidate();
      return c.redirect("/app?github=connected", 302);
    });

    app.put("/api/vault/repository", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const account = resolveActiveVaultAccount(session.user_id);
      const runtime = account ? host.runtimeForAccount?.(account) ?? null : null;
      if (!account?.tenant_id || !runtime) return c.json({ error: "tenant unavailable" }, 409);
      if (account.vault_provider && account.vault_provider !== "github") {
        return c.json({ error: "an authoritative vault provider is already selected" }, 409);
      }
      const body = await c.req
        .json<{ repo?: string; branch?: string }>()
        .catch((): { repo?: string; branch?: string } => ({}));
      const repo = body.repo?.trim() ?? "";
      const branch = body.branch?.trim() || "main";
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return c.json({ error: "invalid repository" }, 400);
      runtime.settings.set("vault_repo", repo);
      runtime.settings.set("vault_branch", branch);
      runtime.invalidate();
      const now = new Date().toISOString();
      accounts.upsert(account.session_id, {
        vault_repo: repo,
        vault_repo_url: `https://github.com/${repo}`,
        vault_provider: "github",
        vault_binding_id: account.vault_binding_id ?? randomBytes(24).toString("base64url"),
        vault_binding_status: "ready",
        vault_branch: branch,
        vault_binding_created_at: account.vault_binding_created_at ?? now,
        vault_binding_updated_at: now,
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
    const vaultBinding = customerVaultBinding(account);
    const principal = principalForSession(session);
    const vault = projectVaultCapabilities({
      binding: vaultBinding,
      githubConnectionReady: Boolean(
        principal.github_id && runtime && (runtime.settings.hasGithubApp() || runtime.settings.get("github_token")),
      ),
    });
    return c.json({
      account_id: account.account_id,
      tier: account.tier,
      subscription_status: account.subscription_status,
      cancel_at_period_end: account.cancel_at_period_end,
      current_period_end: account.current_period_end,
      fully_discounted: account.fully_discounted ?? false,
      free_until: account.free_until ?? null,
      tenant_id: account.tenant_id,
      slug: account.tenant_slug,
      mcp_url: hasAccess ? `${billing.domain}/mcp` : null,
      token: hasAccess ? token : null,
      token_hint: hasAccess && token ? token.slice(-4) : null,
      vault_repo: account.vault_repo ?? runtime?.settings.get("vault_repo") ?? null,
      vault_repo_url: account.vault_repo_url,
      vault,
      usage,
    });
  });

  // EPIC-9 E9-2d: the signed-in customer's weekly memory sweep: next run and last
  // run's counts. It never suggests or asks anything (E9-5i).
  app.get("/api/console/memory-sweep", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    return c.json(runtime.treeSweepStatus());
  });

  // EPIC-7 T2.5: the signed-in customer's own recent captures and their
  // Saved replies. The runtime is resolved from the session's account only,
  // and its task-job store is scoped to that tenant.
  app.get("/api/console/recent-saves", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    const limit = Number(c.req.query("limit") ?? RECENT_SAVES_DEFAULT_LIMIT);
    return c.json({ saves: recentSaves(runtime.taskJobStore, limit) });
  });

  // EPIC-9 E9-2e: the signed-in customer's memory tree (Tree.md + page parents),
  // read-only from their own vault. Same account-only tenant resolution as above.
  const memoryTrees = new ConsoleMemoryTreeCache();
  app.get("/api/console/memory-tree", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      return c.json(await memoryTrees.get(account.tenant_id, runtime));
    } catch (error) {
      console.warn(`[memory-tree] console tree unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "memory tree unavailable" }, 503);
    }
  });

  // EPIC-22 E22-2: Memory › At a glance, from the person's own Log entries and tree. No model call.
  const memoryGlances = new MemoryGlanceCache();
  app.get("/api/console/memory-glance", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      return c.json({ status: "ready", ...(await memoryGlances.get(account.tenant_id, async () => {
        const engine = await runtime.getEngine();
        const [entries, outline] = await Promise.all([engine.searchEntries({ limit: null }), runtime.memoryTreeOutline().catch(() => null)]);
        return memoryGlance(entries, outline);
      })) });
    } catch (error) {
      if ((error as Error | null)?.name === "NotConfiguredError") return c.json({ status: "empty" });
      console.warn(`[memory-glance] unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "memory glance unavailable" }, 503);
    }
  });

  // EPIC-14 S28: Memory › At a glance, "What Zenod knows you mean": the quick index (places, the
  // names you use for them, counts, this week, and what keeping it cost). Read only; no model call.
  app.get("/api/console/quick-index", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      const view = await runtime.quickIndex();
      return c.json(view ? { status: "ready", ...view } : { status: "empty" });
    } catch (error) {
      if ((error as Error | null)?.name === "NotConfiguredError") return c.json({ status: "empty" });
      console.warn(`[quick-index] unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "quick index unavailable" }, 503);
    }
  });

  // EPIC-14 S29: the person corrected a "Read as" line: these words mean this place, or no place.
  // Kept in the quick index (the place learns the name); no model call, nothing in the vault changes.
  app.post("/api/console/quick-index/read-as", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json<{ phrase?: unknown; path?: unknown }>().catch(() => ({}) as { phrase?: unknown; path?: unknown });
    const phrase = typeof body.phrase === "string" ? body.phrase.replace(/\s+/g, " ").trim() : "";
    const path = typeof body.path === "string" && body.path.trim() ? body.path.trim() : body.path === null ? null : undefined;
    if (!phrase || phrase.length > 80 || path === undefined) return c.json({ error: "phrase and path are required" }, 400);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      const saved = await runtime.correctReadAs(phrase, path);
      return saved ? c.json({ ok: true, phrase, path }) : c.json({ error: "not_found" }, 404);
    } catch (error) {
      if ((error as Error | null)?.name === "NotConfiguredError") return c.json({ error: "vault_not_ready" }, 409);
      console.warn(`[quick-index] read-as correction not kept for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "quick index unavailable" }, 503);
    }
  });

  // EPIC-12 E12-S27: the person checks where Zenod filed things, on their own tree: the filings to
  // check (least sure first), "Right place", "Wrong place" with where it belongs, and Undo. Each
  // change is one commit in their vault with a correction record (S6 landing feedback shape); no model call.
  const memoryReviewEngine = async (c: Context) => {
    const session = readCustomerSession(c, env);
    if (!session) return { response: c.json({ error: "unauthorized" }, 401) };
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return { response: c.json({ error: "no_account" }, 404) };
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return { response: c.json({ error: "tenant unavailable" }, 409) };
    return { tenantId: account.tenant_id, engine: await runtime.getEngine() };
  };
  const memoryReviewFailure = (c: Context, tenantId: string, what: string, error: unknown) => {
    const name = (error as Error | null)?.name;
    if (name === "NotConfiguredError") return c.json({ error: "no_vault", message: "Connect your vault first." }, 409);
    if (name === "DeskChangeError") return c.json({ error: "not_changed", message: (error as Error).message }, 422);
    if ((error as Error | null)?.message === "desk_dirty_worktree") return c.json({ error: "busy", message: "Zenod is filing something right now. Try again in a moment." }, 409);
    console.warn(`[memory-review] ${what} unavailable for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
    return c.json({ error: "memory review unavailable", message: "Zenod could not change your memory just now. Try again in a moment." }, 503);
  };
  const readPagePath = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  app.get("/api/console/memory-review", async (c) => {
    const ctx = await memoryReviewEngine(c);
    if ("response" in ctx) return ctx.response;
    try {
      if (!ctx.engine.placementReview) return c.json({ status: "empty" });
      return c.json({ status: "ready", ...(await ctx.engine.placementReview({ limit: Number(c.req.query("limit") ?? 40) || 40 })) });
    } catch (error) {
      if ((error as Error | null)?.name === "NotConfiguredError") return c.json({ status: "empty" });
      return memoryReviewFailure(c, ctx.tenantId, "review", error);
    }
  });
  app.post("/api/console/memory-place", async (c) => {
    const body = await c.req.json<{ page?: unknown; to?: unknown }>().catch(() => ({}) as { page?: unknown; to?: unknown });
    const page = readPagePath(body.page);
    const to = readPagePath(body.to);
    if (!page || page.length > 512 || to.length > 512) return c.json({ error: "page is required" }, 400);
    const ctx = await memoryReviewEngine(c);
    if ("response" in ctx) return ctx.response;
    if (!ctx.engine.correctPlacement) return c.json({ error: "memory review unavailable" }, 503);
    try {
      const result = await ctx.engine.correctPlacement({ page, to: to || null });
      memoryTrees.invalidate(ctx.tenantId);
      return c.json({ id: result.id, action: result.action, page: result.page, title: result.title, before: result.before, after: result.after, revision: result.revision.id });
    } catch (error) {
      return memoryReviewFailure(c, ctx.tenantId, "move", error);
    }
  });
  app.post("/api/console/memory-place/undo", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}) as { id?: unknown });
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!/^c-[0-9a-f-]{6,40}$/.test(id)) return c.json({ error: "id is required" }, 400);
    const ctx = await memoryReviewEngine(c);
    if ("response" in ctx) return ctx.response;
    if (!ctx.engine.undoPlacementCorrection) return c.json({ error: "memory review unavailable" }, 503);
    try {
      const result = await ctx.engine.undoPlacementCorrection({ id });
      memoryTrees.invalidate(ctx.tenantId);
      return c.json({ id: result.id, action: result.action, page: result.page, title: result.title, before: result.before, after: result.after, revision: result.revision.id });
    } catch (error) {
      return memoryReviewFailure(c, ctx.tenantId, "undo", error);
    }
  });

  // EPIC-12 E12-S3a: ranked retrieval for the signed-in customer's own vault: the top
  // memories for a question with a match percentage and links (rankedMemory.ts).
  app.get("/api/console/memory-search", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const query = (c.req.query("q") ?? "").trim();
    if (!query) return c.json({ error: "q is required" }, 400);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      return c.json(await rankMemories(await runtime.getEngine(), query, Number(c.req.query("limit") ?? RANKED_MEMORY_DEFAULT_LIMIT)));
    } catch (error) {
      if ((error as Error | null)?.name === "NotConfiguredError") return c.json({ query, tier: "scan", ms: null, results: [] });
      console.warn(`[memory-search] console search unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "memory search unavailable" }, 503);
    }
  });

  // EPIC-12 E12-S2: the signed-in customer's memory graph: one memory's neighbourhood
  // (`path`: a vault path or link target) or, without it, the tree's roots and busiest pages.
  // Built from the tenant's own tier-0 index (links stored per file, refreshed on each filing).
  app.get("/api/console/memory-graph", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const center = (c.req.query("path") ?? "").trim();
    if (center.length > 512) return c.json({ error: "path is too long" }, 400);
    // E12-S13: `lit` (repeated) lights up the memories an answer used, best first.
    const lit = (c.req.queries("lit") ?? []).map((ref) => ref.trim()).filter(Boolean);
    if (lit.length > MEMORY_GRAPH_LIT_MAX || lit.some((ref) => ref.length > 512)) return c.json({ error: "too many memories to light up" }, 400);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      const engine = await runtime.getEngine();
      const view = engine.memoryGraph ? await engine.memoryGraph(lit.length
        ? { lit, limit: MEMORY_GRAPH_LIT_LIMIT }
        : { center: center || null, limit: Number(c.req.query("limit") ?? MEMORY_GRAPH_LIMIT) }) : null;
      return c.json(view ? { status: "ready", ...view } : { status: "empty" });
    } catch (error) {
      const name = (error as Error | null)?.name;
      if (name === "NotConfiguredError") return c.json({ status: "empty" });
      if (name === "NoteNotFoundError") return c.json({ error: "not_found" }, 404);
      console.warn(`[memory-graph] console graph unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "memory graph unavailable" }, 503);
    }
  });

  // EPIC-12 E12-S1: the web app's chat with your memory. Asking answers from the signed-in
  // customer's own vault (read-only ask + ranked top memories) and saves nothing; only Keep files
  // something, through the tenant's durable store queue. The AI allowance (EPIC-7 T3) is checked
  // before any model call, and every call is metered on the tenant's own ledger by its engine.
  const memoryChatsInFlight = new Map<string, number>();
  const MEMORY_CHATS_PER_TENANT = 2;
  const allowanceResponse = (c: Context, block: { message: string; resetsAt: string | null }) =>
    c.json({ error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: block.message, resetsAt: block.resetsAt }, 429);
  // Everything a chat needs before any model call: the session's tenant, its engine runtime, the
  // AI allowance and a free chat slot. Returns a Response to send instead when one is missing.
  const memoryChatStart = async (c: Context, options: { talk?: boolean } = {}) => {
    const session = readCustomerSession(c, env);
    if (!session) return { response: c.json({ error: "unauthorized" }, 401) };
    // E16-B1: the one Send button posts `message`; the older ask route posts `question`.
    const body = await c.req.json<{ question?: unknown; message?: unknown; previous?: unknown }>().catch(() => ({}) as { question?: unknown; message?: unknown; previous?: unknown });
    // EPIC-14 S29 round 2: the question asked just before in this chat, so "I meant …" corrects it.
    const previous = typeof body.previous === "string" ? body.previous.trim().slice(0, MEMORY_CHAT_MAX_QUESTION_CHARS) : "";
    // EPIC-22 E22-2: a talk also carries its persona and earlier turns; a talk opened from a card has no message.
    const talk = options.talk ? parseTalkRequest(body) : null;
    if (options.talk && !talk) return { response: c.json({ error: "message is required" }, 400) };
    const raw = typeof body.message === "string" ? body.message : body.question;
    const question = talk ? talk.message || talk.persona.name : typeof raw === "string" ? raw.trim() : "";
    if (!question) return { response: c.json({ error: "question is required" }, 400) };
    if (question.length > MEMORY_CHAT_MAX_QUESTION_CHARS) return { response: c.json({ error: "question is too long" }, 400) };
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return { response: c.json({ error: "no_account" }, 404) };
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return { response: c.json({ error: "tenant unavailable" }, 409) };
    const block = runtime.aiAllowanceBlock();
    if (block) {
      // Answers stopped at the allowance, capture did not (EPIC-14 S10): the words are kept as a note.
      // A talk keeps nothing (EPIC-22 E22-2): it only stops.
      if (talk) return { response: allowanceResponse(c, block) };
      try {
        runtime.taskJobQueue.enqueue("store", { content: question, source: "web" }, memoryKeepIdempotencyKey(account.tenant_id, question));
      } catch (error) {
        console.warn(`[memory-chat] words not kept for ${account.tenant_id} while answers are stopped: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { response: allowanceResponse(c, block) };
    }
    const tenantId = account.tenant_id;
    const inFlight = memoryChatsInFlight.get(tenantId) ?? 0;
    if (inFlight >= MEMORY_CHATS_PER_TENANT) return { response: c.json({ error: "busy", message: "Zenod is still answering your last question." }, 429) };
    memoryChatsInFlight.set(tenantId, inFlight + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (memoryChatsInFlight.get(tenantId) ?? 1) - 1;
      if (left > 0) memoryChatsInFlight.set(tenantId, left);
      else memoryChatsInFlight.delete(tenantId);
    };
    return { question, previous, talk, runtime, tenantId, release };
  };
  // A chat failure as { status, body }: the allowance and vault states keep their own codes.
  const memoryChatFailure = (tenantId: string, error: unknown) => {
    // By name: this module is bundled into Phylax, which must not import the "zenod" runtime.
    if ((error as Error | null)?.name === "LlmAllowanceExceededError") {
      const exceeded = error as Error & { resetsAt?: string | null };
      return { status: 429 as const, body: { error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: exceeded.message, resetsAt: exceeded.resetsAt ?? null } };
    }
    if ((error as Error | null)?.name === "NotConfiguredError") return { status: 409 as const, body: { error: "vault_not_ready" } };
    console.warn(`[memory-chat] answer unavailable for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 503 as const, body: { error: "memory chat unavailable" } };
  };

  // E12-S1b: the same chat, streamed as NDJSON lines so the app shows the memories at once and the
  // answer as it is written: {"type":"memories"}, then {"type":"text"} deltas, then {"type":"answer"}
  // with the checked answer (which replaces the streamed text) or {"type":"error"}.
  app.post("/api/console/memory-chat/stream", async (c) => {
    const start = await memoryChatStart(c);
    if ("response" in start) return start.response;
    const { question, runtime, tenantId, release } = start;
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    c.header("x-accel-buffering", "no");
    return stream(c, async (out) => {
      // A closed tab frees the slot at once; the answer still finishes and is metered.
      out.onAbort(release);
      const send = (event: Record<string, unknown>) => out.aborted ? Promise.resolve(out) : out.write(`${JSON.stringify(event)}\n`);
      try {
        const answer = await streamAnswerFromMemory(await runtime.getEngine(), question, {
          onMemories: (memories) => { void send({ type: "memories", memories }); },
          onText: (text) => { void send({ type: "text", text }); },
          appChat: true,
          readAs: (words) => runtime.readAs(words),
        });
        await send({ type: "answer", answer });
      } catch (error) {
        const failure = memoryChatFailure(tenantId, error);
        await send({ type: "error", status: failure.status, ...failure.body });
      } finally {
        release();
      }
    });
  });

  // EPIC-16 E16-B1: the one Send button. Zenod decides from the message whether to keep new
  // information, answer from memory, or both, and streams which it did as NDJSON:
  // {"type":"route"} first, then {"type":"kept"} with the store receipt when something is kept (the
  // same durable store queue and receipt as Keep), then the answer's memories/text/answer lines when
  // something is asked, then {"type":"done"}. A question is never kept (the route's guard).
  app.post("/api/console/memory-send/stream", async (c) => {
    const start = await memoryChatStart(c);
    if ("response" in start) return start.response;
    const { question: message, previous, runtime, tenantId, release } = start;
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    c.header("x-accel-buffering", "no");
    return stream(c, async (out) => {
      out.onAbort(release);
      const send = (event: Record<string, unknown>) => out.aborted ? Promise.resolve(out) : out.write(`${JSON.stringify(event)}\n`);
      try {
        const engine = await runtime.getEngine();
        // EPIC-14 S29 round 2: a follow-up ("I meant …") is answered as the corrected question, with no
        // routing call; a desk job only the model saw in words naming no topic, page or note is not one.
        const route = appSendRoute(isFollowUp(message) ? { action: "answer", keep: null, question: message, by: "rules" } : await routeSendMessage(engine, message), message, previous);
        console.log(`[memory-send] route=${route.action} by=${route.by}${isFollowUp(message) ? " follow-up" : ""}`);
        await send({ type: "route", route });
        // EPIC-14 S3: a job on the memory goes to the memory desk and shows in the inbox at once.
        // "unsure" asks first in the app ("keep it, or do it as a job?"); nothing runs on a guess.
        if (route.action === "job" && route.job) {
          try {
            const deskBlock = runtime.featureBlock("desk");
            if (deskBlock) throw new DeskLimitError(deskBlock.message);
            const item = startDeskJob(inboxFor(runtime), runtime.taskJobQueue, route.job);
            await send({ type: "desk", item: { id: item.id, title: item.title, status: item.status, step: item.step } });
          } catch (error) {
            const message = error instanceof DeskLimitError ? error.message : "The memory desk could not take that just now. Try again in a moment.";
            if (!(error instanceof DeskLimitError)) console.warn(`[memory-desk] job not started for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
            await send({ type: "desk", error: "desk unavailable", message });
          }
        }
        // EPIC-22 E22-2: Talk it over, with the librarian; nothing is kept or changed.
        if (route.action === "talk") {
          const talk = await streamTalk(engine, { message: route.talk || message, persona: talkPersona(null), history: [], opener: false }, {
            onMemories: (memories) => { void send({ type: "memories", memories }); },
            onText: (text) => { void send({ type: "text", text }); },
            readAs: (words) => runtime.readAs(words),
          });
          await send({ type: "talk", talk });
        }
        if (route.keep) {
          try {
            const job = runtime.taskJobQueue.enqueue("store", { content: route.keep, source: "web" }, memoryKeepIdempotencyKey(tenantId, route.keep));
            await send({ type: "kept", receipt: projectRecentSave(job, null) });
          } catch (error) {
            console.warn(`[memory-send] keep unavailable for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
            await send({ type: "kept", error: "keep unavailable", message: "Zenod could not keep that just now. Send it again in a moment." });
          }
        }
        if (route.question) {
          const answer = await streamAnswerFromMemory(engine, route.question, {
            onMemories: (memories) => { void send({ type: "memories", memories }); },
            onText: (text) => { void send({ type: "text", text }); },
            appChat: true,
            readAs: (words) => runtime.readAs(words),
          });
          await send({ type: "answer", answer });
        }
        await send({ type: "done" });
      } catch (error) {
        const failure = memoryChatFailure(tenantId, error);
        await send({ type: "error", status: failure.status, ...failure.body });
      } finally {
        release();
      }
    });
  });

  // EPIC-22 E22-2: one turn of Talk it over, streamed as NDJSON: {"type":"memories"}, {"type":"text"}
  // deltas, then {"type":"talk"} with the whole reply, or {"type":"error"}. Read-only, metered, capped
  // by the AI allowance like every chat; the app sends the persona and the earlier turns.
  app.post("/api/console/memory-talk/stream", async (c) => {
    const start = await memoryChatStart(c, { talk: true });
    if ("response" in start) return start.response;
    const { talk, runtime, tenantId, release } = start;
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    c.header("x-accel-buffering", "no");
    return stream(c, async (out) => {
      out.onAbort(release);
      const send = (event: Record<string, unknown>) => out.aborted ? Promise.resolve(out) : out.write(`${JSON.stringify(event)}\n`);
      try {
        const reply = await streamTalk(await runtime.getEngine(), talk!, {
          onMemories: (memories) => { void send({ type: "memories", memories }); },
          onText: (text) => { void send({ type: "text", text }); },
          readAs: (words) => runtime.readAs(words),
        });
        await send({ type: "talk", talk: reply });
      } catch (error) {
        const failure = memoryChatFailure(tenantId, error);
        await send({ type: "error", status: failure.status, ...failure.body });
      } finally {
        release();
      }
    });
  });

  app.post("/api/console/memory-chat", async (c) => {
    const start = await memoryChatStart(c);
    if ("response" in start) return start.response;
    const { question, runtime, tenantId, release } = start;
    try {
      return c.json(await answerFromMemory(await runtime.getEngine(), question, { appChat: true, readAs: (words) => runtime.readAs(words) }));
    } catch (error) {
      const failure = memoryChatFailure(tenantId, error);
      return c.json(failure.body, failure.status);
    } finally {
      release();
    }
  });

  app.post("/api/console/memory-keep", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const input = parseMemoryKeep(await c.req.json().catch(() => null));
    if (!input) return c.json({ error: "nothing to keep" }, 400);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    // Keeping is never stopped by the AI allowance (EPIC-14 S10): filing runs past it, and far past
    // it the engine keeps the words with filing pending.
    const content = memoryKeepContent(input);
    try {
      const job = runtime.taskJobQueue.enqueue(
        "store",
        { content, source: "web" },
        memoryKeepIdempotencyKey(account.tenant_id, content),
      );
      return c.json(projectRecentSave(job, null), 202);
    } catch (error) {
      console.warn(`[memory-keep] keep unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "keep unavailable" }, 503);
    }
  });

  // EPIC-22 E22-L3: the person tapped a reply's label and redid the message another way. The
  // switch is kept in their own data folder so the pick can be tuned from it (modeSwitches.ts).
  app.post("/api/console/memory-switch", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const record = parseModeSwitch(await c.req.json().catch(() => null), new Date());
    if (!record) return c.json({ error: "not a switch" }, 400);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      recordModeSwitch(runtime.dataDir, record);
      return c.json({ ok: true }, 202);
    } catch (error) {
      console.warn(`[memory-switch] not recorded for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "switch not recorded" }, 503);
    }
  });

  app.get("/api/console/memory-keep/:id", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    const job = runtime.taskJobQueue.get(c.req.param("id"));
    if (!job || job.kind !== "store" || !isMemoryKeepJobKey(account.tenant_id, job.idempotencyKey)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(projectRecentSave(job, null));
  });

  // EPIC-14 E14-S1: a voice note recorded in the chat. The body is the audio itself; it goes into the
  // tenant's media seam as a WhatsApp voice note does (archive, transcribe, Log entry, filing), under
  // the same AI allowance, and the app polls its receipt like a Keep.
  app.post("/api/console/voice-note", bodyLimit({
    maxSize: VOICE_NOTE_MAX_BYTES,
    onError: (c) => c.json({ error: "too_large", message: "That voice note is too long to send." }, 413),
  }), async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const mediaType = voiceNoteMediaType(c.req.header("content-type"));
    if (!mediaType) return c.json({ error: "unsupported_audio", message: "That recording format is not supported." }, 415);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    // Not stopped by the allowance either: far past it the queue archives the recording raw.
    const audio = Buffer.from(await c.req.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (audio.length === 0) return c.json({ error: "empty", message: "Nothing was recorded." }, 400);
    const seconds = Number(c.req.header("x-seconds"));
    const duration = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, VOICE_NOTE_MAX_SECONDS) : null;
    try {
      const job = runtime.taskJobQueue.enqueue(
        "media_ingest",
        voiceNoteIngestInput(audio, mediaType, duration, new Date()),
        voiceNoteIdempotencyKey(account.tenant_id, audio),
      );
      return c.json(projectCapture(runtime.taskJobStore, job), 202);
    } catch (error) {
      console.warn(`[voice-note] capture unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "keep unavailable" }, 503);
    }
  });

  app.get("/api/console/voice-note/:id", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    const job = runtime.taskJobQueue.get(c.req.param("id"));
    if (!job || job.kind !== "media_ingest" || !isVoiceNoteJobKey(account.tenant_id, job.idempotencyKey)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(projectCapture(runtime.taskJobStore, job));
  });

  // E12-S1: open one memory of the signed-in customer's own vault in the app (a chat link's target).
  app.get("/api/console/memory-note", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const path = (c.req.query("path") ?? "").split("#")[0]!.trim();
    if (!path || path.startsWith("/") || path.split("/").includes("..") || !/\.md$/i.test(path)) {
      return c.json({ error: "a vault .md path is required" }, 400);
    }
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    try {
      const note = await (await runtime.getEngine()).get(path);
      return c.json({ path: note.path, body: note.body, url: note.url, provider: note.provider });
    } catch (error) {
      if ((error as Error | null)?.name === "NotConfiguredError") return c.json({ error: "vault_not_ready" }, 409);
      return c.json({ error: "not_found" }, 404);
    }
  });

  // EPIC-14 S2: the inbox of persona questions, findings and memory desk jobs, for the signed-in
  // customer's own tenant only (inboxRoutes.ts).
  registerInboxRoutes<Runtime>(app, async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return { response: c.json({ error: "unauthorized" }, 401) };
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return { response: c.json({ error: "no_account" }, 404) };
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return { response: c.json({ error: "tenant unavailable" }, 409) };
    return { runtime, tenantId: account.tenant_id };
  }, {
    // EPIC-14 S26: a voice note left as feedback on a card is transcribed as every voice note is,
    // on the tenant's own settings and usage ledger, the local fallback included (taskJobQueue's transcribeMedia).
    transcribe: (runtime, audio, filename) => {
      const settings = runtime.settings;
      return transcribeAudio(audio, filename, {
        model: settings.whisperModel(),
        groqApiKey: settings.get("groq_api_key"),
        openaiApiKey: settings.get("openai_api_key"),
        openrouterApiKey: settings.openrouterApiKey(),
        openrouterUser: settings.openrouterUser(),
        openrouterModel: settings.openrouterTranscriptionModel(),
        longTranscriptionProvider: settings.longTranscriptionProvider(),
        useOpenAiForLongAudio: settings.useOpenAiForLongTranscription(),
        onUsage: settings.transcriptionUsageSink(),
      });
    },
  });

  // EPIC-14 S4: the personas' settings (on or off, last runs, spend, Run now) for the signed-in
  // customer's own tenant only (personaRoutes.ts).
  registerPersonaRoutes(app, async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return { response: c.json({ error: "unauthorized" }, 401) };
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return { response: c.json({ error: "no_account" }, 404) };
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return { response: c.json({ error: "tenant unavailable" }, 409) };
    return { runtime };
  });

  // EPIC-14 S8: the call button, a library hotline over OpenAI Realtime that asks the answer engine
  // and passes spoken jobs to the memory desk, for the signed-in customer's own tenant only
  // (memoryCallRoutes.ts). Zenod's own key (OPENAI_REALTIME_KEY) is read per request; while it is
  // absent the button says calls are not switched on yet.
  registerMemoryCallRoutes(app, async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return { response: c.json({ error: "unauthorized" }, 401) };
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return { response: c.json({ error: "no_account" }, 404) };
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return { response: c.json({ error: "tenant unavailable" }, 409) };
    const tenantId = account.tenant_id;
    return {
      store: callsFor(runtime),
      platform: platformMeter(callMeterFor(host.dataDir), tenantId),
      tenantId,
      tenant: {
        allowanceBlock: () => runtime.featureBlock("calls"),
        answer: async (question) => {
          // A call's lookups count as the call's spend, not as chat answers.
          // EPIC-14 S29: the call reads the quick index first, and tells the voice what it read the words as.
          const found = await withFeature("calls", async () => answerFromMemory(await runtime.getEngine(), question, { readAs: (words) => runtime.readAs(words) }));
          const sources = [...found.memories.filter((m) => m.cited).map((m) => m.title), ...found.alsoCited.map((m) => m.title)];
          return { answered: found.answered, answer: found.answer, sources, ...(found.readAs?.length ? { readAs: readAsLine(found.readAs) } : {}) };
        },
        deskJob: (job) => {
          const deskBlock = runtime.featureBlock("desk");
          if (deskBlock) throw new DeskLimitError(deskBlock.message);
          try {
            const item = startDeskJob(inboxFor(runtime), runtime.taskJobQueue, job);
            return { id: item.id, title: item.title };
          } catch (error) {
            if (error instanceof DeskLimitError) throw error;
            console.warn(`[memory-desk] call job not started for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error("The memory desk could not take that just now.");
          }
        },
        keep: (content) => runtime.taskJobQueue.enqueue("store", { content, source: "web" }, memoryKeepIdempotencyKey(tenantId, content)),
        record: (report) => runtime.usageStore.record(report),
      },
    };
  }, {
    key: () => callKey(env),
    minter: (key) => openAiMinter(key, env[CALL_BASE_ENV]?.trim() || OPENAI_BASE_URL),
  });

  // EPIC-14 S10: the Usage section. This month's AI spend by feature against the allowance, each
  // feature's own share and state, and what each costs in plain words, for the signed-in customer's
  // own tenant only.
  app.get("/api/console/usage", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const runtime = host.runtimeForAccount?.(account) ?? null;
    if (!runtime) return c.json({ error: "tenant unavailable" }, 409);
    const now = Date.now();
    try {
      const status = runtime.aiAllowanceStatus(now);
      return c.json(usageView({
        byFeature: runtime.monthSpendByFeature(now),
        allowanceUsd: status?.allowanceUsd ?? null,
        resetsAt: nextUtcMonthlyReset(now),
      }));
    } catch (error) {
      console.warn(`[usage] usage unavailable for ${account.tenant_id}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "usage unavailable" }, 503);
    }
  });

  if (capabilities.managedAiApplication) {
    app.get("/api/customer-usage", async (c) => {
      const session = readCustomerSession(c, env);
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const account = accounts.resolveActiveTenantForUser(session.user_id);
      if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
      return c.json(await usageForAccount(account));
    });

  }

  // --- static MCP tokens (account dashboard, session-authenticated) ---

  const mcpTokenView = (record: McpTokenRecord) => ({
    id: record.id,
    label: record.label,
    preview: record.preview,
    created_at: record.createdAt,
    last_used_at: record.lastUsedAt,
    revoked_at: record.revokedAt,
  });

  app.get("/api/account/mcp-tokens", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveForUser(session.user_id);
    if (!account) return c.json({ error: "no_account" }, 404);
    return c.json({ tokens: mcpTokens.list(account.account_id).map(mcpTokenView) });
  });

  app.post("/api/account/mcp-tokens", async (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveActiveTenantForUser(session.user_id);
    if (!account?.tenant_id) return c.json({ error: "no_account" }, 404);
    const body = await c.req.json<{ label?: unknown }>().catch(() => ({}) as { label?: unknown });
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return c.json({ error: "label is required" }, 400);
    const { token, record } = mcpTokens.create({
      accountId: account.account_id,
      tenantId: account.tenant_id,
      label,
    });
    c.header("Cache-Control", "no-store");
    // The plaintext is shown here exactly once; only its hash is stored.
    return c.json({ token, ...mcpTokenView(record), mcp_url: `${billing.domain}/mcp` }, 201);
  });

  // Plaintext reveal: owning account's session only. Other accounts, revoked or
  // unknown tokens all look the same (404). The response is never cached or logged.
  app.get("/api/account/mcp-tokens/:id/reveal", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveForUser(session.user_id);
    if (!account) return c.json({ error: "no_account" }, 404);
    const token = mcpTokens.reveal(account.account_id, c.req.param("id"));
    c.header("Cache-Control", "no-store");
    if (!token) return c.json({ error: "not_found" }, 404);
    return c.json({ token });
  });

  app.delete("/api/account/mcp-tokens/:id", (c) => {
    const session = readCustomerSession(c, env);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const account = accounts.resolveForUser(session.user_id);
    if (!account) return c.json({ error: "no_account" }, 404);
    if (!mcpTokens.revoke(account.account_id, c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  /**
   * Resolve a static MCP token hash to the same tenant identity the account's own
   * tenant token carries (full, unprofiled access), or null when the token is
   * unknown/revoked or the account is no longer entitled. Mirrors the OAuth grant
   * checks in the Zenod unit so both credentials get identical permissions.
   */
  async function resolveMcpTokenRecord(tokenHash: string): Promise<TenantTokenRecord | null> {
    const stored = mcpTokens.resolveHash(tokenHash);
    if (!stored) return null;
    const account = accounts.resolveForAccountId(stored.accountId);
    if (
      !account?.tenant_id || account.tenant_id !== stored.tenantId ||
      (account.subscription_status !== "active" && account.subscription_status !== "past_due")
    ) return null;
    const vaulted = tokenVault.get(account.account_id);
    const base = vaulted ? await options.tenantStore?.resolveTokenHash(hashToken(vaulted)) : null;
    const expiresAt = base?.expiresAt == null ? Infinity : new Date(base.expiresAt).getTime();
    if (
      !base || base.profile?.trim() || base.tenant.id !== account.tenant_id ||
      (base.status ?? "active") !== "active" || !(expiresAt > Date.now())
    ) return null;
    return { tokenHash, tenant: { ...base.tenant }, profile: null, status: "active", expiresAt: base.expiresAt ?? null };
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
      mcpPath: "/mcp",
      mcp_url: `${billing.domain}/mcp`,
    });
  });

  function wantsHtml(c: Context<{ Bindings: HttpBindings }>): boolean {
    return (c.req.header("accept") ?? "").toLowerCase().includes("text/html");
  }

  function signupPausedPage(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signup is paused — Zenod</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fafafa;font:16px system-ui}.card{max-width:420px;padding:28px;background:#141414;border:1px solid #303030;border-radius:12px}h1{font-size:24px}p{color:#aaa}a{color:#fafafa}a.button{display:block;margin-top:16px;padding:12px;background:#fafafa;color:#111;text-align:center;text-decoration:none;border-radius:8px}</style></head><body><main class="card"><h1>Signup is paused for a moment</h1><p>We are not taking new subscriptions right now. Nothing was charged. Please try again a little later.</p><p>Questions? Write to <a href="mailto:jordi@alpha9.io">jordi@alpha9.io</a>.</p><a class="button" href="/">Back to Zenod</a></main></body></html>`;
  }

  async function startCheckout(
    c: Context<{ Bindings: HttpBindings }>,
    tierInput: unknown,
    invite?: { code: string | null; signedUp: boolean },
  ) {
    const owner = readCustomerSession(c, env);
    if (!owner) return c.json({ error: "sign in before subscribing" }, 401);
    const principal = principalForSession(owner);
    const existing = accounts.resolveForUser(owner.user_id);
    if (
      principal.provider === "google" &&
      principal.github_id === null &&
      env.ZENOD_PUBLIC_GOOGLE_SIGNUP !== "1" &&
      !existing &&
      !checkoutOwnerAllowlisted(principal, env)
    ) {
      return c.json({ error: "Google signup is not open" }, 503);
    }
    if (!checkoutEnabledForOwner(principal, env)) {
      if (wantsHtml(c)) return c.html(signupPausedPage(), 503, { "Retry-After": "3600" });
      return c.json({ error: "paid signup is not open" }, 503);
    }
    if (existing?.subscription_status === "active" || existing?.subscription_status === "past_due") {
      return c.json({ error: "an active subscription already exists" }, 409);
    }
    if (!stripe) return c.json({ error: "checkout is not configured" }, 503);
    const resolved = resolveCheckoutTier(tierInput, billing, newCheckoutPolicyForProduct(product));
    if ("error" in resolved) return c.json({ error: resolved.error }, 400);
    const accountId = existing?.account_id ?? customerAccountIdForUser(principal);
    identities.bindAccount(principal.user_id, accountId);
    const checkoutOwner = {
      user_id: principal.user_id,
      display_name: principal.display_name,
      account_id: accountId,
      github_id: principal.github_id,
      github_login: principal.github_login,
      email: principal.email,
    };
    let session: Stripe.Checkout.Session;
    if (invite && product.product === "zenod") {
      // EPIC-26 T1: apply the invite's code up front. An unknown or used-up code, or one
      // Stripe will not apply to this checkout, falls back to the open code field.
      const promotionCodeId = invite.code ? await findActivePromotionCode(stripe, invite.code) : null;
      const checkoutInvite: CheckoutInvite = { promotionCodeId, welcome: true, signedUp: invite.signedUp };
      try {
        session = await createCustomerCheckout(stripe, accounts, billing, checkoutOwner, resolved, product, checkoutInvite);
      } catch (error) {
        if (!promotionCodeId) throw error;
        console.error("invite checkout with code failed, retrying without it:", error instanceof Error ? error.name : "Error");
        session = await createCustomerCheckout(stripe, accounts, billing, checkoutOwner, resolved, product, {
          ...checkoutInvite,
          promotionCodeId: null,
        });
      }
    } else {
      session = await createCustomerCheckout(stripe, accounts, billing, checkoutOwner, resolved, product);
    }
    return c.json({ id: session.id, url: session.url, product: product.product, tier: resolved.tier });
  }

  app.get("/buy", async (c) => {
    const response = await startCheckout(c, c.req.query("tier"));
    if (response.status !== 200) return response;
    const payload = (await response.clone().json()) as { url: string };
    return c.redirect(payload.url, 303);
  });

  // EPIC-26 T1: the tester invite link. Signed out, it shows what Zenod is and sign-in;
  // signed in, it goes straight to Stripe Checkout with the code applied.
  app.get(JOIN_PATH, async (c) => {
    if (product.product !== "zenod") return c.notFound();
    const code = normalizeInviteCode(c.req.query("code"));
    const owner = readCustomerSession(c, env);
    if (!owner) {
      const providers = (["google", "github"] as const).filter((provider) => identityProviders[provider]);
      return c.html(joinPage(code, [...providers]), 200, { "Cache-Control": "no-store" });
    }
    const existing = accounts.resolveForUser(owner.user_id);
    if (existing?.subscription_status === "active" || existing?.subscription_status === "past_due") {
      return c.redirect(`${customerDestination(env, product.defaultDomain)}/app`, 303);
    }
    const response = await startCheckout(c, "monthly", { code, signedUp: c.req.query("signed_up") === "1" });
    if (response.status === 200) {
      const payload = (await response.clone().json()) as { url: string };
      return c.redirect(payload.url, 303);
    }
    if ((response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
    return c.html(
      joinProblemPage("We could not open checkout just now. Please open your invite link again in a little while."),
      response.status as 400 | 401 | 409 | 503,
      { "Cache-Control": "no-store" },
    );
  });

  app.get(WELCOME_PATH, (c) => {
    if (product.product !== "zenod") return c.notFound();
    if (!readCustomerSession(c, env)) return c.redirect("/app", 303);
    return c.html(welcomePage(c.req.query("signed_up") === "1"), 200, { "Cache-Control": "no-store" });
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
    if (product.product === "zenod" && c.req.query("welcome") === "1") {
      const signedUp = c.req.query("signed_up") === "1" ? "?signed_up=1" : "";
      return c.redirect(`${customerDestination(env, product.defaultDomain)}${WELCOME_PATH}${signedUp}`, 303);
    }
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
      const subscriptionId = invoiceSubscriptionId(invoice);
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

  // D30: one-time (idempotent) removal of the per-customer key data left by the removed lifecycle.
  try {
    cleanupLegacyManagedAi({
      dataDir: host.dataDir,
      accountsPath: accounts.path,
      runtimeForAccount: host.runtimeForAccount,
      runtimeForTenant: (tenantId) => host.runtimeForAccount?.({ tenant_id: tenantId } as CustomerAccount) ?? null,
    });
  } catch (error) {
    console.error("[legacy-managed-ai-cleanup] failed:", (error as Error).message);
  }

  return {
    app,
    accounts,
    identities,
    principalForSession,
    tokenVault,
    mcpTokens,
    resolveMcpTokenRecord,
    usageForAccount,
    reconcileEntitlement,
    refreshAuthoritativeSubscriptions,
    /** EPIC-26 S2: the tester flow mints codes with the same client when allowed. */
    stripe,
    close() {
      mcpTokens.close();
    },
  };
}
