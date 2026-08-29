import type { VaultSourceRef } from "./repository.js";
import { githubSourceRef, type VaultLocation } from "./github.js";

export type VaultSourceResolver = (path: string, anchor?: string) => VaultSourceRef;
export type VaultSourceContext = VaultLocation | VaultSourceResolver;

/** Preserve the public GitHub-location API while allowing provider-neutral engine reads. */
export function vaultSourceRef(
  context: VaultSourceContext,
  path: string,
  anchor?: string,
): VaultSourceRef {
  return typeof context === "function"
    ? context(path, anchor)
    : githubSourceRef(context, path, anchor);
}
