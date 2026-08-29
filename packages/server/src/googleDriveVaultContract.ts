import type { VaultProvider } from "zenod";

export const PROVIDER_NEUTRAL_CUSTOMER_SCHEMA_VERSION = 1 as const;

export type CustomerIdentityProvider = "github" | "google";

export interface CustomerUserRecord {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface CustomerIdentityRecord {
  user_id: string;
  provider: CustomerIdentityProvider;
  /** GitHub numeric ID rendered as text, or Google OIDC `sub`. Never email. */
  provider_subject: string;
  /** Provider-scoped presentation handle; GitHub login for GitHub identities. */
  provider_login?: string | null;
  email: string | null;
  email_verified: boolean;
  created_at: string;
}

/** Stable ownership join; account_id remains the existing billing/customer key. */
export interface CustomerAccountOwnerRecord {
  user_id: string;
  account_id: string;
  created_at: string;
}

export type VaultBindingStatus =
  | "authorizing"
  | "ready"
  | "recovering"
  | "conflict"
  | "revoked"
  | "error";

interface VaultProviderBindingBase {
  binding_id: string;
  tenant_id: string;
  status: VaultBindingStatus;
  created_at: string;
  updated_at: string;
}

export interface GithubVaultProviderBindingRecord extends VaultProviderBindingBase {
  provider: "github";
  repo: string | null;
  branch: string | null;
}

export interface GoogleDriveVaultProviderBindingRecord extends VaultProviderBindingBase {
  provider: "google_drive";
  folder_id: string | null;
  manifest_file_id: string | null;
}

/** One row per tenant; the tenant_id uniqueness invariant prevents dual-write. */
export type VaultProviderBindingRecord =
  | GithubVaultProviderBindingRecord
  | GoogleDriveVaultProviderBindingRecord;

export interface ProviderNeutralCustomerSnapshot {
  schema_version: typeof PROVIDER_NEUTRAL_CUSTOMER_SCHEMA_VERSION;
  users: CustomerUserRecord[];
  identities: CustomerIdentityRecord[];
  account_owners: CustomerAccountOwnerRecord[];
  vault_bindings: VaultProviderBindingRecord[];
}

/** External identifiers that GDV migrations are forbidden to rename or rotate. */
export interface FrozenLegacyCustomerIdentifiers {
  account_id: string;
  session_id: string;
  tenant_id: string | null;
  stripe_client_reference_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  mcp_url: string | null;
  mcp_token: string | null;
  github_id: number;
  github_login: string;
  vault_repo: string | null;
  vault_repo_url: string | null;
}

export const FROZEN_LEGACY_CUSTOMER_IDENTIFIER_FIELDS = [
  "account_id",
  "session_id",
  "tenant_id",
  "stripe_client_reference_id",
  "stripe_customer_id",
  "stripe_subscription_id",
  "mcp_url",
  "mcp_token",
  "github_id",
  "github_login",
  "vault_repo",
  "vault_repo_url",
] as const satisfies readonly (keyof FrozenLegacyCustomerIdentifiers)[];

export function customerIdentityKey(
  identity: Pick<CustomerIdentityRecord, "provider" | "provider_subject">,
): string {
  if (!identity.provider_subject.trim()) throw new Error("provider_subject is required");
  return `${identity.provider}:${identity.provider_subject}`;
}

/** Guard used by migration code before it persists a provider-neutral projection. */
export function assertLegacyCustomerIdentifiersFrozen(
  before: FrozenLegacyCustomerIdentifiers,
  after: FrozenLegacyCustomerIdentifiers,
): void {
  for (const field of FROZEN_LEGACY_CUSTOMER_IDENTIFIER_FIELDS) {
    if (before[field] !== after[field]) {
      throw new Error(`provider-neutral migration cannot change legacy identifier ${field}`);
    }
  }
}

/** Validate uniqueness and referential invariants without selecting a persistence engine. */
export function assertProviderNeutralCustomerSnapshot(snapshot: ProviderNeutralCustomerSnapshot): void {
  if (snapshot.schema_version !== PROVIDER_NEUTRAL_CUSTOMER_SCHEMA_VERSION) {
    throw new Error(`unsupported provider-neutral customer schema version ${snapshot.schema_version}`);
  }

  const userIds = unique(snapshot.users.map((record) => record.user_id), "user_id");
  unique(snapshot.identities.map(customerIdentityKey), "provider identity");
  unique(snapshot.account_owners.map((record) => record.account_id), "account_id ownership");
  unique(snapshot.vault_bindings.map((record) => record.binding_id), "vault binding_id");
  unique(snapshot.vault_bindings.map((record) => record.tenant_id), "authoritative vault tenant_id");

  for (const identity of snapshot.identities) {
    if (!userIds.has(identity.user_id)) throw new Error(`identity references unknown user ${identity.user_id}`);
  }
  for (const owner of snapshot.account_owners) {
    if (!userIds.has(owner.user_id)) throw new Error(`account owner references unknown user ${owner.user_id}`);
  }
  for (const binding of snapshot.vault_bindings) {
    if (!binding.tenant_id || !binding.binding_id) throw new Error("vault binding identity is incomplete");
    if (binding.status !== "authorizing" && binding.provider === "github" && (!binding.repo || !binding.branch)) {
      throw new Error("GitHub vault binding requires repo and branch");
    }
    if (binding.status !== "authorizing" && binding.provider === "google_drive" && !binding.folder_id) {
      throw new Error("Google Drive vault binding requires folder_id");
    }
    if (binding.status === "ready" && binding.provider === "google_drive" && !binding.manifest_file_id) {
      throw new Error("Ready Google Drive vault binding requires manifest_file_id");
    }
  }
}

function unique(values: string[], label: string): Set<string> {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) throw new Error(`${label} must be non-empty and unique`);
    seen.add(value);
  }
  return seen;
}

export type VaultMemoryCapability = "store" | "search" | "get" | "ask" | "attachments";

export interface VaultCapabilityProjection {
  provider: VaultProvider | null;
  ready: boolean;
  memory: Record<VaultMemoryCapability, boolean>;
  githubTasking: boolean;
  blocker: "vault_not_selected" | "vault_authorization_required" | "vault_recovering" | "vault_conflict" | "vault_error" | null;
}

/**
 * Fail-closed readiness projection shared by onboarding and runtime gates.
 * GitHub tasking is an independent connection capability, never implied by a
 * Drive vault or required for memory readiness.
 */
export function projectVaultCapabilities(input: {
  binding: VaultProviderBindingRecord | null;
  githubConnectionReady: boolean;
}): VaultCapabilityProjection {
  const status = input.binding?.status;
  const configured = input.binding?.provider === "github"
    ? Boolean(input.binding.repo && input.binding.branch)
    : input.binding?.provider === "google_drive"
      ? Boolean(input.binding.folder_id && input.binding.manifest_file_id)
      : false;
  const ready = status === "ready" && configured;
  const memory = {
    store: ready,
    search: ready,
    get: ready,
    ask: ready,
    attachments: ready,
  };
  const blocker = !input.binding
    ? "vault_not_selected"
    : status === "authorizing" || status === "revoked"
      ? "vault_authorization_required"
      : status === "recovering"
        ? "vault_recovering"
        : status === "conflict"
          ? "vault_conflict"
          : status === "error"
            ? "vault_error"
            : status === "ready" && !configured
              ? "vault_error"
            : null;
  return {
    provider: input.binding?.provider ?? null,
    ready,
    memory,
    githubTasking: input.githubConnectionReady,
    blocker,
  };
}
