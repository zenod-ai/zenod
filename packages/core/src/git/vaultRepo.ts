import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { FileChange } from "../vault/immutability.js";

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
export class VaultRepo {
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
    const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
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

  async headSha(): Promise<string> {
    return (await this.git.revparse(["HEAD"])).trim();
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
  async commitAndPush(message: string): Promise<string> {
    await this.ensureFreshRemote();
    await this.git.add(["-A"]);
    await this.git.commit(message);
    const sha = await this.headSha();

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
            `push rejected and rebase failed for commit ${sha}: ${(rebaseErr as Error).message}`,
          );
        }
      }
    }
    throw new Error(`push failed after ${PUSH_RETRIES} attempts: ${(lastError as Error).message}`);
  }
}
