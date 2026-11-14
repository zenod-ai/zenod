// EPIC-26 E26-S26 (Jordi's yes on E26-A14, 2026-11-14: "Yes: build and switch it on", proposal E26-S22):
// the moment a tester links WhatsApp, Zenod sends one WhatsApp message linking the 60-second video at
// zenod.dev/start (Phylax sends it as the verification reply, armed here when the tester asks for their
// code) and one thank-you email from Jordi with the quick-call offer inside. No day-3 mail. Once per account.
//
// One setting, the mode, decides it all and takes effect at once (no restart):
//   off  - nothing is armed, queued thank-you mails are dropped (the rollback)
//   test - only our own test accounts get it (the first send, shown to Jordi before any tester)
//   on   - every tester (a tester code or an accepted application) and our test accounts
// The env value ZENOD_TESTER_ONBOARDING sets the starting mode; the admin page and the ops route set
// it at runtime in a private file on the data volume, which wins.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomerAccount } from "./customerAccounts.js";
import { WelcomeMailer, type WelcomeRecord } from "./welcomeMail.js";
import { mailReady, type SendMail, type ZenodMail } from "./zenodMail.js";

export const TESTER_ONBOARDING_FILE = "tester-onboarding.json";
export const TESTER_THANKS_MAIL_FILE = "tester-thanks-mail.json";
export const TESTER_ONBOARDING_MODES = ["off", "test", "on"] as const;
export type TesterOnboardingMode = (typeof TESTER_ONBOARDING_MODES)[number];
/** How long after asking for a code Zenod keeps watching for the link. */
const WATCH_MS = 48 * 60 * 60 * 1000;
const SWEEP_MS = 30 * 1000;

export function parseOnboardingMode(value: unknown): TesterOnboardingMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "0" || text === "false") return "off";
  if (text === "1" || text === "true") return "on";
  return TESTER_ONBOARDING_MODES.find((mode) => mode === text) ?? null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A first name worth greeting with: one plain word, else none ("Hi,"). */
export function greetingName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'-]{1,29}$/u.test(first) ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

