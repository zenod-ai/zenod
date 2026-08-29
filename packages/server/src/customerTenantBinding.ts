import { generateTenantToken, SqliteTenantStore, type TenantProvisioningStore } from "@zenod/mcp-chassis";
import type Stripe from "stripe";
import { CustomerAccountStore, type CustomerAccount } from "./customerAccounts.js";
import { CustomerTokenVault } from "./customerTokenVault.js";

export interface LocalTenantBindingOptions {
  dataDir: string;
  accounts: CustomerAccountStore;
  tenantStore?: TenantProvisioningStore;
  tokenVault: CustomerTokenVault;
}

function tenantSlug(displayName: string, stableSuffix: string): string {
  const loginSlug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "customer";
  return `${loginSlug}-${stableSuffix}`;
}

function priorTenantBinding(accounts: CustomerAccountStore, account: CustomerAccount): CustomerAccount | null {
  return (
    accounts
      .list()
      .filter(
        (candidate) =>
          candidate.session_id !== account.session_id &&
          candidate.user_id === account.user_id &&
          candidate.tenant_id &&
          candidate.tenant_slug,
      )
      .sort((a, b) => b.claimed_at.localeCompare(a.claimed_at))[0] ?? null
  );
}

function reserveBinding(
  accounts: CustomerAccountStore,
  account: CustomerAccount,
  tokenVault: CustomerTokenVault,
): CustomerAccount {
  const current = accounts.get(account.session_id);
  if (!current || current.account_id !== account.account_id || current.user_id !== account.user_id) {
    throw new Error("checkout account changed before tenant binding");
  }

  const prior = priorTenantBinding(accounts, current);
  const tenantId = current.account_id;
  const displayName = current.github_login ?? current.user_id;
  const suffix = current.github_id ? String(current.github_id) : current.user_id.slice(-8);
  const slug = current.tenant_slug ?? prior?.tenant_slug ?? tenantSlug(displayName, suffix);
  if (!tokenVault.get(current.account_id)) tokenVault.put(current.account_id, generateTenantToken());

  return accounts.upsert(current.session_id, {
    tenant_id: tenantId,
    tenant_slug: slug,
    mcp_url: null,
    mcp_token: null,
  });
}

export function createLocalTenantBindingAdapter(options: LocalTenantBindingOptions) {
  return async (account: CustomerAccount, session: Stripe.Checkout.Session): Promise<void> => {
    if (session.client_reference_id !== account.account_id || session.metadata?.account_id !== account.account_id) {
      throw new Error("checkout account binding mismatch");
    }

    const reserved = reserveBinding(options.accounts, account, options.tokenVault);
    const token = options.tokenVault.get(reserved.account_id);
    if (!reserved.tenant_id || !token) throw new Error("tenant binding reservation failed");

    const store = options.tenantStore ?? new SqliteTenantStore({ dataDir: options.dataDir });
    const ownsStore = !options.tenantStore;
    try {
      const provisioned = await store.provisionTenant({
        tenantId: reserved.tenant_id,
        name: reserved.github_login ?? reserved.user_id,
        plan: reserved.tier ?? "hosted",
        token,
        status: "active",
      });
      if (provisioned.token !== token || provisioned.record.tenant.id !== reserved.tenant_id) {
        throw new Error("tenant store returned an unexpected token binding");
      }
      options.accounts.upsert(reserved.session_id, {
        tenant_id: provisioned.record.tenant.id,
        tenant_slug: reserved.tenant_slug,
        mcp_url: null,
        mcp_token: null,
      });
    } finally {
      if (ownsStore && "close" in store && typeof store.close === "function") store.close();
    }
  };
}
