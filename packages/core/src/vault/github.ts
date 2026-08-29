/** Where the vault lives on GitHub — used to decorate results with provenance URLs. */
export interface VaultLocation {
  /** "owner/name", e.g. "AlfaBlok/obsidian-brain". Empty when unknown (local dev). */
  repo?: string;
  branch?: string;
}

export function githubUrl(location: VaultLocation, path: string, anchor?: string): string {
  if (!location.repo) return "";
  const branch = location.branch ?? "main";
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const suffix = anchor ? `#${encodeURIComponent(anchor)}` : "";
  return `https://github.com/${location.repo}/blob/${branch}/${encodedPath}${suffix}`;
}

/** Provider-neutral citation with the legacy GitHub URL retained for compatibility. */
export function githubSourceRef(
  location: VaultLocation,
  path: string,
  anchor?: string,
  revisionId?: string,
): VaultSourceRef {
  const url = githubUrl(location, path, anchor);
  return {
    path: anchor ? `${path}#${anchor}` : path,
    url,
    provider: "github",
    ...(revisionId ? { revisionId } : {}),
    githubUrl: url,
  };
}
import type { VaultSourceRef } from "./repository.js";
