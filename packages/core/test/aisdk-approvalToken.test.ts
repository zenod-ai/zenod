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

  it("P-1: a draft composed via ask_outbound, then approved via a direct post_tweet call, posts exactly once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: unknown[] = [];
    const cid = "conv-outbound-compose";
    const peer = {
      ask_outbound: {
        description: "Ask Callistheness to draft outbound comms.",
        run: async () => 'Here\'s the tweet: "Hello world" — reply "approve" to post it.',
      },
      ...postTweetPeer(calls),
    };
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });

    // Turn 1: the model asks Callistheness to draft — never gated, never blocked, but
    // it registers a standing compose-approval since Console has no exact final text.
    await llm.answer(
      { question: "draft a tweet about the launch", conversationId: cid, vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      peer,
    );
    await captured.config.tools.ask_outbound.execute({ input: "draft a tweet about the launch" });

    // Turn 2: "Tweet approved" — the model calls post_tweet DIRECTLY (not ask_outbound
    // again). No token was ever registered for post_tweet specifically, but the
    // outbound-compose token resolves it.
    await llm.answer({ question: "Tweet approved", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    const posted = await captured.config.tools.post_tweet.execute({ text: "Hello world" });

    expect(posted).toBe("Posted to X. Live URL: https://x.com/i/web/status/42");
    expect(calls).toHaveLength(1);
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

describe("generic discovered MCP standing actions", () => {
  beforeEach(() => __resetApprovalTokens());

  it("routes an ordinary draft request, then validates a conversational approval against the exact peer and args", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const peer = {
      calli__createposts__hash: {
        owner: "calli",
        description: "Create a held draft post for review.",
        annotations: { readOnlyHint: false },
        inputSchema: z.object({ text: z.string() }),
        run: async (args: unknown) => {
          calls.push({ tool: "create", args });
          return "[draft_not_approved] held; nothing was published";
        },
      },
      calli__approve_send__hash: {
        owner: "calli",
        description: "Approve and send the exact standing draft.",
        annotations: { readOnlyHint: false, idempotentHint: true },
        inputSchema: z.object({ channel: z.literal("x"), text: z.string() }),
        run: async (args: unknown) => {
          calls.push({ tool: "approve", args });
          return "https://x.com/i/web/status/42";
        },
      },
    };
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const cid = "tenant-a:web:generic";

    await llm.answer({ question: "Post this now: Hello world", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    expect(await captured.config.tools.calli__approve_send__hash.execute({ channel: "x", text: "Hello world" })).toBe("Nothing pending to approve.");
    expect(calls).toHaveLength(0);

    await llm.answer({ question: "Draft this for X and stop before publishing: Hello world", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    expect(await captured.config.tools.calli__createposts__hash.execute({ text: "Hello world" })).toContain("draft_not_approved");

    await llm.answer({ question: "Looks good — send that exact draft now", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    expect(await captured.config.tools.calli__approve_send__hash.execute({ channel: "x", text: "Hello world" })).toBe("https://x.com/i/web/status/42");
    expect(calls.map((call) => call.tool)).toEqual(["create", "approve"]);

    await llm.answer({ question: "yes", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    expect(await captured.config.tools.calli__approve_send__hash.execute({ channel: "x", text: "Hello world" })).toBe("Nothing pending to approve.");
    expect(calls).toHaveLength(2);
  });

  it("supports same-tool boolean confirmation and keeps the approval field host-controlled", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const peer = {
      fixture__save__hash: {
        owner: "fixture",
        description: "Save the exact document after confirmation.",
        annotations: { readOnlyHint: false },
        schemaFormat: "json-schema" as const,
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "The exact text the user confirmed." },
            confirmed: { type: "boolean", description: "Explicit confirmation for this mutation." },
          },
          required: ["text"],
        },
        run: async (args: Record<string, unknown>) => {
          calls.push({ ...args });
          return args.confirmed === true ? "saved id=doc-1" : "[confirmation_required] held";
        },
      },
    };
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const cid = "tenant-a:web:same-tool";
    await llm.answer({ question: "Please save this document for me", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    expect(await captured.config.tools.fixture__save__hash.execute({ text: "exact", confirmed: true })).toContain("confirmation_required");
    expect(calls[0]).toEqual({ text: "exact" });

    await llm.answer({ question: "yes, go ahead", conversationId: cid, vaultBriefing: "brief", conversation: [] }, readTools, undefined, undefined, peer);
    expect(await captured.config.tools.fixture__save__hash.execute({ text: "exact", confirmed: false })).toBe("saved id=doc-1");
    expect(calls[1]).toEqual({ text: "exact", confirmed: true });
  });
});
