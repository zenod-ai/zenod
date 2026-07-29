import { z } from "zod";
import { Ajv2020 } from "ajv/dist/2020.js";

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
  "respond",
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
}).strict();

const requestedOperationSchema = z.object({
  toolId: z.string().min(1),
  inputJson: z.string().min(2),
  payloadRef: z.string().nullable(),
}).strict();

const embeddedCandidateSchema = z.object({
  sourceKind: z.enum(["current_turn", "artifact"]),
  sourceRef: z.string().nullable(),
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().positive().nullable(),
  summary: z.string().min(1).max(240),
  proposedIntent: turnPlanIntentSchema,
  proposedToolId: z.string().nullable(),
  active: z.literal(false),
}).strict();

export const turnPlanDispositionSchema = z.enum([
  "tool",
  "direct_answer",
  "host_resolution",
  "clarify",
]);

/**
 * Every property is required. Optional values are nullable so this schema also
 * works with providers that enforce OpenAI-style strict structured outputs.
 */
export const turnPlanModelSchema = z.object({
  outerIntent: turnPlanIntentSchema,
  disposition: turnPlanDispositionSchema,
  authority: authoritySpanSchema,
  requestedOperations: z.array(requestedOperationSchema).max(1),
  embeddedCandidates: z.array(embeddedCandidateSchema).max(16),
  directAnswer: z.string().max(1_200).nullable(),
  needsClarification: z.boolean(),
  clarification: z.string().nullable(),
}).strict();

export type TurnPlanIntent = z.infer<typeof turnPlanIntentSchema>;
export type TurnPlanDisposition = z.infer<typeof turnPlanDispositionSchema>;
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
  /** Contract budget. This does not claim a provider call happened. */
  modelCallBudget: 1;
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
      /** Observed attempts at this seam; pure bindTurnPlan returns zero. */
      observedProviderAttempts: 0 | 1;
    }
  | {
      status: "clarify";
      plan: null;
      clarification: string;
      errors: TurnPlanError[];
      metadata: TurnPlanMetadata;
      /** Observed attempts at this seam; pure bindTurnPlan returns zero. */
      observedProviderAttempts: 0 | 1;
    };

export type TurnPlanErrorCode =
  | "structured_output_invalid"
  | "authority_span_invalid"
  | "tool_not_discovered"
  | "payload_unavailable"
  | "arguments_invalid"
  | "arguments_schema_mismatch"
  | "embedded_candidate_invalid"
  | "semantic_contradiction"
  | "provider_output_unavailable";

export interface TurnPlanError {
  code: TurnPlanErrorCode;
  message: string;
}

const ERROR_MESSAGES: Record<TurnPlanErrorCode, string> = {
  structured_output_invalid: "The turn plan did not match the required structure.",
  authority_span_invalid: "The requested authority could not be bound exactly to the current turn.",
  tool_not_discovered: "The requested operation is not available in the current connected-tool catalog.",
  payload_unavailable: "The requested payload is not available for this turn.",
  arguments_invalid: "The requested operation arguments are not a JSON object.",
  arguments_schema_mismatch: "The requested operation arguments do not match the selected tool contract.",
  embedded_candidate_invalid: "Embedded content could not be represented safely as inert context.",
  semantic_contradiction: "The turn plan contains contradictory intent or execution instructions.",
  provider_output_unavailable: "The turn could not be compiled into a safe structured plan.",
};

function issue(code: TurnPlanErrorCode): TurnPlanError {
  return { code, message: ERROR_MESSAGES[code] };
}

function metadata(input: TurnPlanCompileInput): TurnPlanMetadata {
  return {
    correlationId: input.correlationId,
    compilerVersion: TURN_PLAN_COMPILER_VERSION,
    modelCallBudget: 1,
  };
}

function failClosed(
  input: TurnPlanCompileInput,
  errors: TurnPlanError[],
  observedProviderAttempts: 0 | 1 = 0,
): TurnPlanCompilation {
  const deduped = [...new Map(errors.map((error) => [error.code, error])).values()];
  return {
    status: "clarify",
    plan: null,
    clarification: "I need one clear instruction before I can choose or run a connected tool.",
    errors: deduped,
    metadata: metadata(input),
    observedProviderAttempts,
  };
}

function bindAuthority(
  currentTurn: string,
  output: TurnPlanModelOutput,
  errors: TurnPlanError[],
): TurnPlanModelOutput["authority"] | null {
  const { quote, start, end } = output.authority;
  if (end > start && end <= currentTurn.length && currentTurn.slice(start, end) === quote && quote.trim()) {
    return { quote, start, end };
  }
  if (quote.trim()) {
    const first = currentTurn.indexOf(quote);
    if (first >= 0 && currentTurn.indexOf(quote, first + 1) < 0) {
      return { quote, start: first, end: first + quote.length };
    }
  }
  errors.push(issue("authority_span_invalid"));
  return null;
}

