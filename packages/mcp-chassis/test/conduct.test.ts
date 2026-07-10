import { describe, expect, it } from "vitest";
import {
  ConductContractError,
  acceptedTicket,
  assertConductResult,
  assertLongToolContract,
  completionEvent,
  conductErrorResult,
  createToolClassifier,
  evidence,
  propagateDispatchContext,
  rootDispatchContext,
  structuredError,
  withConduct,
} from "../src/conduct.js";

describe("conduct receipt discipline", () => {
  const classifier = createToolClassifier({
    read: ["read_status"],
    mutate: ["write_state"],
  });

  it("rejects mutating success without evidence[] or a structured error", () => {
    expect(() => assertConductResult("write_state", { status: "ok" }, { classifier })).toThrow(ConductContractError);
    expect(() => assertConductResult("write_state", { status: "ok" }, { classifier })).toThrow(
      /returned success without evidence\[\]/,
    );
  });

  it("allows mutating success with a concrete evidence handle", () => {
    const result = {
      status: "ok",
      evidence: [evidence("issue_updated", { id: "zenod-ai/zenod#726", url: "https://github.com/zenod-ai/zenod/issues/726" })],
    };
    expect(assertConductResult("write_state", result, { classifier })).toBe(result);
  });

  it("allows mutating failure only when the error is structured", () => {
    const result = { error: structuredError("invalid_input", "title is required") };
    expect(assertConductResult("write_state", result, { classifier })).toBe(result);
  });

  it("wraps tool handlers as reusable middleware", async () => {
    const guarded = withConduct("write_state", async () => ({ status: "ok" }), { classifier });
    await expect(guarded(undefined)).rejects.toMatchObject({ code: "silent_ack" });
  });

  it("preserves chassis contract messages but redacts unexpected errors", () => {
    const contract = conductErrorResult(
      new ConductContractError("known_contract", "Specific chassis detail."),
    );
    const unexpected = conductErrorResult(
      new Error("provider_api_key=sentinel-secret-do-not-leak"),
    );

    expect(contract.structuredContent.error).toEqual({
      code: "known_contract",
      message: "Specific chassis detail.",
    });
    expect(unexpected.structuredContent.error).toEqual({
      code: "tool_error",
      message: "Tool execution failed unexpectedly.",
    });
    expect(JSON.stringify(unexpected)).not.toContain("sentinel-secret");
  });
});

describe("conduct long-running tool contract", () => {
  it("supports accepted ticket, completion event, and poll tool shape", () => {
    const accepted = acceptedTicket({
      ticket_id: "council-1",
      origin_ticket_id: "ring-mailbox-9",
      depth: 0,
      poll: { name: "get_council_result", inputField: "ticket_id" },
    });
    const completion = completionEvent({
      ticket_id: "council-1",
      state: "done",
      origin_ticket_id: "ring-mailbox-9",
      depth: 0,
      evidence: [evidence("memory_stored", { commitSha: "abc1234" })],
    });

    expect(
      assertLongToolContract({
        accepted,
        completion,
        poll: { name: "get_council_result", inputField: "ticket_id" },
      }),
    ).toMatchObject({ accepted: { ticket_id: "council-1" }, completion: { ticket_id: "council-1" } });
  });

  it("rejects a completion event with the wrong ticket_id", () => {
    expect(() =>
      assertLongToolContract({
        accepted: acceptedTicket({ ticket_id: "job-1" }),
        completion: completionEvent({
          ticket_id: "job-2",
          state: "done",
          evidence: [evidence("job_completed", { id: "job-2" })],
        }),
        poll: { name: "get_job_result" },
      }),
    ).toThrow(/must match/);
  });

  it("rejects done completions without terminal evidence", () => {
    expect(() => completionEvent({ ticket_id: "job-1", state: "done", evidence: [] })).toThrow(/evidence/);
  });

  it("rejects completion events that lose the accepted origin", () => {
    expect(() =>
      assertLongToolContract({
        accepted: acceptedTicket({
          ticket_id: "job-1",
          origin_ticket_id: "origin-1",
          depth: 0,
        }),
        completion: completionEvent({
          ticket_id: "job-1",
          state: "done",
          origin_ticket_id: "origin-2",
          depth: 0,
          evidence: [evidence("job_completed", { id: "job-1" })],
        }),
        poll: { name: "get_job_result" },
      }),
    ).toThrow(/origin_ticket_id/);
  });
});

describe("conduct tool classification", () => {
  it("classifies known reads and mutates while unknown tools fail safe to mutate", () => {
    const classifier = createToolClassifier({ read: ["search_memory"], mutate: ["store_memory"] });

    expect(classifier.toolKind("searchMemory")).toBe("read");
    expect(classifier.toolKind("STORE_MEMORY")).toBe("mutate");
    expect(classifier.isKnownTool("surprise_tool")).toBe(false);
    expect(classifier.toolKind("surprise_tool")).toBe("mutate");
  });
});

describe("conduct dispatch propagation", () => {
  it("creates root dispatch context and propagates origin_ticket_id to depth 1", () => {
    const root = rootDispatchContext("council-123");
    expect(root).toEqual({ origin_ticket_id: "council-123", depth: 0 });
    expect(propagateDispatchContext(root)).toEqual({ origin_ticket_id: "council-123", depth: 1 });
  });

  it("rejects depth-2 dispatches", () => {
    expect(() => propagateDispatchContext({ origin_ticket_id: "council-123", depth: 1 })).toThrow(
      /Dispatch depth/,
    );
  });

  it("requires an origin ticket id when dispatching", () => {
    expect(() => propagateDispatchContext({ depth: 0 })).toThrow(/origin_ticket_id/);
  });
});
