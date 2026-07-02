import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { VERSION } from "zenod";
import { z, type ZodRawShape } from "zod";

import { callPeerTool, type PeerConfig } from "./peerClient.js";
import {
  formatConversationTranscript,
  transcriptQueryFromToolArgs,
  type ConversationTranscriptReader,
} from "./conversationTranscript.js";
import {
  formatSessionLog,
  sessionLogQueryFromToolArgs,
  type SessionLogReader,
} from "./sessionLog.js";
import {
  ASK_BRAIN_SHAPE,
  CHAT_WITH_CONSOLE_SHAPE,
  EXECUTION_STATUS_SHAPE,
  GET_MEMORY_SHAPE,
  GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE,
  FETCH_EXECUTION_DELIVERABLE_SHAPE,
  READ_LLM_TIMELINE_SHAPE,
  GET_TASK_RESULT_SHAPE,
  REQUEST_BACKLOG_ACTION_SHAPE,
  RUN_ISSUE_SHAPE,
  RUN_EPHEMERAL_TASK_SHAPE,
  SEARCH_MEMORY_SHAPE,
  STORE_MEMORY_SHAPE,
  V4_EXECUTION_STATUS_SHAPE,
  V4_FIND_ISSUE_SHAPE,
  V4_GET_ISSUE_SHAPE,
  V4_LIST_ISSUES_SHAPE,
} from "./mcpToolSchemas.js";
import { getToolOutputSchema } from "./toolOutput.js";

/**
 * Archus's WRITE surface is semantic, not mechanical. A backlog write is a
 * judgment call — where does it belong (which repo vs the central backlog), is it
 * a duplicate, what labels/structure, is it runnable — so every public write is an
 * INTENT routed to Archus's guardian brain (chat_with_archus), which interprets it
 * and acts with its own private GitHub tools. The distinct names are intent
 * signals (and drive the activity line); the shared `message` carries the request.
 */
const INTENT_SHAPE = {
  message: z.string().min(1).describe("What you want, in natural language — Archus decides how to honour it per his guidelines."),
};

/**
 * The Console's PUBLIC MCP front door is a straight-through gateway, not a chat.
 *
 * It re-publishes the suite agents' own tools and forwards each call directly to
 * the owning agent's MCP tool (raw passthrough, no LLM on the Console and no LLM
 * on the agent for these structured tools). An external MCP client's own model
 * picks the tool and fills the arguments; calling it just runs it. That avoids
 * the redundant "Console LLM re-interprets a request the caller's LLM already
 * made" double-billing — the council LLM earns its keep only in the human chat
 * surfaces (web/WhatsApp/Telegram), not here.
 *
 * Tool names match the owner's real tool exactly (name-preserving proxy). Owners
 * are addressed by peer name; a tool is published only when its owner is enabled.
 */
interface GatewayTool {
  /** Tool name as published at the front door. */
  name: string;
  /** Peer that owns/executes the tool. */
  owner: string;
  /** The owner's real MCP tool to call. Defaults to `name` (name-preserving proxy). */
  peerTool?: string;
  /**
   * For brain-routed tools: a directive prepended to `message` so the intent the
   * tool name carries actually reaches the agent's brain (the brain only sees the
   * forwarded message, not which tool was called).
   */
  intentPrefix?: string;
  /** Optional argument adapter for public semantic aliases that call a chat tool. */
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  v4OutputSchemaName?: string;
  requiresV4ToolNames?: boolean;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

export interface ConsoleChatRequest {
  message: string;
  surface?: "whatsapp" | "telegram" | "web" | "mcp" | "selftest";
  conversationKey?: string;
}

export type ConsoleChatRunner = (request: ConsoleChatRequest) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [key: string]: unknown };
  isError?: boolean;
}>;

