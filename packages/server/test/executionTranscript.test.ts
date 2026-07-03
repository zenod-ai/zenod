import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRecentEvents, transcriptObjectKey, transcriptPath } from "../src/executionTranscript.js";
import { TranscriptStore } from "../src/transcriptStore.js";

describe("renderRecentEvents", () => {
  it("renders codex item.* tool labels, newest last", () => {
    const raw = [
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "ls -la" } }),
      JSON.stringify({ type: "item.completed", item: { type: "function_call", name: "apply_patch" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "  done  now " } }),
    ].join("\n");
    expect(renderRecentEvents(raw)).toEqual(["ls -la", "apply_patch", "said: done now"]);
  });

  it("renders claude stream-json tool_use + text blocks", () => {
    const raw = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking about it" }] } }),
    ].join("\n");
    expect(renderRecentEvents(raw)).toEqual(["Read", "said: thinking about it"]);
  });

  it("keeps only the last N and skips blank/unparseable lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      JSON.stringify({ type: "tool_call", name: `tool${i}` }),
    );
    const raw = ["", "not json", ...lines, "   "].join("\n");
    const out = renderRecentEvents(raw, 3);
    expect(out).toEqual(["tool17", "tool18", "tool19"]);
  });

  it("returns [] for empty/missing input and a stream with no signal", () => {
    expect(renderRecentEvents("")).toEqual([]);
    expect(renderRecentEvents(null)).toEqual([]);
    expect(renderRecentEvents(JSON.stringify({ type: "" }))).toEqual([]);
  });

  it("labels an engine fallback event", () => {
    const raw = JSON.stringify({ type: "engine.fallback", from: "codex", to: "claude" });
    expect(renderRecentEvents(raw)).toEqual(["engine fallback codex→claude"]);
  });
});

describe("transcript keys/paths", () => {
  it("sanitises the object key and encodes the path", () => {
    expect(transcriptObjectKey("ephemeral-123_ab")).toBe("ephemeral-123_ab.jsonl");
    expect(transcriptObjectKey("weird/../id")).toBe("weird_.._id.jsonl");
    expect(transcriptPath("direct-9")).toBe("/api/exec/transcript/direct-9");
  });
});

describe("TranscriptStore", () => {
  it("persists, retrieves, and renders last-N events; survives a fresh store on the same dir (deploy)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "transcript-"));
    try {
      const raw = [
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test" } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }),
      ].join("\n");
      const store = new TranscriptStore(dir);
      expect(store.has("run-1")).toBe(false);
      expect(store.get("run-1")).toBeNull();
      store.put("run-1", raw);
      expect(store.has("run-1")).toBe(true);
      expect(store.get("run-1")).toBe(raw);
      expect(store.size("run-1")).toBe(Buffer.byteLength(raw));
      expect(store.recentEvents("run-1", 1)).toEqual(["Edit"]);

      // A redeploy = a brand-new process/store pointed at the same durable dir.
      const afterDeploy = new TranscriptStore(dir);
      expect(afterDeploy.get("run-1")).toBe(raw);
      expect(afterDeploy.recentEvents("run-1")).toEqual(["npm test", "Edit"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an empty execution id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "transcript-"));
    try {
      const store = new TranscriptStore(dir);
      expect(() => store.put("", "x")).toThrow(/executionId/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
