import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { customerUserId } from "./customerIdentity.js";
import type {
  VaultBindingStatus,
  VaultProviderBindingRecord,
} from "./googleDriveVaultContract.js";
import type { VaultProvider } from "zenod";

// Transplanted from zenod-ai/cloud services/webhook/src/accounts.ts @ 6bdb318.
// Legacy Dokploy, watchdog, claim-link, and per-tenant DNS fields are intentionally
// absent. Z-N3 owns the local tenant-row binding behind checkout completion.

export interface CustomerAccount {
  session_id: string;
  account_id: string;
  /** Internal provider-neutral owner. Legacy rows derive this on read/write. */
  user_id: string;
  product: string;
  tier: string | null;
  stripe_email: string | null;
  stripe_client_reference_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: "checkout_pending" | "active" | "past_due" | "paused" | "canceled" | null;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  github_id: number | null;
  github_login: string | null;
  github_email: string | null;
  claimed_at: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  mcp_url: string | null;
  mcp_token: string | null;
  vault_repo: string | null;
  vault_repo_url: string | null;
  /** One authoritative vault backend. Null preserves the pre-GDV legacy GitHub path until explicitly selected. */
  vault_provider: VaultProvider | null;
  vault_binding_id: string | null;
  vault_binding_status: VaultBindingStatus | null;
  vault_branch: string | null;
  vault_drive_folder_id: string | null;
  vault_drive_manifest_file_id: string | null;
  vault_binding_created_at: string | null;
  vault_binding_updated_at: string | null;
  /** Monotonic credential generation fencing stale Drive clients after reconnect. */
  vault_authorization_epoch: number;
  checkout_completed_at: string | null;
  /** Safe OpenRouter child-key metadata. The inference key itself lives only in the tenant credential vault. */
  managed_ai_key_hash: string | null;
  managed_ai_key_name: string | null;
  managed_ai_limit_usd: number | null;
  managed_ai_limit_override_usd: number | null;
  managed_ai_status: "unconfigured" | "provisioning" | "active" | "warn" | "paused" | "unavailable" | "orphaned";
  managed_ai_updated_at: string | null;
  managed_ai_last_reconciled_at: string | null;
  managed_ai_error_code: string | null;
}

type Store = Record<string, CustomerAccount>;

export interface CustomerAccountOwnership {
  ownerForAccount(accountId: string): string | null;
  resolveUser(userId: string): unknown | null;
  bindAccount(userId: string, accountId: string): unknown;
}

export class CustomerAccountStore {
  readonly path: string;

  constructor(
    dataDir: string,
    private readonly product = "zenod",
    private readonly ownership?: CustomerAccountOwnership,
  ) {
    const suffix = product === "zenod" ? "" : `-${product}`;
    this.path = join(dataDir, `customer-accounts${suffix}.json`);
  }

  private load(): Store {
    if (!existsSync(this.path)) return {};
    try {
      const store = JSON.parse(readFileSync(this.path, "utf8")) as Store;
      for (const account of Object.values(store)) {
        if (!account.user_id && Number.isSafeInteger(account.github_id) && account.github_id! > 0) {
          account.user_id = customerUserId("github", String(account.github_id));
        }
      }
      return store;
    } catch (error) {
      throw new Error(`customer account store is unreadable: ${this.path}`, { cause: error });
    }
  }

  private save(store: Store): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const pendingPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(pendingPath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(pendingPath, this.path);
  }

  get(sessionId: string): CustomerAccount | null {
    return this.load()[sessionId] ?? null;
  }

