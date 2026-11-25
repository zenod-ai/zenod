// E26-S26: one switch, the link watch and the once-only thank-you mail.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { FEEDBACK_LINK_WAIT_MS, FEEDBACK_PARAGRAPH, greetingName, mountTesterMailQueueRoutes, parseOnboardingMode, TesterOnboarding, testerThanksMail } from "../src/testerOnboarding.js";
import type { SendMail, ZenodMail } from "../src/zenodMail.js";
import { personFacts } from "../src/testerFacts.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function account(id: string, email: string, extra: Partial<CustomerAccount> = {}): CustomerAccount {
  // E7-S40: a real account has the address it signed in with; mail goes only there.
  return { account_id: id, stripe_email: email, github_email: email, ...extra } as CustomerAccount;
}

const NAMES: Record<string, string> = { "ana@example.org": "ana maria", "pay@example.org": "Pat", "zenod-test@example.org": "Zed" };

async function setup(envMode: "off" | "test" | "on" = "on", ready = true, extra: { feedbackLink?: (id: string) => string | null; now?: () => Date } = {}) {
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
    facts: (a) => personFacts(a, NAMES[a.stripe_email ?? ""] ?? null),
    whatsappState: async (id) => whatsapp.get(id) ?? "off",
    sendWelcome,
    ...extra,
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

  it("a test send that could not reach WhatsApp marks nothing, queues no mail and can be retried", async () => {
    const { onboarding, sent, sendWelcome } = await setup("test");
    const ours = account("ourtest-1", "zenod-test@example.org");
    sendWelcome.mockResolvedValueOnce("skipped" as never);
    expect(await onboarding.testSend(ours)).toEqual({ whatsapp: "skipped", mail: "not queued" });
    expect(onboarding.status().linked).toBe(0);
    expect(await onboarding.testSend(ours)).toEqual({ whatsapp: "sent", mail: "queued" });
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
  });

  it("one person with two accounts on one email gets one thank-you mail", async () => {
    const { onboarding, sent } = await setup("test");
    expect(await onboarding.testSend(account("ourtest-1", "zenod-test@example.org"))).toEqual({ whatsapp: "sent", mail: "queued" });
    expect(await onboarding.testSend(account("ourtest-2", "Zenod-Test@example.org"))).toEqual({ whatsapp: "sent", mail: "already queued" });
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
  });

  it("E7-S40: the thank-you goes to the sign-in address with the joined name; a nameless one is held, not guessed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "tester-onboarding-"));
    dirs.push(dataDir);
    const sent: ZenodMail[] = [];
    const send = (async (mail: ZenodMail) => { sent.push(mail); }) as SendMail;
    send.ready = () => true;
    const daniel = account("daniel", "paid@example.org", { github_email: "signin@example.org", signin_name: "Daniel Short", signin_name_from: "the name on their Google sign-in" });
    const noname = account("noname", "x@example.org", { github_email: "nn@example.org" });
    const accounts = new Map([["daniel", daniel], ["noname", noname]]);
    const onboarding = new TesterOnboarding({
      dataDir, envMode: "on", sendMail: send,
      account: (id) => accounts.get(id) ?? null,
      isTester: () => true, isTest: () => true,
      facts: (a) => personFacts(a, null),
      whatsappState: async () => "verified",
      sendWelcome: vi.fn(async () => "sent" as const),
    });
    expect(await onboarding.testSend(daniel)).toMatchObject({ mail: "queued" });
    expect(await onboarding.testSend(noname)).toMatchObject({ mail: "queued" });
    await onboarding.thanks.process();
    expect(sent.map((m) => m.to)).toEqual(["signin@example.org"]);
    expect(sent[0]!.text.startsWith("Hi Daniel,")).toBe(true);
    expect("facts" in sent[0]!).toBe(false);
    const held = onboarding.thanks.pending().find((m) => m.id === "noname");
    expect(held?.facts?.missing).toEqual(["name: none typed on the application and none from the sign-in"]);
  });

  it("lists queued mail for an outside sender and marks it sent once per address (E26-S28 it3)", async () => {
    const { onboarding, sent } = await setup("test", false);
    expect(await onboarding.testSend(account("ourtest-1", "zenod-test@example.org"))).toEqual({ whatsapp: "sent", mail: "queued" });
    await onboarding.thanks.process();
    expect(sent).toHaveLength(0);
    const [pending, ...rest] = onboarding.thanks.pending();
    expect(rest).toHaveLength(0);
    expect(pending).toMatchObject({ id: "ourtest-1", to: "zenod-test@example.org", subject: "Thank you for testing Zenod" });
    expect(pending.text).toContain('Reply "call"');
    expect(pending.html).toContain("zenod.dev/start");
    expect(Object.keys(pending).sort()).toEqual(["facts", "html", "id", "queuedAt", "subject", "text", "to"]);
    // E7-S40: the facts gmail_send needs ride with the mail.
    expect(pending.facts).toMatchObject({ address_from: expect.stringContaining("signed in"), name: "Zed", name_from: expect.stringContaining("application") });
    expect(onboarding.thanks.markSent("ourtest-1", "team-gmail", "<m1@mail>")).toBe("sent");
    expect(onboarding.thanks.markSent("ourtest-1", "team-gmail", "<m2@mail>")).toBe("already sent");
    expect(onboarding.thanks.markSent("nobody", "team-gmail")).toBe("unknown");
    expect(onboarding.thanks.pending()).toHaveLength(0);
    expect(onboarding.status().mail).toMatchObject({ queued: 0, sent: 1 });
  });

  it("the ops mail-queue routes need the token, list one mail per address and mark idempotently", async () => {
    const auth = { authorization: "Bearer ok", "content-type": "application/json" };
    const fresh = await setup("test", false);
    fresh.onboarding.thanks.queue("old-1", "jordi@example.org");
    fresh.onboarding.thanks.queue("old-2", "Jordi@example.org");
    fresh.onboarding.thanks.queue("other-1", "ana@example.org");
    // Two records to one address (queued before the address check existed): only the first is listed.
    const app2 = new Hono<{ Bindings: HttpBindings }>();
    mountTesterMailQueueRoutes(app2, { isOps: (c) => c.req.header("authorization") === "Bearer ok", onboarding: fresh.onboarding });
    expect((await app2.request("/api/ops/testers/onboarding/mail-queue")).status).toBe(404);
    const list = await app2.request("/api/ops/testers/onboarding/mail-queue", { headers: auth });
    const body = (await list.json()) as { mode: string; mails: Array<{ id: string }> };
    expect(body.mode).toBe("test");
    expect(body.mails.map((m) => m.id)).toEqual(["old-1", "other-1"]);
    const mark = (payload: unknown) =>
      app2.request("/api/ops/testers/onboarding/mail-sent", { method: "POST", headers: auth, body: JSON.stringify(payload) });
    expect((await mark({ id: "old-1" })).status).toBe(400);
    expect((await mark({ id: "nope", via: "team-gmail" })).status).toBe(404);
    expect(await (await mark({ id: "old-1", via: "team-gmail", messageId: "<a@b>" })).json()).toMatchObject({ result: "sent" });
    expect(await (await mark({ id: "old-1", via: "team-gmail" })).json()).toMatchObject({ result: "already sent" });
    // old-2 has the same address: closed with old-1, never listed, never sent by Zenod's own sender either.
    const after = (await (await app2.request("/api/ops/testers/onboarding/mail-queue", { headers: auth })).json()) as { mails: Array<{ id: string }> };
    expect(after.mails.map((m) => m.id)).toEqual(["other-1"]);
    expect(fresh.onboarding.thanks.counts()).toMatchObject({ queued: 1, sent: 2 });
  });

  it("lists nothing while switched off", async () => {
    const { onboarding } = await setup("test", false);
    onboarding.thanks.queue("old-1", "jordi@example.org");
    expect(onboarding.thanks.pending()).toHaveLength(1);
    onboarding.setMode("off", "test");
    expect(onboarding.thanks.pending()).toHaveLength(0);
  });
});

