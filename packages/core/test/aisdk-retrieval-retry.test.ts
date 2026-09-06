import { describe, expect, it, vi } from "vitest";

const captured: { config?: any } = {};
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateText: async (config: any) => {
      captured.config = config;
      return { text: "answer", totalUsage: {}, providerMetadata: {} };
    },
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";

describe("ask_brain deterministic retrieval retry", () => {
  it("exposes and forwards bounded read options to the real answer tool seam", async () => {
    const readNote = vi.fn(async () => '{"body":"late fact","nextCursor":"next","truncated":true}');
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer({ question: "late fact?", vaultBriefing: "brief", conversation: [] }, {
      searchVault: async () => "hits", readNote, listPages: async () => "pages", searchChats: async () => "none",
    });
    const args = { path: "Log/2026-01-01.md#^e-000001", query: "late fact", maxChars: 512 };
    await captured.config.tools.read_note.execute(args);
    expect(readNote).toHaveBeenCalledWith(args.path, { query: "late fact", maxChars: 512 });
    await captured.config.tools.read_note.execute({ path: args.path, cursor: "next" });
    expect(readNote).toHaveBeenLastCalledWith(args.path, { cursor: "next" });
    expect(captured.config.tools.read_note.description).toContain("not proof of absence");
  });

  it("retries a missed human narrow search with the extracted project name", async () => {
    const queries: string[] = [];
    const reads: Array<{ query: string; result: string }> = [];
    const tools = {
      searchVault: async (query: string) => {
        queries.push(query);
        return query === "Aurora Kestrel"
          ? "Log/2026-07-11.md (score 20) — Aurora Kestrel uses LumenCell 42 batteries and is serviced every 14 days"
          : "no results";
      },
      readNote: async () => "note",
      listPages: async () => "pages",
      searchChats: async () => "no results",
    };
    const llm = createBrainLlm({
      provider: "anthropic",
      apiKey: "k",
      maxSteps: 5,
    });
    await llm.answer(
      {
        question:
          "How often should we service the Aurora Kestrel sensors, and what battery powers them?",
        vaultBriefing: "brief",
        conversation: [],
        onReadAction: (_tool, input, output) =>
          reads.push({ query: String(input.query), result: output }),
      },
      tools,
    );

    const output = await captured.config.tools.search_vault.execute({
      query:
        "how often are the sensors recalibrated and what battery powers them",
    });

    expect(queries).toEqual([
      "how often are the sensors recalibrated and what battery powers them",
      "Aurora Kestrel",
    ]);
    expect(output).toContain("Deterministic retry");
    expect(output).toContain("LumenCell 42");
    expect(reads).toHaveLength(2);
    expect(captured.config.messages[0].content).toContain("SYNTHETIC EVIDENCE");
    expect(captured.config.messages[0].content).toContain(
      "does NOT mean the evidence is absent",
    );
    expect(captured.config.messages[0].content).toContain(
      "clearly label the answer synthetic",
    );
  });

  it("retries once and remains source-less when an attribute is truly unknown", async () => {
    const queries: string[] = [];
    const tools = {
      searchVault: async (query: string) => {
        queries.push(query);
        return "no results";
      },
      readNote: async () => "note",
      listPages: async () => "pages",
      searchChats: async () => "no results",
    };
    const llm = createBrainLlm({
      provider: "anthropic",
      apiKey: "k",
      maxSteps: 2,
    });
    await llm.answer(
      {
        question:
          "For synthetic marker ZNMT-I1-20260711-A-L3 exactly, what is the coordinator's favorite dessert?",
        vaultBriefing: "brief",
        conversation: [],
      },
      tools,
    );

    const output = await captured.config.tools.search_vault.execute({
      query: "favorite dessert for the coordinator",
    });

    expect(queries).toEqual([
      "favorite dessert for the coordinator",
      "ZNMT-I1-20260711-A-L3",
    ]);
    expect(output.match(/no results/g)).toHaveLength(2);
    expect(captured.config.messages[0].content).toContain(
      "Attributes not present in that evidence remain unknown",
    );
    expect(captured.config.stopWhen).toBeDefined();
  });

  it("does not retry a search whose result contains the question identifier", async () => {
    const queries: string[] = [];
    const tools = {
      searchVault: async (query: string) => {
        queries.push(query);
        return "Projects/Aurora.md (score 12) — Aurora Kestrel overview";
      },
      readNote: async () => "note",
      listPages: async () => "pages",
      searchChats: async () => "no results",
    };
    const llm = createBrainLlm({
      provider: "anthropic",
      apiKey: "k",
      maxSteps: 5,
    });
    await llm.answer(
      {
        question: "What do you know about Aurora Kestrel?",
        vaultBriefing: "brief",
        conversation: [],
      },
      tools,
    );

    await captured.config.tools.search_vault.execute({
      query: "Aurora Kestrel",
    });
    expect(queries).toEqual(["Aurora Kestrel"]);
  });
});

it("registers the typed read-only catalog with all filters and records successful actions", async () => {
  const searchEntries = vi.fn(async () => '{"entries":[],"pagination":{"hasMore":false}}');
  const onReadAction = vi.fn();
  const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
  await llm.answer({ question: "Audit all my voice notes in January", vaultBriefing: "brief", conversation: [], onReadAction }, {
    searchVault: async () => "none", readNote: async () => "none", listPages: async () => "none", searchChats: async () => "none", searchEntries,
  });
  const args = { query: "ORCHID amber", source: "whatsapp", sourceId: "original-1", contentType: "voice_note",
    capturedAfter: "2026-01-01", capturedBefore: "2026-01-31T23:59:59.999Z", order: "oldest", limit: 2, cursor: "signed", exhaustive: true };
  expect(captured.config.tools.search_entries.inputSchema.parse(args)).toEqual(args);
  await captured.config.tools.search_entries.execute(args);
  expect(searchEntries).toHaveBeenCalledWith(args);
  expect(onReadAction).toHaveBeenCalledWith("search_entries", args, expect.stringContaining("pagination"));
  expect(captured.config.messages[0].content).toContain("Set exhaustive=true");
});

it("does not record failed note reads as successful source actions", async () => {
  const onReadAction = vi.fn();
  const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
  await llm.answer({ question: "q", vaultBriefing: "brief", conversation: [], onReadAction }, {
    searchVault: async () => "none", readNote: async () => { throw new Error("unavailable"); }, listPages: async () => "none", searchChats: async () => "none",
  });
  await expect(captured.config.tools.read_note.execute({ path: "Log/missing.md" })).rejects.toThrow("unavailable");
  expect(onReadAction).not.toHaveBeenCalled();
});