  upsert(sessionId: string, patch: Partial<CustomerAccount>): CustomerAccount {
    const store = this.load();
    const existing = store[sessionId];
    if (existing) {
      if (patch.account_id !== undefined && patch.account_id !== existing.account_id) {
        throw new Error("account_id cannot change for an existing customer account");
      }
      if (patch.user_id !== undefined && patch.user_id !== existing.user_id) {
        throw new Error("user_id cannot change for an existing customer account");
      }
      if (patch.github_id !== undefined && patch.github_id !== existing.github_id) {
        throw new Error("github_id cannot change for an existing customer account");
      }
      if (patch.github_login !== undefined && patch.github_login !== existing.github_login) {
        throw new Error("github_login cannot change for an existing customer account");
      }
    }
    const required = patch as Pick<CustomerAccount, "account_id">;
    const legacyGithubId = existing?.github_id ?? patch.github_id ?? null;
    const userId = existing?.user_id ?? patch.user_id ?? (
      Number.isSafeInteger(legacyGithubId) && legacyGithubId! > 0
        ? customerUserId("github", String(legacyGithubId))
        : null
    );
    const next: CustomerAccount = {
      account_id: existing?.account_id ?? required.account_id,
      user_id: userId ?? "",
      product: this.product,
      tier: null,
      stripe_email: null,
      stripe_client_reference_id: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: null,
      cancel_at_period_end: false,
      current_period_start: null,
      current_period_end: null,
      github_id: legacyGithubId,
      github_login: existing?.github_login ?? patch.github_login ?? null,
      github_email: null,
      claimed_at: existing?.claimed_at ?? new Date().toISOString(),
      tenant_id: null,
      tenant_slug: null,
      mcp_url: null,
      mcp_token: null,
      vault_repo: null,
      vault_repo_url: null,
      vault_provider: null,
      vault_binding_id: null,
      vault_binding_status: null,
      vault_branch: null,
      vault_drive_folder_id: null,
      vault_drive_manifest_file_id: null,
      vault_binding_created_at: null,
      vault_binding_updated_at: null,
      vault_authorization_epoch: 0,
      checkout_completed_at: null,
      managed_ai_key_hash: null,
      managed_ai_key_name: null,
      managed_ai_limit_usd: null,
      managed_ai_limit_override_usd: null,
      managed_ai_status: "unconfigured",
      managed_ai_updated_at: null,
      managed_ai_last_reconciled_at: null,
      managed_ai_error_code: null,
      ...existing,
      ...patch,
      session_id: sessionId,
    };
    if (!next.account_id || !next.user_id) {
      throw new Error("account_id and user_id are required");
    }
    const patches = (field: keyof CustomerAccount): boolean => Object.prototype.hasOwnProperty.call(patch, field);
    if (existing?.tenant_id != null && patches("tenant_id") && patch.tenant_id !== existing.tenant_id) {
      throw new Error("tenant_id cannot change or become null after tenant assignment");
    }
    if (existing?.vault_provider != null && patches("vault_provider") && patch.vault_provider !== existing.vault_provider) {
      throw new Error("authoritative vault_provider cannot change without an explicit migration");
    }
    if (existing?.vault_binding_id != null && patches("vault_binding_id") && patch.vault_binding_id !== existing.vault_binding_id) {
      throw new Error("authoritative vault_binding_id cannot change");
    }
    for (const field of ["vault_drive_folder_id", "vault_drive_manifest_file_id"] as const) {
      if (existing?.[field] != null && patches(field) && patch[field] !== existing[field]) {
        throw new Error(`authoritative ${field} cannot change`);
      }
    }
    const existingEpoch = existing?.vault_authorization_epoch ?? 0;
    if (
      patches("vault_authorization_epoch") &&
      (!Number.isSafeInteger(patch.vault_authorization_epoch) || patch.vault_authorization_epoch! < existingEpoch)
    ) {
      throw new Error("vault_authorization_epoch cannot decrease or become invalid");
    }
    if (next.vault_provider && (!next.vault_binding_id || !next.tenant_id || !next.vault_binding_status)) {
      throw new Error("authoritative vault binding is incomplete");
    }
    store[sessionId] = next;
    this.save(store);
    return next;
  }

