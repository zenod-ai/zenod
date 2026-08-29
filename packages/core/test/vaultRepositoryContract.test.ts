import { describe, expect, it } from "vitest";
import {
  VaultPublicationError,
  assertDriveIdempotentReplay,
  assertDriveTransactionInvariant,
  driveTransactionIdempotencyScope,
  githubVaultRevision,
  isDriveTransactionTerminal,
  type DriveVaultTransaction,
  type VaultRepository,
  type VaultRevision,
} from "../src/index.js";

function adapter(provider: "github" | "google_drive", revision: VaultRevision): VaultRepository {
  return {
    path: `/tmp/${provider}`,
    provider,
    async pull() {},
    async trackedFiles() { return ["Log/2026-08-29.md"]; },
    async contentAtHead(path) { return path.endsWith(".md") ? "baseline" : null; },
    async pendingChanges() { return []; },
    async discardChanges() {},
    async commitAndPublish() { return revision; },
    urlFor(path, anchor) {
      const fragment = anchor ? `#${encodeURIComponent(anchor)}` : "";
      return `https://example.test/${provider}/${encodeURIComponent(path)}${fragment}`;
    },
  };
}

describe("VaultRepository contract", () => {
  it("compiles GitHub and Drive adapters against one repository-shaped interface", async () => {
    const githubRevision = githubVaultRevision({
      commitSha: "a".repeat(40),
      committedAt: "2026-08-29T10:00:00.000Z",
      githubUrls: ["https://github.com/zenod-ai/vault/blob/main/Log/2026-08-29.md"],
    });
    const driveRevision: VaultRevision = {
      provider: "google_drive",
      id: "gdrive-txn-01",
      committedAt: "2026-08-29T10:00:01.000Z",
      urls: ["https://drive.google.com/file/d/file-1/view"],
    };

    const repositories: VaultRepository[] = [
      adapter("github", githubRevision),
      adapter("google_drive", driveRevision),
    ];
    await expect(Promise.all(repositories.map((repo) => repo.commitAndPublish("store memory"))))
      .resolves.toEqual([githubRevision, driveRevision]);

    expect(githubRevision).toMatchObject({
      provider: "github",
      id: "a".repeat(40),
      commitSha: "a".repeat(40),
      githubUrls: githubRevision.urls,
    });
    expect(driveRevision).not.toHaveProperty("commitSha");
    expect(driveRevision).not.toHaveProperty("githubUrls");
  });

  it("keeps publication failure outcomes distinct and machine-readable", () => {
    const failures = [
      new VaultPublicationError({ code: "failed_before_write", message: "offline", retryable: true }),
      new VaultPublicationError({ code: "conflict", message: "changed remotely", retryable: false, transactionId: "txn-1", paths: ["Areas/Home.md"] }),
      new VaultPublicationError({ code: "authorization_revoked", message: "reconnect", retryable: false }),
      new VaultPublicationError({ code: "partial_recovering", message: "resume", retryable: true, transactionId: "txn-2", appliedPaths: ["Log/2026-08-29.md"], pendingPaths: ["Areas/Home.md"] }),
      new VaultPublicationError({ code: "terminal_failure", message: "cannot reconcile", retryable: false, transactionId: "txn-3", appliedPaths: ["Log/2026-08-29.md"] }),
    ];
    expect(failures.map((failure) => failure.failure.code)).toEqual([
      "failed_before_write",
      "conflict",
      "authorization_revoked",
      "partial_recovering",
      "terminal_failure",
    ]);
  });
});

describe("Drive transaction contract", () => {
  const recovering: DriveVaultTransaction = {
    schemaVersion: 1,
    transactionId: "txn-1",
    tenantId: "github-42",
    vaultBindingId: "drive-binding-1",
    idempotencyKey: "store:message-1",
    intentDigest: "sha256:intent",
    baseManifestVersion: "7",
    state: "recovering",
    mutations: [
      {
        operationId: "log",
        kind: "update",
        path: "Log/2026-08-29.md",
        precondition: { fileId: "file-log", expectedVersion: "3", expectedChecksum: "before-log" },
        state: "applied",
        resultingFileId: "file-log",
        resultingVersion: "4",
      },
      {
        operationId: "meaning",
        kind: "update",
        path: "Areas/Home.md",
        precondition: { fileId: "file-home", expectedVersion: "8", expectedChecksum: "before-home" },
        state: "pending",
      },
    ],
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:01.000Z",
  };

  it("scopes idempotency by tenant and authoritative binding", () => {
    expect(driveTransactionIdempotencyScope(recovering)).toBe(
      '["github-42","drive-binding-1","store:message-1"]',
    );
    expect(() => assertDriveTransactionInvariant(recovering)).not.toThrow();
    expect(isDriveTransactionTerminal(recovering.state)).toBe(false);
    expect(() => assertDriveIdempotentReplay(recovering, { ...recovering })).not.toThrow();
    expect(() => assertDriveIdempotentReplay(recovering, {
      ...recovering,
      intentDigest: "sha256:different-intent",
    })).toThrow(/different publication intent/);
  });

  it("rejects a false-success committed transaction with pending files", () => {
    expect(() => assertDriveTransactionInvariant({
      ...recovering,
      state: "committed",
      committedAt: "2026-08-29T10:00:02.000Z",
    })).toThrow(/every mutation applied/);
  });
});
