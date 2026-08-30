import { describe, expect, it, vi } from "vitest";

const captured: { config?: any } = {};
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateText: (config: any) => {
      captured.config = config;
      return Promise.resolve({ text: "answer", totalUsage: {}, providerMetadata: {} });
    },
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";
import type { VaultTaskTools } from "../src/llm/types.js";

const readTools = {
  searchVault: async () => "no hits",
  readNote: async () => "note",
  listPages: async () => "pages",
};

function taskTools(githubAvailable: boolean): VaultTaskTools {
  const unavailable = async () => "not called";
  return {
    githubAvailable,
    captureNote: async () => ({ evidenceRef: "Log/x.md#^e-1", pagesTouched: [], filing: "filed" }),
    proposeTask: unavailable,
    executeTask: unavailable,
    digestBacklog: async () => ({ candidates: [], written: [], skipped: [], source_refs: [] }),
    createIssue: unavailable,
    labelIssue: unavailable,
    editIssue: unavailable,
    closeIssue: unavailable,
    queueExecution: unavailable,
    approveExecution: unavailable,
    queryBacklog: unavailable,
    serviceBacklog: unavailable,
    approveQueue: unavailable,
    approveMerge: unavailable,
  };
}

describe("GitHub capability projection", () => {
  it("keeps local Markdown backlog and vault tools while omitting every GitHub-only tool", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });
    await llm.answer(
      { question: "digest this locally", vaultBriefing: "brief", conversation: [] },
      readTools,
      taskTools(false),
    );

    expect(captured.config.tools).toEqual(expect.objectContaining({
      capture_note: expect.anything(),
      digest_backlog: expect.anything(),
      propose_vault_task: expect.anything(),
      execute_vault_task: expect.anything(),
    }));
    for (const name of [
      "create_issue", "label_issue", "edit_issue", "close_issue",
      "queue_execution", "approve_execution", "approve_queue", "approve_merge",
      "query_backlog", "service_backlog",
    ]) {
      expect(captured.config.tools).not.toHaveProperty(name);
    }
    expect(captured.config.messages[0].content).toContain("Memory does not require GitHub");
  });

  it("preserves the existing GitHub catalog when the connection is available", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });
    await llm.answer(
      { question: "open an issue", vaultBriefing: "brief", conversation: [] },
      readTools,
      taskTools(true),
    );

    expect(captured.config.tools).toEqual(expect.objectContaining({
      digest_backlog: expect.anything(),
      create_issue: expect.anything(),
      edit_issue: expect.anything(),
      query_backlog: expect.anything(),
      queue_execution: expect.anything(),
    }));
  });
});
