import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  decideMonthEnd,
  ENDED_INACTIVE,
  ENDED_SAFE,
  isTesterSubscription,
  lastUsedFromTenantData,
  TESTER_EXTENSION_COUPON_ID,
  TesterMonthEnd,
  type MonthEndStripe,
} from "../src/testerMonthEnd.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T18:00:00Z");

function sub(overrides: Partial<Stripe.Subscription> & { renewsInDays?: number } = {}): Stripe.Subscription {
  const { renewsInDays = 3, ...rest } = overrides;
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor((NOW + renewsInDays * DAY) / 1000),
    metadata: {},
    discounts: [{ id: "di_1", coupon: { id: "ZENOD_TESTER_1M" } }],
    ...rest,
  } as unknown as Stripe.Subscription;
}

const decide = (s: Stripe.Subscription, lastUsedMs: number | null, nextInvoiceCents: number | null = 900, overCap = false) =>
  decideMonthEnd({ sub: s, nowMs: NOW, lastUsedMs, nextInvoiceCents, overCap });

describe("the tester month-end rule", () => {
  it("knows a tester by the tester coupons or the tag", () => {
    expect(isTesterSubscription(sub())).toBe(true);
    expect(isTesterSubscription(sub({ discounts: [], metadata: { zenod_tester: "1" } }))).toBe(true);
    expect(isTesterSubscription(sub({ discounts: [] }))).toBe(false);
  });

  it("extends a tester who used Zenod in the last 14 days", () => {
    expect(decide(sub(), NOW - 13 * DAY).action).toBe("extend");
  });

  it("ends a tester gently who did not", () => {
    expect(decide(sub(), NOW - 15 * DAY)).toEqual({ action: "end", reason: "inactive" });
    expect(decide(sub(), null)).toEqual({ action: "end", reason: "inactive" });
  });

  it("waits until six days before renewal", () => {
    expect(decide(sub({ renewsInDays: 7 }), null).action).toBe("none");
    expect(decide(sub({ renewsInDays: 6 }), null).action).toBe("end");
  });

  it("does nothing when the next month is already free or the end is already set", () => {
    expect(decide(sub(), NOW - DAY, 0)).toEqual({ action: "none", reason: "already_free" });
    expect(decide(sub({ cancel_at_period_end: true }), null)).toEqual({ action: "none", reason: "ending" });
  });

  it("keeps on a tester who comes back before the end", () => {
    const ending = sub({ cancel_at_period_end: true, metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_INACTIVE } });
    expect(decide(ending, NOW - DAY).action).toBe("resume");
    const endedSafe = sub({ cancel_at_period_end: true, metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_SAFE } });
    expect(decide(endedSafe, NOW - DAY).action).toBe("resume");
    expect(decide(endedSafe, NOW - 20 * DAY).action).toBe("none");
    // a subscription the user cancelled themselves stays cancelled
    expect(decide(sub({ cancel_at_period_end: true }), NOW - DAY).action).toBe("none");
  });

  it("alerts only for exceptions", () => {
    expect(decide(sub(), NOW - DAY).exception).toBeUndefined();
    expect(decide(sub(), null).exception).toBeUndefined();
    expect(decide(sub(), NOW - DAY, 900, true)).toEqual({ action: "extend", reason: "active", exception: "extended_over_cap" });
    expect(decide(sub({ status: "past_due" }), NOW - DAY).exception).toBe("renewal_past_due");
  });
});

function fakeStripe(
  subs: Record<string, Stripe.Subscription>,
  options: { failUpdate?: boolean; failDiscount?: boolean; neverFree?: boolean } = {},
) {
  const updates: Array<{ id: string; params: Stripe.SubscriptionUpdateParams }> = [];
  const stripe: MonthEndStripe = {
    subscriptions: {
      retrieve: async (id) => subs[id]!,
      update: async (id, params) => {
        if (options.failUpdate) throw Object.assign(new Error("no permission"), { type: "StripePermissionError", statusCode: 403 });
        if (!subs[id]) throw Object.assign(new Error("missing"), { statusCode: 404 });
        if (options.failDiscount && params.discounts) throw Object.assign(new Error("coupon"), { type: "StripeInvalidRequestError" });
        updates.push({ id, params });
        const current = subs[id]!;
        subs[id] = {
          ...current,
          ...(params.cancel_at_period_end !== undefined ? { cancel_at_period_end: params.cancel_at_period_end } : {}),
          metadata: { ...current.metadata, ...(params.metadata as Record<string, string>) },
          discounts: params.discounts
            ? params.discounts.map((d) => ({ id: "di_x", coupon: { id: d.coupon } }))
            : current.discounts,
        } as Stripe.Subscription;
        return subs[id]!;
      },
    },
    invoices: {
      createPreview: async (params) => {
        const s = subs[params.subscription!]!;
        const free = (s.discounts as unknown as Array<{ coupon: { id: string } }>).some((d) => d.coupon.id === TESTER_EXTENSION_COUPON_ID);
        return { total: free && !options.neverFree ? 0 : 900 } as Stripe.UpcomingInvoice;
      },
    },
  };
  return { stripe, updates };
}

