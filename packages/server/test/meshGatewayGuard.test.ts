import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the mesh's ONE outbound-to-peer-LLM call. The E-4 guard must prevent this
// from ever firing for a wrong-repo backlog write (the LLM never sees the request).
const { callPeerTool } = vi.hoisted(() => ({
  callPeerTool: vi.fn(async () => ({ content: [{ type: "text", text: "PEER-LLM-REPLY" }] })),
}));
vi.mock("../src/peerClient.js", () => ({ callPeerTool }));

import { buildMeshGatewayServer, guardBacklogWrite } from "../src/meshGateway.js";
import { LIFE_BACKLOG_REPO } from "../src/backlogRouter.js";

const archusPeer = { name: "archus", url: "http://archus.test/mcp", token: "t", repo: LIFE_BACKLOG_REPO };

async function connectGateway() {
  const server = buildMeshGatewayServer((name) => (name === "archus" ? (archusPeer as never) : null));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

describe("mesh-gateway backlog-write guard — S-8 STRUCTURAL, no magic words (C-19)", () => {
  beforeEach(() => callPeerTool.mockClear());
  afterEach(() => vi.clearAllMocks());

  it("an explicit foreign owner/repo#N target is redirected to Epaminon WITHOUT any peer-LLM call", async () => {
    const { client } = await connectGateway();
    const result = await client.callTool({
      name: "create_issue",
      arguments: { message: "Open a duplicate of AlfaBlok/nectary#12 to fix the waitlist signup flow." },
    });
    // Structured foreign target → redirected to the Epaminon lane, LLM never invoked.
    expect(callPeerTool).not.toHaveBeenCalled();
    const text = textOf(result);
    expect(text).toContain("Epaminon");
    expect(text).toContain(LIFE_BACKLOG_REPO);
    expect(text.toLowerCase()).toContain("don't write");
    // C-18: a blocked write is a LOUD error, never a success-shaped ack.
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result as { structuredContent?: Record<string, unknown> }).structuredContent).toMatchObject({ filed: false });
  });

  it("edit/close on an explicit foreign owner/repo#N is redirected WITHOUT any peer-LLM call", async () => {
    const { client } = await connectGateway();
    for (const name of ["edit_issue", "close_issue"]) {
      callPeerTool.mockClear();
      const result = await client.callTool({
        name,
        arguments: { message: "Close AlfaBlok/nectary#42 as won't-fix." },
      });
      expect(callPeerTool).not.toHaveBeenCalled();
      expect(textOf(result)).toContain("Epaminon");
      expect((result as { isError?: boolean }).isError).toBe(true);
    }
  });

  it("C-19: a free-text mention of another product is NOT keyword-blocked — it reaches Archus's semantic brain", async () => {
    const { client } = await connectGateway();
    // No structured owner/repo#N target → the phrasing must NOT gate it. Archus's brain
    // does the semantic central-vs-target-repo routing (and internal Epaminon handoff).
    await client.callTool({
      name: "create_issue",
      arguments: { message: "Open an issue for the nectary waitlist signup flow." },
    });
    expect(callPeerTool).toHaveBeenCalledTimes(1);
    expect(callPeerTool.mock.calls[0]?.[1]).toBe("chat_with_archus");
  });

  it("a genuine life-backlog create DOES reach Archus's brain (guard allows it through)", async () => {
    const { client } = await connectGateway();
    await client.callTool({
      name: "create_issue",
      arguments: { message: "Add a reminder to renew my passport before it expires." },
    });
    // Allowed: exactly one peer-LLM call, to Archus's chat brain.
    expect(callPeerTool).toHaveBeenCalledTimes(1);
    expect(callPeerTool.mock.calls[0]?.[1]).toBe("chat_with_archus");
  });

  it("the front door demands a receipt-or-error reply (no silent ack) via the intent directive", async () => {
    const { client } = await connectGateway();
    await client.callTool({
      name: "create_issue",
      arguments: { message: "File a ticket to review my finances." },
    });
    const forwarded = String(callPeerTool.mock.calls[0]?.[2]?.message ?? "");
    expect(forwarded.toLowerCase()).toContain("read-back verified");
    expect(forwarded.toLowerCase()).toContain("explicit error");
    expect(forwarded.toLowerCase()).toContain("epaminon internally");
  });

  it("only ONE advertised backlog-write door exists (archus.request_backlog_action removed)", async () => {
    const { client } = await connectGateway();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("archus.request_backlog_action");
    expect(names).toContain("create_issue");
  });

  it("ask_archus (a judgment/read, not a raw write) is NOT guarded", async () => {
    const { client } = await connectGateway();
    await client.callTool({
      name: "ask_archus",
      arguments: { message: "Summarize what's open in nectary and the life backlog." },
    });
    // No backlogWriteGuard on ask_archus → it reaches the brain normally.
    expect(callPeerTool).toHaveBeenCalledTimes(1);
  });
});

describe("guardBacklogWrite — STRUCTURAL decision, no phrasing regex (C-19)", () => {
  it("returns a loud error (non-null) for an explicit foreign owner/repo#N target", () => {
    const blocked = guardBacklogWrite("open a dup of AlfaBlok/nectary#5 for the claims bug");
    expect(blocked).not.toBeNull();
    expect(blocked?.isError).toBe(true);
    expect(blocked?.structuredContent).toMatchObject({ filed: false });
  });
  it("returns null (allow → semantic routing) for a plain life-backlog filing", () => {
    expect(guardBacklogWrite("remind me to call the dentist")).toBeNull();
  });
  it("C-19: does NOT block a free-text product mention lacking a structured target", () => {
    // 'nectary'/'waitlist' phrasing alone must not gate the write — Archus routes it.
    expect(guardBacklogWrite("open an issue for the nectary waitlist signup flow")).toBeNull();
  });
  it("blocks an explicit foreign owner/repo#N even with an edit verb", () => {
    expect(guardBacklogWrite("retitle zenod-ai/zenod#10 to something clearer")).not.toBeNull();
  });
  it("allows an explicit life-backlog owner/repo#N target", () => {
    expect(guardBacklogWrite(`comment on ${LIFE_BACKLOG_REPO}#7 that this is done`)).toBeNull();
  });
});
