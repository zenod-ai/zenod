import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { AnswerInput, AnswerResult, BrainLlm, PeerTools, VaultReadTools, VaultTaskTools } from "../src/llm/types.js";

/**
 * Iteration-6 — the reply gate must intercept at the ACTUAL chat() runtime boundary, not
 * just as a standalone pure function. This stub LLM plays the part of a model that calls
 * a side-effect peer tool mid-turn (exactly like the real aisdk loop invoking
 * input.onPeerAction) and then still tries to compose its own optimistic/fabricated
 * closing sentence — the precise failure mode iteration-5 could not close (a static
 * source scan cannot stop this; only refusing to deliver anything but the receipt can).
 */
class ScriptedLlm {
  constructor(
    private readonly peerCall: { tool: string; input: Record<string, unknown>; result: string } | null,
    private readonly draftedText: string,
  ) {}

  async answer(input: AnswerInput, _tools: VaultReadTools, _taskTools?: VaultTaskTools, _driveTools?: unknown, _peerTools?: PeerTools): Promise<AnswerResult> {
    if (this.peerCall) {
      input.onPeerAction?.(this.peerCall.tool, this.peerCall.input, this.peerCall.result, {
        peerAction: _peerTools?.[this.peerCall.tool]?.connectedMcp,
        verifiedMutationReceipt: _peerTools?.[this.peerCall.tool]?.verifiedMutationReceipt,
      });
    }
    return { text: this.draftedText, readPaths: [] };
  }
}

function vaultlessEngine(llm: BrainLlm) {
  return createEngine({ llm, state: new SqliteStateStore(":memory:") });
}

describe("engine.chat — the reply gate at the real runtime boundary (iteration-6)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("R1 replay: approve_send resolves to 'Nothing pending to approve.' — the model's 'Posting now' text never reaches the user", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = new ScriptedLlm({ tool: "approve_send", input: {}, result: "Nothing pending to approve." }, "Approved. Posting now!");
    const engine = vaultlessEngine(llm as unknown as BrainLlm);

    const reply = await engine.chat("approve", "web");

    expect(reply.text).toContain("Nothing was changed: approve_send returned no verified same-turn mutation receipt.");
    expect(reply.text).not.toMatch(/posting/i);
    // Runtime assertion + telemetry: the interception is observable, not silent.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0]?.[0] as string;
    expect(logged).toContain("[reply-gate] intercepted");
    expect(logged).toContain("approve_send");
    expect(logged).toContain("Approved. Posting now!");
  });

  it("R2 replay: a FAILED send receipt cannot be overridden by a fabricated 'Posted' claim, even with no other tool evidence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = new ScriptedLlm(
      { tool: "post_tweet", input: { text: "hello world" }, result: "FAILED to send to X (Twitter): the connector returned no detail. Do NOT tell the user it was sent." },
      "Posted: https://x.com/i/web/status/000000000",
    );
    const engine = vaultlessEngine(llm as unknown as BrainLlm);

    const reply = await engine.chat("send it", "web");

    expect(reply.text).toMatch(/^Nothing was changed/);
    expect(reply.text).not.toContain("000000000");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a genuine verified success is delivered exactly as the receipt renderer produced it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = new ScriptedLlm(
      { tool: "post_tweet", input: { text: "hello world" }, result: "Posted to X. Live URL: https://x.com/i/web/status/42" },
      "Done! I posted your tweet.",
    );
    const engine = vaultlessEngine(llm as unknown as BrainLlm);

    const reply = await engine.chat("send it", "web");

    expect(reply.text).toBe("Verified mutation receipt from post_tweet.\n- url: https://x.com/i/web/status/42");
    // Still logged: the model tried to narrate its own line instead of relaying verbatim.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a non-action turn (no side-effect tool ran) is left untouched — the gate never fires", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = new ScriptedLlm(null, "Sure — here's a draft for you to review.");
    const engine = vaultlessEngine(llm as unknown as BrainLlm);

    const reply = await engine.chat("draft me a tweet", "web");

    expect(reply.text).toBe("Sure — here's a draft for you to review.");
    expect(warn).not.toHaveBeenCalled();
  });

  it("relays a wallet peer mutation receipt verbatim through the real chat boundary", async () => {
    const receipt = `Stored.\ncommit: ${"c".repeat(40)}\nhttps://github.com/AlfaBlok/obsidian-brain/commit/${"c".repeat(40)}`;
    const llm = new ScriptedLlm(
      { tool: "generic_memory_write", input: { content: "the ring is alive" }, result: receipt },
      "I remembered it.",
    );
    const engine = createEngine({
      llm: llm as unknown as BrainLlm,
      state: new SqliteStateStore(":memory:"),
      peerTools: {
        generic_memory_write: {
          description: "Store memory",
          connectedMcp: true,
          verifiedMutationReceipt: true,
          async run() { return receipt; },
        },
      },
    });

    const reply = await engine.chat("remember this", "web");

    expect(reply.text).toContain("Verified mutation receipt from generic_memory_write.");
    expect(reply.text).toContain(`- commit: ${"c".repeat(40)}`);
  });

  it("keeps a read-only wallet peer result available for model-drafted prose", async () => {
    const llm = new ScriptedLlm(
      { tool: "generic_peer_read", input: { query: "ring" }, result: '{"matches":["ring"]}' },
      "I found one memory about the Ring.",
    );
    const engine = createEngine({
      llm: llm as unknown as BrainLlm,
      state: new SqliteStateStore(":memory:"),
      peerTools: {
        generic_peer_read: {
          description: "Search memory",
          connectedMcp: true,
          async run() { return '{"matches":["ring"]}'; },
        },
      },
    });

    const reply = await engine.chat("what do you remember?", "web");

    expect(reply.text).toContain("I found one memory about the Ring.");
    expect(reply.text).toContain("Connected MCP result from generic_peer_read");
    expect(reply.text).toContain('> {"matches":["ring"]}');
  });

  it("replaces zero-tool fabricated success at the persisted chat boundary", async () => {
    const engine = vaultlessEngine(new ScriptedLlm(null, "Published. https://x.com/user/status/{POST_ID}") as unknown as BrainLlm);
    const reply = await engine.chat("was it sent?", "web");
    expect(reply.text).toBe("Nothing was changed: no verified same-turn mutation receipt was returned.");
  });
});
