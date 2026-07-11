import { describe, expect, it } from "vitest";
import { applyReplyGate, isActionTool } from "../src/replyGate.js";
import type { TaskingAction } from "../src/types.js";

const action = (
  tool: string,
  result: string,
  input: Record<string, unknown> = {},
  verifiedMutationReceipt = false,
): TaskingAction => ({
  tool,
  input,
  result,
  ...(verifiedMutationReceipt ? { verifiedMutationReceipt: true } : {}),
});

describe("isActionTool", () => {
  it("recognizes the outbound send tools and the standing-draft approval verb regardless of naming convention", () => {
    expect(isActionTool("post_tweet")).toBe(true);
    expect(isActionTool("postTweet")).toBe(true);
    expect(isActionTool("POST_TWEET")).toBe(true);
    expect(isActionTool("post_reddit")).toBe(true);
    expect(isActionTool("send_email")).toBe(true);
    expect(isActionTool("approve_send")).toBe(true);
  });

  it("does not flag reads, routing tools, or the backlog/execution family (already reconciled deterministically elsewhere)", () => {
    expect(isActionTool("x_read_mentions")).toBe(false);
    expect(isActionTool("execution_status")).toBe(false);
    expect(isActionTool("ask_archus")).toBe(false);
    expect(isActionTool("search_reddit")).toBe(false);
    expect(isActionTool("createIssue")).toBe(false);
    expect(isActionTool("queueExecution")).toBe(false);
    expect(isActionTool("console_run_ephemeral_task")).toBe(false);
  });
});

describe("applyReplyGate — the runtime interception (iteration-6)", () => {
  it("passes non-action turns through untouched", () => {
    const out = applyReplyGate("Sure, here's what I found.", []);
    expect(out.isActionTurn).toBe(false);
    expect(out.intercepted).toBe(false);
    expect(out.text).toBe("Sure, here's what I found.");
  });

  it("R1 replay — a blocked/absent receipt: the model narrates 'Posting now', the gate delivers the honest block instead", () => {
    const actions = [action("approve_send", "Nothing pending to approve.")];
    const events: unknown[] = [];
    const out = applyReplyGate("Approved. Posting now!", actions, (e) => events.push(e));

    expect(out.isActionTurn).toBe(true);
    expect(out.intercepted).toBe(true);
    expect(out.text).toBe("Nothing pending to approve.");
    expect(out.text).not.toMatch(/posting/i);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tools: ["approve_send"],
      discardedText: "Approved. Posting now!",
      deliveredText: "Nothing pending to approve.",
    });
  });

  it("R2 replay — a 'Posted' claim with a FAILED receipt and zero real tool evidence cannot reach the user", () => {
    const actions = [action("post_tweet", "FAILED to send to X (Twitter): the connector returned no detail. Do NOT tell the user it was sent.")];
    const out = applyReplyGate("Posted: https://x.com/i/web/status/999999999", actions);

    expect(out.isActionTurn).toBe(true);
    expect(out.intercepted).toBe(true);
    expect(out.text).toMatch(/^FAILED to send/);
    expect(out.text).not.toContain("999999999");
  });

  it("delivers the real receipt verbatim on a genuine success, even if the model's own text agreed", () => {
    const actions = [action("post_tweet", "Posted to X. Live URL: https://x.com/i/web/status/123")];
    const out = applyReplyGate("Posted to X. Live URL: https://x.com/i/web/status/123", actions);

    expect(out.isActionTurn).toBe(true);
    expect(out.intercepted).toBe(false);
    expect(out.text).toBe("Posted to X. Live URL: https://x.com/i/web/status/123");
  });

  it("joins multiple action-tool receipts from the same turn in call order", () => {
    const actions = [
      action("post_tweet", "Posted to X. Live URL: https://x.com/i/web/status/61"),
      action("send_email", "Sent the email. Confirmed id: msg-62"),
    ];
    const out = applyReplyGate("I've tweeted it and emailed the follow-up!", actions);
    expect(out.text).toBe("Posted to X. Live URL: https://x.com/i/web/status/61\n\nSent the email. Confirmed id: msg-62");
  });

  it("ignores read-only and backlog/execution tool calls when deciding whether this is an action turn", () => {
    const actions = [
      action("execution_status", "No execution tickets found for zenod-ai/zenod#61."),
      action("createIssue", "Created issue #61: https://github.com/zenod-ai/zenod/issues/61"),
    ];
    const out = applyReplyGate("Nothing has run for that one yet.", actions);
    expect(out.isActionTurn).toBe(false);
    expect(out.text).toBe("Nothing has run for that one yet.");
  });

  it("relays a verified Zenod-style wallet mutation receipt with its exact commit evidence", () => {
    const receipt = [
      "Stored.",
      "evidence: Log/2026-07-11.md#^e-ring",
      `commit: ${"a".repeat(40)}`,
      "https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Ring.md",
    ].join("\n");
    const out = applyReplyGate("I remembered that for you.", [action("memory_store", receipt, {}, true)]);

    expect(out.isActionTurn).toBe(true);
    expect(out.intercepted).toBe(true);
    expect(out.text).toBe(receipt);
  });

  it("relays a verified Calli-style wallet mutation receipt without a product or tool-name profile", () => {
    const receipt = "Posted to X. Live URL: https://x.com/i/web/status/2075755544816595012";
    const out = applyReplyGate("Done — your campaign is live.", [action("peer_mutation_42", receipt, {}, true)]);

    expect(out.text).toBe(receipt);
    expect(out.text).not.toContain("campaign");
  });

  it("relays a wallet mutation failure verbatim instead of an optimistic model claim", () => {
    const failure = "ERROR: explicit approval is required; no post was created.";
    const out = applyReplyGate("Posted successfully.", [action("portable_write", failure, {}, true)]);

    expect(out.text).toBe(failure);
    expect(out.text).not.toContain("successfully");
  });

  it("leaves wallet peer reads model-drafted when they are not marked as mutation receipts", () => {
    const out = applyReplyGate("The latest post is about the Ring.", [
      action("peer_read_42", '{"data":[{"text":"the Ring"}]}'),
    ]);

    expect(out.isActionTurn).toBe(false);
    expect(out.text).toBe("The latest post is about the Ring.");
  });

  // A1 / C-22: ask_outbound is a gated action tool — its result (Callistheness's own
  // verified reply) is delivered verbatim, so the Console can never re-narrate a real
  // send as "not posted", and a draft is relayed with its approve affordance.
  it("gates ask_outbound: a real send inside Callistheness is relayed, never re-narrated as 'not posted'", () => {
    const actions = [action("ask_outbound", "Posted to X. Live URL: https://x.com/i/web/status/700")];
    const out = applyReplyGate("Draft ready (not posted). Approve to post?", actions);
    expect(out.isActionTurn).toBe(true);
    expect(out.text).toBe("Posted to X. Live URL: https://x.com/i/web/status/700");
    expect(out.intercepted).toBe(true); // the fabricated "not posted" prose was discarded
  });

  it("gates ask_outbound: a genuine draft is relayed verbatim with its approve affordance", () => {
    const draft = "Draft: \"Shipping durable executors today.\" — reply 'send' to post it.";
    const out = applyReplyGate("Here's a tweet you could send whenever you like!", [action("ask_outbound", draft)]);
    expect(out.isActionTurn).toBe(true);
    expect(out.text).toBe(draft);
  });

});
