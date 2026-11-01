import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { ZENOD_CHECKOUT_SUBMIT_MESSAGE, subscriptionFreePeriod } from "../src/customerBilling.js";

// EPIC-7 T5: the "free" copy follows the Stripe discount on the subscription, for any user.
const START = Date.parse("2026-11-01T00:00:00Z") / 1000;
const END = Date.parse("2026-12-01T00:00:00Z") / 1000;

function coupon(duration: Stripe.Coupon.Duration, percentOff: number | null = 100): Stripe.Coupon {
  return { id: `c_${duration}`, object: "coupon", duration, percent_off: percentOff } as Stripe.Coupon;
}

function subscription(extra: Record<string, unknown>): Stripe.Subscription {
  return {
    id: "sub_free",
    object: "subscription",
    status: "active",
    current_period_start: START,
    current_period_end: END,
    discounts: [],
    ...extra,
  } as unknown as Stripe.Subscription;
}

describe("subscriptionFreePeriod", () => {
  it("is not free without a discount", () => {
    expect(subscriptionFreePeriod(subscription({}))).toEqual({ fully_discounted: false, free_until: null });
  });

  it("is not free with a partial discount", () => {
    const sub = subscription({ discount: { coupon: coupon("repeating", 50), end: END } });
    expect(subscriptionFreePeriod(sub)).toEqual({ fully_discounted: false, free_until: null });
  });

  it("reads a 1-month 100% code from the legacy single discount", () => {
    const sub = subscription({ discount: { coupon: coupon("repeating"), end: END } });
    expect(subscriptionFreePeriod(sub)).toEqual({ fully_discounted: true, free_until: "2026-12-01T00:00:00.000Z" });
  });

  it("reads an expanded discounts list, including the newer source.coupon shape", () => {
    const sub = subscription({ discounts: [{ source: { coupon: coupon("repeating") }, end: END }] });
    expect(subscriptionFreePeriod(sub).free_until).toBe("2026-12-01T00:00:00.000Z");
  });

  it("extends through the next period when a once 100% coupon covers the renewal", () => {
    const sub = subscription({
      discounts: [
        { coupon: coupon("repeating"), end: END },
        { coupon: coupon("once"), end: null },
      ],
    });
    expect(subscriptionFreePeriod(sub)).toEqual({ fully_discounted: true, free_until: "2027-01-01T00:00:00.000Z" });
  });

  it("is free with no end date for a forever 100% coupon", () => {
    const sub = subscription({ discounts: [{ coupon: coupon("forever"), end: null }] });
    expect(subscriptionFreePeriod(sub)).toEqual({ fully_discounted: true, free_until: null });
  });

  it("ignores discounts whose coupon is not expanded", () => {
    const sub = subscription({ discounts: ["di_123", { coupon: "c_unknown", end: END }] });
    expect(subscriptionFreePeriod(sub)).toEqual({ fully_discounted: false, free_until: null });
  });
});

describe("checkout wording", () => {
  it("says plainly that a full-price code needs no card and charges nothing", () => {
    expect(ZENOD_CHECKOUT_SUBMIT_MESSAGE).toMatch(/€0/);
    expect(ZENOD_CHECKOUT_SUBMIT_MESSAGE).toMatch(/no card or payment details are needed/);
    expect(ZENOD_CHECKOUT_SUBMIT_MESSAGE).toMatch(/you will not be charged/);
    expect(ZENOD_CHECKOUT_SUBMIT_MESSAGE).not.toMatch(/tester/i);
    // Stripe caps custom_text messages at 1200 characters.
    expect(ZENOD_CHECKOUT_SUBMIT_MESSAGE.length).toBeLessThan(1200);
  });
});