/** The thank-you email (proposal E26-S22, section 3), from Jordi at Zenod. */
export function testerThanksMail(to: string, firstName: string | null): ZenodMail {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const links: Array<[string, string, string]> = [
    ["Your Zenod app", "cloud.zenod.dev/app", "https://cloud.zenod.dev/app"],
    ["Connect Zenod to Claude or ChatGPT", "zenod.dev/connect", "https://zenod.dev/connect"],
    ["WhatsApp how-to and the 1-minute video", "zenod.dev/start", "https://zenod.dev/start"],
    ["The tester page", "zenod.dev/testers", "https://zenod.dev/testers"],
  ];
  const subject = "Thank you for testing Zenod";
  const text = [
    hi,
    "",
    "Thank you for becoming a Zenod tester. We're truly grateful, and keen to learn from your experience.",
    "",
    "You can write to me at any time at jordi@zenod.dev, or just reply to this email. Broken, confusing or great: I read every message.",
    "",
    "If you're open to it, I'd also be happy to have a quick call in a few days to hear how it's going. No pressure at all. Reply \"call\" and we'll find a time.",
    "",
    "A few useful links:",
    ...links.map(([label, , url]) => `${label}: ${url}`),
    "",
    "Thanks again,",
    "Jordi",
    "Zenod",
  ].join("\n");
  const link = "color:#1f4d3a";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
<p>${escapeHtml(hi)}</p>
<p>Thank you for becoming a Zenod tester. We're truly grateful, and keen to learn from your experience.</p>
<p>You can write to me at any time at <a href="mailto:jordi@zenod.dev" style="${link}">jordi@zenod.dev</a>, or just reply to this email. Broken, confusing or great: I read every message.</p>
<p>If you're open to it, I'd also be happy to have a quick call in a few days to hear how it's going. No pressure at all. Reply "call" and we'll find a time.</p>
<p>A few useful links:</p>
<ul style="padding-left:1.25rem">
${links.map(([label, shown, url]) => `<li style="margin:0 0 .4rem">${escapeHtml(label)}: <a href="${url}" style="${link}">${shown}</a></li>`).join("\n")}
</ul>
<p>Thanks again,<br>Jordi<br>Zenod</p>
</div></body></html>`;
  return { to, subject, text, html };
}

interface AccountRecord {
  /** When this account last asked for a WhatsApp code with the welcome armed. */
  armedAt?: string;
  /** When Zenod saw the link (or sent the test welcome): from then on nothing is armed again. */
  linkedAt?: string;
  /** "link" for a real link, "test send" for the operator's send to an already linked account. */
  via?: "link" | "test send";
  whatsapp?: "sent" | "skipped" | "failed";
  mail?: string;
}

interface OnboardingState {
  mode?: TesterOnboardingMode;
  setBy?: string;
  setAt?: string;
  accounts: Record<string, AccountRecord>;
}

export interface TesterOnboardingOptions {
  dataDir: string;
  /** The starting mode (ZENOD_TESTER_ONBOARDING); the runtime setting wins. */
  envMode: TesterOnboardingMode;
  /** Zenod's mail sender; null keeps the email half off (the WhatsApp half still runs). */
  sendMail: SendMail | null;
  account: (accountId: string) => CustomerAccount | null;
  /** A tester: a tester code (free month) or an accepted application. */
  isTester: (account: CustomerAccount) => boolean;
  /** One of our own test accounts. */
  isTest: (account: CustomerAccount) => boolean;
  /** The first name they gave on their application, if any. */
  firstName: (email: string) => string | null;
  /** Phylax's WhatsApp state for the account ("verified" once linked), null when unknown. */
  whatsappState: (accountId: string) => Promise<string | null>;
  /** Sends the welcome to an account whose WhatsApp is already linked (the test send). */
  sendWelcome: (account: CustomerAccount, operationId: string) => Promise<"sent" | "skipped" | "failed">;
  now?: () => Date;
}

export function accountEmail(account: CustomerAccount): string | null {
  return account.stripe_email?.trim() || account.github_email?.trim() || null;
}

export class TesterOnboarding {
  private readonly path: string;
  private readonly now: () => Date;
  readonly thanks: WelcomeMailer;
  private timer: NodeJS.Timeout | null = null;
  private sweeping: Promise<void> | null = null;

  constructor(private readonly options: TesterOnboardingOptions) {
    this.path = join(options.dataDir, TESTER_ONBOARDING_FILE);
    this.now = options.now ?? (() => new Date());
    this.thanks = new WelcomeMailer({
      dataDir: options.dataDir,
      sendMail: options.sendMail,
      file: TESTER_THANKS_MAIL_FILE,
      label: "tester-thanks",
      compose: (record) => testerThanksMail(record.email, record.data?.first_name || null),
      drop: () => this.mode() === "off",
      ...(options.now ? { now: options.now } : {}),
    });
  }

  private read(): OnboardingState {
    if (!existsSync(this.path)) return { accounts: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<OnboardingState>;
      return { ...parsed, accounts: parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {} };
    } catch {
      return { accounts: {} };
    }
  }

  private write(state: OnboardingState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  private patch(accountId: string, patch: AccountRecord): void {
    const state = this.read();
    state.accounts[accountId] = { ...state.accounts[accountId], ...patch };
    this.write(state);
  }

  mode(): TesterOnboardingMode {
    return parseOnboardingMode(this.read().mode) ?? this.options.envMode;
  }

  setMode(mode: TesterOnboardingMode, by: string): void {
    const state = this.read();
    this.write({ ...state, mode, setBy: by.slice(0, 80), setAt: this.now().toISOString() });
    console.log(`[tester-onboarding] mode set to ${mode} by ${by.slice(0, 80)}`);
    if (mode === "off") void this.thanks.process();
  }

  private eligible(account: CustomerAccount, mode = this.mode()): boolean {
    if (mode === "off") return false;
    if (this.options.isTest(account)) return true;
    return mode === "on" && this.options.isTester(account);
  }

  /**
   * Asked when the account requests a new WhatsApp code: "tester" arms the welcome as the
   * verification reply. Once an account has linked with it, it is never armed again.
   */
  whatsappWelcome(accountId: string): "tester" | null {
    const account = this.options.account(accountId);
    if (!account || !this.eligible(account)) return null;
    const record = this.read().accounts[accountId];
    if (record?.linkedAt && record.whatsapp !== "skipped" && record.whatsapp !== "failed") return null;
    this.patch(accountId, { armedAt: this.now().toISOString() });
    return "tester";
  }

  private queueThanks(account: CustomerAccount): string {
    const email = accountEmail(account);
    if (!email) return "no email";
    const first = greetingName(this.options.firstName(email));
    return this.thanks.queue(account.account_id, email, first ? { first_name: first } : undefined);
  }

  /** Watches armed accounts for the link; on it, the thank-you mail is queued once. */
  sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      const nowMs = this.now().getTime();
      for (const [accountId, record] of Object.entries(this.read().accounts)) {
        if (record.linkedAt || !record.armedAt || nowMs - Date.parse(record.armedAt) > WATCH_MS) continue;
        const state = await this.options.whatsappState(accountId).catch(() => null);
        if (state !== "verified") continue;
        const account = this.options.account(accountId);
        const mail = account && this.mode() !== "off" ? this.queueThanks(account) : "off";
        this.patch(accountId, { linkedAt: this.now().toISOString(), via: "link", whatsapp: "sent", mail });
        console.log(`[tester-onboarding] WhatsApp linked, thank-you mail ${mail}`);
      }
    })().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  /**
   * The operator's test send to an account whose WhatsApp is already linked: the same WhatsApp
   * message and the same email, once. Allowed while the mode is not off.
   */
  async testSend(account: CustomerAccount): Promise<{ whatsapp: string; mail: string }> {
    if (this.mode() === "off") return { whatsapp: "off", mail: "off" };
    const existing = this.read().accounts[account.account_id];
    if (existing?.linkedAt && existing.whatsapp === "sent") return { whatsapp: "already sent", mail: "already sent" };
    const whatsapp = await this.options.sendWelcome(account, `tester-welcome-${account.account_id}`);
    // A welcome that did not go out (no linked WhatsApp) marks nothing and queues no mail, so it can be retried.
    if (whatsapp !== "sent") {
      this.patch(account.account_id, { linkedAt: undefined, via: undefined, whatsapp });
      return { whatsapp, mail: "not queued" };
    }
    const email = accountEmail(account);
    const mail = email && this.thanks.hasAddress(email) ? "already queued" : this.queueThanks(account);
    this.patch(account.account_id, { linkedAt: this.now().toISOString(), via: "test send", whatsapp, mail });
    return { whatsapp, mail };
  }

  /** Mode and counts only (no addresses), for the admin page and the ops route. */
  status(): {
    mode: TesterOnboardingMode;
    setBy: string | null;
    setAt: string | null;
    watching: number;
    linked: number;
    /** "ready" once Jordi's mailbox is connected (the Allow), "waiting" before, "none" without a sender. */
    mailSender: "ready" | "waiting" | "none";
    mail: ReturnType<WelcomeMailer["counts"]>;
  } {
    const state = this.read();
    const records = Object.values(state.accounts);
    return {
      mode: this.mode(),
      setBy: state.setBy ?? null,
      setAt: state.setAt ?? null,
      watching: records.filter((r) => r.armedAt && !r.linkedAt).length,
      linked: records.filter((r) => r.linkedAt).length,
      mailSender: !this.options.sendMail ? "none" : mailReady(this.options.sendMail) ? "ready" : "waiting",
      mail: this.thanks.counts(),
    };
  }

  start(): void {
    if (this.timer) return;
    this.thanks.start();
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.thanks.stop();
  }
}

export type { WelcomeRecord };
