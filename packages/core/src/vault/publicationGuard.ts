import { createHash } from "node:crypto";
import type { FileChange } from "./immutability.js";
import { VaultPublicationError, type VaultPublicationGuard, type VaultRevision } from "./repository.js";

export const publicationContentHash = (content: string | null): string | null => content === null
  ? null : createHash("sha256").update(content).digest("hex");

export function filingPublicationConflict(guard: VaultPublicationGuard): never {
  throw new VaultPublicationError({ code: "conflict", message: "Filing publication no longer matches its validated base or file plan.",
    retryable: false, transactionId: guard.receiptPath, paths: Object.keys(guard.expectedFiles) });
}

export function verifyPublicationBase(actual: VaultRevision, guard: VaultPublicationGuard): void {
  if (actual.provider !== guard.expectedRevision.provider || actual.id !== guard.expectedRevision.id) filingPublicationConflict(guard);
}

export function verifyPublicationFiles(changes: FileChange[], guard: VaultPublicationGuard): void {
  const paths = Object.keys(guard.expectedFiles).sort();
  if (!paths.includes(guard.receiptPath) || !guard.expectedFiles[guard.receiptPath]
    || paths.join("\n") !== changes.map(change => change.path).sort().join("\n")) filingPublicationConflict(guard);
  for (const change of changes) {
    if (publicationContentHash(change.after) !== guard.expectedFiles[change.path]) filingPublicationConflict(guard);
    if (change.path === guard.receiptPath && change.before === change.after) filingPublicationConflict(guard);
  }
}
