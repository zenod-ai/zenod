import { describe, it, expect } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { AnswerInput, AnswerResult, BrainLlm, PeerTools, VaultReadTools, VaultTaskTools } from "../src/llm/types.js";

/**
 * The spike (#154): prove the engine boots and CHATS with NO vault — the Console
 * shell = the base minus the vault capability. A minimal LLM stub captures what the
 * loop hands it so we can assert the vaultless contract.
 */
class StubLlm {
  lastInput?: AnswerInput;
  lastReadTools?: VaultReadTools;
  lastTaskTools?: VaultTaskTools;
  lastPeerTools?: PeerTools;
  async answer(
    input: AnswerInput,
    tools: VaultReadTools,
    taskTools?: VaultTaskTools,
    _driveTools?: unknown,
    peerTools?: PeerTools,
  ): Promise<AnswerResult> {
    this.lastInput = input;
    this.lastReadTools = tools;
    this.lastTaskTools = taskTools;
    this.lastPeerTools = peerTools;
    return { text: "hello from the console", readPaths: [] };
  }
}

function vaultlessEngine(peerTools?: PeerTools) {
  const llm = new StubLlm();
  const engine = createEngine({
    llm: llm as unknown as BrainLlm,
    state: new SqliteStateStore(":memory:"),
    ...(peerTools ? { peerTools } : {}),
  });
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

  it("omits the vault read tools entirely (so the loop never advertises them) but keeps searchChats", async () => {
    const { engine, llm } = vaultlessEngine();
    await engine.chat("hi", "web");
    const tools = llm.lastReadTools!;
    expect(tools.searchVault).toBeUndefined();
    expect(tools.readNote).toBeUndefined();
    expect(tools.listPages).toBeUndefined();
    // searchChats is state-backed, not vault-backed — it still works (empty here).
    expect(await tools.searchChats("anything")).toBe("no results");
  });

  it("exposes configured peer tools to the chat loop (the mesh) and they run", async () => {
    let asked = "";
    const { engine, llm } = vaultlessEngine({
      ask_zenod: {
        description: "ask the memory agent",
        run: async (input: string) => {
          asked = input;
          return "Per Zenod: your Axa policy ends March 2027.";
        },
      },
    });
    await engine.chat("what does my insurance say?", "web");
    expect(llm.lastPeerTools).toBeDefined();
    expect(Object.keys(llm.lastPeerTools!)).toEqual(["ask_zenod"]);
    // the peer tool actually delegates
    const result = await llm.lastPeerTools!.ask_zenod.run("insurance renewal?");
    expect(asked).toBe("insurance renewal?");
    expect(result).toMatch(/Axa policy ends March 2027/);
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
