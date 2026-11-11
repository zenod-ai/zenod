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
    retrieve(id: string, params?: Stripe.SubscriptionRetrieveParams): Promise<Stripe.Subscription>;
  };
  promotionCodes?: {
    list(params: Stripe.PromotionCodeListParams): Promise<{ data: Stripe.PromotionCode[] }>;
    create?(params: Stripe.PromotionCodeCreateParams): Promise<Stripe.PromotionCode>;
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

/**
 * EPIC-7 T5: shown above Stripe's pay button. Written for everyone, since only the price
 * differs between users: a 100% promotion code makes the total €0, and
 * `payment_method_collection: "if_required"` then asks for no card.
 */
export const ZENOD_CHECKOUT_SUBMIT_MESSAGE =
  "Have a Zenod code? Add it under \"Add promotion code\". If it covers the full price, your total is €0: " +
  "no card or payment details are needed and you will not be charged.";

/** EPIC-26 T1: the invite link already applied the tester's code; say so above the pay button. */
export const ZENOD_INVITE_CHECKOUT_SUBMIT_MESSAGE =
  "Your Zenod code is already applied. If it covers the full price, your total is €0: " +
  "no card or payment details are needed and you will not be charged.";

/** EPIC-26 T1: a checkout started from an invite link (cloud.zenod.dev/join?code=…). */
export interface CheckoutInvite {
  /** The Stripe promotion code id to apply up front; without it, the code field stays open. */
  promotionCodeId?: string | null;
  /** Return to the "you're in" page instead of straight to the app. */
  welcome?: boolean;
  /** Carry the first sign-in's sign-up marker to that page (ZAL-A13 counter). */
  signedUp?: boolean;
  /**
   * EPIC-26 S13: the end-of-test offer before the free month ends. The €9 subscription starts with a
   * trial up to this unix second, so its first charge is the day the free month ends; a card is
   * always asked for, and the code field stays closed.
   */
  firstChargeAt?: number | null;
  /** EPIC-26 S13: the words above the pay button. */
  submitMessage?: string;
  /** EPIC-26 S13: where "back" from checkout goes (default the pricing page). */
  cancelPath?: string;
}

/** The active promotion code with exactly this customer-facing code, or null (unknown, used up, or no lookup). */
export async function findActivePromotionCode(stripe: CustomerStripeClient, code: string): Promise<string | null> {
  if (!stripe.promotionCodes) return null;
  try {
    const found = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    return found.data[0]?.id ?? null;
  } catch (error) {
    console.error("promotion code lookup failed:", error instanceof Error ? error.name : "Error");
    return null;
  }
}

export async function createCustomerCheckout(
  stripe: CustomerStripeClient,
  accounts: CustomerAccountStore,
  config: CustomerBillingConfig,
  owner: CheckoutOwner,
  checkout: { tier: CheckoutTier; price: string },
  product: CustomerProductConfig = { product: "zenod", unit: "zenod", defaultDomain: "https://cloud.zenod.dev" },
  invite: CheckoutInvite = {},
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
    subscription_data: { metadata, ...(invite.firstChargeAt ? { trial_end: invite.firstChargeAt } : {}) },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    consent_collection: { terms_of_service: "required" },
    ...(product.product === "zenod"
      ? {
          // Stripe takes either a prefilled code or the "Add promotion code" field, never both.
          ...(invite.firstChargeAt
            ? {}
            : invite.promotionCodeId
              ? { discounts: [{ promotion_code: invite.promotionCodeId }] }
              : { allow_promotion_codes: true }),
          payment_method_collection: invite.firstChargeAt ? "always" : "if_required",
          custom_text: {
            submit: {
              message: invite.submitMessage ??
                (invite.promotionCodeId ? ZENOD_INVITE_CHECKOUT_SUBMIT_MESSAGE : ZENOD_CHECKOUT_SUBMIT_MESSAGE),
            },
          },
        }
      : {}),
    ...(config.automaticTax ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${config.domain}/checkout/complete?session_id={CHECKOUT_SESSION_ID}${
      invite.welcome ? `&welcome=1${invite.signedUp ? "&signed_up=1" : ""}` : ""
    }`,
    cancel_url: `${config.domain}${invite.cancelPath ?? "/pricing?checkout=cancelled"}`,
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

type DiscountLike = {
  end?: number | null;
  coupon?: Stripe.Coupon | string | null;
  source?: { coupon?: Stripe.Coupon | string | null } | null;
};

/** The end of the period after the current one, stepping whole calendar months like Stripe's billing anchor. */
function nextPeriodEnd(start: number | null | undefined, end: number): number {
  const from = new Date((start ?? end) * 1000);
  const to = new Date(end * 1000);
  const months = Math.max(1, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth());
  const next = new Date(to);
  next.setUTCMonth(next.getUTCMonth() + months);
  return Math.floor(next.getTime() / 1000);
}

/**
 * EPIC-7 T5: whether the subscription is free right now, from its own discounts (no tester flag).
 * Free means a 100%-off coupon is attached. `free_until` is the last day known to be free:
 * null for a `forever` coupon, the discount end for `repeating`, and one more period after the
 * current one for `once` (it covers the next renewal invoice). Reads both the legacy single
 * `discount` and the expanded `discounts` list; coupon ids that are not expanded count as unknown.
 */
export function subscriptionFreePeriod(
  subscription: Stripe.Subscription,
): { fully_discounted: boolean; free_until: string | null } {
  const legacy = (subscription as Stripe.Subscription & { discount?: DiscountLike | null }).discount;
  const listed = ((subscription as { discounts?: Array<DiscountLike | string> | null }).discounts ?? [])
    .filter((discount): discount is DiscountLike => typeof discount === "object" && discount !== null);
  const discounts = [...(legacy ? [legacy] : []), ...listed];
  let free = false;
  let until: number | null = null;
  for (const discount of discounts) {
    const coupon = discount.coupon ?? discount.source?.coupon ?? null;
    if (!coupon || typeof coupon === "string" || coupon.percent_off !== 100) continue;
    if (coupon.duration === "forever") return { fully_discounted: true, free_until: null };
    let end: number | null = null;
    if (coupon.duration === "repeating") end = discount.end ?? null;
    if (coupon.duration === "once" && subscription.current_period_end) {
      end = nextPeriodEnd(subscription.current_period_start, subscription.current_period_end);
    }
    if (end === null) continue;
    free = true;
    until = Math.max(until ?? 0, end);
  }
  return { fully_discounted: free, free_until: free && until ? new Date(until * 1000).toISOString() : null };
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
    ...subscriptionFreePeriod(subscription),
    current_period_start: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null,
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
  });
}

/**
 * The invoice's subscription. Events rendered at Stripe API 2025-03-31 or later (both accounts send
 * 2026-06-24.dahlia) move it from `invoice.subscription` to `invoice.parent.subscription_details.subscription`.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parent = (invoice as Stripe.Invoice & {
    parent?: { subscription_details?: { subscription?: string | { id?: string | null } | null } | null } | null;
  }).parent;
  return stripeObjectId(invoice.subscription) ?? stripeObjectId(parent?.subscription_details?.subscription);
}

export function applyCustomerInvoiceEvent(
  accounts: CustomerAccountStore,
  invoice: Stripe.Invoice,
  paid: boolean,
): CustomerAccount | null {
  const subscriptionId = invoiceSubscriptionId(invoice);
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
