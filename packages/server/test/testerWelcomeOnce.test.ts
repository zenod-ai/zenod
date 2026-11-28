// E7-S48 (Jordi's Yes on E7-S47): the new tester welcome once to a named, already linked tester, never twice, no email.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { mountTesterWelcomeOnceRoutes, TesterWelcomeOnce, type WelcomeOnceReceipt } from "../src/testerWelcomeOnce.js";

const account = (id: string, email: string) =>
  ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active" }) as CustomerAccount;

function setup(opts: { accounts: CustomerAccount[]; states?: Record<string, string>; testers?: string[]; result?: WelcomeOnceReceipt["result"] }) {
  const sends: Array<{ id: string; op: string }> = [];
  const welcome = new TesterWelcomeOnce({
    dataDir: mkdtempSync(join(tmpdir(), "welcome-once-")),
    accounts: () => opts.accounts,
    isTester: (a) => !opts.testers || opts.testers.includes(a.account_id),
    whatsappState: async (id) => opts.states?.[id] ?? "verified",
    send: async (a, op) => {
      sends.push({ id: a.account_id, op });
      return { result: opts.result ?? "sent", messageId: "wamid.X1", status: "sent", at: "2026-11-28T11:00:00Z" };
    },
    now: () => new Date("2026-11-28T11:00:00Z"),
  });
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterWelcomeOnceRoutes(app, { isOps: (c) => c.req.header("authorization") === "Bearer ops", welcome });
  const post = (body: unknown, auth = "Bearer ops") =>
    app.request("/api/ops/testers/welcome-once", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { welcome, sends, post, app };
}

describe("tester welcome once (E7-S48)", () => {
  it("sends once to the named linked tester with its own operation id, and refuses a second", async () => {
    const t = setup({ accounts: [account("a1", "nox@example.org"), account("a2", "other@example.org")] });
    const first = await t.post({ email: "NOX@example.org", by: "E7-S48 run_x" });
    expect(first.status).toBe(200);
    const body = await first.json() as Record<string, unknown>;
    expect(body).toMatchObject({ result: "sent", messageId: "wamid.X1", by: "ops: E7-S48 run_x" });
    expect(t.sends).toEqual([{ id: "a1", op: "tester-welcome-once-a1" }]);
    const second = await t.post({ email: "nox@example.org", by: "E7-S48 run_x" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ result: "already sent" });
    expect(t.sends).toHaveLength(1);
    const status = await (await t.app.request("/api/ops/testers/welcome-once", { headers: { authorization: "Bearer ops" } })).json() as { sent: unknown[] };
    expect(status.sent).toHaveLength(1);
  });

  it("needs the ops token, a by, a known account, a tester and a linked WhatsApp", async () => {
    const t = setup({ accounts: [account("a1", "nox@example.org"), account("a2", "x@example.org")], states: { a2: "off" }, testers: ["a2"] });
    expect((await t.post({ email: "nox@example.org", by: "x" }, "Bearer nope")).status).toBe(404);
    expect((await t.post({ email: "nox@example.org" })).status).toBe(400);
    expect((await t.post({ email: "nobody@example.org", by: "x" })).status).toBe(404);
    expect(await (await t.post({ email: "nox@example.org", by: "x" })).json()).toMatchObject({ result: "not a tester" });
    expect(await (await t.post({ accountId: "a2", by: "x" })).json()).toMatchObject({ result: "whatsapp not linked" });
    expect(t.sends).toHaveLength(0);
  });

  it("a send that did not go out is recorded and may be tried again", async () => {
    const t = setup({ accounts: [account("a1", "nox@example.org")], result: "failed" });
    expect((await t.post({ accountId: "a1", by: "x" })).status).toBe(502);
    expect((await t.post({ accountId: "a1", by: "x" })).status).toBe(502);
    expect(t.sends).toHaveLength(2);
  });
});
