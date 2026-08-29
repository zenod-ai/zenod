import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CustomerAccountStore } from "../src/customerAccounts.js";
import { applyCustomerSubscriptionEvent } from "../src/customerBilling.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("customer account persistence", () => {
  it("writes a complete private JSON file without leaving a pending file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    accounts.upsert("cs_test", { account_id: "github-42", github_id: 42, github_login: "octocat" });

    const stored = JSON.parse(await readFile(join(dir, "customer-accounts.json"), "utf8"));
    expect(stored.cs_test).toMatchObject({ account_id: "github-42", github_id: 42 });
  });

  it("fails closed instead of erasing an unreadable account store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "customer-accounts.json"), "{truncated", "utf8");
    const accounts = new CustomerAccountStore(dir);

    expect(() => accounts.list()).toThrow(/customer account store is unreadable/);
    expect(await readFile(join(dir, "customer-accounts.json"), "utf8")).toBe("{truncated");
  });

  it("reads a legacy GitHub account through the internal user id without changing external identifiers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const path = join(dir, "customer-accounts.json");
    const legacy = {
      cs_legacy: {
        session_id: "cs_legacy",
        account_id: "github-42",
        github_id: 42,
        github_login: "octocat",
        claimed_at: "2026-08-01T00:00:00.000Z",
        subscription_status: "active",
      },
    };
    await writeFile(path, JSON.stringify(legacy), "utf8");
    const accounts = new CustomerAccountStore(dir);

    expect(accounts.resolveForUser(42)).toMatchObject({
      session_id: "cs_legacy",
      account_id: "github-42",
      github_id: 42,
      github_login: "octocat",
    });
    expect(await readFile(path, "utf8")).toBe(JSON.stringify(legacy));
  });

  it("does not hide a completed subscription behind a later abandoned checkout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    accounts.upsert("cs_active", {
      account_id: "github-42",
      github_id: 42,
      github_login: "octocat",
      claimed_at: "2026-08-01T00:00:00.000Z",
      subscription_status: "active",
    });
    accounts.upsert("cs_abandoned", {
      account_id: "github-42",
      github_id: 42,
      github_login: "octocat",
      claimed_at: "2026-08-02T00:00:00.000Z",
      subscription_status: "checkout_pending",
    });

    expect(accounts.resolveForUser(42)?.session_id).toBe("cs_active");
  });

  it("refuses to rewrite an existing account's internal or legacy owner identifiers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    const original = accounts.upsert("cs_owner", {
      account_id: "github-42",
      github_id: 42,
      github_login: "octocat",
    });

    expect(() => accounts.upsert("cs_owner", { user_id: "usr_replacement" })).toThrow(/user_id cannot change/);
    expect(() => accounts.upsert("cs_owner", { account_id: "github-7" })).toThrow(/account_id cannot change/);
    expect(() => accounts.upsert("cs_owner", { github_id: 7 })).toThrow(/github_id cannot change/);
    expect(accounts.get("cs_owner")).toEqual(original);
  });

  it("binds an out-of-order subscription event through checkout metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    accounts.upsert("cs_pending", {
      account_id: "github-42",
      github_id: 42,
      github_login: "octocat",
      subscription_status: "checkout_pending",
    });

    const updated = applyCustomerSubscriptionEvent(accounts, {
      id: "sub_live",
      customer: "cus_live",
      metadata: { account_id: "github-42" },
      status: "past_due",
      cancel_at_period_end: false,
      current_period_start: 1_768_003_200,
      current_period_end: 1_800_000_000,
    } as Stripe.Subscription);

    expect(updated).toMatchObject({
      session_id: "cs_pending",
      stripe_subscription_id: "sub_live",
      stripe_customer_id: "cus_live",
      subscription_status: "past_due",
      current_period_start: new Date(1_768_003_200 * 1000).toISOString(),
      current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });
});
