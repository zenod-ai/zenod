import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyHeraldNaturalLoopIntent,
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
  extra: Partial<Pick<HeraldChatDependencies, "listApproved" | "publishApproved" | "proposeNow">> = {},
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
    getTurnState: (tenantId) => {
      const briefing = store.getApprovedBriefing(tenantId);
      if (!briefing) throw new Error("approved briefing required");
      return {
        briefing,
        board: store.listBoardItems(tenantId),
        filings: store.listFilings(tenantId),
        wakes: store.recentWakeReceipts(tenantId),
      };
    },
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

describe("Herald natural loop intent classifier", () => {
  it("routes only explicit loop intents and leaves ordinary conversation to grounded Herald", () => {
    expect(classifyHeraldNaturalLoopIntent("can you show some of the posts you propose?"))
      .toEqual({ kind: "propose" });
    expect(classifyHeraldNaturalLoopIntent("approve 1 and 3"))
      .toEqual({ kind: "approve", command: "✓ 1,3" });
    expect(classifyHeraldNaturalLoopIntent("dial down the slang and be more serious"))
      .toEqual({ kind: "feedback" });
    expect(classifyHeraldNaturalLoopIntent("don't post these; they are too corny"))
      .toEqual({ kind: "feedback" });
    expect(classifyHeraldNaturalLoopIntent("publish approved"))
      .toEqual({ kind: "publish", allApproved: true });
    expect(classifyHeraldNaturalLoopIntent("please send it now"))
      .toEqual({ kind: "publish", allApproved: false });
    expect(classifyHeraldNaturalLoopIntent("what did we post?")).toBeNull();
    expect(classifyHeraldNaturalLoopIntent("can you send out one of them?")).toBeNull();
    expect(classifyHeraldNaturalLoopIntent("are more serious posts performing better?")).toBeNull();
    expect(classifyHeraldNaturalLoopIntent("don't draft posts")).toBeNull();
    expect(classifyHeraldNaturalLoopIntent("why did you propose these posts?")).toBeNull();
    expect(classifyHeraldNaturalLoopIntent("what proposals did you suggest?")).toBeNull();
    expect(classifyHeraldNaturalLoopIntent("what do you think our sharpest perspective is?"))
      .toBeNull();
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

      const retried = await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      expect(retried.text).toContain("Briefing v1 is already approved; nothing changed");
      expect(fileToMemory).toHaveBeenCalledOnce();
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

  it("routes a natural show-posts request through the real proposer and renders cited board rows", async () => {
    let store!: HeraldLoopStore;
    const proposeNow = vi.fn(async (tenantId: string) => {
      const wakeId = store.tryStartWake(tenantId, "run_now")!;
      const created = store.createProposals(tenantId, wakeId, [proposal(1), proposal(2)]);
      return store.finishWake(wakeId, {
        status: "completed",
        code: "wake_completed",
        message: "Herald wake completed with 2 substantiated proposals.",
        proposalIds: created.items.map((item) => item.id),
      });
    });
    const fixture = await storeFixture(async () => "Stored.\ncommit: aaa1234", { proposeNow });
    store = fixture.store;
    try {
      await negotiate(fixture.handle);
      await fixture.handle({ tenantId: "alpha", text: "✓ approve briefing" });
      const result = await fixture.handle({ tenantId: "alpha", text: "can you show some of the posts you propose?" });

      expect(proposeNow).toHaveBeenCalledWith("alpha");
      expect(result).toMatchObject({ handled: true, text: expect.stringContaining("wake completed") });
      expect(result.text).toContain("1. Proposal 1");
      expect(result.text).toContain("WHY: Filing 1 shows useful evidence");
      expect(result.text).toContain("Memory: https://zenod.dev/memory/1");
      expect(store.listBoardItems("alpha", ["proposed"])).toHaveLength(2);

      for (const text of [
        "don't draft posts",
        "why did you propose these posts?",
        "what proposals did you suggest?",
      ]) {
        const grounded = await fixture.handle({ tenantId: "alpha", text });
        expect(grounded.handled).toBe(false);
      }
      expect(proposeNow).toHaveBeenCalledOnce();
    } finally {
      store.close();
    }
  });

  it("routes natural numbered approval through the current-list parser and never accepts invented approval syntax", async () => {
    const fileToMemory = vi.fn(async () => "Stored.\ncommit: bbb1234");
    const { store, handle } = await storeFixture(fileToMemory);
    try {
      await negotiate(handle);
      await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      fileToMemory.mockClear();
      const wakeId = store.tryStartWake("alpha", "run_now")!;
      store.createProposals("alpha", wakeId, [proposal(1), proposal(2), proposal(3)]);
      store.finishWake(wakeId, { status: "completed", code: "wake_completed", message: "ready" });

      const unsupported = await handle({ tenantId: "alpha", text: "✓ approve post" });
      expect(unsupported.text).toContain("I could not parse that approval");
      expect(unsupported.text).not.toContain("✓ approve post");
      expect(store.listBoardItems("alpha").map((item) => item.state)).toEqual(["proposed", "proposed", "proposed"]);

      const result = await handle({ tenantId: "alpha", text: "approve 1 and 3" });
      expect(result.text).toContain("Approving 1 and 3, rejecting 2.");
      expect(store.listBoardItems("alpha").map((item) => item.state)).toEqual(["approved", "rejected", "approved"]);
      expect(fileToMemory).toHaveBeenCalledOnce();
    } finally {
      store.close();
    }
  });

  it("files natural feedback to Zenod, persists the local lesson, and rejects current proposals before success", async () => {
    const fileToMemory = vi.fn(async () => "Stored.\ncommit: ccc1234");
    const { store, handle } = await storeFixture(fileToMemory);
    try {
      await negotiate(handle);
      await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      fileToMemory.mockClear();
      const wakeId = store.tryStartWake("alpha", "run_now")!;
      store.createProposals("alpha", wakeId, [proposal(1), proposal(2)]);
      store.finishWake(wakeId, { status: "completed", code: "wake_completed", message: "ready" });

      const feedback = "don't post these; dial down the slang, don't sound corny, and be more serious and informative";
      const result = await handle({ tenantId: "alpha", text: feedback });
      expect(result.text).toContain("durable iteration lesson");
      expect(result.text).toContain("commit: ccc1234");
      expect(fileToMemory).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: "alpha",
        kind: "lesson",
        content: expect.stringContaining(feedback),
      }));
      expect(store.listFilings("alpha")).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "lesson", content: expect.stringContaining(feedback), commitReceipt: expect.stringContaining("ccc1234") }),
      ]));
      expect(store.listBoardItems("alpha").map((item) => item.state)).toEqual(["rejected", "rejected"]);
      expect(store.countProposed("alpha")).toBe(0);
    } finally {
      store.close();
    }
  });

  it("never publishes without approval and natural send targets only real approved board state", async () => {
    const published = vi.fn(async (_tenantId: string, itemIds: string[]) => ({
      status: "ok" as const,
      message: `Published ${itemIds.length} approved item.`,
      published: [{ permalink: "https://x.com/i/web/status/88" }],
    }));
    let store!: HeraldLoopStore;
    const fixture = await storeFixture(async () => "Stored.\ncommit: ddd1234", {
      listApproved: (tenantId) => store.listBoardItems(tenantId, ["approved"]),
      publishApproved: published,
    });
    store = fixture.store;
    try {
      await negotiate(fixture.handle);
      await fixture.handle({ tenantId: "alpha", text: "✓ approve briefing" });
      const wakeId = store.tryStartWake("alpha", "run_now")!;
      const created = store.createProposals("alpha", wakeId, [proposal(1)]);
      store.finishWake(wakeId, { status: "completed", code: "wake_completed", message: "ready" });

      const retrospective = await fixture.handle({ tenantId: "alpha", text: "what did we post?" });
      expect(retrospective.handled).toBe(false);
      expect(published).not.toHaveBeenCalled();

      const blocked = await fixture.handle({ tenantId: "alpha", text: "send it" });
      expect(blocked.text).toContain("there are no approved board items");
      expect(blocked.text).toContain("✓ 1");
      expect(blocked.text).not.toContain("✓ approve post");
      expect(published).not.toHaveBeenCalled();

      store.approveItems("alpha", [created.items[0]!.id]);
      const sent = await fixture.handle({ tenantId: "alpha", text: "send it" });
      expect(sent.text).toContain("https://x.com/i/web/status/88");
      expect(published).toHaveBeenCalledWith("alpha", [created.items[0]!.id]);
    } finally {
      store.close();
    }
  });

  it("grounds every ordinary post-briefing turn in tenant briefing, board, filings, wakes, and receipts", async () => {
    const { store, handle } = await storeFixture(async () => "Stored.\ncommit: abc7890");
    try {
      await negotiate(handle);
      await handle({ tenantId: "alpha", text: "✓ approve briefing" });
      const wakeId = store.tryStartWake("alpha", "run_now", 100)!;
      const created = store.createProposals("alpha", wakeId, [proposal(1)], 110);
      store.finishWake(wakeId, {
        status: "completed",
        code: "wake_completed",
        message: "Herald wake completed with one cited proposal.",
        proposalIds: [created.items[0]!.id],
      }, 120);
      store.approveItems("alpha", [created.items[0]!.id], 130);
      store.markPosted("alpha", created.items[0]!.id, "https://x.com/i/web/status/42", 140);
      store.recordFiling({
        tenantId: "alpha",
        kind: "posted",
        content: "Build on the posted context-ownership angle.",
        memoryCitation: proposal(1).memoryCitation,
        commitReceipt: "commit: fedcba9",
      }, 150);
      store.approveBriefing({
        tenantId: "beta",
        content: {
          theme: "BETA PRIVATE THEME",
          objectives: ["BETA PRIVATE OBJECTIVE"],
          tone: "private",
          replyPolicy: "none",
        },
        cadenceMinutes: 60,
      }, 160);
      store.recordFiling({
        tenantId: "beta",
        kind: "private",
        content: "BETA PRIVATE FILING",
        memoryCitation: null,
        commitReceipt: "commit: 7654321",
      }, 170);

      const result = await handle({ tenantId: "alpha", text: "what should we do next?" });
      expect(result.handled).toBe(false);
      expect(result.contextNote).toContain("HERALD AUTHORITATIVE TURN STATE");
      expect(result.contextNote).toContain("Build in public");
      expect(result.contextNote).toContain("Proposal 1");
      expect(result.contextNote).toContain("https://x.com/i/web/status/42");
      expect(result.contextNote).toContain("commit: fedcba9");
      expect(result.contextNote).toContain("wake_completed");
      expect(result.contextNote).not.toContain("BETA PRIVATE");
      expect(result.contextNote).not.toMatch(/\b(?:Ring|Council)\b/);
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
