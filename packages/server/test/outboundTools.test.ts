import { describe, expect, it, beforeEach } from "vitest";
import { buildOutboundTools, extractMediaId, normalizeComposioValue, idempotencyKey, __resetOutboundIdempotency } from "../src/outboundTools.js";

describe("buildOutboundTools", () => {
  it("exposes the send tools plus the read-only X tools the brain wields", () => {
    const tools = buildOutboundTools({});
    expect(Object.keys(tools).sort()).toEqual([
      "approve_send",
      "post_reddit",
      "post_tweet",
      "send_email",
      "x_get_post",
      "x_get_user",
      "x_read_mentions",
      "x_read_timeline",
      "x_search_posts",
      "x_whoami",
    ]);
    for (const name of Object.keys(tools)) {
      expect(typeof tools[name].description).toBe("string");
      expect(typeof tools[name].run).toBe("function");
    }
  });

  it("read tools carry a structured inputSchema so the brain passes typed args", () => {
    const tools = buildOutboundTools({ OUTBOUND_X_READ_MCP_URL: "http://x-mcp-readonly:8000/mcp" });
    for (const name of ["x_get_post", "x_search_posts", "x_read_mentions", "x_read_timeline", "x_get_user", "x_whoami"]) {
      expect(tools[name].inputSchema).toBeDefined();
    }
  });

  it("X read tools report 'not connected' (never fabricate) when the read URL is unset", async () => {
    const tools = buildOutboundTools({}); // no OUTBOUND_X_READ_MCP_URL
    const post = await tools.x_get_post.run({ id: "2072648470914093087" });
    expect(post.toLowerCase()).toContain("not connected");
    expect(post.toLowerCase()).toContain("do not fabricate");

    const mentions = await tools.x_read_mentions.run({});
    expect(mentions.toLowerCase()).toContain("not connected");
  });

  it("X read tools validate required input before reaching the connector", async () => {
    const tools = buildOutboundTools({ OUTBOUND_X_READ_MCP_URL: "http://x-mcp-readonly:8000/mcp" });
    expect((await tools.x_get_post.run({ id: "" })).toLowerCase()).toContain("provide the numeric post id");
    expect((await tools.x_search_posts.run({ query: "  " })).toLowerCase()).toContain("provide a search query");
    expect((await tools.x_get_user.run({ username: "" })).toLowerCase()).toContain("provide the @username");
  });

  it("X reads reach the configured read connector and fail gracefully (no throw, no fake content)", async () => {
    const tools = buildOutboundTools({ OUTBOUND_X_READ_MCP_URL: "http://127.0.0.1:0/mcp" });
    const post = await tools.x_get_post.run({ id: "2072648470914093087" });
    expect(post.toLowerCase()).toContain("could not reach the x read connector");
  });

  it("reports 'not connected' (never a fake send) when a connector URL is unset", async () => {
    const tools = buildOutboundTools({}); // no OUTBOUND_*_MCP_URL configured
    const tweet = await tools.post_tweet.run("hello world");
    expect(tweet.toLowerCase()).toContain("not connected");
    // It must explicitly warn against claiming a send happened.
    expect(tweet.toLowerCase()).toContain("not claim anything was sent");

    const email = await tools.send_email.run("to: a@b.com\nhi");
    expect(email.toLowerCase()).toContain("not connected");
  });

  it("each connector reads its own URL env var independently", async () => {
    // Only Reddit configured (to a dead URL) — X/email still report not-connected,
    // and the configured one attempts a real connection (which fails gracefully).
    const tools = buildOutboundTools({ OUTBOUND_REDDIT_MCP_URL: "http://127.0.0.1:0/mcp" });
    const tweet = await tools.post_tweet.run("x");
    expect(tweet.toLowerCase()).toContain("not connected");

    const reddit = await tools.post_reddit.run("r/test post");
    // Configured → it tried to reach the connector and failed (no fake success).
    expect(reddit.toLowerCase()).toContain("could not reach the reddit connector");
  });

  it("post_reddit advertises a structured schema (create_post needs subreddit + title + content)", () => {
    const tools = buildOutboundTools({});
    // Reddit and X are structured; email takes a single final string (no schema).
    expect(tools.post_reddit.inputSchema).toBeDefined();
    expect(tools.send_email.inputSchema).toBeUndefined();
    // Its schema names the discrete fields the connector's create_post requires.
    const shape = (tools.post_reddit.inputSchema as { shape?: Record<string, unknown> })?.shape;
    expect(shape && Object.keys(shape).sort()).toEqual(["content", "is_self", "subreddit", "title"]);
  });

  it("post_reddit forwards its object fields (still no fake send on failure)", async () => {
    const tools = buildOutboundTools({ OUTBOUND_REDDIT_MCP_URL: "http://127.0.0.1:0/mcp" });
    const reddit = await tools.post_reddit.run({
      subreddit: "test",
      title: "Hello",
      content: "body text",
      is_self: true,
    });
    // A structured call still reaches the connector (and fails gracefully here).
    expect(reddit.toLowerCase()).toContain("could not reach the reddit connector");
  });

  it("post_tweet advertises a structured zod inputSchema (text + optional image)", () => {
    const tools = buildOutboundTools({});
    // Must be a zod schema — aisdk hands it straight to the AI SDK's tool().
    const shape = (tools.post_tweet.inputSchema as { shape?: Record<string, unknown> })?.shape;
    expect(shape && Object.keys(shape).sort()).toEqual(["image_base64", "image_media_type", "image_url", "text"]);
  });

  it("post_tweet accepts structured object args and still gates on connection", async () => {
    const tools = buildOutboundTools({}); // X not connected
    const res = await tools.post_tweet.run({ text: "hi", image_url: "https://example.com/a.png" });
    expect(res.toLowerCase()).toContain("not connected");
  });
});

