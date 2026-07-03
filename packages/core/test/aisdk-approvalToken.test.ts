import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Same harness as aisdk-budget.test.ts: capture the config handed to generateText so
// the peer-tool execute() closures (and prepareStep) can be exercised directly, exactly
// like a model retrying a blocked tool call mid-turn.
const captured: { config?: any } = {};
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateText: (config: any) => {
      captured.config = config;
      return Promise.resolve({ text: "answer", totalUsage: {}, providerMetadata: {} });
    },
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";
import { __resetApprovalTokens } from "../src/approvalTokens.js";

const readTools = {
  searchVault: async () => "no hits",
  readNote: async () => "note",
  listPages: async () => "pages",
};

function postTweetPeer(calls: unknown[], result = "Posted to X. Live URL: https://x.com/i/web/status/42") {
  return {
    post_tweet: {
      description: "Publish a post to X.",
      inputSchema: z.object({ text: z.string() }),
      run: async (input: unknown) => {
        calls.push(input);
        return result;
      },
    },
  };
}

describe("M-1 — stateful approval token, friendly block template, retry-stop", () => {
  beforeEach(() => __resetApprovalTokens());

  it("blocks a bare non-explicit send with a friendly draft-approval prompt, never the raw ERROR string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const actions: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer(
      {
        question: "Here's the tweet I drafted for you: Hello world",
        conversationId: "conv-friendly-block",
        vaultBriefing: "brief",
        conversation: [],
        onPeerAction: (tool, input, result) => actions.push({ tool, input, result }),
      },
      readTools,
      undefined,
      undefined,
      postTweetPeer(calls),
    );

    const result = await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    expect(result).toBe('Draft\'s ready — reply "send" or "approve" to post it.');
    expect(result).not.toContain("ERROR");
    expect(result).not.toContain("Blocked");
    expect(calls).toHaveLength(0);
    expect(actions).toEqual([expect.objectContaining({ tool: "post_tweet", result })]);
    // Raw detail still reaches the operator log.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Blocked post_tweet"));
    warn.mockRestore();
  });

  it("retry-stop: a second attempt at a blocked send this turn is short-circuited, not re-recorded, and ends the turn", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const actions: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer(
      {
        question: "Here's the tweet I drafted for you: Hello world",
        conversationId: "conv-retry-stop",
        vaultBriefing: "brief",
        conversation: [],
        onPeerAction: (tool, input, result) => actions.push({ tool, input, result }),
      },
      readTools,
      undefined,
      undefined,
      postTweetPeer(calls),
    );

    const first = await captured.config.tools.post_tweet.execute({ text: "Hello world" });
    const second = await captured.config.tools.post_tweet.execute({ text: "Hello world" });
    const third = await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(actions).toHaveLength(1); // never a tripled bubble
    expect(calls).toHaveLength(0);
    // The next step is forced text-only — the model cannot spend another round retrying.
    expect(captured.config.prepareStep({ stepNumber: 0 })).toEqual({ toolChoice: "none" });
  });

  it("a natural-language affirmative resolves the SAME standing draft via its token — exactly one real post", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const cid = "conv-approve-flow";
    const peer = postTweetPeer(calls);
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });

    // Turn 1: the model tries to post without an explicit verb in the user's message —
    // blocked; the block doubles as the draft-approval prompt and registers a token.
    await llm.answer(
      { question: "Here's the tweet I drafted for you: Hello world", conversationId: cid, vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      peer,
    );
    const blocked = await captured.config.tools.post_tweet.execute({ text: "Hello world" });
    expect(blocked).toContain("Draft's ready");

    // Turn 2: "Tweet approved" — same content, resolves the token, real send happens once.
    await llm.answer({ question: "Tweet approved", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    const posted = await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    expect(posted).toBe("Posted to X. Live URL: https://x.com/i/web/status/42");
    expect(calls).toHaveLength(1);
  });

  it('a bare affirmative with no standing draft renders "Nothing pending to approve." — never a fabricated post', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer(
      { question: "approved", conversationId: "conv-nothing-pending", vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      postTweetPeer(calls),
    );

    const result = await captured.config.tools.post_tweet.execute({});

    expect(result).toBe("Nothing pending to approve.");
    expect(calls).toHaveLength(0);
  });

  it("an affirmative for a DIFFERENT draft than the standing token still renders the honest zero-state", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const cid = "conv-mismatched-draft";
    const peer = postTweetPeer(calls);
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });

    await llm.answer(
      { question: "Here's the tweet I drafted for you: Hello world", conversationId: cid, vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      peer,
    );
    await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    await llm.answer({ question: "approved", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    const result = await captured.config.tools.post_tweet.execute({ text: "A completely different tweet" });

    expect(result).toBe("Nothing pending to approve.");
    expect(calls).toHaveLength(0);
  });

  it('a negated reply ("don\'t send it") never consumes a valid token', async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const cid = "conv-negation";
    const peer = postTweetPeer(calls);
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });

    await llm.answer(
      { question: "Here's the tweet I drafted for you: Hello world", conversationId: cid, vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      peer,
    );
    await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    await llm.answer({ question: "don't send it", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    const result = await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    // Never treated as an approval — the draft stays pending, nothing is posted.
    expect(result).not.toBe("Posted to X. Live URL: https://x.com/i/web/status/42");
    expect(calls).toHaveLength(0);
  });

  it("an explicit write verb still posts directly with no token needed (unchanged baseline behavior)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer(
      { question: "Post this tweet: Hello world", conversationId: "conv-explicit-verb", vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      postTweetPeer(calls),
    );

    const result = await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    expect(result).toBe("Posted to X. Live URL: https://x.com/i/web/status/42");
    expect(calls).toHaveLength(1);
  });
});
