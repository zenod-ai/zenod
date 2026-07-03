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
import { loadProjectRegistry, projectRegistrySection, resolveProject } from "./projectRegistry.js";
import { backlogRouterSection, LIFE_BACKLOG_REPO, loadRepoInference, routeBacklogRequest } from "./backlogRouter.js";
import { buildOneOffIssueBody, extractIssueCreateSubject, isIssueCreateIntent, oneOffIssueTitle } from "./oneOffExecution.js";
import { formatFilingReceipt } from "./filingReceipt.js";
import { ExecutionQueue, type ExecutionTicket } from "./executionQueue.js";
import { buildExecutionQueue, mergedGithubPullEvidence } from "./executionLane.js";
import { buildDriveTools } from "./driveTools.js";
import { buildOutboundTools } from "./outboundTools.js";
import { buildNotifierTools } from "./notifierTools.js";
import { IngestStore } from "./ingestStore.js";
import { UsageStore } from "./usageStore.js";
import { NotificationStore } from "./notificationStore.js";
import { NotificationBus } from "./notificationBus.js";
import { IngestQueue } from "./ingestQueue.js";
import { TaskJobStore } from "./taskJobStore.js";
import { TaskJobQueue } from "./taskJobQueue.js";
import { ExecutionStore } from "./executionStore.js";
import { TranscriptStore } from "./transcriptStore.js";
import { JourneyStore } from "./journeyStore.js";
import { JourneyMonitor } from "./journeyMonitor.js";
import { createJourneyAuthorityReconciler } from "./journeyAuthorityReconciler.js";
import { runExecutionIngestSweep, type MemoryJobStatus } from "./executionIngestSweep.js";
import { detectStuckIngestJobs, formatStuckIngestAlert, STUCK_INGEST_THRESHOLD_MS } from "./ingestWatchdog.js";
import { resolveDeliverableManifest, fetchDeliverableFiles, formatDeliverableResult } from "./executionDeliverable.js";
import { OAuthStore } from "./oauthStore.js";
import { callPeer, callPeerTool, callPeerWithArgs, type PeerConfig, type PeerToolSpec } from "./peerClient.js";
import { formatConversationTranscript, transcriptQueryFromToolArgs } from "./conversationTranscript.js";
import { createIssueThenRunJourney, type CreateIssueThenRunInput, type CreateIssueThenRunResult } from "./createIssueRunJourney.js";
import { createIssuesJourney, type CreateIssuesJourneyInput, type CreateIssuesJourneyResult } from "./parallelIssueJourney.js";
import { type RunEphemeralJourneyInput, type RunEphemeralJourneyResult } from "./ephemeralJourney.js";
import { extractIntakeAsks, intakeAsksContextNote, isExecuteDirective, prefixReplyWithIntakeAsks, resolveCurrentIntents, type IntakeAsk } from "./intakeAsks.js";
import {
  GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE,
  RUN_EPHEMERAL_TASK_SHAPE,
  RUN_ISSUE_SHAPE,
  V4_FIND_ISSUE_SHAPE,
  V4_GET_ISSUE_SHAPE,
  V4_LIST_ISSUES_SHAPE,
} from "./mcpToolSchemas.js";
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

interface TaskingRunContext {
  parentConversationId: string;
  surface: string;
  originalRequest: string;
  rawEvidence?: TaskingInput["rawEvidence"];
  journeyId?: string;
}

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
    case "epaminon.run_existing_issue":
      return z.object(RUN_ISSUE_SHAPE);
    case "epaminon.run_ephemeral_task":
      return z.object(RUN_EPHEMERAL_TASK_SHAPE);
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

