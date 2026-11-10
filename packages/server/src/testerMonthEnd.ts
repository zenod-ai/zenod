// EPIC-26 S5: the tester month end runs by itself. Until now tester-watch alerted five days before
// a tester's free month ended and someone applied the extension by hand (EPIC-7 T4/T8). The rule:
//
//   a tester who used Zenod in the last 14 days gets the next month free too (the `once` 100%
//   extension coupon EPIC-7 T2.1 proved renews at €0 with no card);
//   a tester who did not gets a gentle end: the subscription is set to end at the period end, so no
//   renewal invoice is made and nothing is charged; the account then stops like any ended one (the
//   existing "your notes stay in your vault, to start again open …" notice) and can pay or come back;
//   one who comes back before that end is extended again.
//
// Round 2 (Jordi, 2026-11-10: "what do you mean it renews by itself????"): a tester is never charged
// by itself. When an extension fails or does not leave the next invoice at €0, the job ends that free
// month instead (the same gentle end, so no renewal bill is made) and alerts; if the tester keeps using
// Zenod, the next pass tries the extension again.
//
// The team is alerted only for exceptions: an extension or end that failed (or did not leave the next
// invoice at €0), a tester whose renewal already went past due, and a tester extended while over the
// usage cap. One `[ops-alert] tester <reason>` line each, read by the health page (row 20).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type Stripe from "stripe";
import { opsAlert } from "./opsAlert.js";

export const TESTER_COUPON_IDS = ["ZENOD_TESTER_1M", "ZENOD_TESTER_NEXT_MONTH_FREE"] as const;
export const TESTER_EXTENSION_COUPON_ID = "ZENOD_TESTER_NEXT_MONTH_FREE";
/** "Active" means saved or asked something in this many days before the decision. */
export const TESTER_ACTIVE_DAYS = 14;
/** Decide this many days before renewal: before tester-watch's 5-day renewal alert. */
export const TESTER_DECIDE_DAYS = 6;
/** Marks a subscription this rule set to end, so a comeback can undo it. */
export const ENDED_INACTIVE = "ended_inactive";
/** Marks a subscription ended because its free month could not be confirmed: never bill a tester. */
export const ENDED_SAFE = "ended_not_free";
const RUN_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;
const DAY_MS = 86_400_000;

export type MonthEndAction = "extend" | "end" | "resume" | "none";

export interface MonthEndDecision {
  action: MonthEndAction;
  /** Fixed words: why. */
  reason: string;
  /** Set when a person should look (an exception), with the action still taken when there is one. */
  exception?: string;
}

type DiscountLike = { coupon?: { id?: string | null } | null } | string | null | undefined;

export function isTesterSubscription(sub: Stripe.Subscription): boolean {
  if (sub.metadata?.zenod_tester === "1") return true;
  const legacy = (sub as Stripe.Subscription & { discount?: DiscountLike }).discount;
  const listed = ((sub as { discounts?: DiscountLike[] | null }).discounts ?? []).concat(legacy ? [legacy] : []);
  return listed.some(
    (d) => d && typeof d === "object" && (TESTER_COUPON_IDS as readonly string[]).includes(d.coupon?.id ?? ""),
  );
}

/** The rule, with no I/O. `nextInvoiceCents` is the preview of the renewal invoice (null when unknown). */
export function decideMonthEnd(input: {
  sub: Stripe.Subscription;
  nowMs: number;
  lastUsedMs: number | null;
  nextInvoiceCents: number | null;
  overCap: boolean;
}): MonthEndDecision {
  const { sub, nowMs, lastUsedMs, nextInvoiceCents, overCap } = input;
  if (!isTesterSubscription(sub)) return { action: "none", reason: "not_a_tester" };
  if (sub.status === "past_due" || sub.status === "unpaid") {
    return { action: "none", reason: "past_due", exception: "renewal_past_due" };
  }
  if (sub.status !== "active" && sub.status !== "trialing") return { action: "none", reason: "not_renewing" };
  const active = lastUsedMs !== null && nowMs - lastUsedMs <= TESTER_ACTIVE_DAYS * DAY_MS;
  if (sub.cancel_at_period_end) {
    // Ended by this rule and back in use before the end: keep them on.
    const mark = sub.metadata?.zenod_tester_month_end;
    if ((mark === ENDED_INACTIVE || mark === ENDED_SAFE) && active) return { action: "resume", reason: "came_back" };
    return { action: "none", reason: "ending" };
  }
  if (sub.current_period_end * 1000 - nowMs > TESTER_DECIDE_DAYS * DAY_MS) return { action: "none", reason: "not_due" };
  if (!active) return { action: "end", reason: "inactive" };
  if (nextInvoiceCents === 0) return { action: "none", reason: "already_free" };
  return overCap
    ? { action: "extend", reason: "active", exception: "extended_over_cap" }
    : { action: "extend", reason: "active" };
}

