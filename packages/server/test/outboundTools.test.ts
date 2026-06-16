import { describe, expect, it } from "vitest";
import { buildOutboundTools } from "../src/outboundTools.js";

describe("buildOutboundTools", () => {
  it("exposes exactly the three send tools the brain wields", () => {
    const tools = buildOutboundTools({});
    expect(Object.keys(tools).sort()).toEqual(["post_reddit", "post_tweet", "send_email"]);
    for (const name of Object.keys(tools)) {
      expect(typeof tools[name].description).toBe("string");
      expect(typeof tools[name].run).toBe("function");
    }
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
});