describe("approve_send (I4-R1) — approve verb resolves to receipt OR honest affordance, no third", () => {
  beforeEach(() => __resetOutboundIdempotency());

  it("advertises a structured schema and is present on the outbound surface", () => {
    const tools = buildOutboundTools({});
    expect(tools.approve_send).toBeDefined();
    const shape = (tools.approve_send.inputSchema as { shape?: Record<string, unknown> })?.shape;
    expect(shape && "channel" in shape).toBe(true);
  });

  it("no committed draft → honest affordance ('post now'), never a fabricated 'posted'", async () => {
    const tools = buildOutboundTools({}); // even unconnected, an empty approve never fakes a send
    const res = await tools.approve_send.run({ channel: "x" });
    expect(res.toLowerCase()).toContain("no committed draft");
    expect(res.toLowerCase()).toContain("post now");
    expect(res.toLowerCase()).toContain("do not claim");
    // It is NOT a success line and carries no fabricated URL.
    expect(res.toLowerCase()).not.toContain("posted to x");
    expect(res).not.toContain("x.com/");
  });

  it("reddit approve missing title/subreddit → affordance, not a partial fake send", async () => {
    const tools = buildOutboundTools({});
    const res = await tools.approve_send.run({ channel: "reddit", content: "just a body" });
    expect(res.toLowerCase()).toContain("no committed draft");
    expect(res.toLowerCase()).toContain("post now");
  });

  // I5-1: no channel resolved means no standing draft was identified at all — the
  // distinct "nothing pending" honest block, not the channel-scoped affordance.
  it("unknown/absent channel → 'Nothing pending to approve.', never a silent no-op", async () => {
    const tools = buildOutboundTools({});
    const res = await tools.approve_send.run({ text: "hi there" });
    expect(res).toBe("Nothing pending to approve.");
  });

  it("truly bare approve (no fields at all) → 'Nothing pending to approve.'", async () => {
    const tools = buildOutboundTools({});
    const res = await tools.approve_send.run({});
    expect(res).toBe("Nothing pending to approve.");
  });

  it("committed X draft routes to the SAME verified-receipt send path (never the affordance, never a fake success)", async () => {
    // Dead X connector: a committed approve must REACH the connector and reduce to a
    // FAILED receipt — proving it went through the E-1 send path, not the affordance and
    // not a fabricated 'Posted:' line.
    const tools = buildOutboundTools({ OUTBOUND_X_MCP_URL: "http://127.0.0.1:0/mcp" });
    const res = await tools.approve_send.run({ channel: "x", text: "Ship it: the release is live." });
    expect(res.toLowerCase()).not.toContain("no committed draft");
    expect(res).toMatch(/^FAILED to send to X/);
    expect(res).not.toContain("x.com/"); // no fabricated live URL
  });

  it("committed reddit draft routes to the send path (reaches the connector, no fake send)", async () => {
    const tools = buildOutboundTools({ OUTBOUND_REDDIT_MCP_URL: "http://127.0.0.1:0/mcp" });
    const res = await tools.approve_send.run({ channel: "reddit", subreddit: "test", title: "Hi", content: "body" });
    expect(res.toLowerCase()).not.toContain("no committed draft");
    expect(res).toMatch(/^FAILED to send to Reddit/);
  });

  it("committed approve to an UNCONNECTED channel reports not-connected, never a fake send", async () => {
    const tools = buildOutboundTools({}); // X not connected
    const res = await tools.approve_send.run({ channel: "x", text: "hello world" });
    expect(res.toLowerCase()).toContain("not connected");
    expect(res.toLowerCase()).toContain("not claim anything was sent");
  });
});

