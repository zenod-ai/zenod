// E26-S26: one switch, the link watch and the once-only thank-you mail.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { greetingName, parseOnboardingMode, TesterOnboarding, testerThanksMail } from "../src/testerOnboarding.js";
import type { SendMail, ZenodMail } from "../src/zenodMail.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function account(id: string, email: string, extra: Partial<CustomerAccount> = {}): CustomerAccount {
  return { account_id: id, stripe_email: email, github_email: null, ...extra } as CustomerAccount;
}

async function setup(envMode: "off" | "test" | "on" = "on", ready = true) {
  const dataDir = await mkdtemp(join(tmpdir(), "tester-onboarding-"));
  dirs.push(dataDir);
  const sent: ZenodMail[] = [];
  const send = (async (mail: ZenodMail) => {
    sent.push(mail);
  }) as SendMail;
  send.ready = () => ready;
  const accounts = new Map<string, CustomerAccount>([
    ["tester-1", account("tester-1", "ana@example.org", { fully_discounted: true, free_until: "2026-12-14" })],
    ["payer-1", account("payer-1", "pay@example.org")],
    ["ourtest-1", account("ourtest-1", "zenod-test@example.org")],
  ]);
  const whatsapp = new Map<string, string>();
  const sendWelcome = vi.fn(async () => "sent" as const);
  const onboarding = new TesterOnboarding({
    dataDir,
    envMode,
    sendMail: send,
    account: (id) => accounts.get(id) ?? null,
    isTester: (a) => Boolean(a.fully_discounted && a.free_until),
    isTest: (a) => a.stripe_email === "zenod-test@example.org",
    firstName: (email) => (email === "ana@example.org" ? "ana maria" : null),
    whatsappState: async (id) => whatsapp.get(id) ?? "off",
    sendWelcome,
  });
  return { onboarding, sent, whatsapp, sendWelcome };
}

describe("tester onboarding (E26-S26)", () => {
  it("reads the mode from words and numbers", () => {
    expect(parseOnboardingMode("0")).toBe("off");
    expect(parseOnboardingMode("on")).toBe("on");
    expect(parseOnboardingMode(" TEST ")).toBe("test");
    expect(parseOnboardingMode("maybe")).toBeNull();
  });

  it("greets a plain first name, else Hi,", () => {
    expect(greetingName("ana maria")).toBe("Ana");
    expect(greetingName("@handle")).toBeNull();
    expect(greetingName("")).toBeNull();
    const mail = testerThanksMail("a@b.org", null);
    expect(mail.text.startsWith("Hi,\n")).toBe(true);
    expect(mail.subject).toBe("Thank you for testing Zenod");
    for (const link of ["cloud.zenod.dev/app", "zenod.dev/connect", "zenod.dev/start", "zenod.dev/testers"]) {
      expect(mail.text).toContain(`https://${link}`);
      expect(mail.html).toContain(`>${link}</a>`);
    }
    expect(mail.text).toContain('Reply "call"');
  });

  it("arms a tester, queues one thank-you on the link, never twice", async () => {
    const { onboarding, sent, whatsapp } = await setup("on");
    expect(onboarding.whatsappWelcome("payer-1")).toBeNull();
    expect(onboarding.whatsappWelcome("tester-1")).toBe("tester");
    await onboarding.sweep();
    expect(sent).toHaveLength(0);
    whatsapp.set("tester-1", "verified");
    await onboarding.sweep();
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@example.org", subject: "Thank you for testing Zenod" });
    expect(sent[0]!.text.startsWith("Hi Ana,")).toBe(true);
    // Relinking later: nothing armed, nothing sent again.
    expect(onboarding.whatsappWelcome("tester-1")).toBeNull();
    await onboarding.sweep();
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
    expect(onboarding.status()).toMatchObject({ mode: "on", linked: 1, watching: 0, mailSender: "ready", mail: { sent: 1, queued: 0 } });
  });

  it("test mode reaches only our own test accounts", async () => {
    const { onboarding } = await setup("test");
    expect(onboarding.whatsappWelcome("tester-1")).toBeNull();
    expect(onboarding.whatsappWelcome("ourtest-1")).toBe("tester");
  });

  it("switching off stops arming and drops queued mail at once", async () => {
    const { onboarding, sent, whatsapp } = await setup("on", false);
    expect(onboarding.whatsappWelcome("tester-1")).toBe("tester");
    whatsapp.set("tester-1", "verified");
    await onboarding.sweep();
    expect(onboarding.status()).toMatchObject({ mailSender: "waiting", mail: { queued: 1 } });
    onboarding.setMode("off", "test");
    await onboarding.thanks.process();
    expect(onboarding.status()).toMatchObject({ mode: "off", mail: { queued: 0, sent: 0 } });
    expect(onboarding.whatsappWelcome("ourtest-1")).toBeNull();
    onboarding.setMode("on", "test");
    await onboarding.thanks.process();
    expect(sent).toHaveLength(0);
  });

  it("the test send reaches an already linked account once, and not while off", async () => {
    const { onboarding, sent, sendWelcome } = await setup("off");
    const ours = account("ourtest-1", "zenod-test@example.org");
    expect(await onboarding.testSend(ours)).toEqual({ whatsapp: "off", mail: "off" });
    onboarding.setMode("test", "test");
    expect(await onboarding.testSend(ours)).toEqual({ whatsapp: "sent", mail: "queued" });
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
    expect(await onboarding.testSend(ours)).toEqual({ whatsapp: "already sent", mail: "already sent" });
  });
});
