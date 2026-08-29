import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CustomerAccountStore, customerVaultBinding } from "../src/customerAccounts.js";
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

  it("projects one immutable tenant vault authority and refuses provider or binding switches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    const now = "2026-08-29T20:00:00.000Z";
    const account = accounts.upsert("cs_drive", {
      account_id: "account-drive",
      user_id: "usr_google",
      tenant_id: "tenant-drive",
      vault_provider: "google_drive",
      vault_binding_id: "binding-drive",
      vault_binding_status: "ready",
      vault_drive_folder_id: "folder-drive",
      vault_drive_manifest_file_id: "manifest-drive",
      vault_binding_created_at: now,
      vault_binding_updated_at: now,
    });

    expect(customerVaultBinding(account)).toEqual(expect.objectContaining({
      tenant_id: "tenant-drive",
      provider: "google_drive",
      binding_id: "binding-drive",
      status: "ready",
      folder_id: "folder-drive",
      manifest_file_id: "manifest-drive",
    }));
    expect(() => accounts.upsert("cs_drive", { vault_provider: "github" })).toThrow(/vault_provider cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_provider: null })).toThrow(/vault_provider cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_binding_id: "replacement" })).toThrow(/vault_binding_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_binding_id: null })).toThrow(/vault_binding_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_drive_folder_id: "replacement-folder" })).toThrow(/vault_drive_folder_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_drive_folder_id: null })).toThrow(/vault_drive_folder_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_drive_manifest_file_id: "replacement-manifest" })).toThrow(/vault_drive_manifest_file_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { vault_drive_manifest_file_id: null })).toThrow(/vault_drive_manifest_file_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { tenant_id: "replacement-tenant" })).toThrow(/tenant_id cannot change/);
    expect(() => accounts.upsert("cs_drive", { tenant_id: null })).toThrow(/tenant_id cannot change/);
    expect(() => customerVaultBinding({ ...account, vault_provider: null })).toThrow(/binding is incomplete/);
    expect(accounts.get("cs_drive")).toEqual(account);
  });

  it("resolves a tenant binding across harmless duplicate session rows and fails closed on conflicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    const now = "2026-08-29T20:00:00.000Z";
    accounts.upsert("cs_bound", {
      account_id: "account-drive", user_id: "usr_google", tenant_id: "tenant-drive",
      subscription_status: "canceled", claimed_at: now,
      vault_provider: "google_drive", vault_binding_id: "binding-drive", vault_binding_status: "ready",
      vault_drive_folder_id: "folder-drive", vault_drive_manifest_file_id: "manifest-drive",
      vault_binding_created_at: now, vault_binding_updated_at: now, vault_authorization_epoch: 1,
    });
    accounts.upsert("cs_retry", {
      account_id: "account-drive", user_id: "usr_google", tenant_id: "tenant-drive",
      subscription_status: "active", claimed_at: "2099-08-29T20:00:00.000Z",
    });

    expect(accounts.get("cs_retry")).toMatchObject({ vault_provider: null });
    expect(accounts.resolveForTenantId("tenant-drive")?.session_id).toBe("cs_retry");
    expect(accounts.resolveActiveTenantForUser("usr_google")?.session_id).toBe("cs_retry");
    expect(accounts.resolveVaultAuthorityForTenantId("tenant-drive")?.account.session_id).toBe("cs_bound");
    expect(accounts.resolveVaultAuthorityForTenantId("tenant-drive")?.binding).toMatchObject({
      provider: "google_drive", binding_id: "binding-drive", authorization_epoch: 1,
    });

    accounts.upsert("cs_conflict", {
      account_id: "account-drive", user_id: "usr_google", tenant_id: "tenant-drive",
      subscription_status: "active", claimed_at: "2100-08-29T20:00:00.000Z",
      vault_provider: "google_drive", vault_binding_id: "other-binding", vault_binding_status: "ready",
      vault_drive_folder_id: "other-folder", vault_drive_manifest_file_id: "other-manifest",
      vault_binding_created_at: now, vault_binding_updated_at: now, vault_authorization_epoch: 1,
    });
    expect(() => accounts.resolveVaultAuthorityForTenantId("tenant-drive")).toThrow(/inconsistent authoritative/);
    expect(accounts.resolveActiveTenantForUser("usr_google")?.session_id).toBe("cs_conflict");
  });

  it("rejects identical binding projections owned by different tenant accounts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accounts-"));
    tempDirs.push(dir);
    const accounts = new CustomerAccountStore(dir);
    const now = "2026-08-29T20:00:00.000Z";
    const binding = {
      tenant_id: "tenant-drive", subscription_status: "active" as const,
      vault_provider: "google_drive" as const, vault_binding_id: "binding-drive",
      vault_binding_status: "ready" as const, vault_drive_folder_id: "folder-drive",
      vault_drive_manifest_file_id: "manifest-drive", vault_binding_created_at: now,
      vault_binding_updated_at: now, vault_authorization_epoch: 1,
    };
    accounts.upsert("owner-a", { ...binding, account_id: "account-a", user_id: "user-a" });
    accounts.upsert("owner-b", { ...binding, account_id: "account-b", user_id: "user-b" });

    expect(() => accounts.resolveVaultAuthorityForTenantId("tenant-drive")).toThrow(/inconsistent account ownership/);
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