describe("the voice feedback paragraph in the thank-you (E7-S10)", () => {
  const LINK = "https://signup.alpha9.io/api/public/feedback/abcDEF123_-x";
  const APPROVED =
    "Could you leave us a voice note about Zenod once a week? Open this link, tap the button and talk; a minute is plenty. Nobody listens to the audio: it becomes text for our team and is thrown away.";

  it("carries Jordi's approved words with the tester's own link, the rest unchanged", () => {
    expect(FEEDBACK_PARAGRAPH).toBe(APPROVED);
    const without = testerThanksMail("a@b.org", "Ana", 50);
    const withLink = testerThanksMail("a@b.org", "Ana", 50, LINK);
    expect(without.text).not.toContain("voice note");
    expect(withLink.text).toContain(`\n\n${APPROVED} ${LINK}\n\nA few useful links:`);
    expect(withLink.text.replace(`${APPROVED} ${LINK}\n\n`, "")).toBe(without.text);
    expect(withLink.html).toContain(`<p>${APPROVED.replace(/'/g, "&#39;")} <a href="${LINK}"`);
    expect(withLink.subject).toBe(without.subject);
  });

  it("leaves the paragraph out for a link that is not a feedback link", () => {
    for (const bad of ["javascript:alert(1)", "https://evil.example/x", `${LINK}"><script>`]) {
      expect(testerThanksMail("a@b.org", null, 50, bad).text).not.toContain("voice note");
    }
  });

  it("a tester with a link gets it in the one thank-you, never a second email", async () => {
    const links = new Map([["tester-1", LINK]]);
    const { onboarding, sent, whatsapp } = await setup("on", false, { feedbackLink: (id) => links.get(id) ?? null });
    onboarding.whatsappWelcome("tester-1");
    whatsapp.set("tester-1", "verified");
    await onboarding.sweep();
    const [mail, ...rest] = onboarding.thanks.pending();
    expect(rest).toHaveLength(0);
    expect(mail!.text).toContain(`${APPROVED} ${LINK}`);
    expect(onboarding.thanks.markSent(mail!.id, "team-gmail")).toBe("sent");
    expect(onboarding.thanks.pending()).toHaveLength(0);
    // Relinking, a re-sync or a test send: nothing goes again.
    expect(onboarding.whatsappWelcome("tester-1")).toBeNull();
    await onboarding.sweep();
    expect(await onboarding.testSend(account("tester-1", "ana@example.org"))).toEqual({ whatsapp: "already sent", mail: "already sent" });
    expect(onboarding.thanks.pending()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("a tester already thanked before the paragraph existed is never mailed again", async () => {
    const links = new Map<string, string>();
    const { onboarding } = await setup("on", false, { feedbackLink: (id) => links.get(id) ?? null });
    onboarding.whatsappWelcome("tester-1");
    await onboarding.sweep();
    expect(await onboarding.testSend(account("ourtest-1", "zenod-test@example.org"))).toMatchObject({ mail: "queued" });
    // The old thank-you (no link then) goes out after its wait.
    expect(onboarding.thanks.markSent("ourtest-1", "team-gmail")).toBe("sent");
    links.set("ourtest-1", LINK);
    expect(onboarding.thanks.pending()).toHaveLength(0);
    expect(await onboarding.testSend(account("ourtest-1", "zenod-test@example.org"))).toEqual({ whatsapp: "already sent", mail: "already sent" });
    expect(onboarding.thanks.pending()).toHaveLength(0);
  });

  it("no link yet: waits for the link timer, then sends once without the paragraph", async () => {
    let now = new Date("2026-11-16T21:00:00Z");
    const links = new Map<string, string>();
    const { onboarding, sent } = await setup("test", true, { feedbackLink: (id) => links.get(id) ?? null, now: () => now });
    expect(await onboarding.testSend(account("ourtest-1", "zenod-test@example.org"))).toMatchObject({ mail: "queued" });
    await onboarding.thanks.process();
    expect(onboarding.thanks.pending()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    // The link arrives within the wait: the mail goes with it.
    now = new Date(now.getTime() + 15 * 60 * 1000);
    links.set("ourtest-1", LINK);
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(`${APPROVED} ${LINK}`);
    await onboarding.thanks.process();
    expect(sent).toHaveLength(1);
  });

  it("no link after the wait: the thank-you goes without the paragraph, once", async () => {
    let now = new Date("2026-11-16T21:00:00Z");
    const { onboarding } = await setup("test", false, { feedbackLink: () => null, now: () => now });
    await onboarding.testSend(account("ourtest-1", "zenod-test@example.org"));
    expect(onboarding.thanks.pending()).toHaveLength(0);
    now = new Date(now.getTime() + FEEDBACK_LINK_WAIT_MS);
    const [mail] = onboarding.thanks.pending();
    expect(mail!.text).not.toContain("voice note");
    expect(onboarding.thanks.markSent(mail!.id, "team-gmail")).toBe("sent");
    expect(onboarding.thanks.pending()).toHaveLength(0);
  });
});
