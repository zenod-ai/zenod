// E26-S32: one email the day after sign-up when WhatsApp is still not linked, once per tester ever.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { mountTesterWhatsAppNudgeRoutes, TesterWhatsAppNudge, testerWhatsAppNudgeMail } from "../src/testerWhatsAppNudge.js";
import type { WhatsAppSetupRead } from "../src/zenodPhylax.js";

const NOW = new Date("2026-11-16T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const read = (extra: Partial<WhatsAppSetupRead> = {}): WhatsAppSetupRead => ({
  bound: true, state: "off", attempts: 0, lastAttemptAt: null, lastStatus: null, lastCode: null, ...extra,
});
const account = (id: string, email: string, claimed: string) =>
  ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active", claimed_at: claimed }) as CustomerAccount;

function setup(accounts: CustomerAccount[], reads: Record<string, WhatsAppSetupRead> = {}, envMode: "on" | "off" = "on") {
  const nudge = new TesterWhatsAppNudge({
    dataDir: mkdtempSync(join(tmpdir(), "nudge-")),
    envMode,
    accounts: () => accounts,
    isTester: () => true,
    isTest: (a) => a.stripe_email === "ops@alpha9.io",
    setup: async (id) => reads[id] ?? read(),
    firstName: (email) => (email === "ana@x.io" ? "ana maria" : null),
    now: () => NOW,
  });
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterWhatsAppNudgeRoutes(app, { isOps: (c) => c.req.header("authorization") === "Bearer ok", nudge });
  const call = (path: string, body?: unknown) => app.request(path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer ok", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { nudge, app, call };
}

describe("the approved email", () => {
  it("is word for word Jordi's E26-A17 text", () => {
    const mail = testerWhatsAppNudgeMail("ana@x.io", "Ana");
    expect(mail.subject).toBe("Your Zenod WhatsApp link");
    expect(mail.text.replace(/\n\n/g, " ")).toBe("Hi Ana, You signed up for Zenod yesterday but your WhatsApp isn't linked yet, so Zenod can't hear your voice notes. It takes a minute: open cloud.zenod.dev, go to Settings, WhatsApp and Telegram, type your number, press Create one-time code and send that code from the same phone to the number shown. If anything on that page goes wrong, just reply to this email and tell me what you see. I read every reply. Jordi");
    expect(testerWhatsAppNudgeMail("b@x.io", null).text.startsWith("Hi,\n\n")).toBe(true);
  });
});

describe("who gets it", () => {
  it("only a real tester not linked, signed up 24 to 48 hours ago, not on our bug", async () => {
    const accounts = [
      account("acct-ana", "ana@x.io", hoursAgo(25)),        // due
      account("acct-new", "new@x.io", hoursAgo(5)),         // too soon
      account("acct-old", "old@x.io", hoursAgo(87)),        // the 13 Nov tester: before it went live, left out
      account("acct-linked", "linked@x.io", hoursAgo(30)),  // linked
      account("acct-ops", "ops@alpha9.io", hoursAgo(30)),   // our test account
      account("acct-bug", "bug@x.io", hoursAgo(30)),        // stuck on our bug: the team helps by hand
    ];
    const { call } = setup(accounts, {
      "acct-linked": read({ state: "verified", attempts: 1, lastStatus: 200 }),
      "acct-bug": read({ attempts: 1, lastStatus: 503, lastAttemptAt: 1 }),
    });
    const body = await (await call("/api/ops/testers/whatsapp-nudge/queue")).json() as { mails: Array<Record<string, string>> };
    expect(body.mails.map((m) => m.id)).toEqual(["nudge-acct-ana"]);
    expect(body.mails[0]).toMatchObject({ to: "ana@x.io", subject: "Your Zenod WhatsApp link", account: "a***@x*** …-ana" });
    expect(body.mails[0]?.text.startsWith("Hi Ana,")).toBe(true);
  });

  it("is ops only", async () => {
    const { app } = setup([]);
    expect((await app.request("/api/ops/testers/whatsapp-nudge/queue")).status).toBe(404);
  });
});

describe("sent once, ever", () => {
  it("a reported send keeps the tester (and the address on another account) out for good", async () => {
    const accounts = [account("acct-ana", "ana@x.io", hoursAgo(25)), account("acct-ana2", "ANA@x.io", hoursAgo(26))];
    const { call, nudge } = setup(accounts);
    const first = await (await call("/api/ops/testers/whatsapp-nudge/queue")).json() as { mails: Array<{ id: string }> };
    expect(first.mails).toHaveLength(1);
    expect(await (await call("/api/ops/testers/whatsapp-nudge/sent", { id: first.mails[0]!.id, to: "ana@x.io", via: "team-gmail" })).json()).toMatchObject({ result: "sent", sent: 1 });
    expect(await (await call("/api/ops/testers/whatsapp-nudge/sent", { id: first.mails[0]!.id, to: "ana@x.io", via: "team-gmail" })).json()).toMatchObject({ result: "already sent", sent: 1 });
    expect(await nudge.due()).toEqual([]);
    expect((await call("/api/ops/testers/whatsapp-nudge/sent", { id: "acct-ana", to: "a@x.io", via: "x" })).status).toBe(404);
  });

  it("one setting switches it off", async () => {
    const { call, nudge } = setup([account("acct-ana", "ana@x.io", hoursAgo(25))]);
    expect(await (await call("/api/ops/testers/whatsapp-nudge", { mode: "off", by: "test" })).json()).toMatchObject({ mode: "off" });
    expect(await nudge.due()).toEqual([]);
    expect((await call("/api/ops/testers/whatsapp-nudge", { mode: "loud" })).status).toBe(400);
    expect(await (await call("/api/ops/testers/whatsapp-nudge", { mode: "on" })).json()).toMatchObject({ mode: "on" });
    expect(await nudge.due()).toHaveLength(1);
  });
});
