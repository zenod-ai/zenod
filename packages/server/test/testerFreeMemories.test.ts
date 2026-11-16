// E26-S29: the tester offer is a consumption trial, the first N memories free with no time limit.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { offerCheckoutMessage, offerMail } from "../src/endOfTestOffer.js";
import { testerMail } from "../src/testerFlow.js";
import {
  DEFAULT_TESTER_FREE_MEMORIES,
  freeMemoriesOffer,
  mountTesterOffer,
  tenantSavedMemories,
  testerCheckoutMessage,
  testerFreeMemories,
  TESTER_OFFER_PATH,
} from "../src/testerFreeMemories.js";
import { joinPage } from "../src/testerInvite.js";
import {
  decideMonthEnd,
  ENDED_FREE_TIME,
  TESTER_EXTENSION_COUPON_ID,
  TesterMonthEnd,
  type MonthEndStripe,
} from "../src/testerMonthEnd.js";
import { testerThanksMail } from "../src/testerOnboarding.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-15T12:00:00Z");

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

describe("the free memories setting", () => {
  it("is 30 by default and one env setting changes it", () => {
    expect(DEFAULT_TESTER_FREE_MEMORIES).toBe(30);
    expect(testerFreeMemories({})).toBe(30);
    expect(testerFreeMemories({ ZENOD_TESTER_FREE_MEMORIES: "100" })).toBe(100);
    expect(testerFreeMemories({ ZENOD_TESTER_FREE_MEMORIES: " 25 " })).toBe(25);
  });

  it("ignores a value that is not a whole number from 1 up", () => {
    for (const bad of ["0", "-5", "abc", "12.5", "", "9999999"]) {
      expect(testerFreeMemories({ ZENOD_TESTER_FREE_MEMORIES: bad })).toBe(30);
    }
  });

  it("says the offer the same way everywhere", () => {
    expect(freeMemoriesOffer(50)).toBe("Your first 50 memories free. No card.");
    expect(testerCheckoutMessage(30)).toContain("Your first 30 memories are free, with no time limit.");
    expect(testerCheckoutMessage(30)).toContain("€0");
  });

  it("serves the number to the testers page", async () => {
    const app = new Hono();
    mountTesterOffer(app, 40);
    const res = await app.request(TESTER_OFFER_PATH);
    expect(await res.json()).toEqual({ free_memories: 40, line: "Your first 40 memories free. No card." });
  });
});

describe("the free memories counter", () => {
  it("counts every finished save of the tenant, and nothing else", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zenod-free-memories-"));
    mkdirSync(join(dataDir, "t1"));
    const db = new DatabaseSync(join(dataDir, "t1", "tasks.sqlite"));
    db.exec("CREATE TABLE task_jobs (id TEXT, tenant_id TEXT, kind TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, input_json TEXT)");
    const add = db.prepare("INSERT INTO task_jobs VALUES (?, ?, ?, ?, 0, ?, '{}')");
    add.run("a", "t1", "store", "done", NOW - 90 * DAY); // older than a month still counts: no time limit
    add.run("b", "t1", "media_ingest", "done", NOW);
    add.run("c", "t1", "store", "failed", NOW);
    add.run("d", "t1", "chat", "done", NOW);
    add.run("e", "t2", "store", "done", NOW);
    db.close();
    expect(tenantSavedMemories(dataDir, "t1")).toBe(2);
    expect(tenantSavedMemories(dataDir, "nobody")).toBe(0);
    expect(tenantSavedMemories(dataDir, null)).toBe(0);
  });
});

describe("the month-end rule with free memories", () => {
  const decide = (s: Stripe.Subscription, used: number) =>
    decideMonthEnd({ sub: s, nowMs: NOW, nextInvoiceCents: null, freeMemories: { used, limit: 50 } });

  it("gives the next month free while the tester has free memories left", () => {
    expect(decide(sub(), 0)).toEqual({ action: "extend", reason: "free_memories_left" });
    expect(decide(sub(), 49)).toEqual({ action: "extend", reason: "free_memories_left" });
  });

  it("ends the free time at the period end once the free memories are used", () => {
    expect(decide(sub(), 50)).toEqual({ action: "end", reason: "free_time_over", exception: "free_time_ending" });
    expect(decide(sub(), 80).action).toBe("end");
  });

  it("brings back a month the old one-month rule set to end, while memories are left", () => {
    const ending = sub({ cancel_at_period_end: true, metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_FREE_TIME } });
    expect(decide(ending, 3)).toEqual({ action: "extend", reason: "free_memories_left" });
    expect(decide(ending, 50)).toEqual({ action: "none", reason: "ending" });
  });

  it("still waits until six days before the period end", () => {
    expect(decide(sub({ renewsInDays: 10 }), 0).action).toBe("none");
  });
});

