import { join } from "node:path";
import { rm } from "node:fs/promises";
import {
  createBrainLlm,
  createEngine,
  ensureSchemaV1,
  lintVault,
  SqliteStateStore,
  VaultRepo,
  type BrainEngine,
  type LintReport,
} from "zenod";
import { installationToken } from "./githubApp.js";
import { buildDriveTools } from "./driveTools.js";
import { OAuthStore } from "./oauthStore.js";
import { Settings, type Provider } from "./settings.js";

export class NotConfiguredError extends Error {
  constructor() {
    super("Zenod is not configured yet — set vault repo, GitHub token, and Anthropic key in settings");
  }
}

/**
 * Owns the engine lifecycle: builds it lazily from runtime settings and
 * rebuilds after settings change. One instance per process.
 */
export class Runtime {
  readonly settings: Settings;
  readonly state: SqliteStateStore;
  readonly oauth: OAuthStore;
  private engine: BrainEngine | null = null;
  private repo: VaultRepo | null = null;

  constructor(readonly dataDir: string) {
    this.state = new SqliteStateStore(join(dataDir, "zenod.sqlite"));
    this.oauth = new OAuthStore(join(dataDir, "oauth.sqlite"));
    this.settings = new Settings(this.state);
    this.settings.seedFromEnv();
  }

  get workdir(): string {
    return join(this.dataDir, "vault");
  }

  invalidate(): void {
    this.engine = null;
    this.repo = null;
  }

  async getRepo(): Promise<VaultRepo> {
    if (this.repo) return this.repo;
    const repoName = this.settings.get("vault_repo");
    const token = this.settings.get("github_token");
    const hasApp = this.settings.hasGithubApp();
    if (!repoName || (!token && !hasApp)) throw new NotConfiguredError();
    const repo = await VaultRepo.open({
      workdir: this.workdir,
      repo: repoName,
      // GitHub App installation tokens (short-lived, repo-scoped) win over a PAT
      ...(hasApp ? { tokenProvider: () => installationToken(this.settings) } : { token: token! }),
    });
    const created = await ensureSchemaV1(repo.path);
    if (created.length > 0) {
      await repo.commitAndPush(`schema: v1 — add ${created.join(", ")}`);
    }
    this.repo = repo;
    return this.repo;
  }

  async getEngine(): Promise<BrainEngine> {
    if (this.engine) return this.engine;
    if (!this.settings.configured()) throw new NotConfiguredError();

    const repo = await this.getRepo();
    const llm = createBrainLlm({
      provider: this.settings.provider(),
      apiKey: this.settings.activeApiKey()!,
      ...(this.settings.get("model_ask") ? { askModel: this.settings.get("model_ask")! } : {}),
      ...(this.settings.get("model_classify") ? { classifyModel: this.settings.get("model_classify")! } : {}),
    });
    // Lazy getter: the tools resolve the engine at call time (it is cached by
    // then), so Drive ingestion can run through the same store pipeline.
    const driveTools = buildDriveTools(this.settings, () => this.getEngine());
    this.engine = createEngine({
      repo,
      llm,
      state: this.state,
      location: {
        repo: this.settings.get("vault_repo")!,
        branch: this.settings.get("vault_branch") ?? "main",
      },
      ...(driveTools ? { driveTools } : {}),
    });
    return this.engine;
  }

  /** Lint the vault — deterministic, needs only the repo (no Anthropic key). */
  async lint(): Promise<LintReport> {
    const repo = await this.getRepo();
    return lintVault(repo.path);
  }

  /** Drop the local clone and re-clone on next use. */
  async reclone(): Promise<void> {
    this.invalidate();
    await rm(this.workdir, { recursive: true, force: true });
  }
}

/** Verify a GitHub token can see the vault repo. */
export async function testGithub(repo: string, token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "zenod", Accept: "application/vnd.github+json" },
    });
    if (response.ok) {
      const data = (await response.json()) as { private?: boolean; default_branch?: string };
      return { ok: true, message: `repo found (default branch: ${data.default_branch ?? "?"})` };
    }
    if (response.status === 404) return { ok: false, message: "repo not found — check the name and token scope" };
    if (response.status === 401) return { ok: false, message: "token rejected by GitHub" };
    return { ok: false, message: `GitHub returned ${response.status}` };
  } catch (err) {
    return { ok: false, message: `network error: ${(err as Error).message}` };
  }
}

/** Verify the API key for a given provider against its models endpoint. */
export async function testProviderKey(
  provider: Provider,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  const config =
    provider === "openai"
      ? { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${apiKey}` }, name: "OpenAI" }
      : {
          url: "https://api.anthropic.com/v1/models",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          name: "Anthropic",
        };
  try {
    const response = await fetch(config.url, { headers: config.headers });
    if (response.ok) return { ok: true, message: "key accepted" };
    if (response.status === 401) return { ok: false, message: `key rejected by ${config.name}` };
    return { ok: false, message: `${config.name} returned ${response.status}` };
  } catch (err) {
    return { ok: false, message: `network error: ${(err as Error).message}` };
  }
}
