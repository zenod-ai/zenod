// EPIC-26 S13 (Jordi started it closing E26-S5, 2026-11-11): the end-of-test offer. When a tester's free
// month is about to end and the team did not add a month (the month-end job marked it `ended_free_time`),
// the tester sees one plain offer: their notes stay theirs, what €9 a month Hosted gives, and one button
// into the existing Hosted checkout for their own account. The same offer goes out as an email (behind
// the welcome mail's switch and key). Prices do not change.
//
//   before the end: the checkout starts the €9 subscription with its first charge on the day the free
//     month ends (a Stripe trial up to then), so no free day is lost and nothing is charged before it;
//   after the end: the plain €9 checkout, bound to the same account and the same notes.
//
// If they do not pay, nothing breaks: the account and its notes stay theirs (in their own Drive or repo),
// and Zenod pauses saving and answering, as for any ended subscription.
import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { ENDED_FREE_TIME, ENDED_INACTIVE, isTesterSubscription } from "./testerMonthEnd.js";
import { WelcomeMailer } from "./welcomeMail.js";
import { mailerFromEnv, type SendMail, type ZenodMail } from "./zenodMail.js";

export const OFFER_PATH = "/keep-zenod";
/** Stripe Checkout wants a trial end at least 48 hours away; keep an hour of margin. */
const MIN_TRIAL_MS = 49 * 60 * 60 * 1000;
/** How long the email's one-click link works. */
export const OFFER_LINK_TTL_MS = 45 * 86_400_000;

export interface EndOfTestOffer {
  phase: "before" | "after";
  /** When the free month ends (or ended). */
  freeEndsMs: number;
}

/** The offer for this subscription, or null: only a tester's free month the team did not extend. */
export function endOfTestOffer(sub: Stripe.Subscription): EndOfTestOffer | null {
  if (!isTesterSubscription(sub)) return null;
  const mark = sub.metadata?.zenod_tester_month_end;
  if (mark !== ENDED_FREE_TIME && mark !== ENDED_INACTIVE) return null;
  const freeEndsMs = sub.current_period_end * 1000;
  if ((sub.status === "active" || sub.status === "trialing") && sub.cancel_at_period_end) {
    return { phase: "before", freeEndsMs };
  }
  if (sub.status === "canceled") return { phase: "after", freeEndsMs: (sub.ended_at ?? sub.current_period_end) * 1000 };
  return null;
}

/** Unix seconds of the first €9 charge for a checkout started before the end; null after it. */
export function firstChargeAt(offer: EndOfTestOffer, nowMs: number): number | null {
  if (offer.phase !== "before") return null;
  return Math.ceil(Math.max(offer.freeEndsMs, nowMs + MIN_TRIAL_MS) / 1000);
}

function offerSignature(accountId: string, expMs: number, secret: string): string {
  return createHmac("sha256", secret).update(`zenod-offer:${accountId}:${expMs}`).digest("base64url");
}

/** The email's link: opens checkout for this one account, without a new sign-in. */
export function signedOfferUrl(appUrl: string, accountId: string, expMs: number, secret: string): string {
  const url = new URL(OFFER_PATH, `${appUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("a", accountId);
  url.searchParams.set("e", String(expMs));
  url.searchParams.set("s", offerSignature(accountId, expMs, secret));
  return url.toString();
}

/** The account id a link was signed for, or null when it is altered, expired or unsigned. */
export function verifyOfferLink(query: { a?: string; e?: string; s?: string }, secret: string, nowMs: number): string | null {
  const accountId = query.a ?? "";
  const expMs = Number(query.e);
  if (!secret || !accountId || !query.s || !Number.isSafeInteger(expMs) || expMs < nowMs) return null;
  const expected = Buffer.from(offerSignature(accountId, expMs, secret));
  const given = Buffer.from(query.s);
  return expected.length === given.length && timingSafeEqual(expected, given) ? accountId : null;
}

export function offerDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Above the checkout's pay button, before the end. */
export function offerCheckoutMessage(firstChargeSeconds: number): string {
  return `Nothing is charged today. Your first €9 is on ${offerDate(firstChargeSeconds * 1000)}, when your free month ends. ` +
    "Cancel any time before then from your Zenod account and nothing is charged.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The end-of-month email, sent when the free month is set to end (six days before). */
export function offerMail(to: string, input: { freeEndsMs: number; payUrl: string }): ZenodMail {
  const day = offerDate(input.freeEndsMs);
  const subject = `Your free Zenod month ends on ${day}`;
  const keep = "Your notes stay yours. They live in your own Google Drive or GitHub repository, and they stay there whatever you decide.";
  const hosted = "To keep Zenod going, Hosted is €9 a month plus VAT. Zenod keeps saving what you send on WhatsApp and answering from your notes, with the AI included.";
  const charge = `Nothing is charged before ${day}. You can cancel any time from your Zenod account.`;
  const stop = "If you do not pay, nothing breaks. Zenod pauses saving and answering, your notes stay where they are, and you can come back later and pick up where you left off.";
  const text = [
    "Hi,",
    "",
    `Your free month of Zenod ends on ${day}.`,
    "",
    keep,
    "",
    hosted,
    "",
    `Keep Zenod for €9 a month: ${input.payUrl}`,
    "",
    charge,
    "",
    stop,
    "",
    "If you have thoughts on the test, reply to this email. It comes straight to me.",
    "",
    "Jordi",
    "Zenod",
  ].join("\n");
  const url = escapeHtml(input.payUrl);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
<p style="font-size:1.4rem;margin:0 0 1.5rem">Zenod</p>
<p>Hi,</p>
<p>Your free month of Zenod ends on <strong>${escapeHtml(day)}</strong>.</p>
<p>${escapeHtml(keep)}</p>
<p>${escapeHtml(hosted)}</p>
<p style="margin:1.5rem 0"><a href="${url}" style="display:inline-block;background:#1f4d3a;color:#f6f2e9;text-decoration:none;padding:.8rem 1.2rem;border-radius:3px;font-family:Helvetica,Arial,sans-serif">Keep Zenod for €9 a month</a></p>
<p>${escapeHtml(charge)}</p>
<p>${escapeHtml(stop)}</p>
<p>If you have thoughts on the test, reply to this email. It comes straight to me.</p>
<p>Jordi<br>Zenod</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#4a554e">If the button does not open, copy this link: ${url}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

export const OFFER_MAIL_FILE = "offer-mail.json";

/**
 * The offer email's queue: the welcome email's queue with its own file, one record per subscription and
 * free month, retried every 10 minutes. On only behind the welcome mail's switch (ZENOD_WELCOME_MAIL=1)
 * and Zenod's own Google mail key, so nothing is sent before E26-A6 lands.
 */
export function offerMailerFromEnv(dataDir: string, env: NodeJS.ProcessEnv, sendMail: SendMail | null = null): WelcomeMailer {
  const on = env.ZENOD_WELCOME_MAIL === "1" && Boolean(env.GOOGLE_MAIL_SERVICE_ACCOUNT_JSON?.trim());
  const appUrl = (env.CUSTOMER_APP_URL || "https://cloud.zenod.dev").replace(/\/$/, "");
  return new WelcomeMailer({
    dataDir,
    sendMail: on ? sendMail ?? mailerFromEnv(env) : null,
    appUrl,
    file: OFFER_MAIL_FILE,
    label: "offer",
    compose: (record) => offerMail(record.email, {
      freeEndsMs: Number(record.data?.free_ends_ms ?? 0),
      payUrl: record.data?.pay_url ?? `${appUrl}${OFFER_PATH}`,
    }),
  });
}
