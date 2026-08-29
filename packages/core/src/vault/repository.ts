import type { FileChange } from "./immutability.js";

/** Durable vault authority selected for a tenant. */
export type VaultProvider = "github" | "google_drive";

/**
 * Provider-neutral durable publication identity.
 *
 * GitHub adapters populate the legacy fields during the compatibility window.
 * Drive adapters must not fabricate them.
 */
export interface VaultRevision {
  provider: VaultProvider;
  id: string;
  committedAt: string;
  urls: string[];
  commitSha?: string;
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
  trackedFiles(): Promise<string[]>;
  contentAtHead(path: string): Promise<string | null>;
  pendingChanges(): Promise<FileChange[]>;
  discardChanges(): Promise<void>;
  commitAndPublish(message: string): Promise<VaultRevision>;
  urlFor(path: string, anchor?: string): string | null;
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
