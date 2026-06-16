import { describe, it, expect } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { AnswerInput, AnswerResult, BrainLlm, VaultReadTools, VaultTaskTools } from "../src/llm/types.js";

/**
 * The spike (#154): prove the engine boots and CHATS with NO vault — the Console
 * shell = the base minus the vault capability. A minimal LLM stub captures what the
 * loop hands it so we can assert the vaultless contract.
 */
class StubLlm {
  lastInput?: AnswerInput;
  lastReadTools?: VaultReadTools;
  lastTaskTools?: VaultTaskTools;
  async answer(input: AnswerInput, tools: VaultReadTools, taskTools?: VaultTaskTools): Promise<AnswerResult> {
    this.lastInput = input;
    this.lastReadTools = tools;
    this.lastTaskTools = taskTools;
    return { text: "hello from the console", readPaths: [] };
  }
}

function vaultlessEngine() {
  const llm = new StubLlm();
  const engine = createEngine({ llm: llm as unknown as BrainLlm, state: new SqliteStateStore(":memory:") });
  return { engine, llm };
}

describe("engine — vaultless (Console shell)", () => {
  it("constructs and chats with no vault", async () => {
    const { engine, llm } = vaultlessEngine();
    const reply = await engine.chat("hi there", "web");
    expect(reply.text).toBe("hello from the console");
    expect(reply.sources).toEqual([]);
    // Persona-only briefing — no vault TOOL CONTRACT, no vault maps.
    expect(llm.lastInput?.vaultBriefing).not.toMatch(/TOOL CONTRACT/);
    // No task tools wired (capture/propose would write to the vault).
    expect(llm.lastTaskTools).toBeUndefined();
  });

  it("registers the vault read tools but they report no vault (so a model tool-call never crashes)", async () => {
    const { engine, llm } = vaultlessEngine();
    await engine.chat("hi", "web");
    const tools = llm.lastReadTools!;
    expect(await tools.searchVault("anything")).toBe("No vault is configured on this agent.");
    expect(await tools.readNote("Notes/x.md")).toBe("No vault is configured on this agent.");
    expect(await tools.listPages()).toBe("No vault is configured on this agent.");
    // searchChats is state-backed, not vault-backed — it still works (empty here).
    expect(await tools.searchChats("anything")).toBe("no results");
  });

  it("gates the vault-only methods with a clear error", async () => {
    const { engine } = vaultlessEngine();
    await expect(engine.ask("what do I know?")).rejects.toThrow(/no vault/i);
    await expect(engine.store({ content: "x", source: "web" })).rejects.toThrow(/no vault/i);
    await expect(engine.search("x")).rejects.toThrow(/no vault/i);
    await expect(engine.get("Notes/x.md")).rejects.toThrow(/no vault/i);
    await expect(engine.lint()).rejects.toThrow(/no vault/i);
  });
});
