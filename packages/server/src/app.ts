import { access } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic, type ServeStaticOptions } from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { conversationId, NoteNotFoundError, VERSION, type CleanSlateResult } from "zenod";
import { clearSession, issueSession, requireAuth, requireMcpAuth } from "./auth.js";
import {
  authServerMetadata,
  handleAuthorizeDecision,
  handleAuthorizeGet,
  handleRegister,
  handleToken,
  protectedResourceMetadata,
  publicBaseUrl,
} from "./oauth.js";
import {
  appStatus,
  buildManifest,
  createGithubIssue,
  disconnectApp,
  editGithubIssue,
  exchangeManifestCode,
  installationToken,
  listInstallationRepos,
  setExecutionState,
  EXECUTION_STATES,
  type ExecutionState,
} from "zenod";
import { buildMcpServer } from "./mcp.js";
import { buildMeshGatewayServer } from "./meshGateway.js";
import { parseServiceAccount, testDrive } from "./drive.js";
import { buildDriveTools } from "./driveTools.js";
import { prepareModel, transcribeAudio, transcriptionStatus, WHISPER_MODELS } from "./transcribe.js";
import { NotConfiguredError, Runtime, testGithub, testProviderKey } from "./runtime.js";
import { PROVIDER_KEY, SETTING_KEYS, type Provider, type SettingKey } from "./settings.js";
import { runSyntheticChat, type ChatTestAuditStore, type SyntheticChatRequest } from "./testHarness.js";
import { openRouterTranscriptionModels } from "./openrouterModels.js";
import { type AgentDefinition } from "./agent.js";

export interface AppOptions {
  /** Directory with the built web UI (apps/web/dist). Optional in dev/tests. */
  webDist?: string;
  /** Per-agent identity/config consumed by the shell. Defaults to Zenod. */
  agent?: AgentDefinition;
}

const MAX_WEB_VOICE_NOTE_BYTES = 50 * 1024 * 1024;

