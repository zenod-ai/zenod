import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { VERSION } from "zenod";
import type { PeerTools } from "zenod";

/**
 * The Callistheness agent's PRIVATE send tools, wired into its chat brain.
 *
 * Callistheness is the guardian of SENDING: post to X, post to Reddit, send email. Each
 * capability lives in its OWN deployed MCP connector (the vendored x-mcp for X,
 * a reddit-mcp and a mail-mcp cloned from the x-mcp shape) — "group by job, one
 * agent composed from several internal MCP servers" (docs/SUITE-SCAFFOLD.md). The
 * brain reaches each connector over MCP and relays the result.
 *
 * These tools are NOT public: the public surface is the guardian brain
 * (chat_with_outbound), which interprets the intent, drafts in the user's voice,
 * and — per its persona — CONFIRMS before it ever calls one of these. Publishing is
 * outward-facing and irreversible, so the send is gated by the brain's judgment,
 * not exposed as a raw deterministic write.
 *
 * Connector endpoints are read from the environment (the headless Callistheness
 * container is env-configured on its compose, exactly like the x-mcp containers).
 * A connector whose URL is unset is simply "not connected yet" — the tool returns a
 * clear, non-throwing message so a model tool-call can't crash, and so Reddit/email
 * can land as a follow-up once their containers are deployed.
 */

/** One outbound channel = one MCP connector + the tool/arg used to publish on it. */
interface ConnectorSpec {
  /** Tool name exposed to the brain, e.g. "post_tweet". */
  as: string;
  /** Human label for the channel, used in messages, e.g. "X (Twitter)". */
  channel: string;
  /** Env var holding the connector's MCP endpoint URL. */
  urlEnv: string;
  /** Optional env var holding a bearer token for the connector. */
  tokenEnv: string;
  /** Env var overriding the connector's MCP tool to call (else `defaultTool`). */
  toolEnv: string;
  /** The connector's MCP tool to call to publish, e.g. "createPosts". */
  defaultTool: string;
  /** The connector tool's primary argument key the composed content maps to. */
  argEnv: string;
  defaultArg: string;
  description: string;
  /**
   * Optional structured input schema. Most channels take ONE final string (X's
   * `text`) and map it to `defaultArg`. Some connector tools need several fields
   * (Reddit's `create_post` needs subreddit + title + content), so those set a
   * schema here: the brain then passes an OBJECT, which `buildArgs` maps to the
   * connector tool's arguments. When set, the `argEnv`/`defaultArg` single-key
   * mapping does not apply.
   */
  inputSchema?: unknown;
  /**
   * Map the tool input to the MCP tool's arguments. Defaults (when unset) to the
   * single-key mapping `{ [arg]: input }`. A structured connector supplies this to
   * fan the object out across the tool's real argument keys.
   */
  buildArgs?: (input: string | Record<string, unknown>) => Record<string, unknown>;
}