/** The Stripe calls this needs (the customer layer's Stripe client has them). */
export interface MonthEndStripe {
  subscriptions: {
    retrieve(id: string, params?: Stripe.SubscriptionRetrieveParams): Promise<Stripe.Subscription>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
  };
  invoices: {
    createPreview(params: Stripe.InvoiceCreatePreviewParams): Promise<Stripe.UpcomingInvoice>;
  };
}

export interface MonthEndAccount {
  subscriptionId: string;
  tenantId: string | null;
  /** Usage this month at or over the cap. */
  overCap(): Promise<boolean>;
}

export interface MonthEndResult {
  action: MonthEndAction | "failed";
  reason: string;
  exception?: string;
  /** For the proof: the subscription the row is about (never logged). */
  subscriptionId: string;
  nextInvoiceCentsAfter?: number | null;
}

/**
 * The newest thing a tester did in their own data: any task (a save, a voice note, a chat or MCP
 * answer) other than the self test, or any AI call. Read-only; null when there is nothing.
 */
export function lastUsedFromTenantData(dataDir: string, tenantId: string | null): number | null {
  if (!tenantId) return null;
  let newest: number | null = null;
  const read = (file: string, sql: string) => {
    const path = join(dataDir, tenantId, file);
    if (!existsSync(path)) return;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const row = db.prepare(sql).get() as { t?: number | null } | undefined;
      if (typeof row?.t === "number" && (newest === null || row.t > newest)) newest = row.t;
    } catch {
      // a missing table is "nothing yet"
    } finally {
      db?.close();
    }
  };
  read("tasks.sqlite", "SELECT MAX(created_at) AS t FROM task_jobs WHERE COALESCE(json_extract(input_json, '$.source'), '') <> 'selftest'");
  read("usage.sqlite", "SELECT MAX(ts) AS t FROM llm_usage");
  return newest;
}

export interface TesterMonthEndOptions {
  stripe: MonthEndStripe;
  accounts: () => MonthEndAccount[];
  lastUsed: (tenantId: string | null) => number | null;
  now?: () => number;
  alert?: (reason: string, fields?: Record<string, string | number>) => void;
  log?: (line: string) => void;
}

export class TesterMonthEnd {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running: Promise<MonthEndResult[]> | null = null;
  private accessChecked = false;
  private readonly now: () => number;
  private readonly alert: (reason: string, fields?: Record<string, string | number>) => void;
  private readonly log: (line: string) => void;

  constructor(private readonly options: TesterMonthEndOptions) {
    this.now = options.now ?? (() => Date.now());
    this.alert = options.alert ?? ((reason, fields) => opsAlert("tester", reason, fields));
    this.log = options.log ?? ((line) => console.log(line));
  }

