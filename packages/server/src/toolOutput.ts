import { Ajv2020 } from "ajv/dist/2020.js";
import type { SchemaObject } from "ajv";
import { TOOL_OUTPUT_SCHEMAS } from "./toolOutputSchemas.generated.js";

export type OperationStatus = "completed" | "blocked" | "needs_input";

export interface Operation {
  operationId: string;
  interpretedAs?: string;
  status: OperationStatus;
}

export interface Question {
  operationId?: string;
  text: string;
}

export interface Candidate {
  operationId?: string;
  target: string;
  title?: string;
  url?: string;
  matchReason?: string;
  confidence?: number;
}

export interface ToolError {
  operationId?: string;
  code: string;
  message: string;
  currentState?: Record<string, unknown>;
}

export const EVIDENCE_KINDS = [
  "issue",
  "issue_list",
  "issue_resolved",
  "issue_not_found",
  "issue_created",
  "issue_updated",
  "issue_closed",
  "issues_linked",
  "execution_status",
  "execution_none",
  "execution_queued",
  "execution_running",
  "execution_needs_review",
  "execution_blocked",
  "execution_done",
  "execution_failed",
  "notification_record",
  "notification_list",
  "notification_sent",
  "notification_decision",
  "notification_none",
  "memory_hits",
  "memory_note",
  "memory_job",
  "memory_stored",
  "action_audit",
  "outbound_draft",
  "outbound_tweet_sent",
  "outbound_reddit_sent",
  "outbound_email_sent",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type EvidenceObject = {
  kind: EvidenceKind;
  operationId?: string;
  [key: string]: unknown;
};

export interface ToolResponse {
  text?: string;
  operations?: Operation[];
  evidence: EvidenceObject[];
  questions?: Question[];
  candidates?: Candidate[];
  errors?: ToolError[];
  meta?: Record<string, unknown>;
}

const MUTATION_EVIDENCE_KINDS = new Set<EvidenceKind>([
  "issue_created",
  "issue_updated",
  "issue_closed",
  "issues_linked",
  "execution_queued",
  "outbound_tweet_sent",
  "outbound_reddit_sent",
  "outbound_email_sent",
]);

export class ToolOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "ToolOutputValidationError";
  }
}

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

type JsonSchemaValidator = (value: unknown) => boolean;

const schemaValidators = new Map<string, JsonSchemaValidator>();
const ajv = new Ajv2020({ allErrors: true, strict: false });
const TOOL_OUTPUT_SCHEMA_NAMES = new Set(Object.keys(TOOL_OUTPUT_SCHEMAS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function evidence<K extends EvidenceKind>(kind: K, fields: Omit<EvidenceObject, "kind"> = {}): EvidenceObject {
  return { ...fields, kind };
}

export function toolResponse(input: Omit<ToolResponse, "evidence"> & { evidence?: EvidenceObject[] } = {}): ToolResponse {
  return { ...input, evidence: input.evidence ?? [] };
}

export function validateToolResponse(toolName: string, value: unknown): ToolResponse {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ToolOutputValidationError("Tool response must be an object.", ["response is not an object"]);
  }

  const validate = schemaValidatorFor(toolName);
  if (!validate(value)) {
    issues.push(...schemaIssues(validate));
  }

  validateNoMutationUnderAmbiguity(value, issues);
  validateNoMutationOnFailedOperation(value, issues);

  if (issues.length) throw new ToolOutputValidationError(`Invalid output for ${toolName}: ${issues.join("; ")}`, issues);
  return value as unknown as ToolResponse;
}

export function compileAllToolOutputSchemas(): void {
  for (const toolName of TOOL_OUTPUT_SCHEMA_NAMES) {
    schemaValidatorFor(toolName);
  }
}

export function getToolOutputSchema(toolName: string): Record<string, unknown> | null {
  return (TOOL_OUTPUT_SCHEMAS[toolName as keyof typeof TOOL_OUTPUT_SCHEMAS] as Record<string, unknown> | undefined) ?? null;
}

export function toMcpToolResult(toolName: string, response: ToolResponse): McpToolResult {
  const validated = validateToolResponseForMcp(toolName, response);
  return {
    content: [{ type: "text", text: toolResponseText(validated) }],
    structuredContent: validated as unknown as Record<string, unknown>,
    ...(validated.errors?.length ? { isError: true } : {}),
  };
}

function strictToolOutputValidation(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env.ZENOD_STRICT_TOOL_OUTPUT_VALIDATION ?? "").toLowerCase());
}

