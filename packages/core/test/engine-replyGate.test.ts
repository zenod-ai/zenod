import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { isKnownTool, toolKind } from "../src/toolKinds.js";
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
    private readonly streamedChunks: string[] = [],
  ) {}

  async answer(input: AnswerInput, _tools: VaultReadTools, _taskTools?: VaultTaskTools, _driveTools?: unknown, _peerTools?: PeerTools): Promise<AnswerResult> {
    if (this.peerCall) {
      const mutating =
        _peerTools?.[this.peerCall.tool]?.verifiedMutationReceipt === true ||
        _peerTools?.[this.peerCall.tool]?.annotations?.readOnlyHint === false ||
        (isKnownTool(this.peerCall.tool) && toolKind(this.peerCall.tool) === "mutate");
      input.onPeerAction?.(this.peerCall.tool, this.peerCall.input, this.peerCall.result, {
        peerAction: _peerTools?.[this.peerCall.tool]?.connectedMcp,
        ...(mutating ? { mutationAttempt: true } : {}),
      });
    }
    for (const chunk of this.streamedChunks) input.onTextDelta?.(chunk);
    return { text: this.draftedText, readPaths: [] };
  }
}

class HoldRecoveryLlm {
  calls = 0;
  questions: string[] = [];
  hostInstructions: Array<string | undefined> = [];

