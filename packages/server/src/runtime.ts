import { join } from "node:path";
import { rm } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
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
  conversationId,
  type BrainEngine,
  type ConversationMessage,
  type CleanSlateResult,
  type ExternalTaskingTools,
  type LintReport,
  type LlmUsageReport,
  type PeerTools,
  type TaskingInput,
  type TokenCostMeasurement,
} from "zenod";
import { installationToken, installationTokenForRepo, editGithubIssue, mintExecutionIssue, setExecutionState } from "zenod";
import { z, type ZodTypeAny } from "zod";
import { ZENOD_AGENT, type AgentDefinition } from "./agent.js";
import { ExecutionQueue } from "./executionQueue.js";
import { buildExecutionQueue } from "./executionLane.js";
import { buildDriveTools } from "./driveTools.js";
import { buildOutboundTools } from "./outboundTools.js";
import { buildNotifierTools } from "./notifierTools.js";
import { IngestStore } from "./ingestStore.js";
import { UsageStore } from "./usageStore.js";
import { IngestQueue } from "./ingestQueue.js";
import { TaskJobStore } from "./taskJobStore.js";
import { TaskJobQueue } from "./taskJobQueue.js";
import { ExecutionStore } from "./executionStore.js";
import { OAuthStore } from "./oauthStore.js";
import { callPeer, callPeerWithArgs } from "./peerClient.js";
import { formatConversationTranscript, transcriptQueryFromToolArgs } from "./conversationTranscript.js";
import { GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE, V4_FIND_ISSUE_SHAPE, V4_GET_ISSUE_SHAPE, V4_LIST_ISSUES_SHAPE } from "./mcpToolSchemas.js";
import { Settings, type Provider } from "./settings.js";
import { WhatsAppGateway } from "./whatsappGateway.js";
import { WhatsAppStore } from "./whatsappStore.js";
import { TelegramGateway } from "./telegramGateway.js";
import { evidence, type ToolResponse, toolResponse } from "./toolOutput.js";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";

export class NotConfiguredError extends Error {
  constructor() {
    super("Zenod is not configured yet — set vault repo, GitHub token, and Anthropic key in settings");
  }
}

const CONSOLE_PARENT_CONVERSATION_KEY = "default";
const MAX_PEER_CONTEXT_MESSAGES = 8;
const MAX_PEER_CONTEXT_CHARS = 400;

function peerToolInputSchema(schemaKey?: string): ZodTypeAny | undefined {
  switch (schemaKey) {
    case "archus.get_issue":
      return z.object(V4_GET_ISSUE_SHAPE);
    case "archus.find_issue":
      return z.object(V4_FIND_ISSUE_SHAPE);
    case "archus.list_issues":
      return z.object(V4_LIST_ISSUES_SHAPE);
    case "zenod.get_recent_conversation_transcript":
      return z.object(GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE);
    default:
      return undefined;
  }
}

type GitHubIssueRead = {
  number: number;
  title: string;
  html_url: string;
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  state: string;
  body?: string | null;
  pull_request?: unknown;
};

type GitHubCommentRead = { body?: string | null; html_url?: string; created_at?: string };

export function consolePeerConversationKey(parentConversationId: string, peerName: string): string {
  return `${parentConversationId.replace(/[^a-z0-9_-]+/gi, "-")}-${peerName.replace(/[^a-z0-9_-]+/gi, "-")}`;
}