  resolveForUser(userId: string | number): CustomerAccount | null {
    const internalUserId = typeof userId === "number" ? customerUserId("github", String(userId)) : userId;
    const accounts = Object.values(this.load()).filter((account) => this.isOwnedBy(account, internalUserId));
    const completed = accounts.filter((account) => account.subscription_status !== "checkout_pending");
    return (completed.length > 0 ? completed : accounts)
      .sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))[0] ?? null;
  }

  resolveForSubscription(subscriptionId: string): CustomerAccount | null {
    if (!subscriptionId) return null;
    const matches = Object.values(this.load()).filter(
      (account) => account.stripe_subscription_id === subscriptionId,
    );
    return matches.sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))[0] ?? null;
  }

  resolveForAccountId(accountId: string): CustomerAccount | null {
    if (!accountId) return null;
    const matches = Object.values(this.load()).filter((account) => account.account_id === accountId);
    return matches.sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))[0] ?? null;
  }

  resolveForTenantId(tenantId: string): CustomerAccount | null {
    return this.resolveVaultAuthorityForTenantId(tenantId)?.account ?? null;
  }

  /** Resolve a tenant-wide vault authority without letting a newer session row hide an older binding. */
  resolveVaultAuthorityForTenantId(
    tenantId: string,
  ): { account: CustomerAccount; binding: VaultProviderBindingRecord | null } | null {
    if (!tenantId) return null;
    const matches = Object.values(this.load())
      .filter((account) => account.tenant_id === tenantId)
      .sort((a, b) => b.claimed_at.localeCompare(a.claimed_at));
    if (matches.length === 0) return null;
    const bound = matches.flatMap((account) => {
      const binding = customerVaultBinding(account);
      return binding ? [{ account, binding }] : [];
    });
    if (bound.length === 0) return { account: matches[0]!, binding: null };
    const expected = JSON.stringify(bound[0]!.binding);
    if (bound.some(({ binding }) => JSON.stringify(binding) !== expected)) {
      throw new Error("tenant has inconsistent authoritative vault bindings");
    }
    return bound[0]!;
  }

  resolveForStripeCustomer(customerId: string): CustomerAccount | null {
    if (!customerId) return null;
    const matches = Object.values(this.load()).filter(
      (account) => account.stripe_customer_id === customerId,
    );
    return matches.sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))[0] ?? null;
  }

  resolveActiveTenantForUser(userId: string | number): CustomerAccount | null {
    const internalUserId = typeof userId === "number" ? customerUserId("github", String(userId)) : userId;
    const latestByTenant = new Map<string, CustomerAccount>();
    for (const account of Object.values(this.load()).sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))) {
      if (!this.isOwnedBy(account, internalUserId) || !account.tenant_id || account.subscription_status === "checkout_pending") continue;
      if (!latestByTenant.has(account.tenant_id)) latestByTenant.set(account.tenant_id, account);
    }
    const active = [...latestByTenant.values()].filter(
      (account) => account.subscription_status === "active" || account.subscription_status === "past_due",
    );
    if (active.length !== 1) return null;
    const selected = active[0]!;
    const authority = this.resolveVaultAuthorityForTenantId(selected.tenant_id!);
    if (
      authority &&
      (authority.account.account_id !== selected.account_id || authority.account.user_id !== selected.user_id)
    ) return null;
    return authority?.account ?? selected;
  }

  list(): CustomerAccount[] {
    return Object.values(this.load());
  }

  private isOwnedBy(account: CustomerAccount, userId: string): boolean {
    const recordedOwner = this.ownership?.ownerForAccount(account.account_id);
    if (recordedOwner) return recordedOwner === userId;
    if (account.user_id !== userId) return false;
    // Lazy migration is written only after the identity itself exists. A
    // rollback reader with no identity projection still uses the legacy row.
    if (this.ownership?.resolveUser(userId)) this.ownership.bindAccount(userId, account.account_id);
    return true;
  }
}

/** Project the flattened compatibility account row into the provider-neutral runtime contract. */
export function customerVaultBinding(account: CustomerAccount): VaultProviderBindingRecord | null {
  if (!account.vault_provider) {
    if (
      account.vault_binding_id ||
      account.vault_binding_status ||
      account.vault_branch ||
      account.vault_drive_folder_id ||
      account.vault_drive_manifest_file_id ||
      account.vault_binding_created_at ||
      account.vault_binding_updated_at ||
      (account.vault_authorization_epoch ?? 0) !== 0
    ) {
      throw new Error("authoritative vault binding is incomplete");
    }
    return null;
  }
  if (
    !account.tenant_id ||
    !account.vault_binding_id ||
    !account.vault_binding_status ||
    !account.vault_binding_created_at ||
    !account.vault_binding_updated_at
  ) {
    throw new Error("authoritative vault binding is incomplete");
  }
  const base = {
    binding_id: account.vault_binding_id,
    tenant_id: account.tenant_id,
    status: account.vault_binding_status,
    created_at: account.vault_binding_created_at,
    updated_at: account.vault_binding_updated_at,
    authorization_epoch: account.vault_authorization_epoch ?? 0,
  };
  return account.vault_provider === "github"
    ? {
        ...base,
        provider: "github",
        repo: account.vault_repo,
        branch: account.vault_branch,
      }
    : {
        ...base,
        provider: "google_drive",
        folder_id: account.vault_drive_folder_id,
        manifest_file_id: account.vault_drive_manifest_file_id,
      };
}

export function customerAccountId(githubId: number): string {
  return `github-${githubId}`;
}

/** Preserve legacy GitHub IDs; provider-neutral customers use their internal ID. */
export function customerAccountIdForUser(user: {
  user_id: string;
}): string {
  return `user-${user.user_id}`;
}