function createRunStatusLabel(result: CreateIssueThenRunResult): string {
  if (result.status === "blocked") return "blocked";
  const state = result.execution?.state;
  if (state === "done" || state === "failed" || state === "blocked") return result.status;
  return "execution handoff dispatched";
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
  /** S-1 (a) — durable, deploy-surviving copy of each run's full events.jsonl. */
  readonly transcriptStore: TranscriptStore;
  readonly journeyStore: JourneyStore;
  readonly journeyMonitor: JourneyMonitor;
  /** M-5 — ingest job ids already alerted-on this process's lifetime, so the stuck-job watchdog fires once per episode, not every sweep tick. */
  private stuckIngestAlerted = new Set<string>();
  readonly usageStore: UsageStore;
  readonly notificationStore: NotificationStore;
  /** The single notification authority — every proactive send funnels here (R2-T1). */
  readonly notificationBus: NotificationBus;
  /** The executor's queue (Epaminon only) — the state authority for the execution
   *  lane. Null on every other agent. Wired to the protocol seams in executionLane. */
  readonly executionQueue: ExecutionQueue | null;
  private engine: BrainEngine | null = null;
  private repo: VaultRepo | null = null;
  private readonly taskingContext = new AsyncLocalStorage<TaskingRunContext>();

  async reconcileMergedExecutionReviews(): Promise<void> {
    if (!this.executionQueue) return;
    const reviewTickets = this.executionQueue.snapshot().filter((ticket) => ticket.state === "needs-review" && ticket.evidenceUrl);
    for (const ticket of reviewTickets) {
      try {
        const mergedPullUrl = await mergedGithubPullEvidence(this.settings, ticket.evidenceUrl);
        if (mergedPullUrl) await this.executionQueue.approve({ executionId: ticket.executionId });
      } catch (err) {
        console.warn(`[exec-lane] could not reconcile ${ticket.executionId} from PR evidence: ${(err as Error).message}`);
      }
    }
  }

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
    // S-1 (a): each run's full events.jsonl lands here on the persistent /data volume,
    // keyed by execution id, so the transcript link outlives the runner workdir + deploys.
    this.transcriptStore = new TranscriptStore(join(dataDir, "transcripts"));
    // The executor (Epaminon) owns an execution queue; no other agent does.
    this.executionQueue = agent.executor === true ? buildExecutionQueue(this.settings, this.executionStore) : null;
    this.journeyStore = new JourneyStore(join(dataDir, "journeys.sqlite"));
    this.journeyMonitor = new JourneyMonitor(this.journeyStore, {
      reconcileStep: createJourneyAuthorityReconciler({
        readIssue: async (target) => this.buildBacklogIssueReader().getIssue({ target }),
        readExecution: (reference) => this.readExecutionAnywhere(reference),
        readMemoryJob: async (jobId) => this.taskJobQueue.get(jobId),
        fileExecutionMemory: (input) => this.fileExecutionMemory(input),
      }),
      // R1-T2 production seam: create-and-run journeys complete their execution step
      // at DISPATCH, so the step reconciler never sees the terminal edge. This sweep
      // re-reads recorded executions from the authority each tick and files the cited
      // Zenod note once per executionId (guarded by a zenod_ingest artifact).
      onSweep: async () => {
        await Promise.all([
          runExecutionIngestSweep({
            store: this.journeyStore,
            readExecution: (reference) => this.readExecutionAnywhere(reference),
            fileMemory: (input) => this.fileExecutionMemory(input),
            pollMemoryJob: (jobId) => this.pollExecutionMemoryJob(jobId),
          }).then((r) => {
            if (r.started || r.filed || r.refreshed || r.gaveUp) {
              console.log(`[exec-ingest] sweep: refreshed=${r.refreshed} started=${r.started} filed=${r.filed} skipped=${r.skipped} gaveUp=${r.gaveUp}`);
            }
          }),
          // M-5 — stuck-job watchdog: an ingest job >10min without terminal state
          // gets one Phylax operator alert (never a false "done"/silence).
          this.sweepStuckIngestJobs(),
        ]);
      },
    });
    this.usageStore = new UsageStore(join(dataDir, "usage.sqlite"));
    this.notificationStore = new NotificationStore(join(dataDir, "notifications.sqlite"));
    this.notificationBus = new NotificationBus(
      (surface, text) => (surface === "telegram" ? this.telegram.notifyOwner(text) : this.whatsapp.notifyOwner(text)),
      this.notificationStore,
    );
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
    Object.assign(peerTools, this.buildConsoleJourneyTools());
    // Callistheness's private send tools (post_tweet/post_reddit/send_email) ride the
    // same generic tool slot — its guardian brain wields them and confirms first. The
    // Composio key/user (interim Reddit connector, #420) come from settings when the
    // Console has pushed them, else the container env (COMPOSIO_* on the compose).
    if (outbound) {
      const composioKey = this.settings.get("composio_api_key");
      const composioUser = this.settings.get("composio_user_id");
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(composioKey ? { COMPOSIO_API_KEY: composioKey } : {}),
        ...(composioUser ? { COMPOSIO_USER_ID: composioUser } : {}),
      };
      Object.assign(peerTools, buildOutboundTools(env));
    }
    if (this.agent.notifier === true) Object.assign(peerTools, buildNotifierTools());
    const engine = createEngine({
      ...(repo ? { repo } : {}),
      llm,
      state: this.state,
      // Front-end routing agents get the project registry appended so they resolve the
      // user's informal project names to a concrete repo/path without asking (#stab T4).
      persona: ["zenod", "console", "archus"].includes(this.agent.name)
        ? `${this.agent.persona}${projectRegistrySection(loadProjectRegistry())}${
            ["console", "archus"].includes(this.agent.name) ? backlogRouterSection(loadRepoInference()) : ""
          }`
        : this.agent.persona,
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
      // M-5 — a background filing that lands gets a real completion receipt through
      // the normal notification path (the Phylax pipe), not just a console.info.
      onFilingComplete: (result) => {
        void this.notificationBus.notify({
          eventType: "filing.receipt",
          text: formatFilingReceipt(result),
          severity: "info",
          dedupeKey: `filing:${result.commitSha}`,
        });
      },
    });
    this.engine = {
      ...engine,
      handleTasking: (input) => {
        // Execute fast-lane (intake contract): a "task for codex/Epaminon" is ONE task,
        // filed verbatim — never decomposed into asks. Skip intake decomposition for it
        // so the Console hands the whole message to Codex instead of shattering it.
        const asks = this.agent.name === "console" && !isExecuteDirective(input.text) ? extractIntakeAsks(input.text) : [];
        const contextNote = asks.length > 1 ? [input.contextNote, intakeAsksContextNote(asks)].filter(Boolean).join("\n\n") : input.contextNote;
        const taskingInput = contextNote ? { ...input, contextNote } : input;
        const context: TaskingRunContext = {
          parentConversationId: conversationId(input.surface, input.conversationKey),
          surface: input.surface,
          originalRequest: input.text,
          ...(input.rawEvidence ? { rawEvidence: input.rawEvidence } : {}),
        };
        if (asks.length > 1) this.recordCurrentIntentLedger(context, asks);
        return this.taskingContext.run(context, async () => {
          try {
            const reply = await engine.handleTasking(taskingInput);
            return asks.length > 1 ? { ...reply, text: prefixReplyWithIntakeAsks(reply.text, asks) } : reply;
          } finally {
            if (context.journeyId) this.journeyStore.completeJourneyIfReady(context.journeyId);
          }
        });
      },
    };
    return this.engine;
  }

  /**
   * Read an execution ticket from whichever authority this agent can reach: the local
   * queue on the executor (Epaminon), else the executor peer over the mesh (the
   * Console — which owns journeys but not the queue). Without the peer path, the
   * execution-terminal reconcile/ingest never runs on the Console. Never throws.
   */
  async readExecutionAnywhere(reference: string): Promise<ExecutionTicket | null> {
    if (this.executionQueue) {
      return this.executionQueue.get(reference) ?? this.executionQueue.snapshot().find((ticket) => ticket.target === reference) ?? null;
    }
    return this.readExecutionFromExecutorPeer(reference);
  }

  /**
   * Read an execution ticket from the executor peer (Epaminon) over the mesh, via its
   * deterministic `execution_status` tool. Returns null on any failure or miss
   * (the reconciler then reports "no record", never blocks). Never throws.
   */
  private async readExecutionFromExecutorPeer(reference: string): Promise<ExecutionTicket | null> {
    const epaminon = this.settings.peers().find((peer) => peer.name === "epaminon");
    if (!epaminon) return null;
    try {
      const result = await callPeerTool(epaminon, "execution_status", { message: reference });
      const structured = result.structuredContent as { tickets?: unknown } | undefined;
      const tickets = Array.isArray(structured?.tickets) ? (structured.tickets as ExecutionTicket[]) : [];
      return (
        tickets.find((t) => t && t.executionId === reference) ??
        tickets.find((t) => t && t.target === reference) ??
        (tickets.length === 1 ? tickets[0] : null) ??
        null
      );
    } catch (err) {
      console.error(`[journey] executor-peer execution read failed for ${reference}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Start the async Zenod filing of a completed execution's cited meaning note
   * (R1-T2). Returns the filing jobId on acceptance — NOT proof of filing; the ingest
   * sweep polls the job to completion before finalizing its guard (acceptance-time
   * guards black-holed during the 2026-07-02 out-of-credits incident). Null when no
   * Zenod peer is configured or the call fails. Never throws.
   */
  private async fileExecutionMemory(input: {
    executionId: string;
    content: string;
    hints: string[];
  }): Promise<{ jobId: string } | null> {
    const zenod = this.settings.peers().find((peer) => peer.name === "zenod");
    if (!zenod) return null;
    try {
      const result = await callPeerTool(zenod, "store_memory", {
        content: input.content,
        verbatim: true,
        ...(input.hints.length ? { hints: input.hints } : {}),
      });
      const structured = result.structuredContent as { jobId?: string } | undefined;
      const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ");
      const jobId = structured?.jobId ?? text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      return jobId ? { jobId } : null;
    } catch (err) {
      console.error(`[exec-ingest] store_memory failed for ${input.executionId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Poll a Zenod filing job (get_task_result over the mesh) for the ingest sweep.
   * Maps the peer reply to a MemoryJobStatus; an isError reply is a job error (the
   * message carried through so a gave-up guard records WHY). Null when unreachable.
   */
  private async pollExecutionMemoryJob(jobId: string): Promise<MemoryJobStatus | null> {
    const zenod = this.settings.peers().find((peer) => peer.name === "zenod");
    if (!zenod) return null;
    try {
      const result = await callPeerTool(zenod, "get_task_result", { jobId });
      const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ");
      if (result.isError) return { status: "error", error: text.slice(0, 500) };
      const structured = result.structuredContent as
        | { status?: string; result?: { evidenceRef?: string }; error?: string }
        | undefined;
      const status = structured?.status ?? (text.match(/\b(queued|running|done|error|interrupted)\b/i)?.[1] ?? "").toLowerCase();
      if (status === "done") return { status: "done", ...(structured?.result?.evidenceRef ? { evidenceRef: structured.result.evidenceRef } : {}) };
      if (status === "error" || status === "interrupted") return { status: status as "error" | "interrupted", error: (structured?.error ?? text).slice(0, 500) };
      if (status === "queued" || status === "running") return { status: status as "queued" | "running" };
      return null;
    } catch (err) {
      console.error(`[exec-ingest] get_task_result failed for ${jobId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * M-5 — an ingest job stuck active (queued/downloading/transcribing/filing) for
   * over 10 minutes gets ONE Phylax operator alert through the normal notification
   * path, not silence and not a false "done". Runs on the same tick as the
   * execution-ingest sweep (JourneyMonitor's onSweep).
   */
  private async sweepStuckIngestJobs(): Promise<void> {
    const stale = this.ingestStore.staleActive(Date.now(), STUCK_INGEST_THRESHOLD_MS);
    const { alerts, alertedIds } = detectStuckIngestJobs(stale, this.stuckIngestAlerted, Date.now());
    this.stuckIngestAlerted = alertedIds;
    for (const alert of alerts) {
      await this.notificationBus.notify({
        eventType: "ingest.stuck",
        text: formatStuckIngestAlert(alert),
        severity: "error",
        dedupeKey: `ingest-stuck:${alert.jobId}`,
      });
    }
  }

  /**
   * R1-T3: resolve a reference to a completed execution's deliverable and return the
   * live file body from GitHub at the run's head commit (unmerged-safe) plus honest
   * merge state. Resolves the manifest from the journey's execution_record artifacts.
   */
  async fetchExecutionDeliverable(reference: string): Promise<{ text: string; structured: Record<string, unknown> }> {
    const artifacts = this.journeyStore.artifactsByKind("execution_record", 200);
    let manifest = resolveDeliverableManifest(artifacts, reference);
    if (!manifest) {
      // Journey artifacts may lag or predate the manifest — the execution authority
      // (Epaminon's ticket) is the durable source; resolve over the mesh as fallback.
      const ticket = await this.readExecutionAnywhere(reference.match(/([^/\s#]+\/[^/\s#]+#\d+)/)?.[1] ?? reference);
      if (ticket?.deliverable) manifest = ticket.deliverable;
    }
    if (!manifest) {
      const result = { reference, found: false as const, mergeState: "unknown", files: [] };
      return { text: formatDeliverableResult(result), structured: result as unknown as Record<string, unknown> };
    }
    const read = async (repo: string, path: string, ref?: string): Promise<string> => {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const repoSeg = encodeURIComponent(repo).replace("%2F", "/");
      const res = await this.githubJson<{ content?: string; encoding?: string }>(
        `/repos/${repoSeg}/contents/${path.split("/").map(encodeURIComponent).join("/")}${q}`,
      );
      if (res.encoding === "base64" && typeof res.content === "string") {
        return Buffer.from(res.content, "base64").toString("utf8");
      }
      throw new Error("file is not base64-encoded text");
    };
    const result = await fetchDeliverableFiles(manifest, read);
    return { text: formatDeliverableResult(result), structured: result as unknown as Record<string, unknown> };
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
          owner: peer.name,
          ...(peer.repo ? { authorityRepo: peer.repo } : {}),
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
                const forwarded = {
                  ...args,
                  content: rawEvidence.content,
                  verbatim: true,
                  ...(hints.length ? { hints } : {}),
                };
                return this.recordPeerDelegation(peer, spec, forwarded, () => callPeerWithArgs(peer, spec.mcp, forwarded));
              }
              return this.recordPeerDelegation(peer, spec, args, () => callPeerWithArgs(peer, spec.mcp, args));
            }
            const textInput = typeof input === "string" ? input : String(input.input ?? "");
            const rawEvidence = this.taskingContext.getStore()?.rawEvidence;
            if (rawEvidence && spec.mcp === "store_memory") {
              const hints = rawEvidence.hints ?? [];
              const forwarded = {
                content: rawEvidence.content,
                verbatim: true,
                ...(hints.length ? { hints } : {}),
              };
              return this.recordPeerDelegation(peer, spec, forwarded, () => callPeerWithArgs(peer, spec.mcp, forwarded));
            }
            if (!shouldForwardConsoleContext || !spec.mcp.startsWith("chat_with_")) {
              return this.recordPeerDelegation(peer, spec, textInput, () => callPeer(peer, spec.mcp, spec.arg, textInput));
            }
            const parentConversationId = this.taskingContext.getStore()?.parentConversationId ?? conversationId("web", CONSOLE_PARENT_CONVERSATION_KEY);
            const window = await this.state.recentWindow(parentConversationId);
            const message = formatConsolePeerDelegation(textInput, {
              parentConversationId,
              peerName: peer.name,
              messages: window,
            });
            return this.recordPeerDelegation(peer, spec, { input: textInput, parentConversationId }, () =>
              callPeer(peer, spec.mcp, spec.arg, message, {
                surface: "web",
                conversationKey: consolePeerConversationKey(parentConversationId, peer.name),
              }),
            );
          },
        };
      }
    }
    return tools;
  }

  private buildConsoleJourneyTools(): PeerTools {
    if (this.agent.name !== "console") return {};
    const contextFor = (input: { originalRequest?: unknown }) => {
      const context = this.taskingContext.getStore();
      return {
        originalRequest:
          typeof input.originalRequest === "string" && input.originalRequest.trim()
            ? input.originalRequest.trim()
            : (context?.originalRequest ?? "Console journey request"),
        conversationId: context?.parentConversationId ?? null,
        surface: context?.surface ?? "console",
      };
    };
    const formatCreateRunResult = (result: CreateIssueThenRunResult): string => [
      `Journey ${result.journeyId}: ${createRunStatusLabel(result)}.`,
      result.message,
      ...(result.createdIssue ? [`Created issue: ${result.createdIssue.target} - ${result.createdIssue.url}`] : []),
      ...(result.execution
        ? [`Execution: ${result.execution.executionId} for ${result.execution.target} (${result.execution.state})`]
        : []),
    ].join("\n");
    const formatCreateIssuesResult = (result: CreateIssuesJourneyResult): string => [
      `Journey ${result.journeyId}: ${result.status}.`,
      result.message,
      ...result.createdIssues.map((issue) => `Created issue: ${issue.target} - ${issue.url}`),
      ...(result.notificationText ? [`Notification handoff: ${result.notificationText}`] : []),
    ].join("\n");
    const formatEphemeralResult = (result: RunEphemeralJourneyResult): string => [
      `Journey ${result.journeyId}: ${result.status}.`,
      result.message,
      ...(result.execution
        ? [`Execution: ${result.execution.executionId} for ${result.execution.target} (${result.execution.state})`]
        : []),
    ].join("\n");

    return {
      console_create_issue_then_run: {
        description:
          "Owner: Console. Durable multi-step workflow for one request that explicitly asks to create/file/open a GitHub issue AND run/start/execute that newly created issue. Use only when the request is runnable: target repo is known and the issue body has objective, scope boundaries, acceptance/done condition, and source context. If any of those are missing, ask one clarification before using this tool. This creates a journey, asks Archus to create the issue, then gives Epaminon the structured created issue artifact. Use this instead of separately calling Archus and Epaminon for create-and-run. If the user asks to notify only after terminal/blocked state, set notifyOnStart=false. The returned message is ALREADY reduced to only what is verified (a receipt) — relay it verbatim; do NOT compose your own 'creating/opening/dispatching now' narration ahead of it, and never upgrade a dispatch-only result to a done/opened claim yourself.",
        inputSchema: z.object({
          originalRequest: z.string().optional().describe("the user's original request; omit to use the current message"),
          issue: z.object({
            repo: z.string().optional().describe("owner/repo target; omit to let Archus/default config decide"),
            title: z.string().describe("GitHub issue title"),
            body: z.string().optional().describe("runnable issue body with objective, scope, acceptance criteria, and source context"),
            labels: z.array(z.string()).optional().describe("labels to request on the created issue"),
          }),
          runInstructions: z.string().optional().describe("extra instructions Epaminon needs when running the created issue"),
          notifyOnStart: z.boolean().optional().describe("Set false when the user wants notification only after terminal/blocked execution state."),
        }),
        run: async (input) => {
          const args = input as Partial<CreateIssueThenRunInput> & { issue?: CreateIssueThenRunInput["issue"] };
          if (!args.issue?.title) return "ERROR: issue.title is required.";
          // E-4 (obsidian-brain#231, D2): a life-level epic must NOT enter the code-execution
          // lane. Deterministically route it to the life backlog before any journey starts.
          const routeText = [args.issue.title, args.issue.body, args.originalRequest]
            .filter((v): v is string => typeof v === "string")
            .join(" ");
          const decision = routeBacklogRequest(args.issue.repo ? `${args.issue.repo} ${routeText}` : routeText, loadRepoInference());
          if (decision.kind === "life_backlog" && !args.issue.repo) {
            return [
              `Not routed to execution: this reads as an outcome/life-level item, so it belongs in the life backlog (${LIFE_BACKLOG_REPO}), not the code-execution lane.`,
              "File it with backlog_create (Archus). If you meant to run code, name the target repo and I'll route it through Epaminon.",
            ].join("\n");
          }
          const result = await this.createIssueThenRun({
            ...contextFor(args),
            issue: args.issue,
            ...(args.runInstructions ? { runInstructions: args.runInstructions } : {}),
            ...(args.notifyOnStart !== undefined ? { notifyOnStart: args.notifyOnStart } : {}),
          });
          return formatCreateRunResult(result);
        },
      },
      console_create_issues: {
        description:
          "Owner: Console. Durable workflow for a single user request that asks for multiple independent GitHub issues, optionally followed by a Phylax notification after all issue URLs are verified. Creates one journey with parallel Archus steps and an optional notification handoff.",
        inputSchema: z.object({
          originalRequest: z.string().optional().describe("the user's original request; omit to use the current message"),
          issues: z
            .array(
              z.object({
                repo: z.string().optional().describe("owner/repo target; omit to let Archus/default config decide"),
                title: z.string().describe("GitHub issue title"),
                body: z.string().optional().describe("runnable issue body with objective, scope, acceptance criteria, and source context"),
                labels: z.array(z.string()).optional().describe("labels to request on this issue"),
              }),
            )
            .min(1)
            .describe("issues to create"),
          notify: z
            .object({ message: z.string().optional().describe("notification context for Phylax") })
            .optional()
            .describe("set only when the user asks to notify/ping/report back after issue creation"),
        }),
        run: async (input) => {
          const args = input as Partial<CreateIssuesJourneyInput> & { issues?: CreateIssuesJourneyInput["issues"] };
          if (!args.issues?.length) return "ERROR: issues[] is required.";
          const result = await this.createIssues({
            ...contextFor(args),
            issues: args.issues,
            ...(args.notify ? { notify: args.notify } : {}),
          });
          return formatCreateIssuesResult(result);
        },
      },
      console_run_ephemeral_task: {
        description:
          "Owner: Console. Durable workflow for one-off execution/research/ops where the user did NOT ask to create a planning ticket first. THIS is the only way to run a one-off: it mints a real execution ticket (a GitHub issue holding the job description) via Archus and has Epaminon run against it, so every run is durable and traceable — there are no issue-less runs. Pass repo/path when the task works a known codebase. Use for any 'just do X' one-off; no separate backlog ticket is created, but the execution ticket always is. The returned message is ALREADY reduced to only what is verified — relay it verbatim; do NOT compose your own 'running/dispatching/opening now' narration ahead of it.",
        inputSchema: z.object({
          originalRequest: z.string().optional().describe("the user's original request; omit to use the current message"),
          objective: z.string().describe("the one-off objective to execute"),
          instructions: z.string().optional().describe("extra execution constraints/context"),
          repo: z.string().optional().describe("target repo as owner/repo when the task works a known codebase"),
          path: z.string().optional().describe("sub-path within the repo where the relevant code lives, if known"),
          artifactPolicy: z.string().optional().describe("where/how Epaminon should report artifacts, if the user specified it"),
        }),
        run: async (input) => {
          const args = input as Partial<RunEphemeralJourneyInput>;
          if (!args.objective) return "ERROR: objective is required.";
          const result = await this.runEphemeralTask({
            ...contextFor(args),
            objective: args.objective,
            ...(args.instructions ? { instructions: args.instructions } : {}),
            ...(args.repo ? { repo: args.repo } : {}),
            ...(args.path ? { path: args.path } : {}),
            ...(args.artifactPolicy ? { artifactPolicy: args.artifactPolicy } : {}),
          });
          return formatEphemeralResult(result);
        },
      },
    };
  }

  private ensureTaskingJourney(context: TaskingRunContext, source = "peer_delegation"): string {
    if (context.journeyId) return context.journeyId;
    const journey = this.journeyStore.create({
      conversationId: context.parentConversationId,
      surface: context.surface ?? "console",
      originalRequest: context.originalRequest ?? "Console peer delegation",
      context: { owner: "console", source },
    });
    context.journeyId = journey.id;
    return journey.id;
  }

  private recordCurrentIntentLedger(context: TaskingRunContext, asks: IntakeAsk[]): void {
    if (this.agent.name !== "console") return;
    const journeyId = this.ensureTaskingJourney(context, "current_intent_ledger");
    for (const intent of resolveCurrentIntents(asks)) {
      this.journeyStore.addArtifact(journeyId, {
        kind: "current_intent",
        artifactKey: `current-intent:${intent.askId}`,
        data: { ...intent },
      });
    }
  }

  private async recordPeerDelegation<T>(
    peer: PeerConfig,
    spec: PeerToolSpec,
    input: unknown,
    call: () => Promise<T>,
  ): Promise<T> {
    const context = this.taskingContext.getStore();
    if (this.agent.name !== "console" || !context) return call();

    const journeyId = this.ensureTaskingJourney(context);
    const step = this.journeyStore.addStep(journeyId, {
      owner: peer.name,
      title: `${spec.as} -> ${spec.mcp}`,
      input: {
        tool: spec.as,
        mcpTool: spec.mcp,
        input: compactJourneyValue(input),
      },
    });
    this.journeyStore.dispatchStep(step.id, { deadlineAt: Date.now() + 5 * 60_000 });
    try {
      const result = await call();
      if (peerResultIsError(result)) {
        this.journeyStore.blockStep(step.id, "peer delegation returned an error");
      } else {
        this.journeyStore.completeStep(step.id, { result: compactJourneyValue(result) });
      }
      return result;
    } catch (err) {
      this.journeyStore.blockStep(step.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async githubTokens(repo?: string, requireRepoInstallation = false): Promise<string[]> {
    const pat = this.settings.get("github_token");
    if (this.settings.hasGithubApp()) {
      if (repo && requireRepoInstallation) {
        try {
          const appToken = await installationTokenForRepo(this.settings, repo, { strict: true });
          return pat && pat !== appToken ? [appToken, pat] : [appToken];
        } catch (err) {
          if (pat) return [pat];
          throw err;
        }
      }
      const appToken = repo ? await installationTokenForRepo(this.settings, repo) : await installationToken(this.settings);
      return pat && pat !== appToken ? [appToken, pat] : [appToken];
    }
    return pat ? [pat] : [];
  }

  private async githubJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)/);
    const method = (init.method ?? "GET").toUpperCase();
    const requireRepoInstallation = method !== "GET" && method !== "HEAD";
    const tokens = await this.githubTokens(repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : undefined, requireRepoInstallation);
    if (tokens.length === 0) throw new Error("GitHub token or app installation is required");
    for (let index = 0; index < tokens.length; index += 1) {
      const response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${tokens[index]}`,
          "User-Agent": "zenod",
          Accept: "application/vnd.github+json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }
      const body = await response.text().catch(() => "");
      if (response.status === 403 && index + 1 < tokens.length) continue;
      throw new Error(`GitHub returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
    throw new Error("GitHub request failed");
  }

  buildBacklogIssueReader() {
    const productRepo = "zenod-ai/zenod";
    const defaultRepo = () => this.settings.get("vault_repo") || this.settings.getRaw("backlog_repo") || "";
    const configuredRepos = () =>
      [...new Set([this.settings.get("vault_repo"), this.settings.getRaw("backlog_repo")].filter((repo): repo is string => Boolean(repo)))];
    const discoveryRepos = () => [...new Set([...configuredRepos(), productRepo])];
    // S0-T1: the single hard-wired write destination for the deterministic
    // backlog writers. A backlog agent (Archus) carries `backlog_repo`; a vault
    // agent falls back to its vault repo. There is no per-call override.
    const lifeBacklogRepo = () => this.settings.getRaw("backlog_repo") || this.settings.get("vault_repo") || "";
    const backlogNotConfigured = (op: string): ToolResponse =>
      toolResponse({
        text: `FAILED to ${op} backlog issue: no life-backlog repository is configured.`,
        errors: [{ code: "repo_not_configured", message: "No backlog_repo (or vault_repo) is configured for this agent.", currentState: {} }],
      });
    // S0-T6: a failed write returns FAILED + the verbatim error and NO success
    // evidence, so nothing that reads like a completed write can be rendered.
    const backlogWriteFailure = (op: string, repo: string, error: unknown): ToolResponse => {
      const message = error instanceof Error ? error.message : String(error);
      return toolResponse({
        text: `FAILED to ${op} backlog issue in ${repo}: ${message}`,
        errors: [{ code: `${op}_failed`, message, currentState: { repo } }],
      });
    };
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
    const searchIssues = async (reference: string, repos: string[], limit: number): Promise<Array<{ repo: string; issue: GitHubIssueRead }>> => {
      const found: Array<{ repo: string; issue: GitHubIssueRead }> = [];
      for (const repo of repos) {
        const query = `${reference.trim()} is:issue in:title,body repo:${repo}`;
        const result = await this.githubJson<{ items?: GitHubIssueRead[] }>(
          `/search/issues?q=${encodeURIComponent(query)}&per_page=${Math.min(Math.max(limit, 1), 100)}&sort=updated&order=desc`,
        ).catch(() => ({ items: [] }));
        for (const issue of result.items ?? []) {
          found.push({ repo, issue });
          if (found.length >= limit) return found;
        }
      }
      return found;
    };
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
        const searchedRepos = repos?.length ? repos : configuredRepos();
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
          if (fuzzyCandidates.length === 0 && !repos?.length) {
            const searchedTargets = new Set<string>();
            for (const { repo, issue } of await searchIssues(reference, discoveryRepos(), limit)) {
              if (!matchesLabels(issue, labels)) continue;
              const target = issueTarget(repo, issue);
              if (searchedTargets.has(target)) continue;
              searchedTargets.add(target);
              fuzzyCandidates.push(candidateFromIssue(repo, issue, "github issue search match", 0.55));
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
      // --- S0-T1: deterministic life-backlog writers -----------------------
      // The write destination is the ONE configured life-backlog repo, resolved
      // here and nowhere overridable — none of these tools accept a repo, so a
      // write can only ever land in the life backlog (S0-T8 wrong-repo guard by
      // construction). Every write is confirmed by a follow-up GET before it is
      // reported as done; a failure returns FAILED + the verbatim GitHub error
      // and NO success evidence (S0-T6 honesty, also enforced by the output
      // layer's no-mutation-on-error invariant). Zero LLM in the path.
      createIssue: async ({ title, body, labels }: { title: string; body?: string; labels?: string[] }): Promise<ToolResponse> => {
        const repo = lifeBacklogRepo();
        if (!repo) return backlogNotConfigured("create");
        try {
          const created = await this.githubJson<{ number: number; html_url: string }>(`/repos/${repoPath(repo)}/issues`, {
            method: "POST",
            body: JSON.stringify({ title, ...(body !== undefined ? { body } : {}), ...(labels?.length ? { labels } : {}) }),
          });
          const verified = await readIssue(repo, created.number); // read-back: create is only "done" once GET confirms it
          const target = issueTarget(repo, verified);
          return toolResponse({
            text: `Created ${target}: ${verified.html_url}`,
            evidence: [
              evidence("issue_created", {
                target,
                url: verified.html_url,
                title: verified.title,
                state: verified.state ?? "open",
                labels: labelsOf(verified),
                verified: true,
              }),
            ],
          });
        } catch (error) {
          return backlogWriteFailure("create", repo, error);
        }
      },
      editIssue: async ({
        number,
        title,
        body,
        addLabels,
        removeLabels,
      }: {
        number: number;
        title?: string;
        body?: string;
        addLabels?: string[];
        removeLabels?: string[];
      }): Promise<ToolResponse> => {
        const repo = lifeBacklogRepo();
        if (!repo) return backlogNotConfigured("edit");
        const issuePath = `/repos/${repoPath(repo)}/issues/${number}`;
        const changedFields: string[] = [];
        try {
          await readIssue(repo, number); // fail fast + honestly if the target does not exist
          if (title !== undefined || body !== undefined) {
            await this.githubJson(issuePath, {
              method: "PATCH",
              body: JSON.stringify({ ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) }),
            });
            if (title !== undefined) changedFields.push("title");
            if (body !== undefined) changedFields.push("body");
          }
          if (addLabels?.length) {
            await this.githubJson(`${issuePath}/labels`, { method: "POST", body: JSON.stringify({ labels: addLabels }) });
            changedFields.push("labels");
          }
          for (const label of removeLabels ?? []) {
            await this.githubJson(`${issuePath}/labels/${encodeURIComponent(label)}`, { method: "DELETE" }).catch((err: unknown) => {
              if (!String((err as Error).message).includes("GitHub returned 404")) throw err;
            });
            if (!changedFields.includes("labels")) changedFields.push("labels");
          }
          const verified = await readIssue(repo, number); // read-back the final state
          const target = issueTarget(repo, verified);
          return toolResponse({
            text: `Updated ${target} (${changedFields.length ? changedFields.join(", ") : "no fields"}): ${verified.html_url}`,
            evidence: [evidence("issue_updated", { target, url: verified.html_url, changedFields, verified: true })],
          });
        } catch (error) {
          return backlogWriteFailure("edit", repo, error);
        }
      },
      commentIssue: async ({ number, body }: { number: number; body: string }): Promise<ToolResponse> => {
        const repo = lifeBacklogRepo();
        if (!repo) return backlogNotConfigured("comment");
        const issuePath = `/repos/${repoPath(repo)}/issues/${number}`;
        try {
          await readIssue(repo, number);
          const posted = await this.githubJson<{ id: number; html_url: string }>(`${issuePath}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
          });
          const comments = await readComments(repo, number); // read-back: confirm the comment id is really there
          if (!comments.some((comment) => (comment as { id?: number }).id === posted.id)) {
            throw new Error("comment POST returned but the comment was not found on read-back");
          }
          const verified = await readIssue(repo, number);
          const target = issueTarget(repo, verified);
          return toolResponse({
            text: `Commented on ${target}: ${posted.html_url}`,
            evidence: [evidence("issue_updated", { target, url: verified.html_url, changedFields: ["comment"], verified: true })],
          });
        } catch (error) {
          return backlogWriteFailure("comment", repo, error);
        }
      },
      closeIssue: async ({
        number,
        comment,
        reason = "completed",
      }: {
        number: number;
        comment?: string;
        reason?: "completed" | "not_planned";
      }): Promise<ToolResponse> => {
        const repo = lifeBacklogRepo();
        if (!repo) return backlogNotConfigured("close");
        const issuePath = `/repos/${repoPath(repo)}/issues/${number}`;
        try {
          await readIssue(repo, number);
          if (comment) {
            await this.githubJson(`${issuePath}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
          }
          await this.githubJson(issuePath, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: reason }) });
          const verified = await readIssue(repo, number); // read-back: only "closed" once GET confirms state
          if (verified.state !== "closed") {
            throw new Error(`close PATCH returned but the issue is still ${verified.state} on read-back`);
          }
          const target = issueTarget(repo, verified);
          return toolResponse({
            text: `Closed ${target}: ${verified.html_url}`,
            evidence: [evidence("issue_closed", { target, url: verified.html_url, state: "closed", verified: true })],
          });
        } catch (error) {
          return backlogWriteFailure("close", repo, error);
        }
      },
      listBacklog: async ({
        state = "open",
        labels,
        limit = 20,
      }: {
        state?: "open" | "closed" | "all";
        labels?: string[];
        limit?: number;
      }): Promise<ToolResponse> => {
        const repo = lifeBacklogRepo();
        if (!repo) return backlogNotConfigured("list");
        const issues = (await listRepoIssues(repo, state, limit)).filter((issue) => matchesLabels(issue, labels)).slice(0, limit);
        return toolResponse({
          text: [`Found ${issues.length} issue${issues.length === 1 ? "" : "s"} in ${repo}.`, ...issues.map((issue) => formatIssueLine(repo, issue))].join("\n"),
          evidence: [evidence("issue_list", { filters: { repo, state, labels: labels ?? [], limit }, issues: issues.map((issue) => issueSummary(repo, issue)) })],
        });
      },
    };
  }

  private buildTaskingTools(): ExternalTaskingTools {
    // Vault agents default to the vault repo; a backlog agent (Archus, no vault)
    // defaults to its central backlog repo.
    const defaultRepo = () => this.settings.get("vault_repo") || this.settings.getRaw("backlog_repo") || "";
    const githubJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      return this.githubJson<T>(path, init);
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
        // E-1 edit-lane honesty (Jordi): the edit lane must not claim success with zero
        // verified changes. When no operation actually ran, say so plainly so the brain
        // cannot narrate an edit that didn't happen.
        if (result.operations.length === 0) {
          return `No change made to #${result.issueNumber} — nothing to edit was applied: ${result.issueUrl}. Do NOT tell the user the issue was edited.`;
        }
        return `Edited #${result.issueNumber} (${result.operations.join(", ")}): ${result.issueUrl}`;
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
        let targetIssue = await githubJson<{
          number: number;
          title: string;
          body: string;
          html_url: string;
          labels: Array<{ name: string }>;
        }>(`/repos/${encodeURIComponent(parsedTarget.repo).replace("%2F", "/")}/issues/${parsedTarget.number}`);
        let failures = validateRunnableIssue(targetIssue);
        if (failures.length === 1 && failures[0] === `missing ${OWNER_AGENT} label`) {
          const existingLabels = issueLabelNames(targetIssue);
          const bootstrapLabels = [OWNER_AGENT, ...(existingLabels.some((label) => label.startsWith("status:")) ? [] : [STATUS_PROPOSED])];
          try {
            await githubJson(`/repos/${encodeURIComponent(parsedTarget.repo).replace("%2F", "/")}/issues/${parsedTarget.number}/labels`, {
              method: "POST",
              body: JSON.stringify({ labels: bootstrapLabels }),
            });
          } catch (err) {
            const message = (err as Error).message;
            throw new Error(`target ${target} is not runnable: failed to bootstrap ${OWNER_AGENT} label (${message})`);
          }
          targetIssue = await githubJson<{
            number: number;
            title: string;
            body: string;
            html_url: string;
            labels: Array<{ name: string }>;
          }>(`/repos/${encodeURIComponent(parsedTarget.repo).replace("%2F", "/")}/issues/${parsedTarget.number}`);
          failures = validateRunnableIssue(targetIssue);
        }
        if (failures.length > 0) {
          throw new Error(`target ${target} is not runnable: ${failures.join("; ")}`);
        }
        let executionContext = hydratedExecutionContext(target, targetIssue, context);
        // Mint the execution ticket (exec:queued) — minting IS queuing.
        const requestedExecutionRepo = repo?.trim();
        const configuredExecutionRepo = this.settings.getRaw("backlog_repo") || defaultRepo();
        const initialExecutionRepo = requestedExecutionRepo || configuredExecutionRepo;
        let executionRepoFallbackNote: string | null = null;
        let minted;
        try {
          minted = await mintExecutionIssue(this.settings, {
            ...(initialExecutionRepo ? { repo: initialExecutionRepo } : {}),
            title,
            context: executionContext,
            target,
          });
        } catch (err) {
          const message = (err as Error).message;
          if (
            !requestedExecutionRepo ||
            !configuredExecutionRepo ||
            requestedExecutionRepo === configuredExecutionRepo ||
            !/GitHub returned 404/.test(message)
          ) {
            throw err;
          }
          executionRepoFallbackNote =
            `execution backlog repo ${requestedExecutionRepo} was unavailable (${message}); used configured central backlog ${configuredExecutionRepo}`;
          executionContext = `${executionContext}\n\n${executionRepoFallbackNote}`;
          minted = await mintExecutionIssue(this.settings, {
            repo: configuredExecutionRepo,
            title,
            context: executionContext,
            target,
          });
        }
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
            body: JSON.stringify({ execution_id: minted.executionId, target, context: executionContext }),
            signal: AbortSignal.timeout(4000),
          })
            .then((r) => r.ok)
            .catch(() => false);
        }
        return `Minted execution ticket ${minted.repo}#${minted.executionId} (exec:queued) for ${target}${
          dispatched ? " and dispatched to Epaminon" : " — awaiting Epaminon dispatch (execution lane not yet provisioned)"
        }${executionRepoFallbackNote ? `; ${executionRepoFallbackNote}` : ""}: ${minted.issueUrl}`;
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

  async createIssueThenRun(input: CreateIssueThenRunInput): Promise<CreateIssueThenRunResult> {
    if (this.agent.name !== "console") {
      throw new Error("create-issue-then-run journeys are owned by the Console");
    }
    const archus = this.settings.peers().find((peer) => peer.name === "archus");
    const epaminon = this.settings.peers().find((peer) => peer.name === "epaminon");
    if (!archus) throw new Error("Archus peer is not configured");
    if (!epaminon) throw new Error("Epaminon peer is not configured");
    return createIssueThenRunJourney({
      store: this.journeyStore,
      archus,
      epaminon,
      request: input,
    });
  }

  async createIssues(input: CreateIssuesJourneyInput): Promise<CreateIssuesJourneyResult> {
    if (this.agent.name !== "console") {
      throw new Error("parallel issue journeys are owned by the Console");
    }
    const archus = this.settings.peers().find((peer) => peer.name === "archus");
    const phylax = this.settings.peers().find((peer) => peer.name === "phylax");
    if (!archus) throw new Error("Archus peer is not configured");
    if (input.notify && !phylax) throw new Error("Phylax peer is not configured");
    return createIssuesJourney({
      store: this.journeyStore,
      archus,
      ...(phylax ? { phylax } : {}),
      request: input,
    });
  }

  async runEphemeralTask(input: RunEphemeralJourneyInput): Promise<RunEphemeralJourneyResult> {
    if (this.agent.name !== "console") {
      throw new Error("ephemeral execution journeys are owned by the Console");
    }
    // #stab: there are no issue-less executions. A one-off still gets a real execution
    // ticket (a GitHub issue holding the job description) that Archus mints and Epaminon
    // runs against — so it is durable, traceable, and records its outcome on the issue.
    // "Ephemeral" means "no separate planning/backlog ticket", never "no ticket". This
    // routes through create-issue-then-run instead of the old issue-less enqueue.
    const registry = loadProjectRegistry();
    const match = resolveProject(registry, input.repo || input.objective);
    const repo =
      input.repo || match?.repo || this.settings.getRaw("backlog_repo") || this.settings.get("vault_repo") || "";
    const path = input.path || match?.path;
    // M-3 — when the objective itself is an issue/ticket-creation ask ("create issue
    // banana9 in the Zenod repo"), the title must be the actual subject ("banana9"),
    // not the whole verbatim instruction — otherwise the created issue's title reads
    // as the meta-instruction that asked for it.
    const requestText = [input.originalRequest, input.objective, input.instructions].filter(Boolean).join(" ");
    const titleSource = isIssueCreateIntent(requestText) ? extractIssueCreateSubject(input.objective) : input.objective;
    const result = await this.createIssueThenRun({
      originalRequest: input.originalRequest,
      conversationId: input.conversationId ?? null,
      surface: input.surface ?? "console",
      issue: {
        ...(repo ? { repo } : {}),
        title: oneOffIssueTitle(titleSource),
        body: buildOneOffIssueBody({
          objective: input.objective,
          ...(input.instructions ? { instructions: input.instructions } : {}),
          ...(repo ? { repo } : {}),
          ...(path ? { path } : {}),
          ...(match?.deployNote ? { deployNote: match.deployNote } : {}),
          ...(input.artifactPolicy ? { artifactPolicy: input.artifactPolicy } : {}),
        }),
        labels: ["one-off"],
      },
      ...(input.instructions ? { runInstructions: input.instructions } : {}),
    });
    return {
      journeyId: result.journeyId,
      ...(result.execution ? { execution: result.execution } : {}),
      status: result.status,
      message: result.createdIssue
        ? `Created execution ticket ${result.createdIssue.target} (${result.createdIssue.url}). ${result.message}`
        : result.message,
      snapshot: result.snapshot,
    };
  }

  close(): void {
    this.whatsapp.close();
    void this.telegram.close();
    this.state.close();
    this.whatsappStore.close();
    this.ingestStore.close();
    this.taskJobStore.close();
    this.executionStore.close();
    this.journeyMonitor.stop();
    this.journeyStore.close();
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

function compactJourneyValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (value === null || typeof value !== "object") return value;
  try {
    const json = JSON.stringify(value);
    if (json.length > 2_000) return { truncatedJson: json.slice(0, 2_000) };
    return JSON.parse(json) as unknown;
  } catch {
    return String(value).slice(0, 2_000);
  }
}

function peerResultIsError(result: unknown): boolean {
  if (typeof result === "string") return result.startsWith("Could not reach peer agent");
  if (!result || typeof result !== "object") return false;
  return (result as { isError?: unknown }).isError === true;
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
