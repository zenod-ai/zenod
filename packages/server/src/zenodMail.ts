// EPIC-26 T2: Zenod's one mail sender. Every mail Zenod sends (the tester link, the
// welcome after checkout) goes through `SendMail`; which provider sits behind it is
// decided here from the env, once.
//
//   GOOGLE_MAIL_SERVICE_ACCOUNT_JSON set -> Gmail API as ZENOD_MAIL_SENDER (default
//   jordi@zenod.dev), through Zenod's own send-only service account with domain-wide
//   delegation of gmail.send (E26-S9, ask E26-A6). Replies go to that mailbox.
//   else RESEND_API_KEY set -> Resend (kept for the E26-S2 path; Jordi chose not to use it).
//   else -> null: nothing is sent and callers keep their mail queued.
import { createSign } from "node:crypto";

export interface ZenodMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendMail = (mail: ZenodMail) => Promise<void>;

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const DEFAULT_MAIL_SENDER = "jordi@zenod.dev";
export const DEFAULT_MAIL_SENDER_NAME = "Jordi at Zenod";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
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

export function parseServiceAccountKey(json: string): ServiceAccountKey {
  const parsed = JSON.parse(json) as Partial<ServiceAccountKey>;
  if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error("the mail service account key lacks client_email or private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key, ...(parsed.token_uri ? { token_uri: parsed.token_uri } : {}) };
}

/**
 * Gmail API through a service account with domain-wide delegation: a signed JWT for the
 * sender mailbox buys an hour's token (cached), then users.messages.send.
 */
export function gmailMailer(
  key: ServiceAccountKey,
  sender: string,
  senderName = DEFAULT_MAIL_SENDER_NAME,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): SendMail {
  const tokenUri = key.token_uri || GOOGLE_TOKEN_URI;
  let cached: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    const nowMs = now().getTime();
    if (cached && cached.until > nowMs + 60_000) return cached.token;
    const iat = Math.floor(nowMs / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
      iss: key.client_email,
      sub: sender,
      scope: GMAIL_SEND_SCOPE,
      aud: tokenUri,
      iat,
      exp: iat + 3600,
    }))}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
    const response = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${base64url(signature)}`,
      }).toString(),
    });
    // Never echo the body: an error body can name the account; the status is enough.
    if (!response.ok) throw new Error(`mail sign-in answered ${response.status}`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("mail sign-in gave no token");
    cached = { token: body.access_token, until: nowMs + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  return async (mail) => {
    const raw = base64url(mimeMessage(mail, { name: senderName, address: sender }, sender));
    const send = async () => fetchImpl(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    let response = await send();
    if (response.status === 401) {
      cached = null;
      response = await send();
    }
    if (!response.ok) throw new Error(`mail provider answered ${response.status}`);
  };
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

/** The sender production uses, or null when no mail key is set. */
export function mailerFromEnv(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): SendMail | null {
  const serviceAccount = env.GOOGLE_MAIL_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccount) {
    try {
      return gmailMailer(
        parseServiceAccountKey(serviceAccount),
        env.ZENOD_MAIL_SENDER?.trim() || DEFAULT_MAIL_SENDER,
        env.ZENOD_MAIL_SENDER_NAME?.trim() || DEFAULT_MAIL_SENDER_NAME,
        fetchImpl,
      );
    } catch (error) {
      console.error("[mail] the Google mail key is unreadable:", error instanceof Error ? error.message : "error");
      return null;
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
