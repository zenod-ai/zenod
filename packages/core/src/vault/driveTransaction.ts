/** Durable states for a Drive multi-file publication. */
export type DriveTransactionState =
  | "prepared"
  | "applying"
  | "recovering"
  | "committed"
  | "conflict"
  | "failed";

export type DriveMutationKind = "create" | "update" | "move" | "delete";
export type DriveMutationState = "pending" | "applied" | "conflict" | "failed";

/** Remote values captured before mutation and checked immediately before saving. */
export interface DriveFilePrecondition {
  fileId?: string;
  expectedVersion?: string;
  expectedModifiedTime?: string;
  expectedChecksum?: string;
  mustNotExist?: boolean;
}

export interface DriveTransactionMutation {
  operationId: string;
  kind: DriveMutationKind;
  path: string;
  destinationPath?: string;
  precondition: DriveFilePrecondition;
  state: DriveMutationState;
  resultingFileId?: string;
  resultingVersion?: string;
  errorCode?: string;
}

/**
 * Durable journal entry written before the first Drive mutation.
 * `tenantId` and `vaultBindingId` are part of the idempotency boundary.
 */
export interface DriveVaultTransaction {
  schemaVersion: 1;
  transactionId: string;
  tenantId: string;
  vaultBindingId: string;
  idempotencyKey: string;
  intentDigest: string;
  baseManifestVersion: string | null;
  state: DriveTransactionState;
  mutations: DriveTransactionMutation[];
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  conflictPaths?: string[];
  terminalErrorCode?: string;
}

export function driveTransactionIdempotencyScope(
  transaction: Pick<DriveVaultTransaction, "tenantId" | "vaultBindingId" | "idempotencyKey">,
): string {
  return JSON.stringify([transaction.tenantId, transaction.vaultBindingId, transaction.idempotencyKey]);
}

/** The same scoped key may be replayed only for the exact same publication intent. */
export function assertDriveIdempotentReplay(
  existing: Pick<DriveVaultTransaction, "tenantId" | "vaultBindingId" | "idempotencyKey" | "intentDigest">,
  replay: Pick<DriveVaultTransaction, "tenantId" | "vaultBindingId" | "idempotencyKey" | "intentDigest">,
): void {
  if (driveTransactionIdempotencyScope(existing) !== driveTransactionIdempotencyScope(replay)) {
    throw new Error("Drive replay does not address the existing transaction scope");
  }
  if (existing.intentDigest !== replay.intentDigest) {
    throw new Error("Drive idempotency key cannot be reused for a different publication intent");
  }
}

/** Enforce the state invariants every journal writer and recovery loop must preserve. */
export function assertDriveTransactionInvariant(transaction: DriveVaultTransaction): void {
  if (!transaction.transactionId || !transaction.tenantId || !transaction.vaultBindingId) {
    throw new Error("Drive transaction identity is incomplete");
  }
  if (!transaction.idempotencyKey || !transaction.intentDigest) {
    throw new Error("Drive transaction idempotency contract is incomplete");
  }
  const operationIds = new Set<string>();
  for (const mutation of transaction.mutations) {
    if (!mutation.operationId || operationIds.has(mutation.operationId)) {
      throw new Error("Drive transaction mutation operation IDs must be non-empty and unique");
    }
    operationIds.add(mutation.operationId);
    if (!mutation.path) throw new Error("Drive transaction mutation path is required");
    if (mutation.kind === "move" && !mutation.destinationPath) {
      throw new Error("Drive move mutation requires destinationPath");
    }
    const precondition = mutation.precondition;
    if (mutation.kind === "create") {
      if (precondition.mustNotExist !== true) {
        throw new Error("Drive create mutation requires a mustNotExist precondition");
      }
    } else if (
      !precondition.fileId
      || (!precondition.expectedVersion && !precondition.expectedModifiedTime && !precondition.expectedChecksum)
    ) {
      throw new Error("Drive mutation requires a file ID and an optimistic concurrency value");
    }
  }

  const allApplied = transaction.mutations.every((mutation) => mutation.state === "applied");
  const anyApplied = transaction.mutations.some((mutation) => mutation.state === "applied");
  const anyConflict = transaction.mutations.some((mutation) => mutation.state === "conflict");
  const anyAttempted = transaction.mutations.some((mutation) => mutation.state !== "pending");

  if (transaction.state === "committed" && (!allApplied || !transaction.committedAt)) {
    throw new Error("Committed Drive transaction requires every mutation applied and committedAt");
  }
  if (transaction.state !== "committed" && transaction.committedAt) {
    throw new Error("Only a committed Drive transaction may have committedAt");
  }
  if (transaction.state === "prepared" && anyAttempted) {
    throw new Error("Prepared Drive transaction cannot contain attempted mutations");
  }
  if (transaction.state === "recovering" && !anyApplied) {
    throw new Error("Recovering Drive transaction must record at least one applied mutation");
  }
  if (transaction.state === "conflict" && !anyConflict && !transaction.conflictPaths?.length) {
    throw new Error("Conflict Drive transaction must identify a conflicting mutation");
  }
  if (transaction.state === "failed" && !transaction.terminalErrorCode) {
    throw new Error("Failed Drive transaction requires a terminal error");
  }
}

export function isDriveTransactionTerminal(state: DriveTransactionState): boolean {
  return state === "committed" || state === "conflict" || state === "failed";
}
