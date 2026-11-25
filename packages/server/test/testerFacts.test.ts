// E7-S40 (Jordi vn_febcc8c2, 25 Nov: "We've had problems with these email addresses for a long time ... when they
// registered, we didn't get their names"): the address and name a tester mail uses, each with where it came from.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { CustomerAccountStore, type CustomerAccount } from "../src/customerAccounts.js";
import {
  ADDRESS_FROM_CHECKOUT,
  ADDRESS_FROM_SIGNIN,
  accountEmail,
  applicationNameByCode,
  mailFacts,
  mountTesterFactsRoute,
  NAME_FROM_APPLICATION,
  NAME_FROM_GOOGLE,
  personFacts,
  signinNameFromDisplay,
} from "../src/testerFacts.js";

const account = (extra: Partial<CustomerAccount> = {}) =>
  ({ account_id: "acct-1", user_id: "usr_1", stripe_email: null, github_email: null, tenant_id: "t-1", subscription_status: "active", claimed_at: "2026-11-16T10:00:00Z", ...extra }) as CustomerAccount;

describe("1) the address: sign-in before checkout", () => {
  it("Daniel: signed in with one address, typed a second at checkout; mail goes to the sign-in one", () => {
    const daniel = account({ github_email: "dshort@gmail.com", stripe_email: "hllcnj@gmail.com" });
    expect(accountEmail(daniel)).toBe("dshort@gmail.com");
    expect(personFacts(daniel, null)).toMatchObject({ address: "dshort@gmail.com", address_from: ADDRESS_FROM_SIGNIN });
  });
  it("uses the checkout address only when the account has no sign-in address, and says so", () => {
    expect(personFacts(account({ stripe_email: "pay@x.io" }), "Ana")).toMatchObject({ address: "pay@x.io", address_from: ADDRESS_FROM_CHECKOUT });
  });
  it("no address at all is missing, never guessed", () => {
    const facts = personFacts(account(), "Ana");
    expect(facts.address).toBeNull();
    expect(facts.missing[0]).toMatch(/^address:/);
  });
});

describe("2) the application joined by the redeemed code, not by address", () => {
  const testers = [
    { email: "z@ramblingrose.org", redeemedBy: "acct-nox" },
    { email: "other@x.io", redeemedBy: "acct-other" },
  ];
  const applications = [
    { contact: "z@ramblingrose.org", name: "Nox" },
    { contact: "other@x.io", name: "Olga" },
  ];
  it("Nox applied with one address and signed in with another: the name is still found", () => {
    expect(applicationNameByCode("acct-nox", testers, applications)).toBe("Nox");
    const nox = account({ account_id: "acct-nox", github_email: "a@levelone.io" });
    expect(personFacts(nox, applicationNameByCode("acct-nox", testers, applications))).toMatchObject({
      address: "a@levelone.io", name: "Nox", name_from: NAME_FROM_APPLICATION, missing: [],
    });
  });
  it("an account that redeemed no code gets no application name, even when an application has its address", () => {
    expect(applicationNameByCode("acct-none", [{ email: "a@levelone.io" }], [{ contact: "a@levelone.io", name: "Nox" }])).toBeNull();
  });
});

