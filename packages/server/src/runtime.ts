import { join } from "node:path";
import { rm } from "node:fs/promises";
import {
  createBrainLlm,
  createEngine,
  cleanSlateVault,
  ensureSchemaV1,
  lintVault,
  OWNER_AGENT,
  normalizeCreateIssueLabels,
  normalizeLabelIssueLabels,
  STATUS_PROPOSED,
  STATUS_QUEUED,
  STATUS_NEEDS_REVIEW,
  STATUS_APPROVED_MERGE,
  SqliteStateStore,
  VaultRepo,
  type BrainEngine,
  type CleanSlateResult,
  type ExternalTaskingTools,
  type LintReport,
  type LlmUsageReport,
  type TokenCostMeasurement,
} from "zenod";
import { installationToken, installationTokenForRepo, editGithubIssue } from "zenod";
import { ZENOD_AGENT, type AgentDefinition } from "./agent.js";
import { buildDriveTools } from "./driveTools.js";
import { IngestStore } from "./ingestStore.js";
import { UsageStore } from "./usageStore.js";
import { IngestQueue } from "./ingestQueue.js";
import { TaskJobStore } from "./taskJobStore.js";
import { TaskJobQueue } from "./taskJobQueue.js";
import { OAuthStore } from "./oauthStore.js";
import { callPeer } from "./peerClient.js";
import { Settings, type Provider } from "./settings.js";
import { WhatsAppGateway } from "./whatsappGateway.js";
import { WhatsAppStore } from "./whatsappStore.js";
import { TelegramGateway } from "./telegramGateway.js";

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
  readonly telegram: TelegramGateway;
  readonly ingestStore: IngestStore;
  readonly ingestQueue: IngestQueue;
  readonly taskJobStore: TaskJobStore;
  readonly taskJobQueue: TaskJobQueue;
  readonly usageStore: UsageStore;
  private engine: BrainEngine | null = null;
  private repo: VaultRepo | null = null;

  constructor(readonly dataDir: string, readonly agent: AgentDefinition = ZENOD_AGENT) {
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
    this.telegram = new TelegramGateway({
      settings: this.settings,
      getEngine: () => this.getEngine(),
      dataDir: join(dataDir, "telegram"),
    });
    // The IngestStore constructor marks any job left mid-flight by a restart
    // as "interrupted"; resume() then drains anything still queued.
    this.ingestStore = new IngestStore(join(dataDir, "ingest.sqlite"));
    this.ingestQueue = new IngestQueue(this.ingestStore, this.settings, () => this.getEngine());
    // Long agentic MCP jobs (task_brain, run_task) enqueue here and the caller
    // polls — the same durable-queue + boot-recovery shape as ingest. The store
    // constructor marks any job left mid-flight by a restart as "interrupted";
    // resume() then drains anything still queued.
    this.taskJobStore = new TaskJobStore(join(dataDir, "tasks.sqlite"));
    this.taskJobQueue = new TaskJobQueue(this.taskJobStore, () => this.getEngine());
    this.usageStore = new UsageStore(join(dataDir, "usage.sqlite"));
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
      // GitHub App installation tokens (short-lived, repo-scoped) win over a PAT.
      // Resolve the installation that owns the vault repo (per-repo), so an agent
      // whose vault lives in a different org than the stored installation still
      // clones/pushes correctly — same resolution the issue tools use.
      ...(hasApp ? { tokenProvider: () => installationTokenForRepo(this.settings, repoName) } : { token: token! }),
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
    // Vaultless agents (the Console shell) boot the engine with no vault: only an
    // LLM key is required, no vault/tasking/drive tools. Vault agents are unchanged.
    const vaultless = this.agent.vaultless === true;
    const backlog = this.agent.backlog === true;
    if (backlog) {
      // Backlog agent (Archus): needs an LLM key + GitHub access, but NO vault.
      if (!this.settings.activeApiKey() || !(this.settings.get("github_token") || this.settings.hasGithubApp())) {
        throw new NotConfiguredError();
      }
    } else if (vaultless) {
      if (!this.settings.activeApiKey()) throw new NotConfiguredError();
    } else if (!this.settings.configured()) {
      throw new NotConfiguredError();
    }

    const repo = vaultless ? null : await this.getRepo();
    const llm = createBrainLlm({
      provider: this.settings.provider(),
      apiKey: this.settings.activeApiKey()!,
      ...(this.settings.get("model_ask") ? { askModel: this.settings.get("model_ask")! } : {}),
      ...(this.settings.get("model_classify") ? { classifyModel: this.settings.get("model_classify")! } : {}),
      ...(this.settings.maxSteps() !== undefined ? { maxSteps: this.settings.maxSteps() } : {}),
      // Always persist real per-call token usage for cost analytics (GET
      // /api/usage). ZENOD_LLM_COST_LOG=1 additionally tails it to stdout.
      onUsage: (report) => {
        this.usageStore.record(report);
        if (process.env.ZENOD_LLM_COST_LOG === "1") logLlmUsage(report);
      },
    });
    // The chat/MCP Drive tools enqueue onto the background ingest queue.
    const driveTools = vaultless ? null : buildDriveTools(this.settings, this.ingestQueue);
    // Mesh: peer-agent delegation tools, available to any agent (vault or not).
    const peerTools = this.buildPeerTools();
    this.engine = createEngine({
      ...(repo ? { repo } : {}),
      llm,
      state: this.state,
      persona: this.agent.persona,
      ...(repo
        ? {
            location: {
              repo: this.settings.get("vault_repo")!,
              branch: this.settings.get("vault_branch") ?? "main",
            },
          }
        : {}),
      ...(driveTools ? { driveTools } : {}),
      // GitHub tasking tools for vault agents AND backlog agents (Archus) — not the Console.
      ...(vaultless && !backlog ? {} : { taskingTools: this.buildTaskingTools() }),
      ...(Object.keys(peerTools).length ? { peerTools } : {}),
      ...(process.env.ZENOD_LLM_COST_LOG === "1" ? { onTokenCost: logTokenCost } : {}),
    });
    return this.engine;
  }

  /**
   * The mesh: turn each configured peer into a delegation tool the chat loop can
   * call (`ask_<name>`), forwarding over MCP via callPeer. Available to any agent;
   * it's how the vaultless Console answers memory questions by asking Zenod.
   */
  private buildPeerTools(): Record<string, { description: string; run: (input: string) => Promise<string> }> {
    const tools: Record<string, { description: string; run: (input: string) => Promise<string> }> = {};
    for (const peer of this.settings.peers()) {
      const safe = peer.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      // A peer either declares a curated tool set (e.g. Zenod's memory toolset) or
      // gets a single ask_<name> delegation to its ask_brain.
      const specs =
        peer.tools && peer.tools.length > 0
          ? peer.tools
          : [
              {
                as: `ask_${safe}`,
                mcp: "ask_brain",
                arg: "question",
                description: `Delegate a request to the "${peer.name}" peer agent and return its answer. Use it for that agent's domain — e.g. the user's memory/vault if it is a memory agent.`,
              },
            ];
      for (const spec of specs) {
        tools[spec.as] = {
          description: spec.description,
          run: (input: string) => callPeer(peer, spec.mcp, spec.arg, input),
        };
      }
    }
    return tools;
  }

  private async githubToken(repo?: string): Promise<string | null> {
    if (this.settings.hasGithubApp()) {
      return repo ? installationTokenForRepo(this.settings, repo) : installationToken(this.settings);
    }
    return this.settings.get("github_token");
  }

  private buildTaskingTools(): ExternalTaskingTools {
    // Vault agents default to the vault repo; a backlog agent (Archus, no vault)
    // defaults to its central backlog repo.
    const defaultRepo = () => this.settings.get("vault_repo") || this.settings.getRaw("backlog_repo") || "";
    const githubJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)/);
      const token = await this.githubToken(repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : undefined);
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

    // Best-effort instant refresh: the agent-runner's monitor exposes POST /poke
    // for an immediate scan instead of waiting up to one poll interval (~2 min).
    // Fire-and-forget; if the runner is unreachable or unset, the poll still
    // picks the work up. Set ZENOD_RUNNER_POKE_URL (e.g. http://zenod-agent-runner:8787).
    const pokeRunner = (): void => {
      const base = process.env.ZENOD_RUNNER_POKE_URL?.trim();
      if (!base) return;
      void fetch(`${base.replace(/\/$/, "")}/poke`, {
        method: "POST",
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
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
      // Revise an existing issue in place. Delegates to the shared editGithubIssue
      // (githubApp.ts) so the chat surface gets the exact same queue/merge gating
      // as the MCP edit_github_issue tool: status:queued and status:approved-merge
      // can never be set here — they stay owned by approveQueue/approveMerge.
      editIssue: async ({ repo, issueNumber, title, body, labelsAdd, labelsRemove, labelsSet, comment, status }) => {
        const result = await editGithubIssue(this.settings, {
          ...(repo ? { repo } : {}),
          issueNumber,
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(labelsAdd ? { labelsAdd } : {}),
          ...(labelsRemove ? { labelsRemove } : {}),
          ...(labelsSet ? { labelsSet } : {}),
          ...(comment ? { comment } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        const ops = result.operations.length ? result.operations.join(", ") : "no changes";
        return `Edited #${result.issueNumber} (${ops}): ${result.issueUrl}`;
      },
      queryBacklog,
      serviceBacklog: async (query?: string) =>
        ["Backlog service selection only; runner is tracked separately.", await queryBacklog(query)].join("\n"),
      // The only path that sets status:queued (#58) — explicit human approval.
      // Removes status:proposed (404 is fine if absent) and adds the complete
      // runnable label set consumed by the monitor.
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
            body: JSON.stringify({ labels: [OWNER_AGENT, STATUS_QUEUED] }),
          });
          queued.push(n);
        }
        pokeRunner(); // instant refresh instead of waiting for the monitor's ~2-min poll
        const links = queued.map((n) => `#${n}: https://github.com/${target}/issues/${n}`).join("\n");
        return `Queued ${queued.map((n) => `#${n}`).join(", ")} — poked the runner to start now (falls back to its poll).\n${links}`;
      },
      // The only path that sets status:approved-merge — explicit human approval.
      // Removes status:needs-review (404 fine if absent) and adds approved-merge.
      // The controller (monitor) merges the PR on green CI and reports back.
      approveMerge: async ({ repo, issueNumbers }) => {
        const target = repo || defaultRepo();
        if (!target) return "No GitHub repository is configured.";
        const repoPath = encodeURIComponent(target).replace("%2F", "/");
        const approved: number[] = [];
        for (const n of issueNumbers) {
          await githubJson(`/repos/${repoPath}/issues/${n}/labels/${encodeURIComponent(STATUS_NEEDS_REVIEW)}`, {
            method: "DELETE",
          }).catch(() => {});
          await githubJson(`/repos/${repoPath}/issues/${n}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels: [STATUS_APPROVED_MERGE] }),
          });
          approved.push(n);
        }
        const links = approved.map((n) => `#${n}: https://github.com/${target}/issues/${n}`).join("\n");
        return `Approved merge for ${approved.map((n) => `#${n}`).join(", ")} — the controller will merge on green CI and report back.\n${links}`;
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
    void this.telegram.close();
    this.state.close();
    this.whatsappStore.close();
    this.ingestStore.close();
    this.taskJobStore.close();
    this.usageStore.close();
  }
}

/** One-line real-usage tail (opt-in via ZENOD_LLM_COST_LOG=1). */
function logLlmUsage(report: LlmUsageReport): void {
  console.log(
    [
      "[llm-usage]",
      `operation=${report.operation}`,
      `model=${report.model}`,
      `input=${report.inputTokens}`,
      `output=${report.outputTokens}`,
      `cache_read=${report.cachedInputTokens}`,
      `cache_write=${report.cacheCreationInputTokens}`,
    ].join(" "),
  );
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
  const bearer = { Authorization: `Bearer ${apiKey}` };
  const config: { url: string; headers: Record<string, string>; name: string } =
    provider === "openai"
      ? { url: "https://api.openai.com/v1/models", headers: bearer, name: "OpenAI" }
      : provider === "openrouter"
        ? { url: "https://openrouter.ai/api/v1/models", headers: bearer, name: "OpenRouter" }
        : provider === "groq"
          ? { url: "https://api.groq.com/openai/v1/models", headers: bearer, name: "Groq" }
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
