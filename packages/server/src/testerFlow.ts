// EPIC-26 S2 (Jordi, 2026-11-10: "I want to do it live … with people captured from the
// internet … they apply … then we have to send them a link … a one-time use coupon that
// is issued only for them, and it's emailed to them"): what happens after the zenod.dev
// testers form, all inside the Zenod server, so nobody has to read the applications.
//
//   apply with an email -> accepted automatically while fewer than the cap (10) are in
//   and the stop switch is off, otherwise waitlisted -> a single-use code is minted only
//   for that person -> an email with their personal link cloud.zenod.dev/join?code=…
//
// Minting tries Stripe from here (it needs "Promotion codes: Write" on the key); when the
// key cannot, the code stays queued "waiting for the code command" until the operator
// script attaches one (scripts/tester-flow-codes.mjs, through the tester-code command).
// EPIC-23 U7 (Jordi, 2026-11-11: "go live"): by default Zenod now makes the code itself and
// keeps it here; checkout applies the tester coupon straight to the session for that code
// (`redeem`), one account per code, so no promotion-code permission is needed. The applicant
// also sees their personal link on screen right after applying, so no mail is needed first.
// E26-S2 round 2 (Jordi, 2026-11-11: "it already was on write! You push man"): the key could
// always make codes; minting was simply never switched on. Now Zenod makes a real one-time Stripe
// promotion code by default and falls back to its own code only when Stripe refuses, logging
// Stripe's answer. A Stripe code is checked by Stripe at checkout, never by `redeem`.
// Email goes through Zenod's one sender (zenodMail.ts: Gmail with Zenod's own key, E26-T2)
// once its key is set; until then it stays queued "waiting for the mail key". Every queued
// step is retried, so nothing is lost. E26-S11 iteration 4 (Jordi, 2026-11-12: "test with
// testers, not with fucking API keys"): the link on screen is the way in, email an optional extra;
// the applicant's browser keeps a private key (only its hash is kept here) to show the link again.
//
// The list lives in a private file on the data volume (0600) and is shown only on
// cloud.zenod.dev/admin/testers to the operator, with the stop switch; since S7 round 2 that page
// also says where it lives and who asked, shows the daily counts and every application with its
// email, our own tests marked.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import type { PublicCountsDocument } from "./publicCounts.js";
import type { TesterMarks } from "./testerMarks.js";
import { oneMonthAfter, type ExtendResult, type FreeTimeRow } from "./testerMonthEnd.js";
import { mailerFromEnv, mailReady, resendMailer, type SendMail, type ZenodMail } from "./zenodMail.js";

export const TESTER_FLOW_FILE = "tester-flow.json";
export const DEFAULT_TESTER_CAP = 10;
export const TESTER_COUPON_ID = "ZENOD_TESTER_1M";
export const TESTER_CODE_TTL_DAYS = 14;
const RETRY_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const WAITING_FOR_CODE = "waiting for the code command";
export const WAITING_FOR_MAIL = "waiting for the mail key";
/** E26-S11 iteration 4: the link was shown on screen, so email is only an optional extra. */
export const LINK_SHOWN = "link shown on screen, email optional";

export type TesterStatus = "accepted" | "waitlist";

export interface TesterRecord {
  id: string;
  email: string;
  appliedAt: string;
  status: TesterStatus;
  code?: string;
  codeAt?: string;
  emailedAt?: string;
  /** What the next step waits for, in plain words; empty once emailed. */
  waiting?: string;
  /** U7: when the personal link was shown on screen right after applying. */
  shownAt?: string;
  /** U7: the one account that used this code at checkout (a code made here works for one account). */
  redeemedBy?: string;
  redeemedAt?: string;
  /** E26-S2 round 2: "stripe" for a Stripe promotion code (Stripe enforces its one use), else made here. */
  codeSource?: "stripe" | "local";
  /**
   * E26-S11 iteration 4: sha256 of the private key the applicant's browser keeps, so the page can show
   * their link again later (or once a slow code is made) without anyone else's code ever being shown.
   */
  claimHash?: string;
}

interface TesterFlowState {
  paused: boolean;
  testers: TesterRecord[];
}

/** Mail goes through Zenod's one sender (zenodMail.ts, EPIC-26 T2). */
export type TesterMail = ZenodMail;
export { resendMailer };
export type { SendMail };

/** A code and who checks it at checkout: Stripe (a promotion code) or Zenod (`redeem`). */
export interface MintedCode {
  code: string;
  source: "stripe" | "local";
}

/** Returns a fresh single-use code for this tester id (a bare string is made here), or throws when it cannot mint. */
export type MintCode = (testerId: string) => Promise<string | MintedCode>;

export interface TesterFlowOptions {
  dataDir: string;
  cap?: number;
  /** false turns automatic acceptance off for good (env ZENOD_TESTER_AUTO_ACCEPT=0). */
  autoAccept?: boolean;
  joinUrl?: string;
  mint?: MintCode | null;
  sendMail?: SendMail | null;
  now?: () => Date;
  /** EPIC-23 U7: our own test applications (testerMarks.ts) are accepted without taking a place. */
  isTest?: (email: string) => boolean;
  /** E26-S11 iteration 4: switches a Stripe code off when its applicant withdraws. */
  retire?: RetireCode | null;
}

/** Switches one Stripe promotion code off, by its code text; throws when Stripe refuses. */
export type RetireCode = (code: string) => Promise<void>;

