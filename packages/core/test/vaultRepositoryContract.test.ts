import { describe, expect, it } from "vitest";
import {
  VaultPublicationError,
  assertDriveIdempotentReplay,
  assertDriveTransactionInvariant,
  driveTransactionIdempotencyScope,
  githubUrl,
  githubVaultRevision,
  isDriveTransactionTerminal,
  type DriveVaultTransaction,
  type VaultRepository,
  type VaultRevision,
} from "../src/index.js";

interface LegacyGithubRepoShape {
  readonly path: string;
  pull(): Promise<void>;
  trackedFiles(): Promise<string[]>;
  contentAtHead(path: string): Promise<string | null>;
  pendingChanges(): ReturnType<VaultRepository["pendingChanges"]>;
  discardChanges(): Promise<void>;
  commitAndPush(message: string): Promise<string>;
}

/** Test-only proof that the current VaultRepo surface can be wrapped additively. */
class GithubCompatibilityWrapper implements VaultRepository {
  readonly provider = "github" as const;

  constructor(
    private readonly legacy: LegacyGithubRepoShape,
    private readonly repo: string,
    private readonly branch: string,
    private readonly now: () => string,
  ) {}

  get path(): string { return this.legacy.path; }
  pull(): Promise<void> { return this.legacy.pull(); }
  trackedFiles(): Promise<string[]> { return this.legacy.trackedFiles(); }
  contentAtHead(path: string): Promise<string | null> { return this.legacy.contentAtHead(path); }
  pendingChanges(): ReturnType<VaultRepository["pendingChanges"]> { return this.legacy.pendingChanges(); }
  discardChanges(): Promise<void> { return this.legacy.discardChanges(); }
  urlFor(path: string, anchor?: string): string { return githubUrl({ repo: this.repo, branch: this.branch }, path, anchor); }
  async commitAndPublish(message: string): Promise<VaultRevision> {
    const commitSha = await this.legacy.commitAndPush(message);
    return githubVaultRevision({
      commitSha,
      committedAt: this.now(),
      githubUrls: [githubUrl({ repo: this.repo, branch: commitSha }, "Log/2026-08-29.md")],
    });
  }
}

/** Independent non-git implementation shape reserved for the Drive backend ticket. */
class DriveRepositoryStub implements VaultRepository {
  readonly path = "/tmp/google_drive";
  readonly provider = "google_drive" as const;

  constructor(private readonly revision: VaultRevision) {}

  async pull() {}
  async trackedFiles() { return ["Log/2026-08-29.md"]; }
  async contentAtHead(path: string) { return path.endsWith(".md") ? "baseline" : null; }
  async pendingChanges() { return []; }
  async discardChanges() {}
  async commitAndPublish() { return this.revision; }
  urlFor(path: string, anchor?: string) {
    const fragment = anchor ? `#${encodeURIComponent(anchor)}` : "";
    return `https://drive.google.com/drive/u/0/folders/${encodeURIComponent(path)}${fragment}`;
  }
}

describe("VaultRepository contract", () => {
  it("compiles GitHub and Drive adapters against one repository-shaped interface", async () => {
    const driveRevision: VaultRevision = {
      provider: "google_drive",
      id: "gdrive-txn-01",
      committedAt: "2026-08-29T10:00:01.000Z",
      urls: ["https://drive.google.com/file/d/file-1/view"],
    };

    const legacy: LegacyGithubRepoShape = {
      path: "/tmp/github",
      async pull() {},
      async trackedFiles() { return ["Log/2026-08-29.md"]; },
      async contentAtHead() { return "baseline"; },
      async pendingChanges() { return []; },
      async discardChanges() {},
      async commitAndPush() { return "a".repeat(40); },
    };
    const repositories: VaultRepository[] = [
      new GithubCompatibilityWrapper(
        legacy,
        "zenod-ai/vault",
        "main",
        () => "2026-08-29T10:00:00.000Z",
      ),
      new DriveRepositoryStub(driveRevision),
    ];
    const [githubRevision, publishedDriveRevision] = await Promise.all(
      repositories.map((repo) => repo.commitAndPublish("store memory")),
    );

    expect(githubRevision).toMatchObject({
      provider: "github",
      id: "a".repeat(40),
      commitSha: "a".repeat(40),
      githubUrls: githubRevision.urls,
    });
    expect(publishedDriveRevision).toEqual(driveRevision);
    expect(publishedDriveRevision).not.toHaveProperty("commitSha");
    expect(publishedDriveRevision).not.toHaveProperty("githubUrls");
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
    expect(isDriveTransactionTerminal(recovering)).toBe(false);
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

  it("rejects a vacuous committed transaction with no mutations", () => {
    expect(() => assertDriveTransactionInvariant({
      ...recovering,
      state: "committed",
      mutations: [],
      committedAt: "2026-08-29T10:00:02.000Z",
    })).toThrow(/every mutation applied/);
  });

  it("keeps a partially applied conflict non-terminal for restart recovery", () => {
    const partialConflict: DriveVaultTransaction = {
      ...recovering,
      state: "conflict",
      mutations: [
        recovering.mutations[0]!,
        { ...recovering.mutations[1]!, state: "conflict", errorCode: "version_changed" },
      ],
      conflictPaths: ["Areas/Home.md"],
    };

    expect(isDriveTransactionTerminal(partialConflict)).toBe(false);
    expect(() => assertDriveTransactionInvariant(partialConflict)).toThrow(/must remain recovering/);

    const recoverable = { ...partialConflict, state: "recovering" as const };
    expect(() => assertDriveTransactionInvariant(recoverable)).not.toThrow();
    expect(isDriveTransactionTerminal(recoverable)).toBe(false);
  });
});
