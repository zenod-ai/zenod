// E7-S28: Jordi's own setup email, once per tester, 48 hours after a sign-up with nothing done.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { mountTesterSetupEmailRoutes, TesterSetupEmail, testerSetupEmail } from "../src/testerSetupEmail.js";
import type { WhatsAppSetupRead } from "../src/zenodPhylax.js";

const NOW = new Date("2026-11-22T20:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const read = (extra: Partial<WhatsAppSetupRead> = {}): WhatsAppSetupRead => ({
  bound: true, state: "off", attempts: 0, lastAttemptAt: null, lastStatus: null, lastCode: null, ...extra,
});
const account = (id: string, email: string, claimed: string) =>
  ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active", claimed_at: claimed }) as CustomerAccount;

function setup(accounts: CustomerAccount[], reads: Record<string, WhatsAppSetupRead> = {}, withVault: string[] = [], envMode: "on" | "off" = "on") {
  const setupEmail = new TesterSetupEmail({
    dataDir: mkdtempSync(join(tmpdir(), "setup-email-")),
    envMode,
    accounts: () => accounts,
    isTester: () => true,
    isTest: (a) => a.stripe_email === "ops@alpha9.io",
    setup: async (id) => reads[id] ?? read(),
    vaultSet: (a) => withVault.includes(a.account_id),
    now: () => NOW,
  });
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterSetupEmailRoutes(app, { isOps: (c) => c.req.header("authorization") === "Bearer ok", setupEmail });
  const call = (path: string, body?: unknown) => app.request(path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer ok", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { setupEmail, app, call };
}

describe("the approved email", () => {
  it("is Jordi's E7-A36 text, every sentence capitalized, the three steps on their own lines, signed Jordi", () => {
    const mail = testerSetupEmail("ana@x.io");
    expect(mail.subject).toBe("Your Zenod setup");
    expect(mail.text).toBe([
      "Hey, thank you so much for giving Zenod a try. I noticed that you signed up but haven't fully set it up yet. Here is what is left:",
      "1. Connect your GitHub or Google Drive.\n2. Connect WhatsApp.\n3. Try saving a memory.",
      "Zenod exists to make your memory yours, in a way that makes it easy to add memories to it and read from it. If there is anything I can do to help you get set up, let me know.",
      "Jordi",
    ].join("\n\n"));
    for (const sentence of mail.text.replace(/^\d\. /gm, "").split(/(?<=[.:])\s+/)) expect(sentence).toMatch(/^[A-Z]/);
    expect(mail.html).toContain("<li>Connect WhatsApp.</li>");
  });
});

describe("who gets it", () => {
  it("only a real tester with no notes place and no WhatsApp, signed up 48 hours ago or more, not on our bug", async () => {
    const accounts = [
      account("acct-late", "late@x.io", hoursAgo(100)),     // due: signed up long ago, still nothing
      account("acct-edge", "edge@x.io", hoursAgo(49)),      // due
      account("acct-young", "young@x.io", hoursAgo(47)),    // too soon: the next-day email's window
      account("acct-linked", "linked@x.io", hoursAgo(60)),  // WhatsApp linked
      account("acct-vault", "vault@x.io", hoursAgo(60)),    // notes place connected
      account("acct-ops", "ops@alpha9.io", hoursAgo(60)),   // our test account
      account("acct-bug", "bug@x.io", hoursAgo(60)),        // stuck on our bug: the team helps by hand
    ];
    const { call } = setup(accounts, {
      "acct-linked": read({ state: "verified", attempts: 1, lastStatus: 200 }),
      "acct-bug": read({ attempts: 1, lastStatus: 503, lastAttemptAt: 1 }),
    }, ["acct-vault"]);
    const body = await (await call("/api/ops/testers/setup-email/queue")).json() as { mails: Array<Record<string, string>> };
    expect(body.mails.map((m) => m.id).sort()).toEqual(["setup-acct-edge", "setup-acct-late"]);
    expect(body.mails[0]).toMatchObject({ subject: "Your Zenod setup" });
    expect(body.mails.find((m) => m.id === "setup-acct-late")).toMatchObject({ to: "late@x.io", account: "l***@x*** …late" });
  });

  it("a person with two accounts, one with a notes place or WhatsApp, is not nudged", async () => {
    const accounts = [account("acct-a", "ana@x.io", hoursAgo(60)), account("acct-b", "ANA@x.io", hoursAgo(61)), account("acct-c", "cy@x.io", hoursAgo(60)), account("acct-d", "cy@x.io", hoursAgo(60))];
    const { setupEmail } = setup(accounts, { "acct-d": read({ state: "verified", attempts: 1, lastStatus: 200 }) }, ["acct-b"]);
    expect(await setupEmail.due()).toEqual([]);
  });

  it("is ops only", async () => {
    const { app } = setup([]);
    expect((await app.request("/api/ops/testers/setup-email/queue")).status).toBe(404);
  });
});

describe("sent once, ever", () => {
  it("a reported send keeps the tester (and the address on another account) out for good", async () => {
    const accounts = [account("acct-ana", "ana@x.io", hoursAgo(60)), account("acct-ana2", "ANA@x.io", hoursAgo(70))];
    const { call, setupEmail } = setup(accounts);
    const first = await (await call("/api/ops/testers/setup-email/queue")).json() as { mails: Array<{ id: string }> };
    expect(first.mails).toHaveLength(1);
    expect(await (await call("/api/ops/testers/setup-email/sent", { id: first.mails[0]!.id, to: "ana@x.io", via: "team-gmail" })).json()).toMatchObject({ result: "sent", sent: 1 });
    expect(await (await call("/api/ops/testers/setup-email/sent", { id: first.mails[0]!.id, to: "ana@x.io", via: "team-gmail" })).json()).toMatchObject({ result: "already sent", sent: 1 });
    expect(await setupEmail.due()).toEqual([]);
    expect((await call("/api/ops/testers/setup-email/sent", { id: "acct-ana", to: "a@x.io", via: "x" })).status).toBe(404);
  });

  it("one setting switches it off", async () => {
    const { call, setupEmail } = setup([account("acct-ana", "ana@x.io", hoursAgo(60))]);
    expect(await (await call("/api/ops/testers/setup-email", { mode: "off", by: "test" })).json()).toMatchObject({ mode: "off" });
    expect(await setupEmail.due()).toEqual([]);
    expect((await call("/api/ops/testers/setup-email", { mode: "loud" })).status).toBe(400);
    expect(await (await call("/api/ops/testers/setup-email", { mode: "on" })).json()).toMatchObject({ mode: "on" });
    expect(await setupEmail.due()).toHaveLength(1);
  });
});
