import { join } from "node:path";
import { rm } from "node:fs/promises";
import {
  createBrainLlm,
  createEngine,
  cleanSlateVault,
  ensureSchemaV1,
  lintVault,
  normalizeCreateIssueLabels,
  normalizeLabelIssueLabels,
  STATUS_PROPOSED,
  STATUS_QUEUED,
  SqliteStateStore,
  VaultRepo,
  type BrainEngine,
  type CleanSlateResult,
  type ExternalTaskingTools,
  type LintReport,
  type TokenCostMeasurement,
} from "zenod";
import { installationToken } from "./githubApp.js";
import { buildDriveTools } from "./driveTools.js";
import { IngestStore } from "./ingestStore.js";
import { IngestQueue } from "./ingestQueue.js";
import { OAuthStore } from "./oauthStore.js";
import { Settings, type Provider } from "./settings.js";
import { WhatsAppGateway } from "./whatsappGateway.js";
import { WhatsAppStore } from "./whatsappStore.js";

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
  readonly whatsappStore: WhatsAppStore;
  readonly whatsapp: WhatsAppGateway;
  readonly ingestStore: IngestStore;
  readonly ingestQueue: IngestQueue;
  private engine: BrainEngine | null = null;
  private repo: VaultRepo | null = null;

  constructor(readonly dataDir: string) {
    this.state = new SqliteStateStore(join(dataDir, "zenod.sqlite"));
    this.oauth = new OAuthStore(join(dataDir, "oauth.sqlite"));
    this.settings = new Settings(this.state);
    this.settings.seedFromEnv();
    this.whatsappStore = new WhatsAppStore(join(dataDir, "whatsapp", "whatsapp.sqlite"));
    this.whatsapp = new WhatsAppGateway({
      dataDir: join(dataDir, "whatsapp"),
      settings: this.settings,
      store: this.whatsappStore,
      getEngine: () => this.getEngine(),
    });
    // The IngestStore constructor marks any job left mid-flight by a restart
    // as "interrupted"; resume() then drains anything still queued.
    this.ingestStore = new IngestStore(join(dataDir, "ingest.sqlite"));
    this.ingestQueue = new IngestQueue(this.ingestStore, this.settings, () => this.getEngine());
  }

  get workdir(): string {
    return join(this.dataDir, "vault");
  }

  invalidate(): void {
    this.engine = null;
    this.repo = null;
  }

  async getRepo(options: { ensureSchema?: boolean } = {}): Promise<VaultRepo> {
    const ensureSchema = options.ensureSchema ?? true;
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
    if (ensureSchema) {
      const created = await ensureSchemaV1(repo.path);
      if (created.length > 0) {
        await repo.commitAndPush(`schema: v1 — add ${created.join(", ")}`);
      }
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
    // The chat/MCP Drive tools enqueue onto the background ingest queue.
    const driveTools = buildDriveTools(this.settings, this.ingestQueue);
    this.engine = createEngine({
      repo,
      llm,
      state: this.state,
      location: {
        repo: this.settings.get("vault_repo")!,
        branch: this.settings.get("vault_branch") ?? "main",
      },
      ...(driveTools ? { driveTools } : {}),
      taskingTools: this.buildTaskingTools(),
      ...(process.env.ZENOD_LLM_COST_LOG === "1" ? { onTokenCost: logTokenCost } : {}),
    });
    return this.engine;
  }

  private async githubToken(): Promise<string | null> {
    if (this.settings.hasGithubApp()) return installationToken(this.settings);
    return this.settings.get("github_token");
  }

  private buildTaskingTools(): ExternalTaskingTools {
    const defaultRepo = () => this.settings.get("vault_repo") || "";
    const githubJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await this.githubToken();
      if (!token) throw new Error("GitHub token or app installation is required");
      const response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "zenod",
          Accept: "application/vnd.github+json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`GitHub returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      return (await response.json()) as T;
    };

    const queryBacklog = async (query?: string): Promise<string> => {
      const repo = defaultRepo();
      if (!repo) return "No GitHub repository is configured.";
      const issues = await githubJson<
        Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }>; updated_at: string }>
      >(`/repos/${encodeURIComponent(repo).replace("%2F", "/")}/issues?state=open&per_page=30&sort=updated&direction=desc`);
      const filtered = query
        ? issues.filter((issue) => `${issue.title} ${issue.labels.map((label) => label.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()))
        : issues;
      if (filtered.length === 0) return query ? `No open issues matched "${query}".` : "No open issues found.";
      return [
        `Open issues${query ? ` matching "${query}"` : ""}: ${filtered.length}`,
        ...filtered.slice(0, 10).map((issue) => {
          const labels = issue.labels.map((label) => label.name).join(", ");
          return `#${issue.number} ${issue.title}${labels ? ` [${labels}]` : ""} — updated ${issue.updated_at} — ${issue.html_url}`;
        }),
      ].join("\n");
    };

    return {
      createIssue: async ({ repo, title, body, labels }) => {
        const target = repo || defaultRepo();
        if (!target) return "No GitHub repository is configured.";
        const issue = await githubJson<{ number: number; html_url: string }>(`/repos/${encodeURIComponent(target).replace("%2F", "/")}/issues`, {
          method: "POST",
          body: JSON.stringify({ title, body, labels: normalizeCreateIssueLabels(labels) }),
        });
        return `Created issue #${issue.number}: ${issue.html_url}`;
      },
      labelIssue: async ({ repo, issueNumber, labels }) => {
        const target = repo || defaultRepo();
        if (!target) return "No GitHub repository is configured.";
        const issue = await githubJson<{ html_url: string }>(
          `/repos/${encodeURIComponent(target).replace("%2F", "/")}/issues/${issueNumber}/labels`,
          { method: "POST", body: JSON.stringify({ labels: normalizeLabelIssueLabels(labels) }) },
        );
        return `Labeled issue #${issueNumber}: ${issue.html_url}`;
      },
      queryBacklog,
      serviceBacklog: async (query?: string) =>
        ["Backlog service selection only; runner is tracked separately.", await queryBacklog(query)].join("\n"),
      // The only path that sets status:queued (#58) — explicit human approval.
      // Removes status:proposed (404 is fine if absent) and adds status:queued.
      approveQueue: async ({ repo, issueNumbers }) => {
        const target = repo || defaultRepo();
        if (!target) return "No GitHub repository is configured.";
        const repoPath = encodeURIComponent(target).replace("%2F", "/");
        const queued: number[] = [];
        for (const n of issueNumbers) {
          await githubJson(`/repos/${repoPath}/issues/${n}/labels/${encodeURIComponent(STATUS_PROPOSED)}`, {
            method: "DELETE",
          }).catch(() => {});
          await githubJson(`/repos/${repoPath}/issues/${n}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels: [STATUS_QUEUED] }),
          });
          queued.push(n);
        }
        return `Queued ${queued.map((n) => `#${n}`).join(", ")} — the monitor will pick them up.`;
      },
    };
  }

  /** Lint the vault — deterministic, needs only the repo (no Anthropic key). */
  async lint(): Promise<LintReport> {
    const repo = await this.getRepo();
    return lintVault(repo.path);
  }

  async cleanSlate(): Promise<CleanSlateResult> {
    this.invalidate();
    try {
      const repo = await this.getRepo({ ensureSchema: false });
      return await cleanSlateVault(repo, {
        push: true,
        location: {
          repo: this.settings.get("vault_repo")!,
          branch: this.settings.get("vault_branch") ?? "main",
        },
      });
    } finally {
      this.invalidate();
    }
  }

  /** Drop the local clone and re-clone on next use. */
  async reclone(): Promise<void> {
    this.invalidate();
    await rm(this.workdir, { recursive: true, force: true });
  }

  close(): void {
    this.whatsapp.close();
    this.state.close();
    this.whatsappStore.close();
    this.ingestStore.close();
  }
}

function logTokenCost(measurement: TokenCostMeasurement): void {
  const sections = measurement.briefingSections
    ? Object.entries(measurement.briefingSections)
        .map(([name, section]) => `${name}=${section.included}/${section.total}`)
        .join(" ")
    : "";
  console.log(
    [
      "[llm-cost]",
      `operation=${measurement.operation}`,
      measurement.stage ? `stage=${measurement.stage}` : "",
      `estimated_input_tokens=${measurement.estimatedInputTokens}`,
      `briefing_tokens=${measurement.estimatedBriefingTokens}`,
      `briefing_chars=${measurement.briefingChars}`,
      sections,
    ]
      .filter(Boolean)
      .join(" "),
  );
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
