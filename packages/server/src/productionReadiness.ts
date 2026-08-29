export const ZENOD_LEGAL_VERSION = "2026-08-26";

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ProductionReadinessReport {
  ready: boolean;
  publicPaidSignup: boolean;
  checks: ReadinessCheck[];
}

function isRecentIsoDate(value: string | undefined, now: Date, maxAgeDays: number): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return false;
  return now.getTime() - timestamp <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export function productionReadinessReport(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): ProductionReadinessReport {
  const stripeMode = env.STRIPE_MODE === "live" ? "live" : "test";
  const taxMode = env.STRIPE_TAX_MODE;
  const accountStateSecret = env.ACCOUNT_STATE_SECRET ?? "";
  const customerAppUrl = env.CUSTOMER_APP_URL ?? "";
  const checks: ReadinessCheck[] = [
    {
      id: "customer_origin",
      ok: customerAppUrl.startsWith("https://") && !customerAppUrl.includes("localhost"),
      detail: customerAppUrl.startsWith("https://") && !customerAppUrl.includes("localhost")
        ? "The customer app uses an explicit HTTPS origin"
        : "CUSTOMER_APP_URL must be an explicit public HTTPS origin",
    },
    {
      id: "session_secret",
      ok: accountStateSecret.length >= 32 && accountStateSecret !== env.STRIPE_WEBHOOK_SECRET,
      detail: accountStateSecret.length >= 32 && accountStateSecret !== env.STRIPE_WEBHOOK_SECRET
        ? "Customer sessions use a dedicated secret"
        : "ACCOUNT_STATE_SECRET must be a dedicated secret of at least 32 characters",
    },
    {
      id: "stripe_mode",
      ok: stripeMode === "live",
      detail: stripeMode === "live" ? "Stripe is in live mode" : "Stripe is still in test mode",
    },
    {
      id: "stripe_key",
      ok: Boolean(env.STRIPE_SECRET_KEY?.startsWith("sk_live_")),
      detail: env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "Live Stripe key is configured" : "Live Stripe key is missing",
    },
    {
      id: "stripe_webhook",
      ok:
        Boolean(env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) &&
        isRecentIsoDate(env.ZENOD_STRIPE_WEBHOOK_VERIFIED_AT, now, 31),
      detail:
        env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_") &&
        isRecentIsoDate(env.ZENOD_STRIPE_WEBHOOK_VERIFIED_AT, now, 31)
          ? "A signed live Stripe webhook was verified within 31 days"
          : "Live Stripe webhook verification is missing or stale",
    },
    {
      id: "stripe_prices",
      ok: Boolean(env.PRICE_MONTHLY?.startsWith("price_")),
      detail: env.PRICE_MONTHLY?.startsWith("price_")
        ? "The monthly Hosted price is configured"
        : "The monthly Hosted price is missing",
    },
    {
      id: "stripe_tax",
      ok: taxMode === "automatic" ? env.STRIPE_AUTOMATIC_TAX === "1" : taxMode === "manual",
      detail:
        taxMode === "automatic" && env.STRIPE_AUTOMATIC_TAX === "1"
          ? "Stripe automatic tax is enabled"
          : taxMode === "manual"
            ? "Manual tax handling is explicitly selected"
            : "Tax handling has not been explicitly configured",
    },
    {
      id: "legal_version",
      ok: env.ZENOD_LEGAL_VERSION === ZENOD_LEGAL_VERSION,
      detail:
        env.ZENOD_LEGAL_VERSION === ZENOD_LEGAL_VERSION
          ? `Legal version ${ZENOD_LEGAL_VERSION} is acknowledged`
          : `Set ZENOD_LEGAL_VERSION=${ZENOD_LEGAL_VERSION} after review`,
    },
    {
      id: "support_contact",
      ok: Boolean(env.ZENOD_SUPPORT_EMAIL?.includes("@")),
      detail: env.ZENOD_SUPPORT_EMAIL?.includes("@") ? "Support contact is configured" : "Support email is missing",
    },
    {
      id: "billing_portal",
      ok: isRecentIsoDate(env.ZENOD_STRIPE_PORTAL_VERIFIED_AT, now, 31),
      detail: isRecentIsoDate(env.ZENOD_STRIPE_PORTAL_VERIFIED_AT, now, 31)
        ? "The live customer billing portal was verified within 31 days"
        : "Live billing portal verification is missing or stale",
    },
    {
      id: "stripe_profile",
      ok: isRecentIsoDate(env.ZENOD_STRIPE_PROFILE_VERIFIED_AT, now, 90),
      detail: isRecentIsoDate(env.ZENOD_STRIPE_PROFILE_VERIFIED_AT, now, 90)
        ? "The live Stripe customer-facing profile was verified within 90 days"
        : "The live Stripe support and business profile has not been verified recently",
    },
    {
      id: "live_billing_journey",
      ok: isRecentIsoDate(env.ZENOD_LIVE_BILLING_VERIFIED_AT, now, 90),
      detail: isRecentIsoDate(env.ZENOD_LIVE_BILLING_VERIFIED_AT, now, 90)
        ? "A real live-mode billing journey was verified within 90 days"
        : "No recent real live-mode billing journey is recorded",
    },
    {
      id: "backup_restore",
      ok: isRecentIsoDate(env.ZENOD_BACKUP_RESTORE_VERIFIED_AT, now, 31),
      detail: isRecentIsoDate(env.ZENOD_BACKUP_RESTORE_VERIFIED_AT, now, 31)
        ? "A backup restore was verified within 31 days"
        : "No recent backup restore verification is recorded",
    },
  ];
  return {
    ready: checks.every((check) => check.ok),
    publicPaidSignup: env.ZENOD_PUBLIC_PAID_SIGNUP === "1",
    checks,
  };
}

export function checkoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.STRIPE_MODE === "live") {
    const report = productionReadinessReport(env);
    return env.ZENOD_PUBLIC_PAID_SIGNUP === "1" && report.ready;
  }
  return env.ZENOD_ALLOW_TEST_CHECKOUT === "1";
}

export function checkoutEnabledForOwner(
  owner: number | { user_id: string; github_id?: number | null },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (checkoutEnabled(env)) return true;
  if (env.STRIPE_MODE !== "live") return false;
  const githubId = typeof owner === "number" ? owner : owner.github_id;
  const githubAllowed = (env.ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .some((value) => Number.isSafeInteger(value) && value > 0 && value === githubId);
  if (githubAllowed) return true;
  if (typeof owner === "number") return false;
  return (env.ZENOD_LIVE_CHECKOUT_TESTER_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .some((value) => Boolean(value) && value === owner.user_id);
}

export function assertPublicSignupIsReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.ZENOD_PUBLIC_PAID_SIGNUP !== "1") return;
  const report = productionReadinessReport(env);
  if (report.ready) return;
  const failed = report.checks.filter((check) => !check.ok).map((check) => check.id).join(", ");
  throw new Error(`ZENOD_PUBLIC_PAID_SIGNUP=1 but production readiness checks failed: ${failed}`);
}
