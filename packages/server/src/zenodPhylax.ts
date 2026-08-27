import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CustomerAccount } from "./customerAccounts.js";
import type {
  CustomerUsageProjection,
  CustomerUsageState,
} from "./customerMetering.js";
import type {
  HostedChannelCustomerTenant,
  HostedChannelMutationName,
} from "./hostedChannels.js";
import {
  projectHostedChannelAction,
  projectHostedChannelError,
  projectHostedChannels,
} from "./hostedChannels.js";
import { openZenodSqlite } from "./sqlite.js";

const MANAGEMENT_PROFILE = "phylax-management-v1-zenod";
const DEFAULT_RECONCILE_MS = 30_000;

export interface ZenodPhylaxConfig {
  enabled: boolean;
  origin: string | null;
  controlToken: string | null;
  vaultSecret: string;
  masterAllowanceUnits: number;
  phylaxAllowanceUnits: number;
  unitsPerUsd: number;
  tariffVersion: string;
  downstreamUrl: string;
  warnPercent: number;
  reconcileIntervalMs: number;
}

export interface ZenodPhylaxAllowance {
  tenantId: string;
  periodId: string | null;
  state: "active" | "paused" | "suspended" | "unavailable";
  allocatedUnits: number;
  usedUnits: number;
  reservedUnits: number;
  remainingUnits: number;
  usageBasisPoints: number;
  resetsAt: number | null;
}

export interface ZenodPhylaxBindingView {
  accountId: string;
  zenodTenantId: string;
  phylaxTenantId: string;
  state: "setting_up" | "active" | "suspended" | "unavailable";
  desiredAccess: "active" | "suspended";
  periodId: string | null;
  allocationUnits: number;
  ledgerRevision: string;
  lastErrorCode: string | null;
  updatedAt: number;
}

interface BindingRow {
  account_id: string;
  zenod_tenant_id: string;
  phylax_tenant_id: string;
  token_iv: string;
  token_ciphertext: string;
  token_auth_tag: string;
  desired_access: "active" | "suspended";
  state: ZenodPhylaxBindingView["state"];
  period_id: string | null;
  period_starts_at: number | null;
  period_ends_at: number | null;
  allocation_units: number;
  local_capacity_units: number;
  ledger_revision: string;
  allowance_json: string | null;
  last_error_code: string | null;
  updated_at: number;
}

interface ChannelOperationRow {
  account_id: string;
  operation_id: string;
  operation: HostedChannelMutationName;
  arguments_json: string;
  created_at: number;
}

interface AllowanceOperationRow {
  account_id: string;
  operation_id: string;
  arguments_json: string;
  created_at: number;
  completed_at: number | null;
  terminal_error_code: string | null;
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
}

export interface ZenodPhylaxRemote {
  ensureTenant(input: {
    tenantId: string;
    token: string;
    desiredAccess: "active" | "suspended";
  }): Promise<void>;
  call(token: string, tool: string, args: Record<string, unknown>): Promise<ToolResult>;
}

function integerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function exactOrigin(value: string | undefined, allowed: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== "/")
    ) return null;
    const allowlist = (allowed ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => new URL(entry).origin);
    return allowlist.includes(parsed.origin) ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function loadZenodPhylaxConfig(env: NodeJS.ProcessEnv): ZenodPhylaxConfig {
  const origin = exactOrigin(
    env.ZENOD_PHYLAX_MANAGEMENT_URL,
    env.ZENOD_PHYLAX_ALLOWED_ORIGINS,
  );
  const controlToken = env.ZENOD_PHYLAX_CONTROL_TOKEN?.trim() || null;
  const vaultSecret = env.CHASSIS_VAULT_MASTER_KEY?.trim() || "";
  const masterAllowanceConfigured = Number(env.ZENOD_MASTER_ALLOWANCE_UNITS);
  const phylaxAllowanceConfigured = Number(env.ZENOD_PHYLAX_ALLOWANCE_UNITS);
  const unitsPerUsdConfigured = Number(env.ZENOD_ALLOWANCE_UNITS_PER_USD);
  const masterAllowanceUnits = integerEnv(env.ZENOD_MASTER_ALLOWANCE_UNITS, 3_000_000);
  const phylaxAllowanceUnits = integerEnv(env.ZENOD_PHYLAX_ALLOWANCE_UNITS, 1_000_000);
  const unitsPerUsd = integerEnv(env.ZENOD_ALLOWANCE_UNITS_PER_USD, 1_000_000);
  const tariffVersion = env.ZENOD_PHYLAX_TARIFF_VERSION?.trim() || "";
  const warnPercent = Math.min(99, integerEnv(env.ZENOD_USAGE_WARN_PERCENT, 80));
  const reconcileIntervalMs = integerEnv(
    env.ZENOD_PHYLAX_RECONCILE_INTERVAL_MS,
    DEFAULT_RECONCILE_MS,
  );
  return {
    enabled: Boolean(
      origin &&
      controlToken &&
      vaultSecret &&
      Number.isSafeInteger(masterAllowanceConfigured) && masterAllowanceConfigured > 0 &&
      Number.isSafeInteger(phylaxAllowanceConfigured) && phylaxAllowanceConfigured > 0 &&
      Number.isSafeInteger(unitsPerUsdConfigured) && unitsPerUsdConfigured > 0 &&
      tariffVersion,
    ),
    origin,
    controlToken,
    vaultSecret,
    masterAllowanceUnits,
    phylaxAllowanceUnits,
    unitsPerUsd,
    tariffVersion: tariffVersion || "unconfigured",
    downstreamUrl: (
      env.ZENOD_PHYLAX_DOWNSTREAM_URL?.trim() ||
      `${(env.CUSTOMER_APP_URL || env.DOMAIN || "https://cloud.zenod.dev").replace(/\/$/, "")}/mcp`
    ),
    warnPercent,
    reconcileIntervalMs,
  };
}