function validateOperationBindings(
  input: TurnPlanCompileInput,
  output: TurnPlanModelOutput,
  boundOperations: TurnPlanOperation[],
  errors: TurnPlanError[],
): void {
  const toolsById = new Map(input.tools.map((tool) => [tool.id, tool]));
  const payloadRefs = new Set(input.payloads.map((payload) => payload.ref));
  for (const operation of output.requestedOperations) {
    const selectedTool = toolsById.get(operation.toolId);
    if (!selectedTool) {
      errors.push(issue("tool_not_discovered"));
    }
    if (operation.payloadRef !== null && !payloadRefs.has(operation.payloadRef)) {
      errors.push(issue("payload_unavailable"));
    }
    try {
      const parsed = JSON.parse(operation.inputJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push(issue("arguments_invalid"));
      } else {
        let argumentsValid = false;
        if (selectedTool) {
          try {
            const validator = new Ajv2020({
              allErrors: true,
              strict: false,
              validateFormats: false,
            }).compile(selectedTool.inputSchema);
            argumentsValid = validator(parsed);
          } catch {
            argumentsValid = false;
          }
        }
        if (!argumentsValid) {
          errors.push(issue("arguments_schema_mismatch"));
        } else {
          boundOperations.push({
            toolId: operation.toolId,
            input: parsed as Record<string, unknown>,
            payloadRef: operation.payloadRef,
          });
        }
      }
    } catch {
      errors.push(issue("arguments_invalid"));
    }
  }
}

function isReadOnlyTool(tool: TurnPlanTool | undefined): boolean {
  return tool?.annotations.readOnlyHint === true;
}

function validateSemantics(
  input: TurnPlanCompileInput,
  output: TurnPlanModelOutput,
  errors: TurnPlanError[],
): void {
  const operation = output.requestedOperations[0];
  const selectedTool = operation ? input.tools.find((tool) => tool.id === operation.toolId) : undefined;
  const hasOperation = output.requestedOperations.length === 1;
  const contradicts = (): void => {
    errors.push(issue("semantic_contradiction"));
  };

  if (output.outerIntent === "clarify") {
    if (
      output.disposition !== "clarify" ||
      !output.needsClarification ||
      !output.clarification?.trim() ||
      output.directAnswer !== null ||
      hasOperation
    ) contradicts();
    return;
  }

  if (output.needsClarification || output.clarification !== null || output.disposition === "clarify") {
    contradicts();
  }

  if (output.outerIntent === "approve" || output.outerIntent === "cancel") {
    if (output.disposition !== "host_resolution" || hasOperation || output.directAnswer !== null) contradicts();
    return;
  }

  if (output.outerIntent === "mutate") {
    if (output.disposition !== "tool" || !hasOperation || output.directAnswer !== null) contradicts();
    return;
  }

  if (output.outerIntent === "respond") {
    if (output.disposition !== "direct_answer" || hasOperation || !output.directAnswer?.trim()) contradicts();
    return;
  }

  if (output.outerIntent === "read" || output.outerIntent === "status") {
    if (output.disposition === "tool") {
      if (!hasOperation || output.directAnswer !== null || !isReadOnlyTool(selectedTool)) contradicts();
      return;
    }
    if (output.disposition === "direct_answer") {
      if (hasOperation || !output.directAnswer?.trim()) contradicts();
      return;
    }
    contradicts();
  }
}

function validateEmbeddedCandidates(
  input: TurnPlanCompileInput,
  output: TurnPlanModelOutput,
  errors: TurnPlanError[],
): void {
  const toolIds = new Set(input.tools.map((tool) => tool.id));
  const payloadRefs = new Set(input.payloads.map((payload) => payload.ref));
  for (const candidate of output.embeddedCandidates) {
    if (candidate.active !== false) errors.push(issue("embedded_candidate_invalid"));
    if (candidate.proposedToolId !== null && !toolIds.has(candidate.proposedToolId)) {
      errors.push(issue("embedded_candidate_invalid"));
    }
    if (candidate.sourceKind === "artifact") {
      if (candidate.sourceRef === null || !payloadRefs.has(candidate.sourceRef)) {
        errors.push(issue("embedded_candidate_invalid"));
      }
      if (candidate.start !== null || candidate.end !== null) {
        errors.push(issue("embedded_candidate_invalid"));
      }
    } else {
      if (candidate.sourceRef !== null) {
        errors.push(issue("embedded_candidate_invalid"));
      }
      if (
        candidate.start === null ||
        candidate.end === null ||
        candidate.end <= candidate.start ||
        candidate.end > input.currentTurn.length
      ) {
        errors.push(issue("embedded_candidate_invalid"));
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
      [issue("structured_output_invalid")],
    );
  }

  const errors: TurnPlanError[] = [];
  const boundOperations: TurnPlanOperation[] = [];
  const authority = bindAuthority(input.currentTurn, parsed.data, errors);
  validateOperationBindings(input, parsed.data, boundOperations, errors);
  validateSemantics(input, parsed.data, errors);
  validateEmbeddedCandidates(input, parsed.data, errors);
  if (errors.length > 0) return failClosed(input, errors);

  return {
    status: "ready",
    plan: {
      ...parsed.data,
      authority: authority!,
      requestedOperations: boundOperations,
      metadata: metadata(input),
    },
    errors: [],
    observedProviderAttempts: 0,
  };
}

/** Attach the one observed provider attempt made by the runtime compiler seam. */
export function withObservedProviderAttempt(compilation: TurnPlanCompilation): TurnPlanCompilation {
  return { ...compilation, observedProviderAttempts: 1 };
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
