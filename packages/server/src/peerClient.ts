import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VERSION } from "zenod";
import { pollPeerJob } from "./pollPeerJob.js";
import { validateWalletUrl } from "./walletUrl.js";

/**
 * The mesh: one agent calling another over MCP. A peer agent exposes its tools at
 * an MCP endpoint (e.g. https://c1.zenod.dev/mcp); we connect as a client with a
 * bearer token and call one of its tools. This is how the vaultless Console
 * delegates a memory question to Zenod (`ask_brain`) — it has no vault of its own.
 */
/** One tool this peer exposes to our chat: a friendly name → one of the peer's MCP tools. */
export interface PeerToolSpec {
  /** Tool name shown to our LLM, e.g. "add_memory". */
  as: string;
  /** The peer's MCP tool to call, e.g. "store_memory". */
  mcp: string;
  /** The single argument key that MCP tool takes, e.g. "content". */
  arg: string;
  /** Optional schema key for typed peer tools whose arguments should pass through unchanged. */
  inputSchema?: string;
  /** What the tool does (the model reads this). */
  description: string;
}

export interface PeerConfig {
  /** Short id, e.g. "zenod" — surfaced to the chat as the tool `ask_<name>`. */
  name: string;
  /** The peer's MCP endpoint URL, e.g. https://c1.zenod.dev/mcp */
  url: string;
  /** Bearer token the peer accepts (its api_token, or an OAuth token). */
  token: string;
  /** The peer MCP tool to call (legacy single-tool peers). Defaults to ask_brain. */
  tool?: string;
  /** Curated set of the peer's tools to expose (e.g. Zenod's memory toolset). */
  tools?: PeerToolSpec[];
  /**
   * The repo this peer was provisioned with (vault for memory agents, central
   * backlog for backlog agents). Kept on the Console purely for display + the
   * "Manage" affordance in the Team tab; the agent remains the source of truth.
   */
  repo?: string;
  /** Ring tenant wallet entry; requires downstream SSRF validation on every call. */
  wallet?: boolean;
  /** Set only by server policy when the exact host belongs to the private unit fleet. */
  allowPrivateHost?: boolean;
}

async function validatePeerTarget(peer: PeerConfig): Promise<void> {
  if (!peer.wallet) return;
  const hostname = new URL(peer.url).hostname.replace(/^\[|\]$/g, "");
  await validateWalletUrl(peer.url, { allowHosts: peer.allowPrivateHost ? [hostname] : [] });
}

export async function probePeer(peer: PeerConfig): Promise<"connected" | "error"> {
  try {
    await validatePeerTarget(peer);
    const client = new Client({ name: "zenod-wallet-probe", version: VERSION }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${peer.token}` },
        signal: AbortSignal.timeout(5_000),
      },
    });
    try {
      await client.connect(transport);
      await client.listTools();
      return "connected";
    } finally {
      await client.close().catch(() => {});
    }
  } catch {
    return "error";
  }
}

function extractText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/**
 * Call a peer agent's MCP tool once and return its text answer. Each call opens
 * and closes its own short-lived connection — simple and stateless, which is all
 * a single delegation needs. Errors are returned as a readable string so the
 * caller's model can relay a graceful failure rather than throwing mid-turn.
 */
export async function callPeer(
  peer: PeerConfig,
  mcpTool: string,
  argKey: string,
  input: string,
  extraArgs: Record<string, unknown> = {},
): Promise<string> {
  try {
    await validatePeerTarget(peer);
  } catch (err) {
    return `Could not reach peer agent "${peer.name}": ${(err as Error).message}`;
  }
  const client = new Client({ name: "zenod-mesh-client", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
    requestInit: { headers: { Authorization: `Bearer ${peer.token}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: mcpTool, arguments: { ...extraArgs, [argKey]: input } });
    const text = extractText(result);
    return text || `(${peer.name} returned an empty answer)`;
  } catch (err) {
    return `Could not reach peer agent "${peer.name}": ${(err as Error).message}`;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Raw passthrough result of a peer tool call — shaped like an MCP tool response
 * (CallToolResult), so a gateway execute can return it directly. The index
 * signature mirrors the SDK's result type (it carries optional _meta etc.).
 */
export interface PeerToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [key: string]: unknown };
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Call a peer's MCP tool with a FULL argument object and relay its result
 * unchanged. This is the mesh GATEWAY primitive: the Console re-publishes a
 * peer's real tool and forwards the external caller's arguments straight through,
 * returning the peer's response verbatim — no LLM in the path. A connection
 * failure comes back as an isError result so the caller sees a graceful error.
 */
export async function callPeerTool(
  peer: PeerConfig,
  mcpTool: string,
  args: Record<string, unknown>,
): Promise<PeerToolResult> {
  try {
    await validatePeerTarget(peer);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Could not reach peer agent "${peer.name}": ${(err as Error).message}` }],
      isError: true,
    };
  }
  const client = new Client({ name: "zenod-mesh-client", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
    requestInit: { headers: { Authorization: `Bearer ${peer.token}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: mcpTool, arguments: args });
    const rawContent = Array.isArray(result.content) ? result.content : [];
    const content = rawContent
      .filter((c): c is { type: "text"; text: string } => (c as { type?: string })?.type === "text" && typeof (c as { text?: unknown }).text === "string")
      .map((c) => ({ type: "text" as const, text: c.text }));
    return {
      content: content.length ? content : [{ type: "text", text: `(${peer.name} returned no text)` }],
      ...(result.structuredContent ? { structuredContent: result.structuredContent as { [key: string]: unknown } } : {}),
      ...(result.isError ? { isError: true } : {}),
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Could not reach peer agent "${peer.name}": ${(err as Error).message}` }],
      isError: true,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Call a peer tool with full structured arguments, returning readable text for the chat loop. */
export async function callPeerWithArgs(peer: PeerConfig, mcpTool: string, args: Record<string, unknown>): Promise<string> {
  const result = await callPeerTool(peer, mcpTool, args);
  const text = extractText(result);
  if (peer.wallet && mcpTool === "store_memory" && !result.isError) {
    const structuredJobId = typeof result.structuredContent?.jobId === "string" ? result.structuredContent.jobId : null;
    const jobId = structuredJobId ?? text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
    if (jobId) {
      const completed = await pollPeerJob([peer], jobId, 1_000, 180_000);
      if (completed.status === "done" && completed.result && typeof completed.result === "object") {
        const receipt = completed.result as {
          evidenceRef?: string;
          pagesTouched?: string[];
          commitSha?: string;
          githubUrls?: string[];
          question?: string;
        };
        return [
          receipt.question ? `QUESTION FOR THE USER: ${receipt.question}` : "Stored.",
          receipt.evidenceRef ? `evidence: ${receipt.evidenceRef}` : "",
          receipt.pagesTouched?.length ? `pages: ${receipt.pagesTouched.join(", ")}` : "",
          receipt.commitSha ? `commit: ${receipt.commitSha}` : "",
          ...(receipt.githubUrls ?? []),
        ].filter(Boolean).join("\n");
      }
      if (completed.status === "error") return `Zenod filing failed: ${completed.error ?? "unknown error"}`;
      return `Zenod filing receipt timed out for job ${jobId}.`;
    }
  }
  if (text) return text;
  if (result.structuredContent) return JSON.stringify(result.structuredContent);
  return `(${peer.name} returned no text)`;
}
