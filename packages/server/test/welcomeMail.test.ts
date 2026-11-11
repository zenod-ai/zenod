import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WELCOME_MAIL_FILE, welcomeMail, WelcomeMailer, welcomeMailerFromEnv } from "../src/welcomeMail.js";
import type { ZenodMail } from "../src/zenodMail.js";

const NOW = new Date("2026-11-10T20:30:00Z");

function mailer(sendMail: ((mail: ZenodMail) => Promise<void>) | null = null) {
  const dataDir = mkdtempSync(join(tmpdir(), "zenod-welcome-"));
  const mails: ZenodMail[] = [];
  const welcome = new WelcomeMailer({
    dataDir,
    now: () => NOW,
    sendMail: sendMail ?? (async (mail) => {
      mails.push(mail);
    }),
  });
  return { dataDir, welcome, mails };
}

describe("welcome email after checkout (EPIC-26 T2)", () => {
  it("says you're in, the two set-up steps, three things to try and how to reach Jordi", () => {
    const mail = welcomeMail("ada@example.test", "https://cloud.zenod.dev/");
    expect(mail.subject).toBe("You're in. Three things to try with Zenod");
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("You're in. Your Zenod account is ready.");
      expect(part).toContain("Choose where your notes live: your Google Drive or a GitHub repository.");
      expect(part).toContain("type your own WhatsApp number");
      expect(part).toContain("Then try these three things first:");
      expect(part).toContain("replies");
      expect(part).toContain("word for word, in the Log folder");
      expect(part).toContain("zenod.dev/connect");
      expect(part).toContain("reply to this email. It comes straight to me");
      expect(part).not.toMatch(/\{[A-Z_]+\}/);
    }
    expect(mail.text).toContain("https://cloud.zenod.dev/app");
    expect(mail.text.match(/^\d\. /gm)).toHaveLength(5);
  });

  it("queues once per account, sends once, and keeps the list private", async () => {
    const { dataDir, welcome, mails } = mailer();
    expect(welcome.queue("acct_1", "ada@example.test")).toBe("queued");
    expect(welcome.queue("acct_1", "ada@example.test")).toBe("duplicate");
    await welcome.process();
    expect(welcome.queue("acct_1", "other@example.test")).toBe("duplicate");
    await welcome.process();
    expect(mails.map((m) => m.to)).toEqual(["ada@example.test"]);
    const stored = JSON.parse(readFileSync(join(dataDir, WELCOME_MAIL_FILE), "utf8"));
    expect(stored.accounts.acct_1).toMatchObject({ email: "ada@example.test", sentAt: NOW.toISOString() });
    expect(statSync(join(dataDir, WELCOME_MAIL_FILE)).mode & 0o777).toBe(0o600);
  });

  it("does nothing while switched off, and skips a missing or bad address", async () => {
    const off = new WelcomeMailer({ dataDir: mkdtempSync(join(tmpdir(), "zenod-welcome-")), sendMail: null });
    expect(off.queue("acct_1", "ada@example.test")).toBe("off");
    expect(off.counts()).toEqual({ enabled: false, queued: 0, sent: 0, failing: 0 });
    const { welcome } = mailer();
    expect(welcome.queue("acct_2", null)).toBe("no email");
    expect(welcome.queue("acct_3", "not an email")).toBe("no email");
  });

  it("retries a failed send later and sends it once it works", async () => {
    let fail = true;
    const sent: string[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { welcome } = mailer(async (mail) => {
      if (fail) throw new Error("mail provider answered 503");
      sent.push(mail.to);
    });
    welcome.queue("acct_1", "ada@example.test");
    await welcome.process();
    expect(welcome.counts()).toEqual({ enabled: true, queued: 1, sent: 0, failing: 1 });
    fail = false;
    await welcome.process();
    expect(sent).toEqual(["ada@example.test"]);
    expect(welcome.counts()).toEqual({ enabled: true, queued: 0, sent: 1, failing: 0 });
  });

  it("is on in production only with its switch, and sends only once the mail sender is connected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-welcome-"));
    const stub = async () => {};
    expect(welcomeMailerFromEnv(dir, {}, stub).enabled).toBe(false);
    expect(welcomeMailerFromEnv(dir, { ZENOD_WELCOME_MAIL: "1" }).enabled).toBe(false);
    expect(welcomeMailerFromEnv(dir, { ZENOD_WELCOME_MAIL: "1" }, stub).enabled).toBe(true);
    // E26-S11: with Zenod's Google client the welcome queues, and waits until Jordi connects the sender.
    const google = { ZENOD_WELCOME_MAIL: "1", GOOGLE_OAUTH_CLIENT_ID: "c", GOOGLE_OAUTH_CLIENT_SECRET: "s", CHASSIS_VAULT_MASTER_KEY: "k".repeat(64) };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const waiting = welcomeMailerFromEnv(dir, google);
    expect(waiting.queue("acct_1", "ada@example.test")).toBe("queued");
    await waiting.process();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(waiting.counts()).toEqual({ enabled: true, queued: 1, sent: 0, failing: 0 });
    fetchSpy.mockRestore();
  });

});