export function normalizeTesterEmail(value: string): string | null {
  const email = value.trim().replace(/^mailto:/i, "");
  return email.length <= 200 && EMAIL.test(email) ? email : null;
}

export function generateTesterCode(bytes: Uint8Array = randomBytes(8)): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `ZT-${out}`;
}

function hashClaim(claim: string): string {
  return createHash("sha256").update(claim).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function testerMail(to: string, link: string, expires: string): TesterMail {
  const subject = "Your Zenod tester link";
  const text = [
    "Hi,",
    "",
    "Thanks for applying to test Zenod. You're in: here is your personal link, with your code already inside.",
    "",
    link,
    "",
    "Open it, sign in with Google or GitHub, and checkout opens with your code applied. You pay €0 and no card is asked for. You get one free month. If the test is going well, we may add more, one month at a time. Nothing is ever charged unless you choose to pay.",
    "Then pick Google Drive or GitHub for your notes, link your WhatsApp, and send your first voice note.",
    "",
    `The code works once, for one account, until ${expires}.`,
    "",
    "Questions or something broke? Just reply to this email.",
    "",
    "Zenod",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
<p style="font-size:1.4rem;margin:0 0 1.5rem">Zenod</p>
<p>Hi,</p>
<p>Thanks for applying to test Zenod. You're in: here is your personal link, with your code already inside.</p>
<p style="margin:1.75rem 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f4d3a;color:#f6f2e9;text-decoration:none;padding:.8rem 1.2rem;border-radius:3px;font-family:Helvetica,Arial,sans-serif">Start testing Zenod</a></p>
<p>Open it, sign in with Google or GitHub, and checkout opens with your code applied. You pay €0 and no card is asked for. You get one free month. If the test is going well, we may add more, one month at a time. Nothing is ever charged unless you choose to pay.</p>
<p>Then pick Google Drive or GitHub for your notes, link your WhatsApp, and send your first voice note.</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#4a554e">The code works once, for one account, until ${escapeHtml(expires)}. If the button does not open, copy this link: ${escapeHtml(link)}</p>
<p>Questions or something broke? Just reply to this email.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

interface PromotionCodeCreator {
  promotionCodes?: {
    create?(params: {
      coupon: string;
      code: string;
      max_redemptions: number;
      expires_at: number;
      metadata: Record<string, string>;
    }): Promise<{ code: string; id?: string; livemode?: boolean }>;
    update?(id: string, params: { active: boolean }): Promise<{ active?: boolean }>;
    list?(params: { code: string; limit: number }): Promise<{ data: Array<{ id: string; code?: string; active?: boolean }> }>;
  };
  coupons?: {
    retrieve?(id: string): Promise<{ id: string; valid?: boolean; livemode?: boolean; percent_off?: number | null }>;
  };
}

/** Stripe's answer in a log-safe form: type, code and status, any key fragment removed. */
export function describeStripeError(error: unknown): string {
  const e = (error ?? {}) as { type?: unknown; code?: unknown; statusCode?: unknown; message?: unknown };
  const parts = [e.type, e.code, e.statusCode].filter((part) => typeof part === "string" || typeof part === "number");
  const message = typeof e.message === "string" ? e.message : String(error);
  return [...parts, message.replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*.]+/g, "<key>").slice(0, 200)].join(" ");
}

/** U7: a code made and kept by Zenod itself; checkout applies the coupon for it (`TesterFlow.redeem`). */
export const localMinter: MintCode = async () => generateTesterCode();

/** Mints on the existing tester coupon, like scripts/stripe-testers.mjs issue: one use, 14 days. */
export function stripeMinter(stripe: PromotionCodeCreator, now: () => Date = () => new Date()): MintCode | null {
  const create = stripe.promotionCodes?.create?.bind(stripe.promotionCodes);
  if (!create) return null;
  return async (testerId) => {
    const promo = await create({
      coupon: TESTER_COUPON_ID,
      code: generateTesterCode(),
      max_redemptions: 1,
      expires_at: Math.floor(now().getTime() / 1000) + TESTER_CODE_TTL_DAYS * 86400,
      metadata: { zenod_tester: "1", zenod_tester_id: testerId },
    });
    return { code: promo.code, source: "stripe" };
  };
}

/** E26-S2 round 2: a real Stripe code first; when Stripe refuses, Zenod's own code so nobody waits. */
export function stripeThenLocalMinter(stripe: PromotionCodeCreator, now?: () => Date): MintCode {
  const viaStripe = stripeMinter(stripe, now);
  if (!viaStripe) return localMinter;
  return async (testerId) => {
    try {
      return await viaStripe(testerId);
    } catch (error) {
      console.warn("[testers] Stripe did not make the code, made here instead:", describeStripeError(error));
      return { code: generateTesterCode(), source: "local" };
    }
  };
}

/** E26-S11 iteration 4: finds a Stripe promotion code by its text and switches it off (it can never be used again). */
export function stripeRetirer(stripe: PromotionCodeCreator | null): RetireCode | null {
  const list = stripe?.promotionCodes?.list?.bind(stripe.promotionCodes);
  const update = stripe?.promotionCodes?.update?.bind(stripe.promotionCodes);
  if (!list || !update) return null;
  return async (code) => {
    const found = await list({ code, limit: 1 });
    const promo = found.data.find((p) => p.code === undefined || p.code === code);
    if (!promo) return;
    if (promo.active === false) return;
    const after = await update(promo.id, { active: false });
    if (after.active !== false) throw new Error("Stripe did not switch the code off");
  };
}

export interface StripeSelfTest {
  ok: boolean;
  coupon?: { valid: boolean | null; livemode: boolean | null; percentOff: number | null };
  made?: { livemode: boolean | null; maxRedemptions: number; deactivated: boolean };
  stripe?: string;
}

/**
 * E26-S2 round 2: proves on production that this key makes codes. Makes one real one-time
 * promotion code on the tester coupon, marked as a self-test, and deactivates it at once so
 * nobody can use it. Never returns the code itself.
 */
export async function stripeSelfTest(stripe: PromotionCodeCreator | null, now: () => Date = () => new Date()): Promise<StripeSelfTest> {
  const create = stripe?.promotionCodes?.create?.bind(stripe.promotionCodes);
  const update = stripe?.promotionCodes?.update?.bind(stripe.promotionCodes);
  if (!create || !update) return { ok: false, stripe: "no Stripe client" };
  const result: StripeSelfTest = { ok: false };
  try {
    const coupon = await stripe?.coupons?.retrieve?.(TESTER_COUPON_ID);
    if (coupon) result.coupon = { valid: coupon.valid ?? null, livemode: coupon.livemode ?? null, percentOff: coupon.percent_off ?? null };
    const promo = await create({
      coupon: TESTER_COUPON_ID,
      code: generateTesterCode(),
      max_redemptions: 1,
      expires_at: Math.floor(now().getTime() / 1000) + 86400,
      metadata: { zenod_tester: "0", zenod_selftest: "e26-s2" },
    });
    if (!promo.id) return { ...result, stripe: "Stripe returned no id" };
    const after = await update(promo.id, { active: false });
    result.made = { livemode: promo.livemode ?? null, maxRedemptions: 1, deactivated: after.active === false };
    result.ok = result.made.deactivated;
    return result;
  } catch (error) {
    return { ...result, stripe: describeStripeError(error) };
  }
}

export class TesterFlow {
  private readonly path: string;
  private readonly cap: number;
  private readonly autoAccept: boolean;
  private readonly joinUrl: string;
  private readonly now: () => Date;
  private mint: MintCode | null;
  private sendMail: SendMail | null;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: TesterFlowOptions) {
    this.path = join(options.dataDir, TESTER_FLOW_FILE);
    this.cap = options.cap ?? DEFAULT_TESTER_CAP;
    this.autoAccept = options.autoAccept ?? true;
    this.joinUrl = options.joinUrl ?? "https://cloud.zenod.dev/join";
    this.now = options.now ?? (() => new Date());
    this.mint = options.mint ?? null;
    this.sendMail = options.sendMail ?? null;
  }

  private read(): TesterFlowState {
    if (!existsSync(this.path)) return { paused: false, testers: [] };
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<TesterFlowState>;
    return { paused: Boolean(parsed.paused), testers: Array.isArray(parsed.testers) ? parsed.testers : [] };
  }

  private write(state: TesterFlowState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  /** Accepting now? Off when the stop switch is on, automatic acceptance is off, or the cap is reached. */
  accepting(state = this.read()): boolean {
    return this.autoAccept && !state.paused && this.placesTaken(state) < this.cap;
  }

  /** Accepted people who hold a place: everyone but our own tests (U7). */
  private placesTaken(state: TesterFlowState): number {
    const isTest = this.options.isTest;
    return state.testers.filter((t) => t.status === "accepted" && !isTest?.(t.email)).length;
  }

  /** One application with an email. The same email twice keeps its first place. */
  receive(email: string): TesterStatus {
    const state = this.read();
    const key = email.toLowerCase();
    const existing = state.testers.find((tester) => tester.email.toLowerCase() === key);
    if (existing) return existing.status;
    const status: TesterStatus = this.accepting(state) ? "accepted" : "waitlist";
    state.testers.push({
      id: randomUUID(),
      email,
      appliedAt: this.now().toISOString(),
      status,
      ...(status === "accepted" ? { waiting: "code" } : {}),
    });
    this.write(state);
    return status;
  }

  setPaused(paused: boolean): void {
    const state = this.read();
    state.paused = paused;
    this.write(state);
  }

  /** Accept one waitlisted person by hand (operator page), even past the stop switch. */
  acceptById(id: string): boolean {
    const state = this.read();
    const tester = state.testers.find((candidate) => candidate.id === id);
    if (!tester || tester.status !== "waitlist") return false;
    tester.status = "accepted";
    tester.waiting = "code";
    this.write(state);
    return true;
  }

  /**
   * U7: the tester coupon for a code Zenod made here, or null. A code works for one account only,
   * for 14 days from when it was made; the same account may open checkout with it again.
   */
  redeem(code: string, accountId: string): string | null {
    const state = this.read();
    const key = code.trim().toUpperCase();
    const tester = state.testers.find((t) => t.status === "accepted" && t.code?.toUpperCase() === key);
    if (!tester?.codeAt || tester.codeSource === "stripe") return null;
    if (this.now().getTime() > Date.parse(tester.codeAt) + TESTER_CODE_TTL_DAYS * 86400 * 1000) return null;
    if (tester.redeemedBy && tester.redeemedBy !== accountId) return null;
    if (!tester.redeemedBy) {
      tester.redeemedBy = accountId;
      tester.redeemedAt = this.now().toISOString();
      this.write(state);
    }
    return TESTER_COUPON_ID;
  }

  /**
   * E26-S25: a Stripe promotion code from a tester's personal link went on this account's checkout, so the
   * account is that applicant's. Records the link (first account only, as Stripe allows one use) and returns
   * true when the code is one of ours; the applicants read then counts the account as the applicant, even
   * when the email typed at checkout differs from the one on the form.
   */
  linkStripeCode(code: string, accountId: string): boolean {
    const state = this.read();
    const key = code.trim().toUpperCase();
    const tester = state.testers.find((t) => t.status === "accepted" && t.codeSource === "stripe" && t.code?.toUpperCase() === key);
    if (!tester) return false;
    if (!tester.redeemedBy) {
      tester.redeemedBy = accountId;
      tester.redeemedAt = this.now().toISOString();
      this.write(state);
    }
    return true;
  }

  /**
   * U7: the personal link to show on screen for a person accepted just now, once their code exists.
   * Only for an application made in this request, so typing someone else's email never shows theirs.
   */
  async linkForNew(email: string): Promise<{ code: string; link: string } | null> {
    const key = email.toLowerCase();
    const find = () => this.read().testers.find((t) => t.email.toLowerCase() === key);
    if (!find()?.code) await this.process();
    const tester = find();
    if (!tester || tester.status !== "accepted" || !tester.code) return null;
    this.markShown(tester);
    return { code: tester.code, link: `${this.joinUrl}?code=${encodeURIComponent(tester.code)}` };
  }

  /**
   * E26-S11 iteration 4: a private key for the person accepted in this request; only its hash is kept.
   * Their browser holds it and trades it for their own link later (`linkForClaim`).
   */
  issueClaim(email: string): string | null {
    const state = this.read();
    const key = email.toLowerCase();
    const tester = state.testers.find((t) => t.email.toLowerCase() === key);
    if (!tester || tester.status !== "accepted") return null;
    const claim = randomBytes(24).toString("base64url");
    tester.claimHash = hashClaim(claim);
    this.write(state);
    return claim;
  }

  /** The link for a browser's private key: null when unknown, `link: null` while the code is still being made. */
  linkForClaim(claim: string): { link: string | null } | null {
    const tester = this.findByClaim(claim);
    if (!tester) return null;
    if (!tester.code) {
      void this.process();
      return { link: null };
    }
    if (!tester.shownAt) this.markShown(tester);
    return { link: `${this.joinUrl}?code=${encodeURIComponent(tester.code)}` };
  }

  private markShown(tester: TesterRecord): void {
    this.update(tester.id, { shownAt: this.now().toISOString(), ...(tester.waiting === WAITING_FOR_MAIL ? { waiting: LINK_SHOWN } : {}) });
  }

  /**
   * E26-S11 iteration 4: the applicant withdraws with their browser's private key. Their code is switched
   * off first (Stripe) or simply dropped (made here), then their place is freed. Unknown key: null.
   */
  async withdraw(claim: string): Promise<"withdrawn" | "failed" | null> {
    const tester = this.findByClaim(claim);
    if (!tester) return null;
    if (tester.code && tester.codeSource === "stripe") {
      if (!this.options.retire) return "failed";
      try {
        await this.options.retire(tester.code);
      } catch (error) {
        console.warn("[testers] could not switch a withdrawn code off:", describeStripeError(error));
        return "failed";
      }
    }
    const state = this.read();
    state.testers = state.testers.filter((t) => t.id !== tester.id);
    this.write(state);
    console.log("[testers] an applicant withdrew; their code is off");
    return "withdrawn";
  }

  private findByClaim(claim: string): TesterRecord | null {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(claim)) return null;
    const wanted = Buffer.from(hashClaim(claim), "hex");
    return (
      this.read().testers.find(
        (t) => t.status === "accepted" && typeof t.claimHash === "string" && t.claimHash.length === 64 && timingSafeEqual(Buffer.from(t.claimHash, "hex"), wanted),
      ) ?? null
    );
  }

  /** Accepted people still without a code: ids only, so the code command never sees an email. */
  pendingCodes(): Array<{ id: string; since: string }> {
    return this.read().testers
      .filter((tester) => tester.status === "accepted" && !tester.code)
      .map((tester) => ({ id: tester.id, since: tester.appliedAt }));
  }

  attachCode(id: string, code: string): boolean {
    const state = this.read();
    const tester = state.testers.find((candidate) => candidate.id === id);
    if (!tester || tester.status !== "accepted" || tester.code) return false;
    tester.code = code;
    tester.codeAt = this.now().toISOString();
    tester.codeSource = "stripe";
    tester.waiting = "mail";
    this.write(state);
    return true;
  }

  snapshot(): { paused: boolean; autoAccept: boolean; cap: number; accepting: boolean; placesTaken: number; canMint: boolean; canMail: boolean; testers: TesterRecord[] } {
    const state = this.read();
    return {
      placesTaken: this.placesTaken(state),
      paused: state.paused,
      autoAccept: this.autoAccept,
      cap: this.cap,
      accepting: this.accepting(state),
      canMint: Boolean(this.mint),
      canMail: mailReady(this.sendMail),
      testers: state.testers,
    };
  }

  /** Mint and mail whatever is due. Serialized; a call during a run schedules one more run. */
  process(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.step();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private update(id: string, patch: Partial<TesterRecord>): void {
    const state = this.read();
    const tester = state.testers.find((candidate) => candidate.id === id);
    if (!tester) return;
    Object.assign(tester, patch);
    this.write(state);
  }

  private async step(): Promise<void> {
    for (const tester of this.read().testers) {
      if (tester.status !== "accepted" || tester.emailedAt) continue;
      let code = tester.code;
      if (!code) {
        if (!this.mint) {
          if (tester.waiting !== WAITING_FOR_CODE) this.update(tester.id, { waiting: WAITING_FOR_CODE });
          continue;
        }
        try {
          const minted = await this.mint(tester.id);
          const made = typeof minted === "string" ? { code: minted, source: "local" as const } : minted;
          code = made.code;
          this.update(tester.id, { code, codeAt: this.now().toISOString(), codeSource: made.source, waiting: "mail" });
        } catch (error) {
          console.warn("[testers] could not mint a code here:", error instanceof Error ? error.message : String(error));
          this.update(tester.id, { waiting: WAITING_FOR_CODE });
          continue;
        }
      }
      if (!mailReady(this.sendMail)) {
        // E26-S11 iteration 4: once the link was shown on screen nothing waits on mail; email stays optional.
        const shown = Boolean(this.read().testers.find((t) => t.id === tester.id)?.shownAt);
        const waiting = shown ? LINK_SHOWN : WAITING_FOR_MAIL;
        if (tester.waiting !== waiting) this.update(tester.id, { waiting });
        continue;
      }
      const codeAt = new Date(this.read().testers.find((t) => t.id === tester.id)?.codeAt ?? this.now().toISOString());
      const expires = new Date(codeAt.getTime() + TESTER_CODE_TTL_DAYS * 86400 * 1000)
        .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      try {
        await this.sendMail(testerMail(tester.email, `${this.joinUrl}?code=${encodeURIComponent(code)}`, expires));
        this.update(tester.id, { emailedAt: this.now().toISOString(), waiting: "" });
        console.log("[testers] tester link emailed");
      } catch (error) {
        console.warn("[testers] could not email a tester link:", error instanceof Error ? error.message : String(error));
        this.update(tester.id, { waiting: "mail failed, retrying" });
      }
    }
  }

  start(): void {
    if (this.timer) return;
    void this.process();
    this.timer = setInterval(() => void this.process(), RETRY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** The flow as production configures it from its env and its Stripe client. */
export function testerFlowFromEnv(
  dataDir: string,
  env: NodeJS.ProcessEnv,
  stripe: PromotionCodeCreator | null,
  isTest?: (email: string) => boolean,
): TesterFlow {
  const cap = Number(env.ZENOD_TESTER_CAP);
  return new TesterFlow({
    dataDir,
    cap: Number.isSafeInteger(cap) && cap >= 0 ? cap : DEFAULT_TESTER_CAP,
    autoAccept: env.ZENOD_TESTER_AUTO_ACCEPT !== "0",
    joinUrl: `${(env.CUSTOMER_APP_URL || "https://cloud.zenod.dev").replace(/\/$/, "")}/join`,
    // E26-S2 round 2: a Stripe code by default, Zenod's own when Stripe refuses or there is no
    // Stripe client. ZENOD_TESTER_MINT=stripe is Stripe only, =local only here, =off keeps the old queue.
    mint: env.ZENOD_TESTER_MINT === "off" ? null
      : env.ZENOD_TESTER_MINT === "local" || !stripe ? localMinter
      : env.ZENOD_TESTER_MINT === "stripe" ? stripeMinter(stripe)
      : stripeThenLocalMinter(stripe),
    sendMail: mailerFromEnv(env, { dataDir }),
    retire: stripeRetirer(stripe),
    ...(isTest ? { isTest } : {}),
  });
}

export function bearerMatches(header: string | undefined, token: string | undefined): boolean {
  const expected = token?.trim();
  if (!expected || expected.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

function sameOrigin(c: Context): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = c.req.header("origin");
  const host = c.req.header("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const ADMIN_STYLE = `body{margin:0;background:#f6f2e9;color:#18211c;font:400 1rem/1.5 "Instrument Sans",system-ui,sans-serif;padding:2rem}main{max-width:62rem;margin:0 auto}h1{font:400 2.4rem/1.1 Newsreader,Georgia,serif;margin:0 0 1rem}h2{font:400 1.6rem/1.2 Newsreader,Georgia,serif;margin:2.5rem 0 .5rem}.where{border:1px solid #18211c;padding:1rem 1.25rem;max-width:44rem}.where p{margin:.4rem 0}a{color:#1f4d3a}table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.95rem}th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #d9d2c1;vertical-align:top}th{font-weight:500;color:#4a554e}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem;margin:1rem 0}.tile{border:1px solid #d9d2c1;padding:.75rem 1rem}.tile b{display:block;font:400 2.4rem/1 Newsreader,Georgia,serif}.tile span{color:#4a554e;font-size:.9rem}.muted{color:#4a554e;font-size:.9rem}.tag{font:500 .8rem system-ui,sans-serif;padding:.1rem .45rem;border-radius:3px;white-space:nowrap}.tag.test{background:#e8dfcc;color:#8a3b12}.tag.real{background:#1f4d3a;color:#f6f2e9}.btn{font:500 .9rem system-ui,sans-serif;padding:.45rem .8rem;border:1px solid #18211c;background:#f6f2e9;border-radius:3px;cursor:pointer}.btn.go{background:#1f4d3a;color:#f6f2e9;border-color:#1f4d3a}.state{font:500 1.05rem system-ui,sans-serif}.on{color:#1f4d3a}.off{color:#8a3b12}code{font:.9rem ui-monospace,Menlo,monospace}`;

/** What the admin page shows beside the flow (S7 round 2); each part is optional. */
export interface TesterAdminExtras {
  /** The public counts document (publicCounts.ts). */
  counts?: () => PublicCountsDocument;
  /** Every line the testers form kept (testerApplications.ts), with the email and what they wrote. */
  applications?: () => Array<{ at?: unknown; contact?: unknown; use?: unknown }>;
  /** Our own tests (testerMarks.ts). */
  marks?: TesterMarks;
  /** E26-S5 round 3: each tester's free time and the team's "one more free month" (testerMonthEnd.ts). */
  freeTime?: () => { overview(): Promise<FreeTimeRow[]>; extendByUs(subscriptionId: string): Promise<ExtendResult> } | null;
}

const COUNT_LABELS: Array<[string, string]> = [
  ["applications", "Applied"],
  ["accepted", "Accepted"],
  ["signed_up", "Signed up"],
  ["active_testers", "Active testers"],
  ["paying_customers", "Paying"],
];

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

function stepText(t: TesterRecord): string {
  if (t.redeemedAt) return `code used at checkout ${escapeHtml(when(t.redeemedAt))}`;
  if (t.emailedAt) return `emailed ${escapeHtml(when(t.emailedAt))}`;
  if (t.shownAt) return `link shown on screen ${escapeHtml(when(t.shownAt))}`;
  if (t.status === "waitlist") {
    return `waitlist <form method="post" action="/admin/testers/accept" style="display:inline"><input type="hidden" name="id" value="${escapeHtml(t.id)}"><button class="btn" type="submit">Accept</button></form>`;
  }
  return escapeHtml(t.waiting === "mail" ? WAITING_FOR_MAIL : t.waiting === "code" || !t.waiting ? WAITING_FOR_CODE : t.waiting);
}

function countsSection(extras: TesterAdminExtras): string {
  if (!extras.counts) return "";
  let doc: PublicCountsDocument;
  try {
    doc = extras.counts();
  } catch {
    return `<h2>Daily counts</h2><p class="muted">The counts could not be read just now. Reload in a minute.</p>`;
  }
  const num = (value: unknown) => (typeof value === "number" ? String(value) : "–");
  const read = (row: object, key: string) => (row as Record<string, unknown>)[key];
  const tiles = COUNT_LABELS.map(([key, label]) => `<div class="tile"><b>${num(read(doc, key))}</b><span>${label}</span></div>`).join("");
  const days = [...doc.history].reverse().slice(0, 14).map((day) =>
    `<tr><td>${escapeHtml(day.date)}</td>${COUNT_LABELS.map(([key]) => `<td>${num(read(day, key))}</td>`).join("")}<td>${num(day.test_applications)}</td></tr>`).join("");
  return `<h2>Daily counts</h2>
<p class="muted">Counted every hour, one line kept per day. Last count ${escapeHtml(when(doc.at))} UTC. Our own tests are left out of every number and shown apart: ${num(doc.test_applications)} today.</p>
<div class="tiles">${tiles}</div>
<table><thead><tr><th>Day (UTC)</th>${COUNT_LABELS.map(([, label]) => `<th>${label}</th>`).join("")}<th>Our tests</th></tr></thead><tbody>${days}</tbody></table>`;
}

interface ApplicantRow {
  key: string;
  contact: string;
  firstAt: string;
  use: string;
  times: number;
  tester?: TesterRecord;
}

function applicantRows(flow: TesterFlow, extras: TesterAdminExtras): ApplicantRow[] {
  const byKey = new Map<string, ApplicantRow>();
  for (const line of extras.applications?.() ?? []) {
    const contact = typeof line.contact === "string" ? line.contact.trim() : "";
    if (!contact) continue;
    const key = (normalizeTesterEmail(contact) ?? contact).toLowerCase();
    const at = typeof line.at === "string" ? line.at : "";
    const use = typeof line.use === "string" ? line.use : "";
    const row = byKey.get(key);
    if (row) {
      row.times += 1;
      row.use = use || row.use;
    } else {
      byKey.set(key, { key, contact, firstAt: at, use, times: 1 });
    }
  }
  for (const tester of flow.snapshot().testers) {
    const key = tester.email.toLowerCase();
    const row = byKey.get(key);
    if (row) row.tester = tester;
    else byKey.set(key, { key, contact: tester.email, firstAt: tester.appliedAt, use: "", times: 1, tester });
  }
  return [...byKey.values()].sort((a, b) => b.firstAt.localeCompare(a.firstAt));
}

function applicationsSection(flow: TesterFlow, extras: TesterAdminExtras): string {
  const rows = applicantRows(flow, extras);
  let real = 0;
  const body = rows.map((row) => {
    const mark = extras.marks?.mark(row.contact, row.use) ?? { test: false, byHand: false };
    if (!mark.test) real += 1;
    const tag = mark.test
      ? `<span class="tag test">our test</span>`
      : `<span class="tag real">real</span>`;
    const why = mark.byHand ? "marked by you" : mark.test ? "the test rule" : "";
    const flip = extras.marks
      ? `<form method="post" action="/admin/testers/mark" style="display:inline"><input type="hidden" name="contact" value="${escapeHtml(row.contact)}"><input type="hidden" name="test" value="${mark.test ? "0" : "1"}"><button class="btn" type="submit">${mark.test ? "It is real" : "Mark as test"}</button></form>`
      : "";
    const place = row.tester
      ? `${row.tester.status}${row.tester.code ? ` <code>${escapeHtml(row.tester.code)}</code>` : ""}<br>${stepText(row.tester)}`
      : `<span class="muted">came before automatic acceptance, so not in the flow</span>`;
    const times = row.times > 1 ? `<br><span class="muted">sent ${row.times} times</span>` : "";
    return `<tr><td>${escapeHtml(when(row.firstAt))}</td><td>${escapeHtml(row.contact)}${times}</td><td>${escapeHtml(row.use) || "–"}</td><td>${tag}${why ? `<br><span class="muted">${why}</span>` : ""}<br>${flip}</td><td>${place}</td></tr>`;
  }).join("");
  const summary = rows.length
    ? `${rows.length} ${rows.length === 1 ? "person has" : "people have"} applied: ${real} real, ${rows.length - real} our own ${rows.length - real === 1 ? "test" : "tests"}.`
    : "Nobody has applied yet.";
  return `<h2>Applications</h2>
<p>${summary} A test is an application with the word TEST, one of our own addresses or an example address. You can flip any line.</p>
<table><thead><tr><th>Applied (UTC)</th><th>Email</th><th>How they would use Zenod</th><th>Real or test</th><th>Place</th></tr></thead><tbody>${body || `<tr><td colspan="5">No applications yet.</td></tr>`}</tbody></table>`;
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const EXTEND_NOTICE: Record<string, string> = {
  not_a_tester: "That account is not a tester, so nothing was changed.",
  not_running: "That tester's subscription has already ended or is unpaid, so nothing was changed. Look at it in Stripe.",
  not_free_ended_instead: "Stripe did not confirm the next month at €0, so the free month was set to end instead and nothing will be charged. The team was alerted.",
  stripe_failed: "Stripe could not be reached, so nothing was changed. Try again in a minute.",
};

function freeTimeRow(row: FreeTimeRow, nowMs: number): string {
  const until = day(row.periodEndMs);
  const where = {
    free: `Free until ${until}. It ends then unless you give one more month.`,
    extended: `You gave one more month: free until ${day(oneMonthAfter(row.periodEndMs))}.`,
    ending: `Ends on ${until}.`,
    ended: "Ended.",
    not_free: "Renewal unpaid: look at it in Stripe now.",
  }[row.state];
  const u = row.usage;
  const ai = u?.spendUsd != null
    ? `$${u.spendUsd.toFixed(2)}${u.allowanceUsd != null ? ` of $${u.allowanceUsd}` : ""}${u.percentUsed != null ? ` (${u.percentUsed}%)` : ""}`
    : "–";
  const last = row.lastUsedMs === null ? "not yet"
    : Math.floor((nowMs - row.lastUsedMs) / 86_400_000) <= 0 ? "today"
    : `${Math.floor((nowMs - row.lastUsedMs) / 86_400_000)} days ago`;
  const action = row.state === "free" || row.state === "ending"
    ? `<form method="post" action="/admin/testers/extend" style="display:inline"><input type="hidden" name="subscription" value="${escapeHtml(row.subscriptionId)}"><button class="btn go" type="submit">One more free month</button></form>`
    : row.state === "extended" ? `<span class="muted">Given. Press again next month if the test goes on.</span>` : "";
  return `<tr><td>${escapeHtml(row.who)}</td><td>${where}</td><td>${ai}</td><td>${last}</td><td>${action}</td></tr>`;
}

function freeTimeSection(rows: FreeTimeRow[] | null, notice: string): string {
  if (rows === null) return "";
  const nowMs = Date.now();
  const body = rows.map((row) => freeTimeRow(row, nowMs)).join("");
  return `<h2 id="free-time">Free time</h2>
${notice ? `<p class="where">${escapeHtml(notice)}</p>` : ""}
<p>Each tester gets one free month. It ends by itself at the end of that month: no free month renews by itself, and nothing is ever charged. Six days before the end, Zenod sets the free month to end and alerts the team with that tester's usage. To keep a tester on, press One more free month. It covers one month, and you can press it again next month.</p>
<p class="muted">Usage cap, the same for every Hosted account: answers stop when a tester's AI use reaches $3 in a month. Notes keep being saved, and sorting them stops by $5 at most. Everything starts again on the 1st.</p>
<table><thead><tr><th>Tester</th><th>Free time</th><th>AI this month</th><th>Last used</th><th></th></tr></thead><tbody>${body || `<tr><td colspan="5">No tester has signed up yet.</td></tr>`}</tbody></table>`;
}

function adminPage(flow: TesterFlow, extras: TesterAdminExtras = {}, freeRows: FreeTimeRow[] | null = null, notice = ""): string {
  const snap = flow.snapshot();
  const accepted = snap.placesTaken;
  const state = snap.accepting
    ? `<span class="state on">Accepting automatically: ${accepted} of ${snap.cap} places taken.</span>`
    : `<span class="state off">Not accepting: ${!snap.autoAccept ? "automatic acceptance is off in the server settings" : snap.paused ? "the stop switch is on" : `all ${snap.cap} places are taken`}. New applications go to the waitlist.</span>`;
  const button = snap.paused
    ? `<button class="btn go" name="accept" value="on" type="submit">Turn acceptance back on</button>`
    : `<button class="btn" name="accept" value="off" type="submit">Stop accepting</button>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Testers and daily counts — Zenod</title><style>${ADMIN_STYLE}</style></head><body><main>
<p class="muted"><a href="/admin">Zenod admin</a></p>
<h1>Testers and daily counts</h1>
<div class="where">
<p><b>Where this is.</b> Inside Zenod, at cloud.zenod.dev/admin/testers. Only your GitHub sign-in opens it. Anyone else gets Not Found. You get here from the Zenod admin at <a href="/admin">cloud.zenod.dev/admin</a>, under Testers and daily counts.</p>
<p><b>Who asked for it.</b> zenod-social, the team's social persona, mapped the path from tester to paying customer on 10 November and asked for numbers it can read by itself. That became step S7 of the tester invite epic.</p>
<p><b>Where the numbers live.</b> Zenod counts them itself, every hour, from its own files. The same five numbers, without names or emails, are public at <a href="/api/public/counts">cloud.zenod.dev/api/public/counts</a> for zenod-social and the team console. The emails are only on this page.</p>
</div>
${countsSection(extras)}
${applicationsSection(flow, extras)}
${freeTimeSection(freeRows, notice)}
<h2>Acceptance</h2>
<p>${state}</p>
<form method="post" action="/admin/testers/switch">${button}</form>
<p>Codes: ${snap.canMint ? "made here as people are accepted, and each person sees their link on screen" : WAITING_FOR_CODE}. Email: ${snap.canMail ? "sent here, from the <a href=\"/admin/mail\">mail sender</a>" : `${WAITING_FOR_MAIL}, <a href="/admin/mail">connect the mail sender</a>`}.</p>
</main></body></html>`;
}

export interface TesterFlowRoutesOptions {
  /** True for the operator's signed-in session; without it the admin page is not mounted. */
  isAdmin?: (c: Context<{ Bindings: HttpBindings }>) => boolean;
  /** Bearer token for the code command's queue (env ZENOD_TESTER_OPS_TOKEN); unset turns the queue off. */
  opsToken?: string;
  /** Counts, every application and the test marks on the admin page (S7 round 2). */
  admin?: TesterAdminExtras;
  /** E26-S2 round 2: the Stripe client for the ops self-test (one code made and switched off at once). */
  stripe?: PromotionCodeCreator | null;
}

export function mountTesterFlowRoutes(app: Hono<{ Bindings: HttpBindings }>, flow: TesterFlow, options: TesterFlowRoutesOptions): void {
  app.get("/api/ops/testers/pending-codes", (c) => {
    if (!bearerMatches(c.req.header("authorization"), options.opsToken)) return c.json({ error: "not found" }, 404);
    return c.json({ pending: flow.pendingCodes() });
  });
  app.post("/api/ops/testers/stripe-self-test", async (c) => {
    if (!bearerMatches(c.req.header("authorization"), options.opsToken)) return c.json({ error: "not found" }, 404);
    const result = await stripeSelfTest(options.stripe ?? null);
    console.log("[testers] Stripe self-test:", result.ok ? "a code was made and switched off" : result.stripe);
    return c.json(result, result.ok ? 200 : 502);
  });
  app.post("/api/ops/testers/codes", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    if (!bearerMatches(c.req.header("authorization"), options.opsToken)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ id?: unknown; code?: unknown }>().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(code)) return c.json({ error: "invalid code" }, 400);
    if (!flow.attachCode(id, code)) return c.json({ error: "no accepted tester waits for a code with this id" }, 409);
    void flow.process();
    return c.json({ ok: true });
  });

  const isAdmin = options.isAdmin;
  if (!isAdmin) return;
  app.get("/admin/testers", async (c) => {
    if (!isAdmin(c)) return c.text("Not Found", 404);
    const freeTime = options.admin?.freeTime?.() ?? null;
    const rows = freeTime ? await freeTime.overview().catch(() => []) : null;
    const done = c.req.query("extended");
    const notice = done === "ok"
      ? `One more free month given${c.req.query("until") ? `: free until ${c.req.query("until")}` : ""}. Nothing is charged.`
      : done ? EXTEND_NOTICE[done] ?? "" : "";
    return c.html(adminPage(flow, options.admin, rows, notice), 200, { "Cache-Control": "no-store" });
  });
  app.post("/admin/testers/extend", async (c) => {
    const freeTime = options.admin?.freeTime?.() ?? null;
    if (!isAdmin(c) || !sameOrigin(c) || !freeTime) return c.text("Not Found", 404);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const subscription = typeof form.subscription === "string" ? form.subscription.trim() : "";
    if (!/^sub_[A-Za-z0-9]{1,80}$/.test(subscription)) return c.redirect("/admin/testers?extended=not_a_tester#free-time", 303);
    const result = await freeTime.extendByUs(subscription);
    const query = result.ok
      ? `extended=ok&until=${encodeURIComponent(day(result.freeUntilMs))}`
      : `extended=${result.reason}`;
    return c.redirect(`/admin/testers?${query}#free-time`, 303);
  });
  app.post("/admin/testers/mark", async (c) => {
    if (!isAdmin(c) || !sameOrigin(c) || !options.admin?.marks) return c.text("Not Found", 404);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    if (typeof form.contact === "string" && form.contact.trim()) options.admin.marks.set(form.contact, form.test === "1");
    return c.redirect("/admin/testers", 303);
  });
  app.post("/admin/testers/switch", async (c) => {
    if (!isAdmin(c) || !sameOrigin(c)) return c.text("Not Found", 404);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    flow.setPaused(form.accept !== "on");
    return c.redirect("/admin/testers", 303);
  });
  app.post("/admin/testers/accept", async (c) => {
    if (!isAdmin(c) || !sameOrigin(c)) return c.text("Not Found", 404);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    if (typeof form.id === "string" && flow.acceptById(form.id)) void flow.process();
    return c.redirect("/admin/testers", 303);
  });
}
