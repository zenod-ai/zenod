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

describe("mesh-gateway backlog-write guard — E4-T2 is STRUCTURAL (pre-LLM)", () => {
  beforeEach(() => callPeerTool.mockClear());
  afterEach(() => vi.clearAllMocks());

  it("D4: a create aimed at the nectary repo is redirected WITHOUT any peer-LLM call", async () => {
    const { client } = await connectGateway();
    const result = await client.callTool({
      name: "create_issue",
      arguments: { message: "Open an issue in nectary to fix the waitlist signup flow." },
    });
    // The load-bearing assertion: Archus's LLM was NEVER invoked for the wrong-repo write.
    expect(callPeerTool).not.toHaveBeenCalled();
    const text = textOf(result);
    expect(text).toContain("Epaminon");
    expect(text).toContain(LIFE_BACKLOG_REPO);
    expect(text.toLowerCase()).toContain("don't write");
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
    }
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

describe("guardBacklogWrite — pure decision", () => {
  it("returns a redirect (non-null) for a non-backlog repo write", () => {
    expect(guardBacklogWrite("open an issue in nectary for the claims bug")).not.toBeNull();
  });
  it("returns null (allow) for a plain life-backlog filing", () => {
    expect(guardBacklogWrite("remind me to call the dentist")).toBeNull();
  });
  it("blocks an explicit foreign owner/repo#N even with an edit verb", () => {
    expect(guardBacklogWrite("retitle zenod-ai/zenod#10 to something clearer")).not.toBeNull();
  });
  it("allows an explicit life-backlog owner/repo#N target", () => {
    expect(guardBacklogWrite(`comment on ${LIFE_BACKLOG_REPO}#7 that this is done`)).toBeNull();
  });
});
