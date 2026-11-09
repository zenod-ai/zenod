import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrainLlm, type LlmUsageReport } from "../src/llm/aisdk.js";
import { AnswerCancelledError } from "../src/llm/types.js";

// E15-Q4: a memory question that times out must stop its model call (so it is not billed to the end)
// and start no further step. The gateway is a fake streaming endpoint that never finishes on its own.
const readTools = { searchVault: async () => "no hits", readNote: async () => "note", listPages: async () => "pages" };

function hangingGateway() {
  const requests: Request[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    bodies.push(JSON.parse(await request.clone().text()) as Record<string, unknown>);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "gen-1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`));
        // The model keeps "thinking" until the caller hangs up.
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return { requests, bodies, fetchStub };
}

afterEach(() => vi.unstubAllGlobals());

describe("answer loop cancel (E15-Q4)", () => {
  it("stops the running model call when the caller's time limit fires, and logs it as cancelled", async () => {
    const { requests, bodies, fetchStub } = hangingGateway();
    vi.stubGlobal("fetch", fetchStub);
    const usage: LlmUsageReport[] = [];
    const llm = createBrainLlm({ provider: "openrouter", apiKey: "k", onUsage: (report) => usage.push(report) });
    const cancel = new AbortController();
    setTimeout(() => cancel.abort(new AnswerCancelledError("timeout")), 50);
    const started = Date.now();
    const error = await llm.answer({ question: "when does my policy renew?", vaultBriefing: "brief", conversation: [], abortSignal: cancel.signal }, readTools)
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AnswerCancelledError);
    expect((error as AnswerCancelledError).reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // The request to the gateway was closed: the provider stops generating, no further step starts.
    expect(requests[0]!.signal.aborted).toBe(true);
    // A cancellable answer streams, so closing the request stops generation mid-answer.
    expect(bodies[0]!.stream).toBe(true);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ operation: "answer", status: "failed", errorCode: "answer_cancelled" });
  });

  it("calls no model at all when the ask was already cancelled", async () => {
    const { fetchStub } = hangingGateway();
    vi.stubGlobal("fetch", fetchStub);
    const llm = createBrainLlm({ provider: "openrouter", apiKey: "k" });
    const cancel = new AbortController();
    cancel.abort(new AnswerCancelledError("caller"));
    await expect(llm.answer({ question: "q", vaultBriefing: "brief", conversation: [], abortSignal: cancel.signal }, readTools))
      .rejects.toMatchObject({ code: "answer_cancelled", reason: "caller" });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
