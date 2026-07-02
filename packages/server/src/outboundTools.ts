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
   * (Reddit's `create_post` needs subreddit + title + content; X's post takes an
   * optional image alongside the text), so those set a schema here: the brain then
   * passes an OBJECT — see aisdk's peer-tool dispatch. When set, the
   * `argEnv`/`defaultArg` single-key mapping does not apply.
   */
  inputSchema?: unknown;
  /**
   * Map the tool input to the MCP tool's arguments. Defaults (when unset) to the
   * single-key mapping `{ [arg]: input }`. A structured connector supplies this to
   * fan the object out across the tool's real argument keys.
   */
  buildArgs?: (input: string | Record<string, unknown>) => Record<string, unknown>;
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
// NB: peer-tool inputSchema MUST be a zod schema — aisdk passes it straight into
// the AI SDK's tool(), which rejects plain JSON-schema literals ("schema is not a
// function" at brain boot). Same convention as the Reddit and X-read schemas.
const X_POST_INPUT_SCHEMA = z.object({
  text: z.string().min(1).describe("The FINAL post text, exactly as it will appear. Required."),
  image_url: z
    .string()
    .optional()
    .describe(
      "OPTIONAL https URL of a single image (jpeg/png/webp/gif) to attach. It is fetched and uploaded to X, then attached to the post. Use this OR image_base64, not both.",
    ),
  image_base64: z
    .string()
    .optional()
    .describe("OPTIONAL base64-encoded image bytes to attach (alternative to image_url, for callers that already hold the bytes)."),
  image_media_type: z
    .string()
    .optional()
    .describe("MIME type of the image (e.g. image/png, image/jpeg). Required only with image_base64; inferred from the response when using image_url."),
});

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
 * Callistheness's Reddit tools, backed by Composio (INTERIM connector, issue #420).
 *
 * Reddit's own developer-app creation is gated, so instead of the self-hosted
 * reddit-mcp (services/reddit-mcp, PR #426 — kept dormant for the long-term swap)
 * we reach Reddit through Composio's hosted toolkit: Composio holds the OAuth
 * connection to the user's Reddit account (COMPOSIO_USER_ID) and executes tools on
 * their behalf. This is PLUMBING behind the SAME clean surface — post_reddit stays
 * the guardian-gated write; the reads are ungated per the flat-tools doctrine, and
 * the word "Composio" never reaches the model. Each tool calls Composio's REST
 * execute endpoint (POST /api/v3/tools/execute/{slug}) and maps our fields onto the
 * Reddit toolkit slugs:
 *   post_reddit         → REDDIT_CREATE_REDDIT_POST   (kind self/link + text/url)
 *   search_reddit       → REDDIT_SEARCH_ACROSS_SUBREDDITS
 *   read_subreddit      → REDDIT_RETRIEVE_REDDIT_POST
 *   read_reddit_replies → REDDIT_RETRIEVE_POST_COMMENTS (comments on ONE thread)
 *
 * When COMPOSIO_API_KEY / COMPOSIO_USER_ID are unset these tools are NOT built, so
 * the MCP-based post_reddit (self-host path) stays in place and nothing fakes a send.
 * NB: Composio's Reddit toolkit has no unified inbox/notifications tool, so "replies
 * to me" means the comments on a specific thread (by post id), not a global sweep.
 */
const COMPOSIO_API_KEY_ENV = "COMPOSIO_API_KEY";
const COMPOSIO_USER_ID_ENV = "COMPOSIO_USER_ID";
const COMPOSIO_BASE_ENV = "COMPOSIO_BASE_URL";
const COMPOSIO_BASE_DEFAULT = "https://backend.composio.dev";
const REDDIT_CHANNEL = "Reddit";
const COMPOSIO_RESULT_CAP = 6000;

/**
 * Execute one Composio toolkit tool for the connected user and return its result
 * text. Errors (unreachable, HTTP error, or a `successful:false` payload) come back
 * as a readable string — never a throw, never a fabricated success.
 */
async function callComposio(
  apiKey: string,
  userId: string,
  baseUrl: string,
  slug: string,
  args: Record<string, unknown>,
  channel: string,
): Promise<string> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v3/tools/execute/${slug}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, arguments: args }),
    });
    const raw = await res.text();
    if (!res.ok) {
      return `The ${channel} connector reported an error (HTTP ${res.status}): ${raw.slice(0, 500) || "(no detail)"}`;
    }
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return raw.slice(0, COMPOSIO_RESULT_CAP);
    }
    if (parsed?.successful === false || parsed?.error) {
      const detail = parsed.error ?? parsed.data ?? parsed;
      return `The ${channel} connector did not complete: ${(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 500)}`;
    }
    const payload = parsed?.data ?? parsed;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return text.slice(0, COMPOSIO_RESULT_CAP) || `${channel} returned no content.`;
  } catch (err) {
    return `Could not reach the ${channel} connector: ${(err as Error).message}`;
  }
}

/**
 * Forgive a value pasted as a whole env line: strip an accidental `NAME=` prefix
 * and surrounding quotes/whitespace. A real Composio value (ak_…, a user id) never
 * starts with `COMPOSIO_API_KEY=`, so this only rescues the paste-the-whole-line
 * mistake and is a no-op on a clean value.
 */
