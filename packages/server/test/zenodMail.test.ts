import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GMAIL_SEND_SCOPE,
  gmailMailer,
  mailerFromEnv,
  mimeMessage,
  parseServiceAccountKey,
  type ZenodMail,
} from "../src/zenodMail.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  client_email: "zenod-mail@zenod-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const MAIL: ZenodMail = { to: "ada@example.test", subject: "You're in — Zenod", text: "Hi Ada,\nwelcome", html: "<p>Hi Ada</p>" };

function decode(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stubFetch(statuses: number[] = []) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes("oauth2")) {
      return new Response(JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: 3600 }), { status: 200 });
    }
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? '{"id":"m1"}' : '{"error":{"message":"secret detail"}}', { status });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("Zenod mail sender (EPIC-26 T2)", () => {
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

  it("signs in as the sender with gmail.send only, sends once and reuses the token", async () => {
    const { calls, fetchImpl } = stubFetch();
    const send = gmailMailer(KEY, "jordi@zenod.dev", "Jordi at Zenod", fetchImpl, () => new Date("2026-11-10T20:00:00Z"));
    await send(MAIL);
    await send(MAIL);
    expect(calls.map((c) => c.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    ]);
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [head, claims, signature] = form.get("assertion")!.split(".");
    const verified = createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature!, "base64url"));
    expect(verified).toBe(true);
    expect(JSON.parse(decode(claims!))).toMatchObject({
      iss: KEY.client_email,
      sub: "jordi@zenod.dev",
      scope: GMAIL_SEND_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
    });
    const sent = JSON.parse(String(calls[1]!.init.body)) as { raw: string };
    expect(decode(sent.raw)).toContain("To: ada@example.test");
    expect((calls[2]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("renews the token once on a 401 and never echoes a provider error body", async () => {
    const renew = stubFetch([401, 200]);
    await gmailMailer(KEY, "jordi@zenod.dev", undefined, renew.fetchImpl)(MAIL);
    expect(renew.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);

    const refused = stubFetch([403]);
    const error = await gmailMailer(KEY, "jordi@zenod.dev", undefined, refused.fetchImpl)(MAIL).catch((e: Error) => e);
    expect(String(error)).toContain("mail provider answered 403");
    expect(String(error)).not.toContain("secret detail");
  });

  it("picks Zenod's own Google key first, Resend only without it, and nothing without a key", () => {
    expect(mailerFromEnv({})).toBeNull();
    const { calls, fetchImpl } = stubFetch();
    const google = mailerFromEnv({ GOOGLE_MAIL_SERVICE_ACCOUNT_JSON: JSON.stringify(KEY), RESEND_API_KEY: "re_x" }, fetchImpl);
    expect(google).not.toBeNull();
    return google!(MAIL).then(() => {
      expect(calls[0]!.url).toContain("oauth2.googleapis.com");
      expect(mailerFromEnv({ RESEND_API_KEY: "re_x" })).not.toBeNull();
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(mailerFromEnv({ GOOGLE_MAIL_SERVICE_ACCOUNT_JSON: "{not json" })).toBeNull();
      expect(() => parseServiceAccountKey("{}")).toThrow(/client_email/);
    });
  });
});
