import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Runtime } from "./runtime.js";
import { CustomerAccountStore, type CustomerAccount } from "./customerAccounts.js";
import {
  gatewayKeyForSlug,
  listGatewayKeys,
  type GatewayKeyUsage,
} from "./customerMetering.js";

export type ManagedAiLifecycleState =
  | "disabled"
  | "provisioned"
  | "already_provisioned"
  | "enabled"
  | "suspended"
  | "orphaned";

export interface ManagedAiLifecycleOutcome {
  state: ManagedAiLifecycleState;
  accountId: string;
  keyHash: string | null;
  changed: boolean;
}

export interface ManagedAiConfig {
  enabled: boolean;
  provisioningKey: string | null;
  monthlyLimitUsd: number;
  warnPercent: number;
}

export interface ManagedAiCreatedKey {
  key: string;
  hash: string;
  name: string;
  limit: number;
  limitReset: "monthly";
}

export interface ManagedAiProviderClient {
  listKeys(): Promise<GatewayKeyUsage[]>;
  createKey(input: {
    name: string;
    limit: number;
    limitReset: "monthly";
    includeByokInLimit: true;
  }): Promise<ManagedAiCreatedKey>;
  updateKey(hash: string, input: {
    limit?: number;
    limitReset?: "monthly";
    disabled?: boolean;
    includeByokInLimit?: true;
  }): Promise<void>;
}

export interface ManagedAiLifecycleOptions {
  accounts: CustomerAccountStore;
  runtimeForAccount: (account: CustomerAccount) => Runtime | null;
  config: ManagedAiConfig;
  provider: ManagedAiProviderClient | null;
  audit?: CustomerManagedAiAuditStore;
  now?: () => Date;
}

const KEY_PREFIX = "zenod-tenant:";

export interface CustomerManagedAiAuditEvent {
  ts: string;
  accountId: string;
  tenantId: string | null;
  state: CustomerAccount["managed_ai_status"];
  keyHash: string | null;
  limitUsd: number | null;
  errorCode: string | null;
}

