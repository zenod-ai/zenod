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
    description:
      "Submit a post to Reddit. Input is the FINAL post content (include the target subreddit and title as the user approved them). Only call this AFTER the user has confirmed the exact content and target subreddit — it is public and cannot be undone. Returns the submitted post's URL/id on success.",
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
  emptyMessage?: string,
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
    return text || (emptyMessage ?? `Sent to ${channel} (the connector returned no detail).`);
  } catch (err) {
    return `Could not reach the ${channel} connector: ${(err as Error).message}`;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Callistheness's READ-ONLY X tools, reaching the x-mcp-readonly connector on
 * `zenod-x-net` (OUTBOUND_X_READ_MCP_URL — e.g. http://x-mcp-readonly:8000/mcp).
 *
 * Reads are DIRECT/UNGATED per the flat-tools doctrine: fetching a post, searching
 * recent posts, or reading mentions/own-timeline is not outward-facing, so there is
 * no "confirm before send" gate here — the brain calls them freely and relays the
 * real content. Posting stays on the SEPARATE write endpoint (x-mcp-postread) so a
 * read connector can never publish. Each tool opens its own short-lived MCP client,
 * exactly like the send connectors. When the URL is unset the tools report "not
 * connected yet" and never fabricate posts/mentions.
 *
 * Tool → x-mcp operationId (X OpenAPI "Posts" naming): x_get_post→getPostsById,
 * x_search_posts→searchPostsRecent, x_read_mentions→getUsersMentions,
 * x_read_timeline→getUsersPosts, x_get_user→getUsersByUsername, x_whoami→getUsersMe.
 */
const X_READ_URL_ENV = "OUTBOUND_X_READ_MCP_URL";
const X_READ_TOKEN_ENV = "OUTBOUND_X_READ_MCP_TOKEN";
const X_READ_CHANNEL = "X read";

function buildXReadTools(env: NodeJS.ProcessEnv): PeerTools {
  const url = env[X_READ_URL_ENV];
  const token = env[X_READ_TOKEN_ENV];
  const notConnected =
    `X reads are not connected yet — set ${X_READ_URL_ENV} to the x-mcp-readonly endpoint (e.g. http://x-mcp-readonly:8000/mcp). ` +
    `Tell the user X read is not configured and do NOT fabricate any posts or mentions.`;
  const call = (mcpTool: string, args: Record<string, unknown>) =>
    callConnector(url!, token, mcpTool, args, X_READ_CHANNEL, `The ${X_READ_CHANNEL} connector returned no content.`);

  // Resolve the connected account's numeric id (getUsersMe) so "read my mentions /
  // my timeline" works in one call — those X operations key on the user id.
  const resolveMyUserId = async (): Promise<string | null> => {
    const text = await call("getUsersMe", {});
    return text.match(/"id"\s*:\s*"?(\d+)"?/)?.[1] ?? null;
  };

  return {
    x_get_post: {
      description:
        "Read ONE X (Twitter) post by its numeric id and return its real content. Read-only — never posts. Input: { id }.",
      inputSchema: z.object({ id: z.string().min(1).describe("The post's numeric id, e.g. 2072648470914093087") }),
      run: async (input) => {
        if (!url) return notConnected;
        const id = typeof input === "object" && input !== null ? String((input as { id?: unknown }).id ?? "") : String(input ?? "");
        if (!id.trim()) return "Provide the numeric post id to read.";
        return call("getPostsById", { id: id.trim() });
      },
    },
    x_search_posts: {
      description:
        "Search RECENT public X (Twitter) posts and return the matches. Read-only. Input: { query } — an X search query string.",
      inputSchema: z.object({ query: z.string().min(1).describe("X search query, e.g. 'from:someone keyword'") }),
      run: async (input) => {
        if (!url) return notConnected;
        const query = typeof input === "object" && input !== null ? String((input as { query?: unknown }).query ?? "") : String(input ?? "");
        if (!query.trim()) return "Provide a search query.";
        return call("searchPostsRecent", { query: query.trim() });
      },
    },
    x_read_mentions: {
      description:
        "Read the most RECENT posts that MENTION the connected X account and return their real content. Read-only. Input: optional { id } (numeric user id); defaults to the connected account.",
      inputSchema: z.object({
        id: z.string().optional().describe("User id to read mentions for; defaults to the connected account"),
      }),
      run: async (input) => {
        if (!url) return notConnected;
        const provided = typeof input === "object" && input !== null ? (input as { id?: unknown }).id : undefined;
        const id = provided ? String(provided) : await resolveMyUserId();
        if (!id) return "Could not resolve the connected X account id to read mentions (getUsersMe returned no id).";
        return call("getUsersMentions", { id });
      },
    },
    x_read_timeline: {
      description:
        "Read the RECENT posts on an X account's own timeline. Read-only. Input: optional { id } (numeric user id); defaults to the connected account.",
      inputSchema: z.object({
        id: z.string().optional().describe("User id whose timeline to read; defaults to the connected account"),
      }),
      run: async (input) => {
        if (!url) return notConnected;
        const provided = typeof input === "object" && input !== null ? (input as { id?: unknown }).id : undefined;
        const id = provided ? String(provided) : await resolveMyUserId();
        if (!id) return "Could not resolve the connected X account id to read the timeline (getUsersMe returned no id).";
        return call("getUsersPosts", { id });
      },
    },
    x_get_user: {
      description:
        "Look up an X (Twitter) user by @username and return their profile (id, name, etc.). Read-only. Input: { username }.",
      inputSchema: z.object({ username: z.string().min(1).describe("The @username without the leading @") }),
      run: async (input) => {
        if (!url) return notConnected;
        const raw = typeof input === "object" && input !== null ? String((input as { username?: unknown }).username ?? "") : String(input ?? "");
        const username = raw.trim().replace(/^@/, "");
        if (!username) return "Provide the @username to look up.";
        return call("getUsersByUsername", { username });
      },
    },
    x_whoami: {
      description:
        "Read the connected X (Twitter) account's own profile (id, username, name). Read-only. No input.",
      inputSchema: z.object({}),
      run: async () => {
        if (!url) return notConnected;
        return call("getUsersMe", {});
      },
    },
  };
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
      run: async (input: string) => {
        const url = env[c.urlEnv];
        if (!url) {
          return `${c.channel} is not connected yet — its connector is not configured (set ${c.urlEnv}). Tell the user it isn't set up and do NOT claim anything was sent.`;
        }
        const tool = env[c.toolEnv] || c.defaultTool;
        const arg = env[c.argEnv] || c.defaultArg;
        const token = env[c.tokenEnv];
        return callConnector(url, token, tool, { [arg]: input }, c.channel);
      },
    };
  }
  // Read-only X tools (fetch post, search, mentions, timeline) reaching x-mcp-readonly.
  // Reads are ungated — the brain calls them directly and relays real content.
  Object.assign(tools, buildXReadTools(env));
  return tools;
}
