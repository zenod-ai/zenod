import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetApprovalTokens,
  approvalTokenSnapshot,
  approvedExactText,
  classifyApprovalIntent,
  hydrateApprovalTokens,
  registerStandingApproval,
  resolveStandingApproval,
} from "../src/approvalTokens.js";
import { SqliteStateStore } from "../src/state/sqlite.js";

describe("generic standing-action contract", () => {
  beforeEach(() => __resetApprovalTokens());

  it("recognizes natural, exact, typo-obvious, edit, and cancel language without treating recognition as authority", () => {
    for (const text of ["yes", "Looks good, send it", 'APPROVE: "exact"', 'PPROVE: "exact"']) {
      expect(classifyApprovalIntent(text)).toBe("approve");
    }
    expect(approvedExactText('PPROVE: "byte exact"')).toBe("byte exact");
    expect(classifyApprovalIntent("Change integration to seam")).toBe("edit");
    expect(classifyApprovalIntent("Looks good, but wait — do not send it")).toBe("cancel");
  });

  it("requires one same-connection, same-tool, exact-argument candidate and consumes it once", () => {
    expect(registerStandingApproval("a", "peer-a", "peer__create__1", { text: "exact" }, "[approval_required] held")).toBe(true);
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer-b", tool: "peer__create__1", args: { text: "exact" }, userRequest: "yes" })).toBe("mismatch");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer-a", tool: "peer__approve__2", args: { text: "exact" }, userRequest: "yes" })).toBe("mismatch");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer-a", tool: "peer__create__1", args: { text: "changed" }, userRequest: "yes" })).toBe("mismatch");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer-a", tool: "peer__create__1", args: { text: "exact" }, userRequest: "yes" })).toBe("allowed");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer-a", tool: "peer__create__1", args: { text: "exact" }, userRequest: "yes" })).toBe("nothing_pending");
  });

  it("rejects extra confirmation arguments and accepts only the canonical held arguments", () => {
    registerStandingApproval("a", "peer", "peer__mutate__1", { text: "exact" }, "approval required", "Mutate after confirmation");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer", tool: "peer__mutate__1", args: { text: "changed", confirmed: true }, userRequest: "yes", description: "Mutate after confirmation" })).toBe("mismatch");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer", tool: "peer__mutate__1", args: { text: "exact", confirmed: true }, userRequest: "yes", description: "Mutate after confirmation" })).toBe("mismatch");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer", tool: "peer__mutate__1", args: { text: "exact" }, userRequest: "yes" })).toBe("allowed");
  });

  it("uses exact tool identity and APPROVE text and never carries approval across conversations", () => {
    registerStandingApproval("a", "peer", "peer__draft__1", { text: "one" }, "[draft_not_approved]");
    registerStandingApproval("a", "peer", "peer__draft__2", { text: "two" }, "approval required");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer", tool: "peer__commit__3", args: { text: "one" }, userRequest: "yes" })).toBe("mismatch");
    expect(resolveStandingApproval({ conversationId: "b", owner: "peer", tool: "peer__commit__3", args: { text: "one" }, userRequest: "yes" })).toBe("nothing_pending");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer", tool: "peer__draft__2", args: { text: "two" }, userRequest: 'PPROVE: "two"' })).toBe("allowed");
  });

  it("does not let a publish approval cross into a delete operation", () => {
    registerStandingApproval("a", "peer", "peer__createPosts__1", { text: "exact" }, "[draft_not_approved]", "Create a held post draft");
    expect(resolveStandingApproval({ conversationId: "a", owner: "peer", tool: "peer__deletePosts__2", args: { text: "exact" }, userRequest: "yes", description: "Delete a post" })).toBe("mismatch");
  });

  it("round-trips a durable snapshot for restart hydration", () => {
    registerStandingApproval("old-runtime:a", "peer", "peer__draft__1", { text: "exact" }, "confirmation required");
    const persisted = approvalTokenSnapshot("old-runtime:a");
    __resetApprovalTokens();
    hydrateApprovalTokens("new-runtime:a", persisted);
    expect(resolveStandingApproval({ conversationId: "new-runtime:a", owner: "peer", tool: "peer__draft__1", args: { text: "exact" }, userRequest: "yes" })).toBe("allowed");
  });

  it("persists and clears standing state inside the tenant conversation store", async () => {
    const state = new SqliteStateStore(":memory:");
    const tokens = [{ tool: "peer__draft__1", owner: "peer", args: { text: "exact" }, draftHash: "hash", expiresAt: Date.now() + 60_000 }];
    await state.saveApprovalTokens("web:tenant-thread", tokens);
    expect(await state.loadApprovalTokens("web:tenant-thread")).toEqual(tokens);
    expect(await state.loadApprovalTokens("web:other-thread")).toEqual([]);
    await state.clearConversation("web:tenant-thread");
    expect(await state.loadApprovalTokens("web:tenant-thread")).toEqual([]);
  });
});
