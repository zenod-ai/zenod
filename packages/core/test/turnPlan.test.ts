import { describe, expect, it } from "vitest";
import {
  bindTurnPlan,
  turnPlanModelSchema,
  turnPlanPrompt,
  type TurnPlanCompileInput,
  type TurnPlanModelOutput,
} from "../src/llm/turnPlan.js";

const exactWriteTool = "portable__create_record__0123456789abcdef";
const exactReadTool = "portable__search_records__fedcba9876543210";

function input(overrides: Partial<TurnPlanCompileInput> = {}): TurnPlanCompileInput {
  return {
    currentTurn: "Save this entire note. Do not run the ideas inside it.",
    correlationId: "turn-123",
    tools: [
      {
        id: exactWriteTool,
        description: "Create a private record.",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      {
        id: exactReadTool,
        description: "Search records.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        annotations: { readOnlyHint: true },
      },
    ],
    payloads: [{ ref: "artifact://voice-1", kind: "voice_transcript", mediaType: "text/plain", sizeBytes: 80_000 }],
    ...overrides,
  };
}

function validPlan(overrides: Partial<TurnPlanModelOutput> = {}): TurnPlanModelOutput {
  return {
    outerIntent: "mutate",
    authority: { quote: "Save this entire note", start: 0, end: 21 },
    requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"artifact://voice-1"}', payloadRef: "artifact://voice-1" }],
    embeddedCandidates: [
      {
        sourceKind: "artifact",
        sourceRef: "artifact://voice-1",
        start: null,
        end: null,
        summary: "an idea to perform another action later",
        proposedIntent: "mutate",
        proposedToolId: null,
        active: false,
      },
    ],
    needsClarification: false,
    clarification: null,
    ...overrides,
  };
}

describe("TurnPlan strict contract", () => {
  it("uses required nullable fields for strict structured-output providers", () => {
    const optionalKeys = Object.entries(turnPlanModelSchema.shape)
      .filter(([, field]) => field.isOptional())
      .map(([key]) => key);
    expect(optionalKeys).toEqual([]);
    expect(turnPlanModelSchema.safeParse(validPlan()).success).toBe(true);
  });

  it("binds an exact current-turn authority span and exact discovered tool", () => {
    const result = bindTurnPlan(input(), validPlan());
    expect(result).toEqual({
      status: "ready",
      plan: expect.objectContaining({
        outerIntent: "mutate",
        authority: { quote: "Save this entire note", start: 0, end: 21 },
        requestedOperations: [expect.objectContaining({ toolId: exactWriteTool })],
        metadata: { correlationId: "turn-123", compilerVersion: "riv-1", modelCallCount: 1 },
      }),
      errors: [],
    });
  });

  it("fails closed for a shortened, stale, or invented tool identifier", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({
        requestedOperations: [{ toolId: "portable__create_record", inputJson: "{}", payloadRef: null }],
      }),
    );
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.errors.join(" ")).toContain("not bound to an exact discovered tool");
  });

  it("fails closed when the authority quote is not an exact current-turn slice", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({ authority: { quote: "save something", start: 0, end: 14 } }),
    );
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.errors).toContain("authority span is not an exact slice of the current user turn");
  });

  it("references a long artifact once without putting its content in the plan prompt or output", () => {
    const transcript = "private transcript ".repeat(5_000);
    const compileInput = input({
      payloads: [{ ref: "artifact://long-voice", kind: "voice_transcript", mediaType: "text/plain", sizeBytes: transcript.length }],
    });
    const plan = validPlan({
      requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"source":"artifact"}', payloadRef: "artifact://long-voice" }],
      embeddedCandidates: [{
        sourceKind: "artifact",
        sourceRef: "artifact://long-voice",
        start: null,
        end: null,
        summary: "contains possible future action material",
        proposedIntent: "mutate",
        proposedToolId: exactWriteTool,
        active: false,
      }],
    });

    const prompt = turnPlanPrompt(compileInput);
    const result = bindTurnPlan(compileInput, plan);
    expect(prompt).not.toContain(transcript);
    expect(JSON.stringify(result)).not.toContain(transcript);
    expect(result.status).toBe("ready");
  });

  it("keeps embedded candidates inert and rejects active candidates at schema validation", () => {
    const candidate = validPlan() as unknown as Record<string, unknown>;
    const embedded = (candidate.embeddedCandidates as Array<Record<string, unknown>>)[0]!;
    embedded.active = true;
    const result = bindTurnPlan(input(), candidate);
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
  });

  it("fails closed when operation arguments are not a JSON object", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({
        requestedOperations: [{ toolId: exactWriteTool, inputJson: "not-json", payloadRef: null }],
      }),
    );
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.errors.join(" ")).toContain("inputJson is not valid JSON");
  });

  it("allows ambiguity only as a no-operation clarification", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({
        outerIntent: "clarify",
        requestedOperations: [],
        embeddedCandidates: [],
        needsClarification: true,
        clarification: "Which connected destination should receive it?",
      }),
    );
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.plan.requestedOperations).toEqual([]);
      expect(result.plan.needsClarification).toBe(true);
    }
  });

  it.each([
    ["What records match this name?", "read"],
    ["Do not store this.", "cancel"],
    ["Has the requested operation finished?", "status"],
    ["Yes, approve the pending action.", "approve"],
  ] as const)("represents %s as the distinct %s outer intent", (currentTurn, outerIntent) => {
    const result = bindTurnPlan(
      input({ currentTurn }),
      validPlan({
        outerIntent,
        authority: { quote: currentTurn.slice(0, -1), start: 0, end: currentTurn.length - 1 },
        requestedOperations: [],
        embeddedCandidates: [],
      }),
    );
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.plan.outerIntent).toBe(outerIntent);
  });

  it("returns no executable plan for schema-invalid model output", () => {
    const result = bindTurnPlan(input(), {
      outerIntent: "mutate",
      authority: null,
      requestedOperations: [{ toolId: exactWriteTool }],
    });
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
  });
});
