import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Transplanted from zenod-ai/cloud services/webhook/src/accounts.ts @ 6bdb318.
// Legacy Dokploy, watchdog, claim-link, and per-tenant DNS fields are intentionally
// absent. Z-N3 owns the local tenant-row binding behind checkout completion.

export interface CustomerAccount {
  session_id: string;
  account_id: string;
  product: string;
  tier: string | null;
  stripe_email: string | null;
  stripe_client_reference_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: "checkout_pending" | "active" | "canceled" | null;
  github_id: number;
  github_login: string;
  github_email: string | null;
  claimed_at: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  mcp_url: string | null;
  mcp_token: string | null;
  vault_repo: string | null;
  vault_repo_url: string | null;
  checkout_completed_at: string | null;
}

type Store = Record<string, CustomerAccount>;

export class CustomerAccountStore {
  readonly path: string;

  constructor(
    dataDir: string,
    private readonly product = "zenod",
  ) {
    const suffix = product === "zenod" ? "" : `-${product}`;
    this.path = join(dataDir, `customer-accounts${suffix}.json`);
  }

  private load(): Store {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Store;
    } catch {
      return {};
    }
  }

  private save(store: Store): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(store, null, 2), "utf8");
  }

  get(sessionId: string): CustomerAccount | null {
    return this.load()[sessionId] ?? null;
  }

  upsert(sessionId: string, patch: Partial<CustomerAccount>): CustomerAccount {
    const store = this.load();
    const existing = store[sessionId];
    const required = patch as Pick<CustomerAccount, "account_id" | "github_id" | "github_login">;
    const next: CustomerAccount = {
      account_id: existing?.account_id ?? required.account_id,
      product: this.product,
      tier: null,
      stripe_email: null,
      stripe_client_reference_id: null,
      stripe_subscription_id: null,
      subscription_status: null,
      github_id: existing?.github_id ?? required.github_id,
      github_login: existing?.github_login ?? required.github_login,
      github_email: null,
      claimed_at: existing?.claimed_at ?? new Date().toISOString(),
      tenant_id: null,
      tenant_slug: null,
      mcp_url: null,
      mcp_token: null,
      vault_repo: null,
      vault_repo_url: null,
      checkout_completed_at: null,
      ...existing,
      ...patch,
      session_id: sessionId,
    };
    if (!next.account_id || !next.github_id || !next.github_login) {
      throw new Error("account_id, github_id, and github_login are required");
    }
    store[sessionId] = next;
    this.save(store);
    return next;
  }

  resolveForUser(githubId: number): CustomerAccount | null {
    const accounts = Object.values(this.load()).filter((account) => account.github_id === githubId);
    return accounts.sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))[0] ?? null;
  }

  resolveActiveTenantForUser(githubId: number): CustomerAccount | null {
    const latestByTenant = new Map<string, CustomerAccount>();
    for (const account of Object.values(this.load()).sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))) {
      if (account.github_id !== githubId || !account.tenant_id || account.subscription_status === "checkout_pending") continue;
      if (!latestByTenant.has(account.tenant_id)) latestByTenant.set(account.tenant_id, account);
    }
    const active = [...latestByTenant.values()].filter((account) => account.subscription_status === "active");
    return active.length === 1 ? active[0]! : null;
  }

  list(): CustomerAccount[] {
    return Object.values(this.load());
  }
}

export function customerAccountId(githubId: number): string {
  return `github-${githubId}`;
}
