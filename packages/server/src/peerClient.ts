import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VERSION } from "zenod";

/**
 * The mesh: one agent calling another over MCP. A peer agent exposes its tools at
 * an MCP endpoint (e.g. https://app.zenod.dev/mcp); we connect as a client with a
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
  /** What the tool does (the model reads this). */
  description: string;
}

export interface PeerConfig {
  /** Short id, e.g. "zenod" — surfaced to the chat as the tool `ask_<name>`. */
  name: string;
  /** The peer's MCP endpoint URL, e.g. https://app.zenod.dev/mcp */
  url: string;
  /** Bearer token the peer accepts (its api_token, or an OAuth token). */
  token: string;
  /** The peer MCP tool to call (legacy single-tool peers). Defaults to ask_brain. */
  tool?: string;
  /** Curated set of the peer's tools to expose (e.g. Zenod's memory toolset). */
  tools?: PeerToolSpec[];
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
export async function callPeer(peer: PeerConfig, mcpTool: string, argKey: string, input: string): Promise<string> {
  const client = new Client({ name: "zenod-mesh-client", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(peer.url), {
    requestInit: { headers: { Authorization: `Bearer ${peer.token}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: mcpTool, arguments: { [argKey]: input } });
    const text = extractText(result);
    return text || `(${peer.name} returned an empty answer)`;
  } catch (err) {
    return `Could not reach peer agent "${peer.name}": ${(err as Error).message}`;
  } finally {
    await client.close().catch(() => {});
  }
}
