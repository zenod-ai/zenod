import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerAccountStore, type CustomerAccount } from "../src/customerAccounts.js";
import {
  CustomerManagedAiLifecycle,
  CustomerManagedAiAuditStore,
  createOpenRouterManagedAiClient,
  loadManagedAiConfig,
  type ManagedAiProviderClient,
} from "../src/customerManagedAi.js";
import { projectCustomerUsage, type GatewayKeyUsage } from "../src/customerMetering.js";
import { Runtime } from "../src/runtime.js";

const dirs: string[] = [];
const runtimes: Runtime[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function account(accounts: CustomerAccountStore): CustomerAccount {
  return accounts.upsert("cs_managed", {
    account_id: "github-42",
    github_id: 42,
    github_login: "octocat",
    tenant_id: "github-42",
    tenant_slug: "octocat-42",
    subscription_status: "active",
  });
}

function providerHarness() {
  const keys: GatewayKeyUsage[] = [];
  const creates: Array<{
    name: string;
    limit: number;
    limitReset: "monthly";
    includeByokInLimit: true;
  }> = [];
  const updates: Array<{
    hash: string;
    input: { limit?: number; limitReset?: "monthly"; disabled?: boolean; includeByokInLimit?: true };
  }> = [];
  const provider: ManagedAiProviderClient = {
    async listKeys() {
      return keys.map((key) => ({ ...key }));
    },
    async createKey(input) {
      creates.push(input);
      const row: GatewayKeyUsage = {
        name: input.name,
        slug: input.name.slice("zenod-tenant:".length),
        hash: "hash-42",
        limit: input.limit,
        usage: 0,
        limit_remaining: input.limit,
        disabled: false,
        limit_reset: input.limitReset,
        include_byok_in_limit: input.includeByokInLimit,
        reset_at: "2026-09-01T00:00:00.000Z",
      };
      keys.push(row);
      return { key: "sk-or-managed-secret", hash: row.hash!, name: row.name, limit: input.limit, limitReset: input.limitReset };
    },
    async updateKey(hash, input) {
      updates.push({ hash, input });
      const key = keys.find((candidate) => candidate.hash === hash);
      if (!key) throw new Error("key missing");
      if (input.limit !== undefined) key.limit = input.limit;
      if (input.limitReset !== undefined) key.limit_reset = input.limitReset;
      if (input.includeByokInLimit !== undefined) key.include_byok_in_limit = input.includeByokInLimit;
      if (input.disabled !== undefined) key.disabled = input.disabled;
    },
  };
  return { provider, keys, creates, updates };
}

describe("managed Hosted AI lifecycle", () => {
  it("requires an explicit enable flag and a provisioning credential", () => {
    expect(loadManagedAiConfig({})).toMatchObject({ enabled: false, monthlyLimitUsd: 2, warnPercent: 80 });
    expect(() => loadManagedAiConfig({ ZENOD_MANAGED_AI_ENABLED: "1" })).toThrow(
      /requires OPENROUTER_PROVISIONING_KEY/,
    );
  });

  it("provisions one capped monthly key across concurrent/retried completion and stores only safe metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-ai-"));
    dirs.push(dir);
    const runtime = new Runtime(dir);
    runtimes.push(runtime);
    const accounts = new CustomerAccountStore(dir);
    const customer = account(accounts);
    const harness = providerHarness();
    const audit = new CustomerManagedAiAuditStore(dir);
    const lifecycle = new CustomerManagedAiLifecycle({
      accounts,
      runtimeForAccount: () => runtime,
      config: { enabled: true, provisioningKey: "provisioning", monthlyLimitUsd: 2, warnPercent: 80 },
      provider: harness.provider,
      audit,
      now: () => new Date("2026-08-25T20:00:00.000Z"),
    });

    const [first, concurrent] = await Promise.all([
      lifecycle.ensureProvisioned(customer),
      lifecycle.ensureProvisioned(customer),
    ]);
    const retry = await lifecycle.ensureProvisioned(customer);
    harness.keys[0]!.include_byok_in_limit = false;
    const reconciled = await lifecycle.ensureProvisioned(customer);

    expect(first).toMatchObject({ state: "provisioned", keyHash: "hash-42", changed: true });
    expect(concurrent).toEqual(first);
    expect(retry).toMatchObject({ state: "already_provisioned", keyHash: "hash-42", changed: false });
    expect(reconciled).toMatchObject({ state: "already_provisioned", keyHash: "hash-42", changed: true });
    expect(harness.creates).toEqual([{
      name: "zenod-tenant:octocat-42",
      limit: 2,
      limitReset: "monthly",
      includeByokInLimit: true,
    }]);
    expect(runtime.settings.get("provider")).toBe("openrouter");
    expect(runtime.settings.get("openrouter_api_key")).toBe("sk-or-managed-secret");
    expect(harness.updates.at(-1)).toEqual({
      hash: "hash-42",
      input: { limit: 2, limitReset: "monthly", includeByokInLimit: true, disabled: false },
    });

    const persistedAccounts = await readFile(join(dir, "customer-accounts.json"), "utf8");
    expect(persistedAccounts).toContain("hash-42");
    expect(persistedAccounts).not.toContain("sk-or-managed-secret");
    const auditLog = await readFile(audit.path, "utf8");
    expect(auditLog).toContain('"state":"provisioning"');
    expect(auditLog).toContain('"state":"active"');
    expect(auditLog).not.toContain("sk-or-managed-secret");
    expect(accounts.get(customer.session_id)).toMatchObject({
      managed_ai_key_hash: "hash-42",
      managed_ai_key_name: "zenod-tenant:octocat-42",
      managed_ai_limit_usd: 2,
      managed_ai_status: "active",
      managed_ai_last_reconciled_at: "2026-08-25T20:00:00.000Z",
    });
  });

  it("suspends and restores the child key idempotently with billing state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-ai-"));
    dirs.push(dir);
    const runtime = new Runtime(dir);
    runtimes.push(runtime);
    const accounts = new CustomerAccountStore(dir);
    const customer = account(accounts);
    const harness = providerHarness();
    const lifecycle = new CustomerManagedAiLifecycle({
      accounts,
      runtimeForAccount: () => runtime,
      config: { enabled: true, provisioningKey: "provisioning", monthlyLimitUsd: 2, warnPercent: 80 },
      provider: harness.provider,
    });
    await lifecycle.ensureProvisioned(customer);

    expect((await lifecycle.setSubscriptionAccess(accounts.get(customer.session_id)!, false)).changed).toBe(true);
    expect((await lifecycle.setSubscriptionAccess(accounts.get(customer.session_id)!, false)).changed).toBe(false);
    expect((await lifecycle.setSubscriptionAccess(accounts.get(customer.session_id)!, true)).changed).toBe(true);
    expect(harness.updates.map((entry) => entry.input)).toEqual([{ disabled: true }, { disabled: false }]);
    expect(accounts.get(customer.session_id)?.managed_ai_status).toBe("active");
  });

  it("does not disrupt an existing account when an unprovisioned subscription is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-ai-"));
    dirs.push(dir);
    const runtime = new Runtime(dir);
    runtimes.push(runtime);
    const accounts = new CustomerAccountStore(dir);
    const customer = account(accounts);
    const lifecycle = new CustomerManagedAiLifecycle({
      accounts,
      runtimeForAccount: () => runtime,
      config: { enabled: true, provisioningKey: "provisioning", monthlyLimitUsd: 2, warnPercent: 80 },
      provider: providerHarness().provider,
    });

    await expect(lifecycle.setSubscriptionAccess(customer, false)).resolves.toMatchObject({
      state: "suspended",
      changed: false,
      keyHash: null,
    });
  });

  it("marks an unrecoverable provider key as orphaned instead of minting a duplicate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-ai-"));
    dirs.push(dir);
    const runtime = new Runtime(dir);
    runtimes.push(runtime);
    const accounts = new CustomerAccountStore(dir);
    const customer = account(accounts);
    const harness = providerHarness();
    harness.keys.push({
      name: "zenod-tenant:octocat-42",
      slug: "octocat-42",
      hash: "existing-hash",
      limit: 2,
      usage: 0,
      limit_remaining: 2,
      disabled: false,
      limit_reset: "monthly",
      include_byok_in_limit: true,
      reset_at: null,
    });
    const lifecycle = new CustomerManagedAiLifecycle({
      accounts,
      runtimeForAccount: () => runtime,
      config: { enabled: true, provisioningKey: "provisioning", monthlyLimitUsd: 2, warnPercent: 80 },
      provider: harness.provider,
    });

    expect(await lifecycle.ensureProvisioned(customer)).toMatchObject({ state: "orphaned", changed: false });
    expect(harness.creates).toHaveLength(0);
    expect(accounts.get(customer.session_id)).toMatchObject({
      managed_ai_status: "orphaned",
      managed_ai_error_code: "managed_ai_secret_unrecoverable",
      managed_ai_key_hash: "existing-hash",
    });
  });
});

