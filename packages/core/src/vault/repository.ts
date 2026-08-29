import type { FileChange } from "./immutability.js";

/** Durable vault authority selected for a tenant. */
export type VaultProvider = "github" | "google_drive";

/**
 * Provider-neutral durable publication identity.
 *
 * GitHub adapters populate both compatibility fields during the migration window.
 * Drive adapters may include commitSha only when it names a real commit in the
 * durable Drive Git bundle; revision.id remains the independent Drive authority.
 * Drive adapters never populate githubUrls.
 */
export interface VaultRevision {
  provider: VaultProvider;
  id: string;
  committedAt: string;
  urls: string[];
  /** Optional real Git commit stored by the provider; never derive it from id. */
  commitSha?: string;
  /** GitHub web compatibility URLs; never populated by Drive authority. */
  githubUrls?: string[];
}

/** Provider-neutral source/citation returned by vault reads. */
export interface VaultSourceRef {
  /** Vault-relative path, optionally followed by a block anchor. */
  path: string;
  /** Canonical provider URL for this source, when the backend can expose one. */
  url: string;
  provider: VaultProvider;
  /** Durable revision that was used to resolve the source, when known. */
  revisionId?: string;
  /** GitHub compatibility field. Never populated by a Drive backend. */
  githubUrl?: string;
}

/** A source used to ground an answer; kept named separately for public schemas. */
export type VaultCitation = VaultSourceRef;

/**
 * Repository-shaped boundary used by the existing local Markdown workflow.
 * Implementations own remote synchronization and publication semantics only.
 */
export interface VaultRepository {
  readonly path: string;
  readonly provider: VaultProvider;

  pull(): Promise<void>;
  /** Return the durable revision currently materialized in the local workspace. */
  currentRevision(): Promise<VaultRevision>;
  trackedFiles(): Promise<string[]>;
  contentAtHead(path: string): Promise<string | null>;
  pendingChanges(): Promise<FileChange[]>;
  discardChanges(): Promise<void>;
  commitAndPublish(message: string): Promise<VaultRevision>;
  urlFor(path: string, anchor?: string): string | null;
}

const GITHUB_HOST_FAMILIES = ["github.com", "githubusercontent.com"] as const;

function isHostInFamily(hostname: string, family: string): boolean {
  return hostname === family || hostname.endsWith(`.${family}`);
}

/** Fail closed when a provider boundary returns a URL owned by another provider. */
export function assertVaultProviderUrl(provider: VaultProvider, value: string): void {
  if (!value || provider !== "google_drive") return;

  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error(`invalid ${provider} vault URL`);
  }

  if (GITHUB_HOST_FAMILIES.some((family) => isHostInFamily(hostname, family))) {
    throw new Error("Google Drive vault URL must not reference a GitHub host");
  }
}

export type VaultPublicationFailure =
  | {
      code: "failed_before_write";
      message: string;
      retryable: boolean;
    }
  | {
      code: "conflict";
      message: string;
      retryable: false;
      transactionId: string;
      paths: string[];
    }
  | {
      code: "authorization_revoked";
      message: string;
      retryable: false;
    }
  | {
      code: "partial_recovering";
      message: string;
      retryable: true;
      transactionId: string;
      appliedPaths: string[];
      pendingPaths: string[];
    }
  | {
      code: "terminal_failure";
      message: string;
      retryable: false;
      transactionId?: string;
      appliedPaths: string[];
    };

export type VaultPublicationOutcome =
  | { status: "published"; revision: VaultRevision }
  | { status: "failed"; failure: VaultPublicationFailure };

/** Typed publication failure thrown instead of returning a false-success revision. */
export class VaultPublicationError extends Error {
  readonly failure: VaultPublicationFailure;

  constructor(failure: VaultPublicationFailure) {
    super(failure.message);
    this.name = "VaultPublicationError";
    this.failure = failure;
  }
}

/** Construct the compatibility-complete revision returned by the GitHub adapter. */
export function githubVaultRevision(input: {
  commitSha: string;
  committedAt: string;
  githubUrls: string[];
}): VaultRevision {
  return {
    provider: "github",
    id: input.commitSha,
    committedAt: input.committedAt,
    urls: [...input.githubUrls],
    commitSha: input.commitSha,
    githubUrls: [...input.githubUrls],
  };
}