function deterministicPhylaxTenantId(zenodTenantId: string): string {
  return `zenod-${createHash("sha256").update(zenodTenantId, "utf8").digest("hex").slice(0, 32)}`;
}

function operationId(kind: string, values: unknown[]): string {
  return `zpf6-${kind}-${createHash("sha256")
    .update(JSON.stringify(values), "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function periodFor(account: CustomerAccount): {
  id: string;
  startsAt: number;
  endsAt: number;
} | null {
  if (!account.current_period_start || !account.current_period_end) return null;
  const startsAt = Date.parse(account.current_period_start);
  const endsAt = Date.parse(account.current_period_end);
  if (
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    startsAt < 0 ||
    endsAt <= startsAt
  ) return null;
  const end = new Date(endsAt);
  return {
    id: `zenod:${account.stripe_subscription_id ?? account.account_id}:${end.toISOString()}`,
    startsAt,
    endsAt,
  };
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/credential.*conflict|already exists/i.test(message)) return "credential_conflict";
  if (/irreducible.*master allowance/i.test(message)) return "allowance_capacity_irreducible";
  if (/allowance.*capacity/i.test(message)) return "allowance_capacity";
  if (/stale_revision/i.test(message)) return "stale_revision";
  return "phylax_unavailable";
}

function structured(result: ToolResult): Record<string, unknown> {
  const value = result.structuredContent;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phylax management returned an invalid structured result");
  }
  const root = value as Record<string, unknown>;
  if (result.isError) {
    const error = root.error && typeof root.error === "object"
      ? root.error as Record<string, unknown>
      : null;
    const code = typeof error?.code === "string" ? error.code : "management_failed";
    throw new Error(`${code}: ${typeof error?.message === "string" ? error.message : "Phylax management failed"}`);
  }
  return root;
}

function allowance(value: unknown): ZenodPhylaxAllowance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phylax allowance projection is invalid");
  }
  const item = value as Record<string, unknown>;
  const state = item.state;
  if (!["active", "paused", "suspended", "unavailable"].includes(String(state))) {
    throw new Error("Phylax allowance state is invalid");
  }
  const number = (key: string) => {
    const candidate = item[key];
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) {
      throw new Error(`Phylax allowance ${key} is invalid`);
    }
    return Number(candidate);
  };
  return {
    tenantId: typeof item.tenantId === "string" ? item.tenantId : "",
    periodId: item.periodId === null || typeof item.periodId === "string" ? item.periodId : null,
    state: state as ZenodPhylaxAllowance["state"],
    allocatedUnits: number("allocatedUnits"),
    usedUnits: number("usedUnits"),
    reservedUnits: number("reservedUnits"),
    remainingUnits: number("remainingUnits"),
    usageBasisPoints: number("usageBasisPoints"),
    resetsAt: item.resetsAt === null || Number.isSafeInteger(item.resetsAt)
      ? item.resetsAt as number | null
      : null,
  };
}

class HttpZenodPhylaxRemote implements ZenodPhylaxRemote {
  constructor(private readonly config: ZenodPhylaxConfig) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.controlToken}`,
      "content-type": "application/json",
    };
  }

  async ensureTenant(input: {
    tenantId: string;
    token: string;
    desiredAccess: "active" | "suspended";
  }): Promise<void> {
    const origin = this.config.origin!;
    const tenantPath = `/api/tenants/${encodeURIComponent(input.tenantId)}`;
    // PATCH is the idempotent existence probe. A response lost after POST is
    // recovered by the next PATCH, so retries never depend on a returned token.
    let status = await fetch(`${origin}${tenantPath}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ status: input.desiredAccess }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (status.status === 404) {
      const created = await fetch(`${origin}/api/tenants`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          tenantId: input.tenantId,
          name: `Zenod channel tenant ${input.tenantId}`,
          plan: "integrated-zenod",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!created.ok) throw new Error(`Phylax tenant provision failed (${created.status})`);
      status = await fetch(`${origin}${tenantPath}`, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ status: input.desiredAccess }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    }
    if (!status.ok) throw new Error(`Phylax tenant status failed (${status.status})`);
    const ensured = await fetch(`${origin}${tenantPath}/tokens/ensure`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ profile: MANAGEMENT_PROFILE, token: input.token }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (ensured.status === 409) throw new Error("Phylax service credential conflict");
    if (!ensured.ok) throw new Error(`Phylax service credential ensure failed (${ensured.status})`);
  }

  async call(token: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = new Client(
      { name: "zenod-phylax-management", version: "1.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${this.config.origin}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    try {
      await client.connect(transport);
      return await client.callTool({ name: tool, arguments: args }) as ToolResult;
    } finally {
      await client.close().catch(() => {});
    }
  }
}

/**
 * Durable Zenod-owned product adapter. It stores only the mapping, desired
 * lifecycle and an encrypted caller-custodied Phylax service credential.
 * Phylax remains authoritative for channel state and channel-cost allowance.
 */
export class ZenodPhylaxAdapter {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private readonly remote: ZenodPhylaxRemote;
  private readonly timer: NodeJS.Timeout | null;
  private readonly accountRuns = new Map<string, Promise<void>>();
  private reconcileAllRun: Promise<void> | null = null;
  private closed = false;
  private downstreamTokenForAccount: (accountId: string) => string | null = () => null;

  constructor(
    dataDir: string,
    readonly config: ZenodPhylaxConfig,
    remote?: ZenodPhylaxRemote,
  ) {
    this.db = openZenodSqlite(join(dataDir, "zenod-phylax-adapter.sqlite"));
    this.key = createHash("sha256").update(config.vaultSecret, "utf8").digest();
    this.remote = remote ?? new HttpZenodPhylaxRemote(config);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zenod_phylax_bindings (
        account_id TEXT PRIMARY KEY,
        zenod_tenant_id TEXT NOT NULL UNIQUE,
        phylax_tenant_id TEXT NOT NULL UNIQUE,
        token_iv TEXT NOT NULL,
        token_ciphertext TEXT NOT NULL,
        token_auth_tag TEXT NOT NULL,
        desired_access TEXT NOT NULL CHECK(desired_access IN ('active','suspended')),
        state TEXT NOT NULL CHECK(state IN ('setting_up','active','suspended','unavailable')),
        period_id TEXT,
        period_starts_at INTEGER,
        period_ends_at INTEGER,
        allocation_units INTEGER NOT NULL DEFAULT 0,
        local_capacity_units INTEGER NOT NULL DEFAULT 0,
        ledger_revision TEXT NOT NULL DEFAULT '0',
        allowance_json TEXT,
        last_error_code TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS zenod_phylax_channel_operations (
        account_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(account_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS zenod_phylax_allowance_operations (
        account_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        terminal_error_code TEXT,
        PRIMARY KEY(account_id, operation_id)
      );
    `);
    const bindingColumns = new Set(
      (this.db.prepare("PRAGMA table_info(zenod_phylax_bindings)").all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    if (!bindingColumns.has("local_capacity_units")) {
      this.db.exec("ALTER TABLE zenod_phylax_bindings ADD COLUMN local_capacity_units INTEGER NOT NULL DEFAULT 0");
    }
    const allowanceOperationColumns = new Set(
      (this.db.prepare("PRAGMA table_info(zenod_phylax_allowance_operations)").all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    if (!allowanceOperationColumns.has("completed_at")) {
      this.db.exec("ALTER TABLE zenod_phylax_allowance_operations ADD COLUMN completed_at INTEGER");
    }
    if (!allowanceOperationColumns.has("terminal_error_code")) {
      this.db.exec("ALTER TABLE zenod_phylax_allowance_operations ADD COLUMN terminal_error_code TEXT");
    }
    this.timer = config.enabled
      ? setInterval(() => void this.reconcileAll(), config.reconcileIntervalMs)
      : null;
    this.timer?.unref?.();
  }

  setDownstreamTokenResolver(resolver: (accountId: string) => string | null): void {
    this.downstreamTokenForAccount = resolver;
  }

  private encrypt(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
    };
  }

  private token(row: BindingRow): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.token_iv, "base64url"));
    decipher.setAuthTag(Buffer.from(row.token_auth_tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(row.token_ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private row(accountId: string): BindingRow | null {
    return this.db.prepare(
      "SELECT * FROM zenod_phylax_bindings WHERE account_id=?",
    ).get(accountId) as unknown as BindingRow | undefined ?? null;
  }

  private ensureRow(account: CustomerAccount): BindingRow {
    if (!account.tenant_id) throw new Error("Zenod tenant is not provisioned");
    const existing = this.row(account.account_id);
    const phylaxTenantId = deterministicPhylaxTenantId(account.tenant_id);
    if (existing) {
      if (existing.zenod_tenant_id !== account.tenant_id || existing.phylax_tenant_id !== phylaxTenantId) {
        throw new Error("Zenod-to-Phylax tenant mapping conflict");
      }
      // Decryption is an integrity gate. Never replace an unreadable credential.
      this.token(existing);
      return existing;
    }
    const encrypted = this.encrypt(`zenod_${randomBytes(36).toString("base64url")}`);
    this.db.prepare(
      `INSERT INTO zenod_phylax_bindings
       (account_id, zenod_tenant_id, phylax_tenant_id, token_iv,
        token_ciphertext, token_auth_tag, desired_access, state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'suspended', 'setting_up', ?)`,
    ).run(
      account.account_id,
      account.tenant_id,
      phylaxTenantId,
      encrypted.iv,
      encrypted.ciphertext,
      encrypted.authTag,
      Date.now(),
    );
    return this.row(account.account_id)!;
  }

  private serializeAccount<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.accountRuns.get(accountId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    const settled = result.then(() => {}, () => {});
    this.accountRuns.set(accountId, settled);
    return result.finally(() => {
      if (this.accountRuns.get(accountId) === settled) this.accountRuns.delete(accountId);
    });
  }

  viewForAccount(accountId: string): ZenodPhylaxBindingView | null {
    const row = this.row(accountId);
    return row ? this.view(row) : null;
  }

  private view(row: BindingRow): ZenodPhylaxBindingView {
    return {
      accountId: row.account_id,
      zenodTenantId: row.zenod_tenant_id,
      phylaxTenantId: row.phylax_tenant_id,
      state: row.state,
      desiredAccess: row.desired_access,
      periodId: row.period_id,
      allocationUnits: row.allocation_units,
      ledgerRevision: row.ledger_revision,
      lastErrorCode: row.last_error_code,
      updatedAt: row.updated_at,
    };
  }

  private recordEntitlement(account: CustomerAccount, entitled: boolean): string | null {
    if (!this.config.enabled || !account.tenant_id) return null;
    const row = this.ensureRow(account);
    const period = periodFor(account);
    const currentAllowance = this.storedAllowance(row);
    const outstandingUnits = currentAllowance?.allocatedUnits ?? row.allocation_units;
    const allocationUnits = entitled && period
      ? currentAllowance?.periodId === period.id
        ? outstandingUnits
        : this.config.phylaxAllowanceUnits
      : outstandingUnits;
    const localCapacity = Math.max(
      0,
      Math.round((account.managed_ai_limit_usd ?? 0) * this.config.unitsPerUsd),
    );
    const impossibleInitialAllocation = entitled &&
      currentAllowance === null &&
      localCapacity + allocationUnits > this.config.masterAllowanceUnits;
    this.db.prepare(
      `UPDATE zenod_phylax_bindings
       SET desired_access=?, state=?, period_id=?, period_starts_at=?,
           period_ends_at=?, allocation_units=?, local_capacity_units=?,
           last_error_code=?, updated_at=?
       WHERE account_id=?`,
    ).run(
      entitled ? "active" : "suspended",
      impossibleInitialAllocation ? "unavailable" : "setting_up",
      period?.id ?? null,
      period?.startsAt ?? null,
      period?.endsAt ?? null,
      allocationUnits,
      localCapacity,
      impossibleInitialAllocation ? "allowance_capacity" : null,
      Date.now(),
      row.account_id,
    );
    if (impossibleInitialAllocation) {
      throw new Error("Zenod local allowance plus outstanding Phylax allocation exceeds master allowance capacity");
    }
    return row.account_id;
  }

  async setEntitlement(account: CustomerAccount, entitled: boolean): Promise<void> {
    await this.serializeAccount(account.account_id, async () => {
      const accountId = this.recordEntitlement(account, entitled);
      if (accountId) await this.reconcileAccountNow(accountId);
    });
  }

  async bootstrapAccounts(accounts: readonly CustomerAccount[]): Promise<void> {
    if (!this.config.enabled || this.closed) return;
    const accountIds: string[] = [];
    // Persist the complete desired state before making any remote call. A
    // process restart therefore resumes the same deterministic mapping rather
    // than leaving later accounts absent because an earlier tenant was slow.
    for (const account of accounts) {
      if (!account.tenant_id || account.subscription_status === "checkout_pending") continue;
      const entitled = account.subscription_status === "active" ||
        account.subscription_status === "past_due";
      try {
        const accountId = this.recordEntitlement(account, entitled);
        if (accountId) accountIds.push(accountId);
      } catch (error) {
        const existing = this.row(account.account_id);
        if (existing) this.mark(existing.account_id, "unavailable", errorCode(error));
        console.error(`[zenod-phylax] bootstrap failed for account ${account.account_id}:`, error);
      }
    }
    await this.reconcileAccountIds(accountIds);
  }

  private mark(
    accountId: string,
    state: ZenodPhylaxBindingView["state"],
    code: string | null,
    revision?: string,
    projection?: ZenodPhylaxAllowance,
  ): void {
    this.db.prepare(
      `UPDATE zenod_phylax_bindings
       SET state=?, last_error_code=?,
           ledger_revision=COALESCE(?, ledger_revision),
           allowance_json=COALESCE(?, allowance_json),
           allocation_units=COALESCE(?, allocation_units), updated_at=?
       WHERE account_id=?`,
    ).run(
      state,
      code,
      revision ?? null,
      projection ? JSON.stringify(projection) : null,
      projection?.allocatedUnits ?? null,
      Date.now(),
      accountId,
    );
  }

  async topUpAllowance(input: {
    account: CustomerAccount;
    operationId: string;
    amountUnits: number;
    auditReason: string;
  }): Promise<ZenodPhylaxAllowance> {
    return this.serializeAccount(input.account.account_id, () => this.topUpAllowanceNow(input));
  }

  private async topUpAllowanceNow(input: {
    account: CustomerAccount;
    operationId: string;
    amountUnits: number;
    auditReason: string;
  }): Promise<ZenodPhylaxAllowance> {
    if (!this.config.enabled) throw new Error("Phylax integration is unavailable");
    if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(input.operationId)) {
      throw new Error("A stable allowance operation id is required");
    }
    if (!Number.isSafeInteger(input.amountUnits) || input.amountUnits <= 0) {
      throw new Error("Allowance top-up units must be a positive integer");
    }
    const auditReason = input.auditReason.trim();
    if (!auditReason || auditReason.length > 2_000) throw new Error("An allowance audit reason is required");
    const row = this.row(input.account.account_id);
    if (!row) throw new Error("Phylax allowance is not active");
    const existing = this.db.prepare(
      `SELECT * FROM zenod_phylax_allowance_operations
       WHERE account_id=? AND operation_id=?`,
    ).get(row.account_id, input.operationId) as unknown as AllowanceOperationRow | undefined;
    let args: Record<string, unknown>;
    if (existing) {
      args = JSON.parse(existing.arguments_json) as Record<string, unknown>;
      if (args.amountUnits !== input.amountUnits || args.auditReason !== auditReason) {
        throw new Error("Allowance operation id was already used for different arguments");
      }
      if (existing.terminal_error_code) {
        throw new Error(`Allowance operation was not applied: ${existing.terminal_error_code}`);
      }
      if (existing.completed_at !== null) {
        const projection = this.storedAllowance(row);
        if (!projection) throw new Error("Phylax allowance is not reconciled");
        return projection;
      }
    } else {
      if (row.desired_access !== "active" || !row.period_id) {
        throw new Error("Phylax allowance is not active");
      }
      const localCapacity = Math.max(
        0,
        Math.round((input.account.managed_ai_limit_usd ?? 0) * this.config.unitsPerUsd),
      );
      const pending = this.db.prepare(
        `SELECT operation_id FROM zenod_phylax_allowance_operations
         WHERE account_id=? AND completed_at IS NULL LIMIT 1`,
      ).get(row.account_id) as { operation_id: string } | undefined;
      if (pending) throw new Error("A previous allowance top-up is still pending");
      const projection = this.storedAllowance(row);
      if (!projection) throw new Error("Phylax allowance is not reconciled");
      if (projection.periodId !== row.period_id) throw new Error("Phylax billing period is not reconciled");
      if (localCapacity + projection.allocatedUnits + input.amountUnits > this.config.masterAllowanceUnits) {
        throw new Error("Allowance top-up exceeds master allowance capacity");
      }
      args = {
        operationId: input.operationId,
        expectedRevision: row.ledger_revision,
        periodId: row.period_id,
        amountUnits: input.amountUnits,
        tariffVersion: this.config.tariffVersion,
        auditReason,
      };
      const concurrentPending = this.db.prepare(
        `SELECT operation_id FROM zenod_phylax_allowance_operations
         WHERE account_id=? AND completed_at IS NULL LIMIT 1`,
      ).get(row.account_id) as { operation_id: string } | undefined;
      if (concurrentPending) throw new Error("A previous allowance top-up is still pending");
      this.db.prepare(
        `INSERT INTO zenod_phylax_allowance_operations
         (account_id, operation_id, arguments_json, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(row.account_id, input.operationId, JSON.stringify(args), Date.now());
    }
    try {
      const adjusted = await this.executeAllowanceOperation(row, this.token(row), {
        account_id: row.account_id,
        operation_id: input.operationId,
        arguments_json: JSON.stringify(args),
        created_at: existing?.created_at ?? Date.now(),
        completed_at: existing?.completed_at ?? null,
        terminal_error_code: existing?.terminal_error_code ?? null,
      });
      this.mark(row.account_id, "active", null, adjusted.revision, adjusted.projection);
      return adjusted.projection;
    } catch (error) {
      this.mark(row.account_id, "unavailable", errorCode(error));
      throw error;
    }
  }

  private async executeAllowanceOperation(
    row: BindingRow,
    token: string,
    operation: AllowanceOperationRow,
    allowRebase = true,
  ): Promise<{ revision: string; projection: ZenodPhylaxAllowance }> {
    let args = JSON.parse(operation.arguments_json) as Record<string, unknown>;
    const remoteArgs = () => {
      const { desiredAllocationUnits: _desiredAllocationUnits, operationKind: _operationKind, ...payload } = args;
      return payload;
    };
    let response = await this.remote.call(token, "phylax_management_v1_credit_adjust", remoteArgs());
    for (let attempt = 0; allowRebase && response.isError && attempt < 3; attempt += 1) {
      const root = response.structuredContent as Record<string, unknown> | undefined;
      const remoteError = root?.error as Record<string, unknown> | undefined;
      if (remoteError?.code !== "stale_revision") break;
      // A returned stale_revision is definitive proof that this exact remote
      // mutation was not applied. Rebase under a new remote idempotency key;
      // the customer operation id remains the durable local primary key.
      const queried = structured(await this.remote.call(
        token,
        "phylax_management_v1_credit_query",
        {},
      ));
      const revision = queried.revision;
      if (typeof revision !== "string") throw new Error("Phylax allowance revision is invalid");
      args = {
        ...args,
        operationId: operationId("adjust-rebase", [operation.operation_id, revision]),
        expectedRevision: revision,
      };
      this.db.prepare(
        `UPDATE zenod_phylax_allowance_operations SET arguments_json=?
         WHERE account_id=? AND operation_id=?`,
      ).run(JSON.stringify(args), row.account_id, operation.operation_id);
      response = await this.remote.call(token, "phylax_management_v1_credit_adjust", remoteArgs());
    }
    const adjusted = structured(response);
    const authoritative = adjusted.replayed === true
      ? structured(await this.remote.call(token, "phylax_management_v1_credit_query", {}))
      : adjusted;
    const projection = allowance(authoritative.allowance);
    const revision = typeof authoritative.revision === "string"
      ? authoritative.revision
      : row.ledger_revision;
    this.db.prepare(
      `UPDATE zenod_phylax_allowance_operations SET completed_at=?
       WHERE account_id=? AND operation_id=?`,
    ).run(Date.now(), row.account_id, operation.operation_id);
    return { revision, projection };
  }

  private terminalizeAllowanceOperation(operation: AllowanceOperationRow, code: string): void {
    this.db.prepare(
      `UPDATE zenod_phylax_allowance_operations
       SET completed_at=?, terminal_error_code=?
       WHERE account_id=? AND operation_id=?`,
    ).run(Date.now(), code, operation.account_id, operation.operation_id);
  }

  private async reconcileAllowanceOperations(
    row: BindingRow,
    token: string,
    revision: string,
    projection: ZenodPhylaxAllowance,
  ): Promise<{ revision: string; projection: ZenodPhylaxAllowance }> {
    const pending = this.db.prepare(
      `SELECT * FROM zenod_phylax_allowance_operations
       WHERE account_id=? AND completed_at IS NULL AND terminal_error_code IS NULL
       ORDER BY created_at, operation_id`,
    ).all(row.account_id) as unknown as AllowanceOperationRow[];
    let current = { revision, projection };
    for (const operation of pending) {
      const args = JSON.parse(operation.arguments_json) as Record<string, unknown>;
      const amountUnits = Number(args.amountUnits);
      const capInvalid = args.operationKind !== "cap_reclaim" && (
        !Number.isSafeInteger(amountUnits) ||
        row.local_capacity_units + current.projection.allocatedUnits + amountUnits >
          this.config.masterAllowanceUnits
      );
      const invalidReason = row.desired_access !== "active"
        ? "entitlement_inactive"
        : args.periodId !== row.period_id
          ? "billing_period_changed"
          : capInvalid
            ? "allowance_capacity"
            : null;
      if (invalidReason) {
        if (args.expectedRevision !== current.revision) {
          try {
            // A revision change may be this exact operation whose response was
            // lost. Replaying the same id is observation-only: success proves
            // it was already applied; stale proves it was not.
            current = await this.executeAllowanceOperation(row, token, operation, false);
            continue;
          } catch (error) {
            if (!/stale_revision/.test(error instanceof Error ? error.message : String(error))) {
              throw error;
            }
          }
        }
        this.terminalizeAllowanceOperation(operation, invalidReason);
        continue;
      }
      current = await this.executeAllowanceOperation(row, token, operation);
    }
    return current;
  }

  private async reconcileMasterCapacity(
    row: BindingRow,
    token: string,
    revision: string,
    projection: ZenodPhylaxAllowance,
  ): Promise<{ revision: string; projection: ZenodPhylaxAllowance; irreducible: boolean }> {
    if (row.desired_access !== "active") return { revision, projection, irreducible: false };
    const excess = row.local_capacity_units + projection.allocatedUnits - this.config.masterAllowanceUnits;
    if (excess <= 0) return { revision, projection, irreducible: false };
    const protectedUnits = Math.min(
      projection.allocatedUnits,
      projection.usedUnits + projection.reservedUnits,
    );
    const reclaimableUnits = Math.max(0, projection.allocatedUnits - protectedUnits);
    const reclaimUnits = Math.min(excess, reclaimableUnits);
    let current = { revision, projection };
    if (reclaimUnits > 0 && row.period_id) {
      const desiredAllocationUnits = projection.allocatedUnits - reclaimUnits;
      const localOperationId = operationId("cap-reclaim-local", [
        row.account_id,
        row.period_id,
        desiredAllocationUnits,
        revision,
      ]);
      let operation = this.db.prepare(
        `SELECT * FROM zenod_phylax_allowance_operations
         WHERE account_id=? AND operation_id=?`,
      ).get(row.account_id, localOperationId) as unknown as AllowanceOperationRow | undefined;
      if (!operation) {
        const args = {
          operationId: operationId("cap-reclaim-remote", [
            row.account_id,
            row.period_id,
            desiredAllocationUnits,
            revision,
          ]),
          expectedRevision: revision,
          periodId: row.period_id,
          amountUnits: -reclaimUnits,
          tariffVersion: this.config.tariffVersion,
          auditReason: "Reconcile combined Zenod and Phylax allowance to the configured master cap",
          operationKind: "cap_reclaim",
          desiredAllocationUnits,
        };
        this.db.prepare(
          `INSERT INTO zenod_phylax_allowance_operations
           (account_id, operation_id, arguments_json, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(row.account_id, localOperationId, JSON.stringify(args), Date.now());
        operation = {
          account_id: row.account_id,
          operation_id: localOperationId,
          arguments_json: JSON.stringify(args),
          created_at: Date.now(),
          completed_at: null,
          terminal_error_code: null,
        };
      }
      if (operation.terminal_error_code) {
        throw new Error(`Allowance reclaim was not applied: ${operation.terminal_error_code}`);
      }
      current = operation.completed_at !== null
        ? current
        : await this.executeAllowanceOperation(row, token, operation);
    }
    return {
      ...current,
      irreducible: row.local_capacity_units + current.projection.allocatedUnits >
        this.config.masterAllowanceUnits,
    };
  }

  async reconcileAccount(accountId: string): Promise<void> {
    return this.serializeAccount(accountId, () => this.reconcileAccountNow(accountId));
  }

  private async reconcileAccountNow(accountId: string): Promise<void> {
    if (this.closed) return;
    const row = this.row(accountId);
    if (!row || !this.config.enabled) return;
    if (row.desired_access === "active" && !row.period_id) {
      this.mark(accountId, "setting_up", "billing_period_unavailable");
      return;
    }
    const token = this.token(row);
    try {
      await this.remote.ensureTenant({
        tenantId: row.phylax_tenant_id,
        token,
        // Keep the scoped management credential callable. Paid processing is
        // suspended in Phylax's ledger, preserving tenant/session custody.
        desiredAccess: "active",
      });
      const downstreamToken = this.downstreamTokenForAccount(row.account_id);
      if (!downstreamToken) throw new Error("Zenod downstream credential is unavailable");
      const bindingStatus = await this.remote.call(
        token,
        "phylax_management_v1_channel_status",
        {},
      );
      let expectedBindingRevision = "0";
      if (bindingStatus.isError) {
        const root = bindingStatus.structuredContent as Record<string, unknown> | undefined;
        const remoteError = root?.error as Record<string, unknown> | undefined;
        if (remoteError?.code !== "binding_required") structured(bindingStatus);
      } else {
        const root = structured(bindingStatus);
        const existingBinding = root.binding as Record<string, unknown> | undefined;
        if (!existingBinding || existingBinding.externalTenantId !== row.zenod_tenant_id) {
          throw new Error("Phylax existing binding does not belong to this Zenod tenant");
        }
        if (typeof existingBinding.revision !== "string") {
          throw new Error("Phylax binding revision is invalid");
        }
        expectedBindingRevision = existingBinding.revision;
      }
      const downstreamFingerprint = createHash("sha256")
        .update(downstreamToken, "utf8")
        .digest("hex");
      const ensured = structured(await this.remote.call(
        token,
        "phylax_management_v1_ensure_binding",
        {
          operationId: operationId("binding", [
            row.account_id,
            row.zenod_tenant_id,
            expectedBindingRevision,
            this.config.downstreamUrl,
            downstreamFingerprint,
          ]),
          expectedRevision: expectedBindingRevision,
          externalTenantId: row.zenod_tenant_id,
          downstreamUrl: this.config.downstreamUrl,
          downstreamToken,
        },
      ));
      const binding = ensured.binding as Record<string, unknown> | undefined;
      if (!binding || binding.externalTenantId !== row.zenod_tenant_id) {
        throw new Error("Phylax binding confirmation is invalid");
      }
      let current = structured(await this.remote.call(
        token,
        "phylax_management_v1_credit_query",
        {},
      ));
      let revision = typeof current.revision === "string" ? current.revision : row.ledger_revision;
      let projection = allowance(current.allowance);
      ({ revision, projection } = await this.reconcileAllowanceOperations(
        row,
        token,
        revision,
        projection,
      ));
      if (
        row.desired_access === "active" &&
        row.period_id &&
        row.period_starts_at !== null &&
        row.period_ends_at !== null &&
        row.allocation_units > 0 &&
        projection.periodId !== row.period_id
      ) {
        const grant = structured(await this.remote.call(
          token,
          "phylax_management_v1_credit_grant",
          {
            operationId: operationId("grant", [row.account_id, row.period_id, row.allocation_units]),
            expectedRevision: revision,
            periodId: row.period_id,
            startsAt: row.period_starts_at,
            endsAt: row.period_ends_at,
            amountUnits: row.allocation_units,
            tariffVersion: this.config.tariffVersion,
            auditReason: "Zenod integrated subscription channel allowance",
          },
        ));
        revision = typeof grant.revision === "string" ? grant.revision : revision;
        projection = allowance(grant.allowance);
      }
      const capacity = await this.reconcileMasterCapacity(row, token, revision, projection);
      revision = capacity.revision;
      projection = capacity.projection;
      if (capacity.irreducible) {
        if (projection.state !== "suspended") {
          const suspended = structured(await this.remote.call(
            token,
            "phylax_management_v1_suspend",
            {
              operationId: operationId("cap-suspend", [row.account_id, row.period_id, revision]),
              expectedRevision: revision,
              auditReason: "Suspend future paid work because consumed or reserved units exceed the master cap",
            },
          ));
          revision = typeof suspended.revision === "string" ? suspended.revision : revision;
          projection = allowance(suspended.allowance);
        }
        this.mark(accountId, "unavailable", "allowance_capacity_irreducible", revision, projection);
        throw new Error("Irreducible Phylax usage exceeds the master allowance capacity");
      }
      const shouldSuspend = row.desired_access === "suspended";
      if (shouldSuspend !== (projection.state === "suspended")) {
        const control = structured(await this.remote.call(
          token,
          shouldSuspend
            ? "phylax_management_v1_suspend"
            : "phylax_management_v1_resume",
          {
            operationId: operationId(shouldSuspend ? "suspend" : "resume", [row.account_id, row.period_id]),
            expectedRevision: revision,
            auditReason: shouldSuspend
              ? "Zenod subscription is not entitled"
              : "Zenod subscription entitlement restored",
          },
        ));
        revision = typeof control.revision === "string" ? control.revision : revision;
        projection = allowance(control.allowance);
      }
      this.mark(
        accountId,
        shouldSuspend ? "suspended" : "active",
        null,
        revision,
        projection,
      );
    } catch (error) {
      this.mark(accountId, "unavailable", errorCode(error));
      throw error;
    }
  }

  async reconcileAll(): Promise<void> {
    if (this.closed) return;
    if (this.reconcileAllRun) return this.reconcileAllRun;
    const run = this.reconcileAllNow();
    this.reconcileAllRun = run;
    try {
      await run;
    } finally {
      if (this.reconcileAllRun === run) this.reconcileAllRun = null;
    }
  }

  private async reconcileAllNow(): Promise<void> {
    const rows = this.db.prepare(
      "SELECT account_id FROM zenod_phylax_bindings ORDER BY account_id",
    ).all() as Array<{ account_id: string }>;
    await this.reconcileAccountIds(rows.map((row) => row.account_id));
  }

  private async reconcileAccountIds(accountIds: readonly string[]): Promise<void> {
    let cursor = 0;
    const worker = async () => {
      while (!this.closed) {
        const index = cursor;
        cursor += 1;
        if (index >= accountIds.length) return;
        await this.reconcileAccount(accountIds[index]!).catch(() => {});
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(4, accountIds.length) },
      () => worker(),
    ));
  }

  private storedAllowance(row: BindingRow): ZenodPhylaxAllowance | null {
    if (!row.allowance_json) return null;
    try {
      return allowance(JSON.parse(row.allowance_json));
    } catch {
      return null;
    }
  }

  async usageForAccount(
    account: CustomerAccount,
    local: CustomerUsageProjection,
  ): Promise<CustomerUsageProjection> {
    if (!this.config.enabled) return local;
    const row = this.row(account.account_id);
    if (!row || row.state === "setting_up") {
      return { percentageUsed: null, state: "setting_up", resetsAt: local.resetsAt };
    }
    if (row.state === "unavailable") {
      return { percentageUsed: null, state: "unavailable", resetsAt: local.resetsAt };
    }
    const phylax = this.storedAllowance(row);
    if (!phylax || local.percentageUsed === null) {
      return {
        percentageUsed: null,
        state: row.state === "suspended" ? "paused" : "unavailable",
        resetsAt: local.resetsAt ?? (phylax?.resetsAt ? new Date(phylax.resetsAt).toISOString() : null),
      };
    }
    const localCapacity = Math.max(
      0,
      Math.round((account.managed_ai_limit_usd ?? 0) * this.config.unitsPerUsd),
    );
    const localUsed = Math.round(localCapacity * local.percentageUsed / 100);
    const used = localUsed + phylax.usedUnits;
    const percentageUsed = Math.min(100, Math.max(
      0,
      Math.round(used / this.config.masterAllowanceUnits * 100),
    ));
    const state: CustomerUsageState =
      row.state === "suspended" || local.state === "paused" || phylax.state === "suspended" || percentageUsed >= 100
        ? "paused"
        : percentageUsed >= this.config.warnPercent || local.state === "warn" || phylax.state === "paused"
          ? "warn"
          : "normal";
    const phylaxReset = phylax.resetsAt ? new Date(phylax.resetsAt).toISOString() : null;
    const resets = [local.resetsAt, phylaxReset]
      .filter((value): value is string => Boolean(value))
      .sort();
    return { percentageUsed, state, resetsAt: resets[0] ?? null };
  }

  operatorProjection(account: CustomerAccount, local: CustomerUsageProjection) {
    const row = this.row(account.account_id);
    const phylax = row ? this.storedAllowance(row) : null;
    const configuredUnits = Math.max(
      0,
      Math.round((account.managed_ai_limit_usd ?? 0) * this.config.unitsPerUsd),
    );
    const usedUnits = local.percentageUsed === null
      ? null
      : Math.round(configuredUnits * local.percentageUsed / 100);
    return {
      masterAllowanceUnits: this.config.masterAllowanceUnits,
      conversion: {
        unitsPerUsd: this.config.unitsPerUsd,
        tariffVersion: this.config.tariffVersion,
      },
      local: {
        configuredUsd: account.managed_ai_limit_usd,
        configuredUnits,
        usedUnits,
        remainingUnits: usedUnits === null ? null : Math.max(0, configuredUnits - usedUnits),
        projection: local,
      },
      phylax: {
        allocatedUnits: row?.allocation_units ?? 0,
        projection: phylax,
        state: row?.state ?? "setting_up",
      },
    };
  }

  customerTenant(account: CustomerAccount, downstreamToken: string): HostedChannelCustomerTenant | null {
    const row = this.row(account.account_id);
    if (!row) return null;
    return {
      tenantId: row.phylax_tenant_id,
      downstreamToken,
      processingPaused: account.managed_ai_status === "paused",
    };
  }

  async channels(
    tenant: HostedChannelCustomerTenant,
    action?: {
      operation: HostedChannelMutationName;
      operationId: string;
      body: Record<string, unknown>;
    },
  ): Promise<{ status: number; body: unknown }> {
    const binding = this.db.prepare(
      "SELECT * FROM zenod_phylax_bindings WHERE phylax_tenant_id=?",
    ).get(tenant.tenantId) as unknown as BindingRow | undefined ?? null;
    if (!binding || binding.state !== "active") return this.unavailable(action);
    try {
      const token = this.token(binding);
      if (!action) {
        const status = structured(await this.remote.call(
          token,
          "phylax_management_v1_channel_status",
          {},
        ));
        const projected = projectHostedChannels(status.channels);
        return projected ? { status: 200, body: projected } : this.unavailable();
      }
      const stored = this.db.prepare(
        `SELECT * FROM zenod_phylax_channel_operations
         WHERE account_id=? AND operation_id=?`,
      ).get(binding.account_id, action.operationId) as unknown as ChannelOperationRow | undefined;
      let args: Record<string, unknown>;
      if (stored) {
        if (stored.operation !== action.operation) {
          return {
            status: 409,
            body: {
              error: {
                code: "operation_conflict",
                message: "This request key was already used for a different action.",
                retryDisposition: "retry_new_operation",
              },
              mutation: {
                operationId: action.operationId,
                operation: action.operation,
                outcome: "failed",
                at: Date.now(),
              },
            },
          };
        }
        args = JSON.parse(stored.arguments_json) as Record<string, unknown>;
      } else {
        const status = structured(await this.remote.call(
          token,
          "phylax_management_v1_channel_status",
          {},
        ));
        const channels = status.channels as Record<string, Record<string, unknown>> | undefined;
        const channel = action.operation.startsWith("whatsapp") ? "whatsapp" : "telegram";
        const revision = channels?.[channel]?.revision;
        if (typeof revision !== "string") return this.unavailable(action);
        args = {
          operationId: action.operationId,
          expectedRevision: revision,
          channel,
          ...(action.operation === "whatsapp.challenge" ? { identity: action.body.sender } : {}),
          ...(action.operation === "telegram.connect" ? { identity: action.body.identity } : {}),
        };
        this.db.prepare(
          `INSERT INTO zenod_phylax_channel_operations
           (account_id, operation_id, operation, arguments_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(binding.account_id, action.operationId, action.operation, JSON.stringify(args), Date.now());
      }
      const suffix = action.operation.split(".")[1];
      const tool = suffix === "challenge" || suffix === "connect"
        ? "phylax_management_v1_channel_connect"
        : suffix === "test"
          ? "phylax_management_v1_channel_test"
          : "phylax_management_v1_channel_disconnect";
      const call = await this.remote.call(token, tool, args);
      if (call.isError) {
        const root = call.structuredContent as Record<string, unknown> | undefined;
        const error = root?.error as Record<string, unknown> | undefined;
        const code = typeof error?.code === "string" ? error.code : "channels_unavailable";
        const projected = projectHostedChannelError(root, action.operation, action.operationId);
        if (projected) {
          return {
            status: code.includes("conflict") ? 409 : 400,
            body: projected,
          };
        }
        return {
          status: code === "stale_revision" || code.includes("conflict") ? 409 : 503,
          body: {
            error: {
              code: "channels_unavailable",
              message: "Channels are temporarily unavailable. Try again shortly.",
              retryDisposition: code === "stale_revision"
                ? "retry_new_operation"
                : "retry_same_operation",
            },
            mutation: {
              operationId: action.operationId,
              operation: action.operation,
              outcome: "failed",
              at: Date.now(),
            },
          },
        };
      }
      const root = structured(call);
      const projected = projectHostedChannelAction(root, action.operation, action.operationId);
      return projected ? { status: 200, body: projected } : this.unavailable(action);
    } catch {
      return this.unavailable(action);
    }
  }

  private unavailable(action?: { operation: HostedChannelMutationName; operationId: string }) {
    return {
      status: 503,
      body: {
        error: {
          code: "channels_unavailable",
          message: "Channels are temporarily unavailable. Try again shortly.",
          retryDisposition: "retry_same_operation",
        },
        ...(action ? {
          mutation: {
            operationId: action.operationId,
            operation: action.operation,
            outcome: "failed",
            at: Date.now(),
          },
        } : {}),
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.db.close();
  }
}