describe("customer-safe usage projection", () => {
  it("returns only bounded percentage, state, and provider reset", () => {
    const base: GatewayKeyUsage = {
      name: "zenod-tenant:octocat-42",
      slug: "octocat-42",
      hash: "hash-42",
      limit: 2,
      usage: 1.67,
      limit_remaining: 0.33,
      disabled: false,
      limit_reset: "monthly",
      include_byok_in_limit: true,
      reset_at: "2026-09-01T00:00:00.000Z",
    };
    expect(projectCustomerUsage(base)).toEqual({
      percentageUsed: 84,
      state: "warn",
      resetsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(projectCustomerUsage({ ...base, usage: 10 })).toMatchObject({ percentageUsed: 100, state: "paused" });
    expect(projectCustomerUsage({ ...base, reset_at: null }, 80, Date.parse("2026-08-25T20:00:00.000Z"))).toMatchObject({
      resetsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(projectCustomerUsage(null)).toEqual({ percentageUsed: null, state: "unavailable", resetsAt: null });
  });
});

describe("OpenRouter managed-key contract", () => {
  it("creates and reconciles a capped monthly key with BYOK usage inside the cap", async () => {
    const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ key: "sk-or-once", data: { hash: "hash-once" } }), { status: 200 });
      })
      .mockImplementationOnce(async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      });
    const client = createOpenRouterManagedAiClient("provisioning-test");

    await client.createKey({
      name: "zenod-tenant:octocat-42",
      limit: 2,
      limitReset: "monthly",
      includeByokInLimit: true,
    });
    await client.updateKey("hash-once", {
      limit: 2,
      limitReset: "monthly",
      includeByokInLimit: true,
      disabled: false,
    });

    expect(requests).toEqual([
      {
        url: "https://openrouter.ai/api/v1/keys",
        method: "POST",
        body: {
          name: "zenod-tenant:octocat-42",
          limit: 2,
          limit_reset: "monthly",
          include_byok_in_limit: true,
        },
      },
      {
        url: "https://openrouter.ai/api/v1/keys/hash-once",
        method: "PATCH",
        body: { limit: 2, limit_reset: "monthly", disabled: false, include_byok_in_limit: true },
      },
    ]);
  });
});