  async answer(input: AnswerInput): Promise<AnswerResult> {
    this.calls += 1;
    this.questions.push(input.question);
    this.hostInstructions.push(input.hostInstruction);
    if (this.calls === 1) {
      input.onPeerAction?.("portable_read", { query: "context" }, '{"answer":"context only"}', {
        peerAction: true,
      });
      return { text: "Held for approval; nothing was sent or changed.", readPaths: [] };
    }
    input.onPeerAction?.("portable_create", { text: "exact" }, "[approval_required] held", {
      peerAction: true,
      mutationAttempt: true,
    });
    return { text: "The draft is held.", readPaths: [] };
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

    expect(reply.text).toBe("Nothing pending to approve.");
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

    expect(reply.text).toBe("Done — the change was verified.\n\nEvidence:\n- Evidence: <https://x.com/i/web/status/42>");
    expect(reply.text).not.toContain("post_tweet");
    // Still logged: the model tried to narrate its own line instead of relaying verbatim.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never emits streamed model mutation prose before the final receipt gate", async () => {
    const llm = new ScriptedLlm(
      { tool: "post_tweet", input: { text: "hello world" }, result: "Posted to X. Live URL: https://x.com/i/web/status/42" },
      "Saved and posted: https://x.com/i/web/status/fabricated",
      ["Saved and posted: ", "https://x.com/i/web/status/fabricated"],
    );
    const engine = vaultlessEngine(llm as unknown as BrainLlm);
    const delivered: string[] = [];

    const reply = await engine.chat("send it", "web", (delta) => delivered.push(delta));

    expect(reply.text).toBe("Done — the change was verified.\n\nEvidence:\n- Evidence: <https://x.com/i/web/status/42>");
    expect(delivered).toEqual([reply.text]);
    expect(delivered.join("")).not.toContain("fabricated");
    expect(delivered.join("")).not.toContain("Saved and posted");
  });

  it("a non-action turn (no side-effect tool ran) is left untouched — the gate never fires", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = new ScriptedLlm(null, "Sure — here's a draft for you to review.");
    const engine = vaultlessEngine(llm as unknown as BrainLlm);

    const reply = await engine.chat("draft me a tweet", "web");

    expect(reply.text).toBe("Sure — here's a draft for you to review.");
    expect(warn).not.toHaveBeenCalled();
  });

  it("renders the typed terminal-capture answer intact without treating quoted storage state as a receipt", async () => {
    const state = new SqliteStateStore(":memory:", "tenant-alpha");
    await state.appendCaptureTicket({
      identity: {
        tenantId: "tenant-alpha",
        surface: "whatsapp",
        conversationKey: "whatsapp:34611111111",
        providerMessageId: "latest-note",
      },
      summary: "The current capture is already stored.",
      evidenceRef: "Log/2026-07-30.md#^e-1d0d28",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const modelAnswer =
      "The current capture is already stored at **Log/2026-07-30.md#^e-1d0d28**. No mutation tool was called.";
    const engine = createEngine({
      llm: new ScriptedLlm(null, modelAnswer) as unknown as BrainLlm,
      state,
    });

    const reply = await engine.handleTasking({
      text: "for now simply store the note into memory",
      surface: "whatsapp",
      conversationKey: "whatsapp:34611111111",
    });

    expect(reply.actions).toEqual([]);
    expect(reply.text).toBe(
      `${modelAnswer}\n\nRead-only answer — no action was performed.`,
    );
    const conversation = await state.recentWindow("whatsapp:whatsapp:34611111111");
    expect(conversation.at(-1)).toMatchObject({
      role: "assistant",
      text: modelAnswer,
    });
  });

  it("renders one host status when the model repeats status prose after a typed peer answer", async () => {
    const evidenceRef = "Log/2026-07-30.md#^e-23ece7";
    const answer = "The voice note before the last one was about exploring el Conflent.";
    const status = "Read-only answer — no action was performed.";
    const rendered = `${answer}\n\nSources:\n- ${evidenceRef}\n\n${status}`;
    const typedResult = JSON.stringify({
      content: [{ type: "text", text: rendered }],
      structuredContent: {
        type: "answer_content",
        text: answer,
        sources: [{ path: evidenceRef }],
        status: {
          type: "read_only_status",
          text: status,
        },
      },
    });
    const llm = new ScriptedLlm(
      {
        tool: "generic_memory_read",
        input: { question: "what was the voice note before the last one about?" },
        result: typedResult,
      },
      `${answer}\n\n${status}\n\n${status}`,
    );
    const engine = createEngine({
      llm: llm as unknown as BrainLlm,
      state: new SqliteStateStore(":memory:"),
      peerTools: {
        generic_memory_read: {
          description: "Ask connected memory",
          connectedMcp: true,
          annotations: { readOnlyHint: true },
          async run() { return typedResult; },
        },
      },
    });

    const reply = await engine.chat(
      "what was the voice note before the last one about?",
      "whatsapp",
    );

    expect(reply.text).toBe(rendered);
  });

  it("keeps a typed host status out of the next model conversation", async () => {
    const state = new SqliteStateStore(":memory:");
    const answer = "The latest voice note was about Intermarché.";
    const evidenceRef = "Log/2026-07-30.md#^e-3ffa72";
    const status = "Read-only answer — no action was performed.";
    const answerWithSources = `${answer}\n\nSources:\n- ${evidenceRef}`;
    const rendered = `${answerWithSources}\n\n${status}`;
    const typedResult = JSON.stringify({
      content: [{ type: "text", text: rendered }],
      structuredContent: {
        type: "answer_content",
        text: answer,
        sources: [{ path: evidenceRef }],
        status: {
          type: "read_only_status",
          text: status,
        },
      },
    });
    const engine = createEngine({
      llm: new ScriptedLlm(
        {
          tool: "generic_memory_read",
          input: { question: "what was the last voice note about?" },
          result: typedResult,
        },
        `${answer}\n\n${status}\n\n${status}`,
      ) as unknown as BrainLlm,
      state,
      peerTools: {
        generic_memory_read: {
          description: "Ask connected memory",
          connectedMcp: true,
          annotations: { readOnlyHint: true },
          async run() { return typedResult; },
        },
      },
    });

    const reply = await engine.chat(
      "what was the last voice note about?",
      "whatsapp",
    );
    const conversation = await state.recentWindow("whatsapp:default");

    expect(reply.text).toBe(rendered);
    expect(conversation.at(-1)).toMatchObject({
      role: "assistant",
      text: answerWithSources,
    });
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

    expect(reply.text).toContain("Done — the change was verified.");
    expect(reply.text).toContain(`- Commit: \`${"c".repeat(40)}\``);
    expect(reply.text).not.toContain("generic_memory_write");
  });

  it("preserves a substantive synthesized peer read instead of exposing the raw result", async () => {
    const llm = new ScriptedLlm(
      { tool: "generic_peer_read", input: { query: "ring" }, result: '{"answer":"One grounded memory about the Ring."}' },
      "The available memory says the Ring is the main topic.",
    );
    const engine = createEngine({
      llm: llm as unknown as BrainLlm,
      state: new SqliteStateStore(":memory:"),
      peerTools: {
        generic_peer_read: {
          description: "Search memory",
          connectedMcp: true,
          async run() { return '{"answer":"One grounded memory about the Ring."}'; },
        },
      },
    });

    const reply = await engine.chat("what do you remember?", "web");

    expect(reply.text).toBe("The available memory says the Ring is the main topic.");
    expect(reply.text).not.toContain("One grounded memory about the Ring.");
    expect(reply.text).not.toContain('"answer"');
  });

  it("replaces zero-tool fabricated success at the persisted chat boundary", async () => {
    const engine = vaultlessEngine(new ScriptedLlm(null, "Published. https://x.com/user/status/{POST_ID}") as unknown as BrainLlm);
    const reply = await engine.chat("was it sent?", "web");
    expect(reply.text).toBe("Nothing was changed: no verified same-turn mutation receipt was returned.");
  });

  it("retries one unsupported zero-tool hold and accepts only the grounded peer hold", async () => {
    const llm = new HoldRecoveryLlm();
    const engine = createEngine({
      llm: llm as unknown as BrainLlm,
      state: new SqliteStateStore(":memory:"),
      peerTools: {
        portable_read: {
          description: "Read remote context without changing state.",
          connectedMcp: true,
          async run() { return '{"answer":"context only"}'; },
        },
        portable_create: {
          description: "Create a held remote action.",
          connectedMcp: true,
          verifiedMutationReceipt: true,
          async run() { return "[approval_required] held"; },
        },
      },
    });

    const reply = await engine.chat("create this exact remote action", "web");

    expect(llm.calls).toBe(2);
    expect(llm.questions).toEqual(["create this exact remote action", "create this exact remote action"]);
    expect(llm.hostInstructions[0]).toBeUndefined();
    expect(llm.hostInstructions[1]).toContain("no standing action exists");
    expect(reply.text).toContain("Held for approval; nothing was sent or changed.");
    expect(reply.text).not.toContain("portable_create");
    expect(reply.text).toContain('"text": "exact"');
  });
});