function fakeStripe(subs: Record<string, Stripe.Subscription>, neverFree = false) {
  const updates: Array<{ id: string; params: Stripe.SubscriptionUpdateParams }> = [];
  const stripe: MonthEndStripe = {
    subscriptions: {
      retrieve: async (id) => subs[id]!,
      update: async (id, params) => {
        if (!subs[id]) throw Object.assign(new Error("missing"), { statusCode: 404 });
        updates.push({ id, params });
        const current = subs[id]!;
        subs[id] = {
          ...current,
          ...(params.cancel_at_period_end !== undefined ? { cancel_at_period_end: params.cancel_at_period_end } : {}),
          metadata: { ...current.metadata, ...(params.metadata as Record<string, string>) },
          discounts: params.discounts ? params.discounts.map((d) => ({ id: "di_x", coupon: { id: d.coupon } })) : current.discounts,
        } as Stripe.Subscription;
        return subs[id]!;
      },
    },
    invoices: {
      createPreview: async (params) => {
        const s = subs[params.subscription!]!;
        const free = (s.discounts as unknown as Array<{ coupon: { id: string } }>).some((d) => d.coupon.id === TESTER_EXTENSION_COUPON_ID);
        return { total: free && !neverFree ? 0 : 900 } as Stripe.UpcomingInvoice;
      },
    },
  };
  return { stripe, updates };
}

function job(stripe: MonthEndStripe, saved: number) {
  const alerts: Array<[string, Record<string, string | number> | undefined]> = [];
  const offers: string[] = [];
  const monthEnd = new TesterMonthEnd({
    stripe,
    freeMemories: 50,
    accounts: () => [{
      subscriptionId: "sub_1",
      tenantId: "t1",
      accountId: "acct_1",
      email: "tester@example.com",
      savedMemories: () => saved,
      usage: async () => ({ spendUsd: 0.5, allowanceUsd: 3, percentUsed: 17 }),
    }],
    lastUsed: () => NOW - DAY,
    now: () => NOW,
    alert: (reason, fields) => alerts.push([reason, fields]),
    log: () => {},
    onFreeTimeEnding: (account) => offers.push(account.subscriptionId),
  });
  return { monthEnd, alerts, offers };
}

describe("TesterMonthEnd with free memories", () => {
  it("under the cap: the next month is put at €0 by itself, no end, no offer, no alert", async () => {
    const subs = { sub_1: sub() };
    const { stripe, updates } = fakeStripe(subs);
    const { monthEnd, alerts, offers } = job(stripe, 12);
    const [result] = await monthEnd.runOnce();
    expect(result).toMatchObject({ action: "extend", reason: "free_memories_left" });
    expect(updates.find((u) => u.params.discounts)?.params).toMatchObject({
      cancel_at_period_end: false,
      discounts: [{ coupon: TESTER_EXTENSION_COUPON_ID }],
    });
    expect(subs.sub_1.cancel_at_period_end).toBe(false);
    expect(offers).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it("at the cap: the free time ends at the period end, the team hears the count, the offer goes out", async () => {
    const subs = { sub_1: sub() };
    const { stripe } = fakeStripe(subs);
    const { monthEnd, alerts, offers } = job(stripe, 50);
    const [result] = await monthEnd.runOnce();
    expect(result).toMatchObject({ action: "end", reason: "free_time_over" });
    expect(subs.sub_1.cancel_at_period_end).toBe(true);
    expect(subs.sub_1.metadata.zenod_tester_month_end).toBe(ENDED_FREE_TIME);
    expect(offers).toEqual(["sub_1"]);
    expect(alerts[0]?.[0]).toBe("free_time_ending");
    expect(alerts[0]?.[1]).toMatchObject({ saved: 50, free_memories: 50 });
  });

  it("never bills: when Stripe does not confirm €0 for the next month, it ends instead", async () => {
    const subs = { sub_1: sub() };
    const { stripe } = fakeStripe(subs, true);
    const { monthEnd, alerts } = job(stripe, 5);
    const [result] = await monthEnd.runOnce();
    expect(result).toMatchObject({ action: "end", reason: "extension_not_free" });
    expect(subs.sub_1.cancel_at_period_end).toBe(true);
    expect(alerts.map(([reason]) => reason)).toContain("not_free_ended_instead");
  });
});

describe("the words a tester reads", () => {
  it("the invite email, the join page and the thank-you email name the free memories", () => {
    const invite = testerMail("a@example.com", "https://cloud.zenod.dev/join?code=ZT-ABC", "1 December", 50);
    expect(invite.text).toContain("Your first 50 memories are free, with no time limit.");
    expect(invite.text).not.toContain("free month");
    expect(joinPage("ZT-ABC", ["google"], 50)).toContain("Your first 50 memories free. No card.");
    expect(testerThanksMail("a@example.com", "Ana", 50).text).toContain("Your first 50 memories are free, with no card and no time limit.");
  });

  it("the end-of-test email says the free memories were used and that the notes stay theirs", () => {
    const mail = offerMail("a@example.com", { freeEndsMs: NOW + 3 * DAY, payUrl: "https://cloud.zenod.dev/keep-zenod", freeMemories: 50 });
    expect(mail.subject).toBe("You have saved your 50 free Zenod memories");
    expect(mail.text).toContain("You have saved your first 50 memories, the free part of your test. Zenod stays free until 18 November.");
    expect(mail.text).toContain("Your notes stay yours.");
    expect(offerCheckoutMessage(Math.floor((NOW + 3 * DAY) / 1000))).toContain("when your free time ends");
  });
});
