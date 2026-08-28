import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { serve, type ServerType } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";
import {
  loadZenodPhylaxConfig,
  ZenodPhylaxAdapter,
  type ZenodPhylaxAllowance,
  type ZenodPhylaxConfig,
  type ZenodPhylaxRemote,
} from "../src/zenodPhylax.js";

const dirs: string[] = [];
const servers: ServerType[] = [];
const units: Array<{ close(): void | Promise<void> }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(units.splice(0).map((unit) => Promise.resolve(unit.close())));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function account(id: string, patch: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    session_id: `session-${id}`,
    account_id: `account-${id}`,
    product: "zenod",
    tier: "monthly",
    stripe_email: null,
    stripe_client_reference_id: null,
    stripe_customer_id: `cus-${id}`,
    stripe_subscription_id: `sub-${id}`,
    subscription_status: "active",
    cancel_at_period_end: false,
    current_period_start: "2026-08-01T00:00:00.000Z",
    current_period_end: "2099-09-27T00:00:00.000Z",
    github_id: id === "alpha" ? 1 : 2,
    github_login: id,
    github_email: null,
    claimed_at: "2026-08-27T00:00:00.000Z",
    tenant_id: `tenant-${id}`,
    tenant_slug: id,
    mcp_url: null,
    mcp_token: null,
    vault_repo: null,
    vault_repo_url: null,
    checkout_completed_at: "2026-08-27T00:00:00.000Z",
    managed_ai_key_hash: null,
    managed_ai_key_name: null,
    managed_ai_limit_usd: 2,
    managed_ai_limit_override_usd: null,
    managed_ai_status: "active",
    managed_ai_updated_at: null,
    managed_ai_last_reconciled_at: null,
    managed_ai_error_code: null,
    ...patch,
  };
}

function config(patch: Partial<ZenodPhylaxConfig> = {}): ZenodPhylaxConfig {
  return {
    enabled: true,
    origin: "https://phylax.internal",
    controlToken: "control-secret",
    vaultSecret: "99".repeat(32),
    masterAllowanceUnits: 3_000_000,
    phylaxAllowanceUnits: 1_500_000,
    phylaxWalletTargetUnits: 1_000_000,
    phylaxWalletLowWaterUnits: 100_000,
    unitsPerUsd: 1_000_000,
    tariffVersion: "tariff-v1",
    downstreamUrl: "https://cloud.zenod.dev/mcp",
    warnPercent: 80,
    reconcileIntervalMs: 3_600_000,
    ...patch,
  };
}

class FakeRemote implements ZenodPhylaxRemote {
  readonly tokens = new Map<string, string>();
  readonly calls: Array<{ token: string; tool: string; args: Record<string, unknown> }> = [];
  readonly allowance = new Map<string, ZenodPhylaxAllowance>();
  readonly fundingNeeds = new Map<string, { pausedWorkCount: number; requiredUnits: number }>();
  readonly revisions = new Map<string, number>();
  readonly adjustmentResults = new Map<string, { revision: string; allowance: ZenodPhylaxAllowance }>();
  readonly bindings = new Map<string, {
    externalTenantId: string;
    downstreamUrl: string;
    downstreamToken: string;
    revision: number;
  }>();
  readonly activeCalls = new Map<string, number>();
  readonly maxActiveCalls = new Map<string, number>();
  maxConcurrentCalls = 0;
  activeCallCount = 0;
  callDelayMs = 0;
  preexistingBinding: {
    externalTenantId: string;
    downstreamUrl: string;
    downstreamToken: string;
    revision: number;
  } | null = null;
  unavailable = false;
  loseEnsureResponseOnce = false;
  loseAdjustResponseOnce = false;
  beforeAdjustOnce: ((tenantId: string) => void) | null = null;
  channelRevision = "wa:0";

  async ensureTenant(input: { tenantId: string; token: string }): Promise<void> {
    if (this.unavailable) throw new Error("offline");
    const existing = this.tokens.get(input.tenantId);
    if (existing && existing !== input.token) throw new Error("credential conflict");
    this.tokens.set(input.tenantId, input.token);
    if (this.preexistingBinding && !this.bindings.has(input.tenantId)) {
      this.bindings.set(input.tenantId, this.preexistingBinding);
    }
    if (this.loseEnsureResponseOnce) {
      this.loseEnsureResponseOnce = false;
      throw new Error("response lost");
    }
  }