function validateToolResponseForMcp(toolName: string, response: ToolResponse): ToolResponse {
  try {
    return validateToolResponse(toolName, response);
  } catch (error) {
    if (strictToolOutputValidation()) throw error;
    const message = error instanceof ToolOutputValidationError ? error.issues.join("; ") : error instanceof Error ? error.message : String(error);
    console.warn(`[tool-output] ${toolName} returned non-conforming structured output; forwarding response: ${message}`);
    return response;
  }
}

function toolResponseText(response: ToolResponse): string {
  return response.text ?? JSON.stringify(response, null, 2);
}

function validateNoMutationUnderAmbiguity(value: Record<string, unknown>, issues: string[]): void {
  const ambiguousOps = new Set<string>();
  let wholeTurnAmbiguous = false;

  for (const collectionName of ["questions", "candidates"] as const) {
    const collection = value[collectionName];
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!isRecord(item) || typeof item.operationId !== "string" || item.operationId.length === 0) {
        wholeTurnAmbiguous = true;
      } else {
        ambiguousOps.add(item.operationId);
      }
    }
  }

  const evidenceItems = Array.isArray(value.evidence) ? value.evidence : [];
  for (const item of evidenceItems) {
    if (!isRecord(item) || typeof item.kind !== "string" || !MUTATION_EVIDENCE_KINDS.has(item.kind as EvidenceKind)) continue;
    const operationId = typeof item.operationId === "string" ? item.operationId : "";
    if (wholeTurnAmbiguous && !operationId) {
      issues.push("write evidence is not allowed in a turn with unscoped questions/candidates");
    }
    if (operationId && ambiguousOps.has(operationId)) {
      issues.push(`operation '${operationId}' has both unresolved ambiguity and write/dispatch evidence`);
    }
  }
}

function validateNoMutationOnFailedOperation(value: Record<string, unknown>, issues: string[]): void {
  const errorOps = new Set<string>();
  let wholeTurnError = false;
  const errors = Array.isArray(value.errors) ? value.errors : [];
  for (const err of errors) {
    if (!isRecord(err) || typeof err.operationId !== "string" || err.operationId.length === 0) {
      wholeTurnError = true;
    } else {
      errorOps.add(err.operationId);
    }
  }

  if (!wholeTurnError && errorOps.size === 0) return;

  const evidenceItems = Array.isArray(value.evidence) ? value.evidence : [];
  for (const item of evidenceItems) {
    if (!isRecord(item) || typeof item.kind !== "string" || !MUTATION_EVIDENCE_KINDS.has(item.kind as EvidenceKind)) continue;
    const operationId = typeof item.operationId === "string" ? item.operationId : "";
    if (wholeTurnError && !operationId) {
      issues.push("write evidence is not allowed in a turn with unscoped errors");
    }
    if (operationId && errorOps.has(operationId)) {
      issues.push(`operation '${operationId}' has both an error and write/dispatch evidence`);
    }
  }
}

function schemaValidatorFor(toolName: string): JsonSchemaValidator {
  const existing = schemaValidators.get(toolName);
  if (existing) return existing;

  const schema = TOOL_OUTPUT_SCHEMAS[toolName as keyof typeof TOOL_OUTPUT_SCHEMAS] as SchemaObject | undefined;
  if (!schema) {
    throw new ToolOutputValidationError(`Unknown v4 tool output schema: ${toolName}`, [`unknown tool '${toolName}'`]);
  }

  const validate = ajv.compile(schema) as JsonSchemaValidator;
  schemaValidators.set(toolName, validate);
  return validate;
}

function schemaIssues(validate: JsonSchemaValidator): string[] {
  const errors = (validate as { errors?: Array<{ instancePath?: string; message?: string; params?: unknown }> }).errors ?? [];
  return errors.map((err) => {
    const path = err.instancePath && err.instancePath.length > 0 ? err.instancePath : "(root)";
    return `${path} ${err.message ?? "failed schema validation"}`;
  });
}
