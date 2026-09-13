import { filingPublicationConflict, verifyPublicationBase, verifyPublicationFiles } from "../vault/publicationGuard.js";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";
import type { FileChange } from "../vault/immutability.js";
import { githubUrl } from "../vault/github.js";
import {
  githubVaultRevision,
  type VaultRepository,
  type VaultRevision,
  type VaultPublicationGuard,
} from "../vault/repository.js";

export interface VaultRepoOptions {
  /** Local clone directory. */
  workdir: string;
  /** "owner/name" on GitHub. Ignored when remoteUrl is given. */
  repo?: string;
  /** GitHub PAT; embedded in the remote URL. */
  token?: string;
  /**
   * Short-lived credential source (e.g. GitHub App installation tokens).
   * Called before remote operations; takes precedence over `token`.
   */
  tokenProvider?: () => Promise<string>;
  /** Full remote URL override — used by tests with local bare repos. */
  remoteUrl?: string;
  authorName?: string;
  authorEmail?: string;
}

function remoteUrlFor(repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

const PUSH_RETRIES = 3;

/**
 * The git contract from docs/M0-SPEC.md: clone to a workdir, pull before
 * every turn, one commit per memory, push with pull-rebase retry ×3.
 * Never force-push, never amend, never rewrite history.
 */
export class VaultRepo implements VaultRepository {
  readonly provider = "github" as const;

  private constructor(
    readonly path: string,
    private readonly git: SimpleGit,
    readonly branch: string,
    private readonly repo?: string,
    private readonly tokenProvider?: () => Promise<string>,
  ) {}

  static async open(options: VaultRepoOptions): Promise<VaultRepo> {
    const remoteUrl =
      options.remoteUrl ??
      (options.repo
        ? options.tokenProvider
          ? remoteUrlFor(options.repo, await options.tokenProvider())
          : options.token
            ? remoteUrlFor(options.repo, options.token)
            : `https://github.com/${options.repo}.git`
        : undefined);

    const isClone = await access(join(options.workdir, ".git"))
      .then(() => true)
      .catch(() => false);

    if (!isClone) {
      if (!remoteUrl) throw new Error("no existing clone and no repo/remoteUrl to clone from");
      await simpleGit().clone(remoteUrl, options.workdir);
    }

    const git = simpleGit(options.workdir);
    await git.addConfig("user.name", options.authorName ?? "zenod-bot");
    await git.addConfig("user.email", options.authorEmail ?? "bot@zenod.dev");
    if (remoteUrl && isClone) {
      // keep the remote in sync with current settings (e.g. rotated token)
      await git.remote(["set-url", "origin", remoteUrl]);
    }
    const branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    return new VaultRepo(options.workdir, git, branch, options.repo, options.tokenProvider);
  }

  /** Refresh the remote URL with a fresh short-lived token before remote ops. */
  private async ensureFreshRemote(): Promise<void> {
    if (!this.tokenProvider || !this.repo) return;
    const token = await this.tokenProvider();
    await this.git.remote(["set-url", "origin", remoteUrlFor(this.repo, token)]);
  }

  async pull(): Promise<void> {
    await this.ensureFreshRemote();
    await this.git.pull("origin", this.branch, { "--rebase": "true" });
  }

  async currentPublishedRevision(): Promise<VaultRevision> {
    await this.ensureFreshRemote();
    await this.git.fetch("origin", this.branch);
    const sha = (await this.git.revparse([`refs/remotes/origin/${this.branch}`])).trim();
    return this.revisionForSha(sha, []);
  }

  async pullForFiling(): Promise<void> {
    await this.currentPublishedRevision();
    await this.git.merge(["--ff-only", `refs/remotes/origin/${this.branch}`]);
  }

  async headSha(): Promise<string> {
    return (await this.git.revparse(["HEAD"])).trim();
  }

  private async revisionForSha(commitSha: string, githubUrls: string[]): Promise<VaultRevision> {
    const committedAt = (await this.git.show(["-s", "--format=%cI", commitSha])).trim();
    return githubVaultRevision({ commitSha, committedAt, githubUrls });
  }

  async currentRevision(): Promise<VaultRevision> {
    const commitSha = await this.headSha();
    return this.revisionForSha(commitSha, []);
  }

  async hasHead(): Promise<boolean> {
    return this.git.revparse(["--verify", "HEAD"]).then(() => true).catch(() => false);
  }

  async status(): Promise<StatusResult> {
    return this.git.status();
  }

  async trackedFiles(): Promise<string[]> {
    const out = await this.git.raw(["ls-files"]);
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  /** Content of a file as of HEAD, or null if it doesn't exist there. */
  async contentAtHead(relPath: string): Promise<string | null> {
    try {
      return await this.git.show([`HEAD:${relPath}`]);
    } catch {
      return null;
    }
  }

  /** Working-tree changes vs HEAD as FileChange records for the immutability check. */
  async pendingChanges(): Promise<FileChange[]> {
    const status = await this.git.status();
    const changes: FileChange[] = [];
    const record = async (path: string, deleted: boolean) => {
      const before = await this.contentAtHead(path);
      const after = deleted ? null : await readFile(join(this.path, path), "utf8").catch(() => null);
      changes.push({ path, before, after });
    };
    for (const file of [...status.modified, ...status.created, ...status.not_added]) await record(file, false);
    for (const file of status.deleted) await record(file, true);
    return changes;
  }

  /** Discard all uncommitted changes — the never-half-apply escape hatch. */
  async discardChanges(): Promise<void> {
    await this.git.reset(["--hard", "HEAD"]);
    await this.git.clean("f", ["-d"]);
  }

  /**
   * One commit per memory: stage, commit, push. A rejected push is resolved
   * by pull --rebase and retried up to 3 times, then surfaced.
   */
  async commit(message: string): Promise<string> {
    await this.git.add(["-A"]);
    await this.git.commit(message);
    return this.headSha();
  }

  async pushWithRetry(commitSha: string): Promise<string> {
    await this.ensureFreshRemote();

    let lastError: unknown;
    for (let attempt = 0; attempt < PUSH_RETRIES; attempt++) {
      try {
        await this.git.push("origin", this.branch);
        return this.headSha(); // sha may change if a rebase happened
      } catch (err) {
        lastError = err;
        try {
          await this.git.pull("origin", this.branch, { "--rebase": "true" });
        } catch (rebaseErr) {
          throw new Error(
            `push rejected and rebase failed for commit ${commitSha}: ${(rebaseErr as Error).message}`,
          );
        }
      }
    }
    throw new Error(`push failed after ${PUSH_RETRIES} attempts: ${(lastError as Error).message}`);
  }

  async push(): Promise<string> {
    await this.ensureFreshRemote();
    await this.git.push("origin", this.branch);
    return this.headSha();
  }

  async commitAndPush(message: string): Promise<string> {
    const sha = await this.commit(message);
    return this.pushWithRetry(sha);
  }

  /** Provider-neutral publication boundary; legacy commitAndPush remains available during migration. */
  async commitAndPublish(message: string, guard?: VaultPublicationGuard): Promise<VaultRevision> {
    if (guard) return this.publishGuardedFiling(message, guard);
    const changedPaths = (await this.pendingChanges()).map((change) => change.path);
    const commitSha = await this.commitAndPush(message);
    const canonicalLocation = {
      ...(this.repo ? { repo: this.repo } : {}),
      branch: commitSha,
    };
    return this.revisionForSha(
      commitSha,
      changedPaths
        .map((path) => githubUrl(canonicalLocation, path))
        .filter(Boolean),
    );
  }

  private async publishGuardedFiling(message: string, guard: VaultPublicationGuard): Promise<VaultRevision> {
    const published = await this.currentPublishedRevision();
    let head = await this.headSha();
    const pending = await this.pendingChanges();
    if (pending.length) {
      verifyPublicationBase(published, guard);
      if (head !== guard.expectedRevision.id) filingPublicationConflict(guard);
      verifyPublicationFiles(pending, guard);
      guard.assertActive?.();
      head = await this.commit(message);
    }
    // Recovery may publish only one exact prepared filing commit, never an
    // unrelated local commit or a rebased transaction with different context.
    const parents = (await this.git.show(["-s", "--format=%P", head])).trim();
    if (parents !== guard.expectedRevision.id) filingPublicationConflict(guard);
    const paths = (await this.git.raw(["diff", "--name-only", "-z", guard.expectedRevision.id, head])).split("\0").filter(Boolean);
    const changes: FileChange[] = await Promise.all(paths.map(async path => ({ path,
      before: await this.git.show([`${guard.expectedRevision.id}:${path}`]).catch(() => null),
      after: await this.git.show([`${head}:${path}`]).catch(() => null),
    })));
    verifyPublicationFiles(changes, guard);
    const contains = async (revision: VaultRevision) => (await this.git.raw(["rev-list", "--max-count=1", head, "--not", revision.id])).trim() === "";
    if (published.id !== guard.expectedRevision.id && !(await contains(published))) filingPublicationConflict(guard);
    if (!(await contains(published))) {
      guard.assertActive?.();
      // No rebase or force push: a concurrent remote change must reject this plan.
      try { await this.git.push("origin", this.branch); } catch { /* Verify remote before deciding whether a lost response was failure. */ }
    }
    if (!(await contains(await this.currentPublishedRevision()))) filingPublicationConflict(guard);
    return this.revisionForSha(head, paths.map(path => githubUrl({ ...(this.repo ? { repo: this.repo } : {}), branch: head }, path)).filter(Boolean));
  }

  /** Resolve a vault path using the current GitHub branch compatibility URL. */
  urlFor(path: string, anchor?: string): string | null {
    const location = {
      ...(this.repo ? { repo: this.repo } : {}),
      branch: this.branch,
    };
    return githubUrl(location, path, anchor) || null;
  }
}