export function formatConsolePeerDelegation(input: string, options: { parentConversationId: string; peerName: string; messages: ConversationMessage[] }): string {
  const recent = options.messages.slice(-MAX_PEER_CONTEXT_MESSAGES);
  const excerpt = recent
    .map((message) => {
      const speaker = message.role === "user" ? "user" : "Console";
      const text = message.text.replace(/\s+/g, " ").trim().slice(0, MAX_PEER_CONTEXT_CHARS);
      return `${speaker}: ${text}`;
    })
    .join("\n");
  return [
    `Parent Console conversation: ${options.parentConversationId}`,
    `You are ${options.peerName}. The bounded excerpt below is recent Console thread context, not durable memory.`,
    excerpt ? `Recent Console thread:\n${excerpt}` : "Recent Console thread: (empty)",
    "",
    `Current request to ${options.peerName}:`,
    input,
  ].join("\n");
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
  readonly executionStore: ExecutionStore;
  readonly usageStore: UsageStore;
  /** The executor's queue (Epaminon only) — the state authority for the execution
   *  lane. Null on every other agent. Wired to the protocol seams in executionLane. */
  readonly executionQueue: ExecutionQueue | null;
  private engine: BrainEngine | null = null;
  private repo: VaultRepo | null = null;
  private readonly taskingContext = new AsyncLocalStorage<{ parentConversationId: string; rawEvidence?: TaskingInput["rawEvidence"] }>();

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
      recordAssistantMessage: (event, text) =>
        this.state.appendMessage(
          conversationId("whatsapp", normalizeWhatsAppIdentifier(event.senderId) || event.senderId),
          "assistant",
          text,
          "whatsapp",
        ),
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
    this.executionStore = new ExecutionStore(join(dataDir, "execution.sqlite"));
    this.usageStore = new UsageStore(join(dataDir, "usage.sqlite"));
    // The executor (Epaminon) owns an execution queue; no other agent does.
    this.executionQueue = agent.executor === true ? buildExecutionQueue(this.settings, this.executionStore) : null;
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
    // The executor (Epaminon) is vaultless and owns NO repo: it never writes GitHub
    // (the runner does the code work; Archus owns the backlog). Its engine is a plain
    // chat brain — no vault, no backlog tasking tools — and it just needs an LLM key.
    // Its execution work flows through the ExecutionQueue + the /api/exec lane, not the
    // engine. So it is NOT githubBacked.
    const githubBacked = backlog;
    // The Callistheness agent is vaultless and owns no repo; it just needs an LLM key.
    // Its send tools are wired below into the same generic tool slot the mesh uses.
    const outbound = this.agent.outbound === true;
    if (githubBacked) {
      // Backlog agent (Archus) / executor (Epaminon): needs an LLM key + GitHub
      // access, but NO vault.
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
      ...(this.settings.get("model_vision") ? { visionModel: this.settings.get("model_vision")! } : {}),
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
    // Callistheness's private send tools (post_tweet/post_reddit/send_email) ride the
    // same generic tool slot — its guardian brain wields them and confirms first.
    if (outbound) Object.assign(peerTools, buildOutboundTools());
    if (this.agent.notifier === true) Object.assign(peerTools, buildNotifierTools());
    const engine = createEngine({
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
      // GitHub tasking tools for vault agents and backlog agents (Archus) — NOT the
      // bare Console, NOT the executor (Epaminon writes no backlog), NOT Callistheness.
      ...(vaultless && !githubBacked ? {} : { taskingTools: this.buildTaskingTools() }),
      ...(Object.keys(peerTools).length ? { peerTools } : {}),
      ...(process.env.ZENOD_LLM_COST_LOG === "1" ? { onTokenCost: logTokenCost } : {}),
    });
    this.engine = {
      ...engine,
      handleTasking: (input) =>
        this.taskingContext.run(
          {
            parentConversationId: conversationId(input.surface, input.conversationKey),
            ...(input.rawEvidence ? { rawEvidence: input.rawEvidence } : {}),
          },
          () => engine.handleTasking(input),
        ),
    };
    return this.engine;
  }

  /**
   * The mesh: turn each configured peer into a delegation tool the chat loop can
   * call (`ask_<name>`), forwarding over MCP via callPeer. Available to any agent;
   * it's how the vaultless Console answers memory questions by asking Zenod.
   */
  private buildPeerTools(): PeerTools {
    const tools: PeerTools = {};
    const shouldForwardConsoleContext = this.agent.name === "console";
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
        const inputSchema = peerToolInputSchema(spec.inputSchema);
        tools[spec.as] = {
          description: spec.description,
          ...(inputSchema ? { inputSchema } : {}),
          run: async (input: string | Record<string, unknown>) => {
            if (inputSchema) {
              const args = typeof input === "object" && input !== null ? input : { [spec.arg]: String(input ?? "") };
              if (this.agent.name === "console" && spec.mcp === "get_recent_conversation_transcript") {
                return formatConversationTranscript(this.whatsappStore.recentTranscript(transcriptQueryFromToolArgs(args)));
              }
              const rawEvidence = this.taskingContext.getStore()?.rawEvidence;
              if (rawEvidence && spec.mcp === "store_memory") {
                const hints = [
                  ...(Array.isArray(args.hints) ? args.hints.filter((hint): hint is string => typeof hint === "string") : []),
                  ...(rawEvidence.hints ?? []),
                ];
                return callPeerWithArgs(peer, spec.mcp, {
                  ...args,
                  content: rawEvidence.content,
                  verbatim: true,
                  ...(hints.length ? { hints } : {}),
                });
              }
              return callPeerWithArgs(peer, spec.mcp, args);
            }
            const textInput = typeof input === "string" ? input : String(input.input ?? "");
            const rawEvidence = this.taskingContext.getStore()?.rawEvidence;
            if (rawEvidence && spec.mcp === "store_memory") {
              const hints = rawEvidence.hints ?? [];
              return callPeerWithArgs(peer, spec.mcp, {
                content: rawEvidence.content,
                verbatim: true,
                ...(hints.length ? { hints } : {}),
              });
            }
            if (!shouldForwardConsoleContext || !spec.mcp.startsWith("chat_with_")) {
              return callPeer(peer, spec.mcp, spec.arg, textInput);
            }
            const parentConversationId = this.taskingContext.getStore()?.parentConversationId ?? conversationId("web", CONSOLE_PARENT_CONVERSATION_KEY);
            const window = await this.state.recentWindow(parentConversationId);
            const message = formatConsolePeerDelegation(textInput, {
              parentConversationId,
              peerName: peer.name,
              messages: window,
            });
            return callPeer(peer, spec.mcp, spec.arg, message, {
              surface: "web",
              conversationKey: consolePeerConversationKey(parentConversationId, peer.name),
            });
          },
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

  private async githubJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  }

  buildBacklogIssueReader() {
    const defaultRepo = () => this.settings.get("vault_repo") || this.settings.getRaw("backlog_repo") || "";
    const repoPath = (repo: string) => encodeURIComponent(repo).replace("%2F", "/");
    const parseTarget = (target: string): { repo: string; number: number } | null => {
      const match = target.trim().match(/^([^#\s]+\/[^#\s]+)#(\d+)$/);
      return match ? { repo: match[1]!, number: Number(match[2]) } : null;
    };
    const issueTarget = (repo: string, issue: { number: number }): string => `${repo}#${issue.number}`;
    const labelsOf = (issue: { labels?: Array<{ name: string }> }): string[] => (issue.labels ?? []).map((label) => label.name);
    const formatIssueLine = (repo: string, issue: GitHubIssueRead): string => {
      const labels = labelsOf(issue);
      const labelText = labels.length ? `; labels: ${labels.join(", ")}` : "";
      const updated = issue.updated_at ? `; updated: ${issue.updated_at}` : "";
      return `${issueTarget(repo, issue)} - ${issue.title} - state: ${issue.state}${labelText}${updated} - ${issue.html_url}`;
    };
    const formatIssueReadText = (repo: string, issue: GitHubIssueRead, comments: GitHubCommentRead[]): string => {
      const body = issue.body?.replace(/\s+/g, " ").trim();
      const bodyLine = body ? `Body: ${body.slice(0, 1000)}${body.length > 1000 ? "..." : ""}` : "Body: (empty)";
      const commentLines = comments
        .slice(-3)
        .map((comment) => comment.body?.replace(/\s+/g, " ").trim())
        .filter((body): body is string => Boolean(body))
        .map((body, index) => `Recent comment ${index + 1}: ${body.slice(0, 500)}${body.length > 500 ? "..." : ""}`);
      return [formatIssueLine(repo, issue), bodyLine, ...commentLines].join("\n");
    };
    const issueEvidence = (repo: string, issue: GitHubIssueRead, comments: GitHubCommentRead[] = []) =>
      evidence("issue", {
        target: issueTarget(repo, issue),
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        labels: labelsOf(issue),
        url: issue.html_url,
        comments: comments
          .slice(-5)
          .map((comment) => ({
            body: comment.body ?? "",
            url: comment.html_url ?? "",
            createdAt: comment.created_at ?? "",
          }))
          .filter((comment) => comment.body || comment.url || comment.createdAt),
      });
    const issueSummary = (repo: string, issue: GitHubIssueRead) => ({
      target: issueTarget(repo, issue),
      title: issue.title,
      state: issue.state,
      labels: labelsOf(issue),
      url: issue.html_url,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    });
    const readIssue = async (repo: string, number: number): Promise<GitHubIssueRead> =>
      this.githubJson<GitHubIssueRead>(`/repos/${repoPath(repo)}/issues/${number}`);
    const readComments = async (repo: string, number: number): Promise<GitHubCommentRead[]> =>
      this.githubJson<GitHubCommentRead[]>(`/repos/${repoPath(repo)}/issues/${number}/comments?per_page=20`).catch(() => []);
    const listRepoIssues = async (repo: string, state = "open", limit = 20): Promise<GitHubIssueRead[]> =>
      this.githubJson<GitHubIssueRead[]>(
        `/repos/${repoPath(repo)}/issues?state=${encodeURIComponent(state)}&per_page=${Math.min(Math.max(limit, 1), 100)}&sort=updated&direction=desc`,
      );
    const matchesLabels = (issue: GitHubIssueRead, labels: string[] | undefined): boolean => {
      if (!labels?.length) return true;
      const names = new Set(labelsOf(issue));
      return labels.every((label) => names.has(label));
    };
    const matchesSince = (value: string, since?: string): boolean => {
      if (!since) return true;
      const parsed = Date.parse(since);
      return !Number.isFinite(parsed) || Date.parse(value) >= parsed;
    };
    const candidateFromIssue = (repo: string, issue: GitHubIssueRead, matchReason: string, confidence: number) => ({
      target: issueTarget(repo, issue),
      title: issue.title,
      url: issue.html_url,
      matchReason,
      confidence,
    });
    const issueNumberReference = (reference: string): number | null => {
      const trimmed = reference.trim();
      const exactNumber = trimmed.match(/^#?(\d+)$/)?.[1];
      if (exactNumber) return Number(exactNumber);
      const phrasedNumber = trimmed.match(/\b(?:issue|ticket|github issue|backlog issue|number|no\.?)\s*#?(\d+)\b/i)?.[1];
      return phrasedNumber ? Number(phrasedNumber) : null;
    };

    return {
      getIssue: async ({ target }: { target: string }): Promise<ToolResponse> => {
        const parsed = parseTarget(target);
        if (!parsed) {
          return toolResponse({
            text: `Invalid issue target: ${target}`,
            errors: [{ code: "invalid_target", message: "target must be an exact owner/repo#123 issue reference" }],
          });
        }
        try {
          const issue = await readIssue(parsed.repo, parsed.number);
          const comments = await readComments(parsed.repo, parsed.number);
          return toolResponse({
            text: formatIssueReadText(parsed.repo, issue, comments),
            evidence: [issueEvidence(parsed.repo, issue, comments)],
          });
        } catch (error) {
          return toolResponse({
            text: `${target} was not found in GitHub.`,
            errors: [{ code: "issue_not_found", message: error instanceof Error ? error.message : String(error) }],
          });
        }
      },
      listIssues: async ({
        repo,
        state = "open",
        labels,
        createdSince,
        updatedSince,
        limit = 20,
      }: {
        repo?: string;
        state?: "open" | "closed" | "all";
        labels?: string[];
        createdSince?: string;
        updatedSince?: string;
        limit?: number;
      }): Promise<ToolResponse> => {
        const targetRepo = repo || defaultRepo();
        if (!targetRepo) {
          return toolResponse({
            text: "No GitHub repository is configured.",
            errors: [{ code: "repo_not_configured", message: "No backlog or vault repo is configured." }],
          });
        }
        const issues = (await listRepoIssues(targetRepo, state, limit))
          .filter((issue) => matchesLabels(issue, labels))
          .filter((issue) => matchesSince(issue.created_at, createdSince))
          .filter((issue) => matchesSince(issue.updated_at, updatedSince))
          .slice(0, limit);
        const filters = { repo: targetRepo, state, labels: labels ?? [], createdSince: createdSince ?? "", updatedSince: updatedSince ?? "", limit };
        const issueLines = issues.map((issue) => formatIssueLine(targetRepo, issue));
        return toolResponse({
          text: [
            `Found ${issues.length} issue${issues.length === 1 ? "" : "s"} in ${targetRepo}.`,
            ...issueLines,
          ].join("\n"),
          evidence: [
            evidence("issue_list", {
              filters,
              issues: issues.map((issue) => issueSummary(targetRepo, issue)),
            }),
          ],
        });
      },
      findIssue: async ({
        reference,
        repos,
        recentWindow = "all",
        labels,
        limit = 10,
      }: {
        reference: string;
        repos?: string[];
        recentWindow?: string;
        labels?: string[];
        limit?: number;
      }): Promise<ToolResponse> => {
        const searchedRepos = repos?.length ? repos : [defaultRepo()].filter(Boolean);
        if (searchedRepos.length === 0) {
          return toolResponse({
            text: "No GitHub repository is configured.",
            evidence: [evidence("issue_not_found", { searchedRepos: [], searchedWindow: recentWindow, candidates: [] })],
          });
        }

        const explicit = parseTarget(reference);
        const exactCandidates = [];
        const numberToRead = explicit?.number ?? issueNumberReference(reference);
        const exactRepos = explicit ? [explicit.repo] : searchedRepos;
        if (numberToRead) {
          for (const repo of exactRepos) {
            try {
              const issue = await readIssue(repo, numberToRead);
              if (matchesLabels(issue, labels)) exactCandidates.push(candidateFromIssue(repo, issue, "number match", explicit ? 1 : 0.9));
            } catch {
              // Keep searching every requested repo before returning not-found evidence.
            }
          }
        }

        const normalized = reference.trim().toLowerCase();
        const fuzzyCandidates = [];
        if (exactCandidates.length === 0 && normalized) {
          for (const repo of searchedRepos) {
            const issues = await listRepoIssues(repo, "all", 100).catch(() => []);
            for (const issue of issues) {
              if (!matchesLabels(issue, labels)) continue;
              const haystack = [issue.title, issue.body ?? "", labelsOf(issue).join(" "), issue.html_url].join(" ").toLowerCase();
              if (!haystack.includes(normalized)) continue;
              fuzzyCandidates.push(candidateFromIssue(repo, issue, "title/body/label match", 0.65));
              if (fuzzyCandidates.length >= limit) break;
            }
          }
        }

        const candidates = [...exactCandidates, ...fuzzyCandidates].slice(0, limit);
        if (candidates.length === 1) {
          const only = candidates[0]!;
          return toolResponse({
            text: `Resolved ${reference} to ${only.target}: ${only.url}`,
            evidence: [evidence("issue_resolved", { target: only.target, url: only.url, confidence: only.confidence ?? 0.8 })],
          });
        }
        if (candidates.length > 1) {
          const candidateLines = candidates.map((candidate) =>
            `${candidate.target} - ${candidate.title} - ${candidate.url}`,
          );
          return toolResponse({
            text: [
              `Found ${candidates.length} candidate issues for ${reference}; choose one before mutating anything.`,
              ...candidateLines,
            ].join("\n"),
            candidates,
          });
        }
        return toolResponse({
          text: `No issue matched ${reference}.`,
          evidence: [evidence("issue_not_found", { searchedRepos, searchedWindow: recentWindow, candidates: [] })],
        });
      },
    };
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

    type GitHubIssue = {
      number: number;
      title: string;
      html_url: string;
      labels: Array<{ name: string }>;
      updated_at: string;
      state?: string;
      body?: string | null;
      pull_request?: unknown;
    };
    type GitHubComment = { body?: string | null; html_url?: string; created_at?: string };
    const issueLookupRefs = (queryText: string | undefined, fallbackRepo: string): Array<{ repo: string; number: number; kind: "issue" | "pr" }> => {
      if (!queryText?.trim()) return [];
      const refs: Array<{ repo: string; number: number; kind: "issue" | "pr" }> = [];
      const repoContext = queryText.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/)?.[1] ?? fallbackRepo;
      for (const match of queryText.matchAll(/\b(?:pr|pull request)\s*#(\d+)\b/gi)) {
        refs.push({ repo: repoContext, number: Number(match[1]), kind: "pr" });
      }
      for (const match of queryText.matchAll(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g)) {
        refs.push({ repo: match[1]!, number: Number(match[2]), kind: "issue" });
      }
      for (const match of queryText.matchAll(/#(\d+)\b/g)) {
        const number = Number(match[1]);
        if (!refs.some((ref) => ref.number === number)) refs.push({ repo: repoContext, number, kind: "issue" });
      }
      const bare = queryText.match(/^\s*(\d+)\s*$/)?.[1];
      if (bare && !refs.some((ref) => ref.number === Number(bare))) refs.push({ repo: fallbackRepo, number: Number(bare), kind: "issue" });
      return refs.filter(
        (ref, index, all) =>
          ref.repo && all.findIndex((other) => other.repo === ref.repo && other.number === ref.number && other.kind === ref.kind) === index,
      );
    };
    const formatIssue = (issue: GitHubIssue, comments: GitHubComment[] = []): string => {
      const labels = issue.labels.map((label) => label.name).join(", ");
      const kind = issue.pull_request ? "Pull request" : "Issue";
      const state = issue.state ? issue.state.toUpperCase() : "UNKNOWN";
      const commentLines = comments
        .slice(-3)
        .map((comment) => comment.body?.replace(/\s+/g, " ").trim())
        .filter((body): body is string => Boolean(body))
        .map((body) => `  comment: ${body.slice(0, 300)}${body.length > 300 ? "…" : ""}`);
      return [
        `#${issue.number} ${kind}: ${issue.title} [${state}${labels ? `; ${labels}` : ""}] — updated ${issue.updated_at} — ${issue.html_url}`,
        ...commentLines,
      ].join("\n");
    };
    const queryBacklog = async (query?: string): Promise<string> => {
      const repo = defaultRepo();
      if (!repo) return "No GitHub repository is configured.";
      const q = query?.trim();
      const explicitRefs = issueLookupRefs(q, repo);
      if (explicitRefs.length > 0) {
        const lines = await Promise.all(
          explicitRefs.map(async (ref) => {
            try {
              if (ref.kind === "pr") {
                const pullUrl = `https://github.com/${ref.repo}/pull/${ref.number}`;
                try {
                  const pull = await githubJson<{ number: number; title: string; html_url: string; state: string; updated_at: string }>(
                    `/repos/${encodeURIComponent(ref.repo).replace("%2F", "/")}/pulls/${ref.number}`,
                  );
                  return `${ref.repo}#${pull.number} Pull request: ${pull.title} [${pull.state.toUpperCase()}] — updated ${pull.updated_at} — ${pull.html_url}`;
                } catch (error) {
                  return `${ref.repo}#${ref.number} Pull request: ${pullUrl} (PR metadata unavailable to the current GitHub token: ${
                    error instanceof Error ? error.message : String(error)
                  })`;
                }
              }
              const issue = await githubJson<GitHubIssue>(
                `/repos/${encodeURIComponent(ref.repo).replace("%2F", "/")}/issues/${ref.number}`,
              );
              const comments = await githubJson<GitHubComment[]>(
                `/repos/${encodeURIComponent(ref.repo).replace("%2F", "/")}/issues/${ref.number}/comments?per_page=20`,
              ).catch(() => []);
              return `${ref.repo}${formatIssue(issue, comments).replace(/^#/, "#")}`;
            } catch (error) {
              return `${ref.repo}#${ref.number}: not found (${error instanceof Error ? error.message : String(error)})`;
            }
          }),
        );
        return [`Issue lookup${q ? ` matching "${q}"` : ""}: ${lines.length}`, ...lines].join("\n");
      }
      const issues = await githubJson<
        GitHubIssue[]
      >(`/repos/${encodeURIComponent(repo).replace("%2F", "/")}/issues?state=open&per_page=100&sort=updated&direction=desc`);
      const filtered = q
        ? issues.filter(
            (issue) => `${issue.title} ${issue.labels.map((label) => label.name).join(" ")}`.toLowerCase().includes(q.toLowerCase()),
          )
        : issues;
      if (filtered.length === 0) return query ? `No open issues matched "${query}".` : "No open issues found.";
      return [
        `Open issues${query ? ` matching "${query}"` : ""}: ${filtered.length}`,
        ...filtered.slice(0, 10).map((issue) => formatIssue(issue)),
      ].join("\n");
    };

    const parseQualifiedIssue = (target: string): { repo: string; number: number } => {
      const match = target.trim().match(/^([^#\s]+\/[^#\s]+)#(\d+)$/);
      if (!match) throw new Error("queue_execution target must be a qualified issue id like owner/repo#123");
      return { repo: match[1]!, number: Number(match[2]) };
    };
    const issueLabelNames = (issue: { labels?: Array<{ name: string }> }): string[] => (issue.labels ?? []).map((label) => label.name);
    const validateRunnableIssue = (issue: { number: number; title?: string; body?: string; labels?: Array<{ name: string }> }): string[] => {
      const body = issue.body ?? "";
      const names = issueLabelNames(issue);
      const failures: string[] = [];
      if (!issue.title?.trim()) failures.push("missing title");
      if (!body.trim()) failures.push("missing body");
      if (!names.includes(OWNER_AGENT)) failures.push(`missing ${OWNER_AGENT} label`);
      const actionLabels = new Set(["twitter", "x", "social", "post", "action", "announcement"]);
      const isActionTicket = names.some((name) => actionLabels.has(name.toLowerCase()));
      if (!isActionTicket) {
        const hasPathRefs = /(\b(?:packages|apps|src|scripts|lib|test|tests)\/[\w./-]+|\w+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|md))/i.test(body);
        if (!/(acceptance criteria|done when|requirements?|test[s]? \/ verification|verification|deliverables?|outcomes?|definition of done)/i.test(body)) {
          failures.push("missing acceptance criteria or clear done condition");
        }
        if (!/(scope|out of scope|requirements?|deliverables?)/i.test(body) && !hasPathRefs) {
          failures.push("missing scope boundaries");
        }
        if (!/(source basis|source refs?|source context|log\/|projects\/|notes\/|github)/i.test(body) && !hasPathRefs) {
          failures.push("missing source context references");
        }
      }
      return failures;
    };
    const hydratedExecutionContext = (
      target: string,
      issue: { title: string; body?: string; html_url: string; labels?: Array<{ name: string }> },
      requestedContext: string,
    ): string =>
      [
        `Target: ${target}`,
        `Target URL: ${issue.html_url}`,
        `Target title: ${issue.title}`,
        `Target labels: ${issueLabelNames(issue).join(", ") || "(none)"}`,
        "",
        "Archus run note:",
        requestedContext,
        "",
        "Target issue body:",
        issue.body?.trim() || "(empty)",
      ].join("\n");

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
      editIssue: async ({ repo, issueNumber, title, body, labelsAdd, labelsRemove, labelsSet, comment, status, state, stateReason }) => {
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
          ...(state !== undefined ? { state } : {}),
          ...(stateReason !== undefined ? { stateReason } : {}),
        });
        const ops = result.operations.length ? result.operations.join(", ") : "no changes";
        return `Edited #${result.issueNumber} (${ops}): ${result.issueUrl}`;
      },
      closeIssue: async ({ repo, issueNumber, comment, notPlanned }) => {
        const result = await editGithubIssue(this.settings, {
          ...(repo ? { repo } : {}),
          issueNumber,
          state: "closed",
          stateReason: notPlanned ? "not_planned" : "completed",
          ...(comment ? { comment } : {}),
        });
        return `Closed #${result.issueNumber}: ${result.issueUrl}`;
      },
      queueExecution: async ({ target, title, context, repo }) => {
        const parsedTarget = parseQualifiedIssue(target);
        const targetIssue = await githubJson<{
          number: number;
          title: string;
          body: string;
          html_url: string;
          labels: Array<{ name: string }>;
        }>(`/repos/${encodeURIComponent(parsedTarget.repo).replace("%2F", "/")}/issues/${parsedTarget.number}`);
        const failures = validateRunnableIssue(targetIssue);
        if (failures.length > 0) {
          throw new Error(`target ${target} is not runnable: ${failures.join("; ")}`);
        }
        const hydratedContext = hydratedExecutionContext(target, targetIssue, context);
        // Mint the execution ticket (exec:queued) — minting IS queuing.
        const minted = await mintExecutionIssue(this.settings, {
          ...(repo ? { repo } : {}),
          title,
          context: hydratedContext,
          target,
        });
        // Best-effort dispatch to Epaminon over the internal lane. Until the Console
        // cross-provisions exec_lane_secret (and Epaminon's enqueue receiver is up),
        // the ticket is still minted and visible — we just report it as awaiting.
        const secret = this.settings.getRaw("exec_lane_secret");
        const base = (this.settings.getRaw("epaminon_base_url") || "http://zenod-epaminon:8080").replace(/\/$/, "");
        let dispatched = false;
        if (secret) {
          dispatched = await fetch(`${base}/api/exec/enqueue`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
            body: JSON.stringify({ execution_id: minted.executionId, target, context: hydratedContext }),
            signal: AbortSignal.timeout(4000),
          })
            .then((r) => r.ok)
            .catch(() => false);
        }
        return `Minted execution ticket ${minted.repo}#${minted.executionId} (exec:queued) for ${target}${
          dispatched ? " and dispatched to Epaminon" : " — awaiting Epaminon dispatch (execution lane not yet provisioned)"
        }: ${minted.issueUrl}`;
      },
      approveExecution: async ({ executionId, finalContent, repo }) => {
        // Flip the exec ticket to exec:approved (the human's go), then dispatch to
        // Epaminon to ship the outward outcome (merge/send).
        const res = await setExecutionState(this.settings, { ...(repo ? { repo } : {}), executionId, state: "approved" });
        const secret = this.settings.getRaw("exec_lane_secret");
        const base = (this.settings.getRaw("epaminon_base_url") || "http://zenod-epaminon:8080").replace(/\/$/, "");
        let dispatched = false;
        if (secret) {
          dispatched = await fetch(`${base}/api/exec/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
            body: JSON.stringify({ execution_id: executionId, ...(finalContent ? { final_content: finalContent } : {}) }),
            signal: AbortSignal.timeout(4000),
          })
            .then((r) => r.ok)
            .catch(() => false);
        }
        return `Approved execution ${res.repo}#${executionId} (exec:approved)${
          dispatched ? " — dispatched to Epaminon to ship" : " — awaiting Epaminon (execution lane not yet provisioned)"
        }: ${res.issueUrl}`;
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
    this.executionStore.close();
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
