import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  decideMonthEnd,
  ENDED_FREE_TIME,
  ENDED_SAFE,
  EXTENDED_BY_US,
  isTesterSubscription,
  lastUsedFromTenantData,
  oneMonthAfter,
  TESTER_EXTENSION_COUPON_ID,
  TesterMonthEnd,
  type MonthEndAccount,
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

const extendedMark = (s: Stripe.Subscription) =>
  ({ zenod_tester: "1", zenod_tester_month_end: EXTENDED_BY_US, zenod_tester_extended_for: String(s.current_period_end) });

const decide = (s: Stripe.Subscription, nextInvoiceCents: number | null = 900) => decideMonthEnd({ sub: s, nowMs: NOW, nextInvoiceCents });

describe("the tester month-end rule (round 3: no free month renews by itself)", () => {
  it("knows a tester by the tester coupons or the tag", () => {
    expect(isTesterSubscription(sub())).toBe(true);
    expect(isTesterSubscription(sub({ discounts: [], metadata: { zenod_tester: "1" } }))).toBe(true);
    expect(isTesterSubscription(sub({ discounts: [] }))).toBe(false);
  });

  it("ends every free month we did not extend, and alerts the team, however much the tester uses Zenod", () => {
    expect(decide(sub())).toEqual({ action: "end", reason: "free_time_over", exception: "free_time_ending" });
    // even when the next invoice would already be €0 by some other coupon
    expect(decide(sub(), 0).action).toBe("end");
  });

  it("waits until six days before the end", () => {
    expect(decide(sub({ renewsInDays: 7 })).action).toBe("none");
    expect(decide(sub({ renewsInDays: 6 })).action).toBe("end");
  });

  it("leaves a month we extended alone while its next invoice is €0, and ends it when not", () => {
    const s = sub();
    s.metadata = extendedMark(s);
    expect(decide(s, 0)).toEqual({ action: "none", reason: "extended_by_us" });
    expect(decide(s, 900)).toEqual({ action: "end", reason: "extension_not_free", exception: "not_free_ended_instead" });
  });

  it("an extension covers one month only: the next period ends unless we extend again", () => {
    const s = sub();
    s.metadata = { ...extendedMark(s), zenod_tester_extended_for: String(s.current_period_end - 30 * 86_400) };
    expect(decide(s, 0).action).toBe("end");
  });

  it("never brings back an ending month by itself, and reports an unpaid renewal", () => {
    const ending = sub({ cancel_at_period_end: true, metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_FREE_TIME } });
    expect(decide(ending)).toEqual({ action: "none", reason: "ending" });
    expect(decide(sub({ status: "past_due" })).exception).toBe("renewal_past_due");
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

const account = (subscriptionId: string, tenantId: string): MonthEndAccount => ({
  subscriptionId,
  tenantId,
  who: `${tenantId}@example.com`,
  usage: async () => ({ spendUsd: 1.234, allowanceUsd: 3, percentUsed: 41 }),
});

function job(stripe: MonthEndStripe, ids: string[], alerts: Array<[string, Record<string, string | number> | undefined]> = []) {
  return new TesterMonthEnd({
    stripe,
    accounts: () => ids.map((id) => account(id, `t_${id}`)),
    lastUsed: () => NOW - 2 * DAY,
    now: () => NOW,
    alert: (reason, fields) => alerts.push([reason, fields]),
    log: () => {},
  });
}

describe("TesterMonthEnd.runOnce", () => {
  it("ends the free month of an active tester and tells the team with their usage", async () => {
    const subs = { sub_a: sub({ id: "sub_a" }), sub_c: sub({ id: "sub_c", discounts: [] }) };
    const { stripe, updates } = fakeStripe(subs);
    const alerts: Array<[string, Record<string, string | number> | undefined]> = [];
    const results = await job(stripe, ["sub_a", "sub_c", "sub_a"], alerts).runOnce();
    expect(results.map((r) => [r.subscriptionId, r.action, r.reason])).toEqual([
      ["sub_a", "end", "free_time_over"],
      ["sub_c", "none", "not_a_tester"],
    ]);
    expect(updates).toEqual([
      { id: "sub_a", params: { cancel_at_period_end: true, metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_FREE_TIME } } },
    ]);
    expect(alerts).toEqual([
      ["free_time_ending", { days_left: 3, ai_usd: "1.23", cap_usd: 3, ai_pct: 41, last_used_days: 2 }],
    ]);
    // the next pass changes nothing and does not alert again
    expect((await job(stripe, ["sub_a"], alerts).runOnce()).map((r) => r.reason)).toEqual(["ending"]);
    expect(updates).toHaveLength(1);
    expect(alerts).toHaveLength(1);
  });

  it("alerts when Stripe refuses to end it", async () => {
    const alerts: Array<[string, Record<string, string | number> | undefined]> = [];
    const [result] = await job(fakeStripe({ sub_a: sub({ id: "sub_a" }) }, { failUpdate: true }).stripe, ["sub_a"], alerts).runOnce();
    expect(result!.action).toBe("failed");
    expect(alerts.map(([r]) => r)).toEqual(["no_subscription_write", "end_failed"]);
  });
});

describe("the team gives one more free month", () => {
  it("extends one tester, takes back the end, and the job then leaves that month alone", async () => {
    const subs = { sub_a: sub({ id: "sub_a" }) };
    const { stripe } = fakeStripe(subs);
    const alerts: Array<[string, Record<string, string | number> | undefined]> = [];
    const monthEnd = job(stripe, ["sub_a"], alerts);
    await monthEnd.runOnce();
    expect(subs.sub_a.cancel_at_period_end).toBe(true);

    const given = await monthEnd.extendByUs("sub_a");
    expect(given).toEqual({ ok: true, freeUntilMs: oneMonthAfter(subs.sub_a.current_period_end * 1000) });
    expect(subs.sub_a.cancel_at_period_end).toBe(false);
    expect(subs.sub_a.metadata).toMatchObject(extendedMark(subs.sub_a));

    expect((await monthEnd.runOnce()).map((r) => r.reason)).toEqual(["extended_by_us"]);
    expect(subs.sub_a.cancel_at_period_end).toBe(false);
  });

  it("refuses an account that is not a tester or has ended", async () => {
    const { stripe } = fakeStripe({ sub_c: sub({ id: "sub_c", discounts: [] }), sub_e: sub({ id: "sub_e", status: "canceled" }) });
    const monthEnd = job(stripe, []);
    expect(await monthEnd.extendByUs("sub_c")).toEqual({ ok: false, reason: "not_a_tester" });
    expect(await monthEnd.extendByUs("sub_e")).toEqual({ ok: false, reason: "not_running" });
  });

  for (const [what, options] of [
    ["the extension is refused", { failDiscount: true }],
    ["the next bill is still not free", { neverFree: true }],
  ] as const) {
    it(`never bills: ends the free month instead when ${what}`, async () => {
      const subs = { sub_a: sub({ id: "sub_a", renewsInDays: 20 }) };
      const alerts: Array<[string, Record<string, string | number> | undefined]> = [];
      const result = await job(fakeStripe(subs, options).stripe, ["sub_a"], alerts).extendByUs("sub_a");
      expect(result).toEqual({ ok: false, reason: "not_free_ended_instead" });
      expect(subs.sub_a.cancel_at_period_end).toBe(true);
      expect(subs.sub_a.metadata.zenod_tester_month_end).toBe(ENDED_SAFE);
      expect(alerts.map(([r]) => r)).toEqual(["not_free_ended_instead"]);
    });
  }

  it("lists each tester's free time for the operator's page", async () => {
    const extended = sub({ id: "sub_b", renewsInDays: 10 });
    extended.metadata = extendedMark(extended);
    const { stripe } = fakeStripe({
      sub_a: sub({ id: "sub_a", renewsInDays: 20 }),
      sub_b: extended,
      sub_c: sub({ id: "sub_c", discounts: [] }),
      sub_d: sub({ id: "sub_d", cancel_at_period_end: true }),
    });
    const rows = await job(stripe, ["sub_a", "sub_b", "sub_c", "sub_d"]).overview();
    expect(rows.map((r) => [r.subscriptionId, r.state, r.who])).toEqual([
      ["sub_d", "ending", "t_sub_d@example.com"],
      ["sub_b", "extended", "t_sub_b@example.com"],
      ["sub_a", "free", "t_sub_a@example.com"],
    ]);
    expect(rows[0]!.usage).toEqual({ spendUsd: 1.234, allowanceUsd: 3, percentUsed: 41 });
  });

  it("one month after keeps the day, or the month's last day", () => {
    expect(new Date(oneMonthAfter(Date.parse("2026-11-10T18:00:00Z"))).toISOString()).toBe("2026-12-10T18:00:00.000Z");
    expect(new Date(oneMonthAfter(Date.parse("2027-01-31T00:00:00Z"))).toISOString()).toBe("2027-02-28T00:00:00.000Z");
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
