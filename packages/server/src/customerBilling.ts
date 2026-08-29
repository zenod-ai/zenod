import type Stripe from "stripe";
import { CustomerAccountStore, customerAccountIdForUser, type CustomerAccount } from "./customerAccounts.js";
import { customerUserId } from "./customerIdentity.js";

// Checkout behavior is transplanted from zenod-ai/cloud services/webhook/src/server.ts
// @ 6bdb318. The old queue/provisioner call is represented only by
// onCheckoutCompleted; Z-N3 will bind that seam to a local tenant-row insert.

export interface CustomerStripeClient {
  checkout: {
    sessions: {
      create(input: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
  billingPortal?: {
    sessions: {
      create(input: Stripe.BillingPortal.SessionCreateParams): Promise<Stripe.BillingPortal.Session>;
    };
  };
  subscriptions?: {
    retrieve(id: string): Promise<Stripe.Subscription>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, signature: string, secret: string): Stripe.Event;
  };
}

export interface ProviderNeutralCheckoutOwner {
  user_id: string;
  display_name: string;
  account_id?: string;
  github_id?: number | null;
  github_login?: string | null;
  email?: string | null;
}

/** Compatibility input for existing product-layer callers during migration. */
export interface LegacyGithubCheckoutOwner {
  github_id: number;
  login: string;
}

export type CheckoutOwner = ProviderNeutralCheckoutOwner | LegacyGithubCheckoutOwner;

function providerNeutralCheckoutOwner(owner: CheckoutOwner): ProviderNeutralCheckoutOwner {
  return "user_id" in owner
    ? owner
    : {
        user_id: customerUserId("github", String(owner.github_id)),
        display_name: owner.login,
        github_id: owner.github_id,
        github_login: owner.login,
      };
}

export type CheckoutTier = "monthly" | "yearly";

export interface CustomerBillingConfig {
  domain: string;
  stripeMode: "test" | "live";
  stripeWebhookSecret: string;
  portalConfigurationId?: string;
  automaticTax: boolean;
  prices: Record<CheckoutTier, string | undefined>;
}

export interface CustomerProductConfig {
  product: string;
  unit: string;
  defaultDomain: string;
  signInToLanding?: boolean;
  /** Intervals offered to new customers. Existing account tiers remain valid historical data. */
  newCheckoutTiers?: readonly CheckoutTier[];
}

const ALL_CHECKOUT_TIERS: readonly CheckoutTier[] = ["monthly", "yearly"];
const LEGACY_CHECKOUT_ALIASES: Readonly<Record<string, CheckoutTier | undefined>> = {
  starter: "monthly",
  pro: "yearly",
};
const NO_CHECKOUT_ALIASES: Readonly<Record<string, CheckoutTier | undefined>> = {};

export interface NewCheckoutPolicy {
  allowedTiers: readonly CheckoutTier[];
  aliases: Readonly<Record<string, CheckoutTier | undefined>>;
}

const DEFAULT_CHECKOUT_POLICY: NewCheckoutPolicy = {
  allowedTiers: ALL_CHECKOUT_TIERS,
  aliases: LEGACY_CHECKOUT_ALIASES,
};

export function newCheckoutPolicyForProduct(product: CustomerProductConfig): NewCheckoutPolicy {
  const zenod = product.product === "zenod";
  return {
    allowedTiers: product.newCheckoutTiers ?? (zenod ? ["monthly"] : ALL_CHECKOUT_TIERS),
    aliases: zenod ? NO_CHECKOUT_ALIASES : LEGACY_CHECKOUT_ALIASES,
  };
}

export function loadCustomerBillingConfig(
  env: NodeJS.ProcessEnv = process.env,
  product: CustomerProductConfig = { product: "zenod", unit: "zenod", defaultDomain: "https://cloud.zenod.dev" },
): CustomerBillingConfig {
  const stripeMode = env.STRIPE_MODE === "live" ? "live" : "test";
  return {
    domain: (env.CUSTOMER_APP_URL || env.DOMAIN || product.defaultDomain).replace(/\/$/, ""),
    stripeMode,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
    automaticTax: env.STRIPE_AUTOMATIC_TAX === "1",
    prices: {
      monthly: env.PRICE_MONTHLY,
      yearly: env.PRICE_YEARLY,
    },
  };
}

export function resolveCheckoutTier(
  input: unknown,
  config: CustomerBillingConfig,
  policy: NewCheckoutPolicy = DEFAULT_CHECKOUT_POLICY,
): { tier: CheckoutTier; price: string } | { error: string } {
  const raw = String(input || "monthly").toLowerCase();
  const tier = raw === "monthly" || raw === "yearly" ? raw : policy.aliases[raw];
  if (!tier) {
    return { error: `unknown tier "${raw}" (use ${policy.allowedTiers.join("|")})` };
  }
  if (!policy.allowedTiers.includes(tier)) {
    return { error: `tier "${tier}" is not available for new checkout` };
  }
  const price = config.prices[tier];
  if (!price) return { error: `tier "${tier}" has no price configured` };
  return { tier, price };
}

export async function createCustomerCheckout(
  stripe: CustomerStripeClient,
  accounts: CustomerAccountStore,
  config: CustomerBillingConfig,
  owner: CheckoutOwner,
  checkout: { tier: CheckoutTier; price: string },
  product: CustomerProductConfig = { product: "zenod", unit: "zenod", defaultDomain: "https://cloud.zenod.dev" },
): Promise<Stripe.Checkout.Session> {
  const normalizedOwner = providerNeutralCheckoutOwner(owner);
  const accountId = normalizedOwner.account_id ??
    accounts.resolveForUser(normalizedOwner.user_id)?.account_id ??
    customerAccountIdForUser(normalizedOwner);
  const metadata = { product: product.product, unit: product.unit, tier: checkout.tier, account_id: accountId };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: checkout.price, quantity: 1 }],
    client_reference_id: accountId,
    metadata,
    subscription_data: { metadata },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    consent_collection: { terms_of_service: "required" },
    ...(config.automaticTax ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${config.domain}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.domain}/pricing?checkout=cancelled`,
  });
  accounts.upsert(session.id, {
    account_id: accountId,
    product: product.product,
    tier: checkout.tier,
    stripe_client_reference_id: accountId,
    subscription_status: "checkout_pending",
    user_id: normalizedOwner.user_id,
    github_id: normalizedOwner.github_id ?? null,
    github_login: normalizedOwner.github_login ?? null,
    github_email: normalizedOwner.email ?? null,
    claimed_at: new Date().toISOString(),
  });
  return session;
}

export async function completeCustomerCheckout(
  session: Stripe.Checkout.Session,
  accounts: CustomerAccountStore,
  onCheckoutCompleted?: (account: CustomerAccount, session: Stripe.Checkout.Session) => Promise<void> | void,
  expectedProduct = "zenod",
): Promise<"completed" | "duplicate" | "rejected"> {
  if (session.metadata?.product !== expectedProduct) return "rejected";
  const account = accounts.get(session.id);
  if (!account || !session.client_reference_id || session.client_reference_id !== account.account_id) {
    return "rejected";
  }
  if (account.checkout_completed_at) return "duplicate";
  // Keep the adapter retryable: only mark completion after the local tenant bind
  // succeeds. A thrown adapter error becomes a 5xx and Stripe retries the event.
  await onCheckoutCompleted?.(account, session);
  accounts.upsert(session.id, {
    stripe_email: session.customer_details?.email ?? session.customer_email ?? null,
    stripe_customer_id:
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    stripe_subscription_id:
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
    subscription_status: "active",
    checkout_completed_at: new Date().toISOString(),
  });
  return "completed";
}

export type CustomerSubscriptionStatus = CustomerAccount["subscription_status"];

function stripeObjectId(value: string | { id?: string | null } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function accountStatusForStripe(status: Stripe.Subscription.Status): CustomerSubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "incomplete") return "past_due";
  if (status === "paused") return "paused";
  return "canceled";
}

export function applyCustomerSubscriptionEvent(
  accounts: CustomerAccountStore,
  subscription: Stripe.Subscription,
): CustomerAccount | null {
  const account = accounts.resolveForSubscription(subscription.id);
  const resolvedAccount = account ?? accounts.resolveForAccountId(subscription.metadata.account_id ?? "");
  if (!resolvedAccount) return null;
  const status = accountStatusForStripe(subscription.status);
  return accounts.upsert(resolvedAccount.session_id, {
    subscription_status: status,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: stripeObjectId(subscription.customer),
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_start: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
  });
}

export function applyCustomerInvoiceEvent(
  accounts: CustomerAccountStore,
  invoice: Stripe.Invoice,
  paid: boolean,
): CustomerAccount | null {
  const subscriptionId = stripeObjectId(invoice.subscription);
  const account = subscriptionId
    ? accounts.resolveForSubscription(subscriptionId)
    : accounts.resolveForStripeCustomer(stripeObjectId(invoice.customer) ?? "");
  if (!account || account.subscription_status === "canceled") return account;
  return accounts.upsert(account.session_id, {
    subscription_status: paid ? "active" : "past_due",
    stripe_customer_id: stripeObjectId(invoice.customer) ?? account.stripe_customer_id,
  });
}

export async function createCustomerPortalSession(
  stripe: CustomerStripeClient,
  config: CustomerBillingConfig,
  account: CustomerAccount,
): Promise<string> {
  if (!stripe.billingPortal) throw new Error("billing portal is not configured");
  if (!account.stripe_customer_id) throw new Error("Stripe customer is not recorded");
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: `${config.domain}/app/account`,
    ...(config.portalConfigurationId ? { configuration: config.portalConfigurationId } : {}),
  });
  if (!session.url) throw new Error("Stripe billing portal did not return a URL");
  return session.url;
}
