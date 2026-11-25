// EPIC-26 T2 (Jordi, closing T1 2026-11-10: "a welcome email after checkout"): one email
// per Zenod account after a successful checkout, from Jordi's own mailbox: you're in, the
// two set-up steps (where notes live, link WhatsApp), the three things to try first, and
// how to reach him (reply).
//
// Checkout completes on two paths (the return page and Stripe's webhook), and Stripe
// retries webhooks, so the queue is keyed by account id in a private file on the data
// volume: the first call queues, every later call is a no-op, a failed send retries every
// 10 minutes. Off unless ZENOD_WELCOME_MAIL=1, and nothing goes out before Jordi connects
// the mail sender as jordi@zenod.dev (E26-S11), so it never claims "reply to me" from a
// mailbox that is not his.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mailerFromEnv, mailReady, type SendMail, type ZenodMail } from "./zenodMail.js";
import type { MailFacts } from "./testerFacts.js";

export const WELCOME_MAIL_FILE = "welcome-mail.json";
const RETRY_MS = 10 * 60 * 1000;
const MAX_TRIES = 20;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The welcome email. `appUrl` is the customer app, e.g. https://cloud.zenod.dev. */
export function welcomeMail(to: string, appUrl = "https://cloud.zenod.dev"): ZenodMail {
  const app = `${appUrl.replace(/\/$/, "")}/app`;
  const subject = "You're in. Three things to try with Zenod";
  const text = [
    "Hi,",
    "",
    "You're in. Your Zenod account is ready.",
    "",
    `Two steps get it working, both in the app at ${app}`,
    "",
    "1. Choose where your notes live: your Google Drive or a GitHub repository.",
    "2. Link your WhatsApp. In Settings, type your own WhatsApp number and press Create one-time code. Send that code from your phone to the Zenod number shown on the same screen, and Zenod confirms it.",
    "",
    "Then try these three things first:",
    "",
    "1. Send a voice note to the Zenod number, the way you'd leave yourself one. Zenod writes down every word, files it and replies Saved.",
    "2. Open your Drive or GitHub and find that note, word for word, in the Log folder. That copy is yours and stays where you keep it.",
    "3. Add Zenod to Claude, ChatGPT or Cursor with the steps at https://zenod.dev/connect, then ask it what you told Zenod today.",
    "",
    "If anything breaks or feels odd, reply to this email. It comes straight to me and I read every one.",
    "",
    "Jordi",
    "Zenod",
  ].join("\n");
  const step = "margin:0 0 .75rem";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
<p style="font-size:1.4rem;margin:0 0 1.5rem">Zenod</p>
<p>Hi,</p>
<p>You're in. Your Zenod account is ready.</p>
<p>Two steps get it working, both in the app:</p>
<ol style="padding-left:1.25rem">
<li style="${step}">Choose where your notes live: your Google Drive or a GitHub repository.</li>
<li style="${step}">Link your WhatsApp. In Settings, type your own WhatsApp number and press <strong>Create one-time code</strong>. Send that code from your phone to the Zenod number shown on the same screen, and Zenod confirms it.</li>
</ol>
<p style="margin:1.5rem 0"><a href="${escapeHtml(app)}" style="display:inline-block;background:#1f4d3a;color:#f6f2e9;text-decoration:none;padding:.8rem 1.2rem;border-radius:3px;font-family:Helvetica,Arial,sans-serif">Open Zenod</a></p>
<p>Then try these three things first:</p>
<ol style="padding-left:1.25rem">
<li style="${step}">Send a voice note to the Zenod number, the way you'd leave yourself one. Zenod writes down every word, files it and replies <em>Saved</em>.</li>
<li style="${step}">Open your Drive or GitHub and find that note, word for word, in the Log folder. That copy is yours and stays where you keep it.</li>
<li style="${step}">Add Zenod to Claude, ChatGPT or Cursor with the steps at <a href="https://zenod.dev/connect" style="color:#1f4d3a">zenod.dev/connect</a>, then ask it what you told Zenod today.</li>
</ol>
<p>If anything breaks or feels odd, reply to this email. It comes straight to me and I read every one.</p>
<p>Jordi<br>Zenod</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#4a554e">If the button does not open, copy this link: ${escapeHtml(app)}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

export interface WelcomeRecord {
  email: string;
  /** EPIC-26 S13: what the composed mail needs besides the address (the offer's date and link). */
  data?: Record<string, string>;
  queuedAt: string;
  sentAt?: string;
  tries?: number;
  lastError?: string;
  /** E26-S26: dropped unsent because its switch went off; never sent later. */
  droppedAt?: string;
  /** E26-S28 it3: sent outside Zenod (e.g. "team-gmail"), or "same address" when another record to it was sent. */
  sentVia?: string;
  /** E26-S28 it3: the sender's message id, when one was given. */
  messageId?: string;
}

/** E26-S28 it3: one queued mail, composed, for an outside sender (the ops mail-queue route). */
export interface PendingMail {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  queuedAt: string;
  /** E7-S40: where the address and the greeted name came from (gmail_send's facts); `missing` lists what is not sure. */
  facts?: MailFacts;
}

export type MarkSentResult = "sent" | "already sent" | "dropped" | "unknown";

interface WelcomeState {
  accounts: Record<string, WelcomeRecord>;
}

export type WelcomeQueueResult = "queued" | "duplicate" | "off" | "no email";

export interface WelcomeMailOptions {
  dataDir: string;
  /** null keeps the welcome off: nothing is queued or sent. */
  sendMail: SendMail | null;
  appUrl?: string;
  now?: () => Date;
  /** EPIC-26 S13: the same queue for another mail: its own file, words and log label. */
  file?: string;
  compose?: (record: WelcomeRecord, id: string) => ZenodMail & { facts?: MailFacts };
  label?: string;
  /**
   * E7-S10: while true for a record, it waits (left out of the queue and not sent) and is composed later; the caller
   * bounds how long. Nothing is stored for it, so a held mail is still sent once.
   */
  hold?: (record: WelcomeRecord, id: string) => boolean;
  /** E26-S26: while true, every queued mail not yet sent is dropped instead of sent. */
  drop?: () => boolean;
}

export class WelcomeMailer {
  private readonly path: string;
  private readonly now: () => Date;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: WelcomeMailOptions) {
    this.path = join(options.dataDir, options.file ?? WELCOME_MAIL_FILE);
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return Boolean(this.options.sendMail);
  }

  private read(): WelcomeState {
    if (!existsSync(this.path)) return { accounts: {} };
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<WelcomeState>;
    return { accounts: parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {} };
  }

  private write(state: WelcomeState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  /** Queue the welcome for this account once; later calls for the same account do nothing. */
  queue(accountId: string, email: string | null | undefined, data?: Record<string, string>): WelcomeQueueResult {
    if (!this.options.sendMail) return "off";
    const address = email?.trim() ?? "";
    if (!accountId || address.length > 200 || !EMAIL.test(address)) return "no email";
    const state = this.read();
    if (state.accounts[accountId]) return "duplicate";
    state.accounts[accountId] = { email: address, queuedAt: this.now().toISOString(), ...(data ? { data } : {}) };
    this.write(state);
    void this.process();
    return "queued";
  }

  /** Whether a mail to this address is already queued or sent (one person with two accounts gets one). */
  hasAddress(email: string): boolean {
    const address = email.trim().toLowerCase();
    return Object.values(this.read().accounts).some((r) => r.email.trim().toLowerCase() === address && !r.droppedAt);
  }

  /**
   * E26-S28 it3: the mails waiting to go, composed, for a sender outside Zenod (the team's Gmail connection).
   * One per address: an address already sent to, or listed under an earlier record, is left out. Empty while
   * the switch drops mail.
   */
  pending(): PendingMail[] {
    if (this.options.drop?.()) return [];
    const records = Object.entries(this.read().accounts).sort(([, a], [, b]) => a.queuedAt.localeCompare(b.queuedAt));
    const done = new Set(records.filter(([, r]) => r.sentAt).map(([, r]) => r.email.trim().toLowerCase()));
    const out: PendingMail[] = [];
    for (const [id, record] of records) {
      const address = record.email.trim().toLowerCase();
      if (record.sentAt || record.droppedAt || done.has(address)) continue;
      done.add(address);
      if (this.options.hold?.(record, id)) continue;
      const mail: ZenodMail & { facts?: MailFacts } = this.options.compose?.(record, id) ?? welcomeMail(record.email, this.options.appUrl);
      out.push({ id, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, queuedAt: record.queuedAt, ...(mail.facts ? { facts: mail.facts } : {}) });
    }
    return out;
  }

  /**
   * E26-S28 it3: an outside sender reports one mail sent. Idempotent: a second call answers "already sent" and
   * changes nothing. Every other unsent record to the same address is closed with it, so one address gets one mail.
   */
  markSent(id: string, via: string, messageId?: string): MarkSentResult {
    const state = this.read();
    const record = state.accounts[id];
    if (!record) return "unknown";
    if (record.sentAt) return "already sent";
    if (record.droppedAt) return "dropped";
    const at = this.now().toISOString();
    const address = record.email.trim().toLowerCase();
    Object.assign(record, { sentAt: at, sentVia: via.slice(0, 40), lastError: "", ...(messageId ? { messageId: messageId.slice(0, 200) } : {}) });
    for (const other of Object.values(state.accounts)) {
      if (other === record || other.sentAt || other.droppedAt || other.email.trim().toLowerCase() !== address) continue;
      Object.assign(other, { sentAt: at, sentVia: "same address" });
    }
    this.write(state);
    console.log(`[${this.options.label ?? "welcome"}] email marked sent via ${via.slice(0, 40)}`);
    return "sent";
  }

  /** Counts only, for the operator page and the evidence. */
  counts(): { enabled: boolean; queued: number; sent: number; failing: number } {
    const records = Object.values(this.read().accounts);
    return {
      enabled: this.enabled,
      queued: records.filter((r) => !r.sentAt && !r.droppedAt).length,
      sent: records.filter((r) => r.sentAt).length,
      failing: records.filter((r) => !r.sentAt && !r.droppedAt && r.lastError).length,
    };
  }

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

  private update(accountId: string, patch: Partial<WelcomeRecord>): void {
    const state = this.read();
    const record = state.accounts[accountId];
    if (!record) return;
    Object.assign(record, patch);
    this.write(state);
  }

  private async step(): Promise<void> {
    if (this.options.drop?.()) {
      const state = this.read();
      const at = this.now().toISOString();
      let dropped = 0;
      for (const record of Object.values(state.accounts)) {
        if (record.sentAt || record.droppedAt) continue;
        record.droppedAt = at;
        dropped += 1;
      }
      if (dropped) {
        this.write(state);
        console.log(`[${this.options.label ?? "welcome"}] ${dropped} queued email(s) dropped, switched off`);
      }
      return;
    }
    const send = this.options.sendMail;
    if (!mailReady(send)) return;
    for (const [accountId, record] of Object.entries(this.read().accounts)) {
      if (record.sentAt || record.droppedAt || (record.tries ?? 0) >= MAX_TRIES) continue;
      if (this.options.hold?.(record, accountId)) continue;
      const mail: ZenodMail & { facts?: MailFacts } = this.options.compose?.(record, accountId) ?? welcomeMail(record.email, this.options.appUrl);
      // E7-S40: a mail whose address or name is missing or unsure waits; nothing is guessed.
      if (mail.facts?.missing?.length) continue;
      try {
        const { facts: _facts, ...plain } = mail;
        await send(plain);
        this.update(accountId, { sentAt: this.now().toISOString(), lastError: "" });
        console.log(`[${this.options.label ?? "welcome"}] email sent`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[${this.options.label ?? "welcome"}] could not send an email:`, message);
        this.update(accountId, { tries: (record.tries ?? 0) + 1, lastError: message.slice(0, 200) });
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

/** Production: on only with ZENOD_WELCOME_MAIL=1; it sends once Jordi has connected the mail sender (E26-S11). */
export function welcomeMailerFromEnv(dataDir: string, env: NodeJS.ProcessEnv, sendMail: SendMail | null = null): WelcomeMailer {
  const on = env.ZENOD_WELCOME_MAIL === "1";
  return new WelcomeMailer({
    dataDir,
    sendMail: on ? sendMail ?? mailerFromEnv(env, { dataDir }) : null,
    appUrl: (env.CUSTOMER_APP_URL || "https://cloud.zenod.dev").replace(/\/$/, ""),
  });
}
