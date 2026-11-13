import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrainLlm, dropThinkingAfterEdit, trimToolResults } from "../src/llm/aisdk.js";
import type { LlmUsageReport } from "../src/llm/aisdk.js";

// T7-F10, production 3cba2ec5 (T7-F9 live check, 13 Nov 2026 12:07Z and 12:09Z): "Which rehearsal birds did I
// save?" failed twice with a 500 and no reply. Its fourth round offered only submit_memory_answer while it
// re-sent the thinking blocks of rounds 1 to 3, and Claude Sonnet 5.5 refused it: "Invalid signature in thinking
// block ... The tools list differs from the one this block was created with" (kind=tools_changed, 400). The three
// rounds that ran (about $0.03 each, paid at Anthropic) left no usage line.

const id = "as_0123456789abcdef01234567";
afterEach(() => vi.unstubAllGlobals());

type Reply = { calls?: Array<{ name: string; input: unknown }>; text?: string; fail?: boolean };

/**
 * The Anthropic Messages wire with preserved thinking: every reply carries a thinking block whose signature
 * records the tools list it was made under, and a request that replays a block under a different tools list
 * is refused the way production was.
 */
function anthropicWire(replies: Reply[]) {
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    const toolsList = JSON.stringify((body.tools ?? []).map((tool: any) => tool.name));
    const replayed = body.messages.flatMap((message: any) => message.role === "assistant" && Array.isArray(message.content) ? message.content : [])
      .filter((block: any) => block.type === "thinking");
    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("Unexpected extra model completion");
    if (reply.fail || replayed.some((block: any) => block.signature !== `sig:${toolsList}`)) {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages.1.content.0: Invalid signature in thinking block. The tools list differs from the one this block was created with." } }),
        { status: 400, headers: { "content-type": "application/json", "x-should-retry": "false" } });
    }
    const content = [
      { type: "thinking", thinking: "", signature: `sig:${toolsList}` },
      ...(reply.text ? [{ type: "text", text: reply.text }] : []),
      ...(reply.calls ?? []).map((call, index) => ({ type: "tool_use", id: `toolu_${requests.length}_${index}`, name: call.name, input: call.input })),
    ];
    return new Response(JSON.stringify({
      id: `msg_${requests.length}`, type: "message", role: "assistant", model: body.model, content,
      stop_reason: reply.calls ? "tool_use" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 9_000 + 3_000 * requests.length, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }), { headers: { "content-type": "application/json" } });
  }));
  return requests;
}

const note = (path: string) => JSON.stringify({ path, answerSupports: [{ id, modes: ["current"] }], body: `${path}: heron, egret` });
const tools = { searchChats: async () => "none", readFacts: async (input: { path: string }) => note(input.path) };
const read = (path: string) => ({ name: "read_facts", input: { path } });
const submit = { name: "submit_memory_answer", input: { analysisText: null, supportSelections: [{ id, mode: "current", summaryText: null }] } };
const birds = { question: "Which rehearsal birds did I save?", vaultBriefing: "brief", conversation: [], answerSupportContract: "v1" as const };

function sonnet(maxSteps: number, usage: LlmUsageReport[] = []) {
  return createBrainLlm({ provider: "anthropic", apiKey: "sk-ant-test", askModel: "claude-sonnet-5-5", maxSteps, onUsage: (report) => usage.push(report) });
}

describe("T7-F10: an answer that needs a fourth round on Claude Sonnet 5.5", () => {
  it("sends the same tools list every round, so earlier thinking stays valid, and answers", async () => {
    const usage: LlmUsageReport[] = [];
    const requests = anthropicWire([{ calls: [read("Notes/Birds.md")] }, { calls: [read("Log/2026-11-12.md")] }, { calls: [read("Notes/Rehearsal.md")] }, { calls: [submit] }]);
    // main: the tools list changes between rounds (round 1 lacks submit_memory_answer, round 4 offers only it)
    // while earlier thinking is replayed, so the request is refused with the 400 above.
    const result = await sonnet(4, usage).answer(birds, tools);
    expect(requests).toHaveLength(4);
    const lists = requests.map((body) => JSON.stringify(body.tools.map((tool: any) => tool.name)));
    expect(new Set(lists).size).toBe(1);
    expect(lists[0]).toContain("submit_memory_answer");
    expect(result.supportSelections).toEqual([{ id, mode: "current" }]);
    expect(usage.filter((report) => report.operation === "answer")).toEqual([expect.objectContaining({ status: "succeeded", inputTokens: 12_000 + 15_000 + 18_000 + 21_000 })]);
  });

  it("refuses a tool the round does not allow on our side instead of removing it from the list", async () => {
    // The final round allows only submission; a read there gets an error result, never a new tools list.
    const requests = anthropicWire([{ calls: [read("Notes/Birds.md")] }, { calls: [read("Notes/Rehearsal.md")] }]);
    const result = await sonnet(2, []).answer(birds, tools);
    expect(new Set(requests.map((body) => JSON.stringify(body.tools.map((tool: any) => tool.name)))).size).toBe(1);
    expect(result.supportProtocolError).toBe("missing_submission");
  });

  it("writes a usage line for the paid rounds of a failed answer, marked failed so the tester is not charged", async () => {
    const usage: LlmUsageReport[] = [];
    anthropicWire([{ calls: [read("Notes/Birds.md")] }, { calls: [read("Log/2026-11-12.md")] }, { fail: true }]);
    await expect(sonnet(8, usage).answer(birds, tools)).rejects.toThrow(/Invalid signature/);
    // main: no line at all, so production's ~$0.03 a round appeared in no usage record.
    expect(usage.filter((report) => report.operation === "answer")).toEqual([
      expect.objectContaining({ status: "failed", errorCode: "answer_round_failed", inputTokens: 12_000 + 15_000, outputTokens: 400 }),
    ]);
  });

  it("drops thinking only after a message the per-round trim rewrote", () => {
    const thinking = { type: "reasoning" as const, text: "", providerOptions: { anthropic: { signature: "sig" } } };
    const call = (n: number) => ({ type: "tool-call" as const, toolCallId: `t${n}`, toolName: "read_facts", input: {} });
    const result = (n: number, value: string) => ({ role: "tool" as const, content: [{ type: "tool-result" as const, toolCallId: `t${n}`, toolName: "read_facts", output: { type: "text" as const, value } }] });
    const history = [
      { role: "user" as const, content: "Which rehearsal birds did I save?" },
      { role: "assistant" as const, content: [thinking, call(1)] },
      result(1, "small"),
      { role: "assistant" as const, content: [thinking, call(2)] },
      result(2, "x".repeat(40_000)),
      { role: "assistant" as const, content: [thinking, call(3)] },
      result(3, "small"),
    ];
    const trimmed = dropThinkingAfterEdit(history, trimToolResults(history, 20_000));
    const kinds = trimmed.filter((message) => message.role === "assistant").map((message) => (message.content as Array<{ type: string }>).map((part) => part.type));
    // Blocks made before the rewritten result keep verifying; the one after it would not, so it is left out.
    expect(kinds).toEqual([["reasoning", "tool-call"], ["reasoning", "tool-call"], ["tool-call"]]);
    expect(dropThinkingAfterEdit(history, [...history])).toEqual(history);
  });
});
