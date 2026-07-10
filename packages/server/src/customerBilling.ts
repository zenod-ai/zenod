import type Stripe from "stripe";
import { CustomerAccountStore, customerAccountId, type CustomerAccount } from "./customerAccounts.js";

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
  webhooks: {
    constructEvent(payload: string | Buffer, signature: string, secret: string): Stripe.Event;
  };
}

export interface CheckoutOwner {
  github_id: number;
  login: string;
}

export type CheckoutTier = "monthly" | "yearly";

export interface CustomerBillingConfig {
  domain: string;
  stripeMode: "test" | "live";
  stripeWebhookSecret: string;
  prices: Record<CheckoutTier, string | undefined>;
}

export interface CustomerProductConfig {
  product: string;
  unit: string;
  defaultDomain: string;
  signInToLanding?: boolean;
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
    prices: {
      monthly: env.PRICE_MONTHLY,
      yearly: env.PRICE_YEARLY,
    },
  };
}

export function resolveCheckoutTier(
  input: unknown,
  config: CustomerBillingConfig,
): { tier: CheckoutTier; price: string } | { error: string } {
  const raw = String(input || "monthly").toLowerCase();
  const tier = raw === "starter" ? "monthly" : raw === "pro" ? "yearly" : raw;
  if (tier !== "monthly" && tier !== "yearly") {
    return { error: `unknown tier "${raw}" (use monthly|yearly)` };
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
  const accountId = customerAccountId(owner.github_id);
  const metadata = { product: product.product, unit: product.unit, tier: checkout.tier, account_id: accountId };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: checkout.price, quantity: 1 }],
    client_reference_id: accountId,
    metadata,
    subscription_data: { metadata },
    success_url: `${config.domain}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.domain}/pricing?checkout=cancelled`,
  });
  accounts.upsert(session.id, {
    account_id: accountId,
    product: product.product,
    tier: checkout.tier,
    stripe_client_reference_id: accountId,
    subscription_status: "checkout_pending",
    github_id: owner.github_id,
    github_login: owner.login,
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
    stripe_subscription_id:
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
    subscription_status: "active",
    checkout_completed_at: new Date().toISOString(),
  });
  return "completed";
}