  async call(token: string, tool: string, args: Record<string, unknown>) {
    if (this.unavailable) throw new Error("offline");
    const tenantId = [...this.tokens].find(([, candidate]) => candidate === token)?.[0];
    if (!tenantId) throw new Error("unknown token");
    this.activeCallCount += 1;
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.activeCallCount);
    const tenantActive = (this.activeCalls.get(tenantId) ?? 0) + 1;
    this.activeCalls.set(tenantId, tenantActive);
    this.maxActiveCalls.set(tenantId, Math.max(this.maxActiveCalls.get(tenantId) ?? 0, tenantActive));
    try {
      if (this.callDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.callDelayMs));
      }
      return this.callNow(token, tenantId, tool, args);
    } finally {
      this.activeCallCount -= 1;
      this.activeCalls.set(tenantId, (this.activeCalls.get(tenantId) ?? 1) - 1);
    }
  }

  private async callNow(
    token: string,
    tenantId: string,
    tool: string,
    args: Record<string, unknown>,
  ) {
    this.calls.push({ token, tool, args });
    const revision = this.revisions.get(tenantId) ?? 0;
    if (tool === "phylax_management_v1_ensure_binding") {
      const existing = this.bindings.get(tenantId);
      const expected = String(existing?.revision ?? 0);
      if (args.expectedRevision !== expected) {
        return { isError: true, structuredContent: {
          error: { code: "stale_revision", message: "binding revision is stale" },
        } };
      }
      if (
        existing &&
        existing.externalTenantId === args.externalTenantId &&
        existing.downstreamUrl === args.downstreamUrl &&
        existing.downstreamToken === args.downstreamToken
      ) {
        return { structuredContent: { binding: {
          externalTenantId: existing.externalTenantId,
          revision: String(existing.revision),
          downstreamConfigured: true,
        } } };
      }
      const next = (existing?.revision ?? 0) + 1;
      this.bindings.set(tenantId, {
        externalTenantId: String(args.externalTenantId),
        downstreamUrl: String(args.downstreamUrl),
        downstreamToken: String(args.downstreamToken),
        revision: next,
      });
      return { structuredContent: {
        binding: {
          externalTenantId: args.externalTenantId,
          revision: String(next),
          downstreamConfigured: true,
        },
      } };
    }
    if (tool === "phylax_management_v1_credit_query") {
      return { structuredContent: {
        revision: String(revision),
        allowance: this.allowance.get(tenantId) ?? {
          tenantId,
          periodId: null,
          state: "unavailable",
          allocatedUnits: 0,
          usedUnits: 0,
          reservedUnits: 0,
          remainingUnits: 0,
          usageBasisPoints: 0,
          resetsAt: null,
        },
        fundingNeed: this.fundingNeeds.get(tenantId) ?? {
          pausedWorkCount: 0,
          requiredUnits: 0,
        },
      } };
    }
    if (tool === "phylax_management_v1_credit_grant") {
      if (args.expectedRevision !== String(revision)) {
        return { isError: true, structuredContent: {
          error: { code: "stale_revision", message: "allowance revision is stale" },
        } };
      }
      const next = revision + 1;
      this.revisions.set(tenantId, next);
      const projection: ZenodPhylaxAllowance = {
        tenantId,
        periodId: String(args.periodId),
        state: "active",
        allocatedUnits: Number(args.amountUnits),
        usedUnits: 0,
        reservedUnits: 0,
        remainingUnits: Number(args.amountUnits),
        usageBasisPoints: 0,
        resetsAt: Number(args.endsAt),
      };
      this.allowance.set(tenantId, projection);
      return { structuredContent: { revision: String(next), allowance: projection } };
    }
    if (tool === "phylax_management_v1_credit_adjust") {
      if (this.beforeAdjustOnce) {
        const beforeAdjust = this.beforeAdjustOnce;
        this.beforeAdjustOnce = null;
        beforeAdjust(tenantId);
      }
      const adjustmentRevision = this.revisions.get(tenantId) ?? 0;
      const key = `${tenantId}:${String(args.operationId)}`;
      const replay = this.adjustmentResults.get(key);
      if (replay) return { structuredContent: { ...replay, replayed: true } };
      if (args.expectedRevision !== String(adjustmentRevision)) {
        return { isError: true, structuredContent: {
          error: { code: "stale_revision", message: "allowance revision is stale" },
        } };
      }
      const next = adjustmentRevision + 1;
      this.revisions.set(tenantId, next);
      const current = this.allowance.get(tenantId)!;
      const amountUnits = Number(args.amountUnits);
      const projection: ZenodPhylaxAllowance = {
        ...current,
        allocatedUnits: current.allocatedUnits + amountUnits,
        remainingUnits: current.remainingUnits + amountUnits,
      };
      this.allowance.set(tenantId, projection);
      const result = { revision: String(next), allowance: projection };
      this.adjustmentResults.set(key, result);
      if (this.loseAdjustResponseOnce) {
        this.loseAdjustResponseOnce = false;
        throw new Error("adjust response lost");
      }
      return { structuredContent: result };
    }
    if (tool === "phylax_management_v1_suspend" || tool === "phylax_management_v1_resume") {
      if (args.expectedRevision !== String(revision)) {
        return { isError: true, structuredContent: {
          error: { code: "stale_revision", message: "allowance revision is stale" },
        } };
      }
      const next = revision + 1;
      this.revisions.set(tenantId, next);
      const current = this.allowance.get(tenantId)!;
      const projection = {
        ...current,
        state: tool.endsWith("suspend") ? "suspended" as const : "active" as const,
      };
      this.allowance.set(tenantId, projection);
      return { structuredContent: { revision: String(next), allowance: projection } };
    }
    if (tool === "phylax_management_v1_channel_status") {
      const binding = this.bindings.get(tenantId);
      if (!binding) {
        return { isError: true, structuredContent: {
          error: { code: "binding_required", message: "binding is required" },
        } };
      }
      return { structuredContent: {
        binding: {
          externalTenantId: binding.externalTenantId,
          downstreamUrl: binding.downstreamUrl,
          downstreamConfigured: true,
          revision: String(binding.revision),
        },
        channels: {
          whatsapp: {
            state: "off",
            senderHint: null,
            sharedNumber: "+34 699 000 111",
            verificationExpiresAt: null,
            lastInboundAt: null,
            lastReceiptAt: null,
            revision: this.channelRevision,
          },
          telegram: {
            state: "off",
            identityHint: null,
            verificationExpiresAt: null,
            revision: "tg:0",
          },
        },
      } };
    }
    if (tool === "phylax_management_v1_channel_connect") {
      return { structuredContent: {
        channels: {
          whatsapp: {
            state: "awaiting_code",
            senderHint: "••••1111",
            sharedNumber: "+34 699 000 111",
            verificationExpiresAt: Date.now() + 60_000,
            lastInboundAt: null,
            lastReceiptAt: null,
            revision: "wa:1",
          },
          telegram: {
            state: "off",
            identityHint: null,
            verificationExpiresAt: null,
            revision: "tg:0",
          },
        },
        challenge: { code: "42-zenod", sharedNumber: "+34 699 000 111", expiresAt: Date.now() + 60_000 },
        mutation: { operationId: args.operationId, operation: "whatsapp.challenge", outcome: "succeeded", at: Date.now() },
      } };
    }
    throw new Error(`unexpected ${tool}`);
  }
}

