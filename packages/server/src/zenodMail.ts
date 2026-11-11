// EPIC-26 T2: Zenod's one mail sender. Every mail Zenod sends (the tester link, the
// welcome after checkout, the end-of-test offer) goes through `SendMail`; which provider
// sits behind it is decided here from the env, once.
//
//   GOOGLE_OAUTH_CLIENT_ID/SECRET set -> Gmail API as ZENOD_MAIL_SENDER (default
//   jordi@zenod.dev), through the one gmail.send consent Jordi gives on
//   cloud.zenod.dev/admin/mail (E26-S11, mailGrant.ts). Until he connects it the sender
//   is not ready and every mail stays queued. Replies go to that mailbox.
//   else RESEND_API_KEY set -> Resend (kept for the E26-S2 path; Jordi chose not to use it).
//   else -> null: nothing is sent and callers keep their mail queued.
import { MailGrantStore, grantAccessToken, googleMailClientFromEnv, mailSenderFromEnv } from "./mailGrant.js";

export { DEFAULT_MAIL_SENDER, GMAIL_SEND_SCOPE } from "./mailGrant.js";

export interface ZenodMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends one mail or throws. `ready` (when present) says whether it can send right now. */
export type SendMail = ((mail: ZenodMail) => Promise<void>) & { ready?: () => boolean };

export const DEFAULT_MAIL_SENDER_NAME = "Jordi at Zenod";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
/** The error when Google answers that the Gmail API is switched off in Zenod's Google project. */
export const GMAIL_API_OFF = "mail provider answered 403, the Gmail API is off in Zenod's Google project";

/** True when a sender exists and can send now (a Gmail sender waits for Jordi's consent). */
export function mailReady(send: SendMail | null | undefined): send is SendMail {
  return Boolean(send) && (send!.ready?.() ?? true);
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** A header value never carries a line break (no header injection from an address or subject). */
function headerSafe(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("mail header holds a line break");
  return value;
}

function encodedWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapped64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
}

/** RFC 5322 message with a plain and an HTML part, both UTF-8, base64 bodies. */
export function mimeMessage(mail: ZenodMail, from: { name: string; address: string }, replyTo?: string, boundary = "zenod-mail-part"): string {
  const fromHeader = `${encodedWord(headerSafe(from.name))} <${headerSafe(from.address)}>`;
  return [
    `From: ${fromHeader}`,
    `To: ${headerSafe(mail.to)}`,
    ...(replyTo ? [`Reply-To: ${headerSafe(replyTo)}`] : []),
    `Subject: ${encodedWord(headerSafe(mail.subject))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapped64(mail.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapped64(mail.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export interface AccessTokenSource {
  /** An access token for gmail.send; `fresh` skips any cached one. */
  token(fresh?: boolean): Promise<string>;
  ready?: () => boolean;
}

/** Gmail API users.messages.send as the sender mailbox, with a token from `source`. */
export function gmailMailer(
  source: AccessTokenSource,
  sender: string,
  senderName = DEFAULT_MAIL_SENDER_NAME,
  fetchImpl: typeof fetch = fetch,
): SendMail {
  const send: SendMail = async (mail) => {
    const raw = base64url(mimeMessage(mail, { name: senderName, address: sender }, sender));
    const post = async (fresh: boolean) => fetchImpl(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await source.token(fresh)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    let response = await post(false);
    if (response.status === 401) response = await post(true);
    // Never echo the body: an error body can name the account; the status is enough.
    if (response.status === 403 && /SERVICE_DISABLED|accessNotConfigured/.test(await response.text().catch(() => ""))) {
      throw new Error(GMAIL_API_OFF);
    }
    if (!response.ok) throw new Error(`mail provider answered ${response.status}`);
  };
  if (source.ready) send.ready = source.ready;
  return send;
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

/**
 * The sender production uses, or null when Zenod has no way to send. With Zenod's Google
 * client and a data dir it is the Gmail sender, ready once Jordi has connected it.
 */
export function mailerFromEnv(
  env: NodeJS.ProcessEnv,
  options: { dataDir?: string; fetchImpl?: typeof fetch } = {},
): SendMail | null {
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = googleMailClientFromEnv(env);
  if (client && options.dataDir) {
    const store = new MailGrantStore(options.dataDir, env.CHASSIS_VAULT_MASTER_KEY);
    if (store.available) {
      const sender = mailSenderFromEnv(env);
      return gmailMailer(
        grantAccessToken(store, client, sender, fetchImpl),
        sender,
        env.ZENOD_MAIL_SENDER_NAME?.trim() || DEFAULT_MAIL_SENDER_NAME,
        fetchImpl,
      );
    }
  }
  const resendKey = env.RESEND_API_KEY?.trim();
  if (resendKey) {
    return resendMailer(
      resendKey,
      env.ZENOD_MAIL_FROM?.trim() || "Zenod <testers@zenod.dev>",
      env.ZENOD_MAIL_REPLY_TO?.trim() || "support@zenod.dev",
      fetchImpl,
    );
  }
  return null;
}
