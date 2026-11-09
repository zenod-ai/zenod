import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerCancelledError, answerCancelReason, type AskOptions, type BrainEngine } from "zenod";
import { askBrainTimeoutMs, ASK_BRAIN_TIMEOUT_MS, buildMcpServer } from "../src/mcp.js";

// E15-Q4: ask_brain stops at its time limit, or when the caller hangs up, instead of letting the
// model loop run (and bill) for an answer nobody will read.
function slowEngine() {
  const seen: { signal?: AbortSignal; reason?: string } = {};
  const engine = {
    async ask(_question: string, options: AskOptions = {}) {
      seen.signal = options.signal;
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) return resolve();
        options.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      seen.reason = answerCancelReason(options.signal);
      throw new AnswerCancelledError(answerCancelReason(options.signal));
    },
  } as unknown as BrainEngine;
  return { engine, seen };
}

async function connect(engine: BrainEngine) {
  const server = buildMcpServer(async () => engine);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "q4-test", version: "1" });
  await client.connect(clientSide);
  return { client, server };
}

const previous = process.env.ZENOD_ASK_BRAIN_TIMEOUT_MS;
afterEach(() => {
  if (previous === undefined) delete process.env.ZENOD_ASK_BRAIN_TIMEOUT_MS;
  else process.env.ZENOD_ASK_BRAIN_TIMEOUT_MS = previous;
});

describe("ask_brain time limit and hang-up (E15-Q4)", () => {
  it("defaults under the 60 s many MCP clients wait, and accepts an override within bounds", () => {
    expect(ASK_BRAIN_TIMEOUT_MS).toBeLessThan(60_000);
    expect(askBrainTimeoutMs({})).toBe(ASK_BRAIN_TIMEOUT_MS);
    expect(askBrainTimeoutMs({ ZENOD_ASK_BRAIN_TIMEOUT_MS: "20000" })).toBe(20_000);
    expect(askBrainTimeoutMs({ ZENOD_ASK_BRAIN_TIMEOUT_MS: "5" })).toBe(ASK_BRAIN_TIMEOUT_MS);
    expect(askBrainTimeoutMs({ ZENOD_ASK_BRAIN_TIMEOUT_MS: "nope" })).toBe(ASK_BRAIN_TIMEOUT_MS);
  });

  it("stops the answer at the limit and says so honestly", async () => {
    process.env.ZENOD_ASK_BRAIN_TIMEOUT_MS = "1000";
    const { engine, seen } = slowEngine();
    const { client, server } = await connect(engine);
    try {
      const started = Date.now();
      const result = await client.callTool({ name: "ask_brain", arguments: { question: "what did I say about the boat?" } });
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(seen.signal?.aborted).toBe(true);
      expect(seen.reason).toBe("timeout");
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: "ask_timeout" });
      expect(JSON.stringify(result.content)).toContain("stopped after 1 seconds");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("stops the answer when the caller cancels its request", async () => {
    const { engine, seen } = slowEngine();
    const { client, server } = await connect(engine);
    try {
      const hangUp = new AbortController();
      const call = client.callTool({ name: "ask_brain", arguments: { question: "q" } }, undefined, { signal: hangUp.signal });
      while (!seen.signal) await new Promise((r) => setTimeout(r, 5));
      hangUp.abort();
      await expect(call).rejects.toThrow();
      for (let i = 0; i < 100 && !seen.reason; i++) await new Promise((r) => setTimeout(r, 10));
      expect(seen.signal.aborted).toBe(true);
      expect(seen.reason).toBe("caller");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
