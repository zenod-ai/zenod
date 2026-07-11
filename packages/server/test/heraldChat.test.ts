import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHeraldChatHandler,
  createZenodWalletFiler,
  parseHeraldApproval,
  type HeraldChatDependencies,
} from "../src/heraldChat.js";
import { HeraldLoopStore, type HeraldProposalInput } from "../src/heraldLoop.js";
import type { PeerConfig } from "../src/peerClient.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function storeFixture(
  fileToMemory: HeraldChatDependencies["fileToMemory"],
  extra: Partial<Pick<HeraldChatDependencies, "listApproved" | "publishApproved">> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "herald-chat-"));
  dirs.push(dir);
  const store = new HeraldLoopStore(join(dir, "loop.sqlite"));
  const dependencies: HeraldChatDependencies = {
    getApprovedBriefing: (tenantId) => store.getApprovedBriefing(tenantId),
    getBriefingDraft: (tenantId) => store.getBriefingDraft(tenantId),
    saveBriefingDraft: (tenantId, patch) => store.saveBriefingDraft(tenantId, patch),
    clearBriefingDraft: (tenantId) => store.clearBriefingDraft(tenantId),
    approveBriefing: (input) => store.approveBriefing(input),
    listProposed: (tenantId) => store.listBoardItems(tenantId, ["proposed"]),
    decideItems: (tenantId, input) => store.decideItems(tenantId, input),
    recordFiling: (input) => store.recordFiling(input),
    fileToMemory,
    ...extra,
  };
  return { store, handle: createHeraldChatHandler(dependencies) };
}

async function negotiate(handle: ReturnType<typeof createHeraldChatHandler>, tenantId = "alpha") {
  await handle({ tenantId, text: "hello" });
  await handle({ tenantId, text: "Build in public" });
  await handle({ tenantId, text: "Show shipped work, teach the method" });
  await handle({ tenantId, text: "3 posts daily" });
  await handle({ tenantId, text: "Specific and calm" });
  return handle({ tenantId, text: "Reply only to substantive questions" });
}

function proposal(index: number): HeraldProposalInput {
  return {
    text: `Proposal ${index}`,
    rationale: `Filing ${index} shows useful evidence`,
    memoryCitation: `https://zenod.dev/memory/${index}`,
  };
}

describe("Herald approval parser", () => {
  it("parses the three settled current-list forms and rejects ambiguous or out-of-range input", () => {
    expect(parseHeraldApproval("✓ 1,3", 3)).toEqual({ approveIndexes: [1, 3], rejectIndexes: [2] });
    expect(parseHeraldApproval("✓ all", 3)).toEqual({ approveIndexes: [1, 2, 3], rejectIndexes: [] });
    expect(parseHeraldApproval("✓ 2 + reject the rest", 3)).toEqual({ approveIndexes: [2], rejectIndexes: [1, 3] });
    expect(parseHeraldApproval("✓ maybe 2", 3)).toBeNull();
    expect(parseHeraldApproval("✓ 4", 3)).toBeNull();
  });
});

