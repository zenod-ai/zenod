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
// Email goes through Resend once RESEND_API_KEY is set; until then it stays queued
// "waiting for the mail key". Every queued step is retried, so nothing is lost.
//
// The list lives in a private file on the data volume (0600) and is shown only on
// cloud.zenod.dev/admin/testers to the operator, with the stop switch; since S7 round 2 that page
// also says where it lives and who asked, shows the daily counts and every application with its
// email, our own tests marked.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import type { PublicCountsDocument } from "./publicCounts.js";
import type { TesterMarks } from "./testerMarks.js";

export const TESTER_FLOW_FILE = "tester-flow.json";
export const DEFAULT_TESTER_CAP = 10;
export const TESTER_COUPON_ID = "ZENOD_TESTER_1M";
export const TESTER_CODE_TTL_DAYS = 14;
const RETRY_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const WAITING_FOR_CODE = "waiting for the code command";
export const WAITING_FOR_MAIL = "waiting for the mail key";

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
}

interface TesterFlowState {
  paused: boolean;
  testers: TesterRecord[];
}

export interface TesterMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Returns a fresh single-use code for this tester id, or throws when it cannot mint. */
export type MintCode = (testerId: string) => Promise<string>;
export type SendMail = (mail: TesterMail) => Promise<void>;

export interface TesterFlowOptions {
  dataDir: string;
  cap?: number;
  /** false turns automatic acceptance off for good (env ZENOD_TESTER_AUTO_ACCEPT=0). */
  autoAccept?: boolean;
  joinUrl?: string;
  mint?: MintCode | null;
  sendMail?: SendMail | null;
  now?: () => Date;
}

export function normalizeTesterEmail(value: string): string | null {
  const email = value.trim().replace(/^mailto:/i, "");
  return email.length <= 200 && EMAIL.test(email) ? email : null;
}

export function generateTesterCode(bytes: Uint8Array = randomBytes(8)): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `ZT-${out}`;
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
    "Open it, sign in with Google or GitHub, and checkout opens with your code applied. You pay €0 and no card is asked for.",
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
<p>Open it, sign in with Google or GitHub, and checkout opens with your code applied. You pay €0 and no card is asked for.</p>
<p>Then pick Google Drive or GitHub for your notes, link your WhatsApp, and send your first voice note.</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#4a554e">The code works once, for one account, until ${escapeHtml(expires)}. If the button does not open, copy this link: ${escapeHtml(link)}</p>
<p>Questions or something broke? Just reply to this email.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

/** Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendMailer(apiKey: string, from: string, replyTo?: string, fetchImpl: typeof fetch = fetch): SendMail {
  return async (mail) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!response.ok) throw new Error(`mail provider answered ${response.status}`);
  };
}

interface PromotionCodeCreator {
  promotionCodes?: {
    create?(params: {
      coupon: string;
      code: string;
      max_redemptions: number;
      expires_at: number;
      metadata: Record<string, string>;
    }): Promise<{ code: string }>;
  };
}

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
    return promo.code;
  };
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
    return this.autoAccept && !state.paused && state.testers.filter((t) => t.status === "accepted").length < this.cap;
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
    tester.waiting = "mail";
    this.write(state);
    return true;
  }

  snapshot(): { paused: boolean; autoAccept: boolean; cap: number; accepting: boolean; canMint: boolean; canMail: boolean; testers: TesterRecord[] } {
    const state = this.read();
    return {
      paused: state.paused,
      autoAccept: this.autoAccept,
      cap: this.cap,
      accepting: this.accepting(state),
      canMint: Boolean(this.mint),
      canMail: Boolean(this.sendMail),
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
          code = await this.mint(tester.id);
          this.update(tester.id, { code, codeAt: this.now().toISOString(), waiting: "mail" });
        } catch (error) {
          console.warn("[testers] could not mint a code here:", error instanceof Error ? error.message : String(error));
          this.update(tester.id, { waiting: WAITING_FOR_CODE });
          continue;
        }
      }
      if (!this.sendMail) {
        if (tester.waiting !== WAITING_FOR_MAIL) this.update(tester.id, { waiting: WAITING_FOR_MAIL });
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
): TesterFlow {
  const cap = Number(env.ZENOD_TESTER_CAP);
  const resendKey = env.RESEND_API_KEY?.trim();
  return new TesterFlow({
    dataDir,
    cap: Number.isSafeInteger(cap) && cap >= 0 ? cap : DEFAULT_TESTER_CAP,
    autoAccept: env.ZENOD_TESTER_AUTO_ACCEPT !== "0",
    joinUrl: `${(env.CUSTOMER_APP_URL || "https://cloud.zenod.dev").replace(/\/$/, "")}/join`,
    // Minting from the server is opt-in: it only works once the Stripe key may write promotion codes.
    mint: env.ZENOD_TESTER_MINT === "stripe" && stripe ? stripeMinter(stripe) : null,
    sendMail: resendKey
      ? resendMailer(resendKey, env.ZENOD_MAIL_FROM?.trim() || "Zenod <testers@zenod.dev>", env.ZENOD_MAIL_REPLY_TO?.trim() || "support@zenod.dev")
      : null,
  });
}

function bearerMatches(header: string | undefined, token: string | undefined): boolean {
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

const ADMIN_STYLE = `body{margin:0;background:#f6f2e9;color:#18211c;font:400 1rem/1.5 "Instrument Sans",system-ui,sans-serif;padding:2rem}main{max-width:62rem;margin:0 auto}h1{font:400 2.4rem/1.1 Newsreader,Georgia,serif;margin:0 0 1rem}h2{font:400 1.6rem/1.2 Newsreader,Georgia,serif;margin:2.5rem 0 .5rem}.where{border:1px solid #18211c;padding:1rem 1.25rem;max-width:44rem}.where p{margin:.4rem 0}a{color:#1f4d3a}table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.95rem}th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #d9d2c1;vertical-align:top}th{font-weight:500;color:#4a554e}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem;margin:1rem 0}.tile{border:1px solid #d9d2c1;padding:.75rem 1rem}.tile b{display:block;font:400 2.4rem/1 Newsreader,Georgia,serif}.tile span{color:#4a554e;font-size:.9rem}.muted{color:#4a554e;font-size:.9rem}.tag{font:500 .8rem system-ui,sans-serif;padding:.1rem .45rem;border-radius:3px;white-space:nowrap}.tag.test{background:#e8dfcc;color:#8a3b12}.tag.real{background:#1f4d3a;color:#f6f2e9}.btn{font:500 .9rem system-ui,sans-serif;padding:.45rem .8rem;border:1px solid #18211c;background:#f6f2e9;border-radius:3px;cursor:pointer}.btn.go{background:#1f4d3a;color:#f6f2e9;border-color:#1f4d3a}.state{font:500 1.05rem system-ui,sans-serif}.on{color:#1f4d3a}.off{color:#8a3b12}code{font:.9rem ui-monospace,Menlo,monospace}`;

/** What the admin page shows beside the flow (S7 round 2); each part is optional. */
export interface TesterAdminExtras {
  /** The public counts document (publicCounts.ts). */
  counts?: () => PublicCountsDocument;
  /** Every line the testers form kept (testerApplications.ts), with the email and what they wrote. */
  applications?: () => Array<{ at?: unknown; contact?: unknown; use?: unknown }>;
  /** Our own tests (testerMarks.ts). */
  marks?: TesterMarks;
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
  if (t.emailedAt) return `emailed ${escapeHtml(when(t.emailedAt))}`;
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

function adminPage(flow: TesterFlow, extras: TesterAdminExtras = {}): string {
  const snap = flow.snapshot();
  const accepted = snap.testers.filter((t) => t.status === "accepted").length;
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
<h2>Acceptance</h2>
<p>${state}</p>
<form method="post" action="/admin/testers/switch">${button}</form>
<p>Codes: ${snap.canMint ? "minted here as people are accepted" : WAITING_FOR_CODE}. Email: ${snap.canMail ? "sent here" : WAITING_FOR_MAIL}.</p>
</main></body></html>`;
}

export interface TesterFlowRoutesOptions {
  /** True for the operator's signed-in session; without it the admin page is not mounted. */
  isAdmin?: (c: Context<{ Bindings: HttpBindings }>) => boolean;
  /** Bearer token for the code command's queue (env ZENOD_TESTER_OPS_TOKEN); unset turns the queue off. */
  opsToken?: string;
  /** Counts, every application and the test marks on the admin page (S7 round 2). */
  admin?: TesterAdminExtras;
}

export function mountTesterFlowRoutes(app: Hono<{ Bindings: HttpBindings }>, flow: TesterFlow, options: TesterFlowRoutesOptions): void {
  app.get("/api/ops/testers/pending-codes", (c) => {
    if (!bearerMatches(c.req.header("authorization"), options.opsToken)) return c.json({ error: "not found" }, 404);
    return c.json({ pending: flow.pendingCodes() });
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
  app.get("/admin/testers", (c) => {
    if (!isAdmin(c)) return c.text("Not Found", 404);
    return c.html(adminPage(flow, options.admin), 200, { "Cache-Control": "no-store" });
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
