import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  assertPublicSignupIsReady,
  checkoutEnabled,
  checkoutEnabledForOwner,
  productionReadinessReport,
  ZENOD_LEGAL_VERSION,
} from "../src/productionReadiness.js";

const readyEnv: NodeJS.ProcessEnv = {
  CUSTOMER_APP_URL: "https://cloud.zenod.dev",
  ACCOUNT_STATE_SECRET: "dedicated-account-state-secret-1234567890",
  STRIPE_MODE: "live",
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
  ZENOD_STRIPE_WEBHOOK_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
  ZENOD_STRIPE_PORTAL_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
  ZENOD_STRIPE_PROFILE_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
  ZENOD_LIVE_BILLING_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
  PRICE_MONTHLY: "price_monthly_live",
  STRIPE_TAX_MODE: "automatic",
  STRIPE_AUTOMATIC_TAX: "1",
  ZENOD_LEGAL_VERSION,
  ZENOD_SUPPORT_EMAIL: "support@zenod.dev",
  ZENOD_BACKUP_RESTORE_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
  ZENOD_PUBLIC_PAID_SIGNUP: "1",
};

const googleReadyEnv: NodeJS.ProcessEnv = {
  ...readyEnv,
  ZENOD_PUBLIC_GOOGLE_SIGNUP: "1",
  GOOGLE_OIDC_CLIENT_ID: "google-oidc-client",
  GOOGLE_OIDC_CLIENT_SECRET: "google-oidc-secret",
  GOOGLE_OIDC_CALLBACK_URL: "https://cloud.zenod.dev/auth/google/callback",
  ZENOD_GOOGLE_DRIVE_VAULT_OAUTH_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
  ZENOD_GDV_ACCEPTANCE_SHA: "a".repeat(40),
  ZENOD_GDV_ACCEPTANCE_VERIFIED_AT: "2026-08-12T00:00:00.000Z",
};

describe("production readiness gate", () => {
  it("pins the current one-plan Terms and legal version", async () => {
    const terms = await readFile(
      new URL("../../../apps/site/public/legal/terms.html", import.meta.url),
      "utf8",
    );
    expect(terms).toContain("Version 2026-08-29");
    expect(terms).toContain("€9 per month plus applicable VAT");
    expect(terms).toContain("managed AI usage and WhatsApp access");
    expect(terms).not.toMatch(/€5|€50|monthly and yearly|annual plan/i);

    const privacy = await readFile(
      new URL("../../../apps/site/public/legal/privacy.html", import.meta.url),
      "utf8",
    );
    const handling = await readFile(
      new URL("../../../apps/site/public/legal/data-handling.html", import.meta.url),
      "utf8",
    );
    for (const document of [terms, privacy, handling]) {
      expect(document).toContain("Version 2026-08-29");
      expect(document).toMatch(/GitHub/);
      expect(document).toMatch(/Google Drive|Drive vault/);
      expect(document).toMatch(/Markdown/);
    }
  });

  it("keeps GitHub signup readiness independent of Google-only acceptance", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    const report = productionReadinessReport(readyEnv, now);
    expect(report).toMatchObject({ ready: true, publicGoogleSignup: false, googleSignupReady: false });
    expect(report.checks.map((check) => check.id)).not.toContain("google_drive_vault_acceptance");
  });

  it("opens Google signup only with OAuth/config/legal and exact-commit acceptance evidence", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(productionReadinessReport(googleReadyEnv, now)).toMatchObject({
      ready: true,
      publicGoogleSignup: true,
      googleSignupReady: true,
    });
    expect(() => assertPublicSignupIsReady(googleReadyEnv)).not.toThrow();

    const missingEvidence = {
      ...googleReadyEnv,
      ZENOD_GDV_ACCEPTANCE_SHA: undefined,
      ZENOD_GOOGLE_DRIVE_VAULT_OAUTH_VERIFIED_AT: undefined,
    };
    const report = productionReadinessReport(missingEvidence, now);
    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(
      expect.arrayContaining(["google_drive_vault_oauth", "google_drive_vault_acceptance"]),
    );
    expect(() => assertPublicSignupIsReady(missingEvidence)).toThrow(/google_drive_vault/);
  });

  it("opens paid signup only when every live requirement is evidenced", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(productionReadinessReport(readyEnv, now)).toMatchObject({ ready: true, publicPaidSignup: true });
    expect(checkoutEnabled(readyEnv)).toBe(true);
    expect(() => assertPublicSignupIsReady(readyEnv)).not.toThrow();
    expect(productionReadinessReport(readyEnv, now).checks.find((check) => check.id === "stripe_prices")).toEqual({
      id: "stripe_prices",
      ok: true,
      detail: "The monthly Hosted price is configured",
    });
  });

  it("does not accept a legacy yearly price in place of the monthly Hosted price", () => {
    const report = productionReadinessReport({
      ...readyEnv,
      PRICE_MONTHLY: undefined,
      PRICE_YEARLY: "price_legacy_yearly",
    }, new Date("2026-08-13T00:00:00.000Z"));
    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === "stripe_prices")).toEqual({
      id: "stripe_prices",
      ok: false,
      detail: "The monthly Hosted price is missing",
    });
  });

  it("fails closed for test Stripe, stale restore evidence, or an unreviewed legal version", () => {
    const env = {
      ...readyEnv,
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_example",
      ZENOD_LEGAL_VERSION: "draft",
      ZENOD_BACKUP_RESTORE_VERIFIED_AT: "2026-01-01T00:00:00.000Z",
    };
    const report = productionReadinessReport(env, new Date("2026-08-13T00:00:00.000Z"));
    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual(
      expect.arrayContaining(["stripe_mode", "stripe_key", "legal_version", "backup_restore"]),
    );
    expect(checkoutEnabled(env)).toBe(false);
    expect(() => assertPublicSignupIsReady(env)).toThrow(/production readiness checks failed/);
  });

  it("allows explicitly enabled Stripe test checkout without claiming production readiness", () => {
    const env = { STRIPE_MODE: "test", ZENOD_ALLOW_TEST_CHECKOUT: "1" };
    expect(checkoutEnabled(env)).toBe(true);
    expect(productionReadinessReport(env).ready).toBe(false);
  });

  it("allows only an explicit GitHub tester to run the closed live billing drill", () => {
    const env = {
      STRIPE_MODE: "live",
      ZENOD_PUBLIC_PAID_SIGNUP: "0",
      ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS: "42, 99",
    };
    expect(checkoutEnabled(env)).toBe(false);
    expect(checkoutEnabledForOwner(42, env)).toBe(true);
    expect(checkoutEnabledForOwner(7, env)).toBe(false);
  });
});
