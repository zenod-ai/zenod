import { describe, expect, it, vi } from "vitest";

// Z-9 · a synthesized answer must never come back source-less. When the model
// answers from search hits without opening a note, sources fall back to the hits
// it saw; when it reads notes in full, those precise paths are the sources.
const behavior: { readNote: boolean } = { readNote: false };
const captured: { system?: string } = {};

vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateText: async (config: any) => {
      captured.system = config.messages?.[0]?.content as string;
      // Simulate the model: search once, optionally read, then answer.
      if (config.tools?.search_vault) await config.tools.search_vault.execute({ query: "marigold" });
      if (behavior.readNote && config.tools?.read_note)
        await config.tools.read_note.execute({ path: "Projects/Marigold.md" });
      return { text: "The codename is Marigold.", totalUsage: {}, providerMetadata: {} };
    },
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";

const readTools = {
  searchVault: async () =>
    "Projects/Marigold.md (score 12.5) — codename Marigold\nLog/2026-07-07-note.md (score 8.0) — raw evidence",
  readNote: async () => "--- frontmatter: {}\nThe codename is Marigold, owner Jordi.",
  listPages: async () => "pages",
};

describe("Z-9 · ask/answer always cites structured sources", () => {
  it("returns non-empty sources from the search hits when no note was opened", async () => {
    behavior.readNote = false;
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const res = await llm.answer(
      { question: "what is the launch codename?", vaultBriefing: "brief", conversation: [] },
      readTools,
    );
    expect(res.readPaths.length).toBeGreaterThan(0);
    expect(res.readPaths).toContain("Projects/Marigold.md");
    // the Log/ evidence hit is carried too, so a compose-dropped fact stays citable
    expect(res.readPaths).toContain("Log/2026-07-07-note.md");
  });

  it("prefers the notes actually read in full over the search fallback", async () => {
    behavior.readNote = true;
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const res = await llm.answer(
      { question: "what is the launch codename?", vaultBriefing: "brief", conversation: [] },
      readTools,
    );
    expect(res.readPaths).toEqual(["Projects/Marigold.md"]);
  });

  it("instructs the model to open the top hit / Log evidence before answering", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer({ question: "q", vaultBriefing: "brief", conversation: [] }, readTools);
    expect(captured.system).toContain("GROUNDING");
    expect(captured.system).toContain("read_note");
    expect(captured.system).toContain("Log/");
  });

  it("stays source-less honestly when the vault has no hits", async () => {
    behavior.readNote = false;
    const emptyTools = { ...readTools, searchVault: async () => "no results" };
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const res = await llm.answer(
      { question: "unknown thing", vaultBriefing: "brief", conversation: [] },
      emptyTools,
    );
    expect(res.readPaths).toEqual([]);
  });
});
