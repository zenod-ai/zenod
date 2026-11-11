// EPIC-26 S5: the tester month end. Round 3 (Jordi, E26-A7, 2026-11-10: "They get one month and then
// renewable at our discretion... Definitely auto renewal for free is a no-no, and with no caps, big
// no-no.") replaces rounds 1 and 2, which extended every active tester by itself. The rule now:
//
//   a tester gets one free month (the tester code's coupon), and it ends at the end of that month;
//   six days before the end, this job sets the subscription to end at the period end (so no renewal
//   invoice is made and nothing is charged) and alerts the team with the tester's usage;
//   only the team extends a tester, one month at a time, with the button on cloud.zenod.dev/admin/testers
//   (`extendByUs`): it puts the `once` 100% coupon on the next invoice and marks that period as
//   extended by us, so the job leaves it alone; a month we did not extend always ends.
//
// A tester is never charged by itself (round 2): if an extension does not leave the next invoice at
// €0, the free month is ended instead and the team is alerted. The usage cap is the Hosted AI
// allowance every account has (EPIC-7 T3, $3 a month for answers, filing stops at most at $5).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type Stripe from "stripe";
import { opsAlert } from "./opsAlert.js";

export const TESTER_COUPON_IDS = ["ZENOD_TESTER_1M", "ZENOD_TESTER_NEXT_MONTH_FREE"] as const;
export const TESTER_EXTENSION_COUPON_ID = "ZENOD_TESTER_NEXT_MONTH_FREE";
/** Decide (and alert the team) this many days before the free month ends. */
export const TESTER_DECIDE_DAYS = 6;
/** Marks a subscription whose free time this rule ended: we did not extend it. */
export const ENDED_FREE_TIME = "ended_free_time";
/** Marks a subscription ended because its free month could not be confirmed: never bill a tester. */
export const ENDED_SAFE = "ended_not_free";
/** Rounds 1 and 2 ended inactive testers with this mark; still read by tester-watch. */
export const ENDED_INACTIVE = "ended_inactive";
/** Marks a subscription the team extended; `zenod_tester_extended_for` holds the period end it covers. */
export const EXTENDED_BY_US = "extended_by_us";
const RUN_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;
const DAY_MS = 86_400_000;

export type MonthEndAction = "end" | "none";