describe("idempotency (E1-T4)", () => {
  beforeEach(() => __resetOutboundIdempotency());

  it("keys the same content to the same key regardless of object key order", () => {
    expect(idempotencyKey("reddit", { a: 1, b: 2 })).toBe(idempotencyKey("reddit", { b: 2, a: 1 }));
    expect(idempotencyKey("x", "hello")).not.toBe(idempotencyKey("reddit", "hello"));
  });
});

describe("extractMediaId", () => {
  it("reads data.id from a media-upload JSON result", () => {
    expect(extractMediaId(JSON.stringify({ data: { id: "1146654567674912769" } }))).toBe("1146654567674912769");
  });
  it("reads a top-level media_id and numeric ids", () => {
    expect(extractMediaId(JSON.stringify({ media_id: 12345 }))).toBe("12345");
  });
  it("falls back to a loose scan when the text isn't clean JSON", () => {
    expect(extractMediaId('uploaded ok "media_id": "998877665544332211" done')).toBe("998877665544332211");
  });
  it("returns undefined when there is no id", () => {
    expect(extractMediaId("total failure, no id here")).toBeUndefined();
  });
});

describe("Reddit via Composio", () => {
  const composioEnv = { COMPOSIO_API_KEY: "ak_test", COMPOSIO_USER_ID: "jordimr", COMPOSIO_BASE_URL: "http://127.0.0.1:0" };

  it("adds the Reddit read tools and overrides post_reddit when Composio is configured", () => {
    const tools = buildOutboundTools(composioEnv);
    for (const name of ["post_reddit", "search_reddit", "read_subreddit", "read_reddit_replies"]) {
      expect(tools[name]).toBeDefined();
      expect(tools[name].inputSchema).toBeDefined();
    }
    // post_reddit is the Composio object schema (has flair_id), not the MCP one.
    const shape = (tools.post_reddit.inputSchema as { shape?: Record<string, unknown> })?.shape;
    expect(shape && Object.keys(shape).sort()).toEqual(["content", "flair_id", "is_self", "subreddit", "title"]);
  });

  it("leaves the MCP-based post_reddit in place (no read tools) when Composio is unset", () => {
    const tools = buildOutboundTools({});
    expect(tools.search_reddit).toBeUndefined();
    const shape = (tools.post_reddit.inputSchema as { shape?: Record<string, unknown> })?.shape;
    expect(shape && Object.keys(shape).sort()).toEqual(["content", "is_self", "subreddit", "title"]);
  });

  it("validates required input before reaching Composio", async () => {
    const tools = buildOutboundTools(composioEnv);
    expect((await tools.post_reddit.run({ title: "hi" })).toLowerCase()).toContain("target subreddit");
    expect((await tools.search_reddit.run({ query: "" })).toLowerCase()).toContain("search query");
    expect((await tools.read_subreddit.run({ subreddit: "" })).toLowerCase()).toContain("subreddit");
    expect((await tools.read_reddit_replies.run({ post_id: "" })).toLowerCase()).toContain("post id");
  });

  it("reaches the connector and fails gracefully (no throw, no fake send)", async () => {
    const tools = buildOutboundTools(composioEnv);
    const res = await tools.post_reddit.run({ subreddit: "r/test", title: "Hello", content: "body" });
    expect(res.toLowerCase()).toContain("could not reach the reddit connector");
  });

  it("forgives a value pasted as a whole env line (NAME=value + quotes)", () => {
    // The bug that produced 'Invalid API key: COM**SHOR' — the whole line was pasted.
    expect(normalizeComposioValue("COMPOSIO_API_KEY=ak_FxycLInZWgeIqix-SHOR", "COMPOSIO_API_KEY")).toBe("ak_FxycLInZWgeIqix-SHOR");
    expect(normalizeComposioValue('  "ak_clean"  ', "COMPOSIO_API_KEY")).toBe("ak_clean");
    expect(normalizeComposioValue("ak_clean", "COMPOSIO_API_KEY")).toBe("ak_clean");
    expect(normalizeComposioValue("COMPOSIO_USER_ID=jordimr", "COMPOSIO_USER_ID")).toBe("jordimr");
    expect(normalizeComposioValue("", "COMPOSIO_API_KEY")).toBeUndefined();
  });

  it("normalizes a prefixed key before building the tools (still gated on reachability)", async () => {
    const tools = buildOutboundTools({
      COMPOSIO_API_KEY: "COMPOSIO_API_KEY=ak_test",
      COMPOSIO_USER_ID: "jordimr",
      COMPOSIO_BASE_URL: "http://127.0.0.1:0",
    });
    // Tools still build (prefix stripped, not treated as unconfigured) and reach out.
    expect(tools.post_reddit).toBeDefined();
    const res = await tools.post_reddit.run({ subreddit: "test", title: "Hi", content: "b" });
    expect(res.toLowerCase()).toContain("could not reach the reddit connector");
  });
});
