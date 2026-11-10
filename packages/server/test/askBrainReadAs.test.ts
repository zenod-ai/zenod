import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { buildMcpServer } from "../src/mcp.js";
import type { ReadAs } from "../src/quickIndexRead.js";

// EPIC-14 S29: ask_brain, for the AI apps a person connects, reads the quick index first and says how.
const FLAT: ReadAs = { phrase: "the flat", path: "Projects/Move.md", title: "Moving to Valencia", lineage: ["Moving to Valencia"], by: "name" };

async function ask(readAsFor?: (question: string) => Promise<ReadAs[]>) {
  const asked: string[] = [];
  const engine = { ask: async (question: string) => { asked.push(question); return { text: "Free until the 20th.", sources: [] }; } } as unknown as BrainEngine;
  const server = buildMcpServer(async () => engine, ...(Array(20).fill(undefined) as []), readAsFor);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "s29-test", version: "1" });
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name: "ask_brain", arguments: { question: "any news on the flat?" } });
    return { asked, text: (result.content as Array<{ text: string }>)[0]!.text, structured: result.structuredContent as Record<string, unknown> };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("ask_brain reads the quick index (E14-S29)", () => {
  it("leads with a Read as line, tells the answer what the words mean and returns the readings", async () => {
    const { asked, text, structured } = await ask(async () => [FLAT]);
    expect(text.startsWith("Read as: \"the flat\" → Moving to Valencia\n\n")).toBe(true);
    expect(asked[0]).toContain("\"the flat\" means Moving to Valencia");
    expect(structured.readAs).toEqual([FLAT]);
  });

  it("without a reader, or with nothing to read, the answer is as before", async () => {
    for (const reader of [undefined, async () => [] as ReadAs[]]) {
      const { asked, text, structured } = await ask(reader);
      expect(asked[0]).toBe("any news on the flat?");
      expect(text.startsWith("Free until the 20th.")).toBe(true);
      expect(structured.readAs).toBeUndefined();
    }
  });
});