/** Append-only, secret-free lifecycle trail for later owner reconciliation. */
export class CustomerManagedAiAuditStore {
  readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "customer-managed-ai-audit.jsonl");
  }

  record(event: CustomerManagedAiAuditEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

function configuredNumber(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
  return value;
}

export function loadManagedAiConfig(env: NodeJS.ProcessEnv = process.env): ManagedAiConfig {
  const enabled = env.ZENOD_MANAGED_AI_ENABLED === "1";
  const provisioningKey = env.OPENROUTER_PROVISIONING_KEY?.trim() || null;
  if (enabled && !provisioningKey) {
    throw new Error("ZENOD_MANAGED_AI_ENABLED=1 requires OPENROUTER_PROVISIONING_KEY");
  }
  const warnPercent = configuredNumber(env.ZENOD_MANAGED_AI_WARN_PERCENT, 80, "ZENOD_MANAGED_AI_WARN_PERCENT");
  if (warnPercent >= 100) throw new Error("ZENOD_MANAGED_AI_WARN_PERCENT must be below 100");
  return {
    enabled,
    provisioningKey,
    monthlyLimitUsd: configuredNumber(env.ZENOD_MANAGED_AI_LIMIT_USD, 2, "ZENOD_MANAGED_AI_LIMIT_USD"),
    warnPercent,
  };
}

async function openRouterRequest(
  provisioningKey: string,
  path: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://openrouter.ai/api/v1/keys${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${provisioningKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`OpenRouter key API returned non-JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(`OpenRouter key API failed (${response.status})`);
  return payload;
}

export function createOpenRouterManagedAiClient(provisioningKey: string): ManagedAiProviderClient {
  return {
    async listKeys() {
      return listGatewayKeys(provisioningKey);
    },
    async createKey(input) {
      const payload = await openRouterRequest(provisioningKey, "", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          limit: input.limit,
          limit_reset: input.limitReset,
          include_byok_in_limit: input.includeByokInLimit,
        }),
      });
      const data = payload.data && typeof payload.data === "object"
        ? payload.data as Record<string, unknown>
        : {};
      const key = typeof payload.key === "string" ? payload.key : null;
      const hash = typeof data.hash === "string" ? data.hash : null;
      if (!key || !hash) throw new Error("OpenRouter did not return the new child key and hash");
      return { key, hash, name: input.name, limit: input.limit, limitReset: input.limitReset };
    },
    async updateKey(hash, input) {
      await openRouterRequest(provisioningKey, `/${encodeURIComponent(hash)}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.limitReset !== undefined ? { limit_reset: input.limitReset } : {}),
          ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
          ...(input.includeByokInLimit !== undefined ? { include_byok_in_limit: input.includeByokInLimit } : {}),
        }),
      });
    },
  };
}

export class CustomerManagedAiLifecycle {
  private readonly inFlight = new Map<string, Promise<ManagedAiLifecycleOutcome>>();
  private readonly now: () => Date;

  constructor(private readonly options: ManagedAiLifecycleOptions) {
    this.now = options.now ?? (() => new Date());
  }

  ensureProvisioned(account: CustomerAccount): Promise<ManagedAiLifecycleOutcome> {
    return this.serialized(account.account_id, () => this.ensureProvisionedOnce(account));
  }

  setSubscriptionAccess(account: CustomerAccount, enabled: boolean): Promise<ManagedAiLifecycleOutcome> {
    return this.serialized(account.account_id, async () => {
      if (!this.options.config.enabled || !this.options.provider) return this.outcome("disabled", account, false);
      if (enabled && !account.managed_ai_key_hash) return this.ensureProvisionedOnce(account);
      const current = this.options.accounts.get(account.session_id) ?? account;
      const key = await this.resolveProviderKey(current);
      if (!key?.hash) {
        if (!enabled && !current.managed_ai_key_hash) {
          return this.outcome("suspended", current, false, null);
        }
        this.record(current, "orphaned", { managed_ai_error_code: "managed_ai_key_missing" });
        throw new Error("managed AI child key is missing");
      }
      const changed = key.disabled !== !enabled;
      if (changed) {
        await this.options.provider.updateKey(key.hash, { disabled: !enabled });
      }
      this.record(current, enabled ? "active" : "paused", {
        managed_ai_key_hash: key.hash,
        managed_ai_key_name: key.name,
        managed_ai_limit_usd: key.limit ?? current.managed_ai_limit_usd,
        managed_ai_error_code: null,
        managed_ai_last_reconciled_at: this.timestamp(),
      });
      return this.outcome(enabled ? "enabled" : "suspended", current, changed, key.hash);
    });
  }

  private async ensureProvisionedOnce(account: CustomerAccount): Promise<ManagedAiLifecycleOutcome> {
    if (!this.options.config.enabled || !this.options.provider) return this.outcome("disabled", account, false);
    const current = this.options.accounts.get(account.session_id) ?? account;
    if (!current.tenant_id || !current.tenant_slug) throw new Error("managed AI requires a bound tenant");
    const runtime = this.options.runtimeForAccount(current);
    if (!runtime) throw new Error("managed AI tenant runtime is unavailable");
    const expectedName = `${KEY_PREFIX}${current.tenant_slug}`;
    const existingSecret = runtime.settings.get("openrouter_api_key");
    const existingProviderKey = await this.resolveProviderKey(current);

    if (existingProviderKey) {
      if (!existingSecret) {
        this.record(current, "orphaned", {
          managed_ai_key_hash: existingProviderKey.hash,
          managed_ai_key_name: existingProviderKey.name,
          managed_ai_limit_usd: existingProviderKey.limit,
          managed_ai_error_code: "managed_ai_secret_unrecoverable",
          managed_ai_last_reconciled_at: this.timestamp(),
        });
        return this.outcome("orphaned", current, false, existingProviderKey.hash);
      }
      const needsPatch =
        existingProviderKey.limit !== this.options.config.monthlyLimitUsd ||
        existingProviderKey.limit_reset !== "monthly" ||
        existingProviderKey.include_byok_in_limit !== true ||
        existingProviderKey.disabled;
      if (!existingProviderKey.hash) throw new Error("managed AI child key has no safe provider identifier");
      if (needsPatch) {
        await this.options.provider.updateKey(existingProviderKey.hash, {
          limit: this.options.config.monthlyLimitUsd,
          limitReset: "monthly",
          includeByokInLimit: true,
          disabled: false,
        });
      }
      runtime.settings.set("provider", "openrouter");
      this.record(current, "active", {
        managed_ai_key_hash: existingProviderKey.hash,
        managed_ai_key_name: expectedName,
        managed_ai_limit_usd: this.options.config.monthlyLimitUsd,
        managed_ai_error_code: null,
        managed_ai_last_reconciled_at: this.timestamp(),
      });
      return this.outcome("already_provisioned", current, needsPatch, existingProviderKey.hash);
    }

    if (existingSecret || current.managed_ai_key_hash) {
      this.record(current, "orphaned", {
        managed_ai_error_code: "managed_ai_provider_binding_missing",
        managed_ai_last_reconciled_at: this.timestamp(),
      });
      return this.outcome("orphaned", current, false, current.managed_ai_key_hash);
    }

    this.record(current, "provisioning", {
      managed_ai_key_name: expectedName,
      managed_ai_limit_usd: this.options.config.monthlyLimitUsd,
      managed_ai_error_code: null,
    });
    const created = await this.options.provider.createKey({
      name: expectedName,
      limit: this.options.config.monthlyLimitUsd,
      limitReset: "monthly",
      includeByokInLimit: true,
    });
    try {
      runtime.settings.set("openrouter_api_key", created.key);
      runtime.settings.set("provider", "openrouter");
      this.record(current, "active", {
        managed_ai_key_hash: created.hash,
        managed_ai_key_name: created.name,
        managed_ai_limit_usd: created.limit,
        managed_ai_error_code: null,
        managed_ai_last_reconciled_at: this.timestamp(),
      });
    } catch (error) {
      this.record(current, "orphaned", {
        managed_ai_key_hash: created.hash,
        managed_ai_key_name: created.name,
        managed_ai_limit_usd: created.limit,
        managed_ai_error_code: "managed_ai_secret_custody_failed",
      });
      throw error;
    }
    return this.outcome("provisioned", current, true, created.hash);
  }

  private async resolveProviderKey(account: CustomerAccount): Promise<GatewayKeyUsage | null> {
    if (!this.options.provider || !account.tenant_slug) return null;
    const keys = await this.options.provider.listKeys();
    if (account.managed_ai_key_hash) {
      const exact = keys.find((key) => key.hash === account.managed_ai_key_hash);
      if (exact) return exact;
    }
    return keys.find((key) => key.slug === account.tenant_slug) ?? null;
  }

  private record(
    account: CustomerAccount,
    status: CustomerAccount["managed_ai_status"],
    patch: Partial<CustomerAccount>,
  ): CustomerAccount {
    const updated = this.options.accounts.upsert(account.session_id, {
      ...patch,
      managed_ai_status: status,
      managed_ai_updated_at: this.timestamp(),
    });
    this.options.audit?.record({
      ts: updated.managed_ai_updated_at!,
      accountId: updated.account_id,
      tenantId: updated.tenant_id,
      state: updated.managed_ai_status,
      keyHash: updated.managed_ai_key_hash,
      limitUsd: updated.managed_ai_limit_usd,
      errorCode: updated.managed_ai_error_code,
    });
    return updated;
  }

  private outcome(
    state: ManagedAiLifecycleState,
    account: CustomerAccount,
    changed: boolean,
    keyHash = account.managed_ai_key_hash,
  ): ManagedAiLifecycleOutcome {
    return { state, accountId: account.account_id, keyHash, changed };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private serialized(
    accountId: string,
    operation: () => Promise<ManagedAiLifecycleOutcome>,
  ): Promise<ManagedAiLifecycleOutcome> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;
    const pending = operation().finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, pending);
    return pending;
  }
}

/** Read-only helper for diagnostics that need the existing OpenRouter list path. */
export async function managedAiKeyForAccount(
  provisioningKey: string,
  account: CustomerAccount,
): Promise<GatewayKeyUsage | null> {
  return account.tenant_slug ? gatewayKeyForSlug(provisioningKey, account.tenant_slug) : null;
}