export function normalizeComposioValue(value: string | undefined, envName: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .trim()
    .replace(new RegExp(`^${envName}\\s*=\\s*`, "i"), "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return cleaned || undefined;
}

function buildRedditComposioTools(env: NodeJS.ProcessEnv): PeerTools {
  const apiKey = normalizeComposioValue(env[COMPOSIO_API_KEY_ENV], COMPOSIO_API_KEY_ENV);
  const userId = normalizeComposioValue(env[COMPOSIO_USER_ID_ENV], COMPOSIO_USER_ID_ENV);
  const baseUrl = env[COMPOSIO_BASE_ENV] || COMPOSIO_BASE_DEFAULT;
  // Unconfigured → build nothing, leaving the MCP-based post_reddit (self-host) in
  // place. Never a fake send.
  if (!apiKey || !userId) return {};
  const call = (slug: string, args: Record<string, unknown>) => callComposio(apiKey, userId, baseUrl, slug, args, REDDIT_CHANNEL);
  const asObj = (input: unknown, key: string): Record<string, unknown> =>
    (typeof input === "string" ? { [key]: input } : (input ?? {})) as Record<string, unknown>;

  return {
    post_reddit: {
      description:
        "Submit a post to Reddit (as the connected account). Pass an object with the target subreddit (no r/ prefix), the title, and the content (body text for a self post, or a URL for a link post; set is_self:false for a link). Optionally flair_id if the subreddit requires flair. Only call this AFTER the user has confirmed the exact subreddit, title, and content — it is public and cannot be undone. Returns the submitted post's URL/id on success.",
      inputSchema: z.object({
        subreddit: z.string().describe("Target subreddit WITHOUT the r/ prefix (e.g. 'test'), exactly as the user approved."),
        title: z.string().describe("The post title (<=300 chars), exactly as the user approved it."),
        content: z.string().describe("The FINAL body text for a self post, or the URL for a link post."),
        is_self: z.boolean().optional().describe("true for a text/self post (default), false for a link post."),
        flair_id: z.string().optional().describe("Flair id, only if the subreddit requires one."),
      }),
      run: async (input) => {
        const o = asObj(input, "content");
        const subreddit = String(o.subreddit ?? "").trim().replace(/^\/?r\//i, "");
        const title = String(o.title ?? "").trim();
        const content = String(o.content ?? "");
        if (!subreddit || !title) return "Provide the target subreddit and the post title.";
        const isSelf = o.is_self !== false;
        // Composio's REDDIT_CREATE_REDDIT_POST marks flair_id REQUIRED even for
        // subreddits with no flair — omitting it fails validation ("missing:
        // {'flair_id'}"). Send "" when none is given; verified to post fine on r/test.
        const args: Record<string, unknown> = {
          subreddit,
          title,
          kind: isSelf ? "self" : "link",
          flair_id: o.flair_id ? String(o.flair_id) : "",
        };
        if (isSelf) args.text = content;
        else args.url = content;
        return call("REDDIT_CREATE_REDDIT_POST", args);
      },
    },
    search_reddit: {
      description: "Search RECENT Reddit content across subreddits and return the matches. Read-only — never posts. Input: { query, limit? }.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The search query."),
        limit: z.number().optional().describe("Max results (default 5)."),
      }),
      run: async (input) => {
        const o = asObj(input, "query");
        const query = String(o.query ?? "").trim();
        if (!query) return "Provide a search query.";
        const args: Record<string, unknown> = { search_query: query };
        if (o.limit !== undefined) args.limit = o.limit;
        return call("REDDIT_SEARCH_ACROSS_SUBREDDITS", args);
      },
    },
    read_subreddit: {
      description: "Read RECENT posts from a subreddit and return them. Read-only — never posts. Input: { subreddit, size? }.",
      inputSchema: z.object({
        subreddit: z.string().min(1).describe("Subreddit WITHOUT the r/ prefix (e.g. 'test')."),
        size: z.number().optional().describe("Max posts to return (default 5)."),
      }),
      run: async (input) => {
        const o = asObj(input, "subreddit");
        const subreddit = String(o.subreddit ?? "").trim().replace(/^\/?r\//i, "");
        if (!subreddit) return "Provide the subreddit to read.";
        const args: Record<string, unknown> = { subreddit };
        if (o.size !== undefined) args.size = o.size;
        return call("REDDIT_RETRIEVE_REDDIT_POST", args);
      },
    },
    read_reddit_replies: {
      description:
        "Read the comments/replies on ONE Reddit thread and return them — use this to see replies to a post (e.g. one of the user's own threads). Read-only — never posts. Input: { post_id } — the base-36 post id (the id in the permalink, e.g. 'q5u7q5').",
      inputSchema: z.object({
        post_id: z.string().min(1).describe("Base-36 Reddit post id, e.g. 'q5u7q5' (the id in the permalink, without a t3_ prefix)."),
      }),
      run: async (input) => {
        const o = asObj(input, "post_id");
        const article = String(o.post_id ?? o.article ?? "").trim().replace(/^t3_/, "");
        if (!article) return "Provide the base-36 post id of the thread to read replies for.";
        return call("REDDIT_RETRIEVE_POST_COMMENTS", { article });
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
        if (c.buildArgs) {
          return callConnector(url, token, tool, c.buildArgs(input), c.channel);
        }
        const value = typeof input === "string" ? input : (args[arg] ?? args.input ?? "");
        return callConnector(url, token, tool, { [arg]: value }, c.channel);
      },
    };
  }
  // Read-only X tools (fetch post, search, mentions, timeline) reaching x-mcp-readonly.
  // Reads are ungated — the brain calls them directly and relays real content.
  Object.assign(tools, buildXReadTools(env));
  // Reddit via Composio (interim, #420). When configured these OVERRIDE the MCP-based
  // post_reddit above and add the ungated Reddit reads; unset → self-host path stays.
  Object.assign(tools, buildRedditComposioTools(env));
  return tools;
}