export function createApp(runtime: Runtime, options: AppOptions = {}): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const { settings } = runtime;
  const agent = options.agent ?? runtime.agent;
  const chatTestAudit = runtime.state as unknown as ChatTestAuditStore;

  void runtime.whatsapp.startIfEnabled().catch((err: unknown) => {
    console.error("[whatsapp] startup failed:", err);
  });

  void runtime.telegram.startIfEnabled().catch((err: unknown) => {
    console.error("[telegram] startup failed:", err);
  });

  // Pre-fetch the whisper model on boot when Drive is set up, so the one-time
  // ~1.5 GB download to the /data volume happens during setup — not inside the
  // user's first chat ingest. The /data volume persists across redeploys, so
  // this is genuinely one-time.
  if (settings.driveConfigured()) void prepareModel(settings.whisperModel());

  // Resume any ingest jobs left queued before the last restart.
  runtime.ingestQueue.resume();
  // Likewise drain any agentic MCP jobs (task_brain/run_task) left queued.
  runtime.taskJobQueue.resume();

  app.onError((err, c) => {
    if (err instanceof NotConfiguredError) return c.json({ error: err.message, code: "not_configured" }, 409);
    if (err instanceof NoteNotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  // --- public ---

  app.get("/api/health", (c) => c.json({ status: "ok", name: agent.name, version: VERSION }));

  // Agent identity for the UI shell (title/subtitle) so the same UI renders
  // per-agent without a rebuild. See docs/SUITE-SCAFFOLD.md.
  app.get("/api/agent", (c) =>
    c.json({
      name: agent.name,
      displayName: agent.displayName,
      tagline: agent.tagline,
      // The Console shell runs without a vault; the UI can hide the Vault tab.
      vaultless: agent.vaultless ?? false,
      // Current working repo (vault for memory agents, central backlog for backlog
      // agents) so the Console can display it and backfill agents enabled before
      // it tracked repos.
      repo: agent.backlog || agent.executor ? settings.getRaw("backlog_repo") : settings.get("vault_repo"),
    }),
  );

  // --- OAuth 2.1 provider (public — discovery + flow endpoints) ---

  // RFC 9728 protected-resource metadata (bare + path-suffixed variants clients probe)
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(publicBaseUrl(c))));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(protectedResourceMetadata(publicBaseUrl(c))));

  // RFC 8414 authorization-server metadata (bare + OIDC-style suffix)
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(authServerMetadata(publicBaseUrl(c))));
  app.get("/.well-known/oauth-authorization-server/mcp", (c) => c.json(authServerMetadata(publicBaseUrl(c))));

  app.post("/oauth/register", (c) => handleRegister(c, runtime.oauth));
  app.get("/oauth/authorize", (c) => handleAuthorizeGet(c, runtime.oauth, settings));
  app.post("/oauth/authorize/decision", (c) => handleAuthorizeDecision(c, runtime.oauth, settings));
  app.post("/oauth/token", (c) => handleToken(c, runtime.oauth));

  app.get("/api/auth/status", (c) =>
    c.json({
      needsSetup: !settings.hasAdminPassword(),
      configured: settings.configured(),
    }),
  );

  app.post("/api/auth/setup", async (c) => {
    if (settings.hasAdminPassword()) return c.json({ error: "already set up" }, 403);
    const { password } = await c.req.json<{ password?: string }>();
    if (!password || password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);
    settings.setAdminPassword(password);
    issueSession(c, settings);
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const { password } = await c.req.json<{ password?: string }>();
    if (!password || !settings.verifyAdminPassword(password)) {
      return c.json({ error: "wrong password" }, 401);
    }
    issueSession(c, settings);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    clearSession(c);
    return c.json({ ok: true });
  });

  // --- authenticated API ---

  const auth = requireAuth(settings);
  app.use("/api/*", async (c, next) => {
    const path = c.req.path;
    if (path === "/api/health" || path.startsWith("/api/auth/")) return next();
    // /api/provision is open ONLY while the agent is un-provisioned (it has no
    // token yet, so the Console can't authenticate to it). The handler enforces
    // the awaiting-provision guard; once provisioned it 403s and falls under auth.
    if (path === "/api/provision" && settings.awaitingProvision()) return next();
    // The execution lane (Archus ↔ Epaminon) is NOT gated by the agent token — it
    // does its own cross-provisioned lane-secret check, so a fan-out worker holding
    // the agent token can't forge execution state. It is internal-only and is never
    // republished on the public Console gateway.
    if (path.startsWith("/api/exec/")) return next();
    return auth(c, next);
  });

  // Headless provisioning: the Console mints this agent's token and pushes it (plus
  // config + shared keys) here; the agent instantiates itself and goes live. One-shot.
  app.post("/api/provision", async (c) => {
    if (!settings.awaitingProvision()) return c.json({ error: "already provisioned" }, 403);
    const body = await c.req.json<{ token?: string } & Record<string, string>>().catch(() => ({}) as Record<string, string>);
    if (!body.token) return c.json({ error: "token required" }, 400);
    settings.applyProvision(body as Parameters<typeof settings.applyProvision>[0]);
    runtime.invalidate();
    return c.json({ ok: true, name: agent.name, configured: settings.configured() });
  });

  // Execution lane — `apply_execution_event` (Epaminon → Archus). Deterministic,
  // no-LLM: moves an execution ticket's exec: state + appends evidence. Gated by
  // the cross-provisioned `exec_lane_secret` (NOT the agent token); inert until the
  // Console provisions the lane. Internal-mesh only; never on the public gateway.
  app.post("/api/exec/event", async (c) => {
    const secret = settings.getRaw("exec_lane_secret");
    if (!secret) return c.json({ error: "execution lane not provisioned" }, 503);
    if ((c.req.header("X-Lane-Secret") ?? "") !== secret) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req
      .json<{ execution_id?: number; state?: string; evidence_url?: string; note?: string }>()
      .catch(() => ({}) as Record<string, unknown>);
    const executionId = Number(body.execution_id);
    const state = body.state as ExecutionState;
    if (!executionId || !EXECUTION_STATES.includes(state)) {
      return c.json({ error: "execution_id (number) and a valid state are required" }, 400);
    }
    const result = await setExecutionState(settings, {
      executionId,
      state,
      ...(body.evidence_url ? { evidenceUrl: String(body.evidence_url) } : {}),
      ...(body.note ? { note: String(body.note) } : {}),
    });
    return c.json({ ok: true, ...result });
  });

  app.get("/api/settings", (c) =>
    c.json({ settings: settings.masked(), configured: settings.configured() }),
  );

  app.put("/api/settings", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    for (const key of SETTING_KEYS) {
      if (!(key in body)) continue;
      const value = body[key] ?? "";
      if (settings.isSecret(key) && value.includes("••••")) continue; // masked echo — unchanged
      settings.set(key as SettingKey, value);
    }
    runtime.invalidate();
    // Connecting Drive, or changing the quality, is the moment to fetch the
    // (newly) chosen transcription model to the persistent volume.
    if (settings.driveConfigured()) void prepareModel(settings.whisperModel());
    return c.json({ settings: settings.masked(), configured: settings.configured() });
  });

  // Change THIS agent's working repo in place (authenticated with the agent's own
  // token). The Console calls this to re-point an enabled agent without a
  // disable/re-enable cycle. A backlog agent (Archus) points its central backlog;
  // a vault agent re-points its vault. Unlike /api/provision this is NOT one-shot.
  app.post("/api/agent/repo", async (c) => {
    const body = await c.req.json<{ repo?: string; branch?: string }>().catch(() => ({}) as Record<string, string>);
    const repo = (body.repo ?? "").trim();
    if (!repo) return c.json({ error: "repo is required (owner/repo)" }, 400);
    if (agent.backlog || agent.executor) {
      settings.setRaw("backlog_repo", repo);
    } else {
      settings.set("vault_repo", repo);
      settings.set("vault_branch", (body.branch ?? "main").trim() || "main");
    }
    runtime.invalidate();
    return c.json({ ok: true, repo });
  });

  // --- Mesh: peer agents this agent can delegate to ---
  // GET never returns tokens (only whether one is set). PUT replaces the whole list.
  app.get("/api/peers", (c) =>
    c.json({
      peers: settings.peers().map((p) => ({ name: p.name, url: p.url, tool: p.tool ?? "ask_brain", hasToken: Boolean(p.token) })),
    }),
  );

  app.put("/api/peers", async (c) => {
    type PeerInput = { name?: string; url?: string; token?: string; tool?: string };
    const body = await c.req.json<{ peers?: PeerInput[] }>().catch(() => ({ peers: [] as PeerInput[] }));
    const existing = settings.peers();
    const next = (body.peers ?? [])
      .map((p) => {
        const name = (p.name ?? "").trim();
        const url = (p.url ?? "").trim();
        // A masked/blank token on edit means "keep the existing one" for that peer.
        const token =
          p.token && !p.token.includes("••••") ? p.token : existing.find((e) => e.name === name)?.token ?? "";
        return { name, url, token, ...(p.tool ? { tool: p.tool } : {}) };
      })
      .filter((p) => p.name && p.url && p.token);
    settings.setPeers(next);
    runtime.invalidate(); // rebuild the engine so the new peer tools take effect
    return c.json({
      peers: next.map((p) => ({ name: p.name, url: p.url, tool: p.tool ?? "ask_brain", hasToken: true })),
    });
  });

  // --- Team: enable/disable suite agents. The Console MINTS each agent's token and
  // PROVISIONS it over the internal network (token origination), then connects as a peer.
  // Zenod's memory toolset — each maps to one of z2's MCP tools, exposed to the Console chat.
  const ZENOD_MEMORY_TOOLS = [
    {
      as: "ask_zenod",
      mcp: "ask_brain",
      arg: "question",
      description:
        "Ask Zenod (the memory agent) a question. It researches the user's vault with its own LLM and returns a synthesized, cited answer. Use for 'what do I know about X', 'when does my policy renew', or any cross-note/fuzzy memory question.",
    },
    {
      as: "search_memory",
      mcp: "search_memory",
      arg: "query",
      description:
        "Fast keyword search over the user's memory vault — returns ranked note paths with snippets. Use to locate memories quickly; then get_memory to read one in full.",
    },
    {
      as: "get_memory",
      mcp: "get_memory",
      arg: "path",
      description: "Read one vault note in full by its path (e.g. Areas/Insurance.md), as returned by search_memory.",
    },
    {
      as: "add_memory",
      mcp: "store_memory",
      arg: "content",
      description:
        "File a new memory into the user's vault through Zenod's librarian (records evidence + files the meaning with citations). Use when the user wants something remembered. ASYNC — returns 'queued'; the filing finishes in the background. Only say it's stored once that's confirmed.",
    },
  ];
  // Archus's "top tools": named delegation handles that ALL route to Archus's chat
  // (chat_with_archus runs engine.chat synchronously and, for a backlog agent, has the
  // GitHub issue tools). They take the same natural-language input — the distinct names
  // exist for VISIBILITY (the activity line reads "opening an issue" / "editing an
  // issue"); Archus's own LLM still does the real work. Pick the one that matches intent.
  const ARCHUS_BACKLOG_TOOLS = [
    {
      as: "ask_archus",
      mcp: "chat_with_archus",
      arg: "message",
      description:
        "Ask Archus about the backlog — list/query open issues across repos, the aggregated view, status, or triage. Use for questions and general backlog chat (not a specific create/edit/close).",
    },
    {
      as: "open_issue",
      mcp: "chat_with_archus",
      arg: "message",
      description:
        "Open/create a GitHub issue. Pass the user's request in natural language (what to file, and which repo — or leave it for the central backlog). Archus writes a runnable ticket and returns its number + URL.",
    },
    {
      as: "edit_issue",
      mcp: "chat_with_archus",
      arg: "message",
      description:
        "Edit an existing GitHub issue — update its title/body, add a comment, or change labels. Say which issue (owner/repo#N) and what to change, in natural language.",
    },
    {
      as: "close_issue",
      mcp: "chat_with_archus",
      arg: "message",
      description:
        "Close a GitHub issue. Say which one (owner/repo#N), and optionally a closing comment. Archus closes it and confirms.",
    },
  ];
  // Epaminon's "top tools": named delegation handles that ALL route to his chat
  // brain (chat_with_epaminon runs engine.chat synchronously and, as an executor,
  // has the GitHub tasking tools — queue/comment/status). The distinct names are
  // for VISIBILITY (the activity line reads "running a ticket" / "reporting an
  // outcome"); Epaminon's own LLM does the real work and enforces his guardrails
  // (only run explicitly-approved tickets, qualified ids, honest status). He
  // executes the qualified REPO ticket and reports status up — he never curates
  // the backlog (that is Archus).
  const EPAMINON_EXECUTION_TOOLS = [
    {
      as: "execution_status",
      mcp: "chat_with_epaminon",
      arg: "message",
      description:
        "Ask Epaminon where execution stands — which tickets are queued/running, in review, or shipped, and any blockers. Use for execution status questions (not to start work). Reference tickets as owner/repo#N.",
    },
    {
      as: "run_ticket",
      mcp: "chat_with_epaminon",
      arg: "message",
      description:
        "Tell Epaminon to RUN an approved ticket now. Name the ticket (owner/repo#N) that the user has explicitly approved to execute; Epaminon queues it so the fan-out runner picks it up (opens a PR, moves it to needs-review) and confirms exactly what was queued. He only runs tickets explicitly approved to run — never bulk-queues.",
    },
    {
      as: "report_outcome",
      mcp: "chat_with_epaminon",
      arg: "message",
      description:
        "Hand Epaminon an execution outcome to record on the ticket he ran — the result and its evidence URL (PR/commit). He posts it as a comment on the qualified repo ticket (owner/repo#N) and sets the review status, then reports the status up so Archus can reflect it onto the central tracker. He does not curate the backlog himself.",
    },
  ];
  // Outbound's "top tools": named delegation handles that ALL route to his chat
  // brain (chat_with_outbound runs engine.chat synchronously and, as the outbound
  // agent, has the private send connectors — X/Reddit/email). The distinct names
  // are for VISIBILITY (the activity line reads "posting to X" / "sending an
  // email"); Outbound's own LLM does the real work and enforces his guardrails
  // (draft in the user's voice, refuse spam, and CONFIRM before anything is sent).
  const OUTBOUND_COMMS_TOOLS = [
    {
      as: "ask_outbound",
      mcp: "chat_with_outbound",
      arg: "message",
      description:
        "Ask Outbound to help with outbound comms — draft a tweet/Reddit post/email, adapt tone for a channel, or plan a send. He drafts in the user's voice but never publishes/sends without explicit confirmation. Use for composing and advice (not a committed send).",
    },
    {
      as: "post_tweet",
      mcp: "chat_with_outbound",
      arg: "message",
      description:
        "Post to X (Twitter). Pass what to post in natural language; Outbound drafts it in the user's voice, confirms the exact text first (posting is public and irreversible), then posts and returns the URL. He refuses spam/mass sends.",
    },
    {
      as: "post_reddit",
      mcp: "chat_with_outbound",
      arg: "message",
      description:
        "Submit a Reddit post. Say what to post and to which subreddit; Outbound drafts it, confirms the exact content and target subreddit first (it is public and irreversible), then submits and returns the URL.",
    },
    {
      as: "send_email",
      mcp: "chat_with_outbound",
      arg: "message",
      description:
        "Send an email. Give the recipient and what to say; Outbound drafts it in the user's voice, confirms the exact recipient and content first (a sent email cannot be recalled), then sends and confirms.",
    },
  ];
  // The Console's catalog of suite agents. repoSetting/repoLabel are optional: an
  // agent that owns no repo (Outbound) omits them and is enabled with just an LLM
  // key. peerTools is the curated tool set the Console exposes for that agent.
  interface SuiteAgentSpec {
    name: string;
    displayName: string;
    role: string;
    internalBaseUrl: string;
    needsRepo: boolean;
    repoSetting?: "vault_repo" | "backlog_repo";
    repoLabel?: string;
    peerTools: { as: string; mcp: string; arg: string; description: string }[];
  }
  const SUITE_AGENTS: SuiteAgentSpec[] = [
    {
      name: "zenod",
      displayName: "Zenod",
      role: "memory / librarian",
      internalBaseUrl: "http://zenod-z2:8080",
      needsRepo: true,
      repoSetting: "vault_repo" as const,
      repoLabel: "vault",
      peerTools: ZENOD_MEMORY_TOOLS,
    },
    {
      name: "archus",
      displayName: "Archus",
      role: "backlog / GitHub issues",
      internalBaseUrl: "http://zenod-archus2:8080",
      needsRepo: true,
      repoSetting: "backlog_repo" as const,
      repoLabel: "central backlog repo",
      peerTools: ARCHUS_BACKLOG_TOOLS,
    },
    {
      name: "epaminon",
      displayName: "Epaminon",
      role: "executor / runs queued tickets",
      internalBaseUrl: "http://zenod-epaminon:8080",
      needsRepo: true,
      // Epaminon resolves bare ticket references and his default execution target
      // from the same `backlog_repo` setting a backlog agent uses (his own
      // container, his own settings store). He still executes each ticket in its
      // own qualified owner/repo.
      repoSetting: "backlog_repo" as const,
      repoLabel: "execution/project repo",
      peerTools: EPAMINON_EXECUTION_TOOLS,
    },
    {
      name: "outbound",
      displayName: "Outbound",
      role: "outbound comms / X · Reddit · email",
      internalBaseUrl: "http://zenod-outbound:8080",
      // Outbound owns no repo — its accounts/connectors are env-configured on its
      // container. Enabling it needs only the shared LLM key.
      needsRepo: false,
      peerTools: OUTBOUND_COMMS_TOOLS,
    },
  ];

  // Keep each enabled peer's tool set in sync with the catalog on boot, so a tool
  // change (e.g. new flat tools) takes effect on redeploy without disable/re-enable.
  {
    const current = settings.peers();
    let changed = false;
    const synced = current.map((p) => {
      const sa = SUITE_AGENTS.find((a) => a.name === p.name);
      if (sa && JSON.stringify(p.tools ?? null) !== JSON.stringify(sa.peerTools)) {
        changed = true;
        return { ...p, tools: sa.peerTools };
      }
      return p;
    });
    if (changed) {
      settings.setPeers(synced);
      runtime.invalidate();
    }
  }

  app.get("/api/team", async (c) => {
    const enabled = new Set(settings.peers().map((p) => p.name));
    const tokens = settings.agentTokens();
    // Backfill any missing repo label by asking the agent itself (over the internal
    // network, with its token). Covers agents enabled before the Console tracked
    // repos, and is robust to boot ordering — it runs the first time the tab loads
    // and then caches, so the display is correct without a restart.
    await Promise.all(
      SUITE_AGENTS.filter(
        (a) => a.needsRepo && enabled.has(a.name) && !settings.agentRepo(a.name) && tokens[a.name],
      ).map(async (a) => {
        const repo = await fetch(`${a.internalBaseUrl}/api/agent`, {
          headers: { Authorization: `Bearer ${tokens[a.name]}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j as { repo?: string } | null)?.repo)
          .catch(() => null);
        if (typeof repo === "string" && repo) settings.setAgentRepo(a.name, repo);
      }),
    );
    return c.json({
      agents: SUITE_AGENTS.map((a) => ({
        name: a.name,
        displayName: a.displayName,
        role: a.role,
        needsRepo: a.needsRepo,
        repoLabel: a.repoLabel,
        enabled: enabled.has(a.name),
        // The last repo this agent was pointed at — persists across disable so the
        // UI can show it and re-enable can skip the picker.
        repo: settings.agentRepo(a.name),
      })),
    });
  });

  app.post("/api/team/enable", async (c) => {
    const body = await c.req
      .json<{ name?: string; vault_repo?: string }>()
      .catch(() => ({}) as { name?: string; vault_repo?: string });
    const sa = SUITE_AGENTS.find((a) => a.name === body.name);
    if (!sa) return c.json({ error: "unknown agent" }, 400);

    const apiKey = settings.activeApiKey();
    if (!apiKey) return c.json({ error: "Set an LLM key on the Console first (Keys & models)." }, 400);

    // The Console ORIGINATES the token. If we already minted one for this agent it
    // is already provisioned (and its /api/provision is now auth-locked) — so on
    // re-enable we SKIP provisioning and just reconnect with the stored token.
    const stored = settings.agentToken(sa.name);
    const token = stored ?? randomBytes(32).toString("hex");

    if (!stored) {
      const provision: Record<string, string> = { token, provider: settings.provider(), api_key: apiKey };
      if (settings.get("model_ask")) provision.model_ask = settings.get("model_ask")!;
      if (settings.get("model_classify")) provision.model_classify = settings.get("model_classify")!;

      if (sa.needsRepo && sa.repoSetting) {
        const repo = (body.vault_repo ?? "").trim();
        if (!repo) return c.json({ error: `Pick a ${sa.repoLabel} (e.g. owner/repo).` }, 400);
        provision[sa.repoSetting] = repo;
        settings.setAgentRepo(sa.name, repo);
        if (sa.repoSetting === "vault_repo") provision.vault_branch = "main";
        const ghToken = settings.get("github_token");
        if (ghToken) provision.github_token = ghToken;
        for (const k of ["github_app_id", "github_app_private_key", "github_app_installation_id", "github_app_slug"]) {
          const v = settings.getRaw(k);
          if (v) provision[k] = v;
        }
        if (!ghToken && !settings.hasGithubApp()) {
          return c.json(
            { error: "Connect GitHub on the Console first (Connections) so the agent can reach GitHub." },
            400,
          );
        }
      }

      // First enable: push provisioning to the (un-provisioned) headless agent.
      const res = await fetch(`${sa.internalBaseUrl}/api/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provision),
      }).catch(() => null);
      if (!res) return c.json({ error: `Could not reach ${sa.displayName} (not running?).` }, 502);
      // 200 = just provisioned; 401/403 = already provisioned — both fine, we reconnect.
      if (!res.ok && res.status !== 403 && res.status !== 401) {
        return c.json({ error: `${sa.displayName} refused provisioning (HTTP ${res.status}).` }, 502);
      }
    }

    settings.setAgentToken(sa.name, token);
    const repoForPeer = settings.agentRepo(sa.name);
    const peers = settings.peers().filter((p) => p.name !== sa.name);
    peers.push({
      name: sa.name,
      url: `${sa.internalBaseUrl}/mcp`,
      token,
      ...(sa.peerTools ? { tools: sa.peerTools } : {}),
      ...(repoForPeer ? { repo: repoForPeer } : {}),
    });
    settings.setPeers(peers);
    runtime.invalidate();
    return c.json({ ok: true });
  });

  app.post("/api/team/disable", async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    settings.setPeers(settings.peers().filter((p) => p.name !== body.name));
    runtime.invalidate();
    return c.json({ ok: true });
  });

  // Re-point an already-enabled agent's repo in place — no disable/re-enable. The
  // Console pushes the change to the agent (authenticated with the agent's token),
  // then mirrors it locally for display.
  app.post("/api/team/repo", async (c) => {
    const body = await c.req
      .json<{ name?: string; repo?: string; branch?: string }>()
      .catch(() => ({}) as { name?: string; repo?: string; branch?: string });
    const sa = SUITE_AGENTS.find((a) => a.name === body.name);
    if (!sa) return c.json({ error: "unknown agent" }, 400);
    if (!sa.needsRepo) return c.json({ error: `${sa.displayName} has no repo to manage.` }, 400);
    const repo = (body.repo ?? "").trim();
    if (!repo) return c.json({ error: `Pick a ${sa.repoLabel} (e.g. owner/repo).` }, 400);
    const token = settings.agentToken(sa.name);
    if (!token) return c.json({ error: `${sa.displayName} is not enabled.` }, 400);

    const res = await fetch(`${sa.internalBaseUrl}/api/agent/repo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ repo, ...(body.branch ? { branch: body.branch } : {}) }),
    }).catch(() => null);
    if (!res) return c.json({ error: `Could not reach ${sa.displayName}.` }, 502);
    if (!res.ok) return c.json({ error: `${sa.displayName} refused the repo change (HTTP ${res.status}).` }, 502);

    settings.setAgentRepo(sa.name, repo);
    settings.setPeers(settings.peers().map((p) => (p.name === sa.name ? { ...p, repo } : p)));
    return c.json({ ok: true, repo });
  });

  app.post("/api/settings/test-github", async (c) => {
    const body = await c.req.json<{ repo?: string; token?: string }>().catch(() => ({}) as Record<string, string>);
    const repo = body.repo || settings.get("vault_repo");
    let token = (body.token && !body.token.includes("••••") ? body.token : null) || settings.get("github_token");
    if (!token && settings.hasGithubApp()) {
      token = await installationToken(settings).catch(() => null);
    }
    if (!repo || !token) return c.json({ ok: false, message: "repo and token (or a connected GitHub App) are required" });
    return c.json(await testGithub(repo, token));
  });

  app.post("/api/settings/test-llm", async (c) => {
    const body = await c.req
      .json<{ provider?: Provider; api_key?: string }>()
      .catch(() => ({}) as Record<string, string>);
    const requested = body.provider;
    const provider: Provider =
      requested === "openai" || requested === "anthropic" || requested === "openrouter" || requested === "groq"
        ? requested
        : settings.provider();
    const storedKey = settings.get(PROVIDER_KEY[provider]);
    const key = (body.api_key && !body.api_key.includes("••••") ? body.api_key : null) || storedKey;
    if (!key) return c.json({ ok: false, message: "API key is required" });
    return c.json(await testProviderKey(provider, key));
  });

  app.post("/api/settings/test-drive", async (c) => {
    const body = await c.req
      .json<{ service_account_json?: string; folder_id?: string }>()
      .catch(() => ({}) as Record<string, string>);
    const json =
      (body.service_account_json && !body.service_account_json.includes("••••") ? body.service_account_json : null) ||
      settings.get("google_service_account_json");
    const folderId = body.folder_id ?? settings.get("google_drive_folder_id") ?? undefined;
    if (!json) return c.json({ ok: false, message: "paste the service account JSON key first" });
    return c.json(await testDrive(json, folderId || undefined));
  });

  // Drive connection status for the UI: which service account, and whether
  // audio transcription has a key to run on. Never returns the secret itself.
  app.get("/api/drive/status", (c) => {
    const json = settings.get("google_service_account_json");
    let clientEmail: string | null = null;
    if (json) {
      try {
        clientEmail = parseServiceAccount(json).client_email;
      } catch {
        clientEmail = null;
      }
    }
    return c.json({
      configured: settings.driveConfigured(),
      clientEmail,
      folderId: settings.get("google_drive_folder_id"),
      transcriptionProvider: [
        settings.get("groq_api_key") ? "groq for notes up to 5 min" : null,
        settings.longTranscriptionProvider() === "openrouter" && settings.get("openrouter_api_key")
          ? `openrouter ${settings.openrouterTranscriptionModel()} for notes over 5 min and Groq fallback`
          : settings.longTranscriptionProvider() === "openai" && settings.get("openai_api_key")
            ? "openai for notes over 5 min"
            : "local whisper.cpp for long notes",
      ]
        .filter(Boolean)
        .join("; "),
    });
  });

  // Whisper model readiness — the setup UI polls this so the one-time model
  // download shows as setup progress instead of stalling the first ingest.
  app.get("/api/transcription/status", async (c) => {
    return c.json(await transcriptionStatus(settings.whisperModel()));
  });

  // The selectable transcription qualities (id, label, note, sizeMb).
  app.get("/api/transcription/models", (c) =>
    c.json({ models: WHISPER_MODELS, selected: settings.whisperModel() }),
  );

  app.get("/api/transcription/openrouter-models", async (c) => {
    const catalog = await openRouterTranscriptionModels(20);
    return c.json({
      models: catalog.models,
      selected: settings.openrouterTranscriptionModel(),
      cached: catalog.cached,
      fallback: catalog.fallback,
    });
  });

  app.post("/api/chat/voice/transcribe", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File)) return c.json({ error: "audio file is required" }, 400);
    if (file.size <= 0) return c.json({ error: "audio file is empty" }, 400);
    if (file.size > MAX_WEB_VOICE_NOTE_BYTES) return c.json({ error: "audio file is too large" }, 413);

    const data = Buffer.from(await file.arrayBuffer());
    const result = await transcribeAudio(data, file.name || "web-voice-note.webm", {
      model: settings.whisperModel(),
      groqApiKey: settings.get("groq_api_key"),
      openaiApiKey: settings.get("openai_api_key"),
      openrouterApiKey: settings.get("openrouter_api_key"),
      openrouterModel: settings.openrouterTranscriptionModel(),
      longTranscriptionProvider: settings.longTranscriptionProvider(),
      useOpenAiForLongAudio: settings.useOpenAiForLongTranscription(),
    });
    if (!result.success)
      return c.json(
        {
          error: result.noSpeech ? result.error : `could not transcribe voice note: ${result.error}`,
          noSpeech: result.noSpeech === true,
        },
        422,
      );
    return c.json({ transcript: result.transcript, provider: result.provider });
  });

  // Background ingest jobs — the Transcription panel polls this so a long
  // transcription is visible from any tab and survives navigation/refresh.
  app.get("/api/ingest/jobs", (c) => c.json({ jobs: runtime.ingestStore.recent() }));

  app.post("/api/ingest/jobs/:id/retry", (c) => {
    const job = runtime.ingestQueue.retry(c.req.param("id"));
    if (!job) return c.json({ error: "job not found" }, 404);
    return c.json({ job });
  });

  app.post("/api/ingest/jobs/:id/cancel", (c) => {
    const job = runtime.ingestQueue.cancel(c.req.param("id"));
    if (!job) return c.json({ error: "job not found" }, 404);
    return c.json({ job });
  });

  // Background agentic MCP jobs (task_brain/run_task) — surfaced so the owner
  // can see what concurrent MCP callers queued, and in what state, instead of
  // the jobs being invisible (only the LLM-usage ledger hinted at them before).
  app.get("/api/tasks/jobs", (c) => c.json({ jobs: runtime.taskJobQueue.recent() }));

  app.get("/api/tasks/jobs/:id", (c) => {
    const job = runtime.taskJobQueue.get(c.req.param("id"));
    if (!job) return c.json({ error: "job not found" }, 404);
    return c.json({ job });
  });

  // Real (provider-billed) LLM cost analytics: tokens + USD by operation and
  // model, for the last 24h and 7d. Populated by every engine LLM call.
  app.get("/api/usage", (c) => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return c.json({
      today: runtime.usageStore.summary(now - day),
      last7d: runtime.usageStore.summary(now - 7 * day),
    });
  });

  app.get("/api/whatsapp/status", (c) => c.json(runtime.whatsapp.status()));

  app.get("/api/telegram/status", (c) => c.json(runtime.telegram.status()));

  app.put("/api/telegram/settings", async (c) => {
    const body = await c.req
      .json<{
        enabled?: boolean;
        botToken?: string;
        allowedUsers?: string[] | string;
        acceptAll?: boolean;
        rich?: boolean;
      }>()
      .catch(() => ({}) as { enabled?: boolean; botToken?: string; allowedUsers?: string[] | string; acceptAll?: boolean; rich?: boolean });
    settings.setTelegramSettings({
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      // Only overwrite the stored token when a fresh, non-empty one is sent — the
      // UI shows a masked placeholder and omits it on saves that don't change it.
      ...(typeof body.botToken === "string" && body.botToken.trim() ? { botToken: body.botToken.trim() } : {}),
      ...(body.allowedUsers !== undefined ? { allowedUsers: body.allowedUsers } : {}),
      ...(typeof body.acceptAll === "boolean" ? { acceptAll: body.acceptAll } : {}),
      ...(typeof body.rich === "boolean" ? { rich: body.rich } : {}),
    });
    // Restart so a new token/handle takes effect immediately (re-validates via getMe).
    await runtime.telegram.close();
    await runtime.telegram.startIfEnabled();
    return c.json(runtime.telegram.status());
  });

  app.put("/api/whatsapp/settings", async (c) => {
    const body = await c.req
      .json<{
        enabled?: boolean;
        allowedSenders?: string[] | string;
        groupsEnabled?: boolean;
        acceptAll?: boolean;
      }>()
      .catch(() => ({} as { enabled?: boolean; allowedSenders?: string[] | string; groupsEnabled?: boolean; acceptAll?: boolean }));
    const next = settings.setWhatsAppSettings({
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(body.allowedSenders !== undefined ? { allowedSenders: body.allowedSenders } : {}),
      ...(typeof body.groupsEnabled === "boolean" ? { groupsEnabled: body.groupsEnabled } : {}),
      ...(typeof body.acceptAll === "boolean" ? { acceptAll: body.acceptAll } : {}),
    });
    if (next.enabled) {
      await runtime.whatsapp.startIfEnabled();
      await runtime.whatsapp.refreshAllowedSenderAliases();
    } else {
      await runtime.whatsapp.disconnect();
    }
    return c.json(runtime.whatsapp.status());
  });

  app.post("/api/whatsapp/pair", async (c) => {
    await runtime.whatsapp.pair();
    await runtime.whatsapp.waitForPairingSignal();
    return c.json(runtime.whatsapp.status());
  });

  app.post("/api/whatsapp/disconnect", async (c) => {
    settings.setWhatsAppSettings({ enabled: false });
    await runtime.whatsapp.disconnect();
    return c.json(runtime.whatsapp.status());
  });

  app.post("/api/whatsapp/reset-session", async (c) => {
    const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string });
    if (body.confirm !== "RESET") return c.json({ error: "confirm must be RESET" }, 400);
    settings.setWhatsAppSettings({ enabled: false });
    await runtime.whatsapp.resetSession();
    return c.json(runtime.whatsapp.status());
  });

  app.get("/api/token", (c) =>
    c.json({ token: settings.apiToken(), mcpPath: "/mcp" }),
  );

  app.post("/api/token/regenerate", (c) => c.json({ token: settings.regenerateApiToken() }));

  app.get("/api/connections", (c) =>
    c.json({
      token: settings.apiToken(),
      mcpPath: "/mcp",
      clients: runtime.state.listMcpClients(),
      grants: runtime.oauth.listTokens(),
    }),
  );

  app.post("/api/connections/revoke", async (c) => {
    const { clientId } = await c.req.json<{ clientId?: string }>().catch(() => ({}) as { clientId?: string });
    if (!clientId) return c.json({ error: "clientId is required" }, 400);
    runtime.oauth.revokeClient(clientId);
    return c.json({ ok: true });
  });

  app.get("/api/vault", async (c) => {
    const vaultConfigured = settings.vaultConfigured();
    let cloned = await access(join(runtime.workdir, ".git")).then(() => true).catch(() => false);
    let headSha: string | null = null;
    let cloneError: string | null = null;
    if (vaultConfigured) {
      // getRepo clones on first use (and runs the schema-v1 migration)
      try {
        const repo = await runtime.getRepo();
        headSha = await repo.headSha();
        cloned = true;
      } catch (err) {
        cloneError = (err as Error).message;
      }
    }
    return c.json({
      repo: settings.get("vault_repo"),
      branch: settings.get("vault_branch") ?? "main",
      vaultConfigured,
      configured: settings.configured(),
      provider: settings.provider(),
      llmReady: Boolean(settings.activeApiKey()),
      cloned,
      headSha,
      cloneError,
    });
  });

  app.post("/api/vault/sync", async (c) => {
    const repo = await runtime.getRepo();
    await repo.pull();
    return c.json({ ok: true, headSha: await repo.headSha() });
  });

  app.post("/api/vault/reclone", async (c) => {
    await runtime.reclone();
    const repo = await runtime.getRepo();
    return c.json({ ok: true, headSha: await repo.headSha() });
  });

  app.get("/api/vault/lint", async (c) => c.json(await runtime.lint()));

  app.post("/api/vault/clean-slate", async (c) => c.json(await runtime.cleanSlate()));

  // --- GitHub App connect flow (manifest) ---

  /** Public base URL as seen through the reverse proxy. */
  const baseUrl = (c: { req: { header: (n: string) => string | undefined; url: string } }): string => {
    const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
    return `${proto}://${host}`;
  };

  app.get("/api/github/app/status", (c) => c.json(appStatus(settings)));

  app.get("/api/github/app/start", (c) => c.json(buildManifest(baseUrl(c))));

  // GitHub redirects the user's browser here after creating the app
  app.get("/api/github/app/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.redirect("/?github=error&reason=missing_code");
    try {
      const application = await exchangeManifestCode(code, settings);
      runtime.invalidate();
      // continue straight into the install step (repo picker on GitHub's side)
      return c.redirect(`https://github.com/apps/${application.slug}/installations/new`);
    } catch (err) {
      // Never bare-500 a connection flow — log it and bounce back to the UI
      // with a readable reason (e.g. an expired/used manifest code).
      const reason = err instanceof Error ? err.message : "manifest exchange failed";
      console.error("[github] manifest callback failed:", reason);
      return c.redirect(`/?github=error&reason=${encodeURIComponent(reason.slice(0, 200))}`);
    }
  });

  // ...and here after choosing which repos to grant
  app.get("/api/github/app/setup", (c) => {
    const installationId = c.req.query("installation_id");
    if (installationId) {
      settings.setRaw("github_app_installation_id", installationId);
      runtime.invalidate();
    }
    return c.redirect("/?github=connected");
  });

  app.get("/api/github/repos", async (c) => c.json({ repositories: await listInstallationRepos(settings) }));

  app.post("/api/github/app/disconnect", (c) => {
    disconnectApp(settings);
    runtime.invalidate();
    return c.json({ ok: true });
  });

  // --- engine ops ---

  app.post("/api/store", async (c) => {
    const body = await c.req.json<{ content?: string; hints?: string[]; verbatim?: boolean }>();
    if (!body.content) return c.json({ error: "content is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(
      await engine.store({
        content: body.content,
        source: "web",
        ...(body.hints ? { hints: body.hints } : {}),
        ...(body.verbatim !== undefined ? { verbatim: body.verbatim } : {}),
      }),
    );
  });

  app.post("/api/ask", async (c) => {
    const { question } = await c.req.json<{ question?: string }>();
    if (!question) return c.json({ error: "question is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(await engine.ask(question));
  });

  app.post("/api/chat", async (c) => {
    const { message } = await c.req.json<{ message?: string }>();
    if (!message) return c.json({ error: "message is required" }, 400);
    const cleanSlate = await handleCleanSlateChat(message, runtime);
    if (cleanSlate) return c.json(cleanSlate);
    const engine = await runtime.getEngine();
    const reply = await engine.handleTasking({ text: message, surface: "web", conversationKey: "default" });
    return c.json({ text: reply.text, sources: [], actions: reply.actions });
  });

  // #35 ping primitive: the external backlog monitor POSTs here (bearer-authed
  // like all /api/*) to make Zenod proactively message the owner when a Codex
  // job lands or blocks. The monitor passes `surface` (read from the ticket's
  // origin: label) so the ping goes back to the channel the work was requested
  // on — Telegram → Telegram, WhatsApp → WhatsApp. Unknown/absent surface (or a
  // surface with no proactive channel, e.g. web) falls back to WhatsApp, the
  // historical default. The WhatsApp/Telegram connections stay in the app.
  app.post("/api/notify", async (c) => {
    const { text, surface } = await c.req
      .json<{ text?: string; surface?: string }>()
      .catch(() => ({ text: undefined, surface: undefined }));
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    const result =
      surface === "telegram"
        ? await runtime.telegram.notifyOwner(text)
        : await runtime.whatsapp.notifyOwner(text);
    return c.json(result);
  });

  app.post("/api/test/chat", async (c) => {
    const body = await c.req.json<SyntheticChatRequest>().catch((): SyntheticChatRequest => ({}));
    if (!body.message?.trim()) return c.json({ error: "message is required" }, 400);
    let result: Awaited<ReturnType<typeof runSyntheticChat>>;
    try {
      result = await runSyntheticChat({
        request: body,
        defaultSurface: "mcp",
        getEngine: () => runtime.getEngine(),
        recordAudit: (input) => chatTestAudit.recordChatTestRun(input),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid test chat request" }, 400);
    }
    return c.json(result, result.status === "ok" ? 200 : 500);
  });

  app.get("/api/test/chat", (c) => {
    const limit = Number(c.req.query("limit") ?? "20");
    return c.json({ runs: chatTestAudit.listChatTestRuns(Number.isFinite(limit) ? limit : 20) });
  });

  app.get("/api/test/chat/:correlationId", (c) => {
    const run = chatTestAudit.getChatTestRun(c.req.param("correlationId"));
    if (!run) return c.json({ error: "test chat run not found" }, 404);
    return c.json({ run });
  });

  // Streaming twin of /api/chat: newline-delimited JSON events
  // ({type:"delta"|"done"|"error"}). getEngine() runs first so a config error
  // surfaces as a normal 409 before the stream opens.
  app.post("/api/chat/stream", async (c) => {
    const { message } = await c.req.json<{ message?: string }>();
    if (!message) return c.json({ error: "message is required" }, 400);
    const cleanSlate = await handleCleanSlateChat(message, runtime);
    if (cleanSlate) {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(JSON.stringify({ type: "delta", text: cleanSlate.text }) + "\n"));
          controller.enqueue(enc.encode(JSON.stringify({ type: "done", sources: cleanSlate.sources }) + "\n"));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    const engine = await runtime.getEngine();
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
          } catch {
            open = false; // client disconnected mid-stream
          }
        };
        // Keep-alive: a long tool call (model download, whisper transcription)
        // can run minutes with no output. Without a heartbeat the reverse proxy
        // (Cloudflare/Traefik ~100s idle) drops the connection → "network error".
        const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
        try {
          const reply = await engine.chat(message, "web", {
            onDelta: (delta) => send({ type: "delta", text: delta }),
            onToolEvent: (event) => {
              console.log(`[chat] tool ${event.phase}: ${event.tool} — ${event.label}`);
              send({ type: "tool", phase: event.phase, tool: event.tool, label: event.label });
            },
          });
          send({ type: "done", sources: reply.sources, ...(reply.stored ? { stored: reply.stored } : {}) });
        } catch (err) {
          console.error("[chat] stream failed:", err);
          send({ type: "error", message: err instanceof Error ? err.message : "chat failed" });
        } finally {
          clearInterval(heartbeat);
          open = false;
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
    });
  });

  // History and clear touch only the conversation store — no engine, repo, or LLM,
  // so opening the chat tab never triggers a vault clone.
  app.get("/api/chat/history", async (c) => {
    const window = await runtime.state.recentWindow(conversationId("web"));
    return c.json({ messages: window.map((m) => ({ role: m.role, text: m.text })) });
  });

  app.delete("/api/chat", async (c) => {
    await runtime.state.clearConversation(conversationId("web"));
    return c.json({ ok: true });
  });

  app.post("/api/work", async (c) => {
    const { objective, plan } = await c.req.json<{ objective?: string; plan?: string }>();
    if (!objective) return c.json({ error: "objective is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(await engine.work({ objective, ...(plan ? { plan } : {}) }));
  });

  app.get("/api/search", async (c) => {
    const query = c.req.query("q") ?? "";
    if (!query) return c.json({ error: "q is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json({ hits: await engine.search(query) });
  });

  app.get("/api/note", async (c) => {
    const path = c.req.query("path") ?? "";
    if (!path) return c.json({ error: "path is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(await engine.get(path));
  });

  // --- MCP (Streamable HTTP, stateless: fresh transport+server per request) ---

  app.all("/mcp", requireMcpAuth(settings, runtime.oauth), async (c) => {
    const { incoming, outgoing } = c.env;
    // The Console's public front door is a straight-through gateway over the mesh:
    // it re-publishes the enabled agents' own tools and forwards calls directly to
    // each owner (no council LLM). Every other agent exposes its own tool surface.
    // Only the BARE Console (vaultless with no domain capability) is the mesh
    // gateway. Backlog (Archus), executor (Epaminon), and outbound agents are
    // vaultless too, but each must expose its OWN MCP tool surface
    // (chat_with_<name> + its domain tools) — not the gateway.
    const isConsole = (agent.vaultless ?? false) && !agent.backlog && !agent.executor && !agent.outbound;
    const server = isConsole
      ? buildMeshGatewayServer((name) => settings.peers().find((p) => p.name === name) ?? null)
      : buildMcpServer(
          () => runtime.getEngine(),
          () => buildDriveTools(settings, runtime.ingestQueue),
          () => runtime.cleanSlate(),
          (input) => chatTestAudit.recordChatTestRun(input),
          {
            enqueue: (kind, input) => runtime.taskJobQueue.enqueue(kind, input),
            get: (id) => runtime.taskJobQueue.get(id),
          },
          (input) => editGithubIssue(settings, input),
          (input) => createGithubIssue(settings, input),
          agent.name,
        );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;

    // Record the connecting client from the initialize handshake (for the UI status).
    const init = Array.isArray(body) ? body.find((m) => m?.method === "initialize") : body;
    const clientInfo = init?.method === "initialize" ? init?.params?.clientInfo : undefined;
    if (clientInfo?.name) {
      runtime.state.recordMcpClient(String(clientInfo.name), clientInfo.version ? String(clientInfo.version) : null);
    }

    await transport.handleRequest(incoming, outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  // --- static settings UI ---

  if (options.webDist) {
    const root = options.webDist;
    const noCache: Pick<ServeStaticOptions, "onFound"> = {
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      },
    };
    app.use("/*", serveStatic({ root, ...noCache }));
    app.get("*", serveStatic({ root, path: "index.html", ...noCache })); // SPA fallback
  }

  return app;
}

function cleanSlatePreview(): string {
  return [
    "Clean-slate vault onboarding is a two-commit setup for a fresh, empty vault repo.",
    "",
    "It will refuse to run if the vault already contains tracked or untracked files.",
    "",
    "To continue, send exactly `/clean-slate confirm`.",
  ].join("\n");
}

function formatCleanSlateResult(result: CleanSlateResult): string {
  return [
    "Clean-slate vault initialized.",
    "",
    `Vault path: ${result.vaultPath}`,
    `Branch: ${result.branch}`,
    `Initial clean commit: ${result.initialCommitSha}`,
    `Zenod setup commit: ${result.setupCommitSha}`,
    "",
    `Created top-level structure: ${result.topLevelPaths.join(", ")}`,
    `Lint: ${result.lint.ok ? "ok" : `${result.lint.errors.length} error(s)`}`,
    "",
    "Inspect:",
    ...result.inspect.map((cmd) => `- \`${cmd}\``),
    "",
    "Revert in order:",
    ...result.revert.map((cmd) => `- \`${cmd}\``),
  ].join("\n");
}

async function handleCleanSlateChat(
  message: string,
  runtime: Runtime,
): Promise<{ text: string; sources: []; cleanSlate?: CleanSlateResult } | null> {
  const trimmed = message.trim();
  if (trimmed === "/clean-slate" || /^start a clean slate vault\.?$/i.test(trimmed)) {
    return { text: cleanSlatePreview(), sources: [] };
  }
  if (trimmed !== "/clean-slate confirm") return null;
  const result = await runtime.cleanSlate();
  return { text: formatCleanSlateResult(result), sources: [], cleanSlate: result };
}
