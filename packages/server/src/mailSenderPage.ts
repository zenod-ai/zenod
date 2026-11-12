// EPIC-26 S11 round 2: the Connect mail sender page at cloud.zenod.dev/admin/mail, the
// operator's sign-in only. One button runs Google's consent for gmail.send as
// jordi@zenod.dev (mailGrant.ts); on success Zenod sends him one test, the email a
// tester gets, and the queued tester mail goes out. Disconnect revokes the grant.
import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  GMAIL_SEND_SCOPE,
  MAIL_GRANT_CALLBACK_PATH,
  MAIL_GRANT_STATE_PREFIX,
  exchangeMailGrant,
  mailGrantAuthorizeUrl,
  revokeGoogleToken,
  type GoogleMailClient,
  type MailGrantStore,
} from "./mailGrant.js";
import { ADMIN_STYLE } from "./testerFlow.js";
import { GMAIL_API_OFF, type ZenodMail } from "./zenodMail.js";

const FLOW_COOKIE = "zenod_mail_sender_flow";
const FLOW_TTL_MS = 10 * 60 * 1000;

type AppContext = Context<{ Bindings: HttpBindings }>;

export interface MailSenderRoutesOptions {
  isAdmin: (c: AppContext) => boolean;
  store: MailGrantStore;
  /** Zenod's Google client; null leaves the page up with the button explaining what is missing. */
  client: GoogleMailClient | null;
  sender: string;
  /** The email a tester gets, shown on the page and sent as the test. */
  preview: () => ZenodMail;
  /** Sends one mail through the connected sender. */
  send: (mail: ZenodMail) => Promise<void>;
  /** After a connect: let queued mail go out now instead of at the next retry. */
  onConnected?: () => void;
  /** Whether the welcome and end-of-test emails are switched on (ZENOD_WELCOME_MAIL=1). */
  welcomeOn: boolean;
  /** Set when Zenod sends through Cloudflare Email Service: no Google step is needed. */
  provider?: "cloudflare";
  secure: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const NOTICES: Record<string, string> = {
  connected: "Connected. A test email, the one a tester gets, is on its way to you.",
  connected_test_failed: "Connected, but the test email did not go out. Press Send me a test to try again.",
  denied: "You pressed Cancel at Google, so nothing changed.",
  wrong_account: "Google signed in with another address. Zenod only sends as the address below, so it gave that permission back. Press Connect mail sender again and choose that address.",
  no_send: "Google did not give the permission to send. Press Connect mail sender again and leave its box ticked.",
  no_refresh: "Google gave no lasting permission. Press Connect mail sender again.",
  expired: "That sign-in took too long or was opened twice. Press Connect mail sender again.",
  failed: "Google did not answer as expected. Press Connect mail sender again.",
  not_ready: "Zenod cannot start the Google sign-in: its Google client or storage key is missing on the server.",
  api_off: "Connected, but Google answered that the Gmail API is switched off in Zenod's Google project. Open the link below, press Enable, then press Send me a test.",
  test_sent: "Test sent. It should be in your inbox within a minute.",
  test_failed: "The test did not go out. Connect the mail sender again, then send another test.",
  disconnected: "Disconnected. Zenod can no longer send mail, and Google has withdrawn its permission.",
  disconnected_local: "Disconnected here. Google did not confirm, so also remove Zenod at myaccount.google.com/permissions.",
};

function sameOrigin(c: AppContext): boolean {
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function when(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, ${date.toISOString().slice(11, 16)} UTC`;
}

/** Google's Enable page for the Gmail API in the project that owns Zenod's client (its number leads the client id). */
export function gmailApiEnableUrl(clientId: string | undefined): string {
  const project = /^(\d+)-/.exec(clientId ?? "")?.[1];
  return `https://console.cloud.google.com/apis/library/gmail.googleapis.com${project ? `?project=${project}` : ""}`;
}

function failedTest(error: unknown): "api_off" | "test_failed" {
  const message = error instanceof Error ? error.message : "error";
  console.warn("[mail] the test email did not go out:", message);
  return message === GMAIL_API_OFF ? "api_off" : "test_failed";
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function mailSenderPage(options: MailSenderRoutesOptions, noticeKey = ""): string {
  const notice = NOTICES[noticeKey] ?? "";
  const enable = noticeKey === "api_off"
    ? ` <a href="${escapeHtml(gmailApiEnableUrl(options.client?.clientId))}" target="_blank" rel="noopener">Switch on the Gmail API</a>`
    : "";
  const status = options.store.status();
  const sender = escapeHtml(options.sender);
  const canStart = Boolean(options.client) && options.store.available;
  const connectButton = `<form method="post" action="/admin/mail/connect"><button class="btn go" type="submit"${canStart ? "" : " disabled"}>Connect mail sender</button></form>`;
  const state = options.provider === "cloudflare"
    ? `<p><span class="state on">Ready.</span> Zenod sends as <b>${sender}</b> through Cloudflare. Nobody needs to sign in or connect anything.</p>
<div class="row"><form method="post" action="/admin/mail/test"><button class="btn go" type="submit">Send me a test</button></form></div>`
    : status.connected
    ? `<p><span class="state on">Connected.</span> Zenod sends as <b>${escapeHtml(status.email ?? "")}</b>, since ${escapeHtml(when(status.connectedAt))}.</p>
<div class="row"><form method="post" action="/admin/mail/test"><button class="btn go" type="submit">Send me a test</button></form>
<form method="post" action="/admin/mail/disconnect"><button class="btn" type="submit">Disconnect</button></form></div>`
    : status.refusedAt
      ? `<p><span class="state off">Stopped.</span> Google stopped accepting Zenod's permission on ${escapeHtml(when(status.refusedAt))}. Connect it again to send.</p>${connectButton}`
      : `<p><span class="state off">Not connected.</span> Tester emails wait here until you connect.</p>${connectButton}
<p class="muted">Google asks you to sign in. Choose <b>${sender}</b>, then press Allow. If Google first says it has not verified the app, press Advanced and then the link to go on to Zenod.</p>`;
  const mail = options.preview();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mail sender — Zenod</title><style>${ADMIN_STYLE}.row{display:flex;gap:.75rem;flex-wrap:wrap}.btn[disabled]{opacity:.5;cursor:default}.notice{border-left:3px solid #1f4d3a;padding:.5rem 1rem;background:#ece5d6;max-width:44rem}iframe{width:100%;max-width:40rem;height:34rem;border:1px solid #d9d2c1;background:#f6f2e9}</style></head><body><main>
<p class="muted"><a href="/admin">Zenod admin</a> · <a href="/admin/testers">Testers and daily counts</a></p>
<h1>Mail sender</h1>
${notice ? `<p class="notice">${escapeHtml(notice)}${enable}</p>` : ""}
<div class="where">
<p><b>What this does.</b> Zenod emails each accepted tester their personal link from <b>${sender}</b>, through ${options.provider === "cloudflare" ? "Cloudflare" : "Gmail"}. Replies land in your inbox.</p>
${options.provider === "cloudflare" ? "" : `<p><b>What Google lets it do.</b> Send email as that address, nothing else. Zenod cannot read, delete or change your mail. The permission is kept encrypted on Zenod's server, and Disconnect withdraws it at Google.</p>`}
<p><b>Where this is.</b> Inside Zenod, at cloud.zenod.dev/admin/mail. Only your GitHub sign-in opens it.</p>
</div>
<h2>Status</h2>
${state}
<p class="muted">Welcome and end-of-test emails: ${options.welcomeOn ? "switched on, they go out once the sender is connected" : "switched off for now, agents switch them on after your first test arrives"}.</p>
<h2>The email a tester gets</h2>
<p class="muted">Subject: ${escapeHtml(mail.subject)}. From: Jordi at Zenod, ${sender}. The link below is an example; each tester gets their own code.</p>
<iframe title="The email a tester gets" sandbox srcdoc="${escapeHtml(mail.html)}"></iframe>
</main></body></html>`;
}

export function mountMailSenderRoutes(app: Hono<{ Bindings: HttpBindings }>, options: MailSenderRoutesOptions): void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const pending = new Map<string, { verifier: string; until: number }>();
  const back = (c: AppContext, notice: string) => c.redirect(`/admin/mail?mail=${notice}`, 303);

  app.get("/admin/mail", (c) => {
    if (!options.isAdmin(c)) return c.text("Not Found", 404);
    return c.html(mailSenderPage(options, c.req.query("mail") ?? ""), 200, { "Cache-Control": "no-store" });
  });

  app.post("/admin/mail/connect", (c) => {
    if (!options.isAdmin(c) || !sameOrigin(c)) return c.text("Not Found", 404);
    if (!options.client || !options.store.available) return back(c, "not_ready");
    const nowMs = now().getTime();
    for (const [key, flow] of pending) if (flow.until < nowMs) pending.delete(key);
    const state = `${MAIL_GRANT_STATE_PREFIX}${randomBytes(24).toString("base64url")}`;
    const verifier = randomBytes(48).toString("base64url");
    pending.set(hashState(state), { verifier, until: nowMs + FLOW_TTL_MS });
    setCookie(c, FLOW_COOKIE, hashState(state), {
      httpOnly: true,
      secure: options.secure,
      sameSite: "Lax",
      path: MAIL_GRANT_CALLBACK_PATH,
      maxAge: FLOW_TTL_MS / 1000,
    });
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return c.redirect(mailGrantAuthorizeUrl(options.client, state, challenge, options.sender), 303);
  });

  // Google returns to the Drive client's registered callback; only states this page made are ours.
  app.get(MAIL_GRANT_CALLBACK_PATH, async (c, next) => {
    const state = c.req.query("state") ?? "";
    if (!state.startsWith(MAIL_GRANT_STATE_PREFIX)) return next();
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    if (!options.isAdmin(c)) return c.text("Not Found", 404);
    const key = hashState(state);
    const flow = pending.get(key);
    pending.delete(key);
    const cookie = getCookie(c, FLOW_COOKIE);
    deleteCookie(c, FLOW_COOKIE, { path: MAIL_GRANT_CALLBACK_PATH, secure: options.secure });
    if (!flow || flow.until < now().getTime() || cookie !== key || !options.client) return back(c, "expired");
    if (c.req.query("error")) return back(c, "denied");
    const code = c.req.query("code") ?? "";
    if (!code) return back(c, "failed");
    let grant;
    try {
      grant = await exchangeMailGrant(options.client, code, flow.verifier, fetchImpl);
    } catch (error) {
      console.warn("[mail] the Google consent could not be completed:", error instanceof Error ? error.message : "error");
      return back(c, "failed");
    }
    const refused = !grant.email || !grant.emailVerified || grant.email !== options.sender
      ? "wrong_account"
      : !grant.scopes.includes(GMAIL_SEND_SCOPE)
        ? "no_send"
        : !grant.refreshToken
          ? "no_refresh"
          : null;
    if (refused) {
      if (grant.refreshToken) await revokeGoogleToken(grant.refreshToken, fetchImpl);
      return back(c, refused);
    }
    options.store.save(options.sender, grant.refreshToken!, GMAIL_SEND_SCOPE, now());
    console.log("[mail] the mail sender is connected");
    let result = "connected";
    try {
      const sample = options.preview();
      await options.send({ ...sample, to: options.sender, subject: `Test: ${sample.subject}` });
    } catch (error) {
      result = failedTest(error) === "api_off" ? "api_off" : "connected_test_failed";
    }
    options.onConnected?.();
    return back(c, result);
  });

  app.post("/admin/mail/test", async (c) => {
    if (!options.isAdmin(c) || !sameOrigin(c)) return c.text("Not Found", 404);
    try {
      const sample = options.preview();
      await options.send({ ...sample, to: options.sender, subject: `Test: ${sample.subject}` });
      return back(c, "test_sent");
    } catch (error) {
      return back(c, failedTest(error));
    }
  });

  app.post("/admin/mail/disconnect", async (c) => {
    if (!options.isAdmin(c) || !sameOrigin(c)) return c.text("Not Found", 404);
    const token = options.store.refreshToken();
    const revoked = token ? await revokeGoogleToken(token, fetchImpl) : true;
    options.store.clear();
    console.log("[mail] the mail sender is disconnected");
    return back(c, revoked ? "disconnected" : "disconnected_local");
  });
}
