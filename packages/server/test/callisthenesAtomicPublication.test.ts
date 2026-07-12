import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallisthenesObservationLedger, observedContentId } from "../src/callisthenesObservationLedger.js";
import { createCallisthenesUnit } from "../src/callisthenesUnit.js";

const dirs: string[] = [];
const execFileAsync = promisify(execFile);

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "calli-atomic-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function rpcCall(unit: ReturnType<typeof createCallisthenesUnit>, token: string, id: number, name: string, arguments_: Record<string, unknown>) {
  return unit.app.request("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ } }),
  });
}

async function textOf(response: Response): Promise<string> {
  const body = await response.json() as { result: { content: Array<{ text: string }> } };
  return body.result.content[0]!.text;
}

describe("Callisthenes atomic publication", () => {
  it("collapses 20 approvals across two unit instances to one dispatch and one receipt", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([{ token: "alpha", tenant: { id: "tenant-a" } }]);
    let approvedCalls = 0;
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body)) as { params: { name: string; arguments: Record<string, unknown> } };
      if (rpc.params.name === "createPosts" && rpc.params.arguments.callisthenes_approve) {
        approvedCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"data":{"id":"1900999888777"}}' }] } });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[draft_not_approved] held" }] } });
    });
    const first = createCallisthenesUnit({ dataDir, tenantStore, fetcher: fetcher as typeof fetch });
    const second = createCallisthenesUnit({ dataDir, tenantStore, fetcher: fetcher as typeof fetch });
    try {
      const heldText = await textOf(await rpcCall(first, "alpha", 1, "createPosts", { text: "Atomic exact text." }));
      const actionId = heldText.match(/action_id=(act_[a-f0-9]{32})/)?.[1];
      expect(actionId).toBeTruthy();
      const approvals = Array.from({ length: 20 }, (_, index) => rpcCall(index % 2 ? first : second, "alpha", index + 10, "approve_send", {
        channel: "x", action_id: actionId, text: "Atomic exact text.",
      }).then(textOf));
      const results = await Promise.all(approvals);
      expect(new Set(results)).toEqual(new Set(["Posted to X. Live URL: https://x.com/i/web/status/1900999888777"]));
      expect(approvedCalls).toBe(1);
      expect(first.observationLedger.read("tenant-a")).toMatchObject({
        drafts: [expect.objectContaining({ id: actionId, status: "sent" })],
        receipts: [expect.objectContaining({ draft_id: actionId, url: "https://x.com/i/web/status/1900999888777" })],
        usage: { sends: 1 },
      });
    } finally {
      first.close();
      second.close();
    }
  });

  it("turns an abandoned dispatch lease into durable unknown after restart without reclaiming it", async () => {
    const dataDir = await tempDir();
    let now = new Date("2026-07-12T20:00:00.000Z");
    const first = new CallisthenesObservationLedger(dataDir, { now: () => now, dispatchLeaseMs: 1_000 });
    const held = first.hold("tenant-a", "Crash boundary.");
    expect(first.claim("tenant-a", { actionId: held.id, text: held.text }).state).toBe("claimed");
    first.close();

    now = new Date("2026-07-12T20:00:02.000Z");
    const restarted = new CallisthenesObservationLedger(dataDir, { now: () => now, dispatchLeaseMs: 1_000 });
    try {
      const state = restarted.claim("tenant-a", { actionId: held.id, text: held.text });
      expect(state).toMatchObject({ state: "unknown", action: { id: held.id, status: "unknown" } });
      expect(restarted.claim("tenant-a", { actionId: held.id, text: held.text }).state).toBe("unknown");
    } finally {
      restarted.close();
    }
  });

  it("persists transport ambiguity, blocks retry, and reconciles only from an exact provider read", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([{ token: "alpha", tenant: { id: "tenant-a" } }]);
    let approvedCalls = 0;
    let providerText = "Wrong text.";
    let providerCreatedAt = new Date().toISOString();
    let providerAuthorId = "tenant-author";
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body)) as { params: { name: string; arguments: Record<string, unknown> } };
      if (rpc.params.name === "getUsersMe") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ data: { id: "tenant-author", username: "tenant" } }) }] } });
      }
      if (rpc.params.name === "getPostsById") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ data: { id: "1900111222333", text: providerText, author_id: providerAuthorId, created_at: providerCreatedAt } }) }] } });
      }
      if (rpc.params.arguments.callisthenes_approve) {
        approvedCalls += 1;
        throw new TypeError("socket closed after dispatch");
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[draft_not_approved] held" }] } });
    });
    const unit = createCallisthenesUnit({ dataDir, tenantStore, fetcher: fetcher as typeof fetch });
    try {
      const heldText = await textOf(await rpcCall(unit, "alpha", 1, "createPosts", { text: "Ambiguous exact text." }));
      const actionId = heldText.match(/action_id=(act_[a-f0-9]{32})/)?.[1]!;
      const unknown = await textOf(await rpcCall(unit, "alpha", 2, "approve_send", { channel: "x", action_id: actionId, text: "Ambiguous exact text." }));
      expect(unknown).toContain(`[publication_unknown] action_id=${actionId}`);
      const blocked = await textOf(await rpcCall(unit, "alpha", 3, "approve_send", { channel: "x", action_id: actionId, text: "Ambiguous exact text." }));
      expect(blocked).toContain("[publication_unknown]");
      expect(approvedCalls).toBe(1);
      const blockedFreshDraft = await textOf(await rpcCall(unit, "alpha", 31, "createPosts", { text: "Ambiguous exact text." }));
      expect(blockedFreshDraft).toContain(`action_id=${actionId}`);
      expect(unit.observationLedger.read("tenant-a").drafts).toHaveLength(1);

      const mismatch = await textOf(await rpcCall(unit, "alpha", 4, "reconcile_send", {
        channel: "x", action_id: actionId, text: "Ambiguous exact text.", post_id: "1900111222333",
      }));
      expect(mismatch).toContain("Provider reads did not prove an exact post");
      expect(unit.observationLedger.read("tenant-a").drafts[0]).toMatchObject({ status: "unknown" });

      providerText = "Ambiguous exact text.";
      providerAuthorId = "foreign-author";
      const foreignAuthor = await textOf(await rpcCall(unit, "alpha", 44, "reconcile_send", {
        channel: "x", action_id: actionId, text: "Ambiguous exact text.", post_id: "1900111222333",
      }));
      expect(foreignAuthor).toContain("connected account");
      providerAuthorId = "tenant-author";
      providerCreatedAt = "2020-01-01T00:00:00.000Z";
      const oldSameText = await textOf(await rpcCall(unit, "alpha", 45, "reconcile_send", {
        channel: "x", action_id: actionId, text: "Ambiguous exact text.", post_id: "1900111222333",
      }));
      expect(oldSameText).toContain("dispatch window");
      providerCreatedAt = new Date().toISOString();
      const reconciled = await textOf(await rpcCall(unit, "alpha", 5, "reconcile_send", {
        channel: "x", action_id: actionId, text: "Ambiguous exact text.", post_id: "1900111222333",
      }));
      expect(reconciled).toBe("Posted to X. Live URL: https://x.com/i/web/status/1900111222333");
      const replay = await textOf(await rpcCall(unit, "alpha", 6, "approve_send", { channel: "x", action_id: actionId, text: "Ambiguous exact text." }));
      expect(replay).toBe(reconciled);
      const reconciledReplay = await textOf(await rpcCall(unit, "alpha", 7, "reconcile_send", {
        channel: "x", action_id: actionId, text: "Ambiguous exact text.", post_id: "1900111222333",
      }));
      expect(reconciledReplay).toBe(reconciled);
      expect(approvedCalls).toBe(1);

      const laterDraft = await textOf(await rpcCall(unit, "alpha", 8, "createPosts", { text: "Ambiguous exact text." }));
      const laterActionId = laterDraft.match(/action_id=(act_[a-f0-9]{32})/)?.[1]!;
      expect(laterActionId).not.toBe(actionId);
      expect(await textOf(await rpcCall(unit, "alpha", 9, "approve_send", { channel: "x", action_id: laterActionId, text: "Ambiguous exact text." }))).toContain("[publication_unknown]");
      const reusedProviderObject = await textOf(await rpcCall(unit, "alpha", 10, "reconcile_send", {
        channel: "x", action_id: laterActionId, text: "Ambiguous exact text.", post_id: "1900111222333",
      }));
      expect(reusedProviderObject).toContain("[publication_unknown]");
      expect(unit.observationLedger.read("tenant-a").receipts).toHaveLength(1);
    } finally {
      unit.close();
    }
  });

  it("makes a malformed or unverified post response durably unknown without redispatch", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([{ token: "alpha", tenant: { id: "tenant-a" } }]);
    let approvedCalls = 0;
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body)) as { params: { arguments: Record<string, unknown> } };
      if (rpc.params.arguments.callisthenes_approve) {
        approvedCalls += 1;
        return new Response("this is neither JSON nor an MCP SSE event", { status: 200 });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[draft_not_approved] held" }] } });
    });
    const unit = createCallisthenesUnit({ dataDir, tenantStore, fetcher: fetcher as typeof fetch });
    try {
      const heldText = await textOf(await rpcCall(unit, "alpha", 1, "createPosts", { text: "Malformed boundary." }));
      const actionId = heldText.match(/action_id=(act_[a-f0-9]{32})/)?.[1]!;
      expect(await textOf(await rpcCall(unit, "alpha", 2, "approve_send", { channel: "x", action_id: actionId, text: "Malformed boundary." }))).toContain("[publication_unknown]");
      expect(await textOf(await rpcCall(unit, "alpha", 3, "approve_send", { channel: "x", action_id: actionId, text: "Malformed boundary." }))).toContain("[publication_unknown]");
      expect(approvedCalls).toBe(1);
      expect(unit.observationLedger.read("tenant-a").drafts[0]).toMatchObject({ status: "unknown", unknown_reason: expect.stringContaining("unreadable MCP result") });
    } finally {
      unit.close();
    }
  });

  it("defers a proven throttle rejection without marking unknown or immediately redispatching", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([{ token: "alpha", tenant: { id: "tenant-a" } }]);
    let approvedCalls = 0;
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body)) as { params: { arguments: Record<string, unknown> } };
      if (rpc.params.arguments.callisthenes_approve) {
        approvedCalls += 1;
        if (rpc.params.arguments.text === "Guard refusal text.") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[draft_not_approved] approval token rejected before connector" }] } });
        }
        return Response.json({ jsonrpc: "2.0", id: 1, error: { message: "[throttle_exceeded] send rate limit reached" } });
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[draft_not_approved] held" }] } });
    });
    const unit = createCallisthenesUnit({ dataDir, tenantStore, fetcher: fetcher as typeof fetch });
    try {
      const heldText = await textOf(await rpcCall(unit, "alpha", 1, "createPosts", { text: "Deferred exact text." }));
      const actionId = heldText.match(/action_id=(act_[a-f0-9]{32})/)?.[1]!;
      expect(await textOf(await rpcCall(unit, "alpha", 2, "approve_send", { channel: "x", action_id: actionId, text: "Deferred exact text." }))).toContain("[throttle_exceeded]");
      expect(await textOf(await rpcCall(unit, "alpha", 3, "approve_send", { channel: "x", action_id: actionId, text: "Deferred exact text." }))).toContain("Retry only after");
      expect(approvedCalls).toBe(1);
      expect(unit.observationLedger.read("tenant-a")).toMatchObject({
        drafts: [expect.objectContaining({ id: actionId, status: "deferred", retry_at: expect.any(String) })],
        receipts: [],
        usage: expect.objectContaining({ sends: 0, throttled: 1 }),
      });

      const guardHeld = await textOf(await rpcCall(unit, "alpha", 4, "createPosts", { text: "Guard refusal text." }));
      const guardActionId = guardHeld.match(/action_id=(act_[a-f0-9]{32})/)?.[1]!;
      expect(await textOf(await rpcCall(unit, "alpha", 5, "approve_send", { channel: "x", action_id: guardActionId, text: "Guard refusal text." }))).toContain("[draft_not_approved]");
      expect(await textOf(await rpcCall(unit, "alpha", 6, "approve_send", { channel: "x", action_id: guardActionId, text: "Guard refusal text." }))).toContain("[publication_deferred]");
      expect(approvedCalls).toBe(2);
      expect(unit.observationLedger.read("tenant-a").drafts.find((draft) => draft.id === guardActionId)).toMatchObject({ status: "deferred" });
    } finally {
      unit.close();
    }
  });

  it("migrates a legacy receipt-only row once and keeps its exact tenant binding", async () => {
    const dataDir = await tempDir();
    const text = "Legacy exact text.";
    const legacyId = observedContentId("tenant-a", text);
    await writeFile(join(dataDir, "callisthenes-observations.json"), JSON.stringify({
      "tenant-a": {
        drafts: [],
        receipts: [{ id: "receipt-old", draft_id: legacyId, text: "Posted to X. Live URL: https://x.com/i/web/status/123456", url: "https://x.com/i/web/status/123456", created_at: "2026-07-01T00:00:00.000Z" }],
        usage: { calls: 3, sends: 1, rejected_drafts: 1, throttled: 0 },
      },
    }));
    const ledger = new CallisthenesObservationLedger(dataDir);
    try {
      expect(ledger.replayReceipt("tenant-a", { text })?.url).toBe("https://x.com/i/web/status/123456");
      expect(ledger.replayReceipt("tenant-a", { actionId: legacyId, text })?.url).toBe("https://x.com/i/web/status/123456");
      expect(ledger.replayReceipt("tenant-b", { actionId: legacyId, text })).toBeNull();
    } finally {
      ledger.close();
    }
    const reopened = new CallisthenesObservationLedger(dataDir);
    const concurrentPeer = new CallisthenesObservationLedger(dataDir);
    try {
      expect(reopened.read("tenant-a").receipts).toHaveLength(1);
      expect(reopened.read("tenant-a").usage.sends).toBe(1);
      expect(concurrentPeer.read("tenant-a").receipts).toHaveLength(1);
    } finally {
      reopened.close();
      concurrentPeer.close();
    }
  });

  it("serializes schema and legacy migration across concurrent processes", async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, "callisthenes-observations.json"), JSON.stringify({
      "tenant-a": { drafts: [], receipts: [], usage: { calls: 7, sends: 0, rejected_drafts: 0, throttled: 0 } },
    }));
    const moduleUrl = pathToFileURL(join(process.cwd(), "src/callisthenesObservationLedger.ts")).href;
    const startAt = Date.now() + 300;
    const script = `
      import { CallisthenesObservationLedger } from ${JSON.stringify(moduleUrl)};
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, ${startAt} - Date.now())));
      const ledger = new CallisthenesObservationLedger(${JSON.stringify(dataDir)});
      ledger.close();
    `;
    await Promise.all([
      execFileAsync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script]),
      execFileAsync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script]),
    ]);
    const ledger = new CallisthenesObservationLedger(dataDir);
    try {
      expect(ledger.read("tenant-a").usage.calls).toBe(7);
    } finally {
      ledger.close();
    }
  });
});
