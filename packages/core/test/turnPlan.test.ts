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
    disposition: "tool",
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
    directAnswer: null,
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
        metadata: { correlationId: "turn-123", compilerVersion: "riv-1", modelCallBudget: 1 },
      }),
      errors: [],
      observedProviderAttempts: 0,
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
    expect(result.errors.map((error) => error.code)).toContain("tool_not_discovered");
  });

  it("fails closed when the authority quote is not an exact current-turn slice", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({ authority: { quote: "save something", start: 0, end: 14 } }),
    );
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain("authority_span_invalid");
  });

  it("references a long artifact once without putting its content in the plan prompt or output", () => {
    const transcript = "private transcript ".repeat(5_000);
    const compileInput = input({
      payloads: [{ ref: "artifact://long-voice", kind: "voice_transcript", mediaType: "text/plain", sizeBytes: transcript.length }],
    });
    const plan = validPlan({
      requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"artifact://long-voice"}', payloadRef: "artifact://long-voice" }],
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
    expect(result.errors.map((error) => error.code)).toContain("arguments_invalid");
  });

  it("allows ambiguity only as a no-operation clarification", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({
        outerIntent: "clarify",
        disposition: "clarify",
        requestedOperations: [],
        embeddedCandidates: [],
        directAnswer: null,
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
    ["What records match this name?", "read", "direct_answer"],
    ["Do not store this.", "cancel", "host_resolution"],
    ["Has the requested operation finished?", "status", "direct_answer"],
    ["Yes, approve the pending action.", "approve", "host_resolution"],
    ["Thanks, that is all.", "respond", "direct_answer"],
  ] as const)("represents %s as the distinct %s outer intent", (currentTurn, outerIntent, disposition) => {
    const directAnswer = disposition === "direct_answer" ? "A bounded answer." : null;
    const result = bindTurnPlan(
      input({ currentTurn }),
      validPlan({
        outerIntent,
        disposition,
        authority: { quote: currentTurn.slice(0, -1), start: 0, end: currentTurn.length - 1 },
        requestedOperations: [],
        embeddedCandidates: [],
        directAnswer,
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

  it("rejects unknown keys at the top level and in nested objects", () => {
    expect(turnPlanModelSchema.safeParse({ ...validPlan(), surprise: true }).success).toBe(false);
    expect(turnPlanModelSchema.safeParse({
      ...validPlan(),
      authority: { ...validPlan().authority, surprise: true },
    }).success).toBe(false);
    expect(turnPlanModelSchema.safeParse({
      ...validPlan(),
      requestedOperations: [{ ...validPlan().requestedOperations[0], surprise: true }],
    }).success).toBe(false);
  });

  it("validates arguments against the exact selected tool JSON Schema", () => {
    const result = bindTurnPlan(
      input(),
      validPlan({
        requestedOperations: [{
          toolId: exactWriteTool,
          inputJson: '{"unexpected":"missing required text"}',
          payloadRef: null,
        }],
      }),
    );
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain("arguments_schema_mismatch");
  });

  it("allows a read operation only when the exact tool advertises readOnlyHint=true", () => {
    const currentTurn = "Find this record.";
    const result = bindTurnPlan(
      input({ currentTurn }),
      validPlan({
        outerIntent: "read",
        disposition: "tool",
        authority: { quote: "Find this record", start: 0, end: 16 },
        requestedOperations: [{ toolId: exactReadTool, inputJson: '{"query":"record"}', payloadRef: null }],
        embeddedCandidates: [],
      }),
    );
    expect(result.status).toBe("ready");
  });

  it.each([
    {
      name: "mutate with no operation",
      plan: { requestedOperations: [] },
    },
    {
      name: "approve introducing a mutation",
      plan: { outerIntent: "approve", disposition: "tool", requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }] },
    },
    {
      name: "cancel introducing a mutation",
      plan: { outerIntent: "cancel", disposition: "tool", requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }] },
    },
    {
      name: "read binding a mutating tool",
      plan: { outerIntent: "read", disposition: "tool", requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }] },
    },
    {
      name: "clarify carrying an operation",
      plan: {
        outerIntent: "clarify",
        disposition: "clarify",
        requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }],
        directAnswer: null,
        needsClarification: true,
        clarification: "Which target?",
      },
    },
  ])("fails closed for semantic contradiction: $name", ({ plan }) => {
    const result = bindTurnPlan(input(), validPlan(plan as Partial<TurnPlanModelOutput>));
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain("semantic_contradiction");
  });

  it("normalizes a unique non-BMP authority quote to exact JavaScript offsets", () => {
    const currentTurn = "🚀 Save this.";
    const result = bindTurnPlan(
      input({ currentTurn }),
      validPlan({
        authority: { quote: "Save this", start: 2, end: 11 },
        requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }],
        embeddedCandidates: [],
      }),
    );
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.plan.authority).toEqual({ quote: "Save this", start: 3, end: 12 });
      expect(currentTurn.slice(result.plan.authority.start, result.plan.authority.end)).toBe("Save this");
    }
  });

  it("requires exact supplied offsets when the authority quote repeats", () => {
    const currentTurn = "Save this, then Save this.";
    const exactSecond = bindTurnPlan(
      input({ currentTurn }),
      validPlan({
        authority: { quote: "Save this", start: 16, end: 25 },
        requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }],
        embeddedCandidates: [],
      }),
    );
    expect(exactSecond.status).toBe("ready");

    const ambiguous = bindTurnPlan(
      input({ currentTurn }),
      validPlan({
        authority: { quote: "Save this", start: 1, end: 10 },
        requestedOperations: [{ toolId: exactWriteTool, inputJson: '{"text":"x"}', payloadRef: null }],
        embeddedCandidates: [],
      }),
    );
    expect(ambiguous.status).toBe("clarify");
    expect(ambiguous.errors.map((error) => error.code)).toContain("authority_span_invalid");
  });

  it("returns only stable safe reason codes and messages for invalid model output", () => {
    const secret = "sk-secret-model-output";
    const result = bindTurnPlan(input(), { secret });
    expect(result.status).toBe("clarify");
    expect(JSON.stringify(result.errors)).not.toContain(secret);
    expect(result.errors).toEqual([{
      code: "structured_output_invalid",
      message: "The turn plan did not match the required structure.",
    }]);
  });
});
