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

export function mountTesterWhatsAppSetupRoute(
  app: Hono<{ Bindings: HttpBindings }>,
  options: {
    isOps: (c: Context) => boolean;
    accounts: () => CustomerAccount[];
    isTester: (account: CustomerAccount) => boolean;
    isTest: (account: CustomerAccount) => boolean;
    setup: (accountId: string) => Promise<WhatsAppSetupRead | null>;
    now?: () => number;
  },
): void {
  app.get("/api/ops/testers/whatsapp-setup", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const accounts = options.accounts().filter((account) =>
      account.tenant_id && account.subscription_status !== "checkout_pending" && account.subscription_status !== "canceled"
      && options.isTester(account) && !options.isTest(account));
    const testers = [];
    for (const account of accounts) {
      const read = await options.setup(account.account_id).catch(() => null);
      const step = whatsappSetupStep(read);
      testers.push({
        account: maskAccount(account),
        key: account.account_id.slice(-8),
        email: (accountEmail(account) ?? "").toLowerCase() || null,
        signedUpAt: account.claimed_at,
        whatsapp: read?.state ?? null,
        attempts: read?.attempts ?? 0,
        lastAttemptAt: read?.lastAttemptAt ? new Date(read.lastAttemptAt).toISOString() : null,
        lastStatus: read?.lastStatus ?? null,
        ...step,
      });
    }
    // One person may hold two accounts: linked on either means linked.
    const linked = new Set(testers.filter((t) => t.step === "linked" && t.email).map((t) => t.email));
    return c.json({
      generatedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
      testers: testers.map(({ email, ...rest }) => ({ ...rest, ...(email && linked.has(email) && rest.step !== "linked" ? { step: "linked", text: "linked on another account", ourBug: false } : {}) })),
    });
  });
}
