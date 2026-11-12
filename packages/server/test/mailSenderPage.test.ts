import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { describe, expect, it, vi } from "vitest";
import { GMAIL_SEND_SCOPE, MAIL_GRANT_FILE, MailGrantStore } from "../src/mailGrant.js";
import { gmailApiEnableUrl, mailSenderPage, mountMailSenderRoutes } from "../src/mailSenderPage.js";
import { GMAIL_API_OFF, type ZenodMail } from "../src/zenodMail.js";

const MASTER = "b".repeat(64);
const CLIENT = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://cloud.zenod.dev/api/vault/drive/oauth/callback" };
const PREVIEW: ZenodMail = { to: "tester@example.com", subject: "Your Zenod tester link", text: "t", html: "<p>Start testing Zenod</p>" };

function idToken(email: string, verified = true): string {
  return `h.${Buffer.from(JSON.stringify({ email, email_verified: verified })).toString("base64url")}.s`;
}

function setup(google: { email?: string; scope?: string; refresh?: string | null; sendError?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zenod-mail-page-"));
  const store = new MailGrantStore(dir, MASTER);
  const sent: ZenodMail[] = [];
  const google_calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    google_calls.push(String(url));
    if (String(url).endsWith("/token")) {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("code_verifier")).toBeTruthy();
      return new Response(JSON.stringify({
        access_token: "at",
        ...(google.refresh === null ? {} : { refresh_token: google.refresh ?? "refresh-secret" }),
        id_token: idToken(google.email ?? "jordi@zenod.dev"),
        scope: google.scope ?? `openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  let admin = true;
  const onConnected = vi.fn();
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountMailSenderRoutes(app, {
    isAdmin: () => admin,
    store,
    client: { ...CLIENT, clientId: "123456789-abc.apps.googleusercontent.com" },
    sender: "jordi@zenod.dev",
    preview: () => PREVIEW,
    send: async (mail) => {
      if (google.sendError) throw new Error(google.sendError);
      sent.push(mail);
    },
    onConnected,
    welcomeOn: false,
    secure: true,
    fetchImpl,
  });
  // The Drive vault's own callback, mounted after: it must still get every state that is not ours.
  app.get("/api/vault/drive/oauth/callback", (c) => c.text("drive"));
  const same = { "sec-fetch-site": "same-origin" };
  async function connect() {
    const start = await app.request("/admin/mail/connect", { method: "POST", headers: same });
    expect(start.status).toBe(303);
    const url = new URL(start.headers.get("location")!);
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    return { url, cookie, state: url.searchParams.get("state")! };
  }
  return { app, dir, store, sent, google_calls, onConnected, connect, same, setAdmin: (value: boolean) => { admin = value; } };
}

describe("Connect mail sender (EPIC-26 S11)", () => {
  it("shows the page to the operator only, with the button and the email a tester gets", async () => {
    const t = setup();
    const page = await t.app.request("/admin/mail");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Connect mail sender");
    expect(html).toContain("Not connected.");
    expect(html).toContain("Start testing Zenod");
    t.setAdmin(false);
    expect((await t.app.request("/admin/mail")).status).toBe(404);
    expect((await t.app.request("/admin/mail/connect", { method: "POST", headers: t.same })).status).toBe(404);
  });

  it("asks Google for gmail.send as jordi@zenod.dev on the registered callback, offline, with PKCE", async () => {
    const t = setup();
    expect((await t.app.request("/admin/mail/connect", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(404);
    const { url, cookie } = await t.connect();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("123456789-abc.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(CLIENT.redirectUri);
    expect(url.searchParams.get("scope")).toBe(`openid email ${GMAIL_SEND_SCOPE}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("login_hint")).toBe("jordi@zenod.dev");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toMatch(/^zms\./);
    expect(cookie).toMatch(/^zenod_mail_sender_flow=/);
  });

  it("stores the grant sealed, sends Jordi the test and lets queued mail go on Allow", async () => {
    const t = setup();
    const { state, cookie } = await t.connect();
    const back = await t.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(state)}&code=c1`, { headers: { cookie } });
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe("/admin/mail?mail=connected");
    expect(t.store.status()).toMatchObject({ connected: true, email: "jordi@zenod.dev" });
    expect(t.store.refreshToken()).toBe("refresh-secret");
    const file = readFileSync(join(t.dir, MAIL_GRANT_FILE), "utf8");
    expect(file).not.toContain("refresh-secret");
    expect(statSync(join(t.dir, MAIL_GRANT_FILE)).mode & 0o777).toBe(0o600);
    expect(t.sent).toEqual([{ ...PREVIEW, to: "jordi@zenod.dev", subject: "Test: Your Zenod tester link" }]);
    expect(t.onConnected).toHaveBeenCalledOnce();
    // The same consent cannot be replayed.
    const again = await t.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(state)}&code=c1`, { headers: { cookie } });
    expect(again.headers.get("location")).toBe("/admin/mail?mail=expired");
    const page = await (await t.app.request("/admin/mail")).text();
    expect(page).toContain("Connected.");
    expect(page).toContain("Disconnect");
  });

  it("gives back a permission for any other account and stores nothing", async () => {
    const t = setup({ email: "someone@gmail.com" });
    const { state, cookie } = await t.connect();
    const back = await t.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(state)}&code=c1`, { headers: { cookie } });
    expect(back.headers.get("location")).toBe("/admin/mail?mail=wrong_account");
    expect(t.google_calls.some((url) => url.endsWith("/revoke"))).toBe(true);
    expect(t.store.status().connected).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  it("refuses a consent without the send scope, a missing cookie or a Cancel", async () => {
    const noSend = setup({ scope: "openid email" });
    const a = await noSend.connect();
    expect((await noSend.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(a.state)}&code=c`, { headers: { cookie: a.cookie } })).headers.get("location"))
      .toBe("/admin/mail?mail=no_send");
    const t = setup();
    const b = await t.connect();
    expect((await t.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(b.state)}&code=c`)).headers.get("location"))
      .toBe("/admin/mail?mail=expired");
    const c = await t.connect();
    expect((await t.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(c.state)}&error=access_denied`, { headers: { cookie: c.cookie } })).headers.get("location"))
      .toBe("/admin/mail?mail=denied");
    expect(t.store.status().connected).toBe(false);
  });

  it("leaves the Drive vault callback alone for its own states", async () => {
    const t = setup();
    const drive = await t.app.request("/api/vault/drive/oauth/callback?state=driveState&code=x");
    expect(await drive.text()).toBe("drive");
  });

  it("disconnects: revokes at Google and deletes the grant", async () => {
    const t = setup();
    t.store.save("jordi@zenod.dev", "refresh-secret", GMAIL_SEND_SCOPE);
    const back = await t.app.request("/admin/mail/disconnect", { method: "POST", headers: t.same });
    expect(back.headers.get("location")).toBe("/admin/mail?mail=disconnected");
    expect(t.google_calls).toEqual(["https://oauth2.googleapis.com/revoke"]);
    expect(t.store.status().connected).toBe(false);
  });

  it("says when the Gmail API is off and links the one Enable page of Zenod's project", async () => {
    const t = setup({ sendError: GMAIL_API_OFF });
    const { state, cookie } = await t.connect();
    const back = await t.app.request(`/api/vault/drive/oauth/callback?state=${encodeURIComponent(state)}&code=c1`, { headers: { cookie } });
    expect(back.headers.get("location")).toBe("/admin/mail?mail=api_off");
    expect(t.store.status().connected).toBe(true);
    const page = await (await t.app.request("/admin/mail?mail=api_off")).text();
    expect(page).toContain("https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=123456789");
    expect(gmailApiEnableUrl(undefined)).toBe("https://console.cloud.google.com/apis/library/gmail.googleapis.com");
    const test = await t.app.request("/admin/mail/test", { method: "POST", headers: t.same });
    expect(test.headers.get("location")).toBe("/admin/mail?mail=api_off");
  });

  it("with Cloudflare as the sender shows Ready, no Google connect step, and keeps Send me a test", () => {
    const store = new MailGrantStore(mkdtempSync(join(tmpdir(), "zenod-mail-cf-page-")), MASTER);
    const html = mailSenderPage({
      isAdmin: () => true, store, client: null, sender: "jordi@zenod.dev", preview: () => PREVIEW,
      send: async () => {}, welcomeOn: false, provider: "cloudflare", secure: true,
    });
    expect(html).toContain("through Cloudflare");
    expect(html).toContain("Send me a test");
    expect(html).not.toContain("Connect mail sender");
    expect(html).not.toContain("What Google lets it do");
  });
});