describe("3) the Google sign-in name, kept on the account with where it came from", () => {
  it("reads a real name, never the address or Zenod's 'Google user' fallback", () => {
    expect(signinNameFromDisplay("Daniel Short", "dshort@gmail.com")).toBe("Daniel Short");
    expect(signinNameFromDisplay("dshort@gmail.com", "dshort@gmail.com")).toBeNull();
    expect(signinNameFromDisplay("Google user", null)).toBeNull();
  });
  it("is kept on every account of the user with its source", () => {
    const store = new CustomerAccountStore(mkdtempSync(join(tmpdir(), "facts-")));
    store.upsert("cs_1", { account_id: "acct-1", user_id: "usr_1" });
    store.upsert("cs_2", { account_id: "acct-2", user_id: "usr_2" });
    expect(store.keepSigninName("usr_1", "Daniel Short", NAME_FROM_GOOGLE)).toBe(1);
    expect(store.keepSigninName("usr_1", "Daniel Short", NAME_FROM_GOOGLE)).toBe(0);
    const kept = store.list().find((a) => a.account_id === "acct-1")!;
    expect(kept).toMatchObject({ signin_name: "Daniel Short", signin_name_from: NAME_FROM_GOOGLE });
    expect(store.list().find((a) => a.account_id === "acct-2")!.signin_name).toBeUndefined();
  });
  it("greets with the Google first name when the application gave none", () => {
    const daniel = account({ github_email: "dshort@gmail.com", signin_name: "daniel short", signin_name_from: NAME_FROM_GOOGLE });
    expect(personFacts(daniel, null)).toMatchObject({ name: "Daniel", name_from: NAME_FROM_GOOGLE, missing: [] });
  });
  it("both agree: sure, both sources named", () => {
    const facts = personFacts(account({ github_email: "a@x.io", signin_name: "Ana Lopez", signin_name_from: NAME_FROM_GOOGLE }), "ana");
    expect(facts).toMatchObject({ name: "Ana", missing: [] });
    expect(facts.name_from).toContain(NAME_FROM_APPLICATION);
    expect(facts.name_from).toContain(NAME_FROM_GOOGLE);
  });
  it("they differ (Vitor typed Mark): unsure, no name, and it says why", () => {
    const facts = personFacts(account({ github_email: "v5523@gmail.com", signin_name: "Vitor Silva", signin_name_from: NAME_FROM_GOOGLE }), "Mark");
    expect(facts.name).toBeNull();
    expect(facts.missing).toEqual([expect.stringMatching(/^name: unsure, "Mark" .* but "Vitor"/)]);
  });
  it("neither: the name is missing", () => {
    expect(personFacts(account({ github_email: "a@x.io" }), null).missing).toEqual(["name: none typed on the application and none from the sign-in"]);
  });
});

describe("the facts a queued mail carries", () => {
  it("a mail that greets by name carries name, name_from and what is missing", () => {
    expect(mailFacts(personFacts(account({ github_email: "a@x.io" }), "Ana"))).toEqual({
      address_from: ADDRESS_FROM_SIGNIN, name: "Ana", name_from: NAME_FROM_APPLICATION,
    });
    expect(mailFacts(personFacts(account({ github_email: "a@x.io" }), null)).missing).toHaveLength(1);
  });
  it("a mail whose approved words greet with 'Hi,' needs only the address", () => {
    expect(mailFacts(personFacts(account({ github_email: "a@x.io" }), null), false)).toEqual({ address_from: ADDRESS_FROM_SIGNIN });
  });
});

describe("GET /api/ops/testers/facts", () => {
  it("lists each real tester masked, with sources, the checkout address only when it differs; ops only", async () => {
    const app = new Hono<{ Bindings: HttpBindings }>();
    const accounts = [
      account({ account_id: "acct-daniel", github_email: "dshort@gmail.com", stripe_email: "hllcnj@gmail.com" }),
      account({ account_id: "acct-ops", github_email: "ops@alpha9.io" }),
    ];
    mountTesterFactsRoute(app, {
      isOps: (c) => c.req.header("authorization") === "Bearer ok",
      accounts: () => accounts,
      isTester: () => true,
      isTest: (a) => a.github_email === "ops@alpha9.io",
      facts: (a) => personFacts(a, null),
      vaultSet: () => false,
    });
    expect((await app.request("/api/ops/testers/facts")).status).toBe(404);
    const body = await (await app.request("/api/ops/testers/facts", { headers: { authorization: "Bearer ok" } })).json() as { testers: Array<Record<string, unknown>> };
    expect(body.testers).toHaveLength(1);
    expect(body.testers[0]).toMatchObject({ key: "niel", address: "ds…@gmail.com", address_from: ADDRESS_FROM_SIGNIN, checkoutAddress: "hl…@gmail.com", storageConnected: false });
    expect(JSON.stringify(body)).not.toContain("dshort@");
  });
});
