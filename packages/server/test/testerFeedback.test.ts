// E7-S9: each tester's own voice feedback link, handed in by the vps3 timer and shown in the app to testers only.
import { personFacts } from "../src/testerFacts.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { feedbackLinkFor, mountTesterFeedbackRoutes, readTesterFeedback } from "../src/testerFeedback.js";

const account = (id: string, email: string, extra: Partial<CustomerAccount> = {}) =>
  ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active",
     checkout_completed_at: "2026-11-13T20:35:31.021Z", ...extra }) as CustomerAccount;

const URL_A = "https://signup.alpha9.io/api/public/feedback/AbCdEf123456";

describe("tester feedback links", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "tester-feedback-"));
  const accounts = [
    account("user-usr_aaaa", "dana@gmail.com"),
    account("user-usr_bbbb", "ops@alpha9.io"),
    account("user-usr_cccc", "notester@x.io"),
    account("user-usr_dddd", "gone@x.io", { subscription_status: "canceled" }),
    account("user-usr_eeee", "pending@x.io", { checkout_completed_at: null, subscription_status: "checkout_pending" }),
  ];
  let signedIn: CustomerAccount | null = null;
  const isTester = (a: CustomerAccount) => a.stripe_email !== "notester@x.io";
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterFeedbackRoutes(app, {
    dataDir,
    accounts: () => accounts,
    isTester,
    isTest: (a) => a.stripe_email === "ops@alpha9.io",
    isOps: (c) => c.req.header("authorization") === "Bearer ok",
    sessionAccount: () => signedIn,
    facts: (a) => personFacts(a, a.stripe_email === "dana@gmail.com" ? "Dana" : null),
  });
  const ops = { authorization: "Bearer ok", "content-type": "application/json" };

  it("is ops only", async () => {
    expect((await app.request("/api/ops/testers/feedback-links")).status).toBe(404);
    expect((await app.request("/api/ops/testers/feedback-links", { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("lists testers who finished checkout, our test accounts flagged, non-testers, cancelled and pending left out", async () => {
    const body = await (await app.request("/api/ops/testers/feedback-links", { headers: ops })).json() as { testers: Array<Record<string, unknown>> };
    expect(body.testers.map((t) => t.accountId)).toEqual(["user-usr_aaaa", "user-usr_bbbb"]);
    expect(body.testers[0]).toMatchObject({ who: "Dana (dana@gmail.com)", test: false, link: null });
    expect(body.testers[1]).toMatchObject({ who: "TEST ops@alpha9.io", test: true });
  });

  it("keeps the links the timer hands in and refuses bad ones", async () => {
    const res = await app.request("/api/ops/testers/feedback-links", {
      method: "POST", headers: ops,
      body: JSON.stringify({ links: [
        { accountId: "user-usr_aaaa", linkId: "fbl_1234abcd", url: URL_A, notes: 2 },
        { accountId: "user-usr_nope", linkId: "fbl_1234abcd", url: URL_A, notes: 0 },
        { accountId: "user-usr_bbbb", linkId: "fbl_5678", url: "http://evil.example/x", notes: 0 },
      ] }),
    });
    expect(await res.json()).toEqual({ saved: 1, refused: ["user-usr_nope", "user-usr_bbbb"] });
    expect(readTesterFeedback(dataDir)["user-usr_aaaa"]).toMatchObject({ linkId: "fbl_1234abcd", url: URL_A, notes: 2 });
    const listed = await (await app.request("/api/ops/testers/feedback-links", { headers: ops })).json() as { testers: Array<{ link: unknown }> };
    expect(listed.testers[0]!.link).toEqual({ linkId: "fbl_1234abcd", url: URL_A, notes: 2 });
  });

  it("shows the signed-in tester their own link and nothing to a non-tester", async () => {
    expect((await app.request("/api/console/feedback-link")).status).toBe(401);
    signedIn = accounts[0]!;
    expect(await (await app.request("/api/console/feedback-link")).json()).toEqual({ url: URL_A });
    signedIn = accounts[2]!;
    expect(await (await app.request("/api/console/feedback-link")).json()).toEqual({ url: null });
    expect(feedbackLinkFor(dataDir, { ...accounts[0]!, subscription_status: "canceled" }, isTester)).toBeNull();
  });
});