describe("Herald briefing chat", () => {
  it("interviews all five briefing fields, refuses early approval, then commits only the exact phrase with a Zenod receipt", async () => {
    const fileToMemory = vi.fn(async () => "Stored.\ncommit: abc1234\nhttps://github.com/zenod/memory/commit/abc1234");
    const { store, handle } = await storeFixture(fileToMemory);
    try {
      const started = await handle({ tenantId: "alpha", text: "run the loop" });
      expect(started).toMatchObject({ handled: true, text: expect.stringContaining("No loop action can run before approval") });

      const early = await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      expect(early.text).toContain("approval refused: theme is still missing");
      expect(store.getApprovedBriefing("alpha")).toBeNull();

      const premature = await handle({ tenantId: "alpha", text: "run now" });
      expect(premature.text).toContain("Loop action refused: no approved briefing");
      expect(store.getBriefingDraft("alpha")).toMatchObject({ theme: null });

      await handle({ tenantId: "alpha", text: "Build in public" });
      await handle({ tenantId: "alpha", text: "Show shipped work, teach the method" });
      await handle({ tenantId: "alpha", text: "3 posts daily" });
      await handle({ tenantId: "alpha", text: "Specific and calm" });
      const ready = await handle({ tenantId: "alpha", text: "Reply only to substantive questions" });
      expect(ready.text).toContain("Briefing v1 ready for approval");
      expect(ready.text).toContain("✓ approve briefing");

      const almost = await handle({ tenantId: "alpha", text: "✓ APPROVE BRIEFING" });
      expect(almost.text).toContain("Reply exactly");
      expect(store.getApprovedBriefing("alpha")).toBeNull();

      const approved = await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      expect(approved.text).toContain("Briefing v1 approved");
      expect(approved.text).toContain("commit: abc1234");
      expect(approved.text).toContain("Filed briefing to memory");
      expect(fileToMemory).toHaveBeenCalledOnce();
      expect(store.getApprovedBriefing("alpha")).toMatchObject({
        version: 1,
        cadenceMinutes: 1440,
        proposalCount: 3,
        content: {
          theme: "Build in public",
          objectives: ["Show shipped work", "teach the method"],
          tone: "Specific and calm",
          replyPolicy: "Reply only to substantive questions",
        },
      });
      expect(store.getBriefingDraft("alpha")).toBeNull();
      expect(store.listFilings("alpha")).toEqual([expect.objectContaining({ kind: "briefing", commitReceipt: expect.stringContaining("abc1234") })]);
    } finally {
      store.close();
    }
  });

  it("fails loudly and leaves the briefing unapproved when Zenod has no verified commit receipt", async () => {
    const { store, handle } = await storeFixture(async () => "silent_ack");
    try {
      await negotiate(handle);
      const result = await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      expect(result.text).toContain("ERROR: Zenod returned no verified commit receipt");
      expect(store.getApprovedBriefing("alpha")).toBeNull();
      expect(store.getBriefingDraft("alpha")).not.toBeNull();
      expect(store.listFilings("alpha")).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("echoes the parsed current-list decision, acts once, and files every omitted proposal rejection", async () => {
    const fileToMemory = vi.fn(async () => "Stored.\ncommit: def5678");
    const { store, handle } = await storeFixture(fileToMemory);
    try {
      await negotiate(handle);
      await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      fileToMemory.mockClear();

      const wakeId = store.tryStartWake("alpha", "run_now")!;
      store.createProposals("alpha", wakeId, [proposal(1), proposal(2), proposal(3)]);
      store.finishWake(wakeId, { status: "completed", code: "wake_completed", message: "ready" });

      const decision = await handle({ tenantId: "alpha", text: "✓ 1,3" });
      expect(decision.text).toContain("Approving 1 and 3, rejecting 2.");
      expect(decision.text).toContain("Approved 2; rejected 1.");
      expect(decision.text).toContain("commit: def5678");
      expect(fileToMemory).toHaveBeenCalledOnce();
      expect(fileToMemory.mock.calls[0][0]).toMatchObject({ kind: "proposal_rejection", content: expect.stringContaining("Rejected 2: Proposal 2") });
      expect(store.listBoardItems("alpha").map((item) => item.state)).toEqual(["approved", "rejected", "approved"]);
      expect(store.listFilings("alpha")).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "proposal_rejection", commitReceipt: expect.stringContaining("def5678") }),
      ]));

      const repeated = await handle({ tenantId: "alpha", text: "✓ 1,3" });
      expect(repeated.text).toContain("there are no current proposed items");
      expect(fileToMemory).toHaveBeenCalledOnce();
    } finally {
      store.close();
    }
  });

  it("asks once on unclear approval and does not mutate the current board", async () => {
    const fileToMemory = vi.fn(async () => "Stored.\ncommit: fed4321");
    const { store, handle } = await storeFixture(fileToMemory);
    try {
      await negotiate(handle);
      await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      fileToMemory.mockClear();
      const wakeId = store.tryStartWake("alpha", "run_now")!;
      store.createProposals("alpha", wakeId, [proposal(1), proposal(2)]);
      store.finishWake(wakeId, { status: "completed", code: "wake_completed", message: "ready" });

      const result = await handle({ tenantId: "alpha", text: "✓ the good one" });
      expect(result.text).toContain("I could not parse that approval");
      expect(result.text).toContain("nothing changed");
      expect(store.listBoardItems("alpha").map((item) => item.state)).toEqual(["proposed", "proposed"]);
      expect(fileToMemory).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it("publishes only the already-approved current items on the separate chat command", async () => {
    const published = vi.fn(async (_tenantId: string, itemIds: string[]) => ({
      status: "ok" as const,
      message: `Published ${itemIds.length} approved items.`,
      published: itemIds.map((_, index) => ({ permalink: `https://x.com/i/web/status/${index + 10}` })),
    }));
    let store!: HeraldLoopStore;
    const fixture = await storeFixture(
      async () => "Stored.\ncommit: cab1234",
      {
        listApproved: (tenantId) => store.listBoardItems(tenantId, ["approved"]),
        publishApproved: published,
      },
    );
    store = fixture.store;
    try {
      await negotiate(fixture.handle);
      await fixture.handle({ tenantId: "alpha", text: "✓ approve briefing" });
      const wakeId = store.tryStartWake("alpha", "run_now")!;
      const created = store.createProposals("alpha", wakeId, [proposal(1), proposal(2)]);
      store.finishWake(wakeId, { status: "completed", code: "wake_completed", message: "ready" });
      store.approveItems("alpha", created.items.map((item) => item.id));

      const result = await fixture.handle({ tenantId: "alpha", text: "publish approved" });
      expect(result).toMatchObject({ handled: true, text: expect.stringContaining("https://x.com/i/web/status/10") });
      expect(published).toHaveBeenCalledWith("alpha", created.items.map((item) => item.id));
    } finally {
      store.close();
    }
  });
});

describe("Zenod wallet filing seam", () => {
  it("selects the tenant wallet's Zenod and delegates store_memory through the existing peer caller", async () => {
    const zenod: PeerConfig = {
      name: "Zenod",
      url: "https://cloud.zenod.dev/mcp/tenant-token",
      token: "downstream-token",
      wallet: true,
      tools: [{ as: "zenod_store", mcp: "store_memory", arg: "content", description: "Store memory" }],
    };
    const call = vi.fn(async () => "Stored.\ncommit: abcdef0");
    const file = createZenodWalletFiler(() => [zenod], call);
    await expect(file({ tenantId: "alpha", kind: "briefing", content: "Briefing v1" }))
      .resolves.toContain("commit: abcdef0");
    expect(call).toHaveBeenCalledWith(zenod, "store_memory", {
      content: "Briefing v1",
      verbatim: true,
      hints: ["Herald filing: briefing"],
    });
  });

  it("fails loudly instead of forwarding a tenant bearer when no Zenod wallet entry exists", async () => {
    const file = createZenodWalletFiler(() => [{
      name: "Other",
      url: "https://other.zenod.dev/mcp",
      token: "downstream-only",
      wallet: true,
    }]);
    await expect(file({ tenantId: "alpha", kind: "briefing", content: "x" }))
      .rejects.toThrow("No tenant Zenod memory entry");
  });
});