const GATEWAY_TOOLS: GatewayTool[] = [
  {
    name: "search_memory",
    owner: "zenod",
    title: "Search memory",
    description:
      "Deterministic keyword search over the user's memory vault (via Zenod). Returns ranked note paths with snippets, scores, and GitHub source URLs. Fast, no LLM — call this first to locate memories, then get_memory to read one in full.",
    inputSchema: SEARCH_MEMORY_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_memory",
    owner: "zenod",
    title: "Get memory",
    description:
      "Read one note from the user's memory vault by its vault-relative path (via Zenod). Returns frontmatter, full content, and the GitHub source URL. Paths come from search_memory results.",
    inputSchema: GET_MEMORY_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "ask_brain",
    owner: "zenod",
    title: "Ask the memory",
    description:
      "Ask the user's memory a free-form question (via Zenod). It runs its own read-only research loop over the vault and returns a synthesized, cited answer. Use for fuzzy or cross-note questions where search_memory alone is not enough.",
    inputSchema: ASK_BRAIN_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Zenod's WRITE — name-preserving passthrough to its real `store_memory`. This
  // honours invariant #5 (writes go through the agent's guardian brain) WITHOUT an
  // intentPrefix/chat_with_zenod hop because the store_memory tool IS already the
  // librarian brain: it runs Zenod's classify + compose to decide where the memory
  // is filed. The mechanical CRUD stays private; this entry line just hands the raw
  // content to that brain. ASYNC — returns a jobId; poll via get_task_result below.
  {
    name: "store_memory",
    owner: "zenod",
    title: "Store a memory",
    description:
      "File a memory into the user's vault through Zenod's librarian pipeline: it records immutable evidence, classifies + composes where the meaning belongs, files it onto the right page(s) with citations, validates, and commits to GitHub. If the librarian is unsure where it belongs it returns a question instead of guessing — relay that to the user. ASYNC: returns a jobId immediately (status 'queued') and does NOT wait — poll get_task_result with that jobId until status is 'done' to read the evidence ref, pages touched, and commit SHA.",
    inputSchema: STORE_MEMORY_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  // Poll an async job started by store_memory. get_task_result is a generic poller,
  // but today Zenod is the only gateway owner with async jobs, so routing it to
  // "zenod" is correct; revisit if another agent ever exposes an async tool here.
  {
    name: "get_task_result",
    owner: "zenod",
    title: "Check filing status",
    description:
      "Poll an async job started by store_memory, by its jobId. Returns the current status: 'queued'/'running' (poll again shortly), 'done' (with the result — evidence ref, pages touched, commit SHA, and any question for the user), 'error' (with the message), or 'interrupted' (re-issue the original store_memory call).",
    inputSchema: GET_TASK_RESULT_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Archus's writes + reasoning — all routed to his guardian brain (intent in,
  // Archus decides placement/structure/labels and acts). Named for intent signal.
  {
    name: "archus.get_issue",
    owner: "archus",
    title: "Get issue",
    description:
      "Owner: Archus. Deterministic v4 read of one exact GitHub issue by qualified target owner/repo#N. Use this instead of chat when the issue id is exact.",
    inputSchema: V4_GET_ISSUE_SHAPE,
    v4OutputSchemaName: "archus.get_issue",
    requiresV4ToolNames: true,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "archus.find_issue",
    owner: "archus",
    title: "Find issue",
    description:
      "Owner: Archus. Structured resolver for fuzzy issue references such as '#108', 'that ticket', or title text. Returns a unique resolution, candidates, or not-found evidence with searched scope. Does not mutate.",
    inputSchema: V4_FIND_ISSUE_SHAPE,
    v4OutputSchemaName: "archus.find_issue",
    requiresV4ToolNames: true,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "archus.list_issues",
    owner: "archus",
    title: "List issues",
    description:
      "Owner: Archus. Deterministic v4 inventory read for open/closed/all issues with explicit repo, label, date, and limit filters. Does not resolve fuzzy references.",
    inputSchema: V4_LIST_ISSUES_SHAPE,
    v4OutputSchemaName: "archus.list_issues",
    requiresV4ToolNames: true,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "archus.request_backlog_action",
    owner: "archus",
    peerTool: "chat_with_archus",
    intentPrefix:
      "Backlog action request. Interpret the user's intent, choose create/update/comment/close, choose the correct repo, avoid duplicates, and return verified issue URLs. Do not run/queue execution from this tool: ",
    title: "Archus backlog action",
    description:
      "Owner: Archus. Semantic GitHub backlog write gateway for create/update/comment/close issue requests. Use this when the user wants the backlog changed but is not asking to run work. Archus decides the repo, structure, labels, and exact private GitHub operation, then returns issue numbers and URLs.",
    inputSchema: REQUEST_BACKLOG_ACTION_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "archus.run_issue",
    owner: "archus",
    peerTool: "chat_with_archus",
    mapArgs: (args) => {
      const target = typeof args.target === "string" ? args.target : "";
      const instructions = typeof args.instructions === "string" && args.instructions.trim() ? `\nUser instructions: ${args.instructions.trim()}` : "";
      const repo = typeof args.repo === "string" && args.repo.trim() ? `\nExecution backlog repo: ${args.repo.trim()}` : "";
      return { message: `Run this exact work issue by validating it and calling your private queue_execution tool: ${target}${instructions}${repo}` };
    },
    title: "Archus run issue",
    description:
      "Owner: Archus. Start execution ONLY for one exact existing work issue that the user already named as owner/repo#N in the current message. Do not invent, guess, or placeholder a target number. For create-and-run requests where the issue does not exist yet, send the full natural-language request to Archus's backlog action/open-issue path so Archus creates the issue and queues the created issue itself. Archus validates the issue is runnable, mints the execution ticket in its configured central execution backlog, and dispatches Epaminon through the private lane. Do not use this to ask whether something ran; use epaminon.execution_status/execution_status for status reads.",
    inputSchema: RUN_ISSUE_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "create_issue",
    owner: "archus",
    peerTool: "chat_with_archus",
    intentPrefix: "Open backlog issue(s) for the following — decide placement and structure per your rules: ",
    title: "Open backlog issue(s)",
    description:
      "Tell Archus to open issue(s). Describe what you want filed in natural language; Archus decides where it belongs (which repo vs the central backlog), checks for duplicates, applies labels/structure per his guidelines, writes runnable tickets, and returns the qualified IDs (owner/repo#N).",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "edit_issue",
    owner: "archus",
    peerTool: "chat_with_archus",
    intentPrefix: "Edit a backlog issue as follows: ",
    title: "Edit a backlog issue",
    description:
      "Tell Archus to edit an issue — retitle, revise the body, relabel, comment, or change status. Name the issue (owner/repo#N) and what you want changed; Archus applies it within his governance rules (e.g. queue/merge gates) and confirms.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "close_issue",
    owner: "archus",
    peerTool: "chat_with_archus",
    intentPrefix: "Close a backlog issue as follows: ",
    title: "Close a backlog issue",
    description:
      "Tell Archus to close an issue (owner/repo#N), optionally with a closing comment/reason. Archus closes it, updates any parent/tracking ticket, and confirms.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ask_archus",
    owner: "archus",
    peerTool: "chat_with_archus",
    title: "Ask Archus (backlog brain)",
    description:
      "Ask Archus a non-trivial backlog question or hand him judgment: triage, prioritize, summarize what's open across repos, or turn a messy idea into runnable tickets. He reasons over the backlog with his own LLM and may act, returning a synthesized reply.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  // Callistheness's send surface. Every public tool is a WRITE that publishes/sends —
  // outward-facing and irreversible — so each is a semantic intent routed to his
  // guardian brain (chat_with_outbound), which drafts in the user's voice and MUST
  // confirm the exact content/target before it ever calls a connector. The brain,
  // not the gateway, decides to send; these names just carry the channel intent.
  {
    name: "post_tweet",
    owner: "outbound",
    peerTool: "chat_with_outbound",
    intentPrefix:
      "The user wants to post the following to X (Twitter). Draft it in their voice and, unless they have already confirmed this exact text in the conversation, show the final post and ASK them to confirm before sending — do not post unconfirmed: ",
    title: "Post to X (Twitter)",
    description:
      "Tell Callistheness to post to X. Describe (or give) what to post in natural language; Callistheness drafts it in the user's voice, confirms the exact text first (posting is public and irreversible), then posts and returns the URL. Refuses spam/mass sends.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "post_reddit",
    owner: "outbound",
    peerTool: "chat_with_outbound",
    intentPrefix:
      "The user wants to submit the following to Reddit. Confirm the target subreddit, title, and body, drafted in their voice, and — unless they have already confirmed this exact content — ASK them to confirm before submitting; do not post unconfirmed: ",
    title: "Post to Reddit",
    description:
      "Tell Callistheness to submit a Reddit post. Say what to post and to which subreddit; Callistheness drafts it, confirms the exact content and target first (it is public and irreversible), then submits and returns the URL. Refuses spam/cross-post floods.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "send_email",
    owner: "outbound",
    peerTool: "chat_with_outbound",
    intentPrefix:
      "The user wants to send the following email. Confirm the recipient, subject, and body, drafted in their voice, and — unless they have already confirmed this exact message and recipient — ASK them to confirm before sending; a sent email cannot be recalled: ",
    title: "Send an email",
    description:
      "Tell Callistheness to send an email. Give the recipient and what to say; Callistheness drafts it in the user's voice, confirms the exact recipient and content first (a sent email cannot be recalled), then sends and confirms. Refuses spam/mass mailing.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ask_outbound",
    owner: "outbound",
    peerTool: "chat_with_outbound",
    title: "Ask Callistheness (marketing brain)",
    description:
      "Ask Callistheness to help with marketing/outbound communications — draft a tweet/post/email, adapt tone for a channel, or plan a send. He reasons in the user's voice and may draft, but never publishes/sends without explicit confirmation. For composing and advice, not a committed send.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  // Phylax's inward notification surface. Callers report events/facts; Phylax
  // decides whether/how to reach the principal and uses his private
  // deliver_to_principal tool only after composing the final message.
  {
    name: "raise_event",
    owner: "phylax",
    peerTool: "chat_with_phylax",
    intentPrefix:
      "An agent or system is raising this event for possible notification. Treat it as a fact, not a final message; decide whether to suppress, batch, hold, enrich, or notify Jordi: ",
    title: "Raise event to Phylax",
    description:
      "Report an event/fact to Phylax, the inward-facing attention gatekeeper. Include source, event, urgency, and reference if known; Phylax decides whether/when/how it reaches Jordi.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ask_phylax",
    owner: "phylax",
    peerTool: "chat_with_phylax",
    title: "Ask Phylax (notification gatekeeper)",
    description:
      "Ask Phylax about notification handling, quiet hours, batching, urgency, or whether an event should interrupt Jordi. For advice/control, not direct delivery.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "epaminon.run_existing_issue",
    owner: "epaminon",
    title: "Run existing issue",
    description:
      "Owner: Epaminon. Start execution for one exact existing work issue. Input must be a qualified target owner/repo#N. Use this for direct run/start/execute requests when the issue already exists. Do not use for status questions; use epaminon.execution_status/execution_status. If the user asks to notify only after terminal/blocked state, pass notifyOnStart=false.",
    inputSchema: RUN_ISSUE_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "epaminon.run_ephemeral_task",
    owner: "epaminon",
    title: "Run ephemeral task",
    description:
      "Owner: Epaminon. Start one one-off execution task without creating a GitHub issue by default. Use for ephemeral research or operational work when the user did not ask for a durable backlog ticket. Fire EXACTLY ONE ephemeral per user task — never also queue a separate 'verification' run (evidence is verified automatically and shown by execution_status), and never queue one that 'runs after' another since ephemerals run in parallel immediately. Pass repo (owner/repo) and path when the task works a known codebase so the worker does not have to guess.",
    inputSchema: RUN_EPHEMERAL_TASK_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  // Epaminon owns execution reads and exact existing-issue execution starts.
  // Backlog creation/update stays with Archus.
  {
    name: "epaminon.execution_status",
    owner: "epaminon",
    title: "Execution status",
    description:
      "Owner: Epaminon. Deterministic v4 read of the execution queue using explicit fields only: workIssue, executionIssue, executionId, state, since, and limit. Does not use fuzzy message input and does not start work.",
    inputSchema: V4_EXECUTION_STATUS_SHAPE,
    v4OutputSchemaName: "epaminon.execution_status",
    requiresV4ToolNames: true,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "execution_status",
    owner: "epaminon",
    title: "Check execution status",
    description:
      "Read Epaminon's live execution queue — execution tickets queued/running/blocked/awaiting review/done, and any blockers. Deterministic, no chat/LLM. Optionally reference work tickets as owner/repo#N.",
    inputSchema: EXECUTION_STATUS_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

const CHAT_WITH_CONSOLE_OUTPUT_SCHEMA = "console.chat_with_console";

type RegisteredToolLike = {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  execution?: unknown;
  _meta?: Record<string, unknown>;
  enabled: boolean;
};

function truthyEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function strictOutputSchemaAllowlist(env = process.env): Set<string> {
  return new Set(
    String(env.ZENOD_V4_STRICT_TOOLS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function shouldAdvertiseStrictOutputSchema(publishedName: string, schemaName: string, env = process.env): boolean {
  if (!truthyEnv(env.ZENOD_V4_STRICT_OUTPUT_SCHEMA)) return false;
  const allowed = strictOutputSchemaAllowlist(env);
  return allowed.has("*") || allowed.has(publishedName) || allowed.has(schemaName);
}

function v4ToolNamesEnabled(env = process.env): boolean {
  return truthyEnv(env.ZENOD_V4_TOOL_NAMES);
}

function jsonInputSchema(inputSchema: unknown): Record<string, unknown> {
  const obj = normalizeObjectSchema(inputSchema as never);
  return obj ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: "input" }) : { type: "object", properties: {}, required: [] };
}

function installStrictOutputSchemaListOverride(server: McpServer, outputSchemaNames: Map<string, string>): void {
  if (!truthyEnv(process.env.ZENOD_V4_STRICT_OUTPUT_SCHEMA)) return;
  server.server.setRequestHandler(ListToolsRequestSchema, () => {
    const registered = (server as unknown as { _registeredTools: Record<string, RegisteredToolLike> })._registeredTools;
    return {
      tools: Object.entries(registered)
        .filter(([, tool]) => tool.enabled)
        .map(([name, tool]) => {
          const definition: Record<string, unknown> = {
            name,
            title: tool.title,
            description: tool.description,
            inputSchema: jsonInputSchema(tool.inputSchema),
            annotations: tool.annotations,
            execution: tool.execution,
            _meta: tool._meta,
          };
          const schemaName = outputSchemaNames.get(name);
          if (schemaName && shouldAdvertiseStrictOutputSchema(name, schemaName)) {
            const outputSchema = getToolOutputSchema(schemaName);
            if (outputSchema) definition.outputSchema = outputSchema;
          }
          return definition;
        }),
    };
  });
}

/**
 * Build the Console's gateway MCP server. `resolvePeer` returns the connected
 * peer for an owner name (or null if that agent isn't enabled). Each published
 * tool forwards its full argument object straight to the owner via callPeerTool
 * and relays the response verbatim.
 */
/** R1-T3: resolve a reference to a completed execution's deliverable file(s) + honest state. */
export type DeliverableFetcher = (reference: string) => Promise<{ text: string; structured: Record<string, unknown> }>;

export function buildMeshGatewayServer(
  resolvePeer: (name: string) => PeerConfig | null,
  chatWithConsole?: ConsoleChatRunner,
  readConversationTranscript?: ConversationTranscriptReader,
  readSessionLog?: SessionLogReader,
  fetchDeliverable?: DeliverableFetcher,
): McpServer {
  const server = new McpServer({ name: "zenod-console-gateway", version: VERSION });
  const outputSchemaNames = new Map<string, string>();
  if (chatWithConsole) {
    outputSchemaNames.set("chat_with_console", CHAT_WITH_CONSOLE_OUTPUT_SCHEMA);
    server.registerTool(
      "chat_with_console",
      {
        title: "Chat with Console",
        description:
          "Send a natural-language prompt through the Console's own chat/tasking path, the same internal entry path used by /api/chat and the phone adapters after transcription. The Console decides which enabled peer agents/tools to call, and the response includes the reply plus recorded actions. Defaults to surface=whatsapp.",
        inputSchema: CHAT_WITH_CONSOLE_SHAPE,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (args) => chatWithConsole(args as ConsoleChatRequest),
    );
  }
  if (readConversationTranscript) {
    server.registerTool(
      "get_recent_conversation_transcript",
      {
        title: "Get recent conversation transcript",
        description:
          "Owner: Console. Deterministically read recent WhatsApp/phone conversation transcript from the Console channel audit store. Includes inbound/outbound lines, timestamps, message ids, status, media type, transcribed voice-note text, structured media evidence, media storage status, and linked storage receipts when available. Use messageId when the user names a specific WhatsApp message, voice note, or screenshot; that returns the matching row and linked replies/receipts. Use broader window/contact filters for recent phone transcript reviews; empty transcript bodies or missing media receipts are explicit evidence gaps.",
        inputSchema: GET_RECENT_CONVERSATION_TRANSCRIPT_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => {
        const query = transcriptQueryFromToolArgs((args ?? {}) as Record<string, unknown>);
        const entries = readConversationTranscript(query);
        return {
          content: [{ type: "text", text: formatConversationTranscript(entries) }],
          structuredContent: { entries, count: entries.length, sinceMs: query.sinceMs, windowMinutes: query.windowMinutes },
        };
      },
    );
  }
  if (readSessionLog) {
    server.registerTool(
      "read_llm_timeline",
      {
        title: "Read LLM usage timeline",
        description:
          "Owner: Console. Deterministically read the durable LLM-usage ledger (/data/usage.sqlite) as an operation-labelled, newest-first timeline of real (provider-billed) LLM calls — timestamp, operation, provider/model, token counts, and cost per call. This is the 'check the logs' primitive: it reads structured data that survives container recreate, unlike docker stdout which every deploy wipes. Use it to answer 'what ran / why was a reply slow / where did the tokens go' without host or SSH access. Pair with get_recent_conversation_transcript for the message side. Empty results mean nothing ran in the window (or the filter excluded it), not that logging failed.",
        inputSchema: READ_LLM_TIMELINE_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => {
        const query = sessionLogQueryFromToolArgs((args ?? {}) as Record<string, unknown>);
        const calls = readSessionLog(query);
        return {
          content: [{ type: "text", text: formatSessionLog(calls, query.windowMinutes) }],
          structuredContent: { calls, count: calls.length, sinceMs: query.sinceMs, windowMinutes: query.windowMinutes },
        };
      },
    );
  }
  if (fetchDeliverable) {
    server.registerTool(
      "fetch_execution_deliverable",
      {
        title: "Fetch an execution's deliverable file",
        description:
          "Owner: Console. Resolve a completed execution to its deliverable and return the LIVE file body from GitHub at the run's head commit — so it works even for an unmerged or draft PR — plus the honest merge state ('merged to main' vs 'PR open — NOT merged yet'). Accepts an executionId, a fully-qualified 'owner/repo#N', or a message containing one. Use this to answer 'give me the file that ticket produced' with contents, not a guess; if it is unmerged the reply says so.",
        inputSchema: FETCH_EXECUTION_DELIVERABLE_SHAPE,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const reference = typeof (args as Record<string, unknown>)?.reference === "string" ? String((args as Record<string, unknown>).reference) : "";
        if (!reference.trim()) {
          return { content: [{ type: "text", text: "ERROR: reference is required" }], isError: true };
        }
        const { text, structured } = await fetchDeliverable(reference.trim());
        return { content: [{ type: "text", text }], structuredContent: structured };
      },
    );
  }
  for (const t of GATEWAY_TOOLS) {
    if (t.requiresV4ToolNames && !v4ToolNamesEnabled()) continue;
    const peer = resolvePeer(t.owner);
    if (!peer) continue; // owner agent not enabled → don't advertise its tools
    if (t.v4OutputSchemaName) outputSchemaNames.set(t.name, t.v4OutputSchemaName);
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
      async (args) => {
        let payload = t.mapArgs ? t.mapArgs((args ?? {}) as Record<string, unknown>) : ((args ?? {}) as Record<string, unknown>);
        // Prepend the intent directive so the tool-name signal reaches the brain.
        if (t.intentPrefix && typeof payload.message === "string") {
          payload = { ...payload, message: `${t.intentPrefix}${payload.message}` };
        }
        return callPeerTool(peer, t.peerTool ?? t.name, payload);
      },
    );
  }
  installStrictOutputSchemaListOverride(server, outputSchemaNames);
  return server;
}
