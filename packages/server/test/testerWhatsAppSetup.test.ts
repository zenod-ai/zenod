// E26-S31: where a tester's WhatsApp setup stands, for the stuck-sign-up check.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { maskAccount, mountTesterWhatsAppSetupRoute, whatsappSetupStep } from "../src/testerWhatsAppSetup.js";
import type { WhatsAppSetupRead } from "../src/zenodPhylax.js";

const read = (extra: Partial<WhatsAppSetupRead> = {}): WhatsAppSetupRead => ({
  bound: true, state: "off", attempts: 0, lastAttemptAt: null, lastStatus: null, lastCode: null, ...extra,
});

describe("whatsappSetupStep", () => {
  it("names each step and flags only our failures as our bug", () => {
    expect(whatsappSetupStep(read({ state: "verified", attempts: 1, lastStatus: 200 })).step).toBe("linked");
    expect(whatsappSetupStep(read()).step).toBe("not_started");
    expect(whatsappSetupStep(read({ state: "awaiting_code", attempts: 1, lastStatus: 200, lastAttemptAt: 1 })).step).toBe("waiting_for_code");
    expect(whatsappSetupStep(read({ attempts: 1, lastStatus: 200, lastAttemptAt: 1 })).step).toBe("code_expired");
    expect(whatsappSetupStep(read({ attempts: 2, lastStatus: 400, lastCode: "invalid_identity", lastAttemptAt: 1 }))).toMatchObject({ step: "refused", ourBug: false });
    expect(whatsappSetupStep(read({ attempts: 1, lastAttemptAt: 1 })).step).toBe("unknown");
    const ours = whatsappSetupStep(read({ attempts: 1, lastStatus: 503, lastCode: "channels_unavailable", lastAttemptAt: 1 }));
    expect(ours).toMatchObject({ step: "our_error", ourBug: true });
    expect(ours.text).toContain("503 channels_unavailable");
    expect(whatsappSetupStep(read({ state: null, attempts: 1 })).ourBug).toBe(true);
    expect(whatsappSetupStep(null)).toMatchObject({ step: "our_error", ourBug: true });
  });

  it("E7-S15: tells a missing binding from one Phylax did not answer", () => {
    expect(whatsappSetupStep(read({ bound: false, binding: null }))).toMatchObject({ step: "no_channel", ourBug: true });
    const down = whatsappSetupStep(read({ bound: false, binding: "unavailable", bindingError: "fetch_failed" }));
    expect(down).toMatchObject({ step: "channel_unavailable", ourBug: true });
    expect(down.text).toContain("fetch_failed");
    expect(down.text).not.toContain("missing");
    expect(whatsappSetupStep(read({ bound: false, binding: "setting_up" })).step).toBe("channel_setting_up");
    expect(whatsappSetupStep(read({ bound: false, binding: "suspended" })).step).toBe("channel_suspended");
  });
});

describe("GET /api/ops/testers/whatsapp-setup", () => {
  const account = (id: string, email: string, extra: Partial<CustomerAccount> = {}) =>
    ({ account_id: id, stripe_email: email, github_email: null, tenant_id: `t-${id}`, subscription_status: "active",
       claimed_at: "2026-11-13T20:35:31.021Z", ...extra }) as CustomerAccount;
  const accounts = [
    account("user-usr_aaaa9477", "dana@gmail.com"),
    account("user-usr_bbbb1111", "ops@alpha9.io"),
    account("user-usr_cccc2222", "notester@x.io"),
    account("user-usr_dddd3333", "two@x.io"),
    account("user-usr_eeee4444", "two@x.io"),
  ];
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterWhatsAppSetupRoute(app, {
    isOps: (c) => c.req.header("authorization") === "Bearer ok",
    accounts: () => accounts,
    isTester: (a) => a.stripe_email !== "notester@x.io",
    isTest: (a) => a.stripe_email === "ops@alpha9.io",
    setup: async (id) => id.endsWith("4444") ? read({ state: "verified", attempts: 1, lastStatus: 200 }) : read({ attempts: 1, lastStatus: 503, lastAttemptAt: 1 }),
  });

  it("is ops only", async () => {
    expect((await app.request("/api/ops/testers/whatsapp-setup")).status).toBe(404);
  });

  it("lists real testers, masked, with their step; test accounts and non-testers left out", async () => {
    const res = await app.request("/api/ops/testers/whatsapp-setup", { headers: { authorization: "Bearer ok" } });
    const body = await res.json() as { testers: Array<Record<string, unknown>> };
    expect(body.testers.map((t) => t.key)).toEqual(["aaaa9477", "dddd3333", "eeee4444"]);
    expect(body.testers[0]).toMatchObject({ account: "d***@g*** …9477", step: "our_error", ourBug: true });
    expect(JSON.stringify(body)).not.toContain("dana@gmail.com");
    expect(body.testers[1]).toMatchObject({ step: "linked", text: "linked on another account" });
  });

  it("masks an account without an email", () => {
    expect(maskAccount(account("x-1234", "", { stripe_email: null }))).toBe("no email …1234");
  });
});
