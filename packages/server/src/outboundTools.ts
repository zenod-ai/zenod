import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
   * When set, the brain calls this tool with STRUCTURED args (an object) matching
   * this JSON Schema instead of a single content string — see aisdk's peer-tool
   * dispatch. Used by X to accept an optional image alongside the post text.
   */
  inputSchema?: unknown;
  /** True for the X lane: supports uploading one image and attaching its media id. */
  media?: boolean;
}

/**
 * Structured input for the X post lane. `text` is the FINAL post text; an OPTIONAL
 * image may be supplied as an https URL (fetched server-side) or as base64 bytes.
 * We pick URL as the primary Console-facing surface (a chat caller has a link far
 * more often than raw base64); base64 is the fallback for callers that already hold
 * the bytes. Either path ends the same way: upload → media id → attach via
 * media.media_ids → post.
 */
const X_POST_INPUT_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "The FINAL post text, exactly as it will appear. Required.",
    },
    image_url: {
      type: "string",
      description:
        "OPTIONAL https URL of a single image (jpeg/png/webp/gif) to attach. It is fetched and uploaded to X, then attached to the post. Use this OR image_base64, not both.",
    },
    image_base64: {
      type: "string",
      description:
        "OPTIONAL base64-encoded image bytes to attach (alternative to image_url, for callers that already hold the bytes).",
    },
    image_media_type: {
      type: "string",
      description:
        "MIME type of the image (e.g. image/png, image/jpeg). Required only with image_base64; inferred from the response when using image_url.",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

// x-mcp's one-shot media upload operation (X API v2 `POST /2/media/upload`,
// operationId `mediaUpload`) and the createPosts media-attach shape. These are
// env-overridable so an operator can retarget without a rebuild, exactly like the
// post tool/arg. The spec x-mcp loads is fetched LIVE from api.x.com at startup, so
// these ids do not depend on XMCP_REF — see docker-compose.x-mcp.yml.
const X_MEDIA_UPLOAD_TOOL_ENV = "OUTBOUND_X_MCP_MEDIA_TOOL";
const X_MEDIA_UPLOAD_TOOL_DEFAULT = "mediaUpload";
const X_MEDIA_CATEGORY = "tweet_image";

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
    inputSchema: X_POST_INPUT_SCHEMA,
    media: true,
    description:
      "Publish a post to X (Twitter). Pass { text } — the FINAL post text, exactly as it will appear — and OPTIONALLY an image to attach via image_url (an https link) or image_base64 (+ image_media_type). When an image is given it is uploaded to X and attached to the post. Only call this AFTER the user has confirmed this exact text (and image) — posting is public and cannot be undone. Returns the posted status (with its URL/id) on success.",
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

/** Pull the uploaded media id out of x-mcp's media-upload result text. */
export function extractMediaId(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = (parsed?.data ?? parsed) as Record<string, unknown>;
    const id = data?.id ?? data?.media_id ?? (parsed as Record<string, unknown>)?.media_id;
    if (typeof id === "string" && id) return id;
    if (typeof id === "number") return String(id);
  } catch {
    // Not JSON — fall through to a loose scan for a media id-shaped token.
  }
  const m = text.match(/"(?:media_id|id)"\s*:\s*"?(\d{1,25})"?/);
  return m?.[1];
}

/**
 * Fetch an image URL and return its base64 bytes + MIME type, so the caller can
 * hand a link to the X lane and we do the upload. Returns a readable error string
 * instead of throwing, matching the connector's never-throw contract.
 */
async function fetchImageAsBase64(
  url: string,
): Promise<{ base64: string; mediaType: string } | { error: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `fetching the image failed (HTTP ${res.status}).` };
    const mediaType = ((res.headers.get("content-type") || "image/jpeg").split(";")[0] || "image/jpeg").trim();
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) return { error: "the image URL returned no bytes." };
    return { base64: bytes.toString("base64"), mediaType };
  } catch (err) {
    return { error: `the image URL could not be fetched: ${(err as Error).message}` };
  }
}

/**
 * The X post lane with optional image attach. Upload the image (if any) to get a
 * media id, then post the text with `media.media_ids` set. On any upload failure we
 * return a clear error WITHOUT posting — a half-done "posted without the image the
 * user asked for" is worse than a clean failure the brain can relay.
 */
async function publishToX(
  url: string,
  token: string | undefined,
  postTool: string,
  textArg: string,
  mediaTool: string,
  args: Record<string, unknown>,
  channel: string,
): Promise<string> {
  const text = typeof args.text === "string" ? args.text : String(args.input ?? "");
  if (!text.trim()) return `Nothing to post to ${channel}: the post text was empty.`;

  let mediaId: string | undefined;
  let base64 = typeof args.image_base64 === "string" ? args.image_base64 : undefined;
  let mediaType = typeof args.image_media_type === "string" ? args.image_media_type : undefined;

  if (!base64 && typeof args.image_url === "string" && args.image_url.trim()) {
    const fetched = await fetchImageAsBase64(args.image_url.trim());
    if ("error" in fetched) return `Could not attach the image to the ${channel} post: ${fetched.error}`;
    base64 = fetched.base64;
    mediaType = mediaType || fetched.mediaType;
  }

  if (base64) {
    const uploaded = await callConnector(
      url,
      token,
      mediaTool,
      { media: base64, media_category: X_MEDIA_CATEGORY, ...(mediaType ? { media_type: mediaType } : {}) },
      `${channel} media upload`,
    );
    mediaId = extractMediaId(uploaded);
    if (!mediaId) {
      return `Could not attach the image to the ${channel} post — the media upload did not return a media id: ${uploaded}`;
    }
  }

  const postArgs: Record<string, unknown> = { [textArg]: text };
  if (mediaId) postArgs.media = { media_ids: [mediaId] };
  return callConnector(url, token, postTool, postArgs, channel);
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
        // Structured args arrive as an object (brain, inputSchema path); a plain
        // string arrives from legacy/string callers. Normalize so both work.
        const args: Record<string, unknown> =
          typeof input === "string" ? { [arg]: input, text: input } : input;
        if (c.media) {
          const mediaTool = env[X_MEDIA_UPLOAD_TOOL_ENV] || X_MEDIA_UPLOAD_TOOL_DEFAULT;
          return publishToX(url, token, tool, arg, mediaTool, args, c.channel);
        }
        const value = typeof input === "string" ? input : (args[arg] ?? args.input ?? "");
        return callConnector(url, token, tool, { [arg]: value }, c.channel);
      },
    };
  }
  return tools;
}