  /**
   * Whether the key may change subscriptions, without changing any: an update of a subscription that
   * does not exist answers 404 when it may and 403 when it may not. Asked once, on the first run.
   */
  async canChangeSubscriptions(): Promise<boolean | null> {
    try {
      await this.options.stripe.subscriptions.update("sub_zenod_month_end_access_check", { metadata: {} });
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404) return true;
      if (status === 403 || (error as { type?: string }).type === "StripePermissionError") return false;
      return null;
    }
  }

  private async nextInvoiceCents(subscriptionId: string): Promise<number | null> {
    try {
      return (await this.options.stripe.invoices.createPreview({ subscription: subscriptionId })).total;
    } catch {
      return null;
    }
  }

  /** Never bill a tester: set the subscription to end at its period end. False when Stripe refused that too. */
  private async endInstead(subscriptionId: string): Promise<boolean> {
    try {
      await this.options.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_SAFE },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async one(account: MonthEndAccount): Promise<MonthEndResult> {
    const { stripe } = this.options;
    const subscriptionId = account.subscriptionId;
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
    const nowMs = this.now();
    if (!isTesterSubscription(sub)) return { action: "none", reason: "not_a_tester", subscriptionId };
    const due = sub.current_period_end * 1000 - nowMs <= TESTER_DECIDE_DAYS * DAY_MS;
    const decision = decideMonthEnd({
      sub,
      nowMs,
      lastUsedMs: this.options.lastUsed(account.tenantId),
      nextInvoiceCents: due && !sub.cancel_at_period_end ? await this.nextInvoiceCents(subscriptionId) : null,
      overCap: due ? await account.overCap().catch(() => false) : false,
    });
    const result: MonthEndResult = { ...decision, subscriptionId };
    if (decision.action === "extend" || decision.action === "resume") {
      try {
        await stripe.subscriptions.update(subscriptionId, {
          ...(decision.action === "resume" ? { cancel_at_period_end: false } : {}),
          discounts: [{ coupon: TESTER_EXTENSION_COUPON_ID }],
          proration_behavior: "none",
          metadata: { zenod_tester: "1", zenod_tester_month_end: "extended" },
        });
        result.nextInvoiceCentsAfter = await this.nextInvoiceCents(subscriptionId);
      } catch {
        result.nextInvoiceCentsAfter = null;
      }
      if (result.nextInvoiceCentsAfter !== 0) {
        // Not confirmed free: end the month instead, so no renewal bill is made.
        const ended = await this.endInstead(subscriptionId);
        return { ...result, action: "failed", exception: ended ? "not_free_ended_instead" : "not_free_end_failed" };
      }
    } else if (decision.action === "end") {
      await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: { zenod_tester: "1", zenod_tester_month_end: ENDED_INACTIVE },
      });
    }
    return result;
  }

  /** One pass over every tester subscription. Never throws; each exception is one alert line. */
  async runOnce(): Promise<MonthEndResult[]> {
    if (this.running) return this.running;
    this.running = (async () => {
      const results: MonthEndResult[] = [];
      if (!this.accessChecked) {
        this.accessChecked = true;
        const access = await this.canChangeSubscriptions();
        this.log(`[tester-month-end] Stripe key may change subscriptions: ${access === null ? "unknown" : access ? "yes" : "no"}`);
        if (access === false) this.alert("no_subscription_write");
      }
      const seen = new Set<string>();
      let accounts: MonthEndAccount[] = [];
      try {
        accounts = this.options.accounts();
      } catch {
        this.alert("accounts_unreadable");
        return results;
      }
      for (const account of accounts) {
        if (seen.has(account.subscriptionId)) continue;
        seen.add(account.subscriptionId);
        let result: MonthEndResult;
        try {
          result = await this.one(account);
        } catch (error) {
          const code = (error as { code?: string; type?: string }).code ?? (error as { type?: string }).type ?? "error";
          result = { action: "failed", reason: "stripe_error", exception: "stripe_failed", subscriptionId: account.subscriptionId };
          this.alert("stripe_failed", { error: String(code) });
          results.push(result);
          continue;
        }
        if (result.exception) this.alert(result.exception);
        results.push(result);
      }
      const testers = results.filter((r) => r.reason !== "not_a_tester");
      const count = (a: string) => testers.filter((r) => r.action === a).length;
      this.log(
        `[tester-month-end] checked ${testers.length} tester(s): extended ${count("extend")}, ended ${count("end")}, ` +
          `resumed ${count("resume")}, failed ${count("failed")}, nothing due ${count("none")}`,
      );
      return results;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(): void {
    if (this.timer) return;
    this.first = setTimeout(() => void this.runOnce(), FIRST_RUN_MS);
    this.first.unref();
    this.timer = setInterval(() => void this.runOnce(), RUN_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }
}
