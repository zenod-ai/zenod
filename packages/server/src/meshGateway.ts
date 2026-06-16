import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "zenod";
import { z, type ZodRawShape } from "zod";

import { callPeerTool, type PeerConfig } from "./peerClient.js";
import { ASK_BRAIN_SHAPE, GET_MEMORY_SHAPE, SEARCH_MEMORY_SHAPE } from "./mcpToolSchemas.js";

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
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

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
  // Archus's writes + reasoning — all routed to his guardian brain (intent in,
  // Archus decides placement/structure/labels and acts). Named for intent signal.
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
  // Outbound's send surface. Every public tool is a WRITE that publishes/sends —
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
      "Tell Outbound to post to X. Describe (or give) what to post in natural language; Outbound drafts it in the user's voice, confirms the exact text first (posting is public and irreversible), then posts and returns the URL. Refuses spam/mass sends.",
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
      "Tell Outbound to submit a Reddit post. Say what to post and to which subreddit; Outbound drafts it, confirms the exact content and target first (it is public and irreversible), then submits and returns the URL. Refuses spam/cross-post floods.",
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
      "Tell Outbound to send an email. Give the recipient and what to say; Outbound drafts it in the user's voice, confirms the exact recipient and content first (a sent email cannot be recalled), then sends and confirms. Refuses spam/mass mailing.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "ask_outbound",
    owner: "outbound",
    peerTool: "chat_with_outbound",
    title: "Ask Outbound (comms brain)",
    description:
      "Ask Outbound to help with outbound communications — draft a tweet/post/email, adapt tone for a channel, or plan a send. He reasons in the user's voice and may draft, but never publishes/sends without explicit confirmation. For composing and advice, not a committed send.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  // Epaminon's execution surface. Writes (run a ticket, record an outcome) are
  // semantic intents routed to his guardian brain (chat_with_epaminon), which
  // enforces his rules (only run explicitly-approved tickets, qualified ids,
  // honest status) and acts with his GitHub tasking tools. The status read is a
  // plain question to the same brain — no intent directive. NOTE: these are
  // human/Console-facing execution triggers; they are NOT meant for autonomous
  // fan-out workers (running work is an explicit approval gate — see
  // docs/EPAMINON-C1-MCP-WIRING.md for the worker tool surface).
  {
    name: "run_ticket",
    owner: "epaminon",
    peerTool: "chat_with_epaminon",
    intentPrefix:
      "Run the following approved ticket now — queue it so the runner executes it; only act on a ticket explicitly approved to run, by its qualified owner/repo#N, and report back exactly what was queued: ",
    title: "Run a backlog ticket",
    description:
      "Tell Epaminon to RUN an approved ticket. Name the ticket (owner/repo#N) the user has explicitly approved to execute; Epaminon queues it so the fan-out runner picks it up (opens a PR, moves it to needs-review) and confirms what was queued. He runs only what is explicitly approved — never bulk-queues a backlog.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "report_outcome",
    owner: "epaminon",
    peerTool: "chat_with_epaminon",
    intentPrefix:
      "Record this execution outcome on the ticket you ran — comment the result with its evidence URL (PR/commit) on the qualified owner/repo#N, set the review status, and report the status up so Archus can reflect it onto the central tracker: ",
    title: "Report an execution outcome",
    description:
      "Hand Epaminon an execution outcome — the result and its evidence URL (PR/commit) — to record on the qualified repo ticket (owner/repo#N) he ran. He comments it, sets the review status, and reports up to Archus. He does not curate the backlog himself.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "execution_status",
    owner: "epaminon",
    peerTool: "chat_with_epaminon",
    title: "Check execution status",
    description:
      "Ask Epaminon where execution stands — which tickets are queued/running, in review, or shipped, and any blockers. A read-only status question (does not start work). Reference tickets as owner/repo#N.",
    inputSchema: INTENT_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

/**
 * Build the Console's gateway MCP server. `resolvePeer` returns the connected
 * peer for an owner name (or null if that agent isn't enabled). Each published
 * tool forwards its full argument object straight to the owner via callPeerTool
 * and relays the response verbatim.
 */
export function buildMeshGatewayServer(resolvePeer: (name: string) => PeerConfig | null): McpServer {
  const server = new McpServer({ name: "zenod-console-gateway", version: VERSION });
  for (const t of GATEWAY_TOOLS) {
    const peer = resolvePeer(t.owner);
    if (!peer) continue; // owner agent not enabled → don't advertise its tools
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
      async (args) => {
        let payload = (args ?? {}) as Record<string, unknown>;
        // Prepend the intent directive so the tool-name signal reaches the brain.
        if (t.intentPrefix && typeof payload.message === "string") {
          payload = { ...payload, message: `${t.intentPrefix}${payload.message}` };
        }
        return callPeerTool(peer, t.peerTool ?? t.name, payload);
      },
    );
  }
  return server;
}
