// E26-S33: the welcome email with the video and five things to try, once per tester when the free sign-up is finished.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { mountTesterSignupWelcomeRoutes, TesterSignupWelcome, testerSignupWelcomeMail } from "../src/testerSignupWelcome.js";

const NOW = new Date("2026-11-17T19:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const account = (id: string, email: string, claimed: string, extra: Partial<CustomerAccount> = {}) =>
  ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active", claimed_at: claimed, ...extra }) as CustomerAccount;

function setup(accounts: CustomerAccount[], envMode: "on" | "off" = "on") {
  const welcome = new TesterSignupWelcome({
    dataDir: mkdtempSync(join(tmpdir(), "welcome-")),
    envMode,
    accounts: () => accounts,
    isTester: (a) => a.stripe_email !== "friend@x.io",
    isTest: (a) => a.stripe_email === "ops@alpha9.io",
    setup: async () => null,
    now: () => NOW,
  });
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterSignupWelcomeRoutes(app, { isOps: (c) => c.req.header("authorization") === "Bearer ok", welcome });
  const call = (path: string, body?: unknown) => app.request(path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer ok", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { welcome, app, call };
}

const EXACT = `Hi,

Thank you for being one of our first ten testers. Your first 30 memories are free, no card.

Here is a 30 second look at what you are about to use: https://www.youtube.com/shorts/bEmBSBM-Phs

Five things to try first:

1. Say something. Send a voice note and Zenod keeps it word for word, then files it by topic.
2. Connect a tool. Claude, ChatGPT, Cursor, VS Code or Gemini CLI reach your memory over MCP. The steps are at https://zenod.dev/connect
3. Ask it something. Any connected tool can search your memory and open the exact note behind its answer.
4. Look at the graph. Every memory links to others, and the memories behind an answer light up.
5. Check where it lives. Your notes sit in your own Google Drive or GitHub, and you can open them in Obsidian any time.

One thing we would love back: what made you try Zenod, and what got stuck? A one-minute voice note is enough. Just reply to this message.

The Zenod team`;

describe("the approved welcome", () => {
  it("is word for word zenod-social's EPIC-6-A4 text", () => {
    const mail = testerSignupWelcomeMail("ana@x.io");
    expect(mail.subject).toBe("Welcome to Zenod, here is how to start");
    expect(mail.text).toBe(EXACT);
    expect(mail.html).toContain('<a href="https://www.youtube.com/shorts/bEmBSBM-Phs"');
    expect(mail.html).toContain('<a href="https://zenod.dev/connect"');
    expect(mail.html.match(/<li>/g)).toHaveLength(5);
  });
});

describe("who gets it", () => {
  it("every real tester whose free sign-up is finished in the last 7 days, test accounts left out", async () => {
    const accounts = [
      account("acct-ana", "ana@x.io", hoursAgo(0.2)),                                // just signed up: due
      account("acct-first", "first@x.io", hoursAgo(94.5)),                           // the 13 Nov tester: due once now
      account("acct-old", "old@x.io", hoursAgo(24 * 8)),                             // older than 7 days: left out
      account("acct-ops", "ops@alpha9.io", hoursAgo(1)),                             // our test account: left out
      account("acct-friend", "friend@x.io", hoursAgo(1)),                            // not a tester
      account("acct-pending", "pend@x.io", hoursAgo(1), { subscription_status: "checkout_pending" }), // sign-up not finished
      account("acct-noworkspace", "nows@x.io", hoursAgo(1), { tenant_id: "" }),      // sign-up not finished
    ];
    const { call } = setup(accounts);
    const body = await (await call("/api/ops/testers/signup-welcome/queue")).json() as { mails: Array<Record<string, string>> };
    expect(body.mails.map((m) => m.id)).toEqual(["welcome-acct-ana", "welcome-acct-first"]);
    expect(body.mails[0]).toMatchObject({ to: "ana@x.io", subject: "Welcome to Zenod, here is how to start", account: "a***@x*** …-ana" });
    expect(body.mails[0]?.text).toBe(EXACT);
  });

  it("is ops only", async () => {
    const { app } = setup([]);
    expect((await app.request("/api/ops/testers/signup-welcome/queue")).status).toBe(404);
    expect((await app.request("/api/ops/testers/signup-welcome", { method: "POST", body: "{\"mode\":\"off\"}" })).status).toBe(404);
  });
});

describe("sent once, ever", () => {
  it("a reported send keeps the tester (and the same address on another account) out for good", async () => {
    const accounts = [account("acct-ana", "ana@x.io", hoursAgo(1)), account("acct-ana2", "ANA@x.io", hoursAgo(2))];
    const { call, welcome } = setup(accounts);
    const first = await (await call("/api/ops/testers/signup-welcome/queue")).json() as { mails: Array<{ id: string }> };
    expect(first.mails).toHaveLength(1);
    expect(await (await call("/api/ops/testers/signup-welcome/sent", { id: first.mails[0]!.id, to: "ana@x.io", via: "team-gmail" })).json()).toMatchObject({ result: "sent", sent: 1 });
    expect(await (await call("/api/ops/testers/signup-welcome/sent", { id: first.mails[0]!.id, to: "ana@x.io", via: "team-gmail" })).json()).toMatchObject({ result: "already sent", sent: 1 });
    expect(await welcome.due()).toEqual([]);
    expect((await call("/api/ops/testers/signup-welcome/sent", { id: "nudge-acct-ana", to: "a@x.io", via: "x" })).status).toBe(404);
  });

  it("the sent record survives a restart (kept on the data volume)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "welcome-"));
    const opts = { dataDir, envMode: "on" as const, accounts: () => [account("acct-ana", "ana@x.io", hoursAgo(1))], isTester: () => true, isTest: () => false, setup: async () => null, now: () => NOW };
    const before = new TesterSignupWelcome(opts);
    expect(before.markSent("welcome-acct-ana", "ana@x.io", "team-gmail")).toBe("sent");
    expect(await new TesterSignupWelcome(opts).due()).toEqual([]);
  });
});

describe("one setting switches it off", () => {
  it("mode off empties the queue at once, on brings it back", async () => {
    const { call, welcome } = setup([account("acct-ana", "ana@x.io", hoursAgo(1))]);
    expect(await (await call("/api/ops/testers/signup-welcome", { mode: "off", by: "test" })).json()).toMatchObject({ mode: "off" });
    expect(await welcome.due()).toEqual([]);
    expect((await call("/api/ops/testers/signup-welcome", { mode: "loud" })).status).toBe(400);
    expect(await (await call("/api/ops/testers/signup-welcome", { mode: "on" })).json()).toMatchObject({ mode: "on" });
    expect(await welcome.due()).toHaveLength(1);
  });

  it("the env setting starts it off", async () => {
    const { welcome } = setup([account("acct-ana", "ana@x.io", hoursAgo(1))], "off");
    expect(await welcome.due()).toEqual([]);
  });
});
