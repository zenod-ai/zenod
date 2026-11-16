import type { HttpBindings } from "@hono/node-server";
import type { Context, Hono } from "hono";
import type { CustomerAccount } from "./customerAccounts.js";
import { accountEmail } from "./testerOnboarding.js";
import type { WhatsAppSetupRead } from "./zenodPhylax.js";

/**
 * EPIC-26 E26-S31: where each tester's WhatsApp setup stands, for the team's stuck-sign-up check (a vps3 timer that
 * reads this over ssh on VPS1, so the ops token never leaves it). No email, number, code or full id leaves: the
 * account is a masked email plus the last 4 of its id.
 */
export interface WhatsAppSetupStep {
  /** linked | no_channel | not_started | waiting_for_code | code_expired | refused | our_error | unknown */
  step: string;
  /** one plain line for the team */
  text: string;
  /** a failure on our side (a 5xx, or Phylax unreadable): the alert says "our bug" */
  ourBug: boolean;
}

export function whatsappSetupStep(read: WhatsAppSetupRead | null): WhatsAppSetupStep {
  if (!read || !read.bound) {
    return { step: "no_channel", text: "no WhatsApp channel on the account yet (Phylax binding missing)", ourBug: true };
  }
  if (read.state === "verified") return { step: "linked", text: "WhatsApp linked", ourBug: false };
  const at = read.lastAttemptAt ? ` (last ${new Date(read.lastAttemptAt).toISOString().slice(0, 16)}Z)` : "";
  const tries = read.attempts > 1 ? `, ${read.attempts} tries` : "";
  if (read.lastStatus !== null && read.lastStatus >= 500) {
    return {
      step: "our_error",
      text: `code request failed with ${read.lastStatus}${read.lastCode ? ` ${read.lastCode}` : ""}${tries}${at}`,
      ourBug: true,
    };
  }
  if (read.state === null) {
    return { step: "our_error", text: `WhatsApp state unreadable from Phylax${tries}${at}`, ourBug: true };
  }
  if (read.attempts === 0) {
    return { step: "not_started", text: "never asked for a WhatsApp code (number not typed)", ourBug: false };
  }
  if (read.state === "awaiting_code") {
    return { step: "waiting_for_code", text: `code issued, number pending: the tester has not sent it yet${tries}${at}`, ourBug: false };
  }
  if (read.lastStatus !== null && read.lastStatus >= 400) {
    return {
      step: "refused",
      text: `code request refused with ${read.lastStatus}${read.lastCode ? ` ${read.lastCode}` : ""} (e.g. number format or already used)${tries}${at}`,
      ourBug: false,
    };
  }
  if (read.lastStatus === null) {
    return {
      step: "unknown",
      text: `asked for a code${tries}${at}, answer not recorded (before 16 Nov), code since expired; never linked`,
      ourBug: false,
    };
  }
  return { step: "code_expired", text: `code issued${tries}${at}, never sent from the phone, expired after 30 min`, ourBug: false };
}

export function maskAccount(account: CustomerAccount): string {
  const email = accountEmail(account) ?? account.github_email ?? "";
  const [user = "", domain = ""] = email.split("@");
  const masked = email ? `${user.slice(0, 1)}***@${domain.slice(0, 1)}***` : "no email";
  return `${masked} …${account.account_id.slice(-4)}`;
}

export interface TesterSetupOptions {
  accounts: () => CustomerAccount[];
  isTester: (account: CustomerAccount) => boolean;
  isTest: (account: CustomerAccount) => boolean;
  setup: (accountId: string) => Promise<WhatsAppSetupRead | null>;
}

/** One real tester's WhatsApp setup (unmasked: the caller decides what leaves). */
export interface TesterSetupRow extends WhatsAppSetupStep {
  account: CustomerAccount;
  email: string | null;
  read: WhatsAppSetupRead | null;
}

/**
 * Every real tester account (test accounts, non-testers, unpaid and cancelled left out) with its WhatsApp step.
 * One person may hold two accounts: linked on either means linked. Shared by the stuck check (E26-S31) and the
 * next-day WhatsApp email (E26-S32).
 */
export async function readTesterSetups(options: TesterSetupOptions): Promise<TesterSetupRow[]> {
  const accounts = options.accounts().filter((account) =>
    account.tenant_id && account.subscription_status !== "checkout_pending" && account.subscription_status !== "canceled"
    && options.isTester(account) && !options.isTest(account));
  const rows: TesterSetupRow[] = [];
  for (const account of accounts) {
    const read = await options.setup(account.account_id).catch(() => null);
    rows.push({ account, email: (accountEmail(account) ?? "").toLowerCase() || null, read, ...whatsappSetupStep(read) });
  }
  const linked = new Set(rows.filter((r) => r.step === "linked" && r.email).map((r) => r.email));
  return rows.map((r) => (r.email && linked.has(r.email) && r.step !== "linked" ? { ...r, step: "linked", text: "linked on another account", ourBug: false } : r));
}

export function mountTesterWhatsAppSetupRoute(
  app: Hono<{ Bindings: HttpBindings }>,
  options: TesterSetupOptions & { isOps: (c: Context) => boolean; now?: () => number },
): void {
  app.get("/api/ops/testers/whatsapp-setup", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const rows = await readTesterSetups(options);
    return c.json({
      generatedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
      testers: rows.map(({ account, read, step, text, ourBug }) => ({
        account: maskAccount(account),
        key: account.account_id.slice(-8),
        signedUpAt: account.claimed_at,
        whatsapp: read?.state ?? null,
        attempts: read?.attempts ?? 0,
        lastAttemptAt: read?.lastAttemptAt ? new Date(read.lastAttemptAt).toISOString() : null,
        lastStatus: read?.lastStatus ?? null,
        step,
        text,
        ourBug,
      })),
    });
  });
}
