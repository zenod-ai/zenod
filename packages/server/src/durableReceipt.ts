import type { StoreResult, VaultRevision } from "zenod";

const GIT_SHA = /^[0-9a-f]{40}$/i;

function validUrls(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((url) => {
    if (typeof url !== "string" || !url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  });
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isGitHubHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "github.com"
    || host.endsWith(".github.com")
    || host === "githubusercontent.com"
    || host.endsWith(".githubusercontent.com");
}

function githubUrls(value: string[]): boolean {
  return value.every((url) => isGitHubHost(new URL(url).hostname));
}

function revisionFrom(value: unknown): VaultRevision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const revision = value as Record<string, unknown>;
  if (
    (revision.provider !== "github" && revision.provider !== "google_drive")
    || typeof revision.id !== "string"
    || !revision.id
    || typeof revision.committedAt !== "string"
    || Number.isNaN(Date.parse(revision.committedAt))
    || !validUrls(revision.urls)
  ) return null;
  return revision as unknown as VaultRevision;
}

/** Validate a terminal store receipt without translating provider ids into Git SHAs. */
export function durableStoreReceiptError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "store result is not an object";
  const receipt = value as Record<string, unknown>;
  const revision = revisionFrom(receipt.revision);
  const topCommit = receipt.commitSha;
  const topGitHubUrls = receipt.githubUrls;

  if (!revision) {
    if (receipt.revision !== undefined) return "revision is malformed";
    if (typeof topCommit !== "string" || !GIT_SHA.test(topCommit)) return "durable revision is missing";
    if (receipt.urls !== undefined && (!validUrls(receipt.urls) || !githubUrls(receipt.urls))) {
      return "legacy provider URLs are malformed";
    }
    if (topGitHubUrls !== undefined && (!validUrls(topGitHubUrls) || !githubUrls(topGitHubUrls))) {
      return "legacy GitHub URLs are malformed";
    }
    return null;
  }

  if (!validUrls(receipt.urls) || !sameStrings(receipt.urls, revision.urls)) {
    return "top-level URLs do not match the durable revision";
  }

  if (revision.provider === "google_drive") {
    if (
      topGitHubUrls !== undefined
      || revision.githubUrls !== undefined
    ) return "Google Drive receipt contains GitHub compatibility fields";
    if (revision.urls.some((url) => isGitHubHost(new URL(url).hostname))) {
      return "Google Drive receipt contains a GitHub URL";
    }
    const nestedCommit = revision.commitSha;
    if ((topCommit === undefined) !== (nestedCommit === undefined)) {
      return "Google Drive Git commit provenance is incomplete";
    }
    if (topCommit !== undefined && (
      typeof topCommit !== "string"
      || !GIT_SHA.test(topCommit)
      || typeof nestedCommit !== "string"
      || nestedCommit !== topCommit
    )) return "Google Drive Git commit provenance is malformed or inconsistent";
    return null;
  }

  if (
    !GIT_SHA.test(revision.id)
    || typeof revision.commitSha !== "string"
    || !GIT_SHA.test(revision.commitSha)
    || revision.commitSha !== revision.id
    || typeof topCommit !== "string"
    || topCommit !== revision.id
    || !validUrls(revision.githubUrls)
    || !githubUrls(revision.urls)
    || !githubUrls(revision.githubUrls)
    || !validUrls(topGitHubUrls)
    || !sameStrings(topGitHubUrls, revision.githubUrls)
  ) return "GitHub revision provenance is malformed or inconsistent";

  return null;
}

export function assertDurableStoreReceipt(value: unknown): asserts value is StoreResult {
  const error = durableStoreReceiptError(value);
  if (error) throw new Error(`invalid durable store receipt: ${error}`);
}

export function assertDurableWorkReceipt(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid durable work receipt: work result is not an object");
  }
  const result = value as Record<string, unknown>;
  if (result.committed !== true) return;
  const error = durableStoreReceiptError(result);
  if (error) throw new Error(`invalid durable work receipt: ${error}`);
}
