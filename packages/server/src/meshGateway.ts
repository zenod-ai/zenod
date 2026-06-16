import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "zenod";
import type { ZodRawShape } from "zod";

import { callPeerTool, type PeerConfig } from "./peerClient.js";
import {
  ASK_BRAIN_SHAPE,
  CREATE_ISSUE_SHAPE,
  EDIT_GITHUB_ISSUE_SHAPE,
  GET_MEMORY_SHAPE,
  SEARCH_MEMORY_SHAPE,
} from "./mcpToolSchemas.js";

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
  /** Tool name — must equal the owner peer's real MCP tool name. */
  name: string;
  /** Peer that owns/executes the tool. */
  owner: string;
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
  {
    name: "create_issue",
    owner: "archus",
    title: "Open a GitHub issue",
    description:
      "Open a new GitHub issue (via Archus) in the central backlog repo (or pass repo to target another). Write a runnable body — objective, scope, done-condition. Created at status:proposed; it does not run until explicitly queued. Returns the new number + URL.",
    inputSchema: CREATE_ISSUE_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "edit_github_issue",
    owner: "archus",
    title: "Edit a GitHub issue",
    description:
      "Edit one GitHub issue (via Archus): update title/body, add/remove/set labels, post a comment, replace assignees, or change the lifecycle status label. status:queued requires explicit user approval (queueApproval=true); status:approved-merge is not settable here.",
    inputSchema: EDIT_GITHUB_ISSUE_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
      async (args) => callPeerTool(peer, t.name, (args ?? {}) as Record<string, unknown>),
    );
  }
  return server;
}