const CONNECTORS: ConnectorSpec[] = [
  {
    as: "post_tweet",
    channel: "X (Twitter)",
    urlEnv: "OUTBOUND_X_MCP_URL",
    tokenEnv: "OUTBOUND_X_MCP_TOKEN",
    toolEnv: "OUTBOUND_X_MCP_TOOL",
    defaultTool: "createPosts", // vendored x-mcp's post operation (X "Posts" naming)
    argEnv: "OUTBOUND_X_MCP_ARG",
    defaultArg: "text",
    description:
      "Publish a post to X (Twitter). Input is the FINAL post text, exactly as it will appear. Only call this AFTER the user has confirmed this exact text — posting is public and cannot be undone. Returns the posted status (with its URL/id) on success.",
  },
  {
    as: "post_reddit",
    channel: "Reddit",
    urlEnv: "OUTBOUND_REDDIT_MCP_URL",
    tokenEnv: "OUTBOUND_REDDIT_MCP_TOKEN",
    toolEnv: "OUTBOUND_REDDIT_MCP_TOOL",
    defaultTool: "create_post",
    argEnv: "OUTBOUND_REDDIT_MCP_ARG",
    defaultArg: "content",
    // The vendored reddit-mcp's create_post needs discrete fields, not one blob,
    // so post_reddit takes a structured object (see services/reddit-mcp).
    inputSchema: z.object({
      subreddit: z
        .string()
        .describe("Target subreddit WITHOUT the r/ prefix (e.g. 'test'), exactly as the user approved."),
      title: z.string().describe("The post title, exactly as the user approved it."),
      content: z
        .string()
        .describe("The FINAL post body text for a self post, or the URL for a link post."),
      is_self: z
        .boolean()
        .optional()
        .describe("true for a text/self post (default), false for a link post."),
    }),
    buildArgs: (input) => {
      // Fallback: a bare string maps to the body only (subreddit/title unknown) so
      // a mis-shaped call fails loudly at Reddit rather than silently faking a send.
      if (typeof input === "string") return { content: input };
      const args: Record<string, unknown> = {};
      for (const key of ["subreddit", "title", "content", "is_self"] as const) {
        if (input[key] !== undefined) args[key] = input[key];
      }
      return args;
    },
    description:
      "Submit a post to Reddit via create_post. Pass an object with the target subreddit (no r/ prefix), the title, and the content (body text for a self post, or the URL for a link post; set is_self:false for a link). Only call this AFTER the user has confirmed the exact subreddit, title, and content — it is public and cannot be undone. Returns the submitted post's URL/id on success.",
  },
  {
    as: "send_email",
    channel: "email",
    urlEnv: "OUTBOUND_MAIL_MCP_URL",
    tokenEnv: "OUTBOUND_MAIL_MCP_TOKEN",
    toolEnv: "OUTBOUND_MAIL_MCP_TOOL",
    defaultTool: "send_email",
    argEnv: "OUTBOUND_MAIL_MCP_ARG",
    defaultArg: "request",
    description:
      "Send an email. Input is the FINAL message including recipient, subject, and body, exactly as the user approved them. Only call this AFTER the user has confirmed the exact recipient and content — a sent email cannot be recalled. Returns the send confirmation on success.",
  },
];

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
 * Call one connector's MCP tool once and return its text result. Each call opens
 * and closes its own short-lived connection (stateless, like the mesh client).
 * Errors come back as a readable string so a send failure is relayed gracefully
 * rather than throwing mid-turn.
 */
async function callConnector(
  url: string,
  token: string | undefined,
  mcpTool: string,
  args: Record<string, unknown>,
  channel: string,
): Promise<string> {
  const client = new Client({ name: "zenod-outbound-client", version: VERSION }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...(token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: mcpTool, arguments: args });
    const text = extractText(result);
    if ((result as { isError?: boolean })?.isError) {
      return `The ${channel} connector reported an error: ${text || "(no detail)"}`;
    }
    return text || `Sent to ${channel} (the connector returned no detail).`;
  } catch (err) {
    return `Could not reach the ${channel} connector: ${(err as Error).message}`;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Build Callistheness's send tools as PeerTools (the engine's generic
 * server-provided tool slot — the same vehicle the mesh uses). Each takes the
 * composed content as a single string and publishes it via its connector. A
 * connector with no configured URL returns a "not connected yet" message instead
 * of sending — never a throw, never a silent fake-send.
 */
export function buildOutboundTools(env: NodeJS.ProcessEnv = process.env): PeerTools {
  const tools: PeerTools = {};
  for (const c of CONNECTORS) {
    tools[c.as] = {
      description: c.description,
      ...(c.inputSchema ? { inputSchema: c.inputSchema } : {}),
      run: async (input: string | Record<string, unknown>) => {
        const url = env[c.urlEnv];
        if (!url) {
          return `${c.channel} is not connected yet — its connector is not configured (set ${c.urlEnv}). Tell the user it isn't set up and do NOT claim anything was sent.`;
        }
        const tool = env[c.toolEnv] || c.defaultTool;
        const arg = env[c.argEnv] || c.defaultArg;
        const token = env[c.tokenEnv];
        const args = c.buildArgs
          ? c.buildArgs(input)
          : { [arg]: typeof input === "string" ? input : String((input as Record<string, unknown>).input ?? "") };
        return callConnector(url, token, tool, args, c.channel);
      },
    };
  }
  return tools;
}