describe("Zenod Phylax product adapter", () => {
  it("requires an exact private origin and explicit integer tariff configuration", () => {
    const base = {
      CHASSIS_VAULT_MASTER_KEY: "99".repeat(32),
      ZENOD_PHYLAX_MANAGEMENT_URL: "https://phylax.internal",
      ZENOD_PHYLAX_CONTROL_TOKEN: "control-secret",
      ZENOD_MASTER_ALLOWANCE_UNITS: "3000000",
      ZENOD_PHYLAX_ALLOWANCE_UNITS: "1000000",
      ZENOD_ALLOWANCE_UNITS_PER_USD: "1000000",
      ZENOD_PHYLAX_TARIFF_VERSION: "tariff-v1",
    };
    expect(loadZenodPhylaxConfig(base).enabled).toBe(false);
    expect(loadZenodPhylaxConfig({
      ...base,
      ZENOD_PHYLAX_ALLOWED_ORIGINS: "https://phylax.internal",
    })).toMatchObject({
      enabled: true,
      masterAllowanceUnits: 3_000_000,
      phylaxAllowanceUnits: 1_000_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
      unitsPerUsd: 1_000_000,
      tariffVersion: "tariff-v1",
    });
    expect(loadZenodPhylaxConfig({
      ...base,
      ZENOD_PHYLAX_ALLOWED_ORIGINS: "https://phylax.internal",
      ZENOD_PHYLAX_WALLET_TARGET_UNITS: "1100000",
    }).enabled).toBe(false);
    expect(loadZenodPhylaxConfig({
      ...base,
      ZENOD_PHYLAX_ALLOWED_ORIGINS: "https://phylax.internal",
      ZENOD_PHYLAX_WALLET_TARGET_UNITS: "invalid",
    }).enabled).toBe(false);
    expect(loadZenodPhylaxConfig({
      ...base,
      ZENOD_PHYLAX_ALLOWED_ORIGINS: "https://phylax.internal",
      ZENOD_PHYLAX_MANAGEMENT_URL: "https://phylax.internal/path",
    }).enabled).toBe(false);
  });

  it("persists one deterministic mapping and caller-custodied token across lost responses and restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-stable-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    remote.loseEnsureResponseOnce = true;
    const first = new ZenodPhylaxAdapter(dataDir, config(), remote);
    first.setDownstreamTokenResolver(() => "zenod-memory-token");
    await expect(first.setEntitlement(account("alpha"), true)).rejects.toThrow("response lost");
    const pending = first.viewForAccount("account-alpha")!;
    expect(pending).toMatchObject({
      zenodTenantId: "tenant-alpha",
      phylaxTenantId: "tenant-alpha",
      state: "unavailable",
      lastErrorCode: "phylax_unavailable",
    });
    const token = remote.tokens.get(pending.phylaxTenantId);
    expect(token).toBeTruthy();
    expect((await readFile(join(dataDir, "zenod-phylax-adapter.sqlite"))).includes(Buffer.from(token!)))
      .toBe(false);
    first.close();

    const restarted = new ZenodPhylaxAdapter(dataDir, config(), remote);
    restarted.setDownstreamTokenResolver(() => "zenod-memory-token");
    await restarted.reconcileAccount("account-alpha");
    expect(remote.tokens.get(pending.phylaxTenantId)).toBe(token);
    expect(restarted.viewForAccount("account-alpha")).toMatchObject({
      phylaxTenantId: pending.phylaxTenantId,
      state: "active",
      allocationUnits: 1_000_000,
    });
    expect(JSON.stringify(restarted.viewForAccount("account-alpha"))).not.toContain(token);
    restarted.close();
  });

  it("moves the former synthetic allowance mapping onto the existing channel tenant without rotating channel credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-tenant-identity-repair-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha");
    const first = new ZenodPhylaxAdapter(dataDir, config(), remote);
    first.setDownstreamTokenResolver(() => "existing-memory-channel-token");
    await first.setEntitlement(customer, true);
    const original = first.viewForAccount(customer.account_id)!;
    expect(original.phylaxTenantId).toBe(customer.tenant_id);
    const managementToken = remote.tokens.get(customer.tenant_id!)!;
    first.close();

    const legacyTenantId = `zenod-${createHash("sha256")
      .update(customer.tenant_id!, "utf8")
      .digest("hex")
      .slice(0, 32)}`;
    const db = new DatabaseSync(join(dataDir, "zenod-phylax-adapter.sqlite"));
    db.prepare(
      "UPDATE zenod_phylax_bindings SET phylax_tenant_id=? WHERE account_id=?",
    ).run(legacyTenantId, customer.account_id);
    db.close();
    remote.tokens.delete(customer.tenant_id!);
    remote.tokens.set(legacyTenantId, managementToken);

    const repaired = new ZenodPhylaxAdapter(dataDir, config(), remote);
    repaired.setDownstreamTokenResolver(() => "existing-memory-channel-token");
    await repaired.setEntitlement(customer, true);
    expect(repaired.viewForAccount(customer.account_id)).toMatchObject({
      zenodTenantId: customer.tenant_id,
      phylaxTenantId: customer.tenant_id,
      state: "active",
      allocationUnits: 1_000_000,
    });
    expect(remote.tokens.get(customer.tenant_id!)).toBeTruthy();
    expect(remote.tokens.get(customer.tenant_id!)).not.toBe(managementToken);
    expect(remote.tokens.get(legacyTenantId)).toBe(managementToken);
    repaired.close();
  });

  it("cold-provisions through the dedicated Phylax artifact and replays the same profile token after a lost response", async () => {
    const root = await mkdtemp(join(tmpdir(), "zpf6-artifact-"));
    dirs.push(root);
    const phylax = createPhylaxUnit({
      dataDir: join(root, "phylax"),
      env: {
        CHASSIS_VAULT_MASTER_KEY: "76".repeat(32),
        CONTROL_PLANE_TOKEN: "control-secret",
        PHYLAX_PREWARM_LOCAL_MODEL: "0",
        PHYLAX_INSTANCE_MODE: "zenod",
        PHYLAX_INSTANCE_ID: "zpf6-artifact",
        PHYLAX_SERVICE_NUMBER_ID: "zpf6-artifact-number",
      },
    });
    units.push(phylax);
    const server = await new Promise<ServerType>((resolve) => {
      const active = serve({ fetch: phylax.app.fetch, port: 0 }, () => resolve(active));
    });
    servers.push(server);
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const realFetch = globalThis.fetch;
    const ensureReplays: boolean[] = [];
    let loseEnsureResponse = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === origin && url.pathname.endsWith("/tokens/ensure")) {
        const body = await response.clone().json() as { replayed?: boolean };
        ensureReplays.push(body.replayed === true);
        if (loseEnsureResponse) {
          loseEnsureResponse = false;
          throw new Error("simulated lost profile-token ensure response");
        }
      }
      return response;
    });

    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapterConfig = config({
      origin,
      masterAllowanceUnits: 3_500_000,
      phylaxAllowanceUnits: 2_000_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    });
    const first = new ZenodPhylaxAdapter(join(root, "zenod"), adapterConfig);
    first.setDownstreamTokenResolver(() => "zenod-memory-token");
    await expect(first.setEntitlement(customer, true))
      .rejects.toThrow("simulated lost profile-token ensure response");
    const mapped = first.viewForAccount("account-alpha")!;
    first.close();

    const restarted = new ZenodPhylaxAdapter(join(root, "zenod"), adapterConfig);
    restarted.setDownstreamTokenResolver(() => "zenod-memory-token");
    await restarted.reconcileAccount("account-alpha");
    expect(ensureReplays).toEqual([false, true]);
    expect(restarted.viewForAccount("account-alpha")).toMatchObject({
      phylaxTenantId: mapped.phylaxTenantId,
      desiredAccess: "active",
      state: "active",
      allocationUnits: 500_000,
      lastErrorCode: null,
    });
    const periodId = restarted.viewForAccount("account-alpha")!.periodId!;
    const paidWork = phylax.phylaxAllowanceLedger.admitPaidWork({
      tenantId: mapped.phylaxTenantId,
      periodId,
      idempotencyKey: "artifact-oversized-work-1",
      providerEventId: "artifact-provider-work-1",
      operation: "transcription",
      custodyRef: "custody://artifact-oversized-work-1",
      estimatedUnits: 1_200_000,
    });
    expect(paidWork.work).toMatchObject({
      state: "paused",
      pauseReason: "insufficient_allowance",
    });
    await restarted.reconcileAccount("account-alpha");
    expect(phylax.phylaxAllowanceLedger.pendingWork(mapped.phylaxTenantId)).toEqual([
      expect.objectContaining({
        state: "ready",
        pauseReason: null,
        reservedUnits: 1_200_000,
      }),
    ]);
    expect(restarted.viewForAccount("account-alpha")?.allocationUnits).toBe(1_700_000);
    restarted.close();
  });

  it("uses Stripe's authoritative monthly, yearly, and month-end period boundaries", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-periods-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver((id) => `memory-${id}`);
    const periods = [
      account("monthly", {
        current_period_start: "2026-08-27T00:00:00.000Z",
        current_period_end: "2026-09-27T00:00:00.000Z",
      }),
      account("yearly", {
        tier: "yearly",
        current_period_start: "2026-08-27T00:00:00.000Z",
        current_period_end: "2027-08-27T00:00:00.000Z",
      }),
      account("month-end", {
        current_period_start: "2026-01-31T00:00:00.000Z",
        current_period_end: "2026-02-28T00:00:00.000Z",
      }),
    ];
    for (const customer of periods) await adapter.setEntitlement(customer, true);
    const grants = remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_grant");
    expect(grants.map((call) => ({
      startsAt: call.args.startsAt,
      endsAt: call.args.endsAt,
    }))).toEqual(periods.map((customer) => ({
      startsAt: Date.parse(customer.current_period_start!),
      endsAt: Date.parse(customer.current_period_end!),
    })));
    adapter.close();
  });

  it("keeps an old account in truthful setting_up until an authoritative period start arrives", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-old-period-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(account("alpha", { current_period_start: null }), true);
    expect(adapter.viewForAccount("account-alpha")).toMatchObject({
      desiredAccess: "active",
      state: "setting_up",
      periodId: null,
      lastErrorCode: "billing_period_unavailable",
    });
    expect(remote.calls.some((call) => call.tool === "phylax_management_v1_credit_grant")).toBe(false);
    expect(remote.calls).toHaveLength(0);
    expect(remote.tokens).toHaveLength(0);
    adapter.close();
  });

  it("durably bootstraps every existing tenant before reconciliation and recovers one lost response after restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-bootstrap-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    remote.loseEnsureResponseOnce = true;
    const alpha = account("alpha");
    const beta = account("beta");
    const first = new ZenodPhylaxAdapter(dataDir, config(), remote);
    first.setDownstreamTokenResolver((id) => `memory-${id}`);
    await first.bootstrapAccounts([alpha, beta]);
    expect(first.viewForAccount(alpha.account_id)).not.toBeNull();
    expect(first.viewForAccount(beta.account_id)).not.toBeNull();
    expect([
      first.viewForAccount(alpha.account_id)?.state,
      first.viewForAccount(beta.account_id)?.state,
    ].sort()).toEqual(["active", "unavailable"]);
    const mapped = [
      first.viewForAccount(alpha.account_id)?.phylaxTenantId,
      first.viewForAccount(beta.account_id)?.phylaxTenantId,
    ];
    expect(mapped[0]).not.toBe(mapped[1]);
    first.close();

    const restarted = new ZenodPhylaxAdapter(dataDir, config(), remote);
    restarted.setDownstreamTokenResolver((id) => `memory-${id}`);
    await restarted.reconcileAll();
    expect(restarted.viewForAccount(alpha.account_id)?.state).toBe("active");
    expect(restarted.viewForAccount(beta.account_id)?.state).toBe("active");
    expect([
      restarted.viewForAccount(alpha.account_id)?.phylaxTenantId,
      restarted.viewForAccount(beta.account_id)?.phylaxTenantId,
    ]).toEqual(mapped);
    restarted.close();
  });

  it("isolates a bootstrap record failure and continues seeding later tenants", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-bootstrap-isolation-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver((id) => `memory-${id}`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await adapter.bootstrapAccounts([
      account("over-cap", { managed_ai_limit_usd: 3 }),
      account("alpha"),
    ]);
    expect(adapter.viewForAccount("account-over-cap")).toMatchObject({
      state: "unavailable",
      lastErrorCode: "allowance_capacity",
    });
    expect(adapter.viewForAccount("account-alpha")?.state).toBe("active");
    expect(log).toHaveBeenCalledOnce();
    adapter.close();
  });

  it("reconciles the current remote binding revision instead of assuming a new binding", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-binding-revision-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    remote.preexistingBinding = {
      externalTenantId: "tenant-alpha",
      downstreamUrl: "https://cloud.zenod.dev/mcp",
      downstreamToken: "zenod-memory-token",
      revision: 7,
    };
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(account("alpha"), true);
    const ensure = remote.calls.find((call) => call.tool === "phylax_management_v1_ensure_binding");
    expect(ensure?.args.expectedRevision).toBe("7");
    expect(remote.bindings.values().next().value?.revision).toBe(7);
    expect(adapter.viewForAccount("account-alpha")?.state).toBe("active");
    adapter.close();
  });

  it("keeps past-due grace active and handles cancel/reactivate idempotently without deleting custody", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-lifecycle-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(account("alpha", { subscription_status: "past_due" }), true);
    expect(adapter.viewForAccount("account-alpha")?.state).toBe("active");
    await adapter.setEntitlement(account("alpha", { subscription_status: "canceled" }), false);
    expect(adapter.viewForAccount("account-alpha")).toMatchObject({
      desiredAccess: "suspended",
      state: "suspended",
    });
    await adapter.setEntitlement(account("alpha"), true);
    expect(adapter.viewForAccount("account-alpha")?.state).toBe("active");
    await adapter.setEntitlement(account("alpha"), true);
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_grant")).toHaveLength(1);
    expect(remote.tokens).toHaveLength(1);
    adapter.close();
  });

  it("fails closed when allocation plus local capacity exceeds the master cap", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-cap-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config({ masterAllowanceUnits: 2_500_000 }), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await expect(adapter.setEntitlement(account("alpha"), true)).rejects.toThrow("master allowance capacity");
    expect(adapter.viewForAccount("account-alpha")).toMatchObject({
      state: "unavailable",
      lastErrorCode: "allowance_capacity",
    });
    expect(remote.calls).toHaveLength(0);
    adapter.close();
  });

  it("keeps top-ups bounded and durably replays the same operation after a lost response", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-topup-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const first = new ZenodPhylaxAdapter(dataDir, config(), remote);
    first.setDownstreamTokenResolver(() => "zenod-memory-token");
    await first.setEntitlement(customer, true);
    remote.loseAdjustResponseOnce = true;
    await expect(first.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-0001",
      amountUnits: 100_000,
      auditReason: "customer allowance top-up",
    })).rejects.toThrow("adjust response lost");
    expect(first.viewForAccount(customer.account_id)?.state).toBe("unavailable");
    first.close();

    const restarted = new ZenodPhylaxAdapter(dataDir, config(), remote);
    restarted.setDownstreamTokenResolver(() => "zenod-memory-token");
    await restarted.reconcileAccount(customer.account_id);
    expect(restarted.viewForAccount(customer.account_id)).toMatchObject({
      state: "active",
      allocationUnits: 1_100_000,
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(2);
    remote.unavailable = true;
    await expect(restarted.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-0002",
      amountUnits: 50_000,
      auditReason: "durable outage top-up",
    })).rejects.toThrow("offline");
    remote.unavailable = false;
    await restarted.reconcileAccount(customer.account_id);
    expect(restarted.viewForAccount(customer.account_id)).toMatchObject({
      state: "active",
      allocationUnits: 1_150_000,
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(3);
    await expect(restarted.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-0003",
      amountUnits: 500_000,
      auditReason: "over-cap top-up",
    })).rejects.toThrow("master allowance capacity");
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(3);
    restarted.close();
  });

  it("grants a small initial wallet and refills it once at the low-water mark", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-low-water-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const faucetConfig = config({
      phylaxAllowanceUnits: 1_000_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    });
    const adapter = new ZenodPhylaxAdapter(dataDir, faucetConfig, remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 500_000,
      remainingUnits: 500_000,
    });

    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 400_000,
      remainingUnits: 100_000,
      usageBasisPoints: 8_000,
    });
    await Promise.all([
      adapter.reconcileAccount(customer.account_id),
      adapter.reconcileAccount(customer.account_id),
    ]);
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 900_000,
      usedUnits: 400_000,
      remainingUnits: 500_000,
    });
    const adjustments = remote.calls.filter(
      (call) => call.tool === "phylax_management_v1_credit_adjust",
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.args).toMatchObject({ amountUnits: 400_000 });
    adapter.close();
  });

  it("covers one oversized admitted job exactly and wakes it through the existing grant path", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-oversized-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config({
      phylaxAllowanceUnits: 1_500_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    }), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 100_000,
      remainingUnits: 400_000,
      usageBasisPoints: 2_000,
    });
    remote.fundingNeeds.set(tenantId, { pausedWorkCount: 1, requiredUnits: 700_000 });

    await adapter.reconcileAccount(customer.account_id);
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 1_300_000,
      remainingUnits: 1_200_000,
    });
    const adjustments = remote.calls.filter(
      (call) => call.tool === "phylax_management_v1_credit_adjust",
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.args.amountUnits).toBe(800_000);
    adapter.close();
  });

  it("does not count a paused job twice when a concurrent refill reserves it", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-stale-job-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config({
      masterAllowanceUnits: 3_500_000,
      phylaxAllowanceUnits: 2_000_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    }), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 100_000,
      remainingUnits: 400_000,
      usageBasisPoints: 2_000,
    });
    remote.fundingNeeds.set(tenantId, { pausedWorkCount: 1, requiredUnits: 700_000 });
    remote.beforeAdjustOnce = (id) => {
      remote.revisions.set(id, 2);
      remote.allowance.set(id, {
        ...remote.allowance.get(id)!,
        allocatedUnits: 1_300_000,
        usedUnits: 100_000,
        reservedUnits: 700_000,
        remainingUnits: 500_000,
      });
      remote.fundingNeeds.set(id, { pausedWorkCount: 0, requiredUnits: 0 });
    };

    await adapter.reconcileAccount(customer.account_id);
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 1_300_000,
      reservedUnits: 700_000,
      remainingUnits: 500_000,
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(1);
    adapter.close();
  });

  it("never turns a stale cap reclaim into a positive grant", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-stale-reclaim-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config({
      masterAllowanceUnits: 2_500_000,
      phylaxAllowanceUnits: 1_500_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    }), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      allocatedUnits: 1_300_000,
      remainingUnits: 1_300_000,
    });
    remote.beforeAdjustOnce = (id) => {
      remote.revisions.set(id, 2);
      remote.allowance.set(id, {
        ...remote.allowance.get(id)!,
        allocatedUnits: 900_000,
        remainingUnits: 900_000,
      });
    };

    await adapter.reconcileAccount(customer.account_id);
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 900_000,
      remainingUnits: 900_000,
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(1);
    adapter.close();
  });

  it("replays a lost faucet response after restart without granting twice", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-restart-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const faucetConfig = config({
      phylaxAllowanceUnits: 1_000_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    });
    const customer = account("alpha");
    const first = new ZenodPhylaxAdapter(dataDir, faucetConfig, remote);
    first.setDownstreamTokenResolver(() => "zenod-memory-token");
    await first.setEntitlement(customer, true);
    const tenantId = first.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 450_000,
      remainingUnits: 50_000,
      usageBasisPoints: 9_000,
    });
    remote.loseAdjustResponseOnce = true;
    await expect(first.reconcileAccount(customer.account_id)).rejects.toThrow("adjust response lost");
    first.close();

    const restarted = new ZenodPhylaxAdapter(dataDir, faucetConfig, remote);
    restarted.setDownstreamTokenResolver(() => "zenod-memory-token");
    await restarted.reconcileAccount(customer.account_id);
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 950_000,
      remainingUnits: 500_000,
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(2);
    restarted.close();
  });

  it("returns a durable capacity refusal and leaves oversized paid work paused", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-refusal-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config({
      phylaxAllowanceUnits: 1_000_000,
      phylaxWalletTargetUnits: 500_000,
      phylaxWalletLowWaterUnits: 100_000,
    }), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const customer = account("alpha");
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 450_000,
      remainingUnits: 50_000,
      usageBasisPoints: 9_000,
    });
    remote.fundingNeeds.set(tenantId, { pausedWorkCount: 1, requiredUnits: 600_000 });

    await expect(adapter.reconcileAccount(customer.account_id))
      .rejects.toThrow("Allowance faucet refused: allowance_capacity");
    expect(adapter.viewForAccount(customer.account_id)).toMatchObject({
      state: "unavailable",
      lastErrorCode: "allowance_capacity",
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(0);
    await expect(adapter.reconcileAccount(customer.account_id))
      .rejects.toThrow("Allowance faucet refused: allowance_capacity");
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(0);
    adapter.close();
  });

  it("rebases a definitively-not-applied stale top-up without duplicating customer credit", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-stale-topup-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.revisions.set(tenantId, 2); // A separate, already-committed owner mutation.
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      allocatedUnits: 1_200_000,
      remainingUnits: 1_200_000,
    });
    const projection = await adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-stale-0001",
      amountUnits: 100_000,
      auditReason: "recover stale revision",
    });
    expect(projection.allocatedUnits).toBe(1_300_000);
    const adjusts = remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust");
    expect(adjusts).toHaveLength(2);
    expect(adjusts[0]!.args.expectedRevision).toBe("1");
    expect(adjusts[1]!.args.expectedRevision).toBe("2");
    expect(adjusts[1]!.args.operationId).not.toBe(adjusts[0]!.args.operationId);
    expect(remote.allowance.get(tenantId)?.allocatedUnits).toBe(1_300_000);
    adapter.close();
  });

  it("terminalizes a stale top-up if a concurrent grant consumes the service cap", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf-credit-faucet-stale-cap-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.revisions.set(tenantId, 2);
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      allocatedUnits: 1_450_000,
      remainingUnits: 1_450_000,
    });

    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-stale-cap-0001",
      amountUnits: 100_000,
      auditReason: "must not overdraw after stale revision",
    })).rejects.toThrow("Allowance adjustment exceeds capacity");
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(1);
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-stale-cap-0001",
      amountUnits: 100_000,
      auditReason: "must not overdraw after stale revision",
    })).rejects.toThrow("allowance_capacity");
    expect(remote.allowance.get(tenantId)?.allocatedUnits).toBe(1_450_000);
    adapter.close();
  });

  it("terminalizes an unapplied old-period top-up across restart before granting the new period", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-rollover-topup-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const first = new ZenodPhylaxAdapter(dataDir, config(), remote);
    first.setDownstreamTokenResolver(() => "zenod-memory-token");
    await first.setEntitlement(customer, true);
    remote.unavailable = true;
    await expect(first.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-rollover-0001",
      amountUnits: 100_000,
      auditReason: "old period top-up",
    })).rejects.toThrow("offline");
    first.close();

    remote.unavailable = false;
    remote.calls.splice(0);
    const nextPeriod = account("alpha", {
      managed_ai_limit_usd: 1.5,
      current_period_start: "2026-09-27T00:00:00.000Z",
      current_period_end: "2026-10-27T00:00:00.000Z",
    });
    const restarted = new ZenodPhylaxAdapter(dataDir, config(), remote);
    restarted.setDownstreamTokenResolver(() => "zenod-memory-token");
    await restarted.setEntitlement(nextPeriod, true);
    expect(remote.calls.some((call) => call.tool === "phylax_management_v1_credit_adjust")).toBe(false);
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_grant")).toHaveLength(1);
    expect(restarted.viewForAccount(customer.account_id)).toMatchObject({
      state: "active",
      periodId: `zenod:sub-alpha:${nextPeriod.current_period_end}`,
      allocationUnits: 1_000_000,
    });
    await expect(restarted.topUpAllowance({
      account: nextPeriod,
      operationId: "topup-alpha-rollover-0001",
      amountUnits: 100_000,
      auditReason: "old period top-up",
    })).rejects.toThrow("billing_period_changed");
    restarted.close();
  });

  it("terminalizes an unapplied pending top-up before cancellation without a remote credit effect", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-cancel-topup-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    remote.unavailable = true;
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-cancel-0001",
      amountUnits: 100_000,
      auditReason: "cancel pending top-up",
    })).rejects.toThrow("offline");
    remote.unavailable = false;
    remote.calls.splice(0);
    await adapter.setEntitlement(account("alpha", {
      managed_ai_limit_usd: 1.5,
      subscription_status: "canceled",
    }), false);
    expect(remote.calls.some((call) => call.tool === "phylax_management_v1_credit_adjust")).toBe(false);
    expect(adapter.viewForAccount(customer.account_id)).toMatchObject({
      desiredAccess: "suspended",
      state: "suspended",
      allocationUnits: 1_000_000,
    });
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-cancel-0001",
      amountUnits: 100_000,
      auditReason: "cancel pending top-up",
    })).rejects.toThrow("entitlement_inactive");
    adapter.close();
  });

  it("freshly rechecks master capacity before replaying an outage-pending top-up", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-cap-topup-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    remote.unavailable = true;
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-cap-recheck-0001",
      amountUnits: 400_000,
      auditReason: "capacity changed while pending",
    })).rejects.toThrow("offline");
    remote.unavailable = false;
    remote.calls.splice(0);
    const largerLocalAllocation = account("alpha", { managed_ai_limit_usd: 2 });
    await adapter.setEntitlement(largerLocalAllocation, true);
    expect(remote.calls.some((call) => call.tool === "phylax_management_v1_credit_adjust")).toBe(false);
    await expect(adapter.topUpAllowance({
      account: largerLocalAllocation,
      operationId: "topup-alpha-cap-recheck-0001",
      amountUnits: 400_000,
      auditReason: "capacity changed while pending",
    })).rejects.toThrow("allowance_capacity");
    expect(adapter.viewForAccount(customer.account_id)).toMatchObject({
      state: "active",
      allocationUnits: 1_000_000,
    });
    adapter.close();
  });

  it("durably reclaims an applied response-lost top-up when a later local allocation needs the reserved master capacity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-applied-cap-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    remote.loseAdjustResponseOnce = true;
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-applied-cap-0001",
      amountUnits: 100_000,
      auditReason: "response lost after apply",
    })).rejects.toThrow("adjust response lost");

    remote.loseAdjustResponseOnce = true;
    await expect(adapter.setEntitlement(account("alpha", { managed_ai_limit_usd: 2 }), true))
      .rejects.toThrow("adjust response lost");
    expect(adapter.viewForAccount(customer.account_id)).toMatchObject({
      state: "unavailable",
      lastErrorCode: "phylax_unavailable",
      allocationUnits: 1_000_000,
    });
    adapter.close();

    const restarted = new ZenodPhylaxAdapter(dataDir, config(), remote);
    restarted.setDownstreamTokenResolver(() => "zenod-memory-token");
    await restarted.reconcileAccount(customer.account_id);
    expect(restarted.viewForAccount(customer.account_id)).toMatchObject({
      state: "active",
      lastErrorCode: null,
      allocationUnits: 1_000_000,
    });
    expect(remote.calls.filter((call) => call.tool === "phylax_management_v1_credit_adjust"))
      .toHaveLength(4);
    restarted.close();
  });

  it("reclaims only unused and unreserved Phylax allowance", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-reserved-cap-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    remote.loseAdjustResponseOnce = true;
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-reserved-0001",
      amountUnits: 500_000,
      auditReason: "reserve-aware cap test",
    })).rejects.toThrow("adjust response lost");
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      reservedUnits: 600_000,
      remainingUnits: 900_000,
    });
    remote.callDelayMs = 5;
    remote.maxActiveCalls.clear();
    await Promise.all([
      adapter.setEntitlement(account("alpha", { managed_ai_limit_usd: 1.9 }), true),
      adapter.reconcileAll(),
    ]);
    expect(remote.maxActiveCalls.get(tenantId)).toBe(1);
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 1_100_000,
      usedUnits: 0,
      reservedUnits: 600_000,
      remainingUnits: 500_000,
    });
    expect(adapter.viewForAccount(customer.account_id)).toMatchObject({
      state: "active",
      allocationUnits: 1_100_000,
    });
    adapter.close();
  });

  it("does not reuse a completed reclaim after an intervening allocation increase", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-repeated-cap-reclaim-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const smallerLocalAllocation = account("alpha", { managed_ai_limit_usd: 1.5 });
    const largerLocalAllocation = account("alpha", { managed_ai_limit_usd: 2 });
    await adapter.setEntitlement(smallerLocalAllocation, true);
    await adapter.topUpAllowance({
      account: smallerLocalAllocation,
      operationId: "topup-alpha-before-first-reclaim",
      amountUnits: 500_000,
      auditReason: "first allocation increase",
    });
    await adapter.setEntitlement(largerLocalAllocation, true);
    await adapter.setEntitlement(smallerLocalAllocation, true);
    await adapter.topUpAllowance({
      account: smallerLocalAllocation,
      operationId: "topup-alpha-before-second-reclaim",
      amountUnits: 500_000,
      auditReason: "intervening allocation increase",
    });
    await adapter.setEntitlement(largerLocalAllocation, true);

    const tenantId = adapter.viewForAccount(smallerLocalAllocation.account_id)!.phylaxTenantId;
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 1_000_000,
      state: "active",
    });
    const negativeAdjustments = remote.calls.filter((call) =>
      call.tool === "phylax_management_v1_credit_adjust" &&
      Number(call.args.amountUnits) < 0,
    );
    expect(negativeAdjustments).toHaveLength(2);
    expect(negativeAdjustments[0]?.args.operationId)
      .not.toBe(negativeAdjustments[1]?.args.operationId);
    expect(adapter.viewForAccount(smallerLocalAllocation.account_id)).toMatchObject({
      state: "active",
      allocationUnits: 1_000_000,
    });
    adapter.close();
  });

  it("suspends future paid work and reports irreducible over-cap truth when consumed and reserved units cannot be reclaimed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-irreducible-cap-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const customer = account("alpha", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    await adapter.setEntitlement(customer, true);
    remote.loseAdjustResponseOnce = true;
    await expect(adapter.topUpAllowance({
      account: customer,
      operationId: "topup-alpha-consumed-0001",
      amountUnits: 500_000,
      auditReason: "consumed cap test",
    })).rejects.toThrow("adjust response lost");
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 800_000,
      reservedUnits: 400_000,
      remainingUnits: 300_000,
    });
    await expect(adapter.setEntitlement(account("alpha", { managed_ai_limit_usd: 1.9 }), true))
      .rejects.toThrow("Irreducible Phylax usage");
    expect(remote.allowance.get(tenantId)).toMatchObject({
      allocatedUnits: 1_200_000,
      usedUnits: 800_000,
      reservedUnits: 400_000,
      state: "suspended",
    });
    expect(adapter.viewForAccount(customer.account_id)).toMatchObject({
      state: "unavailable",
      lastErrorCode: "allowance_capacity_irreducible",
      allocationUnits: 1_200_000,
    });
    adapter.close();
  });

  it("single-flights global reconciliation, serializes each account, and still runs different tenants in parallel", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-concurrency-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const alpha = account("alpha", { managed_ai_limit_usd: 1.5 });
    const beta = account("beta", { managed_ai_limit_usd: 1.5 });
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver((id) => `memory-${id}`);
    await adapter.bootstrapAccounts([alpha, beta]);
    remote.calls.splice(0);
    remote.maxConcurrentCalls = 0;
    remote.maxActiveCalls.clear();
    remote.callDelayMs = 5;

    await Promise.all([adapter.reconcileAll(), adapter.reconcileAll()]);
    const statusCalls = remote.calls.filter((call) => call.tool === "phylax_management_v1_channel_status");
    expect(statusCalls).toHaveLength(2);
    expect(remote.maxConcurrentCalls).toBeGreaterThan(1);
    expect([...remote.maxActiveCalls.values()]).toEqual([1, 1]);

    remote.calls.splice(0);
    remote.maxActiveCalls.clear();
    await Promise.all([
      adapter.topUpAllowance({
        account: alpha,
        operationId: "topup-alpha-concurrent-0001",
        amountUnits: 100_000,
        auditReason: "concurrent top-up",
      }),
      adapter.setEntitlement(account("alpha", {
        managed_ai_limit_usd: 1.5,
        subscription_status: "canceled",
      }), false),
      adapter.reconcileAll(),
    ]);
    expect(remote.maxActiveCalls.get(adapter.viewForAccount(alpha.account_id)!.phylaxTenantId)).toBe(1);
    expect(adapter.viewForAccount(alpha.account_id)).toMatchObject({
      desiredAccess: "suspended",
      state: "suspended",
      allocationUnits: 1_100_000,
    });
    adapter.close();
  });

  it("projects one combined customer percentage while preserving a separate operator breakdown", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-metering-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver(() => "zenod-memory-token");
    const customer = account("alpha");
    await adapter.setEntitlement(customer, true);
    const tenantId = adapter.viewForAccount(customer.account_id)!.phylaxTenantId;
    remote.allowance.set(tenantId, {
      ...remote.allowance.get(tenantId)!,
      usedUnits: 250_000,
      remainingUnits: 750_000,
      usageBasisPoints: 2_500,
    });
    await adapter.reconcileAccount(customer.account_id);
    const local = {
      percentageUsed: 50,
      state: "normal" as const,
      resetsAt: "2026-10-01T00:00:00.000Z",
    };
    expect(await adapter.usageForAccount(customer, local)).toEqual({
      percentageUsed: 42,
      state: "normal",
      resetsAt: "2026-10-01T00:00:00.000Z",
    });
    expect(adapter.operatorProjection(customer, local)).toMatchObject({
      masterAllowanceUnits: 3_000_000,
      conversion: { unitsPerUsd: 1_000_000, tariffVersion: "tariff-v1" },
      local: {
        configuredUsd: 2,
        configuredUnits: 2_000_000,
        usedUnits: 1_000_000,
        remainingUnits: 1_000_000,
      },
      phylax: { allocatedUnits: 1_000_000, projection: { usedUnits: 250_000 } },
    });
    adapter.close();
  });

  it("isolates two tenant mappings and replays channel actions with the original revision", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf6-isolation-"));
    dirs.push(dataDir);
    const remote = new FakeRemote();
    const adapter = new ZenodPhylaxAdapter(dataDir, config(), remote);
    adapter.setDownstreamTokenResolver((id) => `memory-${id}`);
    const alpha = account("alpha");
    const beta = account("beta");
    await adapter.setEntitlement(alpha, true);
    await adapter.setEntitlement(beta, true);
    const alphaTenant = adapter.customerTenant(alpha, "memory-alpha")!;
    const betaTenant = adapter.customerTenant(beta, "memory-beta")!;
    expect(alphaTenant.tenantId).not.toBe(betaTenant.tenantId);
    const action = {
      operation: "whatsapp.challenge" as const,
      operationId: "challenge-alpha-001",
      body: { sender: "+34 611 111 111" },
    };
    const projected = await adapter.channels(alphaTenant, action);
    expect(projected.status).toBe(200);
    expect(projected.body).not.toHaveProperty("evidence");
    expect(projected.body).not.toHaveProperty("binding");
    remote.channelRevision = "wa:99";
    expect((await adapter.channels(alphaTenant, action)).status).toBe(200);
    const channelCalls = remote.calls.filter((call) => call.tool === "phylax_management_v1_channel_connect");
    expect(channelCalls).toHaveLength(2);
    expect(channelCalls[0]!.args).toEqual(channelCalls[1]!.args);
    expect(channelCalls[0]!.args.expectedRevision).toBe("wa:0");
    expect(channelCalls[0]!.token).not.toBe(remote.tokens.get(betaTenant.tenantId));
    adapter.close();
  });
});
