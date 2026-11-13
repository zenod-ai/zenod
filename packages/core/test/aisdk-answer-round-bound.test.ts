import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrainLlm } from "../src/llm/aisdk.js";
import type { LlmUsageReport } from "../src/llm/aisdk.js";

// T7-F9, production b5234d29 (E7-S4, 13 Nov 2026): "Which rehearsal birds did I save?" read 118,419 input
// tokens over 231 s, ended on "The model did not submit a valid memory-answer selection" and was charged
// $0.1647. T7-F7's check assumed each round no bigger than the last; a round that read a large tool result
// broke that, and the forced final round re-sent all of it, offering submission with tool_choice "auto".

const id = "as_0123456789abcdef01234567";
const ROUND_BUDGET = 24_000; // ANSWER_ROUND_INPUT_TOKEN_BUDGET
const TOTAL_BUDGET = 48_000; // T7-F7's ANSWER_INPUT_TOKEN_BUDGET
const CHARS_PER_TOKEN = 3.5; // what the wire below bills: a little under the loop's own 3, as real JSON runs
afterEach(() => vi.unstubAllGlobals());

type Reply = { text?: string; calls?: Array<{ name: string; input: unknown }> };
/** The OpenRouter wire, billing each request's prompt by its size so the loop sees realistic round inputs. */
function wire(replies: Reply[]) {
  const requests: Array<{ body: any; promptTokens: number }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const promptTokens = Math.ceil(JSON.stringify(body.messages).length / CHARS_PER_TOKEN);
    requests.push({ body, promptTokens });
    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("Unexpected extra model completion");
    const calls = reply.calls?.map((call, index) => ({ id: `call-${requests.length}-${index}`, type: "function", index, function: { name: call.name, arguments: JSON.stringify(call.input) } }));
    const message = { role: "assistant", content: reply.text ?? null, ...(calls ? { tool_calls: calls } : {}) };
    return new Response(JSON.stringify({
      id: "synthetic", created: 0, model: "anthropic/claude-sonnet-5.5", object: "chat.completion",
      usage: { prompt_tokens: promptTokens, completion_tokens: 80, total_tokens: promptTokens + 80 },
      choices: [{ index: 0, message, finish_reason: calls ? "tool_calls" : "stop" }],
    }), { headers: { "content-type": "application/json" } });
  }));
  return requests;
}

/** A large read: about 64K tokens of passages, one oversized tool result. */
const bigRead = (path: string) => JSON.stringify({ path, answerSupports: [{ id, modes: ["current"] }], body: `${path} `.repeat(15_000) });
const tools = {
  searchChats: async () => "none",
  readFacts: async (input: { path: string }) => bigRead(input.path),
};
const read = (path: string) => ({ name: "read_facts", input: { path } });
const submit = { name: "submit_memory_answer", input: { analysisText: null, supportSelections: [{ id, mode: "current", summaryText: null }] } };
// Web chat (handleTasking) answers under the mixed scope: memory reads plus action tools.
const chat = { question: "Which rehearsal birds did I save?", vaultBriefing: "brief", conversation: [], answerSupportContract: "v1" as const };

function llm(maxSteps: number, usage: LlmUsageReport[] = []) {
  return createBrainLlm({ provider: "openrouter", apiKey: "synthetic", askModel: "anthropic/claude-sonnet-5.5", maxSteps, onUsage: (report) => usage.push(report) });
}

describe("T7-F9: every answer round is bounded", () => {
  it("never sends a round over the per-round budget, the forced final round included", async () => {
    const requests = wire([{ calls: [read("Notes/Birds.md")] }, { calls: [read("Log/2026-11-12.md")] }, { calls: [read("Notes/Rehearsal.md")] }, { calls: [submit] }]);
    const result = await llm(8).answer(chat, tools);
    const rounds = requests.map((request) => request.promptTokens);
    // main: rounds of 1.8K, 66K, 143K and 225K tokens, each re-sending every read; now 1.8K, 21K, 24K and 24K.
    expect(Math.max(...rounds)).toBeLessThanOrEqual(ROUND_BUDGET);
    expect(rounds.reduce((sum, round) => sum + round, 0)).toBeLessThanOrEqual(TOTAL_BUDGET + ROUND_BUDGET);
    expect(JSON.stringify(requests.at(-1)!.body.messages)).toContain("[trimmed: the rest of this tool result was dropped");
    // Trimming keeps every call paired with its result and the answer still ends on a real submission.
    expect(result.supportSelections).toEqual([{ id, mode: "current" }]);
  });

  it("leaves small rounds untouched", async () => {
    const small = { searchChats: async () => "none", readFacts: async () => JSON.stringify({ answerSupports: [{ id, modes: ["current"] }], body: "heron" }) };
    const requests = wire([{ calls: [read("Notes/Word.md")] }, { calls: [submit] }]);
    const result = await llm(8).answer(chat, small);
    expect(JSON.stringify(requests.map((request) => request.body.messages))).not.toContain("[trimmed");
    expect(result.supportSelections).toEqual([{ id, mode: "current" }]);
  });

  it("makes a chat answer's forced final round submit once memory was read, so it ends on an answer", async () => {
    const usage: LlmUsageReport[] = [];
    const requests = wire([{ calls: [read("Notes/Birds.md")] }, { calls: [submit] }]);
    const result = await llm(2, usage).answer(chat, tools);
    // main: "auto", and prose there is always thrown away as a protocol failure.
    expect(requests[1]!.body.tool_choice).toBe("required");
    expect(requests[1]!.body.tools.map((tool: any) => tool.function.name)).toEqual(["submit_memory_answer"]);
    expect(result.supportSelections).toEqual([{ id, mode: "current" }]);
    expect(usage.at(-1)).toMatchObject({ operation: "answer", status: "succeeded" });
  });

  it("does not charge the tester for a protocol-failure non-answer", async () => {
    const usage: LlmUsageReport[] = [];
    wire([{ calls: [read("Notes/Birds.md")] }, { text: "The birds you saved are herons and egrets." }]);
    const result = await llm(2, usage).answer(chat, tools);
    expect(result.supportProtocolError).toBe("missing_submission");
    const answer = usage.filter((report) => report.operation === "answer");
    expect(answer).toHaveLength(1);
    // main: status "succeeded", so the allowance counted it ($0.1647 on production).
    expect(answer[0]).toMatchObject({ status: "failed", errorCode: "answer_protocol_failure" });
    expect(answer[0]!.inputTokens).toBeGreaterThan(0);
  });
});