describe("TesterMonthEnd.runOnce", () => {
  const account = (subscriptionId: string, tenantId: string, overCap = false) => ({
    subscriptionId,
    tenantId,
    overCap: async () => overCap,
  });

  it("extends the active tester, ends the inactive one, and alerts for nothing", async () => {
    const subs = { sub_a: sub({ id: "sub_a" }), sub_b: sub({ id: "sub_b" }), sub_c: sub({ id: "sub_c", discounts: [] }) };
    const { stripe, updates } = fakeStripe(subs);
    const alerts: string[] = [];
    const job = new TesterMonthEnd({
      stripe,
      accounts: () => [account("sub_a", "t_a"), account("sub_b", "t_b"), account("sub_c", "t_c"), account("sub_a", "t_a")],
      lastUsed: (tenant) => (tenant === "t_a" ? NOW - DAY : NOW - 30 * DAY),
      now: () => NOW,
      alert: (reason) => alerts.push(reason),
      log: () => {},
    });
    const results = await job.runOnce();
    expect(results.map((r) => [r.subscriptionId, r.action, r.reason])).toEqual([
      ["sub_a", "extend", "active"],
      ["sub_b", "end", "inactive"],
      ["sub_c", "none", "not_a_tester"],
    ]);
    expect(results[0]!.nextInvoiceCentsAfter).toBe(0);
    expect(updates).toEqual([
      {
        id: "sub_a",
        params: {
          discounts: [{ coupon: TESTER_EXTENSION_COUPON_ID }],
          proration_behavior: "none",
          metadata: { zenod_tester: "1", zenod_tester_month_end: "extended" },
        },
      },
      { id: "sub_b", params: { cancel_at_period_end: true, metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_INACTIVE } } },
    ]);
    expect(alerts).toEqual([]);
    // a second pass changes nothing
    expect((await job.runOnce()).map((r) => r.reason)).toEqual(["already_free", "ending", "not_a_tester"]);
    expect(updates).toHaveLength(2);
  });

  it("alerts when Stripe refuses, and for a tester over the cap", async () => {
    const refused = new TesterMonthEnd({
      stripe: fakeStripe({ sub_a: sub({ id: "sub_a" }) }, { failUpdate: true }).stripe,
      accounts: () => [account("sub_a", "t_a")],
      lastUsed: () => NOW - DAY,
      now: () => NOW,
      alert: (reason, fields) => alerts.push(`${reason} ${fields?.error ?? ""}`.trim()),
      log: () => {},
    });
    const alerts: string[] = [];
    expect((await refused.runOnce())[0]!.action).toBe("failed");
    expect(alerts).toEqual(["no_subscription_write", "not_free_end_failed"]);

    alerts.length = 0;
    const capped = new TesterMonthEnd({
      stripe: fakeStripe({ sub_a: sub({ id: "sub_a" }) }).stripe,
      accounts: () => [account("sub_a", "t_a", true)],
      lastUsed: () => NOW - DAY,
      now: () => NOW,
      alert: (reason) => alerts.push(reason),
      log: () => {},
    });
    expect((await capped.runOnce())[0]!.action).toBe("extend");
    expect(alerts).toEqual(["extended_over_cap"]);
  });
});

describe("a tester is never billed by itself", () => {
  const job = (stripe: MonthEndStripe, alerts: string[]) =>
    new TesterMonthEnd({
      stripe,
      accounts: () => [{ subscriptionId: "sub_a", tenantId: "t_a", overCap: async () => false }],
      lastUsed: () => NOW - DAY,
      now: () => NOW,
      alert: (reason) => alerts.push(reason),
      log: () => {},
    });

  for (const [what, options] of [
    ["the extension is refused", { failDiscount: true }],
    ["the next bill is still not free", { neverFree: true }],
  ] as const) {
    it(`ends the free month instead when ${what}`, async () => {
      const subs = { sub_a: sub({ id: "sub_a" }) };
      const alerts: string[] = [];
      const [result] = await job(fakeStripe(subs, options).stripe, alerts).runOnce();
      expect(result!.action).toBe("failed");
      expect(subs.sub_a.cancel_at_period_end).toBe(true);
      expect(subs.sub_a.metadata.zenod_tester_month_end).toBe(ENDED_SAFE);
      expect(alerts).toEqual(["not_free_ended_instead"]);
    });
  }

  it("tries the extension again on the next pass, and keeps the tester on once it works", async () => {
    const subs = { sub_a: sub({ id: "sub_a" }) };
    await job(fakeStripe(subs, { failDiscount: true }).stripe, []).runOnce();
    const [again] = await job(fakeStripe(subs).stripe, []).runOnce();
    expect([again!.action, again!.nextInvoiceCentsAfter]).toEqual(["resume", 0]);
    expect(subs.sub_a.cancel_at_period_end).toBe(false);
  });
});

describe("lastUsedFromTenantData", () => {
  it("takes the newest task or AI call, leaving out the self test", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zenod-month-end-"));
    mkdirSync(join(dataDir, "t1"));
    const tasks = new DatabaseSync(join(dataDir, "t1", "tasks.sqlite"));
    tasks.exec("CREATE TABLE task_jobs (created_at INTEGER, input_json TEXT)");
    tasks.prepare("INSERT INTO task_jobs VALUES (?, ?)").run(1000, '{"source":"whatsapp"}');
    tasks.prepare("INSERT INTO task_jobs VALUES (?, ?)").run(9000, '{"source":"selftest"}');
    tasks.close();
    expect(lastUsedFromTenantData(dataDir, "t1")).toBe(1000);
    const usage = new DatabaseSync(join(dataDir, "t1", "usage.sqlite"));
    usage.exec("CREATE TABLE llm_usage (ts INTEGER)");
    usage.prepare("INSERT INTO llm_usage VALUES (?)").run(5000);
    usage.close();
    expect(lastUsedFromTenantData(dataDir, "t1")).toBe(5000);
    expect(lastUsedFromTenantData(dataDir, "t2")).toBeNull();
    expect(lastUsedFromTenantData(dataDir, null)).toBeNull();
  });
});
