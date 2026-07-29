import { z } from "zod";

/**
 * RIV-1's provider-independent interpretation contract.
 *
 * A TurnPlan is model-proposed evidence for later host policy. It is not
 * permission to execute a tool and it is not a receipt. Future policy/executor
 * work must consume only a `ready` compilation and must not add a second model
 * call in front of the existing Ring reasoning loop.
 */
export const TURN_PLAN_COMPILER_VERSION = "riv-1";

export const turnPlanIntentSchema = z.enum([
  "read",
  "mutate",
  "approve",
  "cancel",
  "status",
  "clarify",
]);

const authoritySpanSchema = z.object({
  quote: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

const requestedOperationSchema = z.object({
  toolId: z.string().min(1),
  inputJson: z.string().min(2),
  payloadRef: z.string().nullable(),
});

const embeddedCandidateSchema = z.object({
  sourceKind: z.enum(["current_turn", "artifact"]),
  sourceRef: z.string().nullable(),
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().positive().nullable(),
  summary: z.string().min(1).max(240),
  proposedIntent: turnPlanIntentSchema,
  proposedToolId: z.string().nullable(),
  active: z.literal(false),
});

/**
 * Every property is required. Optional values are nullable so this schema also
 * works with providers that enforce OpenAI-style strict structured outputs.
 */
export const turnPlanModelSchema = z.object({
  outerIntent: turnPlanIntentSchema,
  authority: authoritySpanSchema,
  requestedOperations: z.array(requestedOperationSchema).max(1),
  embeddedCandidates: z.array(embeddedCandidateSchema).max(16),
  needsClarification: z.boolean(),
  clarification: z.string().nullable(),
});

export type TurnPlanIntent = z.infer<typeof turnPlanIntentSchema>;
export type TurnPlanModelOutput = z.infer<typeof turnPlanModelSchema>;

export interface TurnPlanTool {
  /** Exact collision-safe identifier from the current authenticated MCP catalog. */
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}

export interface TurnPlanPayload {
  /** Opaque host-owned reference. Artifact/transcript content is not copied into the plan. */
  ref: string;
  kind: string;
  mediaType: string | null;
  sizeBytes: number | null;
}

export interface TurnPlanCompileInput {
  /** The user's current outer instruction. It must not contain an attached transcript twice. */
  currentTurn: string;
  /** Exact authenticated tools currently available to this tenant and turn. */
  tools: readonly TurnPlanTool[];
  /** Host-owned artifact references available to operations in this turn. */
  payloads: readonly TurnPlanPayload[];
  /** Host-owned correlation identity; the model cannot replace it. */
  correlationId: string;
}

export interface TurnPlanMetadata {
  correlationId: string;
  compilerVersion: typeof TURN_PLAN_COMPILER_VERSION;
  modelCallCount: 1;
}

export interface TurnPlanOperation {
  toolId: string;
  input: Record<string, unknown>;
  payloadRef: string | null;
}

export interface TurnPlan extends Omit<TurnPlanModelOutput, "requestedOperations"> {
  requestedOperations: TurnPlanOperation[];
  metadata: TurnPlanMetadata;
}

export type TurnPlanCompilation =
  | {
      status: "ready";
      plan: TurnPlan;
      errors: [];
    }
  | {
      status: "clarify";
      plan: null;
      clarification: string;
      errors: string[];
      metadata: TurnPlanMetadata;
    };

function metadata(input: TurnPlanCompileInput): TurnPlanMetadata {
  return {
    correlationId: input.correlationId,
    compilerVersion: TURN_PLAN_COMPILER_VERSION,
    modelCallCount: 1,
  };
}

function failClosed(input: TurnPlanCompileInput, errors: string[]): TurnPlanCompilation {
  return {
    status: "clarify",
    plan: null,
    clarification: "I need one clear instruction before I can choose or run a connected tool.",
    errors,
    metadata: metadata(input),
  };
}

function validateAuthority(currentTurn: string, output: TurnPlanModelOutput, errors: string[]): void {
  const { quote, start, end } = output.authority;
  if (end <= start || end > currentTurn.length || currentTurn.slice(start, end) !== quote) {
    errors.push("authority span is not an exact slice of the current user turn");
  }
  if (!quote.trim()) errors.push("authority quote is empty");
}

function validateOperationBindings(
  input: TurnPlanCompileInput,
  output: TurnPlanModelOutput,
  boundOperations: TurnPlanOperation[],
  errors: string[],
): void {
  const toolIds = new Set(input.tools.map((tool) => tool.id));
  const payloadRefs = new Set(input.payloads.map((payload) => payload.ref));
  for (const operation of output.requestedOperations) {
    if (!toolIds.has(operation.toolId)) {
      errors.push(`requested operation is not bound to an exact discovered tool: ${operation.toolId}`);
    }
    if (operation.payloadRef !== null && !payloadRefs.has(operation.payloadRef)) {
      errors.push(`requested operation references an unavailable payload: ${operation.payloadRef}`);
    }
    try {
      const parsed = JSON.parse(operation.inputJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push(`requested operation inputJson must encode one JSON object: ${operation.toolId}`);
      } else {
        boundOperations.push({
          toolId: operation.toolId,
          input: parsed as Record<string, unknown>,
          payloadRef: operation.payloadRef,
        });
      }
    } catch {
      errors.push(`requested operation inputJson is not valid JSON: ${operation.toolId}`);
    }
  }
}

function validateClarification(output: TurnPlanModelOutput, errors: string[]): void {
  if (output.needsClarification) {
    if (!output.clarification?.trim()) errors.push("clarification text is required when needsClarification is true");
    if (output.requestedOperations.length > 0) {
      errors.push("an ambiguous plan cannot request an executable operation");
    }
    return;
  }
  if (output.clarification !== null) {
    errors.push("clarification must be null when needsClarification is false");
  }
}

function validateEmbeddedCandidates(
  input: TurnPlanCompileInput,
  output: TurnPlanModelOutput,
  errors: string[],
): void {
  const toolIds = new Set(input.tools.map((tool) => tool.id));
  const payloadRefs = new Set(input.payloads.map((payload) => payload.ref));
  for (const candidate of output.embeddedCandidates) {
    if (candidate.active !== false) errors.push("embedded candidates must remain inert");
    if (candidate.proposedToolId !== null && !toolIds.has(candidate.proposedToolId)) {
      errors.push(`embedded candidate names an undiscovered tool: ${candidate.proposedToolId}`);
    }
    if (candidate.sourceKind === "artifact") {
      if (candidate.sourceRef === null || !payloadRefs.has(candidate.sourceRef)) {
        errors.push("artifact candidate must reference an available payload");
      }
      if (candidate.start !== null || candidate.end !== null) {
        errors.push("artifact candidate must use its opaque locator instead of current-turn offsets");
      }
    } else {
      if (candidate.sourceRef !== null) {
        errors.push("current-turn candidate cannot name an artifact source");
      }
      if (
        candidate.start === null ||
        candidate.end === null ||
        candidate.end <= candidate.start ||
        candidate.end > input.currentTurn.length
      ) {
        errors.push("current-turn candidate must have valid current-turn offsets");
      }
    }
  }
}

/**
 * Bind a schema-valid model proposal to host-owned current-turn evidence.
 * Nothing executes here. A non-ready result deliberately carries no plan.
 */
export function bindTurnPlan(
  input: TurnPlanCompileInput,
  candidate: unknown,
): TurnPlanCompilation {
  const parsed = turnPlanModelSchema.safeParse(candidate);
  if (!parsed.success) {
    return failClosed(
      input,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`),
    );
  }

  const errors: string[] = [];
  const boundOperations: TurnPlanOperation[] = [];
  validateAuthority(input.currentTurn, parsed.data, errors);
  validateOperationBindings(input, parsed.data, boundOperations, errors);
  validateClarification(parsed.data, errors);
  validateEmbeddedCandidates(input, parsed.data, errors);
  if (errors.length > 0) return failClosed(input, errors);

  return {
    status: "ready",
    plan: {
      ...parsed.data,
      requestedOperations: boundOperations,
      metadata: metadata(input),
    },
    errors: [],
  };
}

export function turnPlanPrompt(input: TurnPlanCompileInput): string {
  return [
    "Current user turn:",
    input.currentTurn,
    "",
    "Exact authenticated MCP catalog for this tenant and turn:",
    JSON.stringify(input.tools),
    "",
    "Available opaque payload/artifact references (content is intentionally not repeated):",
    JSON.stringify(input.payloads),
  ].join("\n");
}