export interface MonthEndDecision {
  action: MonthEndAction;
  /** Fixed words: why. */
  reason: string;
  /** Set when a person should look, with the action still taken when there is one. */
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

/** True when the team extended this subscription past its current period end. */
export function extendedByUs(sub: Stripe.Subscription): boolean {
  return sub.metadata?.zenod_tester_month_end === EXTENDED_BY_US &&
    sub.metadata?.zenod_tester_extended_for === String(sub.current_period_end);
}

/** The rule, with no I/O. `nextInvoiceCents` is the preview of the renewal invoice (null when unknown). */
export function decideMonthEnd(input: { sub: Stripe.Subscription; nowMs: number; nextInvoiceCents: number | null }): MonthEndDecision {
  const { sub, nowMs, nextInvoiceCents } = input;
  if (!isTesterSubscription(sub)) return { action: "none", reason: "not_a_tester" };
  if (sub.status === "past_due" || sub.status === "unpaid") {
    return { action: "none", reason: "past_due", exception: "renewal_past_due" };
  }
  if (sub.status !== "active" && sub.status !== "trialing") return { action: "none", reason: "not_renewing" };
  if (sub.cancel_at_period_end) return { action: "none", reason: "ending" };
  if (sub.current_period_end * 1000 - nowMs > TESTER_DECIDE_DAYS * DAY_MS) return { action: "none", reason: "not_due" };
  if (extendedByUs(sub)) {
    return nextInvoiceCents === 0
      ? { action: "none", reason: "extended_by_us" }
      : { action: "end", reason: "extension_not_free", exception: "not_free_ended_instead" };
  }
  // Never an automatic free month: a month we did not extend ends, and the team hears in time to decide.
  return { action: "end", reason: "free_time_over", exception: "free_time_ending" };
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

/** A tester's AI use this month against the Hosted allowance (EPIC-7 T3); null figures are unknown. */
export interface TesterUsage {
  spendUsd: number | null;
  allowanceUsd: number | null;
  percentUsed: number | null;
}

export interface MonthEndAccount {
  subscriptionId: string;
  tenantId: string | null;
  /** Who it is, for the operator's page only (never logged). */
  who?: string;
  /** EPIC-26 S13: the Zenod account and its email, for the end-of-test offer email. */
  accountId?: string;
  email?: string | null;
  usage(): Promise<TesterUsage>;
}

export interface MonthEndResult {
  action: MonthEndAction | "failed";
  reason: string;
  exception?: string;
  /** For the proof: the subscription the row is about (never logged). */
  subscriptionId: string;
}

/** One tester's line on the operator's page. */
export interface FreeTimeRow {
  subscriptionId: string;
  who: string;
  status: string;
  /** When the current free month ends (the period end). */
  periodEndMs: number;
  state: "free" | "extended" | "ending" | "ended" | "not_free";
  usage: TesterUsage | null;
  lastUsedMs: number | null;
}

export type ExtendResult =
  | { ok: true; freeUntilMs: number }
  | { ok: false; reason: "not_a_tester" | "not_running" | "not_free_ended_instead" | "stripe_failed" };

/** The end of the month after `periodEndMs`: where an extension's free month ends. */
export function oneMonthAfter(periodEndMs: number): number {
  const d = new Date(periodEndMs);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
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
  /** EPIC-26 S13: a free month the team did not extend was just set to end: send the offer. */
  onFreeTimeEnding?: (account: MonthEndAccount, freeEndsMs: number) => void;
}

const isActive = (sub: Stripe.Subscription) => sub.status === "active" || sub.status === "trialing";

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

  /** Set the subscription to end at its period end, so no renewal invoice is made. False when Stripe refused. */
  private async endAtPeriodEnd(subscriptionId: string, mark: string): Promise<boolean> {
    try {
      await this.options.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: { zenod_tester: "1", zenod_tester_month_end: mark },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** What the team reads with a free_time_ending alert: counts and dollars only, never who. */
  private async usageFields(account: MonthEndAccount, sub: Stripe.Subscription, nowMs: number): Promise<Record<string, string | number>> {
    const fields: Record<string, string | number> = {
      days_left: Math.max(0, Math.round((sub.current_period_end * 1000 - nowMs) / DAY_MS)),
    };
    const usage = await account.usage().catch(() => null);
    if (usage?.spendUsd != null) fields.ai_usd = usage.spendUsd.toFixed(2);
    if (usage?.allowanceUsd != null) fields.cap_usd = usage.allowanceUsd;
    if (usage?.percentUsed != null) fields.ai_pct = usage.percentUsed;
    const last = this.options.lastUsed(account.tenantId);
    fields.last_used_days = last === null ? "never" : Math.max(0, Math.floor((nowMs - last) / DAY_MS));
    return fields;
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
      nextInvoiceCents: due && !sub.cancel_at_period_end && extendedByUs(sub) ? await this.nextInvoiceCents(subscriptionId) : null,
    });
    const result: MonthEndResult = { ...decision, subscriptionId };
    if (decision.action !== "end") {
      if (decision.exception) this.alert(decision.exception);
      return result;
    }
    const mark = decision.reason === "extension_not_free" ? ENDED_SAFE : ENDED_FREE_TIME;
    if (!(await this.endAtPeriodEnd(subscriptionId, mark))) {
      this.alert("end_failed");
      return { ...result, action: "failed", exception: "end_failed" };
    }
    if (decision.exception === "free_time_ending") {
      this.alert("free_time_ending", await this.usageFields(account, sub, nowMs));
      try {
        this.options.onFreeTimeEnding?.(account, sub.current_period_end * 1000);
      } catch {
        this.alert("offer_mail_failed");
      }
    }
    else if (decision.exception) this.alert(decision.exception);
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
      let accounts: MonthEndAccount[] = [];
      try {
        accounts = this.distinctAccounts();
      } catch {
        this.alert("accounts_unreadable");
        return results;
      }
      for (const account of accounts) {
        try {
          results.push(await this.one(account));
        } catch (error) {
          const code = (error as { code?: string; type?: string }).code ?? (error as { type?: string }).type ?? "error";
          results.push({ action: "failed", reason: "stripe_error", exception: "stripe_failed", subscriptionId: account.subscriptionId });
          this.alert("stripe_failed", { error: String(code) });
        }
      }
      const testers = results.filter((r) => r.reason !== "not_a_tester");
      const count = (reason: string) => testers.filter((r) => r.reason === reason).length;
      this.log(
        `[tester-month-end] checked ${testers.length} tester(s): free time ended ${count("free_time_over")}, ` +
          `extended by us ${count("extended_by_us")}, failed ${testers.filter((r) => r.action === "failed").length}, ` +
          `nothing due ${count("not_due") + count("ending")}`,
      );
      return results;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private distinctAccounts(): MonthEndAccount[] {
    const seen = new Set<string>();
    return this.options.accounts().filter((a) => !seen.has(a.subscriptionId) && Boolean(seen.add(a.subscriptionId)));
  }

  /**
   * The team's one action (Jordi, E26-A7: "renewable at our discretion"): one more free month for one
   * tester. Puts the `once` 100% coupon on the next invoice, takes back an end this rule set, and marks
   * the period as extended by us. If the next invoice is not €0 after that, the month ends instead.
   */
  async extendByUs(subscriptionId: string): Promise<ExtendResult> {
    const { stripe } = this.options;
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
    } catch {
      return { ok: false, reason: "stripe_failed" };
    }
    if (!isTesterSubscription(sub)) return { ok: false, reason: "not_a_tester" };
    if (!isActive(sub)) return { ok: false, reason: "not_running" };
    let after: number | null = null;
    try {
      await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
        discounts: [{ coupon: TESTER_EXTENSION_COUPON_ID }],
        proration_behavior: "none",
        metadata: {
          zenod_tester: "1",
          zenod_tester_month_end: EXTENDED_BY_US,
          zenod_tester_extended_for: String(sub.current_period_end),
        },
      });
      after = await this.nextInvoiceCents(subscriptionId);
    } catch {
      after = null;
    }
    if (after !== 0) {
      const ended = await this.endAtPeriodEnd(subscriptionId, ENDED_SAFE);
      this.alert(ended ? "not_free_ended_instead" : "not_free_end_failed");
      return { ok: false, reason: "not_free_ended_instead" };
    }
    this.log("[tester-month-end] one tester extended by the team for one more free month");
    return { ok: true, freeUntilMs: oneMonthAfter(sub.current_period_end * 1000) };
  }

  /** Every tester's free time, for the operator's page. Reads Stripe once per tester. */
  async overview(): Promise<FreeTimeRow[]> {
    const rows: FreeTimeRow[] = [];
    for (const account of this.distinctAccounts()) {
      let sub: Stripe.Subscription;
      try {
        sub = await this.options.stripe.subscriptions.retrieve(account.subscriptionId, { expand: ["discounts"] });
      } catch {
        continue;
      }
      if (!isTesterSubscription(sub)) continue;
      const state: FreeTimeRow["state"] = !isActive(sub)
        ? sub.status === "past_due" || sub.status === "unpaid" ? "not_free" : "ended"
        : sub.cancel_at_period_end ? "ending"
        : extendedByUs(sub) ? "extended"
        : "free";
      rows.push({
        subscriptionId: account.subscriptionId,
        who: account.who ?? "a tester",
        status: sub.status,
        periodEndMs: sub.current_period_end * 1000,
        state,
        usage: await account.usage().catch(() => null),
        lastUsedMs: this.options.lastUsed(account.tenantId),
      });
    }
    return rows.sort((a, b) => a.periodEndMs - b.periodEndMs);
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
