import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MailGrantStore } from "../src/mailGrant.js";
import { GMAIL_API_OFF, cloudflareMailConfigured, cloudflareMailer, gmailMailer, mailerFromEnv, mailReady, mimeMessage, type ZenodMail } from "../src/zenodMail.js";

const MASTER = "a".repeat(64);
const MAIL: ZenodMail = { to: "ada@example.test", subject: "You're in — Zenod", text: "Hi Ada,\nwelcome", html: "<p>Hi Ada</p>" };
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN = "https://oauth2.googleapis.com/token";

function decode(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stubFetch(statuses: number[] = []) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url) === TOKEN) {
      return new Response(JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: 3600 }), { status: 200 });
    }
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? '{"id":"m1"}' : '{"error":{"message":"secret detail"}}', { status });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("Zenod mail sender (EPIC-26 T2, S11)", () => {
  it("writes a two-part UTF-8 message and refuses line breaks in headers", () => {
    const mime = mimeMessage(MAIL, { name: "Jordi at Zenod", address: "jordi@zenod.dev" }, "jordi@zenod.dev");
    expect(mime).toContain("From: Jordi at Zenod <jordi@zenod.dev>\r\n");
    expect(mime).toContain("To: ada@example.test\r\n");
    expect(mime).toContain("Reply-To: jordi@zenod.dev\r\n");
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from(MAIL.subject).toString("base64")}?=`);
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(mime).toContain(Buffer.from(MAIL.text).toString("base64"));
    expect(() => mimeMessage({ ...MAIL, to: "a@b.test\r\nBcc: x@y.test" }, { name: "J", address: "j@z.dev" })).toThrow();
  });

  it("sends through Gmail with the source's token, renews once on a 401 and never echoes an error body", async () => {
    const tokens: boolean[] = [];
    const source = { token: async (fresh = false) => { tokens.push(fresh); return fresh ? "new" : "old"; } };
    const ok = stubFetch([401, 200]);
    await gmailMailer(source, "jordi@zenod.dev", "Jordi at Zenod", ok.fetchImpl)(MAIL);
    expect(ok.calls.map((c) => c.url)).toEqual([GMAIL_SEND, GMAIL_SEND]);
    expect(tokens).toEqual([false, true]);
    expect((ok.calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer new");
    expect(decode((JSON.parse(String(ok.calls[0]!.init.body)) as { raw: string }).raw)).toContain("To: ada@example.test");

    const refused = stubFetch([403]);
    const error = await gmailMailer(source, "jordi@zenod.dev", undefined, refused.fetchImpl)(MAIL).catch((e: Error) => e);
    expect(String(error)).toContain("mail provider answered 403");
    expect(String(error)).not.toContain("secret detail");

    const off = (async () => new Response('{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}', { status: 403 })) as unknown as typeof fetch;
    await expect(gmailMailer(source, "jordi@zenod.dev", undefined, off)(MAIL)).rejects.toThrow(GMAIL_API_OFF);
  });

  it("uses the connected grant first: not ready until Jordi connects, then sends as jordi@zenod.dev", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-mail-"));
    const env = { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", CHASSIS_VAULT_MASTER_KEY: MASTER, RESEND_API_KEY: "re_x" };
    const { calls, fetchImpl } = stubFetch();
    const send = mailerFromEnv(env, { dataDir: dir, fetchImpl });
    expect(send).not.toBeNull();
    expect(mailReady(send)).toBe(false);
    await expect(send!(MAIL)).rejects.toThrow(/not connected/);

    new MailGrantStore(dir, MASTER).save("jordi@zenod.dev", "refresh-1", "gmail.send");
    expect(mailReady(send)).toBe(true);
    await send!(MAIL);
    await send!(MAIL);
    expect(calls.map((c) => c.url)).toEqual([TOKEN, GMAIL_SEND, GMAIL_SEND]);
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("refresh-1");
    expect(decode((JSON.parse(String(calls[1]!.init.body)) as { raw: string }).raw)).toContain("From: Jordi at Zenod <jordi@zenod.dev>");
  });

  it("marks the grant stopped when Google withdraws it, so mail stays queued", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-mail-"));
    const store = new MailGrantStore(dir, MASTER);
    store.save("jordi@zenod.dev", "refresh-1", "gmail.send");
    const fetchImpl = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch;
    const send = mailerFromEnv({ GOOGLE_OAUTH_CLIENT_ID: "c", GOOGLE_OAUTH_CLIENT_SECRET: "s", CHASSIS_VAULT_MASTER_KEY: MASTER }, { dataDir: dir, fetchImpl });
    await expect(send!(MAIL)).rejects.toThrow(/withdrawn/);
    expect(store.status()).toMatchObject({ connected: false, email: "jordi@zenod.dev" });
    expect(store.status().refusedAt).toBeTruthy();
    expect(mailReady(send)).toBe(false);
  });

  it("falls back to Resend only without Zenod's Google client, and to nothing without any key", () => {
    expect(mailerFromEnv({})).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "re_x" })).not.toBeNull();
    expect(mailReady(mailerFromEnv({ RESEND_API_KEY: "re_x" }))).toBe(true);
    // A Google client without the vault key cannot store a grant, so it is not the sender.
    expect(mailerFromEnv({ GOOGLE_OAUTH_CLIENT_ID: "c", GOOGLE_OAUTH_CLIENT_SECRET: "s" }, { dataDir: tmpdir() })).toBeNull();
  });

  it("sends through Cloudflare Email Service first when its token and account are set, never echoing an error body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-mail-cf-"));
    const env = {
      CLOUDFLARE_EMAIL_API_TOKEN: "cf-tok", CLOUDFLARE_ACCOUNT_ID: "acc1",
      GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", CHASSIS_VAULT_MASTER_KEY: MASTER,
    };
    expect(cloudflareMailConfigured(env)).toBe(true);
    expect(cloudflareMailConfigured({ CLOUDFLARE_EMAIL_API_TOKEN: "x" })).toBe(false);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ success: true, errors: [], result: { delivered: ["ada@example.test"], permanent_bounces: [], queued: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const send = mailerFromEnv(env, { dataDir: dir, fetchImpl });
    expect(mailReady(send)).toBe(true);
    await send!(MAIL);
    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/email/sending/send");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer cf-tok");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: { address: "jordi@zenod.dev", name: "Jordi at Zenod" },
      to: "ada@example.test",
      subject: MAIL.subject,
      text: MAIL.text,
      html: MAIL.html,
      reply_to: "jordi@zenod.dev",
    });

    const refused = (async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10105, message: "secret detail" }] }), { status: 403 })) as unknown as typeof fetch;
    const error = await cloudflareMailer("acc1", "t", { name: "J", address: "j@zenod.dev" }, undefined, refused)(MAIL).catch((e: Error) => e);
    expect(String(error)).toContain("mail provider answered 403 (cloudflare 10105)");
    expect(String(error)).not.toContain("secret detail");

    const bounced = (async () => new Response(JSON.stringify({ success: true, result: { delivered: [], permanent_bounces: ["ada@example.test"], queued: [] } }), { status: 200 })) as unknown as typeof fetch;
    await expect(cloudflareMailer("acc1", "t", { name: "J", address: "j@zenod.dev" }, undefined, bounced)(MAIL)).rejects.toThrow(/permanent bounce/);
    await expect(cloudflareMailer("acc1", "t", { name: "J", address: "j@zenod.dev" }, undefined, fetchImpl)({ ...MAIL, to: "a@b.test\r\nBcc: x@y.test" })).rejects.toThrow();
  });
});
